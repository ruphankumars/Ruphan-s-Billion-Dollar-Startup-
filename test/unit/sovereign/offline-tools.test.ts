/**
 * OfflineToolkit — Unit Tests
 *
 * Tests offline tool execution: built-in tools (readFile, writeFile,
 * listDir, searchFiles, gitStatus, gitDiff, gitLog, shellExec,
 * analyzeCode), custom tool registration, safety restrictions,
 * and statistics.
 * Mocks node:fs and node:child_process to avoid real I/O.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock node:fs ──────────────────────────────────────────────

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue('file content'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ size: 100 }),
}));

// ── Mock node:child_process ───────────────────────────────────

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('command output'),
}));

import { OfflineToolkit } from '../../../src/sovereign/offline-tools.js';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';

// ── Test suite ────────────────────────────────────────────────

describe('OfflineToolkit', () => {
  let toolkit: OfflineToolkit;

  beforeEach(() => {
    vi.clearAllMocks();
    toolkit = new OfflineToolkit();
  });

  // ── Lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() sets running and emits event', () => {
      const spy = vi.fn();
      toolkit.on('sovereign:toolkit:started', spy);
      toolkit.start();
      expect(toolkit.isRunning()).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('stop() clears running and emits event', () => {
      toolkit.start();
      const spy = vi.fn();
      toolkit.on('sovereign:toolkit:stopped', spy);
      toolkit.stop();
      expect(toolkit.isRunning()).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── listTools ─────────────────────────────────────────────

  describe('listTools', () => {
    it('returns all built-in tools', () => {
      const tools = toolkit.listTools();
      expect(tools.length).toBeGreaterThan(0);
      const names = tools.map((t) => t.name);
      expect(names).toContain('readFile');
      expect(names).toContain('writeFile');
      expect(names).toContain('listDir');
      expect(names).toContain('searchFiles');
      expect(names).toContain('gitStatus');
      expect(names).toContain('gitDiff');
      expect(names).toContain('gitLog');
      expect(names).toContain('shellExec');
      expect(names).toContain('analyzeCode');
    });
  });

  // ── getTool ───────────────────────────────────────────────

  describe('getTool', () => {
    it('returns a tool by name', () => {
      const tool = toolkit.getTool('readFile');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('readFile');
      expect(tool!.category).toBe('filesystem');
    });

    it('returns undefined for unknown tools', () => {
      expect(toolkit.getTool('nonexistent')).toBeUndefined();
    });
  });

  // ── readFile ──────────────────────────────────────────────

  describe('readFile', () => {
    it('reads file content successfully', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue('hello world');
      const result = await toolkit.executeTool('readFile', { path: '/tmp/test.txt' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('hello world');
    });

    it('returns error when path is missing', async () => {
      const result = await toolkit.executeTool('readFile', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('path is required');
    });

    it('returns error when file read fails', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const result = await toolkit.executeTool('readFile', { path: '/missing.txt' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to read file');
    });
  });

  // ── writeFile ─────────────────────────────────────────────

  describe('writeFile', () => {
    it('writes content to a file', async () => {
      const result = await toolkit.executeTool('writeFile', {
        path: '/tmp/out.txt',
        content: 'test data',
      });
      expect(result.success).toBe(true);
      expect(result.output).toContain('Written');
      expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/out.txt', 'test data', 'utf-8');
    });

    it('creates parent directories if they do not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      await toolkit.executeTool('writeFile', {
        path: '/deep/nested/file.txt',
        content: 'data',
      });
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('returns error when path is missing', async () => {
      const result = await toolkit.executeTool('writeFile', { content: 'data' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('path is required');
    });
  });

  // ── listDir ───────────────────────────────────────────────

  describe('listDir', () => {
    it('lists directory entries', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'src', isDirectory: () => true, isSymbolicLink: () => false } as unknown as fs.Dirent,
        { name: 'index.ts', isDirectory: () => false, isSymbolicLink: () => false } as unknown as fs.Dirent,
      ]);
      const result = await toolkit.executeTool('listDir', { path: '.' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('dir\tsrc');
      expect(result.output).toContain('file\tindex.ts');
    });

    it('returns error on directory read failure', async () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('EACCES');
      });
      const result = await toolkit.executeTool('listDir', { path: '/root' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to list directory');
    });
  });

  // ── gitStatus ─────────────────────────────────────────────

  describe('gitStatus', () => {
    it('runs git status --porcelain', async () => {
      vi.mocked(execSync).mockReturnValue('M src/index.ts\n');
      const result = await toolkit.executeTool('gitStatus', { cwd: '.' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('M src/index.ts');
    });

    it('returns clean working tree message when no changes', async () => {
      vi.mocked(execSync).mockReturnValue('');
      const result = await toolkit.executeTool('gitStatus', { cwd: '.' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('clean working tree');
    });
  });

  // ── gitDiff ───────────────────────────────────────────────

  describe('gitDiff', () => {
    it('runs git diff for unstaged changes', async () => {
      vi.mocked(execSync).mockReturnValue('diff --git a/file.ts b/file.ts');
      const result = await toolkit.executeTool('gitDiff', { cwd: '.' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('diff --git');
    });

    it('runs git diff --staged when staged is true', async () => {
      vi.mocked(execSync).mockReturnValue('staged diff');
      await toolkit.executeTool('gitDiff', { cwd: '.', staged: true });
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('--staged'),
        expect.any(Object),
      );
    });
  });

  // ── gitLog ────────────────────────────────────────────────

  describe('gitLog', () => {
    it('runs git log --oneline with specified count', async () => {
      vi.mocked(execSync).mockReturnValue('abc1234 feat: something\n');
      const result = await toolkit.executeTool('gitLog', { cwd: '.', count: 5 });
      expect(result.success).toBe(true);
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('-n 5'),
        expect.any(Object),
      );
    });
  });

  // ── shellExec ─────────────────────────────────────────────

  describe('shellExec', () => {
    it('executes a shell command and returns output', async () => {
      vi.mocked(execSync).mockReturnValue('hello\n');
      const result = await toolkit.executeTool('shellExec', { command: 'echo hello' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('hello\n');
    });

    it('returns error when command is missing', async () => {
      const result = await toolkit.executeTool('shellExec', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('command is required');
    });

    it('blocks rm -rf / command', async () => {
      const result = await toolkit.executeTool('shellExec', { command: 'rm -rf /' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Blocked dangerous command');
    });

    it('blocks rm -rf ~ command', async () => {
      const result = await toolkit.executeTool('shellExec', { command: 'rm -rf ~' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Blocked dangerous command');
    });

    it('blocks mkfs command', async () => {
      const result = await toolkit.executeTool('shellExec', { command: 'mkfs /dev/sda1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Blocked dangerous command');
    });

    it('blocks dd if= command', async () => {
      const result = await toolkit.executeTool('shellExec', {
        command: 'dd if=/dev/zero of=/dev/sda',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Blocked dangerous command');
    });

    it('blocks fork bomb command', async () => {
      const result = await toolkit.executeTool('shellExec', {
        command: ':(){:|:&};:',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Blocked dangerous command');
    });

    it('blocks chmod -R 777 / command', async () => {
      const result = await toolkit.executeTool('shellExec', {
        command: 'chmod -R 777 /',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Blocked dangerous command');
    });
  });

  // ── analyzeCode ───────────────────────────────────────────

  describe('analyzeCode', () => {
    it('analyzes file metrics', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        '// comment\nconst x = 1;\nif (x) {\n  return x;\n}\n',
      );
      const result = await toolkit.executeTool('analyzeCode', { path: '/tmp/test.ts' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('Total lines:');
      expect(result.output).toContain('Code lines:');
      expect(result.output).toContain('Comment lines:');
    });

    it('returns error when path is missing', async () => {
      const result = await toolkit.executeTool('analyzeCode', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('path is required');
    });
  });

  // ── executeTool — unknown tool ────────────────────────────

  describe('executeTool — unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await toolkit.executeTool('nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool not found: nonexistent');
    });
  });

  // ── registerTool ──────────────────────────────────────────

  describe('registerTool', () => {
    it('adds a custom tool that can be executed', async () => {
      const spy = vi.fn();
      toolkit.on('sovereign:tool:registered', spy);

      toolkit.registerTool({
        name: 'customTool',
        description: 'A custom test tool',
        category: 'filesystem',
        handler: async () => ({ success: true, output: 'custom output' }),
      });

      expect(spy).toHaveBeenCalledOnce();
      expect(toolkit.getTool('customTool')).toBeDefined();

      const result = await toolkit.executeTool('customTool', {});
      expect(result.success).toBe(true);
      expect(result.output).toBe('custom output');
    });
  });

  // ── getStats ──────────────────────────────────────────────

  describe('getStats', () => {
    it('returns tool statistics', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue('content');
      await toolkit.executeTool('readFile', { path: '/tmp/test.txt' });

      const stats = toolkit.getStats();
      expect(stats.toolCount).toBeGreaterThan(0);
      expect(stats.executionCount).toBe(1);
      expect(stats.categories).toHaveProperty('filesystem');
    });
  });

  // ── Event emission ────────────────────────────────────────

  describe('event emission', () => {
    it('emits sovereign:tool:executing and sovereign:tool:executed events', async () => {
      const executingSpy = vi.fn();
      const executedSpy = vi.fn();
      toolkit.on('sovereign:tool:executing', executingSpy);
      toolkit.on('sovereign:tool:executed', executedSpy);

      vi.mocked(fs.readFileSync).mockReturnValue('data');
      await toolkit.executeTool('readFile', { path: '/tmp/test.txt' });

      expect(executingSpy).toHaveBeenCalledOnce();
      expect(executedSpy).toHaveBeenCalledOnce();
    });

    it('emits sovereign:tool:error when handler throws', async () => {
      toolkit.registerTool({
        name: 'failingTool',
        description: 'A tool that throws',
        category: 'shell',
        handler: async () => {
          throw new Error('boom');
        },
      });

      const errorSpy = vi.fn();
      toolkit.on('sovereign:tool:error', errorSpy);

      const result = await toolkit.executeTool('failingTool', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');
      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });
});
