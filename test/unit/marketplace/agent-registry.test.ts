import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistry } from '../../../src/marketplace/agent-registry.js';
import type { AgentListing, AgentTransaction } from '../../../src/marketplace/types.js';

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  const sampleListing = {
    name: 'TestAgent',
    description: 'A test agent',
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
  };

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  describe('register()', () => {
    it('creates an agent listing', () => {
      const agent = registry.register(sampleListing);

      expect(agent).toBeDefined();
      expect(agent.id).toBeDefined();
      expect(typeof agent.id).toBe('string');
      expect(agent.name).toBe('TestAgent');
      expect(agent.description).toBe('A test agent');
      expect(typeof agent.createdAt).toBe('number');
      expect(typeof agent.updatedAt).toBe('number');
      expect(agent.status).toBe('active');
    });

    it('emits marketplace:agent:registered event', () => {
      const emitSpy = vi.fn();
      registry.on('marketplace:agent:registered', emitSpy);

      registry.register(sampleListing);

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('get()', () => {
    it('retrieves by ID', () => {
      const agent = registry.register(sampleListing);
      const retrieved = registry.get(agent.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(agent.id);
      expect(retrieved!.name).toBe('TestAgent');
    });

    it('returns undefined for unknown ID', () => {
      const result = registry.get('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('modifies listing', () => {
      const agent = registry.register(sampleListing);
      const updated = registry.update(agent.id, { name: 'UpdatedAgent' });

      expect(updated.name).toBe('UpdatedAgent');
      expect(updated.id).toBe(agent.id);
      expect(updated.createdAt).toBe(agent.createdAt);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(agent.updatedAt);
    });

    it('throws for unknown agent', () => {
      expect(() => registry.update('non-existent', { name: 'X' })).toThrow(
        'Agent not found',
      );
    });

    it('preserves ID and createdAt even if overwrite attempted', () => {
      const agent = registry.register(sampleListing);
      const updated = registry.update(agent.id, {
        id: 'new-id',
        createdAt: 0,
      } as any);

      expect(updated.id).toBe(agent.id);
      expect(updated.createdAt).toBe(agent.createdAt);
    });
  });

  describe('remove()', () => {
    it('deletes listing', () => {
      const agent = registry.register(sampleListing);
      const result = registry.remove(agent.id);

      expect(result).toBe(true);
      expect(registry.get(agent.id)).toBeUndefined();
    });

    it('returns false for unknown agent', () => {
      const result = registry.remove('non-existent');
      expect(result).toBe(false);
    });

    it('emits marketplace:agent:removed event', () => {
      const emitSpy = vi.fn();
      registry.on('marketplace:agent:removed', emitSpy);

      const agent = registry.register(sampleListing);
      registry.remove(agent.id);

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('list()', () => {
    it('returns all agents without filter', () => {
      registry.register(sampleListing);
      registry.register({ ...sampleListing, name: 'Agent2', status: 'inactive' as const });

      const agents = registry.list();
      expect(agents).toHaveLength(2);
    });

    it('filters by status', () => {
      registry.register(sampleListing);
      registry.register({ ...sampleListing, name: 'Agent2', status: 'inactive' as const });

      const active = registry.list({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('TestAgent');
    });
  });

  describe('recordCall()', () => {
    it('updates quality metrics', () => {
      const agent = registry.register(sampleListing);
      const initialCalls = agent.quality.totalCalls;

      registry.recordCall(agent.id, {
        success: true,
        latencyMs: 100,
        cost: 0.01,
        tokensUsed: 500,
      });

      const updated = registry.get(agent.id)!;
      expect(updated.quality.totalCalls).toBe(initialCalls + 1);
    });

    it('throws for unknown agent', () => {
      expect(() =>
        registry.recordCall('non-existent', {
          success: true,
          latencyMs: 100,
          cost: 0.01,
          tokensUsed: 500,
        }),
      ).toThrow('Agent not found');
    });
  });

  describe('createTransaction()', () => {
    it('creates a transaction with auto-generated ID and timestamp', () => {
      const tx = registry.createTransaction({
        buyerAgentId: 'buyer-1',
        sellerAgentId: 'seller-1',
        taskId: 'task-1',
        cost: 0.05,
        tokensUsed: 1000,
        status: 'pending',
      });

      expect(tx).toBeDefined();
      expect(tx.id).toBeDefined();
      expect(typeof tx.startedAt).toBe('number');
      expect(tx.buyerAgentId).toBe('buyer-1');
      expect(tx.sellerAgentId).toBe('seller-1');
      expect(tx.status).toBe('pending');
    });
  });

  describe('completeTransaction()', () => {
    it('marks transaction as completed', () => {
      const agent = registry.register(sampleListing);
      const tx = registry.createTransaction({
        buyerAgentId: 'buyer-1',
        sellerAgentId: agent.id,
        taskId: 'task-1',
        cost: 0.05,
        tokensUsed: 1000,
        status: 'pending',
      });

      registry.completeTransaction(tx.id, {
        success: true,
        tokensUsed: 1200,
      });

      const transactions = registry.getTransactions({ status: 'completed' });
      expect(transactions).toHaveLength(1);
      expect(transactions[0].status).toBe('completed');
      expect(transactions[0].completedAt).toBeDefined();
    });

    it('throws for unknown transaction', () => {
      expect(() =>
        registry.completeTransaction('non-existent', { success: true }),
      ).toThrow('Transaction not found');
    });
  });

  describe('getStats()', () => {
    it('returns correct counts', () => {
      registry.register(sampleListing);
      registry.register({
        ...sampleListing,
        name: 'Inactive',
        status: 'inactive' as const,
      });

      const stats = registry.getStats();
      expect(stats.totalAgents).toBe(2);
      expect(stats.activeAgents).toBe(1);
      expect(stats.totalTransactions).toBe(0);
      expect(stats.totalSpent).toBe(0);
    });
  });
});
