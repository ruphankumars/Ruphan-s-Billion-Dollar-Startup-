import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentDNS } from '../../../src/protocol/agent-dns.js';
import type { AgentDNSRecord, AgentEndpoint } from '../../../src/protocol/types.js';

/** Helper to build a minimal valid DNS record input (without createdAt/expiresAt). */
function makeRecord(overrides: Partial<AgentDNSRecord> = {}): Omit<AgentDNSRecord, 'createdAt' | 'expiresAt'> {
  return {
    agentId: overrides.agentId ?? `agent_${Math.random().toString(36).slice(2, 8)}`,
    domain: overrides.domain ?? 'agents.example.com',
    endpoints: overrides.endpoints ?? [
      { protocol: 'a2a', url: 'https://a.example.com/agent', healthy: true, latencyMs: 10 },
    ],
    capabilities: overrides.capabilities ?? ['code-gen'],
    ttl: overrides.ttl ?? 3600,
    priority: overrides.priority ?? 10,
    weight: overrides.weight ?? 100,
    metadata: overrides.metadata,
  };
}

describe('AgentDNS', () => {
  let dns: AgentDNS;

  beforeEach(() => {
    dns = new AgentDNS();
  });

  afterEach(() => {
    dns.destroy();
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates an instance with default options', () => {
      expect(dns).toBeInstanceOf(AgentDNS);
      expect(dns.getAllRecords()).toEqual([]);
    });

    it('accepts custom options', () => {
      const custom = new AgentDNS({ defaultTTL: 120, maxRecords: 5, cleanupIntervalMs: 1000 });
      expect(custom).toBeInstanceOf(AgentDNS);
      custom.destroy();
    });

    it('uses default TTL of 3600 when not specified', () => {
      const record = dns.register(makeRecord({ ttl: 0 }));
      // When ttl <= 0 the default TTL is used
      expect(record.ttl).toBe(3600);
    });
  });

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  describe('register()', () => {
    it('registers a record and returns it with createdAt/expiresAt', () => {
      const input = makeRecord({ agentId: 'agent-1' });
      const record = dns.register(input);

      expect(record.agentId).toBe('agent-1');
      expect(record.createdAt).toBeGreaterThan(0);
      expect(record.expiresAt).toBe(record.createdAt + record.ttl * 1000);
    });

    it('emits cadp:agent:registered event', () => {
      const spy = vi.fn();
      dns.on('cadp:agent:registered', spy);

      const record = dns.register(makeRecord({ agentId: 'agent-ev' }));

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(record);
    });

    it('overwrites an existing record with the same agentId', () => {
      dns.register(makeRecord({ agentId: 'agent-dup', priority: 5 }));
      const updated = dns.register(makeRecord({ agentId: 'agent-dup', priority: 99 }));

      expect(updated.priority).toBe(99);
      expect(dns.getAllRecords()).toHaveLength(1);
    });

    it('uses default TTL when ttl is 0 or negative', () => {
      const r1 = dns.register(makeRecord({ ttl: 0 }));
      expect(r1.ttl).toBe(3600);

      const r2 = dns.register(makeRecord({ ttl: -10 }));
      expect(r2.ttl).toBe(3600);
    });

    it('throws when maxRecords limit is reached', () => {
      const small = new AgentDNS({ maxRecords: 2 });
      small.register(makeRecord({ agentId: 'a1' }));
      small.register(makeRecord({ agentId: 'a2' }));

      expect(() => small.register(makeRecord({ agentId: 'a3' }))).toThrow(/max records limit/i);
      small.destroy();
    });

    it('purges expired records before rejecting at max limit', () => {
      const small = new AgentDNS({ maxRecords: 2, defaultTTL: 1 });
      // Register with TTL of 1 second
      small.register(makeRecord({ agentId: 'exp1', ttl: 1 }));
      small.register(makeRecord({ agentId: 'exp2', ttl: 1 }));

      // Fast-forward time so records expire
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);

      // Should succeed because expired records are purged
      expect(() => small.register(makeRecord({ agentId: 'new1' }))).not.toThrow();

      vi.useRealTimers();
      small.destroy();
    });

    it('indexes by domain on registration', () => {
      dns.register(makeRecord({ agentId: 'a1', domain: 'dom-a.io' }));
      dns.register(makeRecord({ agentId: 'a2', domain: 'dom-a.io' }));

      const results = dns.lookupByDomain('dom-a.io');
      expect(results).toHaveLength(2);
    });

    it('indexes by capability on registration', () => {
      dns.register(makeRecord({ agentId: 'a1', capabilities: ['cap-x', 'cap-y'] }));
      dns.register(makeRecord({ agentId: 'a2', capabilities: ['cap-y'] }));

      expect(dns.lookupByCapability('cap-x')).toHaveLength(1);
      expect(dns.lookupByCapability('cap-y')).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Deregistration
  // ---------------------------------------------------------------------------

  describe('deregister()', () => {
    it('removes an existing record and returns true', () => {
      dns.register(makeRecord({ agentId: 'del-me' }));
      expect(dns.deregister('del-me')).toBe(true);
      expect(dns.getRecord('del-me')).toBeNull();
    });

    it('returns false for a non-existent agent', () => {
      expect(dns.deregister('no-such-agent')).toBe(false);
    });

    it('emits cadp:agent:deregistered event', () => {
      const spy = vi.fn();
      dns.on('cadp:agent:deregistered', spy);

      dns.register(makeRecord({ agentId: 'ev-del' }));
      dns.deregister('ev-del');

      expect(spy).toHaveBeenCalledWith({ agentId: 'ev-del' });
    });

    it('removes from domain index', () => {
      dns.register(makeRecord({ agentId: 'only-agent', domain: 'sole.io' }));
      dns.deregister('only-agent');

      expect(dns.lookupByDomain('sole.io')).toEqual([]);
    });

    it('removes from capability index', () => {
      dns.register(makeRecord({ agentId: 'cap-agent', capabilities: ['special'] }));
      dns.deregister('cap-agent');

      expect(dns.lookupByCapability('special')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  describe('update()', () => {
    it('partially updates an existing record', () => {
      dns.register(makeRecord({ agentId: 'upd-1', priority: 5 }));
      const updated = dns.update('upd-1', { priority: 99 });

      expect(updated).not.toBeNull();
      expect(updated!.priority).toBe(99);
    });

    it('returns null for a non-existent agent', () => {
      expect(dns.update('ghost', { priority: 1 })).toBeNull();
    });

    it('preserves agentId even if overrides try to change it', () => {
      dns.register(makeRecord({ agentId: 'immutable-id' }));
      const updated = dns.update('immutable-id', { agentId: 'hacked' } as any);

      expect(updated!.agentId).toBe('immutable-id');
    });

    it('preserves original createdAt', () => {
      const original = dns.register(makeRecord({ agentId: 'time-test' }));
      const updated = dns.update('time-test', { priority: 42 });

      expect(updated!.createdAt).toBe(original.createdAt);
    });

    it('recomputes expiresAt when TTL changes', () => {
      const original = dns.register(makeRecord({ agentId: 'ttl-upd', ttl: 3600 }));
      const updated = dns.update('ttl-upd', { ttl: 60 });

      expect(updated!.expiresAt).toBe(original.createdAt + 60 * 1000);
    });

    it('re-indexes after domain change', () => {
      dns.register(makeRecord({ agentId: 'move-dom', domain: 'old.io' }));
      dns.update('move-dom', { domain: 'new.io' });

      expect(dns.lookupByDomain('old.io')).toHaveLength(0);
      expect(dns.lookupByDomain('new.io')).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------

  describe('lookup()', () => {
    it('returns a valid non-expired record', () => {
      dns.register(makeRecord({ agentId: 'look-1' }));
      const result = dns.lookup('look-1');
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('look-1');
    });

    it('returns null for a non-existent agent', () => {
      expect(dns.lookup('does-not-exist')).toBeNull();
    });

    it('returns null for an expired record', () => {
      vi.useFakeTimers();
      dns.register(makeRecord({ agentId: 'expired', ttl: 1 }));
      vi.advanceTimersByTime(2000);

      expect(dns.lookup('expired')).toBeNull();
      vi.useRealTimers();
    });

    it('emits cadp:lookup:hit on success', () => {
      const spy = vi.fn();
      dns.on('cadp:lookup:hit', spy);

      dns.register(makeRecord({ agentId: 'hit-test' }));
      dns.lookup('hit-test');

      expect(spy).toHaveBeenCalledWith({ agentId: 'hit-test' });
    });

    it('emits cadp:lookup:miss on failure', () => {
      const spy = vi.fn();
      dns.on('cadp:lookup:miss', spy);

      dns.lookup('miss-agent');

      expect(spy).toHaveBeenCalledWith({ agentId: 'miss-agent' });
    });
  });

  describe('lookupByDomain()', () => {
    it('returns all non-expired records for a domain', () => {
      dns.register(makeRecord({ agentId: 'da1', domain: 'dom.io', priority: 2 }));
      dns.register(makeRecord({ agentId: 'da2', domain: 'dom.io', priority: 1 }));
      dns.register(makeRecord({ agentId: 'other', domain: 'other.io' }));

      const results = dns.lookupByDomain('dom.io');
      expect(results).toHaveLength(2);
      // Sorted by priority (lower first)
      expect(results[0].agentId).toBe('da2');
    });

    it('returns empty array for unknown domain', () => {
      expect(dns.lookupByDomain('unknown.io')).toEqual([]);
    });

    it('excludes expired records', () => {
      vi.useFakeTimers();
      dns.register(makeRecord({ agentId: 'exp-dom', domain: 'exp.io', ttl: 1 }));
      vi.advanceTimersByTime(2000);

      expect(dns.lookupByDomain('exp.io')).toHaveLength(0);
      vi.useRealTimers();
    });
  });

  describe('lookupByCapability()', () => {
    it('returns all records with a given capability', () => {
      dns.register(makeRecord({ agentId: 'ca1', capabilities: ['nlp', 'vision'] }));
      dns.register(makeRecord({ agentId: 'ca2', capabilities: ['nlp'] }));
      dns.register(makeRecord({ agentId: 'ca3', capabilities: ['code'] }));

      expect(dns.lookupByCapability('nlp')).toHaveLength(2);
      expect(dns.lookupByCapability('code')).toHaveLength(1);
      expect(dns.lookupByCapability('nonexistent')).toEqual([]);
    });

    it('sorts by priority ascending', () => {
      dns.register(makeRecord({ agentId: 'lo1', capabilities: ['x'], priority: 50 }));
      dns.register(makeRecord({ agentId: 'lo2', capabilities: ['x'], priority: 5 }));

      const results = dns.lookupByCapability('x');
      expect(results[0].priority).toBe(5);
    });
  });

  describe('reverseLookup()', () => {
    it('finds a record by endpoint URL', () => {
      dns.register(makeRecord({
        agentId: 'rev-1',
        endpoints: [{ protocol: 'rest', url: 'https://unique.url/api', healthy: true }],
      }));

      const result = dns.reverseLookup('https://unique.url/api');
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('rev-1');
    });

    it('returns null when no endpoint matches', () => {
      expect(dns.reverseLookup('https://nothing.here')).toBeNull();
    });

    it('skips expired records', () => {
      vi.useFakeTimers();
      dns.register(makeRecord({
        agentId: 'rev-exp',
        ttl: 1,
        endpoints: [{ protocol: 'rest', url: 'https://expired.url/api', healthy: true }],
      }));
      vi.advanceTimersByTime(2000);

      expect(dns.reverseLookup('https://expired.url/api')).toBeNull();
      vi.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // Resolve
  // ---------------------------------------------------------------------------

  describe('resolve()', () => {
    it('returns the best healthy endpoint for an agent', () => {
      dns.register(makeRecord({
        agentId: 'res-1',
        endpoints: [
          { protocol: 'a2a', url: 'https://slow.url', healthy: true, latencyMs: 200 },
          { protocol: 'rest', url: 'https://fast.url', healthy: true, latencyMs: 10 },
        ],
      }));

      const ep = dns.resolve('res-1');
      expect(ep).not.toBeNull();
      expect(ep!.url).toBe('https://fast.url');
    });

    it('returns null if no endpoints are healthy', () => {
      dns.register(makeRecord({
        agentId: 'unhealthy',
        endpoints: [{ protocol: 'rest', url: 'https://down.url', healthy: false }],
      }));

      expect(dns.resolve('unhealthy')).toBeNull();
    });

    it('returns null for a non-existent agent', () => {
      expect(dns.resolve('ghost-agent')).toBeNull();
    });

    it('prefers the specified protocol when available', () => {
      dns.register(makeRecord({
        agentId: 'proto',
        endpoints: [
          { protocol: 'rest', url: 'https://rest.url', healthy: true, latencyMs: 5 },
          { protocol: 'grpc', url: 'https://grpc.url', healthy: true, latencyMs: 50 },
        ],
      }));

      const ep = dns.resolve('proto', 'grpc');
      expect(ep!.protocol).toBe('grpc');
    });

    it('falls back when preferred protocol has no healthy endpoints', () => {
      dns.register(makeRecord({
        agentId: 'fallback',
        endpoints: [
          { protocol: 'rest', url: 'https://rest.url', healthy: true, latencyMs: 5 },
          { protocol: 'grpc', url: 'https://grpc.url', healthy: false, latencyMs: 1 },
        ],
      }));

      const ep = dns.resolve('fallback', 'grpc');
      expect(ep!.protocol).toBe('rest');
    });
  });

  describe('resolveAll()', () => {
    it('returns all healthy endpoints for a capability sorted by latency', () => {
      dns.register(makeRecord({
        agentId: 'ra1',
        capabilities: ['search'],
        endpoints: [
          { protocol: 'rest', url: 'https://a.url', healthy: true, latencyMs: 100 },
          { protocol: 'rest', url: 'https://b.url', healthy: false, latencyMs: 1 },
        ],
      }));
      dns.register(makeRecord({
        agentId: 'ra2',
        capabilities: ['search'],
        endpoints: [
          { protocol: 'a2a', url: 'https://c.url', healthy: true, latencyMs: 5 },
        ],
      }));

      const eps = dns.resolveAll('search');
      expect(eps).toHaveLength(2);
      expect(eps[0].latencyMs).toBeLessThanOrEqual(eps[1].latencyMs!);
    });

    it('returns empty array for unknown capability', () => {
      expect(dns.resolveAll('nonexistent')).toEqual([]);
    });

    it('puts endpoints without latency last', () => {
      dns.register(makeRecord({
        agentId: 'no-lat',
        capabilities: ['sort-test'],
        endpoints: [
          { protocol: 'rest', url: 'https://no-lat.url', healthy: true },
          { protocol: 'rest', url: 'https://has-lat.url', healthy: true, latencyMs: 50 },
        ],
      }));

      const eps = dns.resolveAll('sort-test');
      expect(eps[0].url).toBe('https://has-lat.url');
    });
  });

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  describe('checkHealth()', () => {
    beforeEach(() => {
      // Mock global fetch
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns false for a non-existent agent', async () => {
      expect(await dns.checkHealth('ghost')).toBe(false);
    });

    it('returns true when at least one endpoint responds healthy', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
      });

      dns.register(makeRecord({
        agentId: 'health-1',
        endpoints: [{ protocol: 'rest', url: 'https://h.url', healthy: false }],
      }));

      const healthy = await dns.checkHealth('health-1');
      expect(healthy).toBe(true);
    });

    it('marks endpoints as unhealthy when probe fails', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      dns.register(makeRecord({
        agentId: 'health-fail',
        endpoints: [{ protocol: 'rest', url: 'https://fail.url', healthy: true }],
      }));

      const healthy = await dns.checkHealth('health-fail');
      expect(healthy).toBe(false);
    });

    it('emits cadp:health:check event', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const spy = vi.fn();
      dns.on('cadp:health:check', spy);

      dns.register(makeRecord({ agentId: 'hc-ev' }));
      await dns.checkHealth('hc-ev');

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'hc-ev' }));
    });

    it('updates latencyMs on successful probe', async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      dns.register(makeRecord({
        agentId: 'lat-check',
        endpoints: [{ protocol: 'rest', url: 'https://lat.url', healthy: true }],
      }));

      await dns.checkHealth('lat-check');
      const record = dns.getRecord('lat-check')!;
      expect(record.endpoints[0].latencyMs).toBeDefined();
      expect(record.endpoints[0].lastHealthCheck).toBeGreaterThan(0);
    });
  });

  describe('checkAllHealth()', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('checks all registered agents', async () => {
      dns.register(makeRecord({ agentId: 'all-1' }));
      dns.register(makeRecord({ agentId: 'all-2' }));

      const results = await dns.checkAllHealth();
      expect(results.size).toBe(2);
      expect(results.get('all-1')).toBe(true);
      expect(results.get('all-2')).toBe(true);
    });
  });

  describe('markHealthy() / markUnhealthy()', () => {
    it('marks an endpoint as healthy', () => {
      dns.register(makeRecord({
        agentId: 'mark-h',
        endpoints: [{ protocol: 'rest', url: 'https://mark.url', healthy: false }],
      }));

      dns.markHealthy('mark-h', 'https://mark.url');
      const record = dns.getRecord('mark-h')!;
      expect(record.endpoints[0].healthy).toBe(true);
    });

    it('marks an endpoint as unhealthy', () => {
      dns.register(makeRecord({
        agentId: 'mark-u',
        endpoints: [{ protocol: 'rest', url: 'https://mark-u.url', healthy: true }],
      }));

      dns.markUnhealthy('mark-u', 'https://mark-u.url');
      const record = dns.getRecord('mark-u')!;
      expect(record.endpoints[0].healthy).toBe(false);
    });

    it('does nothing for non-existent agent', () => {
      expect(() => dns.markHealthy('nope', 'https://x.url')).not.toThrow();
      expect(() => dns.markUnhealthy('nope', 'https://x.url')).not.toThrow();
    });

    it('does nothing when endpoint URL does not match', () => {
      dns.register(makeRecord({
        agentId: 'mark-miss',
        endpoints: [{ protocol: 'rest', url: 'https://original.url', healthy: true }],
      }));

      dns.markUnhealthy('mark-miss', 'https://wrong.url');
      const record = dns.getRecord('mark-miss')!;
      expect(record.endpoints[0].healthy).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache management
  // ---------------------------------------------------------------------------

  describe('getRecord() / getAllRecords()', () => {
    it('getRecord returns a record including expired', () => {
      vi.useFakeTimers();
      dns.register(makeRecord({ agentId: 'get-exp', ttl: 1 }));
      vi.advanceTimersByTime(2000);

      // getRecord returns even expired records
      expect(dns.getRecord('get-exp')).not.toBeNull();
      vi.useRealTimers();
    });

    it('getRecord returns null for unknown agent', () => {
      expect(dns.getRecord('unknown')).toBeNull();
    });

    it('getAllRecords returns all records', () => {
      dns.register(makeRecord({ agentId: 'ar1' }));
      dns.register(makeRecord({ agentId: 'ar2' }));

      expect(dns.getAllRecords()).toHaveLength(2);
    });
  });

  describe('getExpiredRecords()', () => {
    it('returns only expired records', () => {
      vi.useFakeTimers();
      dns.register(makeRecord({ agentId: 'fresh', ttl: 9999 }));
      dns.register(makeRecord({ agentId: 'stale', ttl: 1 }));
      vi.advanceTimersByTime(2000);

      const expired = dns.getExpiredRecords();
      expect(expired).toHaveLength(1);
      expect(expired[0].agentId).toBe('stale');
      vi.useRealTimers();
    });
  });

  describe('purgeExpired()', () => {
    it('removes expired records and returns count', () => {
      vi.useFakeTimers();
      dns.register(makeRecord({ agentId: 'p1', ttl: 1 }));
      dns.register(makeRecord({ agentId: 'p2', ttl: 1 }));
      dns.register(makeRecord({ agentId: 'p3', ttl: 9999 }));
      vi.advanceTimersByTime(2000);

      const purged = dns.purgeExpired();
      expect(purged).toBe(2);
      expect(dns.getAllRecords()).toHaveLength(1);
      vi.useRealTimers();
    });

    it('returns 0 when nothing is expired', () => {
      dns.register(makeRecord({ agentId: 'fresh' }));
      expect(dns.purgeExpired()).toBe(0);
    });
  });

  describe('clear()', () => {
    it('removes all records and indexes', () => {
      dns.register(makeRecord({ agentId: 'c1', domain: 'd.io', capabilities: ['x'] }));
      dns.register(makeRecord({ agentId: 'c2', domain: 'd.io', capabilities: ['x'] }));
      dns.clear();

      expect(dns.getAllRecords()).toHaveLength(0);
      expect(dns.lookupByDomain('d.io')).toEqual([]);
      expect(dns.lookupByCapability('x')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  describe('getStats()', () => {
    it('returns correct stats initially', () => {
      const stats = dns.getStats();
      expect(stats).toEqual({
        totalRecords: 0,
        activeRecords: 0,
        expiredRecords: 0,
        domains: 0,
        capabilities: 0,
      });
    });

    it('counts active and expired records', () => {
      vi.useFakeTimers();
      dns.register(makeRecord({ agentId: 's1', domain: 'a.io', capabilities: ['ca'], ttl: 1 }));
      dns.register(makeRecord({ agentId: 's2', domain: 'b.io', capabilities: ['cb'], ttl: 9999 }));
      vi.advanceTimersByTime(2000);

      const stats = dns.getStats();
      expect(stats.totalRecords).toBe(2);
      expect(stats.activeRecords).toBe(1);
      expect(stats.expiredRecords).toBe(1);
      expect(stats.domains).toBe(2);
      expect(stats.capabilities).toBe(2);
      vi.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('startCleanup() / stopCleanup()', () => {
    it('starts and stops periodic cleanup without error', () => {
      dns.startCleanup();
      // Calling start again should be a no-op
      dns.startCleanup();
      dns.stopCleanup();
      // Calling stop again should be a no-op
      dns.stopCleanup();
    });

    it('periodic cleanup purges expired records', () => {
      vi.useFakeTimers();
      const fast = new AgentDNS({ cleanupIntervalMs: 100, defaultTTL: 1 });
      fast.register(makeRecord({ agentId: 'timer-1', ttl: 1 }));
      fast.startCleanup();

      vi.advanceTimersByTime(2000);

      expect(fast.getAllRecords()).toHaveLength(0);

      fast.destroy();
      vi.useRealTimers();
    });
  });

  describe('destroy()', () => {
    it('clears everything and removes listeners', () => {
      const spy = vi.fn();
      dns.on('cadp:agent:registered', spy);

      dns.register(makeRecord({ agentId: 'd1' }));
      dns.startCleanup();
      dns.destroy();

      expect(dns.getAllRecords()).toHaveLength(0);
      // After destroy, emitting should not call old listeners
      expect(dns.listenerCount('cadp:agent:registered')).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Stress tests
  // ---------------------------------------------------------------------------

  describe('stress tests', () => {
    it('handles registering 1000 agents', () => {
      const large = new AgentDNS({ maxRecords: 10_000 });

      for (let i = 0; i < 1000; i++) {
        large.register(makeRecord({ agentId: `stress-${i}`, capabilities: [`cap-${i % 10}`] }));
      }

      expect(large.getAllRecords()).toHaveLength(1000);
      expect(large.lookupByCapability('cap-0')).toHaveLength(100);

      large.destroy();
    });

    it('handles rapid register/deregister cycles', () => {
      for (let i = 0; i < 500; i++) {
        dns.register(makeRecord({ agentId: `cycle-${i}` }));
        dns.deregister(`cycle-${i}`);
      }

      expect(dns.getAllRecords()).toHaveLength(0);
    });

    it('handles many lookups on a populated registry', () => {
      for (let i = 0; i < 200; i++) {
        dns.register(makeRecord({ agentId: `lookup-stress-${i}`, domain: `d${i % 5}.io` }));
      }

      for (let i = 0; i < 200; i++) {
        const result = dns.lookup(`lookup-stress-${i}`);
        expect(result).not.toBeNull();
      }

      expect(dns.lookupByDomain('d0.io')).toHaveLength(40);
    });

    it('handles concurrent health checks', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      for (let i = 0; i < 50; i++) {
        dns.register(makeRecord({ agentId: `conc-${i}` }));
      }

      const results = await dns.checkAllHealth();
      expect(results.size).toBe(50);

      vi.unstubAllGlobals();
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty capabilities array', () => {
      dns.register(makeRecord({ agentId: 'no-caps', capabilities: [] }));
      expect(dns.lookup('no-caps')).not.toBeNull();
    });

    it('handles empty endpoints array', () => {
      dns.register(makeRecord({ agentId: 'no-eps', endpoints: [] }));
      expect(dns.resolve('no-eps')).toBeNull();
    });

    it('handles agents with many capabilities', () => {
      const caps = Array.from({ length: 100 }, (_, i) => `cap-${i}`);
      dns.register(makeRecord({ agentId: 'many-caps', capabilities: caps }));

      for (const cap of caps) {
        expect(dns.lookupByCapability(cap)).toHaveLength(1);
      }
    });

    it('handles agents with many endpoints', () => {
      const endpoints: AgentEndpoint[] = Array.from({ length: 50 }, (_, i) => ({
        protocol: 'rest' as const,
        url: `https://ep-${i}.url`,
        healthy: i % 2 === 0,
        latencyMs: i * 10,
      }));

      dns.register(makeRecord({ agentId: 'many-eps', endpoints }));
      const best = dns.resolve('many-eps');
      expect(best).not.toBeNull();
      expect(best!.healthy).toBe(true);
    });

    it('handles metadata with nested objects', () => {
      dns.register(makeRecord({
        agentId: 'meta',
        metadata: { deep: { nested: { value: 42 } }, tags: ['a', 'b'] },
      }));

      const record = dns.getRecord('meta');
      expect(record!.metadata!.deep).toEqual({ nested: { value: 42 } });
    });
  });
});
