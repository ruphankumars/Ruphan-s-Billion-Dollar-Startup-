import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FederationManager } from '../../../src/protocol/federation.js';
import { AgentDNS } from '../../../src/protocol/agent-dns.js';
import type { AgentDNSRecord, CADPMessage, FederationPeer } from '../../../src/protocol/types.js';

/** Helper to build a minimal DNS record input. */
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

/** Helper to create a mock fetch that returns a CADP response message. */
function mockFetchResponse(responseMsg: Partial<CADPMessage>) {
  const msg: CADPMessage = {
    type: responseMsg.type ?? 'health-response',
    id: 'msg_test',
    source: 'remote-peer',
    destination: undefined,
    payload: responseMsg.payload ?? {},
    timestamp: Date.now(),
    ...responseMsg,
  };

  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(msg),
  });
}

describe('FederationManager', () => {
  let agentDNS: AgentDNS;
  let federation: FederationManager;

  beforeEach(() => {
    agentDNS = new AgentDNS();
    federation = new FederationManager(agentDNS, {
      peerId: 'test-peer',
      peerName: 'Test Peer',
      maxPeers: 10,
    });
  });

  afterEach(() => {
    federation.destroy();
    agentDNS.destroy();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates an instance with provided config', () => {
      expect(federation).toBeInstanceOf(FederationManager);
    });

    it('generates a peerId if not provided', () => {
      const auto = new FederationManager(agentDNS, {});
      const stats = auto.getStats();
      expect(stats.totalPeers).toBe(0);
      auto.destroy();
    });

    it('applies default config values', () => {
      const minimal = new FederationManager(agentDNS, {});
      expect(minimal.listPeers()).toEqual([]);
      minimal.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Peer management
  // ---------------------------------------------------------------------------

  describe('addPeer()', () => {
    it('adds a peer with successful handshake', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'health-response',
        payload: {
          peerId: 'remote-1',
          peerName: 'Remote One',
          capabilities: ['nlp', 'vision'],
          status: 'ok',
        },
      }));

      const peer = await federation.addPeer('https://remote.peer/cadp');
      expect(peer).not.toBeNull();
      expect(peer!.status).toBe('connected');
      expect(peer!.sharedCapabilities).toContain('nlp');
    });

    it('adds a disconnected peer when handshake fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const peer = await federation.addPeer('https://down.peer/cadp');
      expect(peer).not.toBeNull();
      expect(peer!.status).toBe('disconnected');
    });

    it('returns null when maxPeers is reached', async () => {
      const tiny = new FederationManager(agentDNS, { maxPeers: 1 });
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));

      await tiny.addPeer('https://peer1.io');
      const second = await tiny.addPeer('https://peer2.io');

      expect(second).toBeNull();
      tiny.destroy();
    });

    it('returns existing peer for duplicate URL', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));

      const first = await federation.addPeer('https://dup.peer/cadp');
      const second = await federation.addPeer('https://dup.peer/cadp');

      expect(second).toBe(first);
    });

    it('emits cadp:peer:connected event on successful connection', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));

      const spy = vi.fn();
      federation.on('cadp:peer:connected', spy);

      await federation.addPeer('https://ev.peer/cadp');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('applies specified trust level', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));

      const peer = await federation.addPeer('https://trusted.io', { trustLevel: 'full' });
      expect(peer!.trustLevel).toBe('full');
    });

    it('defaults to partial trust level', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));

      const peer = await federation.addPeer('https://default.io');
      expect(peer!.trustLevel).toBe('partial');
    });
  });

  describe('removePeer()', () => {
    it('removes an existing peer', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { peerId: 'rp1', status: 'ok' } }));

      const peer = await federation.addPeer('https://remove.io');
      expect(federation.removePeer(peer!.id)).toBe(true);
      expect(federation.listPeers()).toHaveLength(0);
    });

    it('returns false for non-existent peer', () => {
      expect(federation.removePeer('ghost')).toBe(false);
    });

    it('emits cadp:peer:disconnected event', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { peerId: 'rpe', status: 'ok' } }));

      const spy = vi.fn();
      federation.on('cadp:peer:disconnected', spy);

      const peer = await federation.addPeer('https://ev-rem.io');
      federation.removePeer(peer!.id);

      expect(spy).toHaveBeenCalledWith({ peerId: peer!.id });
    });
  });

  describe('getPeer() / listPeers()', () => {
    it('getPeer returns a peer by ID', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { peerId: 'gp1', status: 'ok' } }));

      const peer = await federation.addPeer('https://get.io');
      expect(federation.getPeer(peer!.id)).toBeDefined();
    });

    it('getPeer returns undefined for unknown ID', () => {
      expect(federation.getPeer('unknown')).toBeUndefined();
    });

    it('listPeers returns all peers', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));

      await federation.addPeer('https://p1.io');
      await federation.addPeer('https://p2.io');

      expect(federation.listPeers()).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  describe('syncWithPeer()', () => {
    it('returns zero counts for unknown peer', async () => {
      const result = await federation.syncWithPeer('unknown');
      expect(result).toEqual({ received: 0, sent: 0 });
    });

    it('sends local records and receives remote records', async () => {
      // Register a local record
      const localRecord = agentDNS.register(makeRecord({ agentId: 'local-agent' }));

      // Remote responds with its own records
      const remoteFetch = mockFetchResponse({
        type: 'sync-response',
        payload: {
          records: [
            {
              agentId: 'remote-agent',
              domain: 'remote.io',
              endpoints: [{ protocol: 'rest', url: 'https://r.io/api', healthy: true }],
              capabilities: ['remote-cap'],
              ttl: 3600,
              priority: 10,
              weight: 100,
              metadata: {},
              createdAt: Date.now(),
              expiresAt: Date.now() + 3600000,
            },
          ],
          capabilities: ['remote-cap'],
          peerId: 'remote-peer',
          peerName: 'Remote Peer',
        },
      });

      vi.stubGlobal('fetch', remoteFetch);

      // Add peer first (handshake)
      const handshakeFetch = mockFetchResponse({ type: 'health-response', payload: { peerId: 'sp1', status: 'ok' } });
      vi.stubGlobal('fetch', handshakeFetch);
      const peer = await federation.addPeer('https://sync.io');

      // Now sync
      vi.stubGlobal('fetch', remoteFetch);
      const result = await federation.syncWithPeer(peer!.id);

      expect(result.sent).toBeGreaterThanOrEqual(1);
      expect(result.received).toBe(1);

      // Remote agent should now be in local DNS
      const remote = agentDNS.getRecord('remote-agent');
      expect(remote).not.toBeNull();
      expect(remote!.metadata?._federatedFrom).toBe(peer!.id);
    });

    it('sets peer status to error when sync fails', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { peerId: 'err-p', status: 'ok' } }));
      const peer = await federation.addPeer('https://err.io');

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
      await federation.syncWithPeer(peer!.id);

      expect(federation.getPeer(peer!.id)!.status).toBe('error');
    });

    it('does not accept records from untrusted peers', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      const peer = await federation.addPeer('https://untrusted.io', { trustLevel: 'untrusted' });

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'sync-response',
        payload: {
          records: [{
            agentId: 'bad-agent',
            domain: 'evil.io',
            endpoints: [],
            capabilities: [],
            ttl: 3600,
            priority: 10,
            weight: 100,
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000,
          }],
          capabilities: [],
        },
      }));

      await federation.syncWithPeer(peer!.id);

      expect(agentDNS.getRecord('bad-agent')).toBeNull();
    });

    it('does not overwrite local records with remote ones', async () => {
      agentDNS.register(makeRecord({ agentId: 'existing-agent', priority: 1 }));

      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      const peer = await federation.addPeer('https://nooverwrite.io');

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'sync-response',
        payload: {
          records: [{
            agentId: 'existing-agent',
            domain: 'remote.io',
            endpoints: [],
            capabilities: [],
            ttl: 3600,
            priority: 99,
            weight: 100,
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000,
          }],
          capabilities: [],
        },
      }));

      await federation.syncWithPeer(peer!.id);

      // The local record should be unchanged
      expect(agentDNS.getRecord('existing-agent')!.priority).toBe(1);
    });

    it('emits cadp:peer:synced event', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { peerId: 'ev-sync', status: 'ok' } }));
      const peer = await federation.addPeer('https://sync-ev.io');

      const spy = vi.fn();
      federation.on('cadp:peer:synced', spy);

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'sync-response',
        payload: { records: [], capabilities: [] },
      }));

      await federation.syncWithPeer(peer!.id);

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ peerId: peer!.id }));
    });
  });

  describe('syncAll()', () => {
    it('syncs with all peers', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));

      await federation.addPeer('https://s1.io');
      await federation.addPeer('https://s2.io');

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'sync-response',
        payload: { records: [], capabilities: [] },
      }));

      const results = await federation.syncAll();
      expect(results.size).toBe(2);
    });
  });

  describe('announceAgent()', () => {
    it('announces an agent to all connected peers', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));

      await federation.addPeer('https://ann1.io');
      await federation.addPeer('https://ann2.io');

      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ack' } }));

      const record = agentDNS.register(makeRecord({ agentId: 'announced' }));
      const notified = await federation.announceAgent(record);

      expect(notified).toBe(2);
    });

    it('returns 0 when shareCapabilities is disabled', async () => {
      const noShare = new FederationManager(agentDNS, { shareCapabilities: false });
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      await noShare.addPeer('https://no-share.io');

      const record = agentDNS.register(makeRecord({ agentId: 'not-shared' }));
      const notified = await noShare.announceAgent(record);

      expect(notified).toBe(0);
      noShare.destroy();
    });

    it('skips disconnected peers', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

      await federation.addPeer('https://disc.io');

      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ack' } }));

      const record = agentDNS.register(makeRecord({ agentId: 'announce-disc' }));
      const notified = await federation.announceAgent(record);

      expect(notified).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  describe('handleMessage()', () => {
    it('handles health-check message', async () => {
      const msg: CADPMessage = {
        type: 'health-check',
        id: 'msg_hc',
        source: 'remote',
        payload: {},
        timestamp: Date.now(),
      };

      const response = await federation.handleMessage(msg);
      expect(response).not.toBeNull();
      expect(response!.type).toBe('health-response');
      expect(response!.payload.status).toBe('ok');
      expect(response!.payload.peerId).toBe('test-peer');
    });

    it('handles sync-request message and returns local records', async () => {
      agentDNS.register(makeRecord({ agentId: 'local-1' }));

      const msg: CADPMessage = {
        type: 'sync-request',
        id: 'msg_sync',
        source: 'remote',
        payload: { records: [], peerId: 'remote-peer', peerName: 'Remote' },
        timestamp: Date.now(),
      };

      const response = await federation.handleMessage(msg);
      expect(response).not.toBeNull();
      expect(response!.type).toBe('sync-response');
      expect(Array.isArray(response!.payload.records)).toBe(true);
    });

    it('handles lookup message and returns found record', async () => {
      agentDNS.register(makeRecord({ agentId: 'lookup-target' }));

      const msg: CADPMessage = {
        type: 'lookup',
        id: 'msg_lu',
        source: 'remote',
        payload: { agentId: 'lookup-target' },
        timestamp: Date.now(),
      };

      const response = await federation.handleMessage(msg);
      expect(response).not.toBeNull();
      expect(response!.type).toBe('lookup-response');
      expect(response!.payload.found).toBe(true);
    });

    it('handles lookup message for non-existent agent', async () => {
      const msg: CADPMessage = {
        type: 'lookup',
        id: 'msg_lu_miss',
        source: 'remote',
        payload: { agentId: 'ghost' },
        timestamp: Date.now(),
      };

      const response = await federation.handleMessage(msg);
      expect(response!.payload.found).toBe(false);
      expect(response!.payload.record).toBeNull();
    });

    it('handles announce message from trusted peer', async () => {
      // First add a peer so the trust level check works
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { peerId: 'ann-peer', status: 'ok' } }));
      await federation.addPeer('https://ann-handler.io', { trustLevel: 'full' });

      const msg: CADPMessage = {
        type: 'announce',
        id: 'msg_ann',
        source: 'ann-peer',
        payload: {
          peerId: 'ann-peer',
          record: {
            agentId: 'announced-agent',
            domain: 'remote.io',
            endpoints: [{ protocol: 'rest', url: 'https://remote.io/api', healthy: true }],
            capabilities: ['cap-a'],
            ttl: 3600,
            priority: 10,
            weight: 100,
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000,
          },
        },
        timestamp: Date.now(),
      };

      const response = await federation.handleMessage(msg);
      expect(response).not.toBeNull();
      expect(response!.payload.status).toBe('ack');

      // The announced agent should now be registered locally
      expect(agentDNS.getRecord('announced-agent')).not.toBeNull();
    });

    it('rejects announce from untrusted peer', async () => {
      // No peers registered = untrusted by default
      const msg: CADPMessage = {
        type: 'announce',
        id: 'msg_ann_unt',
        source: 'untrusted-peer',
        payload: {
          peerId: 'untrusted-peer',
          record: {
            agentId: 'rejected-agent',
            domain: 'evil.io',
            endpoints: [],
            capabilities: [],
            ttl: 3600,
            priority: 10,
            weight: 100,
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000,
          },
        },
        timestamp: Date.now(),
      };

      await federation.handleMessage(msg);

      // The agent should NOT be registered
      expect(agentDNS.getRecord('rejected-agent')).toBeNull();
    });

    it('returns error for unknown message type', async () => {
      const msg: CADPMessage = {
        type: 'gibberish' as any,
        id: 'msg_bad',
        source: 'remote',
        payload: {},
        timestamp: Date.now(),
      };

      const response = await federation.handleMessage(msg);
      expect(response!.type).toBe('error');
      expect(response!.payload.error).toContain('Unknown message type');
    });
  });

  // ---------------------------------------------------------------------------
  // Federated lookup
  // ---------------------------------------------------------------------------

  describe('federatedLookup()', () => {
    it('returns local record if available', async () => {
      agentDNS.register(makeRecord({ agentId: 'local-found' }));

      const result = await federation.federatedLookup('local-found');
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('local-found');
    });

    it('returns null when no peers and no local record', async () => {
      const result = await federation.federatedLookup('nonexistent');
      expect(result).toBeNull();
    });

    it('queries connected peers when local lookup fails', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { peerId: 'fl-peer', status: 'ok' } }));
      await federation.addPeer('https://fed-lookup.io');

      const remoteRecord = {
        agentId: 'remote-found',
        domain: 'remote.io',
        endpoints: [{ protocol: 'rest', url: 'https://remote.io/api', healthy: true }],
        capabilities: ['cap'],
        ttl: 3600,
        priority: 10,
        weight: 100,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'lookup-response',
        payload: { agentId: 'remote-found', record: remoteRecord, found: true },
      }));

      const result = await federation.federatedLookup('remote-found');
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('remote-found');
    });

    it('caches federated lookup results locally', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { peerId: 'cache-p', status: 'ok' } }));
      await federation.addPeer('https://cache.io');

      const remoteRecord = {
        agentId: 'cache-agent',
        domain: 'remote.io',
        endpoints: [{ protocol: 'rest', url: 'https://remote.io/api', healthy: true }],
        capabilities: ['cap'],
        ttl: 600,
        priority: 10,
        weight: 100,
        createdAt: Date.now(),
        expiresAt: Date.now() + 600000,
      };

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'lookup-response',
        payload: { agentId: 'cache-agent', record: remoteRecord, found: true },
      }));

      await federation.federatedLookup('cache-agent');

      // Should now be cached locally with capped TTL
      const cached = agentDNS.getRecord('cache-agent');
      expect(cached).not.toBeNull();
      expect(cached!.ttl).toBeLessThanOrEqual(300); // TTL is capped at 300 for federated
    });

    it('returns null when all peers return not found', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      await federation.addPeer('https://miss.io');

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'lookup-response',
        payload: { agentId: 'nope', record: null, found: false },
      }));

      const result = await federation.federatedLookup('nope');
      expect(result).toBeNull();
    });
  });

  describe('federatedSearch()', () => {
    it('returns local results when no peers connected', async () => {
      agentDNS.register(makeRecord({ agentId: 'fs-local', capabilities: ['search-cap'] }));

      const results = await federation.federatedSearch('search-cap');
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('fs-local');
    });

    it('aggregates results from local and remote', async () => {
      agentDNS.register(makeRecord({ agentId: 'fs-local2', capabilities: ['multi-cap'] }));

      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      await federation.addPeer('https://fs-remote.io');

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'lookup-response',
        payload: {
          records: [{
            agentId: 'fs-remote-agent',
            domain: 'remote.io',
            endpoints: [],
            capabilities: ['multi-cap'],
            ttl: 3600,
            priority: 10,
            weight: 100,
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000,
          }],
        },
      }));

      const results = await federation.federatedSearch('multi-cap');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates results by agentId', async () => {
      agentDNS.register(makeRecord({ agentId: 'dup-agent', capabilities: ['dedup-cap'] }));

      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      await federation.addPeer('https://dedup.io');

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'lookup-response',
        payload: {
          record: {
            agentId: 'dup-agent',
            domain: 'remote.io',
            endpoints: [],
            capabilities: ['dedup-cap'],
            ttl: 3600,
            priority: 10,
            weight: 100,
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000,
          },
        },
      }));

      const results = await federation.federatedSearch('dedup-cap');
      const ids = results.map((r) => r.agentId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('sorts results by priority', async () => {
      agentDNS.register(makeRecord({ agentId: 'low-pri', capabilities: ['sort-cap'], priority: 100 }));
      agentDNS.register(makeRecord({ agentId: 'high-pri', capabilities: ['sort-cap'], priority: 1 }));

      const results = await federation.federatedSearch('sort-cap');
      expect(results[0].priority).toBeLessThanOrEqual(results[1].priority);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('startSync() / stopSync()', () => {
    it('starts and stops without error', () => {
      federation.startSync();
      federation.startSync(); // idempotent
      federation.stopSync();
      federation.stopSync(); // idempotent
    });
  });

  describe('destroy()', () => {
    it('clears peers and listeners', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      await federation.addPeer('https://destroy.io');

      federation.destroy();

      expect(federation.listPeers()).toHaveLength(0);
      expect(federation.listenerCount('cadp:peer:connected')).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  describe('getStats()', () => {
    it('returns correct initial stats', () => {
      const stats = federation.getStats();
      expect(stats).toEqual({
        totalPeers: 0,
        connectedPeers: 0,
        lastSyncAt: undefined,
        totalSynced: 0,
      });
    });

    it('counts connected peers', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      await federation.addPeer('https://s1.io');
      await federation.addPeer('https://s2.io');

      const stats = federation.getStats();
      expect(stats.totalPeers).toBe(2);
      expect(stats.connectedPeers).toBe(2);
    });

    it('tracks totalSynced after successful sync', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { peerId: 'ts-p', status: 'ok' } }));
      const peer = await federation.addPeer('https://track.io');

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'sync-response',
        payload: {
          records: [{
            agentId: 'synced-rec',
            domain: 'r.io',
            endpoints: [{ protocol: 'rest', url: 'https://r.io', healthy: true }],
            capabilities: ['cap'],
            ttl: 3600,
            priority: 10,
            weight: 100,
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000,
          }],
          capabilities: ['cap'],
        },
      }));

      await federation.syncWithPeer(peer!.id);

      const stats = federation.getStats();
      expect(stats.totalSynced).toBeGreaterThan(0);
      expect(stats.lastSyncAt).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Stress tests
  // ---------------------------------------------------------------------------

  describe('stress tests', () => {
    it('handles adding many peers', async () => {
      const big = new FederationManager(agentDNS, { maxPeers: 100 });
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));

      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(big.addPeer(`https://stress-${i}.io`));
      }

      await Promise.all(promises);
      expect(big.listPeers()).toHaveLength(50);
      big.destroy();
    });

    it('handles sync with many records', async () => {
      for (let i = 0; i < 100; i++) {
        agentDNS.register(makeRecord({ agentId: `bulk-${i}`, capabilities: [`cap-${i % 5}`] }));
      }

      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      const peer = await federation.addPeer('https://bulk.io');

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'sync-response',
        payload: { records: [], capabilities: [] },
      }));

      const result = await federation.syncWithPeer(peer!.id);
      expect(result.sent).toBe(100);
    });

    it('handles rapid peer add/remove cycles', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));

      for (let i = 0; i < 50; i++) {
        const peer = await federation.addPeer(`https://cycle-${i}.io`);
        if (peer) {
          federation.removePeer(peer.id);
        }
      }

      expect(federation.listPeers()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles sync response with no records field', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      const peer = await federation.addPeer('https://edge1.io');

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'sync-response',
        payload: { capabilities: [] },
      }));

      const result = await federation.syncWithPeer(peer!.id);
      expect(result.received).toBe(0);
    });

    it('handles handleMessage with empty payload', async () => {
      const msg: CADPMessage = {
        type: 'lookup',
        id: 'msg_empty',
        source: 'remote',
        payload: {},
        timestamp: Date.now(),
      };

      const response = await federation.handleMessage(msg);
      expect(response!.type).toBe('lookup-response');
      expect(response!.payload.found).toBe(false);
    });

    it('handles federated lookup when peers fail', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      await federation.addPeer('https://fail-fl.io');

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

      const result = await federation.federatedLookup('failing-lookup');
      expect(result).toBeNull();
    });

    it('handles acceptRemoteAgents being false', async () => {
      const noAccept = new FederationManager(agentDNS, { acceptRemoteAgents: false });

      vi.stubGlobal('fetch', mockFetchResponse({ type: 'health-response', payload: { status: 'ok' } }));
      const peer = await noAccept.addPeer('https://no-accept.io');

      vi.stubGlobal('fetch', mockFetchResponse({
        type: 'sync-response',
        payload: {
          records: [{
            agentId: 'rejected',
            domain: 'r.io',
            endpoints: [],
            capabilities: [],
            ttl: 3600,
            priority: 10,
            weight: 100,
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000,
          }],
          capabilities: [],
        },
      }));

      await noAccept.syncWithPeer(peer!.id);
      expect(agentDNS.getRecord('rejected')).toBeNull();

      noAccept.destroy();
    });
  });
});
