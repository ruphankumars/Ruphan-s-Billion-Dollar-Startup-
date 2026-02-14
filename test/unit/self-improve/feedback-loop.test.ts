import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeedbackLoop } from '../../../src/self-improve/feedback-loop.js';

/** Helper to create a valid feedback input for recordOutcome(). */
function makeFeedback(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-1',
    outcome: 'success' as const,
    metrics: {
      quality: 0.9,
      speed: 0.8,
      cost: 0.7,
      tokenEfficiency: 0.6,
    },
    strategyUsed: 'chain-of-thought',
    context: { taskType: 'code-review' },
    ...overrides,
  };
}

describe('FeedbackLoop', () => {
  let loop: FeedbackLoop;

  beforeEach(() => {
    loop = new FeedbackLoop();
  });

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts and stops', () => {
      expect(loop.isRunning()).toBe(false);
      loop.start();
      expect(loop.isRunning()).toBe(true);
      loop.stop();
      expect(loop.isRunning()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // recordOutcome()
  // ─────────────────────────────────────────────────────────

  describe('recordOutcome()', () => {
    it('stores feedback and returns a record with id and timestamp', () => {
      const record = loop.recordOutcome(makeFeedback());

      expect(record.id).toMatch(/^fb_/);
      expect(record.timestamp).toBeLessThanOrEqual(Date.now());
      expect(record.taskId).toBe('task-1');
      expect(record.outcome).toBe('success');
      expect(record.strategyUsed).toBe('chain-of-thought');
    });

    it('emits self-improve:feedback:recorded event', () => {
      const listener = vi.fn();
      loop.on('self-improve:feedback:recorded', listener);

      loop.recordOutcome(makeFeedback());

      expect(listener).toHaveBeenCalledOnce();
    });

    it('enforces maxHistory limit', () => {
      const smallLoop = new FeedbackLoop({ maxHistory: 5 });

      for (let i = 0; i < 10; i++) {
        smallLoop.recordOutcome(makeFeedback({ taskId: `task-${i}` }));
      }

      const history = smallLoop.getHistory();
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });

  // ─────────────────────────────────────────────────────────
  // getStrategyWeights()
  // ─────────────────────────────────────────────────────────

  describe('getStrategyWeights()', () => {
    it('returns empty map initially', () => {
      const weights = loop.getStrategyWeights();
      expect(weights.size).toBe(0);
    });

    it('returns updated weights after recording outcomes', () => {
      loop.recordOutcome(makeFeedback({ strategyUsed: 'strategy-A' }));
      loop.recordOutcome(makeFeedback({ strategyUsed: 'strategy-B' }));

      const weights = loop.getStrategyWeights();
      expect(weights.size).toBe(2);
      expect(weights.has('strategy-A')).toBe(true);
      expect(weights.has('strategy-B')).toBe(true);
    });

    it('moves weight toward 1.0 on success', () => {
      // Default starting weight is 0.5
      loop.recordOutcome(makeFeedback({
        strategyUsed: 'good-strategy',
        outcome: 'success',
        metrics: { quality: 1.0, speed: 1.0, cost: 1.0, tokenEfficiency: 1.0 },
      }));

      const weights = loop.getStrategyWeights();
      const weight = weights.get('good-strategy')!;
      expect(weight).toBeGreaterThan(0.5);
    });

    it('moves weight toward 0.0 on failure', () => {
      loop.recordOutcome(makeFeedback({
        strategyUsed: 'bad-strategy',
        outcome: 'failure',
        metrics: { quality: 0, speed: 0, cost: 0, tokenEfficiency: 0 },
      }));

      const weights = loop.getStrategyWeights();
      const weight = weights.get('bad-strategy')!;
      expect(weight).toBeLessThan(0.5);
    });

    it('caps partial outcomes at 0.5 target', () => {
      loop.recordOutcome(makeFeedback({
        strategyUsed: 'partial-strategy',
        outcome: 'partial',
        metrics: { quality: 0.9, speed: 0.9, cost: 0.9, tokenEfficiency: 0.9 },
      }));

      const weights = loop.getStrategyWeights();
      const weight = weights.get('partial-strategy')!;
      // With partial outcome and high metrics, target is capped at 0.5
      // EMA from 0.5 toward 0.5 stays at 0.5
      expect(weight).toBeLessThanOrEqual(0.5);
    });

    it('returns a copy of the weights map', () => {
      loop.recordOutcome(makeFeedback());

      const weights1 = loop.getStrategyWeights();
      const weights2 = loop.getStrategyWeights();
      expect(weights1).not.toBe(weights2);
    });
  });

  // ─────────────────────────────────────────────────────────
  // getRecommendedStrategy() (recommend)
  // ─────────────────────────────────────────────────────────

  describe('getRecommendedStrategy()', () => {
    it('returns null when no strategies exist', () => {
      const result = loop.getRecommendedStrategy('code-review');
      expect(result).toBeNull();
    });

    it('returns the best strategy for a known task type', () => {
      // Record multiple outcomes for different strategies under the same task type
      loop.recordOutcome(makeFeedback({
        strategyUsed: 'strategy-A',
        outcome: 'success',
        metrics: { quality: 0.9, speed: 0.9, cost: 0.9, tokenEfficiency: 0.9 },
        context: { taskType: 'code-review' },
      }));
      loop.recordOutcome(makeFeedback({
        strategyUsed: 'strategy-B',
        outcome: 'failure',
        metrics: { quality: 0.1, speed: 0.1, cost: 0.1, tokenEfficiency: 0.1 },
        context: { taskType: 'code-review' },
      }));

      const result = loop.getRecommendedStrategy('code-review');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('strategy-A');
      expect(result!.weight).toBeGreaterThan(0);
    });

    it('falls back to global weights for unknown task types', () => {
      loop.recordOutcome(makeFeedback({
        strategyUsed: 'global-best',
        outcome: 'success',
        metrics: { quality: 1, speed: 1, cost: 1, tokenEfficiency: 1 },
        context: { taskType: 'testing' },
      }));

      // Ask for a task type that has no data
      const result = loop.getRecommendedStrategy('unknown-type');
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe('global-best');
    });
  });

  // ─────────────────────────────────────────────────────────
  // getHistory()
  // ─────────────────────────────────────────────────────────

  describe('getHistory()', () => {
    it('returns all records in reverse chronological order', () => {
      loop.recordOutcome(makeFeedback({ taskId: 'task-1' }));
      loop.recordOutcome(makeFeedback({ taskId: 'task-2' }));
      loop.recordOutcome(makeFeedback({ taskId: 'task-3' }));

      const history = loop.getHistory();
      expect(history).toHaveLength(3);
      // Newest first
      expect(history[0].taskId).toBe('task-3');
      expect(history[2].taskId).toBe('task-1');
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        loop.recordOutcome(makeFeedback({ taskId: `task-${i}` }));
      }

      const history = loop.getHistory(3);
      expect(history).toHaveLength(3);
    });

    it('returns empty array initially', () => {
      const history = loop.getHistory();
      expect(history).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────
  // getStats()
  // ─────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns zero counts initially', () => {
      const stats = loop.getStats();

      expect(stats.feedbackCount).toBe(0);
      expect(stats.strategyAdjustments).toBe(0);
    });

    it('tracks feedback count and strategy adjustments', () => {
      loop.recordOutcome(makeFeedback({ strategyUsed: 'A' }));
      loop.recordOutcome(makeFeedback({ strategyUsed: 'B' }));
      loop.recordOutcome(makeFeedback({ strategyUsed: 'A' }));

      const stats = loop.getStats();
      expect(stats.feedbackCount).toBe(3);
      expect(stats.strategyAdjustments).toBe(3);
    });
  });
});
