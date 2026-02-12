import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityGate } from '../../../../src/quality/gates/security.js';
import type { QualityContext } from '../../../../src/quality/types.js';

// Mock fs and child_process
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockExecSync = vi.mocked(execSync);

describe('SecurityGate', () => {
  const gate = new SecurityGate();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createContext(overrides: Partial<QualityContext> = {}): QualityContext {
    return {
      workingDir: '/tmp/test-project',
      filesChanged: ['src/config.ts'],
      executionId: 'test-exec',
      ...overrides,
    };
  }

  it('should have correct name and description', () => {
    expect(gate.name).toBe('security');
    expect(gate.description).toBeTruthy();
  });

  it('should pass when no secrets found', async () => {
    mockReadFileSync.mockReturnValue('const x = 42;\nexport default x;');

    const result = await gate.run(createContext());
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect AWS access keys', async () => {
    mockReadFileSync.mockReturnValue('const key = "AKIAIOSFODNN7ABCDEFG";');

    const result = await gate.run(createContext());
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].message).toContain('AWS Access Key');
  });

  it('should detect GitHub tokens', async () => {
    mockReadFileSync.mockReturnValue('const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";');

    const result = await gate.run(createContext());
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.message.includes('GitHub Token'))).toBe(true);
  });

  it('should detect private keys', async () => {
    mockReadFileSync.mockReturnValue('-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBAL...\n-----END RSA PRIVATE KEY-----');

    const result = await gate.run(createContext());
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.message.includes('Private Key'))).toBe(true);
  });

  it('should detect Anthropic API keys', async () => {
    mockReadFileSync.mockReturnValue('const key = "sk-ant-abcdefghijklmnopqrstu";');

    const result = await gate.run(createContext());
    expect(result.passed).toBe(false);
  });

  it('should skip comments with example/placeholder hints', async () => {
    mockReadFileSync.mockReturnValue('// example: AKIAIOSFODNN7EXAMPLE\n// your_api_key_here');

    const result = await gate.run(createContext());
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should skip .env files in changed list', async () => {
    mockReadFileSync.mockReturnValue('');

    const result = await gate.run(createContext({
      filesChanged: ['.env.example'],
    }));
    // .env.example is in IGNORED_FILES, so no scan
    expect(result.passed).toBe(true);
  });

  it('should flag .env files committed (non-example)', async () => {
    mockReadFileSync.mockReturnValue('KEY=value');

    const result = await gate.run(createContext({
      filesChanged: ['.env'],
    }));
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.message.includes('.env'))).toBe(true);
  });

  it('should skip binary files', async () => {
    const result = await gate.run(createContext({
      filesChanged: ['logo.png', 'font.woff2', 'archive.zip'],
    }));
    expect(result.passed).toBe(true);
    // readFileSync should not have been called for binary files
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('should run npm audit when package.json changed', async () => {
    mockReadFileSync.mockReturnValue('{}');
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockReturnValue('');

    await gate.run(createContext({
      filesChanged: ['package.json'],
    }));

    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('npm audit'),
      expect.objectContaining({ cwd: '/tmp/test-project' }),
    );
  });

  it('should detect critical npm audit vulnerabilities', async () => {
    mockReadFileSync.mockReturnValue('{}');
    mockExistsSync.mockReturnValue(true);
    const auditError = new Error('audit failed') as Error & { stdout: string };
    auditError.stdout = JSON.stringify({
      metadata: { vulnerabilities: { critical: 2, high: 1, moderate: 0, low: 0 } },
    });
    mockExecSync.mockImplementation(() => { throw auditError; });

    const result = await gate.run(createContext({
      filesChanged: ['package.json'],
    }));
    expect(result.passed).toBe(false);
    expect(result.issues.some(i => i.message.includes('critical'))).toBe(true);
  });

  it('should handle unreadable files gracefully', async () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await gate.run(createContext());
    expect(result.passed).toBe(true);
  });
});
