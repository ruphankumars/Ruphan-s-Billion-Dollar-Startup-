import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoFixer } from '../../../src/quality/auto-fixer.js';
import type { QualityContext, GateIssue } from '../../../src/quality/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('line1\n  debugger;\nline3\n'),
    writeFileSync: vi.fn(),
  };
});

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

describe('AutoFixer', () => {
  let fixer: AutoFixer;
  const context: QualityContext = {
    workingDir: '/tmp/test-project',
    filesChanged: ['/tmp/test-project/src/index.ts'],
    executionId: 'test-001',
  };

  beforeEach(() => {
    fixer = new AutoFixer();
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  describe('applyFixes', () => {
    it('should orchestrate lint and syntax fixes', async () => {
      const issues: GateIssue[] = [
        { severity: 'warning', message: 'no-unused-vars', autoFixable: true, rule: 'no-unused-vars', file: 'src/index.ts' },
        { severity: 'error', message: 'Unexpected debugger statement', autoFixable: true, file: '/tmp/test-project/src/index.ts', line: 2 },
      ];

      const results = await fixer.applyFixes(issues, context);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should skip when no fixable issues', async () => {
      const results = await fixer.applyFixes([], context);
      expect(results).toEqual([]);
    });

    it('should only run lint fix when only lint issues present', async () => {
      const issues: GateIssue[] = [
        { severity: 'warning', message: 'no-unused-vars', autoFixable: true, rule: 'no-unused-vars' },
      ];

      await fixer.applyFixes(issues, context);
      expect(vi.mocked(execSync)).toHaveBeenCalled();
    });
  });

  describe('fixLintIssues', () => {
    it('should run eslint --fix on changed files', async () => {
      vi.mocked(execSync).mockReturnValue('');

      const results = await fixer.fixLintIssues(context);
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('lint');
      expect(results[0].success).toBe(true);
    });

    it('should handle eslint exit code 1 (some issues remain)', async () => {
      const error = new Error('eslint error') as any;
      error.status = 1;
      vi.mocked(execSync).mockImplementation(() => { throw error; });

      const results = await fixer.fixLintIssues(context);
      expect(results[0].success).toBe(true);
      expect(results[0].description).toContain('some issues remain');
    });

    it('should handle eslint failure (other errors)', async () => {
      const error = new Error('command not found') as any;
      error.status = 127;
      vi.mocked(execSync).mockImplementation(() => { throw error; });

      const results = await fixer.fixLintIssues(context);
      expect(results[0].success).toBe(false);
    });

    it('should skip when no eslint config is found', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const results = await fixer.fixLintIssues(context);
      expect(results).toEqual([]);
    });

    it('should skip non-lintable files', async () => {
      const ctx: QualityContext = {
        ...context,
        filesChanged: ['/tmp/test-project/data.json'],
      };

      const results = await fixer.fixLintIssues(ctx);
      expect(results).toEqual([]);
    });
  });

  describe('fixSyntaxIssues', () => {
    it('should remove debugger statements', () => {
      vi.mocked(readFileSync).mockReturnValue('line1\n  debugger;\nline3\n');

      const issues: GateIssue[] = [
        {
          severity: 'error',
          message: 'Unexpected debugger statement',
          autoFixable: true,
          file: '/tmp/test-project/src/index.ts',
          line: 2,
        },
      ];

      const results = fixer.fixSyntaxIssues(issues, context);
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('syntax');
      expect(results[0].success).toBe(true);
      expect(results[0].rule).toBe('no-debugger');
      expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
    });

    it('should handle multiple debugger statements in one file', () => {
      vi.mocked(readFileSync).mockReturnValue('line1\n  debugger;\nline3\n  debugger;\nline5\n');

      const issues: GateIssue[] = [
        { severity: 'error', message: 'Unexpected debugger', autoFixable: true, file: '/tmp/f.ts', line: 2 },
        { severity: 'error', message: 'Unexpected debugger', autoFixable: true, file: '/tmp/f.ts', line: 4 },
      ];

      const results = fixer.fixSyntaxIssues(issues, context);
      expect(results.length).toBe(2);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should skip issues without file or line info', () => {
      const issues: GateIssue[] = [
        { severity: 'error', message: 'Unexpected debugger', autoFixable: true },
      ];

      const results = fixer.fixSyntaxIssues(issues, context);
      expect(results).toEqual([]);
    });

    it('should handle read errors gracefully', () => {
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error('read failed'); });

      const issues: GateIssue[] = [
        { severity: 'error', message: 'Unexpected debugger', autoFixable: true, file: '/tmp/f.ts', line: 1 },
      ];

      const results = fixer.fixSyntaxIssues(issues, context);
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(false);
    });
  });
});
