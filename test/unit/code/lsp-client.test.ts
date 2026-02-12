import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LSPClient } from '../../../src/code/lsp-client.js';

// Mock child_process
vi.mock('child_process', () => {
  const { EventEmitter } = require('events');
  const { PassThrough } = require('stream');

  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as any;
      proc.stdin = new PassThrough();
      proc.stdout = new PassThrough();
      proc.stderr = new PassThrough();
      proc.kill = vi.fn();
      proc.exitCode = null;
      proc.pid = 12345;
      return proc;
    }),
  };
});

describe('LSPClient', () => {
  let client: LSPClient;

  beforeEach(() => {
    client = new LSPClient({
      command: 'test-lsp-server',
      args: [],
      workspaceDir: '/tmp/test-workspace',
      timeout: 5000,
    });
  });

  it('should construct with options', () => {
    expect(client).toBeDefined();
  });

  it('should report not ready before initialization', () => {
    expect(client.isReady()).toBe(false);
  });

  it('should return empty diagnostics for unknown files', () => {
    const diags = client.getDiagnostics('/nonexistent/file.ts');
    expect(diags).toEqual([]);
  });

  it('should return empty definitions when not initialized', async () => {
    const defs = await client.getDefinition('/tmp/file.ts', 0, 0);
    expect(defs).toEqual([]);
  });

  it('should return empty references when not initialized', async () => {
    const refs = await client.getReferences('/tmp/file.ts', 0, 0);
    expect(refs).toEqual([]);
  });

  it('should return null hover when not initialized', async () => {
    const hover = await client.getHover('/tmp/file.ts', 0, 0);
    expect(hover).toBeNull();
  });

  it('should shutdown cleanly even when not initialized', async () => {
    await client.shutdown();
    // Should not throw
    expect(client.isReady()).toBe(false);
  });

  it('should handle LSPClientOptions defaults', () => {
    const minClient = new LSPClient({
      command: 'minimal-server',
      workspaceDir: '/tmp',
    });
    expect(minClient).toBeDefined();
  });
});
