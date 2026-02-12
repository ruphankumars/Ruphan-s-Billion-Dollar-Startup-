import { describe, it, expect, vi } from 'vitest';
import { TypeCheckGate } from '../../../../src/quality/gates/type-check.js';
import type { QualityContext } from '../../../../src/quality/types.js';

// Mock fs and child_process
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { existsSync } from 'fs';
import { execSync } from 'child_process';

const mockExistsSync = vi.mocked(existsSync);
const mockExecSync = vi.mocked(execSync);

describe('TypeCheckGate', () => {
  const gate = new TypeCheckGate();

  function createContext(overrides: Partial<QualityContext> = {}): QualityContext {
    return {
      workingDir: '/tmp/test-project',
      filesChanged: ['src/index.ts', 'src/utils.ts'],
      executionId: 'test-exec',
      ...overrides,
    };
  }

  it('should skip if no tsconfig.json exists', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await gate.run(createContext());
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should skip if no TS files changed', async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await gate.run(createContext({
      filesChanged: ['README.md', 'package.json'],
    }));
    expect(result.passed).toBe(true);
  });

  it('should pass when tsc exits cleanly', async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockReturnValue('');

    const result = await gate.run(createContext());
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should parse tsc error output', async () => {
    mockExistsSync.mockReturnValue(true);
    const error = new Error('tsc failed') as Error & { stdout: string; stderr: string; status: number };
    error.stdout = 'src/index.ts(10,5): error TS2322: Type string is not assignable to type number\nsrc/utils.ts(3,1): error TS7006: Parameter x implicitly has an any type';
    error.status = 2;
    mockExecSync.mockImplementation(() => { throw error; });

    const result = await gate.run(createContext());
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBe(2);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].file).toBe('src/index.ts');
    expect(result.issues[0].line).toBe(10);
    expect(result.issues[0].rule).toBe('TS2322');
    expect(result.issues[1].file).toBe('src/utils.ts');
  });

  it('should handle tsc crash gracefully', async () => {
    mockExistsSync.mockReturnValue(true);
    const error = new Error('ENOENT: tsc not found') as Error & { stdout: string; stderr: string };
    error.stdout = '';
    error.stderr = 'ENOENT';
    mockExecSync.mockImplementation(() => { throw error; });

    const result = await gate.run(createContext());
    // Should pass (don't block) when tsc crashes without parseable errors
    expect(result.passed).toBe(true);
  });

  it('should have correct gate name and description', () => {
    expect(gate.name).toBe('type-check');
    expect(gate.description).toBeTruthy();
  });
});
