import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentDiscovery } from '../../../src/marketplace/discovery.js';
import { AgentRegistry } from '../../../src/marketplace/agent-registry.js';
import type { AgentListing } from '../../../src/marketplace/types.js';

// Mock the http/https modules to prevent real network calls
vi.mock('node:https', () => ({
  request: vi.fn((_url: unknown, _opts: unknown, _cb: unknown) => {
    const req = {
      on: vi.fn((_event: string, handler: (err: Error) => void) => {
        if (_event === 'error') {
          setTimeout(() => handler(new Error('mocked network error')), 0);
        }
        return req;
      }),
      end: vi.fn(),
      destroy: vi.fn(),
    };
    return req;
  }),
}));

vi.mock('node:http', () => ({
  request: vi.fn((_url: unknown, _opts: unknown, _cb: unknown) => {
    const req = {
      on: vi.fn((_event: string, handler: (err: Error) => void) => {
        if (_event === 'error') {
          setTimeout(() => handler(new Error('mocked network error')), 0);
        }
        return req;
      }),
      end: vi.fn(),
      destroy: vi.fn(),
    };
    return req;
  }),
}));

describe('AgentDiscovery', () => {
  let registry: AgentRegistry;
  let discovery: AgentDiscovery;

  const makeListing = (
    overrides: Partial<Omit<AgentListing, 'id' | 'createdAt' | 'updatedAt'>> = {},
  ): Omit<AgentListing, 'id' | 'createdAt' | 'updatedAt'> => ({
    name: 'TestAgent',
    description: 'A test agent for code generation',
    version: '1.0.0',
    author: { id: 'author-1', name: 'Test Author', verified: true },
    capabilities: ['code-generation', 'testing'],
    tags: ['typescript', 'testing'],
    pricing: { model: 'per-call' as const, baseCost: 0.01, currency: 'USD' },
    quality: {
      rating: 4.5,
      totalCalls: 100,
      successRate: 0.95,
      avgLatencyMs: 200,
      avgCostPerCall: 0.01,
    },
    endpoints: { a2aUrl: 'http://localhost:3200' },
    status: 'active' as const,
    ...overrides,
  });

  beforeEach(() => {
    registry = new AgentRegistry();
    discovery = new AgentDiscovery(registry);
  });

  // ─────────────────────────────────────────────────────────────
  // CONSTRUCTOR
  // ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates an instance with a registry', () => {
      expect(discovery).toBeDefined();
      expect(discovery).toBeInstanceOf(AgentDiscovery);
    });

    it('starts with zero stats', () => {
      const stats = discovery.getStats();
      expect(stats.totalSearches).toBe(0);
      expect(stats.totalDiscovered).toBe(0);
      expect(stats.lastScanAt).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LOCAL SEARCH — search()
  // ─────────────────────────────────────────────────────────────

  describe('search()', () => {
    it('returns all active agents with empty query', () => {
      registry.register(makeListing());
      registry.register(makeListing({ name: 'Agent2' }));
      registry.register(makeListing({ name: 'Inactive', status: 'inactive' }));

      const result = discovery.search({});
      expect(result.agents).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('increments totalSearches counter on each call', () => {
      discovery.search({});
      discovery.search({});
      discovery.search({});

      expect(discovery.getStats().totalSearches).toBe(3);
    });

    it('emits marketplace:discovery:search event', () => {
      const spy = vi.fn();
      discovery.on('marketplace:discovery:search', spy);

      registry.register(makeListing());
      discovery.search({ text: 'test' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ text: 'test' }),
          resultCount: expect.any(Number),
          executionTimeMs: expect.any(Number),
        }),
      );
    });

    it('returns query in the result object', () => {
      const query = { text: 'hello', limit: 5 };
      const result = discovery.search(query);
      expect(result.query).toEqual(query);
    });

    // Text search
    describe('text filtering', () => {
      it('filters by text matching against name', () => {
        registry.register(makeListing({ name: 'AlphaBot' }));
        registry.register(makeListing({ name: 'BetaBot' }));

        const result = discovery.search({ text: 'Alpha' });
        expect(result.agents).toHaveLength(1);
        expect(result.agents[0].name).toBe('AlphaBot');
      });

      it('filters by text matching against description', () => {
        registry.register(makeListing({ description: 'handles database migrations' }));
        registry.register(makeListing({ name: 'Other', description: 'does nothing' }));

        const result = discovery.search({ text: 'database' });
        expect(result.agents).toHaveLength(1);
      });

      it('performs case-insensitive text search', () => {
        registry.register(makeListing({ name: 'MyCodeBot' }));

        const result = discovery.search({ text: 'MYCODEBOT' });
        expect(result.agents).toHaveLength(1);
      });

      it('matches all terms (AND logic) for multi-word text', () => {
        registry.register(makeListing({ name: 'CodeBot', description: 'generates TypeScript code', tags: [], capabilities: [] }));
        registry.register(makeListing({ name: 'TestBot', description: 'runs unit tests only', tags: ['testing'], capabilities: ['testing'] }));

        const result = discovery.search({ text: 'TypeScript code' });
        expect(result.agents).toHaveLength(1);
        expect(result.agents[0].name).toBe('CodeBot');
      });

      it('matches against capabilities and tags', () => {
        registry.register(makeListing({ capabilities: ['image-recognition'], tags: ['ml', 'vision'] }));

        const resultByCap = discovery.search({ text: 'image-recognition' });
        expect(resultByCap.agents).toHaveLength(1);

        const resultByTag = discovery.search({ text: 'vision' });
        expect(resultByTag.agents).toHaveLength(1);
      });

      it('returns empty when no text match is found', () => {
        registry.register(makeListing());
        const result = discovery.search({ text: 'nonexistent-capability-xyz' });
        expect(result.agents).toHaveLength(0);
        expect(result.total).toBe(0);
      });

      it('handles whitespace-only text gracefully', () => {
        registry.register(makeListing());
        const result = discovery.search({ text: '   ' });
        // Empty terms after split and filter => all agents match
        expect(result.agents).toHaveLength(1);
      });
    });

    // Capabilities filter
    describe('capabilities filtering', () => {
      it('filters by single capability (must include)', () => {
        registry.register(makeListing({ capabilities: ['code-generation', 'testing'] }));
        registry.register(makeListing({ name: 'Other', capabilities: ['translation'] }));

        const result = discovery.search({ capabilities: ['code-generation'] });
        expect(result.agents).toHaveLength(1);
      });

      it('requires ALL capabilities (AND logic)', () => {
        registry.register(makeListing({ capabilities: ['code-generation', 'testing', 'review'] }));
        registry.register(makeListing({ name: 'Partial', capabilities: ['code-generation'] }));

        const result = discovery.search({ capabilities: ['code-generation', 'review'] });
        expect(result.agents).toHaveLength(1);
      });

      it('performs case-insensitive capability matching', () => {
        registry.register(makeListing({ capabilities: ['Code-Generation'] }));

        const result = discovery.search({ capabilities: ['code-generation'] });
        expect(result.agents).toHaveLength(1);
      });

      it('supports partial capability matching (substring includes)', () => {
        registry.register(makeListing({ capabilities: ['code-generation-v2'] }));

        const result = discovery.search({ capabilities: ['code-generation'] });
        expect(result.agents).toHaveLength(1);
      });

      it('returns empty for unmatched capabilities', () => {
        registry.register(makeListing({ capabilities: ['testing'] }));

        const result = discovery.search({ capabilities: ['quantum-computing'] });
        expect(result.agents).toHaveLength(0);
      });

      it('does not filter when capabilities array is empty', () => {
        registry.register(makeListing());
        registry.register(makeListing({ name: 'Agent2' }));

        const result = discovery.search({ capabilities: [] });
        expect(result.agents).toHaveLength(2);
      });
    });

    // Tags filter
    describe('tags filtering', () => {
      it('filters by tags (ANY match)', () => {
        registry.register(makeListing({ tags: ['typescript', 'testing'] }));
        registry.register(makeListing({ name: 'Other', tags: ['python'] }));

        const result = discovery.search({ tags: ['typescript'] });
        expect(result.agents).toHaveLength(1);
      });

      it('matches if ANY tag matches (OR logic)', () => {
        registry.register(makeListing({ tags: ['python'] }));
        registry.register(makeListing({ name: 'Agent2', tags: ['typescript'] }));

        const result = discovery.search({ tags: ['python', 'typescript'] });
        expect(result.agents).toHaveLength(2);
      });

      it('performs case-insensitive tag matching', () => {
        registry.register(makeListing({ tags: ['TypeScript'] }));

        const result = discovery.search({ tags: ['typescript'] });
        expect(result.agents).toHaveLength(1);
      });

      it('does not filter when tags array is empty', () => {
        registry.register(makeListing());
        registry.register(makeListing({ name: 'Agent2' }));

        const result = discovery.search({ tags: [] });
        expect(result.agents).toHaveLength(2);
      });
    });

    // Cost filter
    describe('cost filtering', () => {
      it('filters by maxCost', () => {
        registry.register(makeListing({ pricing: { model: 'per-call', baseCost: 0.01, currency: 'USD' } }));
        registry.register(makeListing({
          name: 'Expensive',
          pricing: { model: 'per-call', baseCost: 5.00, currency: 'USD' },
        }));

        const result = discovery.search({ maxCost: 0.05 });
        expect(result.agents).toHaveLength(1);
      });

      it('treats free agents as zero cost', () => {
        registry.register(makeListing({ pricing: { model: 'free', currency: 'USD' } }));

        const result = discovery.search({ maxCost: 0 });
        expect(result.agents).toHaveLength(1);
      });

      it('uses tokenRate as approximate cost for per-token agents', () => {
        registry.register(makeListing({
          pricing: { model: 'per-token', tokenRate: 0.002, currency: 'USD' },
        }));

        const result = discovery.search({ maxCost: 0.005 });
        expect(result.agents).toHaveLength(1);
      });

      it('uses avgCostPerCall for negotiated agents without baseCost', () => {
        registry.register(makeListing({
          pricing: { model: 'negotiated', currency: 'USD' },
          quality: { rating: 4.0, totalCalls: 50, successRate: 0.9, avgLatencyMs: 100, avgCostPerCall: 0.02 },
        }));

        const result = discovery.search({ maxCost: 0.05 });
        expect(result.agents).toHaveLength(1);
      });
    });

    // Rating filter
    describe('rating filtering', () => {
      it('filters by minRating', () => {
        registry.register(makeListing({
          quality: { rating: 4.5, totalCalls: 100, successRate: 0.95, avgLatencyMs: 200, avgCostPerCall: 0.01 },
        }));
        registry.register(makeListing({
          name: 'LowRated',
          quality: { rating: 2.0, totalCalls: 10, successRate: 0.5, avgLatencyMs: 500, avgCostPerCall: 0.05 },
        }));

        const result = discovery.search({ minRating: 3.0 });
        expect(result.agents).toHaveLength(1);
      });
    });

    // Success rate filter
    describe('success rate filtering', () => {
      it('filters by minSuccessRate', () => {
        registry.register(makeListing({
          quality: { rating: 4.0, totalCalls: 100, successRate: 0.98, avgLatencyMs: 200, avgCostPerCall: 0.01 },
        }));
        registry.register(makeListing({
          name: 'LowSuccess',
          quality: { rating: 4.0, totalCalls: 100, successRate: 0.5, avgLatencyMs: 200, avgCostPerCall: 0.01 },
        }));

        const result = discovery.search({ minSuccessRate: 0.9 });
        expect(result.agents).toHaveLength(1);
      });
    });

    // Sorting
    describe('sorting', () => {
      it('sorts by rating descending by default', () => {
        registry.register(makeListing({
          name: 'Low',
          quality: { rating: 2.0, totalCalls: 10, successRate: 0.5, avgLatencyMs: 500, avgCostPerCall: 0.05 },
        }));
        registry.register(makeListing({
          name: 'High',
          quality: { rating: 5.0, totalCalls: 500, successRate: 0.99, avgLatencyMs: 50, avgCostPerCall: 0.01 },
        }));

        const result = discovery.search({});
        expect(result.agents[0].name).toBe('High');
        expect(result.agents[1].name).toBe('Low');
      });

      it('sorts by cost ascending', () => {
        registry.register(makeListing({ name: 'Cheap', pricing: { model: 'per-call', baseCost: 0.001, currency: 'USD' } }));
        registry.register(makeListing({ name: 'Expensive', pricing: { model: 'per-call', baseCost: 1.00, currency: 'USD' } }));

        const result = discovery.search({ sortBy: 'cost', sortOrder: 'asc' });
        expect(result.agents[0].name).toBe('Cheap');
      });

      it('sorts by latency ascending', () => {
        registry.register(makeListing({
          name: 'Fast',
          quality: { rating: 4.0, totalCalls: 100, successRate: 0.9, avgLatencyMs: 50, avgCostPerCall: 0.01 },
        }));
        registry.register(makeListing({
          name: 'Slow',
          quality: { rating: 4.0, totalCalls: 100, successRate: 0.9, avgLatencyMs: 5000, avgCostPerCall: 0.01 },
        }));

        const result = discovery.search({ sortBy: 'latency', sortOrder: 'asc' });
        expect(result.agents[0].name).toBe('Fast');
      });

      it('sorts by popularity descending', () => {
        registry.register(makeListing({
          name: 'Popular',
          quality: { rating: 4.0, totalCalls: 10000, successRate: 0.9, avgLatencyMs: 200, avgCostPerCall: 0.01 },
        }));
        registry.register(makeListing({
          name: 'Unpopular',
          quality: { rating: 4.0, totalCalls: 5, successRate: 0.9, avgLatencyMs: 200, avgCostPerCall: 0.01 },
        }));

        const result = discovery.search({ sortBy: 'popularity', sortOrder: 'desc' });
        expect(result.agents[0].name).toBe('Popular');
      });

      it('sorts by rating ascending', () => {
        registry.register(makeListing({
          name: 'Low',
          quality: { rating: 1.0, totalCalls: 10, successRate: 0.5, avgLatencyMs: 500, avgCostPerCall: 0.05 },
        }));
        registry.register(makeListing({
          name: 'High',
          quality: { rating: 5.0, totalCalls: 500, successRate: 0.99, avgLatencyMs: 50, avgCostPerCall: 0.01 },
        }));

        const result = discovery.search({ sortBy: 'rating', sortOrder: 'asc' });
        expect(result.agents[0].name).toBe('Low');
      });
    });

    // Pagination
    describe('pagination', () => {
      it('applies limit', () => {
        for (let i = 0; i < 10; i++) {
          registry.register(makeListing({ name: `Agent${i}` }));
        }

        const result = discovery.search({ limit: 3 });
        expect(result.agents).toHaveLength(3);
        expect(result.total).toBe(10);
      });

      it('applies offset', () => {
        for (let i = 0; i < 5; i++) {
          registry.register(makeListing({
            name: `Agent${i}`,
            quality: { rating: 5 - i, totalCalls: 100, successRate: 0.9, avgLatencyMs: 200, avgCostPerCall: 0.01 },
          }));
        }

        const result = discovery.search({ offset: 2, limit: 2, sortBy: 'rating', sortOrder: 'desc' });
        expect(result.agents).toHaveLength(2);
        expect(result.total).toBe(5);
      });

      it('defaults to limit 20 and offset 0', () => {
        for (let i = 0; i < 25; i++) {
          registry.register(makeListing({ name: `Agent${i}` }));
        }

        const result = discovery.search({});
        expect(result.agents).toHaveLength(20);
        expect(result.total).toBe(25);
      });

      it('returns empty when offset exceeds total', () => {
        registry.register(makeListing());

        const result = discovery.search({ offset: 100 });
        expect(result.agents).toHaveLength(0);
        expect(result.total).toBe(1);
      });
    });

    // Combined filters
    describe('combined filters', () => {
      it('applies text + capabilities + cost filters together', () => {
        registry.register(makeListing({
          name: 'PerfectMatch',
          description: 'typescript code gen',
          capabilities: ['code-generation'],
          pricing: { model: 'per-call', baseCost: 0.01, currency: 'USD' },
        }));
        registry.register(makeListing({
          name: 'WrongCap',
          description: 'typescript translation',
          capabilities: ['translation'],
          pricing: { model: 'per-call', baseCost: 0.01, currency: 'USD' },
        }));
        registry.register(makeListing({
          name: 'TooExpensive',
          description: 'typescript code gen',
          capabilities: ['code-generation'],
          pricing: { model: 'per-call', baseCost: 100.0, currency: 'USD' },
        }));

        const result = discovery.search({
          text: 'typescript',
          capabilities: ['code-generation'],
          maxCost: 1.0,
        });
        expect(result.agents).toHaveLength(1);
        expect(result.agents[0].name).toBe('PerfectMatch');
      });

      it('applies all filters simultaneously', () => {
        registry.register(makeListing({
          name: 'FullFilter',
          capabilities: ['code-gen'],
          tags: ['ts'],
          quality: { rating: 4.0, totalCalls: 200, successRate: 0.95, avgLatencyMs: 100, avgCostPerCall: 0.01 },
          pricing: { model: 'per-call', baseCost: 0.01, currency: 'USD' },
        }));

        const result = discovery.search({
          text: 'FullFilter',
          capabilities: ['code-gen'],
          tags: ['ts'],
          maxCost: 1.0,
          minRating: 3.0,
          minSuccessRate: 0.9,
          sortBy: 'rating',
          sortOrder: 'desc',
          limit: 10,
          offset: 0,
        });
        expect(result.agents).toHaveLength(1);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // REMOTE DISCOVERY — discoverRemote()
  // ─────────────────────────────────────────────────────────────

  describe('discoverRemote()', () => {
    it('returns null when fetch fails', async () => {
      const result = await discovery.discoverRemote('https://example.com');
      expect(result).toBeNull();
    });

    it('returns null for unreachable URLs', async () => {
      const result = await discovery.discoverRemote('https://nonexistent.invalid');
      expect(result).toBeNull();
    });

    it('strips trailing slashes from URL', async () => {
      const result = await discovery.discoverRemote('https://example.com///');
      expect(result).toBeNull(); // Still null since mocked, but should not throw
    });

    it('handles http URLs', async () => {
      const result = await discovery.discoverRemote('http://localhost:3000');
      expect(result).toBeNull();
    });

    it('does not throw on any network failure', async () => {
      await expect(discovery.discoverRemote('https://totally-broken.invalid')).resolves.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SCAN ENDPOINTS — scanEndpoints()
  // ─────────────────────────────────────────────────────────────

  describe('scanEndpoints()', () => {
    it('returns empty array when no URLs discover successfully', async () => {
      const results = await discovery.scanEndpoints([
        'https://bad1.invalid',
        'https://bad2.invalid',
      ]);
      expect(results).toEqual([]);
    });

    it('sets lastScanAt timestamp', async () => {
      const before = Date.now();
      await discovery.scanEndpoints([]);
      const stats = discovery.getStats();
      expect(stats.lastScanAt).toBeDefined();
      expect(stats.lastScanAt!).toBeGreaterThanOrEqual(before);
    });

    it('handles empty URL list', async () => {
      const results = await discovery.scanEndpoints([]);
      expect(results).toEqual([]);
    });

    it('processes URLs sequentially', async () => {
      const callOrder: string[] = [];
      const origDiscoverRemote = discovery.discoverRemote.bind(discovery);
      vi.spyOn(discovery, 'discoverRemote').mockImplementation(async (url: string) => {
        callOrder.push(url);
        return origDiscoverRemote(url);
      });

      await discovery.scanEndpoints(['https://a.com', 'https://b.com', 'https://c.com']);
      expect(callOrder).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // INTELLIGENT SELECTION — findBest()
  // ─────────────────────────────────────────────────────────────

  describe('findBest()', () => {
    it('returns the best agent for a capability', () => {
      registry.register(makeListing({
        name: 'Good',
        capabilities: ['code-generation'],
        quality: { rating: 4.5, totalCalls: 500, successRate: 0.98, avgLatencyMs: 100, avgCostPerCall: 0.01 },
        pricing: { model: 'per-call', baseCost: 0.01, currency: 'USD' },
      }));
      registry.register(makeListing({
        name: 'Average',
        capabilities: ['code-generation'],
        quality: { rating: 3.0, totalCalls: 50, successRate: 0.7, avgLatencyMs: 500, avgCostPerCall: 0.05 },
        pricing: { model: 'per-call', baseCost: 0.05, currency: 'USD' },
      }));

      const best = discovery.findBest('code-generation');
      expect(best).toBeDefined();
      expect(best!.name).toBe('Good');
    });

    it('returns null when no agents match', () => {
      registry.register(makeListing({ capabilities: ['translation'] }));

      const result = discovery.findBest('quantum-computing');
      expect(result).toBeNull();
    });

    it('returns null with empty registry', () => {
      const result = discovery.findBest('anything');
      expect(result).toBeNull();
    });

    it('respects maxCost constraint', () => {
      registry.register(makeListing({
        name: 'Expensive',
        capabilities: ['code-generation'],
        pricing: { model: 'per-call', baseCost: 10.0, currency: 'USD' },
        quality: { rating: 5.0, totalCalls: 1000, successRate: 0.99, avgLatencyMs: 50, avgCostPerCall: 10.0 },
      }));
      registry.register(makeListing({
        name: 'Cheap',
        capabilities: ['code-generation'],
        pricing: { model: 'per-call', baseCost: 0.01, currency: 'USD' },
        quality: { rating: 3.0, totalCalls: 100, successRate: 0.9, avgLatencyMs: 200, avgCostPerCall: 0.01 },
      }));

      const best = discovery.findBest('code-generation', { maxCost: 0.05 });
      expect(best).toBeDefined();
      expect(best!.name).toBe('Cheap');
    });

    it('respects minRating constraint', () => {
      registry.register(makeListing({
        name: 'HighRated',
        capabilities: ['analysis'],
        quality: { rating: 4.8, totalCalls: 200, successRate: 0.95, avgLatencyMs: 150, avgCostPerCall: 0.02 },
      }));
      registry.register(makeListing({
        name: 'LowRated',
        capabilities: ['analysis'],
        quality: { rating: 1.5, totalCalls: 20, successRate: 0.6, avgLatencyMs: 800, avgCostPerCall: 0.08 },
      }));

      const best = discovery.findBest('analysis', { minRating: 4.0 });
      expect(best).toBeDefined();
      expect(best!.name).toBe('HighRated');
    });

    it('prefers free agents when quality is comparable', () => {
      registry.register(makeListing({
        name: 'FreeAgent',
        capabilities: ['testing'],
        pricing: { model: 'free', currency: 'USD' },
        quality: { rating: 4.0, totalCalls: 100, successRate: 0.9, avgLatencyMs: 200, avgCostPerCall: 0 },
      }));
      registry.register(makeListing({
        name: 'PaidAgent',
        capabilities: ['testing'],
        pricing: { model: 'per-call', baseCost: 0.50, currency: 'USD' },
        quality: { rating: 4.0, totalCalls: 100, successRate: 0.9, avgLatencyMs: 200, avgCostPerCall: 0.50 },
      }));

      const best = discovery.findBest('testing');
      expect(best).toBeDefined();
      expect(best!.name).toBe('FreeAgent');
    });

    it('considers latency in scoring', () => {
      registry.register(makeListing({
        name: 'FastAgent',
        capabilities: ['search'],
        quality: { rating: 4.0, totalCalls: 100, successRate: 0.9, avgLatencyMs: 10, avgCostPerCall: 0.01 },
        pricing: { model: 'free', currency: 'USD' },
      }));
      registry.register(makeListing({
        name: 'SlowAgent',
        capabilities: ['search'],
        quality: { rating: 4.0, totalCalls: 100, successRate: 0.9, avgLatencyMs: 10000, avgCostPerCall: 0.01 },
        pricing: { model: 'free', currency: 'USD' },
      }));

      const best = discovery.findBest('search');
      expect(best).toBeDefined();
      expect(best!.name).toBe('FastAgent');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // RECOMMENDATION — recommend()
  // ─────────────────────────────────────────────────────────────

  describe('recommend()', () => {
    it('returns agents matching task description keywords', () => {
      registry.register(makeListing({
        name: 'CodeBot',
        capabilities: ['code-generation'],
        tags: ['typescript'],
        description: 'generates typescript code',
      }));
      registry.register(makeListing({
        name: 'TranslateBot',
        capabilities: ['translation'],
        tags: ['language'],
        description: 'translates text between languages',
      }));

      const results = discovery.recommend('I need to generate typescript code');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe('CodeBot');
    });

    it('returns empty for empty description', () => {
      registry.register(makeListing());
      const results = discovery.recommend('');
      expect(results).toEqual([]);
    });

    it('returns empty when only stop words in description', () => {
      registry.register(makeListing());
      const results = discovery.recommend('the a an is are');
      expect(results).toEqual([]);
    });

    it('returns empty for short words under 3 characters', () => {
      registry.register(makeListing());
      const results = discovery.recommend('do it me');
      expect(results).toEqual([]);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        registry.register(makeListing({
          name: `Agent${i}`,
          capabilities: ['code'],
          tags: ['code'],
        }));
      }

      const results = discovery.recommend('code generation agent', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('defaults limit to 5', () => {
      for (let i = 0; i < 10; i++) {
        registry.register(makeListing({
          name: `Agent${i}`,
          capabilities: ['code'],
          tags: ['code'],
        }));
      }

      const results = discovery.recommend('code generation agent');
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('ranks agents with higher quality higher', () => {
      registry.register(makeListing({
        name: 'HighQuality',
        capabilities: ['analysis'],
        tags: ['analysis'],
        quality: { rating: 5.0, totalCalls: 1000, successRate: 1.0, avgLatencyMs: 50, avgCostPerCall: 0.01 },
      }));
      registry.register(makeListing({
        name: 'LowQuality',
        capabilities: ['analysis'],
        tags: ['analysis'],
        quality: { rating: 1.0, totalCalls: 5, successRate: 0.2, avgLatencyMs: 5000, avgCostPerCall: 0.5 },
      }));

      const results = discovery.recommend('analysis task');
      expect(results.length).toBe(2);
      expect(results[0].name).toBe('HighQuality');
    });

    it('gives higher weight to capability matches than tag matches', () => {
      registry.register(makeListing({
        name: 'CapMatch',
        capabilities: ['deployment'],
        tags: ['other'],
        quality: { rating: 3.0, totalCalls: 50, successRate: 0.8, avgLatencyMs: 200, avgCostPerCall: 0.01 },
      }));
      registry.register(makeListing({
        name: 'TagMatch',
        capabilities: ['other'],
        tags: ['deployment'],
        quality: { rating: 3.0, totalCalls: 50, successRate: 0.8, avgLatencyMs: 200, avgCostPerCall: 0.01 },
      }));

      const results = discovery.recommend('deployment automation');
      expect(results[0].name).toBe('CapMatch');
    });

    it('ignores inactive agents', () => {
      registry.register(makeListing({
        name: 'InactiveBot',
        capabilities: ['code'],
        tags: ['code'],
        status: 'inactive',
      }));

      const results = discovery.recommend('code generation');
      expect(results).toHaveLength(0);
    });

    it('does not recommend agents with zero relevance score', () => {
      registry.register(makeListing({
        name: 'IrrelevantBot',
        capabilities: ['cooking'],
        tags: ['recipes'],
        description: 'makes gourmet meals',
      }));

      const results = discovery.recommend('quantum computing algorithms');
      expect(results).toHaveLength(0);
    });

    it('matches name keywords', () => {
      registry.register(makeListing({
        name: 'SecurityScanner',
        capabilities: ['scanning'],
        tags: ['security'],
      }));

      const results = discovery.recommend('run a security scan');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('strips special characters from task description', () => {
      registry.register(makeListing({
        name: 'CodeBot',
        capabilities: ['code-generation'],
        tags: ['typescript'],
      }));

      const results = discovery.recommend('I need @code generation!!! for $$$ typescript');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // STATS — getStats()
  // ─────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('tracks total searches', () => {
      discovery.search({});
      discovery.search({});
      const stats = discovery.getStats();
      expect(stats.totalSearches).toBe(2);
    });

    it('returns lastScanAt as undefined before any scan', () => {
      const stats = discovery.getStats();
      expect(stats.lastScanAt).toBeUndefined();
    });

    it('updates lastScanAt after scan', async () => {
      await discovery.scanEndpoints([]);
      const stats = discovery.getStats();
      expect(stats.lastScanAt).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // EDGE CASES
  // ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty registry gracefully', () => {
      const result = discovery.search({ text: 'something' });
      expect(result.agents).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('handles agents with empty capabilities and tags', () => {
      registry.register(makeListing({ capabilities: [], tags: [] }));

      const result = discovery.search({});
      expect(result.agents).toHaveLength(1);
    });

    it('handles agents with subscription pricing for cost filter', () => {
      registry.register(makeListing({
        pricing: { model: 'subscription', baseCost: 9.99, currency: 'USD' },
      }));

      const result = discovery.search({ maxCost: 10.0 });
      expect(result.agents).toHaveLength(1);
    });

    it('handles agents with no pricing baseCost and no tokenRate', () => {
      registry.register(makeListing({
        pricing: { model: 'per-call', currency: 'USD' },
        quality: { rating: 4.0, totalCalls: 50, successRate: 0.9, avgLatencyMs: 100, avgCostPerCall: 0.03 },
      }));

      // Should fall through to avgCostPerCall = 0.03
      const result = discovery.search({ maxCost: 0.05 });
      expect(result.agents).toHaveLength(1);
    });

    it('search returns executionTimeMs as a non-negative number', () => {
      registry.register(makeListing());
      const result = discovery.search({});
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.executionTimeMs).toBe('number');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // STRESS TESTS
  // ─────────────────────────────────────────────────────────────

  describe('stress tests', () => {
    it('handles large registry with many agents', () => {
      for (let i = 0; i < 500; i++) {
        registry.register(makeListing({
          name: `Agent-${i}`,
          capabilities: [`cap-${i % 10}`],
          tags: [`tag-${i % 20}`],
          quality: {
            rating: (i % 50) / 10,
            totalCalls: i * 10,
            successRate: Math.min(1, (i % 100) / 100),
            avgLatencyMs: 50 + i,
            avgCostPerCall: 0.01 + (i % 100) / 10000,
          },
        }));
      }

      const result = discovery.search({
        capabilities: ['cap-5'],
        sortBy: 'rating',
        sortOrder: 'desc',
        limit: 10,
      });
      expect(result.agents.length).toBeLessThanOrEqual(10);
      expect(result.total).toBe(50); // 500 / 10 capabilities = 50 agents with cap-5
    });

    it('handles rapid successive searches', () => {
      registry.register(makeListing());

      for (let i = 0; i < 100; i++) {
        const result = discovery.search({ text: 'test' });
        expect(result).toBeDefined();
      }

      expect(discovery.getStats().totalSearches).toBe(100);
    });

    it('handles recommendation with large agent pool', () => {
      for (let i = 0; i < 200; i++) {
        registry.register(makeListing({
          name: `Agent${i}`,
          capabilities: ['code', 'testing', 'review'],
          tags: ['typescript', 'javascript', 'python'],
        }));
      }

      const results = discovery.recommend('I need a code review agent for typescript', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('handles findBest with many candidates', () => {
      for (let i = 0; i < 100; i++) {
        registry.register(makeListing({
          name: `Agent${i}`,
          capabilities: ['code-generation'],
          quality: {
            rating: Math.random() * 5,
            totalCalls: Math.floor(Math.random() * 1000),
            successRate: Math.random(),
            avgLatencyMs: Math.random() * 1000,
            avgCostPerCall: Math.random() * 0.1,
          },
        }));
      }

      const best = discovery.findBest('code-generation');
      expect(best).toBeDefined();
      expect(best!.capabilities).toContain('code-generation');
    });

    it('handles search with all sort fields', () => {
      for (let i = 0; i < 20; i++) {
        registry.register(makeListing({
          name: `Agent${i}`,
          quality: {
            rating: Math.random() * 5,
            totalCalls: Math.floor(Math.random() * 1000),
            successRate: Math.random(),
            avgLatencyMs: Math.random() * 1000,
            avgCostPerCall: Math.random() * 0.1,
          },
        }));
      }

      const sortFields: Array<'rating' | 'cost' | 'latency' | 'popularity'> = ['rating', 'cost', 'latency', 'popularity'];
      for (const sortBy of sortFields) {
        for (const sortOrder of ['asc', 'desc'] as const) {
          const result = discovery.search({ sortBy, sortOrder });
          expect(result.agents.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
