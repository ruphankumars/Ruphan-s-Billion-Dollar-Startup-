import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BudgetController, BudgetExceededError } from '../../../src/evolution/budget-controller.js';

describe('BudgetController', () => {
  let controller: BudgetController;

  beforeEach(() => {
    controller = new BudgetController();
  });

  // ─── Constructor and Defaults ───────────────────────────────────────────────

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const stats = controller.getStats();
      expect(stats.config.maxApiCalls).toBe(50);
      expect(stats.config.maxTokens).toBe(100000);
      expect(stats.config.maxTimeMs).toBe(120000);
      expect(stats.config.maxDepth).toBe(10);
      expect(stats.config.maxCostUsd).toBe(1.0);
      expect(stats.config.autoScale).toBe(false);
      expect(stats.config.tier).toBe('standard');
    });

    it('should accept partial configuration overrides', () => {
      const custom = new BudgetController({ maxApiCalls: 100, tier: 'enhanced' });
      const stats = custom.getStats();
      expect(stats.config.maxApiCalls).toBe(100);
      expect(stats.config.tier).toBe('enhanced');
      expect(stats.config.maxTokens).toBe(100000); // default preserved
    });

    it('should start in stopped state', () => {
      expect(controller.isRunning()).toBe(false);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe('start/stop/isRunning', () => {
    it('should transition to running on start()', () => {
      controller.start();
      expect(controller.isRunning()).toBe(true);
    });

    it('should transition to stopped and clear budgets on stop()', () => {
      controller.start();
      controller.createBudget('task-1');
      controller.stop();
      expect(controller.isRunning()).toBe(false);
      expect(controller.getBudget('task-1')).toBeUndefined();
    });

    it('should handle multiple start/stop cycles', () => {
      controller.start();
      controller.stop();
      controller.start();
      expect(controller.isRunning()).toBe(true);
    });
  });

  // ─── createBudget ───────────────────────────────────────────────────────────

  describe('createBudget', () => {
    it('should create a budget for a task', () => {
      const budget = controller.createBudget('task-1');
      expect(budget.apiCallsUsed).toBe(0);
      expect(budget.tokensUsed).toBe(0);
      expect(budget.costUsd).toBe(0);
      expect(budget.exhausted).toBe(false);
    });

    it('should apply standard tier multiplier (1.0x)', () => {
      const budget = controller.createBudget('task-1');
      expect(budget.remaining.apiCalls).toBe(50); // 50 * 1.0
    });

    it('should apply minimal tier multiplier (0.25x)', () => {
      const budget = controller.createBudget('task-1', { tier: 'minimal' });
      expect(budget.remaining.apiCalls).toBe(13); // ceil(50 * 0.25) = 13
    });

    it('should apply enhanced tier multiplier (2.0x)', () => {
      const budget = controller.createBudget('task-1', { tier: 'enhanced' });
      expect(budget.remaining.apiCalls).toBe(100); // 50 * 2.0
    });

    it('should apply critical tier multiplier (4.0x)', () => {
      const budget = controller.createBudget('task-1', { tier: 'critical' });
      expect(budget.remaining.apiCalls).toBe(200); // 50 * 4.0
    });

    it('should accept config overrides', () => {
      const budget = controller.createBudget('task-1', { maxApiCalls: 200 });
      expect(budget.remaining.apiCalls).toBe(200);
    });

    it('should increment totalBudgetsCreated', () => {
      expect(controller.getStats().totalBudgetsCreated).toBe(0);
      controller.createBudget('task-1');
      controller.createBudget('task-2');
      expect(controller.getStats().totalBudgetsCreated).toBe(2);
    });
  });

  // ─── recordApiCall ──────────────────────────────────────────────────────────

  describe('recordApiCall', () => {
    it('should increment API call count', () => {
      controller.createBudget('task-1');
      controller.recordApiCall('task-1');
      const budget = controller.getBudget('task-1')!;
      expect(budget.apiCallsUsed).toBe(1);
    });

    it('should add tokens and cost', () => {
      controller.createBudget('task-1');
      controller.recordApiCall('task-1', 500, 0.05);
      const budget = controller.getBudget('task-1')!;
      expect(budget.tokensUsed).toBe(500);
      expect(budget.costUsd).toBeCloseTo(0.05, 4);
    });

    it('should do nothing for unknown taskId', () => {
      // Should not throw
      controller.recordApiCall('nonexistent', 100, 0.01);
    });

    it('should emit budget:warning at 50% utilization', () => {
      const handler = vi.fn();
      controller.on('evolution:budget:warning', handler);
      controller.createBudget('task-1', { maxApiCalls: 10 });
      for (let i = 0; i < 5; i++) {
        controller.recordApiCall('task-1');
      }
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'medium' })
      );
    });

    it('should emit budget:warning at 80% utilization', () => {
      const handler = vi.fn();
      controller.on('evolution:budget:warning', handler);
      controller.createBudget('task-1', { maxApiCalls: 10 });
      for (let i = 0; i < 8; i++) {
        controller.recordApiCall('task-1');
      }
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'high' })
      );
    });

    it('should emit budget:exhausted at 100% utilization', () => {
      const handler = vi.fn();
      controller.on('evolution:budget:exhausted', handler);
      controller.createBudget('task-1', { maxApiCalls: 5 });
      for (let i = 0; i < 5; i++) {
        controller.recordApiCall('task-1');
      }
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-1' })
      );
    });
  });

  // ─── recordDepthIncrease / recordDepthDecrease ──────────────────────────────

  describe('recordDepthIncrease/recordDepthDecrease', () => {
    it('should increase current depth', () => {
      controller.createBudget('task-1');
      controller.recordDepthIncrease('task-1');
      controller.recordDepthIncrease('task-1');
      const budget = controller.getBudget('task-1')!;
      expect(budget.currentDepth).toBe(2);
    });

    it('should decrease current depth', () => {
      controller.createBudget('task-1');
      controller.recordDepthIncrease('task-1');
      controller.recordDepthIncrease('task-1');
      controller.recordDepthDecrease('task-1');
      const budget = controller.getBudget('task-1')!;
      expect(budget.currentDepth).toBe(1);
    });

    it('should not go below zero', () => {
      controller.createBudget('task-1');
      controller.recordDepthDecrease('task-1');
      controller.recordDepthDecrease('task-1');
      const budget = controller.getBudget('task-1')!;
      expect(budget.currentDepth).toBe(0);
    });

    it('should handle unknown taskId gracefully', () => {
      controller.recordDepthIncrease('nonexistent');
      controller.recordDepthDecrease('nonexistent');
      // Should not throw
    });
  });

  // ─── checkBudget ────────────────────────────────────────────────────────────

  describe('checkBudget', () => {
    it('should not throw when within budget', () => {
      controller.createBudget('task-1');
      expect(() => controller.checkBudget('task-1')).not.toThrow();
    });

    it('should throw BudgetExceededError when API calls exhausted', () => {
      controller.createBudget('task-1', { maxApiCalls: 2 });
      controller.recordApiCall('task-1');
      controller.recordApiCall('task-1');
      expect(() => controller.checkBudget('task-1')).toThrow(BudgetExceededError);
    });

    it('should throw BudgetExceededError when tokens exhausted', () => {
      controller.createBudget('task-1', { maxTokens: 100 });
      controller.recordApiCall('task-1', 150);
      expect(() => controller.checkBudget('task-1')).toThrow(BudgetExceededError);
    });

    it('should throw BudgetExceededError when depth exceeded', () => {
      controller.createBudget('task-1', { maxDepth: 2 });
      controller.recordDepthIncrease('task-1');
      controller.recordDepthIncrease('task-1');
      expect(() => controller.checkBudget('task-1')).toThrow(BudgetExceededError);
    });

    it('should throw BudgetExceededError when cost exceeded', () => {
      controller.createBudget('task-1', { maxCostUsd: 0.10 });
      controller.recordApiCall('task-1', 0, 0.15);
      expect(() => controller.checkBudget('task-1')).toThrow(BudgetExceededError);
    });

    it('should include resource details in BudgetExceededError', () => {
      controller.createBudget('task-1', { maxApiCalls: 1 });
      controller.recordApiCall('task-1');
      try {
        controller.checkBudget('task-1');
        expect.unreachable('Should have thrown');
      } catch (e: unknown) {
        const err = e as BudgetExceededError;
        expect(err.resource).toBe('apiCalls');
        expect(err.used).toBe(1);
        expect(err.limit).toBe(1);
      }
    });

    it('should not throw for unknown taskId', () => {
      expect(() => controller.checkBudget('nonexistent')).not.toThrow();
    });
  });

  // ─── hasBudget ──────────────────────────────────────────────────────────────

  describe('hasBudget', () => {
    it('should return true when within budget', () => {
      controller.createBudget('task-1');
      expect(controller.hasBudget('task-1')).toBe(true);
    });

    it('should return false when budget exhausted', () => {
      controller.createBudget('task-1', { maxApiCalls: 1 });
      controller.recordApiCall('task-1');
      expect(controller.hasBudget('task-1')).toBe(false);
    });

    it('should return true for unknown taskId', () => {
      // checkBudget does nothing for unknown tasks, so hasBudget returns true
      expect(controller.hasBudget('nonexistent')).toBe(true);
    });
  });

  // ─── getUtilization ─────────────────────────────────────────────────────────

  describe('getUtilization', () => {
    it('should return 0 for unknown taskId', () => {
      expect(controller.getUtilization('nonexistent')).toBe(0);
    });

    it('should return utilization based on most-used resource', () => {
      controller.createBudget('task-1', { maxApiCalls: 10 });
      controller.recordApiCall('task-1');
      controller.recordApiCall('task-1');
      const util = controller.getUtilization('task-1');
      expect(util).toBeGreaterThanOrEqual(0.2); // at least 2/10
    });
  });

  // ─── scaleBudget ────────────────────────────────────────────────────────────

  describe('scaleBudget', () => {
    it('should do nothing if autoScale is disabled', () => {
      controller.createBudget('task-1'); // autoScale defaults to false
      const before = controller.getBudget('task-1')!;
      const apiCallsBefore = before.remaining.apiCalls;
      controller.scaleBudget('task-1', 2);
      const after = controller.getBudget('task-1')!;
      expect(after.remaining.apiCalls).toBe(apiCallsBefore);
    });

    it('should scale budget when autoScale is enabled', () => {
      controller.createBudget('task-1', { autoScale: true, maxApiCalls: 10 });
      controller.scaleBudget('task-1', 2);
      const budget = controller.getBudget('task-1')!;
      expect(budget.remaining.apiCalls).toBe(20); // 10 * 2
    });

    it('should reset exhausted flag on scale', () => {
      const c = new BudgetController({ autoScale: true, maxApiCalls: 2 });
      c.createBudget('task-1');
      c.recordApiCall('task-1');
      c.recordApiCall('task-1');
      c.scaleBudget('task-1', 3);
      const budget = c.getBudget('task-1')!;
      expect(budget.exhausted).toBe(false);
    });
  });

  // ─── releaseBudget ──────────────────────────────────────────────────────────

  describe('releaseBudget', () => {
    it('should remove budget and return final state', () => {
      controller.createBudget('task-1');
      controller.recordApiCall('task-1', 100, 0.01);
      const finalState = controller.releaseBudget('task-1');
      expect(finalState).toBeDefined();
      expect(finalState!.apiCallsUsed).toBe(1);
      expect(controller.getBudget('task-1')).toBeUndefined();
    });

    it('should return undefined for unknown taskId', () => {
      expect(controller.releaseBudget('nonexistent')).toBeUndefined();
    });

    it('should increment totalBudgetsExhausted on release of exhausted budget', () => {
      controller.createBudget('task-1', { maxApiCalls: 1 });
      controller.recordApiCall('task-1');
      // Force exhausted state
      try { controller.checkBudget('task-1'); } catch { /* expected */ }
      controller.releaseBudget('task-1');
      expect(controller.getStats().totalBudgetsExhausted).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── BudgetExceededError ────────────────────────────────────────────────────

  describe('BudgetExceededError', () => {
    it('should have correct name and properties', () => {
      const err = new BudgetExceededError('tokens', 5000, 4000);
      expect(err.name).toBe('BudgetExceededError');
      expect(err.resource).toBe('tokens');
      expect(err.used).toBe(5000);
      expect(err.limit).toBe(4000);
      expect(err.message).toContain('tokens');
    });

    it('should be instanceof Error', () => {
      const err = new BudgetExceededError('apiCalls', 10, 5);
      expect(err instanceof Error).toBe(true);
    });
  });

  // ─── getStats ───────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return comprehensive stats object', () => {
      const stats = controller.getStats();
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('activeBudgets');
      expect(stats).toHaveProperty('totalBudgetsCreated');
      expect(stats).toHaveProperty('totalBudgetsExhausted');
      expect(stats).toHaveProperty('exhaustionRate');
      expect(stats).toHaveProperty('config');
    });

    it('should compute exhaustionRate as 0 when no budgets created', () => {
      expect(controller.getStats().exhaustionRate).toBe(0);
    });

    it('should reflect active budgets count', () => {
      expect(controller.getStats().activeBudgets).toBe(0);
      controller.createBudget('task-1');
      expect(controller.getStats().activeBudgets).toBe(1);
      controller.releaseBudget('task-1');
      expect(controller.getStats().activeBudgets).toBe(0);
    });
  });
});
