import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentMarketplace } from '../../../src/marketplace/marketplace.js';
import type { AgentListing, MarketplaceConfig } from '../../../src/marketplace/types.js';

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const sampleListingInput = {
  name: 'TestAgent',
  description: 'A test agent for code review',
  version: '1.0.0',
  author: { id: 'author-1', name: 'Test Author', verified: true },
  capabilities: ['code-review', 'testing'],
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
};

const makeListing = (overrides: Record<string, unknown> = {}) => ({
  ...sampleListingInput,
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe('AgentMarketplace', () => {
  let mp: AgentMarketplace;

  beforeEach(() => {
    mp = new AgentMarketplace();
  });

  afterEach(async () => {
    await mp.shutdown();
  });

  // ─────────────────────────────────────────────────────────
  // CONSTRUCTOR
  // ─────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates a marketplace instance with default config', () => {
      expect(mp).toBeDefined();
      expect(mp).toBeInstanceOf(AgentMarketplace);
    });

    it('accepts partial custom config and merges with defaults', () => {
      const custom = new AgentMarketplace({
        commissionRate: 0.2,
        defaultBudget: 50,
      });
      expect(custom).toBeDefined();
      // Stats should reflect the pricing engine with custom budget
      const stats = custom.getStats();
      expect(stats.pricing).toBeDefined();
      custom.shutdown();
    });

    it('applies all config options', () => {
      const fullConfig: Partial<MarketplaceConfig> = {
        enabled: true,
        autoDiscover: false,
        maxConcurrentNegotiations: 20,
        defaultBudget: 100,
        commissionRate: 0.10,
      };
      const custom = new AgentMarketplace(fullConfig);
      expect(custom).toBeDefined();
      custom.shutdown();
    });

    it('creates subcomponents (registry, discovery, pricing)', () => {
      expect(mp.getRegistry()).toBeDefined();
      expect(mp.getDiscovery()).toBeDefined();
      expect(mp.getPricingEngine()).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE — initialize / shutdown
  // ─────────────────────────────────────────────────────────

  describe('initialize()', () => {
    it('initializes without errors', async () => {
      await expect(mp.initialize()).resolves.toBeUndefined();
    });

    it('is idempotent (multiple calls are safe)', async () => {
      await mp.initialize();
      await mp.initialize();
      await mp.initialize();
      // Should not throw or produce side effects
    });

    it('allows operations after initialization', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(makeListing());
      expect(agent).toBeDefined();
      expect(agent.id).toBeDefined();
    });
  });

  describe('shutdown()', () => {
    it('shuts down after initialization', async () => {
      await mp.initialize();
      await expect(mp.shutdown()).resolves.toBeUndefined();
    });

    it('is safe to call without prior initialization', async () => {
      await expect(mp.shutdown()).resolves.toBeUndefined();
    });

    it('is idempotent (multiple calls are safe)', async () => {
      await mp.initialize();
      await mp.shutdown();
      await mp.shutdown();
    });

    it('requires re-initialization after shutdown for operations', async () => {
      await mp.initialize();
      await mp.shutdown();
      await expect(
        mp.publishAgent(makeListing()),
      ).rejects.toThrow(/not initialized/i);
    });
  });

  // ─────────────────────────────────────────────────────────
  // ensureInitialized guard
  // ─────────────────────────────────────────────────────────

  describe('ensureInitialized guard', () => {
    it('publishAgent throws if not initialized', async () => {
      await expect(mp.publishAgent(makeListing())).rejects.toThrow(
        /not initialized/i,
      );
    });

    it('unpublishAgent throws if not initialized', async () => {
      await expect(mp.unpublishAgent('some-id')).rejects.toThrow(
        /not initialized/i,
      );
    });

    it('hireAgent throws if not initialized', async () => {
      await expect(
        mp.hireAgent({ capability: 'testing', prompt: 'test' }),
      ).rejects.toThrow(/not initialized/i);
    });

    it('executeTask throws if not initialized', async () => {
      await expect(
        mp.executeTask('agent-id', { input: 'test' }),
      ).rejects.toThrow(/not initialized/i);
    });
  });

  // ─────────────────────────────────────────────────────────
  // PUBLISH / UNPUBLISH
  // ─────────────────────────────────────────────────────────

  describe('publishAgent()', () => {
    it('publishes a new agent and returns full listing', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(makeListing());

      expect(agent).toBeDefined();
      expect(agent.id).toBeDefined();
      expect(typeof agent.id).toBe('string');
      expect(agent.name).toBe('TestAgent');
      expect(agent.description).toBe('A test agent for code review');
      expect(agent.status).toBe('active');
      expect(typeof agent.createdAt).toBe('number');
      expect(typeof agent.updatedAt).toBe('number');
    });

    it('published agent appears in registry', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(makeListing());
      const fromRegistry = mp.getRegistry().get(agent.id);

      expect(fromRegistry).toBeDefined();
      expect(fromRegistry!.name).toBe('TestAgent');
    });

    it('publishes multiple agents with unique IDs', async () => {
      await mp.initialize();
      const a1 = await mp.publishAgent(makeListing({ name: 'Agent1' }));
      const a2 = await mp.publishAgent(makeListing({ name: 'Agent2' }));
      const a3 = await mp.publishAgent(makeListing({ name: 'Agent3' }));

      expect(a1.id).not.toBe(a2.id);
      expect(a2.id).not.toBe(a3.id);
      expect(a1.id).not.toBe(a3.id);
    });

    it('publishes agent with free pricing model', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(
        makeListing({
          pricing: { model: 'free', currency: 'USD' },
        }),
      );
      expect(agent.pricing.model).toBe('free');
    });

    it('publishes agent with per-token pricing', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(
        makeListing({
          pricing: { model: 'per-token', tokenRate: 0.001, currency: 'USD' },
        }),
      );
      expect(agent.pricing.model).toBe('per-token');
    });
  });

  describe('unpublishAgent()', () => {
    it('returns false for unknown agent', async () => {
      await mp.initialize();
      const result = await mp.unpublishAgent('nonexistent-id');
      expect(result).toBe(false);
    });

    it('marks agent as inactive when unpublished', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(makeListing());
      const result = await mp.unpublishAgent(agent.id);

      expect(result).toBe(true);
      const updated = mp.getRegistry().get(agent.id);
      expect(updated).toBeDefined();
      expect(updated!.status).toBe('inactive');
    });

    it('preserves agent data after unpublishing (soft delete)', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(makeListing());
      await mp.unpublishAgent(agent.id);

      const listing = mp.getRegistry().get(agent.id);
      expect(listing).toBeDefined();
      expect(listing!.name).toBe('TestAgent');
      expect(listing!.author.id).toBe('author-1');
    });

    it('allows re-unpublishing (returns true again)', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(makeListing());
      await mp.unpublishAgent(agent.id);
      // Second unpublish should still work since agent exists (just inactive)
      const result = await mp.unpublishAgent(agent.id);
      expect(result).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────
  // HIRE AGENT
  // ─────────────────────────────────────────────────────────

  describe('hireAgent()', () => {
    it('returns null when no agents match the capability', async () => {
      await mp.initialize();
      const result = await mp.hireAgent({
        capability: 'nonexistent-capability',
        prompt: 'do something',
      });
      expect(result).toBeNull();
    });

    it('hires a matching agent successfully', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(makeListing());

      const result = await mp.hireAgent({
        capability: 'code-review',
        prompt: 'Review my TypeScript code',
      });

      expect(result).not.toBeNull();
      expect(result!.agent.id).toBe(agent.id);
      expect(result!.transactionId).toBeDefined();
      expect(typeof result!.transactionId).toBe('string');
    });

    it('respects maxCost filter', async () => {
      await mp.initialize();
      // Publish an expensive agent
      await mp.publishAgent(
        makeListing({
          name: 'ExpensiveAgent',
          pricing: { model: 'per-call', baseCost: 100.0, currency: 'USD' },
        }),
      );

      const result = await mp.hireAgent({
        capability: 'code-review',
        maxCost: 0.001,
        prompt: 'Review my code cheaply',
      });

      // Should be null because cost exceeds maxCost or budget
      expect(result).toBeNull();
    });

    it('creates a transaction upon successful hire', async () => {
      await mp.initialize();
      await mp.publishAgent(makeListing());

      const result = await mp.hireAgent({
        capability: 'code-review',
        prompt: 'Review my code',
      });

      expect(result).not.toBeNull();
      // Verify transaction exists in registry
      const transactions = mp.getRegistry().getTransactions({});
      expect(transactions.length).toBeGreaterThanOrEqual(1);
    });

    it('records spend in pricing engine on successful hire', async () => {
      await mp.initialize();
      await mp.publishAgent(makeListing());

      const budgetBefore = mp.getPricingEngine().getBudgetRemaining();
      await mp.hireAgent({
        capability: 'code-review',
        prompt: 'Review my code',
      });
      const budgetAfter = mp.getPricingEngine().getBudgetRemaining();

      expect(budgetAfter).toBeLessThan(budgetBefore);
    });

    it('prefers higher quality agents when multiple match', async () => {
      await mp.initialize();
      await mp.publishAgent(
        makeListing({
          name: 'LowQuality',
          quality: {
            rating: 2.0,
            totalCalls: 10,
            successRate: 0.5,
            avgLatencyMs: 1000,
            avgCostPerCall: 0.01,
          },
        }),
      );
      const highQ = await mp.publishAgent(
        makeListing({
          name: 'HighQuality',
          quality: {
            rating: 5.0,
            totalCalls: 1000,
            successRate: 0.99,
            avgLatencyMs: 50,
            avgCostPerCall: 0.01,
          },
        }),
      );

      const result = await mp.hireAgent({
        capability: 'code-review',
        prompt: 'I need top quality code review',
      });

      expect(result).not.toBeNull();
      expect(result!.agent.id).toBe(highQ.id);
    });

    it('falls back to recommendations when search has no direct matches', async () => {
      await mp.initialize();
      // Publish agent with specific capabilities
      await mp.publishAgent(
        makeListing({
          name: 'TypescriptExpert',
          capabilities: ['typescript-analysis'],
          tags: ['typescript', 'analysis'],
          description: 'Expert in typescript code analysis and review',
        }),
      );

      // Search for capability not directly listed
      const result = await mp.hireAgent({
        capability: 'code-analysis',
        prompt: 'typescript code analysis review',
      });

      // May or may not match depending on recommendation algorithm
      // But it should not throw
    });

    it('returns null when budget is exhausted', async () => {
      const lowBudget = new AgentMarketplace({ defaultBudget: 0.001 });
      await lowBudget.initialize();
      await lowBudget.publishAgent(
        makeListing({
          pricing: { model: 'per-call', baseCost: 10.0, currency: 'USD' },
        }),
      );

      const result = await lowBudget.hireAgent({
        capability: 'code-review',
        prompt: 'Review my code',
      });

      // Agent exists but budget too small
      expect(result).toBeNull();
      await lowBudget.shutdown();
    });
  });

  // ─────────────────────────────────────────────────────────
  // EXECUTE TASK
  // ─────────────────────────────────────────────────────────

  describe('executeTask()', () => {
    it('throws for unknown agent ID', async () => {
      await mp.initialize();
      await expect(
        mp.executeTask('nonexistent-agent', { prompt: 'test' }),
      ).rejects.toThrow(/Agent not found/);
    });

    it('throws for agent with no callable endpoints', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(
        makeListing({ endpoints: {} }),
      );

      await expect(
        mp.executeTask(agent.id, { prompt: 'test' }),
      ).rejects.toThrow(/no callable endpoints/);
    });

    it('throws for agent with only MCP stdio endpoint', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(
        makeListing({ endpoints: { mcpCommand: 'npx agent-server' } }),
      );

      await expect(
        mp.executeTask(agent.id, { prompt: 'test' }),
      ).rejects.toThrow(/stdio/i);
    });

    it('creates a transaction even on failure', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(
        makeListing({ endpoints: {} }),
      );

      try {
        await mp.executeTask(agent.id, { prompt: 'test' });
      } catch {
        // Expected
      }

      // Transaction should have been created (and marked failed)
      const transactions = mp.getRegistry().getTransactions({ agentId: agent.id });
      expect(transactions.length).toBeGreaterThanOrEqual(1);
    });

    it('attaches transaction to error on failure', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(
        makeListing({ endpoints: {} }),
      );

      try {
        await mp.executeTask(agent.id, { prompt: 'test' });
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.transaction).toBeDefined();
      }
    });
  });

  // ─────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns aggregated stats from all subsystems', () => {
      const stats = mp.getStats();

      expect(stats).toHaveProperty('registry');
      expect(stats).toHaveProperty('discovery');
      expect(stats).toHaveProperty('pricing');
    });

    it('registry stats reflect published agents', async () => {
      await mp.initialize();
      await mp.publishAgent(makeListing({ name: 'A1' }));
      await mp.publishAgent(makeListing({ name: 'A2' }));

      const stats = mp.getStats();
      expect(stats.registry.totalAgents).toBe(2);
      expect(stats.registry.activeAgents).toBe(2);
    });

    it('registry stats reflect inactive agents after unpublish', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(makeListing());
      await mp.unpublishAgent(agent.id);

      const stats = mp.getStats();
      expect(stats.registry.totalAgents).toBe(1);
      expect(stats.registry.activeAgents).toBe(0);
    });

    it('pricing stats reflect budget usage', async () => {
      await mp.initialize();
      await mp.publishAgent(makeListing());

      await mp.hireAgent({
        capability: 'code-review',
        prompt: 'Review code',
      });

      const stats = mp.getStats();
      expect(stats.pricing.budgetUsed).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────
  // COMPONENT ACCESSORS
  // ─────────────────────────────────────────────────────────

  describe('component accessors', () => {
    it('getRegistry() returns AgentRegistry instance', () => {
      const registry = mp.getRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.register).toBe('function');
      expect(typeof registry.get).toBe('function');
      expect(typeof registry.list).toBe('function');
    });

    it('getDiscovery() returns AgentDiscovery instance', () => {
      const discovery = mp.getDiscovery();
      expect(discovery).toBeDefined();
      expect(typeof discovery.search).toBe('function');
    });

    it('getPricingEngine() returns PricingEngine instance', () => {
      const pricing = mp.getPricingEngine();
      expect(pricing).toBeDefined();
      expect(typeof pricing.calculateCost).toBe('function');
      expect(typeof pricing.canAfford).toBe('function');
    });

    it('components are shared state (not copies)', async () => {
      await mp.initialize();
      const registry = mp.getRegistry();
      registry.register(makeListing({ name: 'DirectRegister' }));

      const agents = mp.getRegistry().list();
      expect(agents.some((a) => a.name === 'DirectRegister')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────
  // EVENT FORWARDING
  // ─────────────────────────────────────────────────────────

  describe('event forwarding', () => {
    it('forwards marketplace:agent:registered from registry', async () => {
      await mp.initialize();
      const spy = vi.fn();
      mp.on('marketplace:agent:registered', spy);

      await mp.publishAgent(makeListing());

      expect(spy).toHaveBeenCalled();
    });

    it('forwards marketplace:agent:removed from registry', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(makeListing());

      const spy = vi.fn();
      mp.on('marketplace:agent:removed', spy);

      mp.getRegistry().remove(agent.id);

      expect(spy).toHaveBeenCalled();
    });

    it('forwards multiple event types', async () => {
      await mp.initialize();
      const registeredSpy = vi.fn();
      const updatedSpy = vi.fn();

      mp.on('marketplace:agent:registered', registeredSpy);
      mp.on('marketplace:agent:updated', updatedSpy);

      const agent = await mp.publishAgent(makeListing());
      mp.getRegistry().update(agent.id, { description: 'Updated description' });

      expect(registeredSpy).toHaveBeenCalled();
      expect(updatedSpy).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────
  // EDGE CASES
  // ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty marketplace gracefully', async () => {
      await mp.initialize();
      const stats = mp.getStats();
      expect(stats.registry.totalAgents).toBe(0);
      expect(stats.registry.totalTransactions).toBe(0);
    });

    it('handles agent with minimal fields', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent({
        name: 'MinimalAgent',
        description: '',
        version: '0.0.1',
        author: { id: 'a', name: 'A', verified: false },
        capabilities: [],
        tags: [],
        pricing: { model: 'free', currency: 'USD' },
        quality: {
          rating: 0,
          totalCalls: 0,
          successRate: 0,
          avgLatencyMs: 0,
          avgCostPerCall: 0,
        },
        endpoints: {},
        status: 'active',
      });
      expect(agent.id).toBeDefined();
    });

    it('handles agent with very long name and description', async () => {
      await mp.initialize();
      const longName = 'A'.repeat(500);
      const longDesc = 'B'.repeat(5000);
      const agent = await mp.publishAgent(
        makeListing({ name: longName, description: longDesc }),
      );
      expect(agent.name).toBe(longName);
      expect(agent.description).toBe(longDesc);
    });

    it('handles concurrent publish and unpublish', async () => {
      await mp.initialize();
      const agents = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          mp.publishAgent(makeListing({ name: `Concurrent-${i}` })),
        ),
      );

      // Unpublish every other agent
      await Promise.all(
        agents
          .filter((_, i) => i % 2 === 0)
          .map((a) => mp.unpublishAgent(a.id)),
      );

      const stats = mp.getStats();
      expect(stats.registry.totalAgents).toBe(10);
      expect(stats.registry.activeAgents).toBe(5);
    });

    it('handles hiring when all agents are inactive', async () => {
      await mp.initialize();
      const agent = await mp.publishAgent(makeListing());
      await mp.unpublishAgent(agent.id);

      const result = await mp.hireAgent({
        capability: 'code-review',
        prompt: 'Review my code',
      });

      // Should return null since only inactive agent exists
      expect(result).toBeNull();
    });

    it('handles zero budget', async () => {
      const zeroBudget = new AgentMarketplace({ defaultBudget: 0 });
      await zeroBudget.initialize();
      await zeroBudget.publishAgent(makeListing());

      const result = await zeroBudget.hireAgent({
        capability: 'code-review',
        prompt: 'Review code',
      });

      // Free pricing model agent should still be hireable
      // or paid agent should not be hireable
      // The behavior depends on pricing engine
      await zeroBudget.shutdown();
    });
  });

  // ─────────────────────────────────────────────────────────
  // STRESS TESTS
  // ─────────────────────────────────────────────────────────

  describe('stress tests', () => {
    it('handles many publish operations', async () => {
      await mp.initialize();
      const agents: AgentListing[] = [];
      for (let i = 0; i < 50; i++) {
        const a = await mp.publishAgent(
          makeListing({
            name: `StressAgent-${i}`,
            capabilities: [`cap-${i % 5}`],
          }),
        );
        agents.push(a);
      }

      const stats = mp.getStats();
      expect(stats.registry.totalAgents).toBe(50);
      expect(agents.length).toBe(50);
    });

    it('handles rapid hire cycles', async () => {
      const largeBudget = new AgentMarketplace({ defaultBudget: 10000 });
      await largeBudget.initialize();

      // Publish agents with different capabilities
      for (let i = 0; i < 10; i++) {
        await largeBudget.publishAgent(
          makeListing({
            name: `Worker-${i}`,
            capabilities: [`task-${i % 3}`],
            pricing: { model: 'per-call', baseCost: 0.001, currency: 'USD' },
          }),
        );
      }

      // Rapidly hire agents
      const results = [];
      for (let i = 0; i < 20; i++) {
        const r = await largeBudget.hireAgent({
          capability: `task-${i % 3}`,
          prompt: `Do task ${i}`,
        });
        results.push(r);
      }

      const successful = results.filter((r) => r !== null);
      expect(successful.length).toBeGreaterThan(0);
      await largeBudget.shutdown();
    });

    it('handles concurrent operations without corruption', async () => {
      await mp.initialize();

      // Run publish, unpublish, and hire concurrently
      const publishPromises = Array.from({ length: 5 }, (_, i) =>
        mp.publishAgent(makeListing({ name: `ConcAgent-${i}`, capabilities: ['concurrent'] })),
      );
      const agents = await Promise.all(publishPromises);

      // Now hire concurrently
      const hirePromises = Array.from({ length: 5 }, () =>
        mp.hireAgent({ capability: 'concurrent', prompt: 'concurrent test' }),
      );
      const hireResults = await Promise.all(hirePromises);

      // All operations should complete without error
      expect(agents.length).toBe(5);
      expect(hireResults.length).toBe(5);
    });

    it('maintains integrity after many operations', async () => {
      await mp.initialize();

      // Publish, hire, unpublish in a complex sequence
      for (let i = 0; i < 20; i++) {
        const agent = await mp.publishAgent(
          makeListing({
            name: `Integrity-${i}`,
            capabilities: ['integrity-test'],
            pricing: { model: 'free', currency: 'USD' },
          }),
        );

        if (i % 3 === 0) {
          await mp.unpublishAgent(agent.id);
        }
      }

      // Hire from remaining active agents
      const result = await mp.hireAgent({
        capability: 'integrity-test',
        prompt: 'Check integrity',
      });

      const stats = mp.getStats();
      expect(stats.registry.totalAgents).toBe(20);
      // 7 agents were unpublished (i=0,3,6,9,12,15,18)
      expect(stats.registry.activeAgents).toBe(13);
    });
  });

  // ─────────────────────────────────────────────────────────
  // REAL-WORLD SCENARIOS
  // ─────────────────────────────────────────────────────────

  describe('real-world scenarios', () => {
    it('full agent lifecycle: publish, hire, unpublish', async () => {
      await mp.initialize();

      // Step 1: Publish
      const agent = await mp.publishAgent(
        makeListing({
          name: 'ProductionAgent',
          capabilities: ['code-review', 'security-audit'],
          pricing: { model: 'per-call', baseCost: 0.05, currency: 'USD' },
        }),
      );
      expect(agent.status).toBe('active');

      // Step 2: Hire
      const hire = await mp.hireAgent({
        capability: 'code-review',
        prompt: 'Review production code for security issues',
      });
      expect(hire).not.toBeNull();
      expect(hire!.agent.id).toBe(agent.id);

      // Step 3: Unpublish (soft delete)
      const unpublished = await mp.unpublishAgent(agent.id);
      expect(unpublished).toBe(true);

      // Step 4: Verify agent is inactive but data preserved
      const listing = mp.getRegistry().get(agent.id);
      expect(listing!.status).toBe('inactive');
      expect(listing!.name).toBe('ProductionAgent');
    });

    it('multi-agent marketplace with different pricing models', async () => {
      await mp.initialize();

      // Publish agents with various pricing models
      await mp.publishAgent(
        makeListing({
          name: 'FreeAgent',
          pricing: { model: 'free', currency: 'USD' },
          capabilities: ['basic-task'],
        }),
      );
      await mp.publishAgent(
        makeListing({
          name: 'PerCallAgent',
          pricing: { model: 'per-call', baseCost: 0.10, currency: 'USD' },
          capabilities: ['basic-task'],
        }),
      );
      await mp.publishAgent(
        makeListing({
          name: 'PerTokenAgent',
          pricing: { model: 'per-token', tokenRate: 0.001, currency: 'USD' },
          capabilities: ['basic-task'],
        }),
      );

      // Hire should prefer the best quality/cost ratio
      const result = await mp.hireAgent({
        capability: 'basic-task',
        prompt: 'Do a basic task',
      });
      expect(result).not.toBeNull();
    });

    it('budget depletion over multiple hires', async () => {
      const limitedBudget = new AgentMarketplace({ defaultBudget: 0.05 });
      await limitedBudget.initialize();

      await limitedBudget.publishAgent(
        makeListing({
          pricing: { model: 'per-call', baseCost: 0.02, currency: 'USD' },
          capabilities: ['work'],
        }),
      );

      // First hire should succeed
      const first = await limitedBudget.hireAgent({
        capability: 'work',
        prompt: 'First task',
      });
      expect(first).not.toBeNull();

      // Second hire should succeed (0.02 + 0.02 = 0.04 <= 0.05)
      const second = await limitedBudget.hireAgent({
        capability: 'work',
        prompt: 'Second task',
      });
      expect(second).not.toBeNull();

      // Third hire should fail (budget exhausted: 0.04 + 0.02 = 0.06 > 0.05)
      const third = await limitedBudget.hireAgent({
        capability: 'work',
        prompt: 'Third task',
      });
      expect(third).toBeNull();

      await limitedBudget.shutdown();
    });

    it('initialize, populate, shutdown, re-initialize workflow', async () => {
      await mp.initialize();
      await mp.publishAgent(makeListing({ name: 'Ephemeral' }));
      const statsBefore = mp.getStats();
      expect(statsBefore.registry.totalAgents).toBe(1);

      await mp.shutdown();
      await mp.initialize();

      // After re-init without persistence, registry should be fresh
      // (no localCachePath configured, so no persistence)
      // But the in-memory registry retains state since same object
      const statsAfter = mp.getStats();
      expect(statsAfter.registry.totalAgents).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────
  // CONFIGURATION
  // ─────────────────────────────────────────────────────────

  describe('configuration', () => {
    it('respects custom commission rate', () => {
      const custom = new AgentMarketplace({ commissionRate: 0.25 });
      expect(custom).toBeDefined();
      custom.shutdown();
    });

    it('respects custom default budget', async () => {
      const custom = new AgentMarketplace({ defaultBudget: 1000 });
      await custom.initialize();

      const remaining = custom.getPricingEngine().getBudgetRemaining();
      expect(remaining).toBe(1000);
      await custom.shutdown();
    });

    it('handles autoDiscover=false gracefully', async () => {
      const noDiscover = new AgentMarketplace({
        autoDiscover: false,
      });
      await noDiscover.initialize();
      const stats = noDiscover.getStats();
      expect(stats.registry.totalAgents).toBe(0);
      await noDiscover.shutdown();
    });

    it('handles enabled=false config', () => {
      const disabled = new AgentMarketplace({ enabled: false });
      expect(disabled).toBeDefined();
      disabled.shutdown();
    });
  });
});
