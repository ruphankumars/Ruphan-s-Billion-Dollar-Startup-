import { describe, it, expect, vi } from 'vitest';
import { TestGate } from '../../../../src/quality/gates/test.js';
import type { QualityContext } from '../../../../src/quality/types.js';

// Mock fs and child_process
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockExecSync = vi.mocked(execSync);

describe('TestGate', () => {
  const gate = new TestGate();

  function createContext(overrides: Partial<QualityContext> = {}): QualityContext {
    return {
      workingDir: '/tmp/test-project',
      filesChanged: ['src/index.ts'],
      executionId: 'test-exec',
      ...overrides,
    };
  }

  it('should skip if no test runner detected', async () => {
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await gate.run(createContext());
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect vitest from config file', () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).endsWith('vitest.config.ts');
    });

    const runner = gate.detectRunner('/tmp/test-project');
    expect(runner).toBe('vitest');
  });

  it('should detect jest from config file', () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).endsWith('jest.config.ts');
    });

    const runner = gate.detectRunner('/tmp/test-project');
    expect(runner).toBe('jest');
  });

  it('should detect npm test from package.json', () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).endsWith('package.json');
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      scripts: { test: 'mocha' },
    }));

    const runner = gate.detectRunner('/tmp/test-project');
    expect(runner).toBe('npm');
  });

  it('should pass when tests exit cleanly', async () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).endsWith('vitest.config.ts');
    });
    mockExecSync.mockReturnValue('All tests passed');

    const result = await gate.run(createContext());
    expect(result.passed).toBe(true);
  });

  it('should report failures from test runner', async () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).endsWith('vitest.config.ts');
    });

    const error = new Error('Tests failed') as Error & { stdout: string; stderr: string; status: number };
    error.stdout = 'FAIL src/foo.test.ts\n  ✗ should work properly';
    error.status = 1;
    mockExecSync.mockImplementation(() => { throw error; });

    const result = await gate.run(createContext());
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should parse JSON test output', async () => {
    mockExistsSync.mockImplementation((path: any) => {
      return String(path).endsWith('vitest.config.ts');
    });

    const jsonOutput = JSON.stringify({
      testResults: [{
        name: 'src/foo.test.ts',
        assertionResults: [
          { status: 'passed', fullName: 'should pass', failureMessages: [] },
          { status: 'failed', fullName: 'should fail', failureMessages: ['Expected true to be false'] },
        ],
      }],
    });

    const error = new Error('Tests failed') as Error & { stdout: string; stderr: string; status: number };
    error.stdout = jsonOutput;
    error.status = 1;
    mockExecSync.mockImplementation(() => { throw error; });

    const result = await gate.run(createContext());
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].message).toContain('should fail');
  });

  it('should have correct gate name', () => {
    expect(gate.name).toBe('test');
  });
});
