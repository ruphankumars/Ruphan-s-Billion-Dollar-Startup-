import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyntaxGate } from '../../../../src/quality/gates/syntax.js';
import type { QualityContext } from '../../../../src/quality/types.js';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

import { readFileSync } from 'fs';

const mockReadFileSync = vi.mocked(readFileSync);

describe('SyntaxGate', () => {
  const gate = new SyntaxGate();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createContext(overrides: Partial<QualityContext> = {}): QualityContext {
    return {
      workingDir: '/tmp/test-project',
      filesChanged: ['src/index.ts'],
      executionId: 'test-exec',
      ...overrides,
    };
  }

  it('should pass for valid JSON file', async () => {
    mockReadFileSync.mockReturnValue('{"name": "test", "version": "1.0.0"}');

    const result = await gate.run(createContext({
      filesChanged: ['config.json'],
    }));

    expect(result.passed).toBe(true);
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('should fail for invalid JSON file', async () => {
    mockReadFileSync.mockReturnValue('{ invalid json content }');

    const result = await gate.run(createContext({
      filesChanged: ['config.json'],
    }));

    expect(result.passed).toBe(false);
    const errors = result.issues.filter(i => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('Invalid JSON');
  });

  it('should fail when debugger statement is found (error severity)', async () => {
    mockReadFileSync.mockReturnValue('const x = 1;\n  debugger;\nconst y = 2;');

    const result = await gate.run(createContext({
      filesChanged: ['src/app.ts'],
    }));

    expect(result.passed).toBe(false);
    const debuggerIssue = result.issues.find(i => i.message.includes('debugger'));
    expect(debuggerIssue).toBeDefined();
    expect(debuggerIssue!.severity).toBe('error');
  });

  it('should pass but report warning for console.log', async () => {
    mockReadFileSync.mockReturnValue('function run() {\n  console.log("test");\n}');

    const result = await gate.run(createContext({
      filesChanged: ['src/app.ts'],
    }));

    expect(result.passed).toBe(true);
    const consoleIssue = result.issues.find(i => i.message.includes('console.log'));
    expect(consoleIssue).toBeDefined();
    expect(consoleIssue!.severity).toBe('warning');
  });

  it('should pass with info issue for TODO comment', async () => {
    mockReadFileSync.mockReturnValue('// TODO: refactor this function\nfunction run() {}');

    const result = await gate.run(createContext({
      filesChanged: ['src/app.ts'],
    }));

    expect(result.passed).toBe(true);
    const todoIssue = result.issues.find(i => i.message.includes('TODO'));
    expect(todoIssue).toBeDefined();
    expect(todoIssue!.severity).toBe('info');
  });

  it('should report warning for unbalanced braces', async () => {
    mockReadFileSync.mockReturnValue('function run() {\n  if (true) {\n    return;\n}');

    const result = await gate.run(createContext({
      filesChanged: ['src/app.ts'],
    }));

    const braceIssue = result.issues.find(i => i.message.includes('unbalanced'));
    expect(braceIssue).toBeDefined();
    expect(braceIssue!.severity).toBe('warning');
  });

  it('should skip non-JS/TS/JSON files and pass', async () => {
    const result = await gate.run(createContext({
      filesChanged: ['script.py', 'styles.css', 'README.md'],
    }));

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('should report error issue when file read fails', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const result = await gate.run(createContext({
      filesChanged: ['src/missing.ts'],
    }));

    expect(result.passed).toBe(false);
    const readError = result.issues.find(i => i.message.includes('Could not read file'));
    expect(readError).toBeDefined();
    expect(readError!.severity).toBe('error');
  });
});
