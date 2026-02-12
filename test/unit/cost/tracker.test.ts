import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/core/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { CostTracker } from '../../../src/cost/tracker.js';

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker('exec-001');
  });

  it('record() creates entry with calculated cost', () => {
    const entry = tracker.record({
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(entry).toBeDefined();
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.model).toBe('claude-sonnet-4-20250514');
    expect(entry.provider).toBe('anthropic');
    expect(entry.inputTokens).toBe(1000);
    expect(entry.outputTokens).toBe(500);
    expect(entry.cost).toBeTypeOf('number');
    expect(entry.executionId).toBe('exec-001');
  });

  it('totalCost sums correctly across entries', () => {
    tracker.record({
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    tracker.record({
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      inputTokens: 0,
      outputTokens: 1_000_000,
    });

    // 1M input at $3/1M + 1M output at $15/1M = $18
    expect(tracker.totalCost).toBeCloseTo(18.0, 5);
  });

  it('totalInputTokens and totalOutputTokens sum correctly', () => {
    tracker.record({
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      inputTokens: 500,
      outputTokens: 200,
    });
    tracker.record({
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 300,
      outputTokens: 100,
    });

    expect(tracker.totalInputTokens).toBe(800);
    expect(tracker.totalOutputTokens).toBe(300);
  });

  it('getSummary() groups by model and shows budget info', () => {
    tracker.record({
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      inputTokens: 1000,
      outputTokens: 500,
    });
    tracker.record({
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      inputTokens: 2000,
      outputTokens: 1000,
    });
    tracker.record({
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 500,
      outputTokens: 250,
    });

    const summary = tracker.getSummary(10.0);

    expect(summary.totalCost).toBe(tracker.totalCost);
    expect(summary.totalInputTokens).toBe(3500);
    expect(summary.totalOutputTokens).toBe(1750);
    expect(summary.totalTokens).toBe(5250);
    expect(summary.budgetUsed).toBe(tracker.totalCost);
    expect(summary.budgetRemaining).toBeCloseTo(10.0 - tracker.totalCost, 5);

    // Two distinct model groups
    expect(summary.modelBreakdown).toHaveLength(2);

    const anthropicBreakdown = summary.modelBreakdown.find(
      b => b.provider === 'anthropic',
    );
    expect(anthropicBreakdown).toBeDefined();
    expect(anthropicBreakdown!.calls).toBe(2);
    expect(anthropicBreakdown!.inputTokens).toBe(3000);
    expect(anthropicBreakdown!.outputTokens).toBe(1500);

    const openaiBreakdown = summary.modelBreakdown.find(
      b => b.provider === 'openai',
    );
    expect(openaiBreakdown).toBeDefined();
    expect(openaiBreakdown!.calls).toBe(1);
  });

  it('getEntries() returns a copy (mutating does not affect tracker)', () => {
    tracker.record({
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 50,
    });

    const entries = tracker.getEntries();
    expect(entries).toHaveLength(1);

    // Mutate the returned array
    entries.push({
      id: 'fake',
      timestamp: 0,
      model: 'fake',
      provider: 'fake',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      executionId: 'fake',
    });

    // Original tracker is unaffected
    expect(tracker.getEntries()).toHaveLength(1);
  });

  it('reset() clears all entries', () => {
    tracker.record({
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      inputTokens: 1000,
      outputTokens: 500,
    });
    tracker.record({
      model: 'gpt-4o',
      provider: 'openai',
      inputTokens: 500,
      outputTokens: 250,
    });

    expect(tracker.getEntries()).toHaveLength(2);
    expect(tracker.totalCost).toBeGreaterThan(0);

    tracker.reset();

    expect(tracker.getEntries()).toHaveLength(0);
    expect(tracker.totalCost).toBe(0);
    expect(tracker.totalInputTokens).toBe(0);
    expect(tracker.totalOutputTokens).toBe(0);
  });

  it('record() with known model calculates non-zero cost', () => {
    const entry = tracker.record({
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      inputTokens: 10000,
      outputTokens: 5000,
    });

    // inputCost = (10000 / 1M) * 3.0 = 0.03
    // outputCost = (5000 / 1M) * 15.0 = 0.075
    // total = 0.105
    expect(entry.cost).toBeGreaterThan(0);
    expect(entry.cost).toBeCloseTo(0.105, 5);
  });

  it('record() with unknown model returns 0 cost', () => {
    const entry = tracker.record({
      model: 'unknown-model-xyz',
      provider: 'unknown',
      inputTokens: 10000,
      outputTokens: 5000,
    });

    expect(entry.cost).toBe(0);
  });
});
