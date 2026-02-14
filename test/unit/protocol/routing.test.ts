import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRouter } from '../../../src/protocol/routing.js';
import { AgentDNS } from '../../../src/protocol/agent-dns.js';
import type { AgentEndpoint, RouteCondition, RouteEntry, AgentDNSRecord } from '../../../src/protocol/types.js';

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

/** Helper to build an endpoint. */
function makeEndpoint(overrides: Partial<AgentEndpoint> = {}): AgentEndpoint {
  return {
    protocol: overrides.protocol ?? 'rest',
    url: overrides.url ?? `https://ep-${Math.random().toString(36).slice(2, 6)}.url`,
    healthy: overrides.healthy ?? true,
    latencyMs: overrides.latencyMs,
    region: overrides.region,
  };
}

describe('AgentRouter', () => {
  let agentDNS: AgentDNS;
  let router: AgentRouter;

  beforeEach(() => {
    agentDNS = new AgentDNS();
    router = new AgentRouter(agentDNS);
  });

  afterEach(() => {
    agentDNS.destroy();
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates a router with default algorithm (least-latency)', () => {
      expect(router).toBeInstanceOf(AgentRouter);
    });

    it('accepts a custom algorithm', () => {
      const rr = new AgentRouter(agentDNS, { algorithm: 'round-robin' });
      expect(rr).toBeInstanceOf(AgentRouter);
    });
  });

  // ---------------------------------------------------------------------------
  // Route management
  // ---------------------------------------------------------------------------

  describe('addRoute()', () => {
    it('adds a route and initializes metrics', () => {
      const route = router.addRoute({
        pattern: 'agent-*',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      expect(route.pattern).toBe('agent-*');
      expect(route.metrics.totalRequests).toBe(0);
      expect(route.metrics.successCount).toBe(0);
      expect(route.metrics.failCount).toBe(0);
      expect(route.metrics.avgLatencyMs).toBe(0);
    });

    it('emits cadp:route:updated event with action "added"', () => {
      const spy = vi.fn();
      router.on('cadp:route:updated', spy);

      router.addRoute({
        pattern: 'test-*',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      expect(spy).toHaveBeenCalledWith({ pattern: 'test-*', action: 'added' });
    });

    it('overwrites route with same pattern', () => {
      router.addRoute({
        pattern: 'same',
        destination: makeEndpoint({ url: 'https://first.url' }),
        priority: 1,
        weight: 100,
      });

      router.addRoute({
        pattern: 'same',
        destination: makeEndpoint({ url: 'https://second.url' }),
        priority: 2,
        weight: 200,
      });

      const route = router.getRoute('same');
      expect(route!.destination.url).toBe('https://second.url');
    });
  });

  describe('removeRoute()', () => {
    it('removes an existing route', () => {
      router.addRoute({
        pattern: 'remove-me',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      expect(router.removeRoute('remove-me')).toBe(true);
      expect(router.getRoute('remove-me')).toBeUndefined();
    });

    it('returns false for non-existent route', () => {
      expect(router.removeRoute('ghost')).toBe(false);
    });

    it('emits cadp:route:updated with action "removed"', () => {
      const spy = vi.fn();
      router.on('cadp:route:updated', spy);

      router.addRoute({
        pattern: 'rem-ev',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      router.removeRoute('rem-ev');

      expect(spy).toHaveBeenCalledWith({ pattern: 'rem-ev', action: 'removed' });
    });
  });

  describe('updateRoute()', () => {
    it('updates an existing route', () => {
      router.addRoute({
        pattern: 'upd',
        destination: makeEndpoint(),
        priority: 10,
        weight: 100,
      });

      const updated = router.updateRoute('upd', { priority: 1 });
      expect(updated).not.toBeNull();
      expect(updated!.priority).toBe(1);
    });

    it('returns null for non-existent route', () => {
      expect(router.updateRoute('ghost', { priority: 1 })).toBeNull();
    });

    it('preserves pattern (immutable)', () => {
      router.addRoute({
        pattern: 'immutable',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      const updated = router.updateRoute('immutable', { pattern: 'hacked' } as any);
      expect(updated!.pattern).toBe('immutable');
    });

    it('preserves metrics unless explicitly updated', () => {
      router.addRoute({
        pattern: 'metric-test',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      router.recordResult('metric-test', { success: true, latencyMs: 50 });
      const updated = router.updateRoute('metric-test', { weight: 200 });

      expect(updated!.metrics.totalRequests).toBe(1);
    });

    it('allows explicit metrics update', () => {
      router.addRoute({
        pattern: 'metric-upd',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      const updated = router.updateRoute('metric-upd', {
        metrics: { totalRequests: 100, successCount: 90, failCount: 10, avgLatencyMs: 25, lastUsed: 999 },
      });

      expect(updated!.metrics.totalRequests).toBe(100);
    });

    it('emits cadp:route:updated with action "updated"', () => {
      const spy = vi.fn();
      router.on('cadp:route:updated', spy);

      router.addRoute({
        pattern: 'ev-upd',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      router.updateRoute('ev-upd', { weight: 50 });

      expect(spy).toHaveBeenCalledWith({ pattern: 'ev-upd', action: 'updated' });
    });
  });

  describe('getRoute() / listRoutes()', () => {
    it('getRoute returns the route by pattern', () => {
      router.addRoute({
        pattern: 'get-me',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      expect(router.getRoute('get-me')).toBeDefined();
    });

    it('getRoute returns undefined for unknown pattern', () => {
      expect(router.getRoute('unknown')).toBeUndefined();
    });

    it('listRoutes returns all routes sorted by priority', () => {
      router.addRoute({ pattern: 'low', destination: makeEndpoint(), priority: 100, weight: 1 });
      router.addRoute({ pattern: 'high', destination: makeEndpoint(), priority: 1, weight: 1 });
      router.addRoute({ pattern: 'mid', destination: makeEndpoint(), priority: 50, weight: 1 });

      const routes = router.listRoutes();
      expect(routes).toHaveLength(3);
      expect(routes[0].pattern).toBe('high');
      expect(routes[2].pattern).toBe('low');
    });
  });

  // ---------------------------------------------------------------------------
  // Core routing
  // ---------------------------------------------------------------------------

  describe('route()', () => {
    it('resolves directly by agentId via AgentDNS', () => {
      agentDNS.register(makeRecord({
        agentId: 'direct-agent',
        endpoints: [{ protocol: 'rest', url: 'https://direct.url', healthy: true, latencyMs: 5 }],
      }));

      const ep = router.route({ agentId: 'direct-agent' });
      expect(ep).not.toBeNull();
      expect(ep!.url).toBe('https://direct.url');
    });

    it('falls through to routes when agentId has no DNS entry', () => {
      router.addRoute({
        pattern: 'fallback-agent',
        destination: makeEndpoint({ url: 'https://route.url' }),
        priority: 1,
        weight: 100,
      });

      const ep = router.route({ agentId: 'fallback-agent' });
      expect(ep).not.toBeNull();
      expect(ep!.url).toBe('https://route.url');
    });

    it('falls through to capability-based resolution', () => {
      agentDNS.register(makeRecord({
        agentId: 'cap-agent',
        capabilities: ['nlp'],
        endpoints: [{ protocol: 'rest', url: 'https://nlp.url', healthy: true, latencyMs: 10 }],
      }));

      const ep = router.route({ capability: 'nlp' });
      expect(ep).not.toBeNull();
      expect(ep!.url).toBe('https://nlp.url');
    });

    it('returns null when nothing matches', () => {
      expect(router.route({ agentId: 'ghost' })).toBeNull();
      expect(router.route({ capability: 'nonexistent' })).toBeNull();
      expect(router.route({})).toBeNull();
    });

    it('filters by protocol', () => {
      agentDNS.register(makeRecord({
        agentId: 'proto-agent',
        endpoints: [
          { protocol: 'rest', url: 'https://rest.url', healthy: true, latencyMs: 5 },
          { protocol: 'grpc', url: 'https://grpc.url', healthy: true, latencyMs: 3 },
        ],
      }));

      const ep = router.route({ agentId: 'proto-agent', protocol: 'grpc' });
      expect(ep!.protocol).toBe('grpc');
    });

    it('filters by region', () => {
      agentDNS.register(makeRecord({
        agentId: 'region-agent',
        endpoints: [
          { protocol: 'rest', url: 'https://us.url', healthy: true, latencyMs: 5, region: 'us-east' },
          { protocol: 'rest', url: 'https://eu.url', healthy: true, latencyMs: 3, region: 'eu-west' },
        ],
      }));

      const ep = router.route({ agentId: 'region-agent', region: 'eu-west' });
      expect(ep!.region).toBe('eu-west');
    });

    it('filters by maxLatency', () => {
      agentDNS.register(makeRecord({
        agentId: 'latency-agent',
        endpoints: [
          { protocol: 'rest', url: 'https://fast.url', healthy: true, latencyMs: 5 },
          { protocol: 'rest', url: 'https://slow.url', healthy: true, latencyMs: 500 },
        ],
      }));

      const ep = router.route({ agentId: 'latency-agent', maxLatency: 100 });
      expect(ep).not.toBeNull();
      expect(ep!.latencyMs!).toBeLessThanOrEqual(100);
    });

    it('uses glob pattern matching for routes', () => {
      router.addRoute({
        pattern: 'nlp/**',
        destination: makeEndpoint({ url: 'https://nlp-route.url' }),
        priority: 1,
        weight: 100,
      });

      const ep = router.route({ capability: 'nlp/sentiment/v2' });
      expect(ep).not.toBeNull();
      expect(ep!.url).toBe('https://nlp-route.url');
    });

    it('skips unhealthy route destinations', () => {
      router.addRoute({
        pattern: 'unhealthy-dest',
        destination: makeEndpoint({ url: 'https://down.url', healthy: false }),
        priority: 1,
        weight: 100,
      });

      const ep = router.route({ agentId: 'unhealthy-dest' });
      expect(ep).toBeNull();
    });

    it('evaluates route conditions', () => {
      router.addRoute({
        pattern: 'cond-test',
        destination: makeEndpoint({ url: 'https://cond.url', region: 'us-east' }),
        priority: 1,
        weight: 100,
        conditions: [
          { type: 'region', operator: 'eq', value: 'us-east' },
        ],
      });

      const ep = router.route({ agentId: 'cond-test', region: 'us-east' });
      expect(ep).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // routeAll
  // ---------------------------------------------------------------------------

  describe('routeAll()', () => {
    it('returns endpoints from DNS when capability matches', () => {
      agentDNS.register(makeRecord({
        agentId: 'multi-1',
        capabilities: ['multi-cap'],
        endpoints: [{ protocol: 'rest', url: 'https://dns-ep.url', healthy: true }],
      }));

      const results = router.routeAll({ capability: 'multi-cap', limit: 10 });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        agentDNS.register(makeRecord({
          agentId: `limit-${i}`,
          capabilities: ['limited'],
          endpoints: [{ protocol: 'rest', url: `https://limit-${i}.url`, healthy: true }],
        }));
      }

      const results = router.routeAll({ capability: 'limited', limit: 3 });
      expect(results).toHaveLength(3);
    });

    it('deduplicates by URL', () => {
      router.addRoute({
        pattern: 'dedup-cap',
        destination: makeEndpoint({ url: 'https://same.url' }),
        priority: 1,
        weight: 100,
      });

      agentDNS.register(makeRecord({
        agentId: 'dedup-dns',
        capabilities: ['dedup-cap'],
        endpoints: [{ protocol: 'rest', url: 'https://same.url', healthy: true }],
      }));

      const results = router.routeAll({ capability: 'dedup-cap' });
      const urls = results.map((r) => r.url);
      expect(new Set(urls).size).toBe(urls.length);
    });

    it('returns empty for unknown capability', () => {
      expect(router.routeAll({ capability: 'ghost-cap' })).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // recordResult
  // ---------------------------------------------------------------------------

  describe('recordResult()', () => {
    it('tracks success count and latency', () => {
      router.addRoute({
        pattern: 'tracked',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      router.recordResult('tracked', { success: true, latencyMs: 50 });
      router.recordResult('tracked', { success: true, latencyMs: 100 });

      const route = router.getRoute('tracked')!;
      expect(route.metrics.totalRequests).toBe(2);
      expect(route.metrics.successCount).toBe(2);
      expect(route.metrics.failCount).toBe(0);
      expect(route.metrics.avgLatencyMs).toBe(75);
    });

    it('tracks failure count', () => {
      router.addRoute({
        pattern: 'fail-track',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      router.recordResult('fail-track', { success: false, latencyMs: 200 });

      const route = router.getRoute('fail-track')!;
      expect(route.metrics.failCount).toBe(1);
      expect(route.metrics.successCount).toBe(0);
    });

    it('does nothing for non-existent pattern', () => {
      expect(() => router.recordResult('ghost', { success: true, latencyMs: 10 })).not.toThrow();
    });

    it('updates lastUsed timestamp', () => {
      router.addRoute({
        pattern: 'time-track',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      const before = Date.now();
      router.recordResult('time-track', { success: true, latencyMs: 10 });
      const route = router.getRoute('time-track')!;
      expect(route.metrics.lastUsed).toBeGreaterThanOrEqual(before);
    });

    it('computes rolling average correctly over many results', () => {
      router.addRoute({
        pattern: 'rolling',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      const latencies = [10, 20, 30, 40, 50];
      for (const lat of latencies) {
        router.recordResult('rolling', { success: true, latencyMs: lat });
      }

      const route = router.getRoute('rolling')!;
      const expectedAvg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      expect(route.metrics.avgLatencyMs).toBeCloseTo(expectedAvg, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Routing algorithms
  // ---------------------------------------------------------------------------

  describe('routeRoundRobin()', () => {
    it('cycles through endpoints', () => {
      const eps = [
        makeEndpoint({ url: 'https://a.url' }),
        makeEndpoint({ url: 'https://b.url' }),
        makeEndpoint({ url: 'https://c.url' }),
      ];

      const results = [];
      for (let i = 0; i < 6; i++) {
        results.push(router.routeRoundRobin(eps)!.url);
      }

      expect(results[0]).toBe('https://a.url');
      expect(results[1]).toBe('https://b.url');
      expect(results[2]).toBe('https://c.url');
      expect(results[3]).toBe('https://a.url');
    });

    it('returns null for empty array', () => {
      expect(router.routeRoundRobin([])).toBeNull();
    });
  });

  describe('routeWeighted()', () => {
    it('returns an endpoint based on weight', () => {
      const entries = [
        { endpoint: makeEndpoint({ url: 'https://heavy.url' }), weight: 100 },
        { endpoint: makeEndpoint({ url: 'https://light.url' }), weight: 1 },
      ];

      let heavy = 0;
      for (let i = 0; i < 100; i++) {
        const result = router.routeWeighted(entries);
        if (result!.url === 'https://heavy.url') heavy++;
      }

      expect(heavy).toBeGreaterThan(50);
    });

    it('returns first endpoint when all weights are zero', () => {
      const entries = [
        { endpoint: makeEndpoint({ url: 'https://zero1.url' }), weight: 0 },
        { endpoint: makeEndpoint({ url: 'https://zero2.url' }), weight: 0 },
      ];

      const result = router.routeWeighted(entries);
      expect(result!.url).toBe('https://zero1.url');
    });

    it('returns null for empty array', () => {
      expect(router.routeWeighted([])).toBeNull();
    });
  });

  describe('routeLeastLatency()', () => {
    it('picks endpoint with lowest latency', () => {
      const eps = [
        makeEndpoint({ url: 'https://slow.url', latencyMs: 200 }),
        makeEndpoint({ url: 'https://fast.url', latencyMs: 5 }),
        makeEndpoint({ url: 'https://mid.url', latencyMs: 50 }),
      ];

      const result = router.routeLeastLatency(eps);
      expect(result!.url).toBe('https://fast.url');
    });

    it('puts endpoints without latency last', () => {
      const eps = [
        makeEndpoint({ url: 'https://no-lat.url' }),
        makeEndpoint({ url: 'https://has-lat.url', latencyMs: 100 }),
      ];

      const result = router.routeLeastLatency(eps);
      expect(result!.url).toBe('https://has-lat.url');
    });

    it('returns null for empty array', () => {
      expect(router.routeLeastLatency([])).toBeNull();
    });
  });

  describe('routeCapabilityMatch()', () => {
    it('prefers a2a protocol', () => {
      const eps = [
        makeEndpoint({ protocol: 'rest', url: 'https://rest.url', latencyMs: 1 }),
        makeEndpoint({ protocol: 'a2a', url: 'https://a2a.url', latencyMs: 100 }),
      ];

      const result = router.routeCapabilityMatch(eps, 'test-cap');
      expect(result!.protocol).toBe('a2a');
    });

    it('breaks ties by latency within same protocol', () => {
      const eps = [
        makeEndpoint({ protocol: 'a2a', url: 'https://slow-a2a.url', latencyMs: 100 }),
        makeEndpoint({ protocol: 'a2a', url: 'https://fast-a2a.url', latencyMs: 5 }),
      ];

      const result = router.routeCapabilityMatch(eps, 'test-cap');
      expect(result!.url).toBe('https://fast-a2a.url');
    });

    it('returns null for empty array', () => {
      expect(router.routeCapabilityMatch([], 'cap')).toBeNull();
    });

    it('follows protocol preference order: a2a > mcp > rest > grpc > websocket', () => {
      const eps = [
        makeEndpoint({ protocol: 'websocket', url: 'https://ws.url', latencyMs: 1 }),
        makeEndpoint({ protocol: 'grpc', url: 'https://grpc.url', latencyMs: 1 }),
        makeEndpoint({ protocol: 'rest', url: 'https://rest.url', latencyMs: 1 }),
        makeEndpoint({ protocol: 'mcp', url: 'https://mcp.url', latencyMs: 1 }),
        makeEndpoint({ protocol: 'a2a', url: 'https://a2a.url', latencyMs: 1 }),
      ];

      const result = router.routeCapabilityMatch(eps, 'cap');
      expect(result!.protocol).toBe('a2a');
    });
  });

  // ---------------------------------------------------------------------------
  // Condition evaluation
  // ---------------------------------------------------------------------------

  describe('evaluateConditions()', () => {
    it('returns true when all conditions pass', () => {
      const conditions: RouteCondition[] = [
        { type: 'region', operator: 'eq', value: 'us-east' },
        { type: 'latency', operator: 'lt', value: 100 },
      ];

      const context = { region: 'us-east', latency: 50 };
      expect(router.evaluateConditions(conditions, context)).toBe(true);
    });

    it('returns false when any condition fails', () => {
      const conditions: RouteCondition[] = [
        { type: 'region', operator: 'eq', value: 'us-east' },
        { type: 'latency', operator: 'lt', value: 10 },
      ];

      const context = { region: 'us-east', latency: 50 };
      expect(router.evaluateConditions(conditions, context)).toBe(false);
    });

    it('returns true for empty conditions', () => {
      expect(router.evaluateConditions([], {})).toBe(true);
    });

    it('handles eq operator', () => {
      expect(router.evaluateConditions(
        [{ type: 'region', operator: 'eq', value: 'us' }],
        { region: 'us' },
      )).toBe(true);

      expect(router.evaluateConditions(
        [{ type: 'region', operator: 'eq', value: 'us' }],
        { region: 'eu' },
      )).toBe(false);
    });

    it('handles ne operator', () => {
      expect(router.evaluateConditions(
        [{ type: 'region', operator: 'ne', value: 'us' }],
        { region: 'eu' },
      )).toBe(true);
    });

    it('handles gt operator', () => {
      expect(router.evaluateConditions(
        [{ type: 'latency', operator: 'gt', value: 50 }],
        { latency: 100 },
      )).toBe(true);

      expect(router.evaluateConditions(
        [{ type: 'latency', operator: 'gt', value: 50 }],
        { latency: 10 },
      )).toBe(false);
    });

    it('handles lt operator', () => {
      expect(router.evaluateConditions(
        [{ type: 'latency', operator: 'lt', value: 50 }],
        { latency: 10 },
      )).toBe(true);
    });

    it('handles contains operator for strings', () => {
      expect(router.evaluateConditions(
        [{ type: 'capability', operator: 'contains', value: 'nlp' }],
        { capability: 'nlp-advanced' },
      )).toBe(true);
    });

    it('handles contains operator for arrays', () => {
      expect(router.evaluateConditions(
        [{ type: 'capability', operator: 'contains', value: 'nlp' }],
        { capability: ['nlp', 'vision'] },
      )).toBe(true);
    });

    it('handles matches operator with regex', () => {
      expect(router.evaluateConditions(
        [{ type: 'capability', operator: 'matches', value: '^nlp.*' }],
        { capability: 'nlp-advanced' },
      )).toBe(true);

      expect(router.evaluateConditions(
        [{ type: 'capability', operator: 'matches', value: '^vision' }],
        { capability: 'nlp-advanced' },
      )).toBe(false);
    });

    it('passes when context value is missing (non-applicable)', () => {
      expect(router.evaluateConditions(
        [{ type: 'region', operator: 'eq', value: 'us' }],
        {},
      )).toBe(true);
    });

    it('returns false for gt/lt with non-numeric values', () => {
      expect(router.evaluateConditions(
        [{ type: 'region', operator: 'gt', value: 50 }],
        { region: 'us-east' },
      )).toBe(false);
    });

    it('handles invalid regex in matches gracefully', () => {
      expect(router.evaluateConditions(
        [{ type: 'capability', operator: 'matches', value: '[invalid' }],
        { capability: 'test' },
      )).toBe(false);
    });

    it('returns false for unknown operator', () => {
      expect(router.evaluateConditions(
        [{ type: 'region', operator: 'unknown' as any, value: 'test' }],
        { region: 'test' },
      )).toBe(false);
    });

    it('handles matches operator with non-string types', () => {
      expect(router.evaluateConditions(
        [{ type: 'latency', operator: 'matches', value: '.*' }],
        { latency: 42 },
      )).toBe(false);
    });

    it('handles contains operator with non-string non-array context', () => {
      expect(router.evaluateConditions(
        [{ type: 'latency', operator: 'contains', value: 5 }],
        { latency: 5 },
      )).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  describe('getStats()', () => {
    it('returns initial stats', () => {
      const stats = router.getStats();
      expect(stats).toEqual({
        totalRoutes: 0,
        totalRequests: 0,
        avgLatencyMs: 0,
        successRate: 0,
      });
    });

    it('computes aggregated stats from routes', () => {
      router.addRoute({
        pattern: 'stat-a',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });
      router.addRoute({
        pattern: 'stat-b',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      router.recordResult('stat-a', { success: true, latencyMs: 50 });
      router.recordResult('stat-a', { success: true, latencyMs: 50 });
      router.recordResult('stat-b', { success: false, latencyMs: 100 });

      const stats = router.getStats();
      expect(stats.totalRoutes).toBe(2);
      expect(stats.totalRequests).toBe(3);
      expect(stats.successRate).toBeCloseTo(2 / 3, 2);
      expect(stats.avgLatencyMs).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Pattern matching (tested indirectly via route())
  // ---------------------------------------------------------------------------

  describe('pattern matching', () => {
    it('matches exact pattern', () => {
      router.addRoute({
        pattern: 'exact-agent',
        destination: makeEndpoint({ url: 'https://exact.url' }),
        priority: 1,
        weight: 100,
      });

      expect(router.route({ agentId: 'exact-agent' })!.url).toBe('https://exact.url');
    });

    it('matches wildcard *', () => {
      router.addRoute({
        pattern: 'agent-*',
        destination: makeEndpoint({ url: 'https://wild.url' }),
        priority: 1,
        weight: 100,
      });

      expect(router.route({ agentId: 'agent-123' })!.url).toBe('https://wild.url');
    });

    it('matches double wildcard **', () => {
      router.addRoute({
        pattern: 'ns/**',
        destination: makeEndpoint({ url: 'https://deep.url' }),
        priority: 1,
        weight: 100,
      });

      expect(router.route({ agentId: 'ns/a/b/c' })!.url).toBe('https://deep.url');
    });

    it('matches * pattern (any)', () => {
      router.addRoute({
        pattern: '*',
        destination: makeEndpoint({ url: 'https://catch-all.url' }),
        priority: 999,
        weight: 100,
      });

      expect(router.route({ agentId: 'anything' })!.url).toBe('https://catch-all.url');
    });

    it('matches ** pattern (any including slashes)', () => {
      router.addRoute({
        pattern: '**',
        destination: makeEndpoint({ url: 'https://catch-all2.url' }),
        priority: 999,
        weight: 100,
      });

      expect(router.route({ agentId: 'a/b/c' })!.url).toBe('https://catch-all2.url');
    });

    it('handles ? wildcard', () => {
      router.addRoute({
        pattern: 'agent-?',
        destination: makeEndpoint({ url: 'https://single.url' }),
        priority: 1,
        weight: 100,
      });

      expect(router.route({ agentId: 'agent-a' })!.url).toBe('https://single.url');
      expect(router.route({ agentId: 'agent-ab' })).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Algorithm integration via route()
  // ---------------------------------------------------------------------------

  describe('algorithm integration', () => {
    it('round-robin routing cycles through endpoints', () => {
      const rrRouter = new AgentRouter(agentDNS, { algorithm: 'round-robin' });

      agentDNS.register(makeRecord({
        agentId: 'rr-agent',
        capabilities: ['rr-cap'],
        endpoints: [
          { protocol: 'rest', url: 'https://rr-a.url', healthy: true },
          { protocol: 'rest', url: 'https://rr-b.url', healthy: true },
        ],
      }));

      const urls = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const ep = rrRouter.route({ capability: 'rr-cap' });
        if (ep) urls.add(ep.url);
      }

      expect(urls.size).toBe(2);
    });

    it('least-latency routing picks fastest endpoint', () => {
      agentDNS.register(makeRecord({
        agentId: 'll-agent',
        capabilities: ['ll-cap'],
        endpoints: [
          { protocol: 'rest', url: 'https://slow.url', healthy: true, latencyMs: 200 },
          { protocol: 'rest', url: 'https://fast.url', healthy: true, latencyMs: 2 },
        ],
      }));

      const ep = router.route({ capability: 'll-cap' });
      expect(ep!.url).toBe('https://fast.url');
    });

    it('capability-match routing prefers a2a protocol', () => {
      const cmRouter = new AgentRouter(agentDNS, { algorithm: 'capability-match' });

      agentDNS.register(makeRecord({
        agentId: 'cm-agent',
        capabilities: ['cm-cap'],
        endpoints: [
          { protocol: 'rest', url: 'https://rest.url', healthy: true, latencyMs: 1 },
          { protocol: 'a2a', url: 'https://a2a.url', healthy: true, latencyMs: 100 },
        ],
      }));

      const ep = cmRouter.route({ capability: 'cm-cap' });
      expect(ep!.protocol).toBe('a2a');
    });

    it('weighted routing uses route weights', () => {
      const wRouter = new AgentRouter(agentDNS, { algorithm: 'weighted' });

      // Add routes with very different weights
      wRouter.addRoute({
        pattern: 'w-cap',
        destination: makeEndpoint({ url: 'https://heavy.url' }),
        priority: 1,
        weight: 1000,
      });

      const ep = wRouter.route({ capability: 'w-cap' });
      expect(ep).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Stress tests
  // ---------------------------------------------------------------------------

  describe('stress tests', () => {
    it('handles 500 routes', () => {
      for (let i = 0; i < 500; i++) {
        router.addRoute({
          pattern: `route-${i}`,
          destination: makeEndpoint({ url: `https://ep-${i}.url` }),
          priority: i,
          weight: 100,
        });
      }

      expect(router.listRoutes()).toHaveLength(500);
      expect(router.getRoute('route-250')).toBeDefined();
    });

    it('handles rapid recordResult calls', () => {
      router.addRoute({
        pattern: 'rapid',
        destination: makeEndpoint(),
        priority: 1,
        weight: 100,
      });

      for (let i = 0; i < 1000; i++) {
        router.recordResult('rapid', {
          success: i % 3 !== 0,
          latencyMs: Math.random() * 100,
        });
      }

      const route = router.getRoute('rapid')!;
      expect(route.metrics.totalRequests).toBe(1000);
      expect(route.metrics.successCount + route.metrics.failCount).toBe(1000);
    });

    it('handles routing with many DNS entries', () => {
      for (let i = 0; i < 200; i++) {
        agentDNS.register(makeRecord({
          agentId: `stress-agent-${i}`,
          capabilities: ['stress-cap'],
          endpoints: [{ protocol: 'rest', url: `https://stress-${i}.url`, healthy: true, latencyMs: i }],
        }));
      }

      const ep = router.route({ capability: 'stress-cap' });
      expect(ep).not.toBeNull();
      expect(ep!.latencyMs).toBe(0);
    });

    it('handles rapid round-robin on large endpoint lists', () => {
      const eps = Array.from({ length: 100 }, (_, i) => makeEndpoint({ url: `https://rr-${i}.url` }));

      for (let i = 0; i < 2000; i++) {
        expect(router.routeRoundRobin(eps)).not.toBeNull();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles special characters in patterns', () => {
      router.addRoute({
        pattern: 'agent.name+special',
        destination: makeEndpoint({ url: 'https://special.url' }),
        priority: 1,
        weight: 100,
      });

      const ep = router.route({ agentId: 'agent.name+special' });
      expect(ep).not.toBeNull();
    });

    it('handles empty agentId and capability', () => {
      expect(router.route({ agentId: '', capability: '' })).toBeNull();
    });

    it('route with all endpoints unhealthy returns null', () => {
      agentDNS.register(makeRecord({
        agentId: 'all-down',
        endpoints: [
          { protocol: 'rest', url: 'https://d1.url', healthy: false },
          { protocol: 'rest', url: 'https://d2.url', healthy: false },
        ],
      }));

      expect(router.route({ agentId: 'all-down' })).toBeNull();
    });

    it('route with conditions on missing context passes', () => {
      router.addRoute({
        pattern: 'cond-missing',
        destination: makeEndpoint({ url: 'https://cond.url' }),
        priority: 1,
        weight: 100,
        conditions: [
          { type: 'cost', operator: 'lt', value: 100 },
        ],
      });

      const ep = router.route({ agentId: 'cond-missing' });
      expect(ep).not.toBeNull();
    });

    it('endpoint without region passes region filter', () => {
      agentDNS.register(makeRecord({
        agentId: 'no-region',
        endpoints: [{ protocol: 'rest', url: 'https://nr.url', healthy: true, latencyMs: 5 }],
      }));

      // No region on endpoint means it should pass the region filter
      const ep = router.route({ agentId: 'no-region', region: 'us-east' });
      expect(ep).not.toBeNull();
    });

    it('endpoint without latency passes maxLatency filter', () => {
      agentDNS.register(makeRecord({
        agentId: 'no-latency',
        endpoints: [{ protocol: 'rest', url: 'https://nl.url', healthy: true }],
      }));

      const ep = router.route({ agentId: 'no-latency', maxLatency: 50 });
      expect(ep).not.toBeNull();
    });
  });
});
