import { describe, it, expect } from 'vitest';
import { SWEBenchPromptBuilder } from '../../../src/swebench/prompt-builder.js';
import type { SWEBenchInstance } from '../../../src/swebench/types.js';

function makeInstance(overrides: Partial<SWEBenchInstance> = {}): SWEBenchInstance {
  return {
    instance_id: 'test__repo-123',
    repo: 'test/repo',
    base_commit: 'abc123',
    problem_statement: 'The function crashes when input is empty.',
    hints_text: 'Check the edge case for empty input',
    test_patch: '',
    patch: '',
    FAIL_TO_PASS: '["test_empty_input"]',
    PASS_TO_PASS: '["test_normal_input"]',
    environment_setup_commit: 'def456',
    version: '1.0',
    ...overrides,
  };
}

describe('SWEBenchPromptBuilder', () => {
  const builder = new SWEBenchPromptBuilder();

  it('should include problem statement in prompt', () => {
    const prompt = builder.build(makeInstance(), '/tmp/work');
    expect(prompt).toContain('The function crashes when input is empty.');
  });

  it('should include repo name', () => {
    const prompt = builder.build(makeInstance(), '/tmp/work');
    expect(prompt).toContain('test/repo');
  });

  it('should include FAIL_TO_PASS test names', () => {
    const prompt = builder.build(makeInstance(), '/tmp/work');
    expect(prompt).toContain('test_empty_input');
  });

  it('should include hints when available', () => {
    const prompt = builder.build(makeInstance(), '/tmp/work');
    expect(prompt).toContain('Check the edge case for empty input');
  });

  it('should handle empty hints gracefully', () => {
    const prompt = builder.build(makeInstance({ hints_text: '' }), '/tmp/work');
    expect(prompt).not.toContain('## Hints');
  });

  it('should include instructions for minimal changes', () => {
    const prompt = builder.build(makeInstance(), '/tmp/work');
    expect(prompt).toContain('minimal changes');
    expect(prompt).toContain('Only modify existing files');
  });

  it('should handle special characters in problem statement', () => {
    const instance = makeInstance({
      problem_statement: 'Error: `TypeError` in <module> at line 42\nTraceback...',
    });
    const prompt = builder.build(instance, '/tmp/work');
    expect(prompt).toContain('TypeError');
    expect(prompt).toContain('Traceback');
  });

  it('buildWithContext should include repo context', () => {
    const prompt = builder.buildWithContext(makeInstance(), '/tmp/work', 'src/main.py - main entry point\nsrc/utils.py - helper functions');
    expect(prompt).toContain('Repository Context');
    expect(prompt).toContain('main entry point');
    expect(prompt).toContain('helper functions');
  });

  describe('parseTestList', () => {
    it('should parse valid JSON array', () => {
      const tests = builder.parseTestList('["test_a", "test_b"]');
      expect(tests).toEqual(['test_a', 'test_b']);
    });

    it('should handle empty string', () => {
      const tests = builder.parseTestList('');
      expect(tests).toEqual([]);
    });

    it('should handle malformed JSON', () => {
      const tests = builder.parseTestList('test_a, test_b');
      expect(tests.length).toBeGreaterThan(0);
    });
  });
});
