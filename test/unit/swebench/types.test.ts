import { describe, it, expect } from 'vitest';
import type {
  SWEBenchInstance,
  SWEBenchResult,
  SWEBenchReport,
  SWEBenchConfig,
  SWEBenchSummary,
} from '../../../src/swebench/types.js';

describe('SWE-bench Types', () => {
  it('SWEBenchInstance should have all required fields', () => {
    const instance: SWEBenchInstance = {
      instance_id: 'django__django-16379',
      repo: 'django/django',
      base_commit: 'abc123',
      problem_statement: 'Bug description',
      hints_text: 'Some hint',
      test_patch: 'diff --git ...',
      patch: 'gold patch',
      FAIL_TO_PASS: '["test_foo"]',
      PASS_TO_PASS: '["test_bar"]',
      environment_setup_commit: 'def456',
      version: '4.2',
    };

    expect(instance.instance_id).toBe('django__django-16379');
    expect(instance.repo).toBe('django/django');
    expect(instance.base_commit).toBe('abc123');
  });

  it('SWEBenchResult should have instance_id and model_patch', () => {
    const result: SWEBenchResult = {
      instance_id: 'test-1',
      model_name_or_path: 'anthropic/claude',
      model_patch: 'diff ...',
      success: true,
      tests_passed: 5,
      tests_total: 5,
      cost: 0.05,
      duration: 30000,
    };

    expect(result.instance_id).toBe('test-1');
    expect(result.model_patch).toBe('diff ...');
    expect(result.success).toBe(true);
  });

  it('SWEBenchReport should have summary with resolution rate', () => {
    const report: SWEBenchReport = {
      model: 'claude',
      provider: 'anthropic',
      dataset: 'swebench-lite.jsonl',
      timestamp: new Date().toISOString(),
      results: [],
      summary: {
        total: 10,
        resolved: 3,
        resolutionRate: 0.3,
        avgCost: 0.05,
        avgDuration: 60000,
        totalCost: 0.5,
      },
    };

    expect(report.summary.resolutionRate).toBe(0.3);
    expect(report.summary.total).toBe(10);
    expect(report.summary.resolved).toBe(3);
  });

  it('SWEBenchConfig should have dataset as required field', () => {
    const config: SWEBenchConfig = {
      dataset: '/path/to/data.jsonl',
    };

    expect(config.dataset).toBe('/path/to/data.jsonl');
    expect(config.limit).toBeUndefined();
    expect(config.provider).toBeUndefined();
  });

  it('SWEBenchConfig optional fields should be undefined by default', () => {
    const config: SWEBenchConfig = {
      dataset: 'test.jsonl',
      limit: 10,
      provider: 'anthropic',
      model: 'claude-3-sonnet',
      timeout: 300000,
    };

    expect(config.limit).toBe(10);
    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-3-sonnet');
    expect(config.timeout).toBe(300000);
  });
});
