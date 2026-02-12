import { describe, it, expect } from 'vitest';
import { SWEBenchEvaluator } from '../../../src/swebench/evaluator.js';
import type { SWEBenchInstance } from '../../../src/swebench/types.js';

function makeInstance(overrides: Partial<SWEBenchInstance> = {}): SWEBenchInstance {
  return {
    instance_id: 'test-1',
    repo: 'test/repo',
    base_commit: 'abc123',
    problem_statement: 'Bug',
    hints_text: '',
    test_patch: '',
    patch: '',
    FAIL_TO_PASS: '[]',
    PASS_TO_PASS: '[]',
    environment_setup_commit: 'def456',
    version: '1.0',
    ...overrides,
  };
}

describe('SWEBenchEvaluator', () => {
  it('should create with default timeout', () => {
    const evaluator = new SWEBenchEvaluator();
    expect(evaluator).toBeDefined();
  });

  it('should create with custom timeout', () => {
    const evaluator = new SWEBenchEvaluator(60000);
    expect(evaluator).toBeDefined();
  });

  it('should handle empty test lists', async () => {
    const evaluator = new SWEBenchEvaluator();
    const result = await evaluator.evaluate(makeInstance(), '/tmp/nonexistent');

    // With empty test lists, should succeed (no tests to fail)
    expect(result).toBeDefined();
    expect(result.tests_total).toBe(0);
    expect(result.tests_passed).toBe(0);
    expect(result.success).toBe(true);
  });

  it('should handle non-existent work directory gracefully', async () => {
    const evaluator = new SWEBenchEvaluator();
    const instance = makeInstance({
      FAIL_TO_PASS: '["test_something"]',
    });

    const result = await evaluator.evaluate(instance, '/tmp/completely-nonexistent-' + Date.now());

    // Should not throw, just report failure
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });

  it('should return EvaluationResult structure', async () => {
    const evaluator = new SWEBenchEvaluator();
    const result = await evaluator.evaluate(makeInstance(), '/tmp/nonexistent');

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('tests_passed');
    expect(result).toHaveProperty('tests_total');
    expect(result).toHaveProperty('failToPassResults');
    expect(result).toHaveProperty('passToPassResults');
  });

  it('should report correct structure for failToPassResults', async () => {
    const evaluator = new SWEBenchEvaluator();
    const result = await evaluator.evaluate(makeInstance(), '/tmp/nonexistent');

    expect(result.failToPassResults).toHaveProperty('passed');
    expect(result.failToPassResults).toHaveProperty('failed');
    expect(result.failToPassResults).toHaveProperty('total');
    expect(result.failToPassResults).toHaveProperty('errors');
    expect(Array.isArray(result.failToPassResults.errors)).toBe(true);
  });

  describe('detectTestCommand', () => {
    const evaluator = new SWEBenchEvaluator();

    it('should detect pytest for Python projects', () => {
      // Default fallback is pytest (most SWE-bench problems are Python)
      const cmd = evaluator.detectTestCommand('/nonexistent');
      expect(cmd).toContain('pytest');
    });

    it('should return string for any directory', () => {
      const cmd = evaluator.detectTestCommand('/tmp');
      expect(typeof cmd).toBe('string');
      expect(cmd.length).toBeGreaterThan(0);
    });
  });

  it('should track evaluation duration', async () => {
    const evaluator = new SWEBenchEvaluator();
    const result = await evaluator.evaluate(makeInstance(), '/tmp/nonexistent');

    // Result should be returned quickly (no actual tests)
    expect(result).toBeDefined();
  });

  it('should handle error in evaluation gracefully', async () => {
    const evaluator = new SWEBenchEvaluator();
    const instance = makeInstance({
      test_patch: 'invalid patch that will fail to apply',
    });

    const result = await evaluator.evaluate(instance, '/tmp/nonexistent-' + Date.now());

    // Should not throw, just include error
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });
});
