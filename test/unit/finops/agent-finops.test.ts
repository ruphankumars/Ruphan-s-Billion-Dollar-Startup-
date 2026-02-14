import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentFinOps } from '../../../src/finops/agent-finops.js';

/** Helper to create a minimal consumption record input */
function makeConsumption(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'agent-1',
    model: 'gpt-4',
    inputTokens: 500,
    outputTokens: 200,
    cost: 0.03,
    duration: 1000,
    tags: { team: 'platform', env: 'test' },
    ...overrides,
  };
}

describe('AgentFinOps', () => {
  let finops: AgentFinOps;

  beforeEach(() => {
    finops = new AgentFinOps();
    finops.start();
  });

  afterEach(() => {
    finops.stop();
    finops.removeAllListeners();
  });

  // ── Constructor & Lifecycle ─────────────────────────────────────

  describe('constructor and lifecycle', () => {
    it('should create with default config', () => {
      const f = new AgentFinOps();
      expect(f.isRunning()).toBe(false);
      const stats = f.getStats();
      expect(stats.totalRecords).toBe(0);
      expect(stats.totalCost).toBe(0);
    });

    it('should accept custom config overrides', () => {
      const f = new AgentFinOps({ maxRecords: 50, rightsizingEnabled: false });
      expect(f.isRunning()).toBe(false);
    });

    it('should transition through start and stop', () => {
      const f = new AgentFinOps();
      expect(f.isRunning()).toBe(false);
      f.start();
      expect(f.isRunning()).toBe(true);
      f.stop();
      expect(f.isRunning()).toBe(false);
    });

    it('should emit started and stopped events', () => {
      const f = new AgentFinOps();
      const startedHandler = vi.fn();
      const stoppedHandler = vi.fn();
      f.on('finops:engine:started', startedHandler);
      f.on('finops:engine:stopped', stoppedHandler);
      f.start();
      expect(startedHandler).toHaveBeenCalledOnce();
      f.stop();
      expect(stoppedHandler).toHaveBeenCalledOnce();
    });
  });

  // ── recordConsumption ───────────────────────────────────────────

  describe('recordConsumption', () => {
    it('should create a record with generated id and timestamp', () => {
      const record = finops.recordConsumption(makeConsumption());
      expect(record.id).toMatch(/^cr-/);
      expect(record.timestamp).toBeGreaterThan(0);
      expect(record.agentId).toBe('agent-1');
      expect(record.cost).toBe(0.03);
    });

    it('should emit consumption:recorded event', () => {
      const handler = vi.fn();
      finops.on('finops:consumption:recorded', handler);
      finops.recordConsumption(makeConsumption());
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', cost: 0.03 }),
      );
    });

    it('should accumulate multiple records', () => {
      finops.recordConsumption(makeConsumption({ cost: 0.01 }));
      finops.recordConsumption(makeConsumption({ cost: 0.02 }));
      finops.recordConsumption(makeConsumption({ cost: 0.03 }));

      const stats = finops.getStats();
      expect(stats.totalRecords).toBe(3);
      expect(stats.totalCost).toBeCloseTo(0.06);
    });

    it('should trim records when exceeding maxRecords', () => {
      const f = new AgentFinOps({ maxRecords: 5 });
      f.start();

      for (let i = 0; i < 10; i++) {
        f.recordConsumption(makeConsumption({ cost: 0.01 * (i + 1) }));
      }

      const stats = f.getStats();
      expect(stats.totalRecords).toBe(5);
    });
  });

  // ── getConsumption ──────────────────────────────────────────────

  describe('getConsumption', () => {
    it('should filter by agentId', () => {
      finops.recordConsumption(makeConsumption({ agentId: 'a1' }));
      finops.recordConsumption(makeConsumption({ agentId: 'a2' }));
      finops.recordConsumption(makeConsumption({ agentId: 'a1' }));

      const results = finops.getConsumption({ agentId: 'a1' });
      expect(results).toHaveLength(2);
    });

    it('should filter by model', () => {
      finops.recordConsumption(makeConsumption({ model: 'gpt-4' }));
      finops.recordConsumption(makeConsumption({ model: 'claude-3-opus' }));

      const results = finops.getConsumption({ model: 'claude-3-opus' });
      expect(results).toHaveLength(1);
    });
  });

  // ── forecast ────────────────────────────────────────────────────

  describe('forecast', () => {
    it('should return zero forecast for agent with no records', () => {
      const result = finops.forecast('unknown-agent', 'daily');
      expect(result.estimatedCost).toBe(0);
      expect(result.confidence).toBe(0);
      expect(result.basedOnSamples).toBe(0);
    });

    it('should generate a forecast based on historical data', () => {
      // Record multiple consumption events with increasing timestamps
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        finops.recordConsumption(makeConsumption({
          agentId: 'forecast-agent',
          cost: 0.01,
          inputTokens: 100,
          outputTokens: 50,
        }));
      }

      const forecast = finops.forecast('forecast-agent', 'daily');
      expect(forecast.agentId).toBe('forecast-agent');
      expect(forecast.period).toBe('daily');
      expect(forecast.basedOnSamples).toBe(10);
      expect(forecast.estimatedCost).toBeGreaterThanOrEqual(0);
      expect(forecast.generatedAt).toBeGreaterThan(0);
    });

    it('should support different forecast periods', () => {
      for (let i = 0; i < 5; i++) {
        finops.recordConsumption(makeConsumption({ agentId: 'multi-period', cost: 0.02 }));
      }

      const hourly = finops.forecast('multi-period', 'hourly');
      const daily = finops.forecast('multi-period', 'daily');
      const weekly = finops.forecast('multi-period', 'weekly');

      expect(hourly.period).toBe('hourly');
      expect(daily.period).toBe('daily');
      expect(weekly.period).toBe('weekly');
    });
  });

  // ── getCostBreakdown ────────────────────────────────────────────

  describe('getCostBreakdown', () => {
    it('should break down costs by agent and model', () => {
      const now = Date.now();
      finops.recordConsumption(makeConsumption({ agentId: 'a1', model: 'gpt-4', cost: 0.10 }));
      finops.recordConsumption(makeConsumption({ agentId: 'a2', model: 'claude-3-opus', cost: 0.20 }));
      finops.recordConsumption(makeConsumption({ agentId: 'a1', model: 'gpt-4', cost: 0.05 }));

      const breakdown = finops.getCostBreakdown(now - 10_000, now + 10_000);
      expect(breakdown.total).toBeCloseTo(0.35);
      expect(breakdown.byAgent.get('a1')).toBeCloseTo(0.15);
      expect(breakdown.byAgent.get('a2')).toBeCloseTo(0.20);
      expect(breakdown.byModel.get('gpt-4')).toBeCloseTo(0.15);
      expect(breakdown.byModel.get('claude-3-opus')).toBeCloseTo(0.20);
    });

    it('should return empty breakdown for a time range with no records', () => {
      finops.recordConsumption(makeConsumption());
      const breakdown = finops.getCostBreakdown(0, 1);
      expect(breakdown.total).toBe(0);
    });
  });

  // ── getCostByTags ───────────────────────────────────────────────

  describe('getCostByTags', () => {
    it('should aggregate costs by matching tags', () => {
      finops.recordConsumption(makeConsumption({ cost: 0.05, tags: { team: 'alpha', env: 'prod' } }));
      finops.recordConsumption(makeConsumption({ cost: 0.10, tags: { team: 'alpha', env: 'prod' } }));
      finops.recordConsumption(makeConsumption({ cost: 0.20, tags: { team: 'beta', env: 'prod' } }));

      const result = finops.getCostByTags({ team: 'alpha' });
      expect(result.totalCost).toBeCloseTo(0.15);
      expect(result.recordCount).toBe(2);
    });
  });

  // ── Budget management ───────────────────────────────────────────

  describe('budget management', () => {
    it('should create a budget with generated id', () => {
      const budget = finops.createBudget({
        name: 'Team Budget',
        level: 'team',
        entityId: 'platform',
        limit: 100,
        period: 'monthly',
        alertThreshold: 0.8,
      });

      expect(budget.id).toMatch(/^bgt-/);
      expect(budget.spent).toBe(0);
      expect(budget.createdAt).toBeGreaterThan(0);
      expect(budget.limit).toBe(100);
    });

    it('should retrieve a budget by ID', () => {
      const budget = finops.createBudget({
        name: 'Agent Budget',
        level: 'agent',
        entityId: 'agent-1',
        limit: 50,
        period: 'daily',
        alertThreshold: 0.9,
      });

      expect(finops.getBudget(budget.id)).toBeDefined();
      expect(finops.getBudget(budget.id)?.name).toBe('Agent Budget');
      expect(finops.getBudget('bgt-nonexistent')).toBeUndefined();
    });

    it('should list all budgets', () => {
      finops.createBudget({
        name: 'B1', level: 'agent', entityId: 'a1',
        limit: 10, period: 'daily', alertThreshold: 0.8,
      });
      finops.createBudget({
        name: 'B2', level: 'team', entityId: 't1',
        limit: 100, period: 'monthly', alertThreshold: 0.8,
      });

      expect(finops.listBudgets()).toHaveLength(2);
      expect(finops.listBudgets('agent')).toHaveLength(1);
      expect(finops.listBudgets('team')).toHaveLength(1);
    });

    it('should emit budget:alert when threshold is exceeded', () => {
      const handler = vi.fn();
      finops.on('finops:budget:alert', handler);

      const budget = finops.createBudget({
        name: 'Alert Budget',
        level: 'agent',
        entityId: 'agent-1',
        limit: 1.0,
        period: 'daily',
        alertThreshold: 0.8,
      });

      finops.updateBudgetSpend(budget.id, 0.9);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ budgetId: budget.id, percentUsed: 0.9 }),
      );
    });

    it('should emit budget:exceeded when spend exceeds limit', () => {
      const handler = vi.fn();
      finops.on('finops:budget:exceeded', handler);

      const budget = finops.createBudget({
        name: 'Over Budget',
        level: 'agent',
        entityId: 'agent-1',
        limit: 1.0,
        period: 'daily',
        alertThreshold: 0.8,
      });

      finops.updateBudgetSpend(budget.id, 1.5);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ budgetId: budget.id }),
      );
    });

    it('should throw when updating spend for non-existent budget', () => {
      expect(() => finops.updateBudgetSpend('bgt-fake', 1.0)).toThrow(
        /Budget not found/,
      );
    });

    it('should auto-update matching budgets when recording consumption', () => {
      const budget = finops.createBudget({
        name: 'Agent-1 Budget',
        level: 'agent',
        entityId: 'agent-1',
        limit: 10.0,
        period: 'daily',
        alertThreshold: 0.8,
      });

      finops.recordConsumption(makeConsumption({ agentId: 'agent-1', cost: 0.50 }));
      const updated = finops.getBudget(budget.id);
      expect(updated?.spent).toBeCloseTo(0.50);
    });
  });

  // ── generateRecommendations ─────────────────────────────────────

  describe('generateRecommendations', () => {
    it('should return empty when rightsizingEnabled is false', () => {
      const f = new AgentFinOps({ rightsizingEnabled: false });
      f.start();
      f.recordConsumption(makeConsumption({ model: 'gpt-4', outputTokens: 50 }));
      const recs = f.generateRecommendations();
      expect(recs).toHaveLength(0);
    });

    it('should recommend cheaper models for simple tasks (low output tokens)', () => {
      // Record consumption with an expensive model and low output tokens
      for (let i = 0; i < 5; i++) {
        finops.recordConsumption(makeConsumption({
          agentId: 'simple-agent',
          model: 'gpt-4',
          inputTokens: 200,
          outputTokens: 50,
          cost: 0.03,
        }));
      }

      const recs = finops.generateRecommendations('simple-agent');
      expect(recs.length).toBeGreaterThanOrEqual(1);
      expect(recs[0].currentModel).toBe('gpt-4');
      expect(recs[0].estimatedSavings).toBeGreaterThan(0);
      expect(recs[0].reasoning).toContain('simple-agent');
    });

    it('should not recommend downgrades for models not in pricing', () => {
      for (let i = 0; i < 5; i++) {
        finops.recordConsumption(makeConsumption({
          agentId: 'custom-agent',
          model: 'custom-model-v1',
          outputTokens: 50,
          cost: 0.01,
        }));
      }

      const recs = finops.generateRecommendations('custom-agent');
      expect(recs).toHaveLength(0);
    });

    it('should emit recommendations:generated event', () => {
      const handler = vi.fn();
      finops.on('finops:recommendations:generated', handler);

      for (let i = 0; i < 3; i++) {
        finops.recordConsumption(makeConsumption({
          agentId: 'rec-agent',
          model: 'gpt-4',
          outputTokens: 30,
          cost: 0.05,
        }));
      }

      finops.generateRecommendations();
      expect(handler).toHaveBeenCalled();
    });
  });

  // ── generateReport ──────────────────────────────────────────────

  describe('generateReport', () => {
    it('should generate a comprehensive report for a time period', () => {
      const start = Date.now() - 10_000;
      finops.recordConsumption(makeConsumption({ agentId: 'a1', model: 'gpt-4', cost: 0.05 }));
      finops.recordConsumption(makeConsumption({ agentId: 'a2', model: 'claude-3-opus', cost: 0.10 }));
      const end = Date.now() + 10_000;

      const report = finops.generateReport(start, end);
      expect(report.periodStart).toBe(start);
      expect(report.periodEnd).toBe(end);
      expect(report.totalCost).toBeCloseTo(0.15);
      expect(report.byAgent).toHaveLength(2);
      expect(report.byModel).toHaveLength(2);
      expect(report.generatedAt).toBeGreaterThan(0);
    });

    it('should sort agents and models by cost descending', () => {
      const start = Date.now() - 10_000;
      finops.recordConsumption(makeConsumption({ agentId: 'cheap', cost: 0.01 }));
      finops.recordConsumption(makeConsumption({ agentId: 'expensive', cost: 0.50 }));
      const end = Date.now() + 10_000;

      const report = finops.generateReport(start, end);
      expect(report.byAgent[0].agentId).toBe('expensive');
      expect(report.byAgent[1].agentId).toBe('cheap');
    });
  });

  // ── getStats ────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct aggregate statistics', () => {
      finops.recordConsumption(makeConsumption({ agentId: 'a1', cost: 0.02, taskId: 'task-1' }));
      finops.recordConsumption(makeConsumption({ agentId: 'a1', cost: 0.03, taskId: 'task-2' }));
      finops.createBudget({
        name: 'B1', level: 'agent', entityId: 'a1',
        limit: 10, period: 'daily', alertThreshold: 0.8,
      });

      const stats = finops.getStats();
      expect(stats.totalRecords).toBe(2);
      expect(stats.totalCost).toBeCloseTo(0.05);
      expect(stats.totalTokens).toBe(1400); // (500+200)*2
      expect(stats.activeBudgets).toBe(1);
      expect(stats.avgCostPerTask).toBeCloseTo(0.025);
    });

    it('should report zero avgCostPerTask when no tasks exist', () => {
      finops.recordConsumption(makeConsumption({ taskId: undefined }));
      const stats = finops.getStats();
      expect(stats.avgCostPerTask).toBe(0);
    });
  });
});
