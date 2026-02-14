/**
 * AgentDNS — DNS-like resolution for AI agents
 *
 * Provides registration, lookup, resolution, and health-checking for agents
 * in the CortexOS Agent Internet. Analogous to DNS but purpose-built for
 * agent discovery with capability-based indexing and endpoint health tracking.
 *
 * Part of CortexOS Phase IV: The Agent Internet
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import type {
  AgentDNSRecord,
  AgentEndpoint,
  CADPEventType,
} from './types.js';

/** Options for constructing an AgentDNS instance. */
export interface AgentDNSOptions {
  /** Default time-to-live for records in seconds. Defaults to 3600 (1 hour). */
  defaultTTL?: number;
  /** Maximum number of records stored. Defaults to 10_000. */
  maxRecords?: number;
  /** How often to purge expired records (ms). Defaults to 60_000 (1 minute). */
  cleanupIntervalMs?: number;
}

export class AgentDNS extends EventEmitter {
  private records: Map<string, AgentDNSRecord> = new Map();
  private domainIndex: Map<string, Set<string>> = new Map();
  private capabilityIndex: Map<string, Set<string>> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private readonly defaultTTL: number;
  private readonly maxRecords: number;
  private readonly cleanupIntervalMs: number;

  constructor(options?: AgentDNSOptions) {
    super();
    this.defaultTTL = options?.defaultTTL ?? 3600;
    this.maxRecords = options?.maxRecords ?? 10_000;
    this.cleanupIntervalMs = options?.cleanupIntervalMs ?? 60_000;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a new agent DNS record.
   * Automatically sets `createdAt` and computes `expiresAt` from TTL.
   */
  register(record: Omit<AgentDNSRecord, 'createdAt' | 'expiresAt'>): AgentDNSRecord {
    if (this.records.size >= this.maxRecords && !this.records.has(record.agentId)) {
      // Attempt to make room by purging expired entries first
      this.purgeExpired();
      if (this.records.size >= this.maxRecords) {
        throw new Error(
          `AgentDNS: max records limit (${this.maxRecords}) reached. Cannot register agent "${record.agentId}".`,
        );
      }
    }

    const now = Date.now();
    const ttl = record.ttl > 0 ? record.ttl : this.defaultTTL;
    const fullRecord: AgentDNSRecord = {
      ...record,
      ttl,
      createdAt: now,
      expiresAt: now + ttl * 1000,
    };

    this.records.set(record.agentId, fullRecord);
    this.indexRecord(fullRecord);

    this.emit('cadp:agent:registered' satisfies CADPEventType, fullRecord);
    return fullRecord;
  }

  /**
   * Remove an agent from the DNS registry.
   * Returns `true` if the agent existed and was removed.
   */
  deregister(agentId: string): boolean {
    const record = this.records.get(agentId);
    if (!record) return false;

    this.deindexRecord(record);
    this.records.delete(agentId);

    this.emit('cadp:agent:deregistered' satisfies CADPEventType, { agentId });
    return true;
  }

  /**
   * Partially update an existing agent record.
   * Returns the updated record, or `null` if the agent was not found.
   */
  update(agentId: string, updates: Partial<AgentDNSRecord>): AgentDNSRecord | null {
    const existing = this.records.get(agentId);
    if (!existing) return null;

    // Remove old index entries before merging
    this.deindexRecord(existing);

    const updated: AgentDNSRecord = {
      ...existing,
      ...updates,
      agentId, // agentId is immutable
      createdAt: existing.createdAt, // preserve original creation time
    };

    // Recompute expiresAt if TTL changed
    if (updates.ttl !== undefined) {
      updated.expiresAt = updated.createdAt + updated.ttl * 1000;
    }

    this.records.set(agentId, updated);
    this.indexRecord(updated);

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Lookups (DNS-style)
  // ---------------------------------------------------------------------------

  /** Look up a single agent by its ID. Returns null if not found or expired. */
  lookup(agentId: string): AgentDNSRecord | null {
    const record = this.records.get(agentId);
    if (!record) {
      this.emit('cadp:lookup:miss' satisfies CADPEventType, { agentId });
      return null;
    }
    if (this.isExpired(record)) {
      this.emit('cadp:lookup:miss' satisfies CADPEventType, { agentId });
      return null;
    }
    this.emit('cadp:lookup:hit' satisfies CADPEventType, { agentId });
    return record;
  }

  /** Look up all agents registered under a given domain. */
  lookupByDomain(domain: string): AgentDNSRecord[] {
    const ids = this.domainIndex.get(domain);
    if (!ids) return [];
    const results: AgentDNSRecord[] = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (record && !this.isExpired(record)) {
        results.push(record);
      }
    }
    return results.sort((a, b) => a.priority - b.priority);
  }

  /** Look up all agents that advertise a given capability. */
  lookupByCapability(capability: string): AgentDNSRecord[] {
    const ids = this.capabilityIndex.get(capability);
    if (!ids) return [];
    const results: AgentDNSRecord[] = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (record && !this.isExpired(record)) {
        results.push(record);
      }
    }
    return results.sort((a, b) => a.priority - b.priority);
  }

  /** Reverse lookup: find the agent record whose endpoint matches the given URL. */
  reverseLookup(endpointUrl: string): AgentDNSRecord | null {
    for (const record of this.records.values()) {
      if (this.isExpired(record)) continue;
      for (const ep of record.endpoints) {
        if (ep.url === endpointUrl) {
          return record;
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Resolve: find the best endpoint for an agent
  // ---------------------------------------------------------------------------

  /**
   * Resolve the best healthy endpoint for a given agent.
   * Optionally prefers a specific protocol.
   */
  resolve(agentId: string, preferredProtocol?: AgentEndpoint['protocol']): AgentEndpoint | null {
    const record = this.lookup(agentId);
    if (!record) return null;

    const healthy = record.endpoints.filter((ep) => ep.healthy);
    if (healthy.length === 0) return null;

    // If a preferred protocol is specified, try to match it
    if (preferredProtocol) {
      const preferred = healthy.filter((ep) => ep.protocol === preferredProtocol);
      if (preferred.length > 0) {
        return this.pickBestEndpoint(preferred);
      }
    }

    return this.pickBestEndpoint(healthy);
  }

  /** Resolve all healthy endpoints for agents matching a given capability. */
  resolveAll(capability: string): AgentEndpoint[] {
    const records = this.lookupByCapability(capability);
    const endpoints: AgentEndpoint[] = [];
    for (const record of records) {
      for (const ep of record.endpoints) {
        if (ep.healthy) {
          endpoints.push(ep);
        }
      }
    }
    // Sort by latency (lower is better); unknown latency goes last
    return endpoints.sort((a, b) => {
      const la = a.latencyMs ?? Number.MAX_SAFE_INTEGER;
      const lb = b.latencyMs ?? Number.MAX_SAFE_INTEGER;
      return la - lb;
    });
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  /**
   * Perform a health check against all endpoints of a single agent.
   * Returns `true` if at least one endpoint is healthy.
   */
  async checkHealth(agentId: string): Promise<boolean> {
    const record = this.records.get(agentId);
    if (!record) return false;

    let anyHealthy = false;
    await Promise.all(
      record.endpoints.map(async (ep) => {
        const healthy = await this.probeEndpoint(ep);
        ep.healthy = healthy;
        ep.lastHealthCheck = Date.now();
        if (healthy) anyHealthy = true;
      }),
    );

    this.records.set(agentId, { ...record });
    this.emit('cadp:health:check' satisfies CADPEventType, { agentId, healthy: anyHealthy });
    return anyHealthy;
  }

  /** Run health checks for ALL registered agents. */
  async checkAllHealth(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const ids = Array.from(this.records.keys());

    await Promise.all(
      ids.map(async (id) => {
        const healthy = await this.checkHealth(id);
        results.set(id, healthy);
      }),
    );

    return results;
  }

  /** Manually mark an endpoint as healthy. */
  markHealthy(agentId: string, endpointUrl: string): void {
    const record = this.records.get(agentId);
    if (!record) return;
    for (const ep of record.endpoints) {
      if (ep.url === endpointUrl) {
        ep.healthy = true;
        ep.lastHealthCheck = Date.now();
        break;
      }
    }
  }

  /** Manually mark an endpoint as unhealthy. */
  markUnhealthy(agentId: string, endpointUrl: string): void {
    const record = this.records.get(agentId);
    if (!record) return;
    for (const ep of record.endpoints) {
      if (ep.url === endpointUrl) {
        ep.healthy = false;
        ep.lastHealthCheck = Date.now();
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cache management
  // ---------------------------------------------------------------------------

  /** Get a record by agent ID (including expired). */
  getRecord(agentId: string): AgentDNSRecord | null {
    return this.records.get(agentId) ?? null;
  }

  /** Get all records (including expired). */
  getAllRecords(): AgentDNSRecord[] {
    return Array.from(this.records.values());
  }

  /** Get all records that have passed their TTL expiry. */
  getExpiredRecords(): AgentDNSRecord[] {
    const now = Date.now();
    return Array.from(this.records.values()).filter((r) => r.expiresAt <= now);
  }

  /** Remove all expired records. Returns the count of purged records. */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now) {
        this.deindexRecord(record);
        this.records.delete(id);
        purged++;
      }
    }
    return purged;
  }

  /** Remove all records and indexes. */
  clear(): void {
    this.records.clear();
    this.domainIndex.clear();
    this.capabilityIndex.clear();
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats(): {
    totalRecords: number;
    activeRecords: number;
    expiredRecords: number;
    domains: number;
    capabilities: number;
  } {
    const now = Date.now();
    let expired = 0;
    for (const record of this.records.values()) {
      if (record.expiresAt <= now) expired++;
    }
    return {
      totalRecords: this.records.size,
      activeRecords: this.records.size - expired,
      expiredRecords: expired,
      domains: this.domainIndex.size,
      capabilities: this.capabilityIndex.size,
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start periodic cleanup of expired records. */
  startCleanup(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      this.purgeExpired();
    }, this.cleanupIntervalMs);
    // Allow the process to exit even if the interval is still running
    if (this.cleanupInterval && typeof this.cleanupInterval === 'object' && 'unref' in this.cleanupInterval) {
      this.cleanupInterval.unref();
    }
  }

  /** Stop periodic cleanup. */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /** Stop cleanup and clear all data. */
  destroy(): void {
    this.stopCleanup();
    this.clear();
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Add a record to the domain and capability indexes. */
  private indexRecord(record: AgentDNSRecord): void {
    // Domain index
    if (!this.domainIndex.has(record.domain)) {
      this.domainIndex.set(record.domain, new Set());
    }
    this.domainIndex.get(record.domain)!.add(record.agentId);

    // Capability index
    for (const cap of record.capabilities) {
      if (!this.capabilityIndex.has(cap)) {
        this.capabilityIndex.set(cap, new Set());
      }
      this.capabilityIndex.get(cap)!.add(record.agentId);
    }
  }

  /** Remove a record from the domain and capability indexes. */
  private deindexRecord(record: AgentDNSRecord): void {
    // Domain index
    const domainSet = this.domainIndex.get(record.domain);
    if (domainSet) {
      domainSet.delete(record.agentId);
      if (domainSet.size === 0) {
        this.domainIndex.delete(record.domain);
      }
    }

    // Capability index
    for (const cap of record.capabilities) {
      const capSet = this.capabilityIndex.get(cap);
      if (capSet) {
        capSet.delete(record.agentId);
        if (capSet.size === 0) {
          this.capabilityIndex.delete(cap);
        }
      }
    }
  }

  /** Check whether a record is expired. */
  private isExpired(record: AgentDNSRecord): boolean {
    return record.expiresAt <= Date.now();
  }

  /** Pick the "best" endpoint from a list of healthy endpoints (lowest latency). */
  private pickBestEndpoint(endpoints: AgentEndpoint[]): AgentEndpoint {
    let best = endpoints[0];
    let bestLatency = best.latencyMs ?? Number.MAX_SAFE_INTEGER;
    for (let i = 1; i < endpoints.length; i++) {
      const lat = endpoints[i].latencyMs ?? Number.MAX_SAFE_INTEGER;
      if (lat < bestLatency) {
        best = endpoints[i];
        bestLatency = lat;
      }
    }
    return best;
  }

  /**
   * Probe a single endpoint for health.
   * Tries `<url>/health` first, then `<url>/.well-known/agent.json`.
   * A 2xx response is considered healthy.
   */
  private async probeEndpoint(ep: AgentEndpoint): Promise<boolean> {
    const baseUrl = ep.url.replace(/\/+$/, '');
    const urls = [`${baseUrl}/health`, `${baseUrl}/.well-known/agent.json`];
    const timeoutMs = 5000;

    for (const url of urls) {
      try {
        const start = Date.now();
        const response = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const latency = Date.now() - start;
        if (response.ok) {
          ep.latencyMs = latency;
          return true;
        }
      } catch {
        // Network error or timeout — try next URL
      }
    }

    return false;
  }
}
