import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LintGate } from '../../../../src/quality/gates/lint.js';
import type { QualityContext } from '../../../../src/quality/types.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

import { execSync } from 'child_process';
import { existsSync } from 'fs';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);

describe('LintGate', () => {
  const gate = new LintGate();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createContext(overrides: Partial<QualityContext> = {}): QualityContext {
    return {
      workingDir: '/tmp/test-project',
      filesChanged: ['src/index.ts', 'src/utils.tsx'],
      executionId: 'test-exec',
      ...overrides,
    };
  }

  it('should pass when no lintable files are present', async () => {
    const result = await gate.run(createContext({
      filesChanged: ['README.md', 'data.json', 'styles.css'],
    }));

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should pass and skip when no ESLint config is found', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await gate.run(createContext());

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('should pass when ESLint exits with 0', async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockReturnValue('[]');

    const result = await gate.run(createContext());

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should fail when ESLint finds errors', async () => {
    mockExistsSync.mockReturnValue(true);

    const eslintOutput = JSON.stringify([
      {
        filePath: '/tmp/test-project/src/index.ts',
        messages: [
          {
            severity: 2,
            message: 'Unexpected console statement',
            line: 10,
            column: 5,
            ruleId: 'no-console',
          },
        ],
      },
    ]);

    const error = new Error('ESLint found issues') as Error & { stdout: string; stderr: string; status: number };
    error.stdout = eslintOutput;
    error.status = 1;
    mockExecSync.mockImplementation(() => { throw error; });

    const result = await gate.run(createContext());

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].message).toBe('Unexpected console statement');
    expect(result.issues[0].rule).toBe('no-console');
  });

  it('should pass when ESLint finds only warnings', async () => {
    mockExistsSync.mockReturnValue(true);

    const eslintOutput = JSON.stringify([
      {
        filePath: '/tmp/test-project/src/index.ts',
        messages: [
          {
            severity: 1,
            message: 'Prefer const over let',
            line: 5,
            column: 1,
            ruleId: 'prefer-const',
          },
        ],
      },
    ]);

    const error = new Error('ESLint found issues') as Error & { stdout: string; stderr: string; status: number };
    error.stdout = eslintOutput;
    error.status = 1;
    mockExecSync.mockImplementation(() => { throw error; });

    const result = await gate.run(createContext());

    expect(result.passed).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('warning');
  });

  it('should pass gracefully when ESLint crashes', async () => {
    mockExistsSync.mockReturnValue(true);

    const error = new Error('ENOENT: eslint not found') as Error & { stdout?: string; stderr?: string };
    // No stdout - ESLint crashed before producing output
    mockExecSync.mockImplementation(() => { throw error; });

    const result = await gate.run(createContext());

    expect(result.passed).toBe(true);
  });

  it('should report warning when ESLint output is not parseable JSON', async () => {
    mockExistsSync.mockReturnValue(true);

    const error = new Error('ESLint error') as Error & { stdout: string; stderr: string; status: number };
    error.stdout = 'This is not valid JSON output from ESLint';
    error.status = 1;
    mockExecSync.mockImplementation(() => { throw error; });

    const result = await gate.run(createContext());

    const warningIssue = result.issues.find(i => i.severity === 'warning');
    expect(warningIssue).toBeDefined();
    expect(warningIssue!.message).toContain('could not be parsed');
  });
});
