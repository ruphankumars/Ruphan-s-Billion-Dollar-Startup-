/**
 * FederationManager — Peer-to-peer agent sharing and discovery
 *
 * Manages a mesh of CADP peers that exchange agent DNS records, enabling
 * cross-domain agent discovery. Peers sync periodically and can forward
 * lookup requests for agents they don't have locally.
 *
 * Part of CortexOS Phase IV: The Agent Internet
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import type {
  AgentDNSRecord,
  CADPEventType,
  CADPMessage,
  CADPMessageType,
  FederationConfig,
  FederationPeer,
} from './types.js';
import type { AgentDNS } from './agent-dns.js';

const DEFAULT_FEDERATION_CONFIG: FederationConfig = {
  enabled: true,
  peerId: '',
  peerName: 'cortexos-peer',
  listenPort: 9100,
  peers: [],
  syncIntervalMs: 60_000,
  maxPeers: 50,
  shareCapabilities: true,
  acceptRemoteAgents: true,
};

export class FederationManager extends EventEmitter {
  private peers: Map<string, FederationPeer> = new Map();
  private agentDNS: AgentDNS;
  private config: FederationConfig;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private totalSynced = 0;
  private lastSyncAt?: number;

  constructor(agentDNS: AgentDNS, config: Partial<FederationConfig>) {
    super();
    this.agentDNS = agentDNS;
    this.config = {
      ...DEFAULT_FEDERATION_CONFIG,
      ...config,
      peerId: config.peerId || `peer_${randomUUID().slice(0, 12)}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Peer management
  // ---------------------------------------------------------------------------

  /**
   * Add a new federation peer by URL.
   * Performs a handshake (health-check message) to verify connectivity.
   * Returns the peer on success, or null if the peer could not be reached.
   */
  async addPeer(
    url: string,
    options?: { trustLevel?: FederationPeer['trustLevel'] },
  ): Promise<FederationPeer | null> {
    if (this.peers.size >= this.config.maxPeers) {
      return null;
    }

    // Prevent duplicate peers with the same URL
    for (const existing of this.peers.values()) {
      if (existing.url === url) return existing;
    }

    const trustLevel = options?.trustLevel ?? 'partial';
    const peerId = `peer_${randomUUID().slice(0, 12)}`;

    // Attempt a handshake
    const handshakeMsg = this.createMessage('health-check', peerId, {});
    const response = await this.sendToPeer(url, handshakeMsg);

    const peer: FederationPeer = {
      id: peerId,
      name: '',
      url,
      trustLevel,
      sharedCapabilities: [],
      lastSync: 0,
      status: response ? 'connected' : 'disconnected',
    };

    // Extract peer info from response
    if (response && response.type === 'health-response') {
      peer.name = (response.payload.peerName as string) || '';
      peer.id = (response.payload.peerId as string) || peerId;
      if (Array.isArray(response.payload.capabilities)) {
        peer.sharedCapabilities = response.payload.capabilities as string[];
      }
    }

    this.peers.set(peer.id, peer);

    if (peer.status === 'connected') {
      this.emit('cadp:peer:connected' satisfies CADPEventType, peer);
    }

    return peer;
  }

  /** Remove a peer from the federation. */
  removePeer(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    this.peers.delete(peerId);
    this.emit('cadp:peer:disconnected' satisfies CADPEventType, { peerId });
    return true;
  }

  /** Get a peer by ID. */
  getPeer(peerId: string): FederationPeer | undefined {
    return this.peers.get(peerId);
  }

  /** List all known peers. */
  listPeers(): FederationPeer[] {
    return Array.from(this.peers.values());
  }

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  /**
   * Synchronize DNS records with a single peer.
   * Sends all local records and receives the peer's records.
   * Returns the count of records received and sent.
   */
  async syncWithPeer(peerId: string): Promise<{ received: number; sent: number }> {
    const peer = this.peers.get(peerId);
    if (!peer) return { received: 0, sent: 0 };

    peer.status = 'syncing';

    // Gather local records to share
    const localRecords = this.config.shareCapabilities
      ? this.agentDNS.getAllRecords().filter((r) => r.expiresAt > Date.now())
      : [];

    const syncMsg = this.createMessage('sync-request', peerId, {
      records: localRecords,
      peerId: this.config.peerId,
      peerName: this.config.peerName,
    });

    const response = await this.sendToPeer(peer.url, syncMsg);

    if (!response || response.type === 'error') {
      peer.status = 'error';
      return { received: 0, sent: localRecords.length };
    }

    let received = 0;

    // Merge received records (only from trusted peers)
    if (
      this.config.acceptRemoteAgents &&
      peer.trustLevel !== 'untrusted' &&
      response.type === 'sync-response' &&
      Array.isArray(response.payload.records)
    ) {
      const remoteRecords = response.payload.records as AgentDNSRecord[];
      for (const record of remoteRecords) {
        // Don't overwrite local records
        const existing = this.agentDNS.getRecord(record.agentId);
        if (!existing) {
          try {
            this.agentDNS.register({
              agentId: record.agentId,
              domain: record.domain,
              endpoints: record.endpoints,
              capabilities: record.capabilities,
              ttl: record.ttl,
              priority: record.priority,
              weight: record.weight,
              metadata: {
                ...record.metadata,
                _federatedFrom: peer.id,
                _federatedAt: Date.now(),
              },
            });
            received++;
          } catch {
            // Max records or other error — skip this record
          }
        } else if (existing.metadata?._federatedFrom === peer.id) {
          // Update records that we previously received from this same peer
          this.agentDNS.update(record.agentId, {
            endpoints: record.endpoints,
            capabilities: record.capabilities,
            ttl: record.ttl,
            priority: record.priority,
            weight: record.weight,
            metadata: {
              ...record.metadata,
              _federatedFrom: peer.id,
              _federatedAt: Date.now(),
            },
          });
          received++;
        }
      }
    }

    // Update peer state
    peer.status = 'connected';
    peer.lastSync = Date.now();
    if (response.payload.capabilities && Array.isArray(response.payload.capabilities)) {
      peer.sharedCapabilities = response.payload.capabilities as string[];
    }

    this.totalSynced += received;
    this.lastSyncAt = Date.now();

    this.emit('cadp:peer:synced' satisfies CADPEventType, {
      peerId: peer.id,
      received,
      sent: localRecords.length,
    });

    return { received, sent: localRecords.length };
  }

  /** Sync with all connected peers. */
  async syncAll(): Promise<Map<string, { received: number; sent: number }>> {
    const results = new Map<string, { received: number; sent: number }>();

    await Promise.all(
      Array.from(this.peers.keys()).map(async (peerId) => {
        const result = await this.syncWithPeer(peerId);
        results.set(peerId, result);
      }),
    );

    return results;
  }

  /**
   * Announce a specific agent record to all connected peers.
   * Returns the number of peers successfully notified.
   */
  async announceAgent(record: AgentDNSRecord): Promise<number> {
    if (!this.config.shareCapabilities) return 0;

    const msg = this.createMessage('announce', undefined, {
      record,
      peerId: this.config.peerId,
    });

    let notified = 0;
    await Promise.all(
      Array.from(this.peers.values())
        .filter((p) => p.status === 'connected')
        .map(async (peer) => {
          const response = await this.sendToPeer(peer.url, msg);
          if (response && response.type !== 'error') {
            notified++;
          }
        }),
    );

    return notified;
  }

  // ---------------------------------------------------------------------------
  // Request handling (when a peer sends us a message)
  // ---------------------------------------------------------------------------

  /**
   * Handle an incoming CADP message from a peer.
   * Returns a response message, or null if no response is needed.
   */
  async handleMessage(message: CADPMessage): Promise<CADPMessage | null> {
    switch (message.type) {
      case 'health-check':
        return this.createMessage('health-response', message.source, {
          peerId: this.config.peerId,
          peerName: this.config.peerName,
          capabilities: this.getLocalCapabilities(),
          status: 'ok',
        });

      case 'sync-request': {
        const localRecords = this.config.shareCapabilities
          ? this.agentDNS.getAllRecords().filter((r) => r.expiresAt > Date.now())
          : [];

        // Merge received records if we accept them
        if (
          this.config.acceptRemoteAgents &&
          Array.isArray(message.payload.records)
        ) {
          const sourcePeerId = (message.payload.peerId as string) || message.source;
          const peer = this.findPeerBySourceId(sourcePeerId);
          const trustLevel = peer?.trustLevel ?? 'untrusted';

          if (trustLevel !== 'untrusted') {
            const remoteRecords = message.payload.records as AgentDNSRecord[];
            for (const record of remoteRecords) {
              const existing = this.agentDNS.getRecord(record.agentId);
              if (!existing) {
                try {
                  this.agentDNS.register({
                    agentId: record.agentId,
                    domain: record.domain,
                    endpoints: record.endpoints,
                    capabilities: record.capabilities,
                    ttl: record.ttl,
                    priority: record.priority,
                    weight: record.weight,
                    metadata: {
                      ...record.metadata,
                      _federatedFrom: sourcePeerId,
                      _federatedAt: Date.now(),
                    },
                  });
                } catch {
                  // Skip on error
                }
              }
            }
          }
        }

        return this.createMessage('sync-response', message.source, {
          records: localRecords,
          peerId: this.config.peerId,
          peerName: this.config.peerName,
          capabilities: this.getLocalCapabilities(),
        });
      }

      case 'lookup': {
        const agentId = message.payload.agentId as string;
        const record = agentId ? this.agentDNS.lookup(agentId) : null;
        return this.createMessage('lookup-response', message.source, {
          agentId,
          record: record ?? null,
          found: record !== null,
        });
      }

      case 'announce': {
        const record = message.payload.record as AgentDNSRecord | undefined;
        if (record && this.config.acceptRemoteAgents) {
          const sourcePeerId = (message.payload.peerId as string) || message.source;
          const peer = this.findPeerBySourceId(sourcePeerId);
          const trustLevel = peer?.trustLevel ?? 'untrusted';

          if (trustLevel !== 'untrusted') {
            const existing = this.agentDNS.getRecord(record.agentId);
            if (!existing) {
              try {
                this.agentDNS.register({
                  agentId: record.agentId,
                  domain: record.domain,
                  endpoints: record.endpoints,
                  capabilities: record.capabilities,
                  ttl: record.ttl,
                  priority: record.priority,
                  weight: record.weight,
                  metadata: {
                    ...record.metadata,
                    _federatedFrom: sourcePeerId,
                    _federatedAt: Date.now(),
                  },
                });
              } catch {
                // Skip
              }
            }
          }
        }
        // No response needed for announcements, but send ack
        return this.createMessage('health-response', message.source, {
          status: 'ack',
        });
      }

      default:
        return this.createMessage('error', message.source, {
          error: `Unknown message type: ${message.type}`,
          originalMessageId: message.id,
        });
    }
  }

  // ---------------------------------------------------------------------------
  // Federated lookup: ask peers if we don't have the record
  // ---------------------------------------------------------------------------

  /**
   * Look up an agent across all connected peers.
   * Returns the first successful response, or null if no peer has the agent.
   */
  async federatedLookup(agentId: string): Promise<AgentDNSRecord | null> {
    // Check locally first
    const local = this.agentDNS.lookup(agentId);
    if (local) return local;

    const msg = this.createMessage('lookup', undefined, { agentId });

    // Race all peers — first response with a record wins
    const connectedPeers = Array.from(this.peers.values()).filter(
      (p) => p.status === 'connected',
    );

    if (connectedPeers.length === 0) return null;

    const results = await Promise.allSettled(
      connectedPeers.map(async (peer) => {
        const response = await this.sendToPeer(peer.url, msg);
        if (
          response &&
          response.type === 'lookup-response' &&
          response.payload.found === true &&
          response.payload.record
        ) {
          return response.payload.record as AgentDNSRecord;
        }
        return null;
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        // Cache the result locally
        const record = result.value;
        const existing = this.agentDNS.getRecord(record.agentId);
        if (!existing) {
          try {
            this.agentDNS.register({
              agentId: record.agentId,
              domain: record.domain,
              endpoints: record.endpoints,
              capabilities: record.capabilities,
              ttl: Math.min(record.ttl, 300), // Cap TTL for federated records
              priority: record.priority,
              weight: record.weight,
              metadata: {
                ...record.metadata,
                _federatedLookup: true,
                _federatedAt: Date.now(),
              },
            });
          } catch {
            // Skip caching on error
          }
        }
        return record;
      }
    }

    return null;
  }

  /**
   * Search all connected peers for agents with a given capability.
   * Aggregates results from all peers.
   */
  async federatedSearch(capability: string): Promise<AgentDNSRecord[]> {
    // Check locally first
    const localResults = this.agentDNS.lookupByCapability(capability);

    const msg = this.createMessage('lookup', undefined, {
      capability,
      searchMode: 'capability',
    });

    const connectedPeers = Array.from(this.peers.values()).filter(
      (p) => p.status === 'connected',
    );

    const allRecords = new Map<string, AgentDNSRecord>();

    // Add local results
    for (const record of localResults) {
      allRecords.set(record.agentId, record);
    }

    if (connectedPeers.length > 0) {
      const results = await Promise.allSettled(
        connectedPeers.map(async (peer) => {
          const response = await this.sendToPeer(peer.url, msg);
          if (response && response.type === 'lookup-response') {
            if (Array.isArray(response.payload.records)) {
              return response.payload.records as AgentDNSRecord[];
            }
            if (response.payload.record) {
              return [response.payload.record as AgentDNSRecord];
            }
          }
          return [];
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const record of result.value) {
            if (!allRecords.has(record.agentId)) {
              allRecords.set(record.agentId, record);
            }
          }
        }
      }
    }

    return Array.from(allRecords.values()).sort((a, b) => a.priority - b.priority);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start periodic sync with all peers. */
  startSync(): void {
    if (this.syncInterval) return;
    this.syncInterval = setInterval(() => {
      this.syncAll().catch(() => {
        // Swallow sync errors; individual peer errors are handled in syncWithPeer
      });
    }, this.config.syncIntervalMs);
    // Allow the process to exit even if the interval is running
    if (this.syncInterval && typeof this.syncInterval === 'object' && 'unref' in this.syncInterval) {
      this.syncInterval.unref();
    }
  }

  /** Stop periodic sync. */
  stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /** Stop sync and clean up all resources. */
  destroy(): void {
    this.stopSync();
    this.peers.clear();
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats(): {
    totalPeers: number;
    connectedPeers: number;
    lastSyncAt?: number;
    totalSynced: number;
  } {
    let connected = 0;
    for (const peer of this.peers.values()) {
      if (peer.status === 'connected') connected++;
    }
    return {
      totalPeers: this.peers.size,
      connectedPeers: connected,
      lastSyncAt: this.lastSyncAt,
      totalSynced: this.totalSynced,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Create a CADP protocol message. */
  private createMessage(
    type: CADPMessageType,
    destination: string | undefined,
    payload: Record<string, unknown>,
  ): CADPMessage {
    return {
      type,
      id: `msg_${randomUUID().slice(0, 12)}`,
      source: this.config.peerId,
      destination,
      payload,
      timestamp: Date.now(),
    };
  }

  /**
   * Send a CADP message to a peer endpoint via HTTP POST.
   * Returns the response message, or null on failure.
   */
  private async sendToPeer(peerUrl: string, message: CADPMessage): Promise<CADPMessage | null> {
    const url = `${peerUrl.replace(/\/+$/, '')}/cadp`;
    const timeoutMs = 10_000;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) return null;

      const body = (await response.json()) as CADPMessage;
      return body;
    } catch {
      return null;
    }
  }

  /** Collect all unique capabilities from local DNS records. */
  private getLocalCapabilities(): string[] {
    const caps = new Set<string>();
    for (const record of this.agentDNS.getAllRecords()) {
      if (record.expiresAt > Date.now()) {
        for (const cap of record.capabilities) {
          caps.add(cap);
        }
      }
    }
    return Array.from(caps);
  }

  /** Find a peer by their source/peer ID (which might differ from our map key). */
  private findPeerBySourceId(sourceId: string): FederationPeer | undefined {
    // First, direct lookup
    const direct = this.peers.get(sourceId);
    if (direct) return direct;

    // Fallback: search by peer ID match
    for (const peer of this.peers.values()) {
      if (peer.id === sourceId) return peer;
    }
    return undefined;
  }
}
