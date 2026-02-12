import { describe, it, expect } from 'vitest';
import { MetricsCollector, type RunMetric } from '../../../src/observability/metrics.js';

function createRunMetric(overrides: Partial<RunMetric> = {}): RunMetric {
  return {
    runId: `run-${Date.now()}`,
    timestamp: Date.now(),
    duration: 5000,
    success: true,
    prompt: 'test prompt',
    stages: [
      { name: 'recall', duration: 100, success: true },
      { name: 'execute', duration: 3000, success: true },
    ],
    agents: [
      { taskId: 'task-1', role: 'developer', duration: 2000, success: true, tokensUsed: 1000, toolCalls: 5, iterations: 3 },
    ],
    cost: {
      totalTokens: 1500,
      totalCost: 0.05,
      inputTokens: 1000,
      outputTokens: 500,
      modelBreakdown: [
        { model: 'claude-3', tokens: 1500, cost: 0.05 },
      ],
    },
    quality: { passed: true, score: 95, gatesRun: 3, issuesFound: 0 },
    memory: { recalled: 5, stored: 2 },
    ...overrides,
  };
}

describe('MetricsCollector', () => {
  it('should record and retrieve runs', () => {
    const collector = new MetricsCollector();

    collector.record(createRunMetric({ runId: 'run-1' }));
    collector.record(createRunMetric({ runId: 'run-2' }));

    const recent = collector.getRecentRuns(5);
    expect(recent.length).toBe(2);
    expect(recent[0].runId).toBe('run-2'); // Most recent first
  });

  it('should get specific run by ID', () => {
    const collector = new MetricsCollector();
    collector.record(createRunMetric({ runId: 'run-abc' }));

    expect(collector.getRun('run-abc')).toBeDefined();
    expect(collector.getRun('nonexistent')).toBeUndefined();
  });

  it('should compute aggregate metrics', () => {
    const collector = new MetricsCollector();

    collector.record(createRunMetric({ duration: 3000, success: true }));
    collector.record(createRunMetric({ duration: 5000, success: true }));
    collector.record(createRunMetric({ duration: 7000, success: false }));

    const agg = collector.aggregate();

    expect(agg.totalRuns).toBe(3);
    expect(agg.successRate).toBeCloseTo(2 / 3, 2);
    expect(agg.avgDuration).toBe(5000);
    expect(agg.totalCost).toBeCloseTo(0.15, 2);
    expect(agg.avgCostPerRun).toBeCloseTo(0.05, 2);
  });

  it('should compute percentiles', () => {
    const collector = new MetricsCollector();

    for (let i = 1; i <= 100; i++) {
      collector.record(createRunMetric({ duration: i * 100 }));
    }

    const agg = collector.aggregate();
    expect(agg.p50Duration).toBe(5000);
    expect(agg.p95Duration).toBe(9500);
    expect(agg.p99Duration).toBe(9900);
  });

  it('should track most used roles', () => {
    const collector = new MetricsCollector();

    collector.record(createRunMetric({
      agents: [
        { taskId: 't1', role: 'developer', duration: 100, success: true, tokensUsed: 100, toolCalls: 1, iterations: 1 },
        { taskId: 't2', role: 'tester', duration: 100, success: true, tokensUsed: 100, toolCalls: 1, iterations: 1 },
      ],
    }));
    collector.record(createRunMetric({
      agents: [
        { taskId: 't3', role: 'developer', duration: 100, success: true, tokensUsed: 100, toolCalls: 1, iterations: 1 },
      ],
    }));

    const agg = collector.aggregate();
    expect(agg.mostUsedRoles[0].role).toBe('developer');
    expect(agg.mostUsedRoles[0].count).toBe(2);
  });

  it('should track cost by model', () => {
    const collector = new MetricsCollector();

    collector.record(createRunMetric({
      cost: {
        totalTokens: 2000,
        totalCost: 0.10,
        inputTokens: 1500,
        outputTokens: 500,
        modelBreakdown: [
          { model: 'claude-3', tokens: 1500, cost: 0.08 },
          { model: 'gpt-4o', tokens: 500, cost: 0.02 },
        ],
      },
    }));

    const agg = collector.aggregate();
    expect(agg.costByModel.length).toBe(2);
    expect(agg.costByModel[0].model).toBe('claude-3');
  });

  it('should classify failure reasons', () => {
    const collector = new MetricsCollector();

    collector.record(createRunMetric({
      success: false,
      quality: { passed: false, score: 30, gatesRun: 3, issuesFound: 5 },
    }));
    collector.record(createRunMetric({
      success: false,
      agents: [
        { taskId: 't1', role: 'developer', duration: 100, success: false, tokensUsed: 100, toolCalls: 1, iterations: 1 },
      ],
      quality: { passed: true, score: 90, gatesRun: 3, issuesFound: 0 },
    }));

    const agg = collector.aggregate();
    expect(agg.failureReasons.length).toBeGreaterThan(0);
    expect(agg.failureReasons.some(f => f.reason === 'quality_gate_failure')).toBe(true);
  });

  it('should generate time series data', () => {
    const collector = new MetricsCollector();
    const now = Date.now();

    collector.record(createRunMetric({ timestamp: now - 1000, duration: 3000 }));
    collector.record(createRunMetric({ timestamp: now, duration: 5000 }));

    const series = collector.timeSeries('duration', 3600000);
    expect(series.length).toBeGreaterThan(0);
    expect(series[0]).toHaveProperty('timestamp');
    expect(series[0]).toHaveProperty('value');
    expect(series[0]).toHaveProperty('count');
  });

  it('should handle empty metrics gracefully', () => {
    const collector = new MetricsCollector();
    const agg = collector.aggregate();

    expect(agg.totalRuns).toBe(0);
    expect(agg.successRate).toBe(0);
    expect(agg.avgDuration).toBe(0);
    expect(agg.totalCost).toBe(0);
  });

  it('should filter by time range', () => {
    const collector = new MetricsCollector();
    const now = Date.now();

    collector.record(createRunMetric({ timestamp: now - 100000 }));
    collector.record(createRunMetric({ timestamp: now }));

    const all = collector.aggregate();
    const recent = collector.aggregate(now - 50000);

    expect(all.totalRuns).toBe(2);
    expect(recent.totalRuns).toBe(1);
  });

  it('should respect max history limit', () => {
    const collector = new MetricsCollector(5);

    for (let i = 0; i < 10; i++) {
      collector.record(createRunMetric({ runId: `run-${i}` }));
    }

    const recent = collector.getRecentRuns(100);
    expect(recent.length).toBe(5);
  });

  it('should export all metrics', () => {
    const collector = new MetricsCollector();
    collector.record(createRunMetric());

    const exported = collector.export();
    expect(exported.runs.length).toBe(1);
    expect(exported.aggregates.totalRuns).toBe(1);
  });

  it('should clear metrics', () => {
    const collector = new MetricsCollector();
    collector.record(createRunMetric());

    collector.clear();
    expect(collector.aggregate().totalRuns).toBe(0);
  });
});
