import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LSPManager } from '../../../src/code/lsp-manager.js';
import type { LanguageServerConfig } from '../../../src/code/lsp-manager.js';

// Mock child_process for command availability checks
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const { EventEmitter } = require('events');
    const { PassThrough } = require('stream');
    const proc = new EventEmitter() as any;
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = vi.fn();
    proc.exitCode = null;
    proc.pid = 99999;
    return proc;
  }),
  execSync: vi.fn((cmd: string) => {
    // Only report typescript-language-server as available
    if (cmd.includes('typescript-language-server')) return '/usr/local/bin/typescript-language-server';
    throw new Error('not found');
  }),
}));

describe('LSPManager', () => {
  let manager: LSPManager;

  beforeEach(() => {
    manager = new LSPManager();
  });

  it('should construct without custom servers', () => {
    expect(manager).toBeDefined();
  });

  it('should construct with custom server configs', () => {
    const custom: LanguageServerConfig[] = [
      { languageId: 'custom-lang', command: 'custom-lsp', extensions: ['.custom'] },
    ];
    const customManager = new LSPManager(custom);
    expect(customManager).toBeDefined();
  });

  it('should discover available servers', async () => {
    const available = await manager.discoverServers();
    // Only typescript-language-server is "available" in our mock
    expect(available.length).toBe(1);
    expect(available[0].languageId).toBe('typescript');
  });

  it('should map file extensions to languages', () => {
    expect(manager.getLanguageForExtension('.ts')).toBe('typescript');
    expect(manager.getLanguageForExtension('.py')).toBe('python');
    expect(manager.getLanguageForExtension('.go')).toBe('go');
    expect(manager.getLanguageForExtension('.rs')).toBe('rust');
    expect(manager.getLanguageForExtension('.unknown')).toBeNull();
  });

  it('should return no active languages initially', () => {
    expect(manager.getActiveLanguages()).toEqual([]);
  });

  it('should shutdown all cleanly when no clients', async () => {
    await manager.shutdownAll();
    expect(manager.getActiveLanguages()).toEqual([]);
  });
});
