import { describe, it, expect, vi } from 'vitest';
import { BenchmarkRunner, type BenchmarkEngineInterface } from '../../../src/benchmark/runner.js';
import { BenchmarkReporter } from '../../../src/benchmark/reporter.js';
import { BENCHMARK_TASKS, getTasksByCategory, getCategories } from '../../../src/benchmark/tasks.js';
import type { BenchmarkReport, BenchmarkResult } from '../../../src/benchmark/types.js';

// Mock engine that always succeeds
function createSuccessEngine(): BenchmarkEngineInterface {
  return {
    execute: vi.fn(async () => ({
      success: true,
      tokenUsage: { input: 100, output: 50 },
      costUsd: 0.001,
    })),
  };
}

// Mock engine that always fails
function createFailEngine(): BenchmarkEngineInterface {
  return {
    execute: vi.fn(async () => ({
      success: false,
      error: 'Task failed',
      tokenUsage: { input: 50, output: 10 },
      costUsd: 0.0005,
    })),
  };
}

// Mock engine that throws
function createCrashEngine(): BenchmarkEngineInterface {
  return {
    execute: vi.fn(async () => {
      throw new Error('Engine crashed');
    }),
  };
}

describe('BENCHMARK_TASKS', () => {
  it('should have 12 predefined tasks', () => {
    expect(BENCHMARK_TASKS).toHaveLength(12);
  });

  it('should have unique IDs', () => {
    const ids = BENCHMARK_TASKS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should cover all 4 categories', () => {
    const categories = new Set(BENCHMARK_TASKS.map(t => t.category));
    expect(categories).toContain('file-ops');
    expect(categories).toContain('code-gen');
    expect(categories).toContain('debugging');
    expect(categories).toContain('multi-step');
  });

  it('should have 3 tasks per category', () => {
    const counts = new Map<string, number>();
    for (const task of BENCHMARK_TASKS) {
      counts.set(task.category, (counts.get(task.category) || 0) + 1);
    }
    for (const count of counts.values()) {
      expect(count).toBe(3);
    }
  });

  it('should have valid difficulty levels', () => {
    for (const task of BENCHMARK_TASKS) {
      expect(['easy', 'medium', 'hard']).toContain(task.difficulty);
    }
  });

  it('should have non-empty prompts', () => {
    for (const task of BENCHMARK_TASKS) {
      expect(task.prompt.length).toBeGreaterThan(10);
    }
  });

  it('should have positive timeout values', () => {
    for (const task of BENCHMARK_TASKS) {
      expect(task.maxTimeMs).toBeGreaterThan(0);
    }
  });
});

describe('getTasksByCategory', () => {
  it('should return only tasks in the specified category', () => {
    const fileOps = getTasksByCategory('file-ops');
    expect(fileOps).toHaveLength(3);
    for (const task of fileOps) {
      expect(task.category).toBe('file-ops');
    }
  });

  it('should return empty array for unknown category', () => {
    const unknown = getTasksByCategory('nonexistent');
    expect(unknown).toEqual([]);
  });
});

describe('getCategories', () => {
  it('should return 4 categories', () => {
    const categories = getCategories();
    expect(categories).toHaveLength(4);
  });
});

describe('BenchmarkRunner', () => {
  it('should run all tasks by default', () => {
    const runner = new BenchmarkRunner();
    expect(runner.taskCount).toBe(12);
  });

  it('should filter tasks by category', () => {
    const runner = new BenchmarkRunner({ category: 'file-ops' });
    expect(runner.taskCount).toBe(3);
  });

  it('should produce a valid report structure', async () => {
    const runner = new BenchmarkRunner({ category: 'file-ops' });
    const engine = createSuccessEngine();

    const report = await runner.run(engine);

    expect(report.provider).toBeTruthy();
    expect(report.model).toBeTruthy();
    expect(report.timestamp).toBeTruthy();
    expect(report.results).toHaveLength(3);
    expect(report.summary).toBeDefined();
    expect(report.categories).toBeDefined();
  });

  it('should include summary with correct fields', async () => {
    const runner = new BenchmarkRunner({ category: 'debugging' });
    const engine = createSuccessEngine();

    const report = await runner.run(engine);

    expect(report.summary.totalTasks).toBe(3);
    expect(typeof report.summary.passed).toBe('number');
    expect(typeof report.summary.failed).toBe('number');
    expect(typeof report.summary.avgTimeMs).toBe('number');
    expect(typeof report.summary.totalCost).toBe('number');
    expect(typeof report.summary.avgQuality).toBe('number');
    expect(typeof report.summary.successRate).toBe('number');
    expect(report.summary.passed + report.summary.failed).toBe(report.summary.totalTasks);
  });

  it('should handle engine failures gracefully', async () => {
    const runner = new BenchmarkRunner({ category: 'file-ops' });
    const engine = createFailEngine();

    const report = await runner.run(engine);

    expect(report.results).toHaveLength(3);
    // Failed tasks should still produce results
    for (const result of report.results) {
      expect(result.taskId).toBeTruthy();
      expect(typeof result.timeMs).toBe('number');
    }
  });

  it('should handle engine crashes gracefully', async () => {
    const runner = new BenchmarkRunner({ category: 'file-ops' });
    const engine = createCrashEngine();

    const report = await runner.run(engine);

    expect(report.results).toHaveLength(3);
    for (const result of report.results) {
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    }
  });

  it('should compute category breakdowns', async () => {
    const runner = new BenchmarkRunner({ category: 'code-gen' });
    const engine = createSuccessEngine();

    const report = await runner.run(engine);

    expect(report.categories['code-gen']).toBeDefined();
    expect(report.categories['code-gen'].total).toBe(3);
  });

  it('should use provided provider and model names', async () => {
    const runner = new BenchmarkRunner({
      provider: 'test-provider',
      model: 'test-model',
      category: 'file-ops',
    });
    const engine = createSuccessEngine();

    const report = await runner.run(engine);

    expect(report.provider).toBe('test-provider');
    expect(report.model).toBe('test-model');
  });

  it('should record timing for each task', async () => {
    const runner = new BenchmarkRunner({ category: 'file-ops' });
    const engine = createSuccessEngine();

    const report = await runner.run(engine);

    for (const result of report.results) {
      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('BenchmarkReporter', () => {
  const reporter = new BenchmarkReporter();

  const sampleReport: BenchmarkReport = {
    provider: 'test-provider',
    model: 'test-model',
    timestamp: '2026-01-01T00:00:00.000Z',
    results: [
      { taskId: 'task-1', success: true, timeMs: 1500, tokensUsed: { input: 100, output: 50 }, cost: 0.001, qualityScore: 0.9 },
      { taskId: 'task-2', success: false, timeMs: 3000, tokensUsed: { input: 200, output: 100 }, cost: 0.002, qualityScore: 0.3, error: 'Type error' },
    ],
    summary: {
      totalTasks: 2,
      passed: 1,
      failed: 1,
      avgTimeMs: 2250,
      totalCost: 0.003,
      avgQuality: 0.6,
      successRate: 0.5,
    },
    categories: {
      'file-ops': { passed: 1, total: 1, avgTimeMs: 1500 },
      'debugging': { passed: 0, total: 1, avgTimeMs: 3000 },
    },
  };

  describe('formatTable', () => {
    it('should produce a non-empty string', () => {
      const output = reporter.formatTable(sampleReport);
      expect(output.length).toBeGreaterThan(0);
    });

    it('should include provider and model', () => {
      const output = reporter.formatTable(sampleReport);
      expect(output).toContain('test-provider');
      expect(output).toContain('test-model');
    });

    it('should include task IDs', () => {
      const output = reporter.formatTable(sampleReport);
      expect(output).toContain('task-1');
      expect(output).toContain('task-2');
    });

    it('should include PASS and FAIL statuses', () => {
      const output = reporter.formatTable(sampleReport);
      expect(output).toContain('PASS');
      expect(output).toContain('FAIL');
    });

    it('should include summary line', () => {
      const output = reporter.formatTable(sampleReport);
      expect(output).toContain('1/2 passed');
    });

    it('should include category breakdown', () => {
      const output = reporter.formatTable(sampleReport);
      expect(output).toContain('file-ops');
      expect(output).toContain('debugging');
    });
  });

  describe('formatJSON', () => {
    it('should produce valid JSON', () => {
      const output = reporter.formatJSON(sampleReport);
      const parsed = JSON.parse(output);
      expect(parsed.provider).toBe('test-provider');
      expect(parsed.results).toHaveLength(2);
    });

    it('should preserve all report fields', () => {
      const output = reporter.formatJSON(sampleReport);
      const parsed = JSON.parse(output);
      expect(parsed.summary.totalTasks).toBe(2);
      expect(parsed.categories['file-ops'].passed).toBe(1);
    });
  });

  describe('formatSummary', () => {
    it('should produce a concise summary', () => {
      const output = reporter.formatSummary(sampleReport);
      expect(output).toContain('1/2 passed');
      expect(output).toContain('50%');
    });

    it('should include provider name', () => {
      const output = reporter.formatSummary(sampleReport);
      expect(output).toContain('test-provider');
    });
  });

  describe('formatResult', () => {
    it('should format a passing result', () => {
      const result: BenchmarkResult = {
        taskId: 'test-task',
        success: true,
        timeMs: 1000,
        tokensUsed: { input: 50, output: 25 },
        cost: 0.001,
        qualityScore: 0.8,
      };
      const output = reporter.formatResult(result);
      expect(output).toContain('[PASS]');
      expect(output).toContain('test-task');
    });

    it('should format a failing result with error', () => {
      const result: BenchmarkResult = {
        taskId: 'fail-task',
        success: false,
        timeMs: 2000,
        tokensUsed: { input: 100, output: 50 },
        cost: 0.002,
        qualityScore: 0,
        error: 'Something broke',
      };
      const output = reporter.formatResult(result);
      expect(output).toContain('[FAIL]');
      expect(output).toContain('Something broke');
    });
  });
});
