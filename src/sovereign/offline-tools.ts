/**
 * OfflineToolkit — Built-in Offline Tools
 *
 * Provides a set of tools that work without internet connectivity.
 * All tools use node:fs, node:child_process, and node:path.
 * Zero npm dependencies — zero internet dependency.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { OfflineTool, ToolResult } from './types.js';

// ═══════════════════════════════════════════════════════════════
// OFFLINE TOOLKIT
// ═══════════════════════════════════════════════════════════════

export class OfflineToolkit extends EventEmitter {
  private tools: Map<string, OfflineTool> = new Map();
  private running = false;
  private executionCount = 0;

  constructor() {
    super();
    this.registerBuiltinTools();
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('sovereign:toolkit:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('sovereign:toolkit:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // TOOL MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Register a custom offline tool.
   */
  registerTool(tool: OfflineTool): void {
    this.tools.set(tool.name, tool);

    this.emit('sovereign:tool:registered', {
      timestamp: Date.now(),
      name: tool.name,
      category: tool.category,
    });
  }

  /**
   * Execute an offline tool by name.
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Tool not found: ${name}`,
      };
    }

    this.emit('sovereign:tool:executing', {
      timestamp: Date.now(),
      name,
      args,
    });

    try {
      const result = await tool.handler(args);
      this.executionCount++;

      this.emit('sovereign:tool:executed', {
        timestamp: Date.now(),
        name,
        success: result.success,
      });

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emit('sovereign:tool:error', {
        timestamp: Date.now(),
        name,
        error: errorMsg,
      });

      return {
        success: false,
        output: '',
        error: errorMsg,
      };
    }
  }

  /**
   * List all available offline tools.
   */
  listTools(): OfflineTool[] {
    return [...this.tools.values()];
  }

  /**
   * Get a tool by name.
   */
  getTool(name: string): OfflineTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get statistics.
   */
  getStats(): {
    toolCount: number;
    executionCount: number;
    categories: Record<string, number>;
  } {
    const categories: Record<string, number> = {};
    for (const tool of this.tools.values()) {
      categories[tool.category] = (categories[tool.category] ?? 0) + 1;
    }

    return {
      toolCount: this.tools.size,
      executionCount: this.executionCount,
      categories,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Built-in tool registration
  // ─────────────────────────────────────────────────────────

  private registerBuiltinTools(): void {
    // ── Filesystem tools ──

    this.tools.set('readFile', {
      name: 'readFile',
      description: 'Read the contents of a file',
      category: 'filesystem',
      handler: async (args) => {
        const filePath = String(args.path ?? '');
        if (!filePath) {
          return { success: false, output: '', error: 'path is required' };
        }
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          return { success: true, output: content };
        } catch (err) {
          return {
            success: false,
            output: '',
            error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    });

    this.tools.set('writeFile', {
      name: 'writeFile',
      description: 'Write content to a file',
      category: 'filesystem',
      handler: async (args) => {
        const filePath = String(args.path ?? '');
        const content = String(args.content ?? '');
        if (!filePath) {
          return { success: false, output: '', error: 'path is required' };
        }
        try {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(filePath, content, 'utf-8');
          return { success: true, output: `Written ${content.length} bytes to ${filePath}` };
        } catch (err) {
          return {
            success: false,
            output: '',
            error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    });

    this.tools.set('listDir', {
      name: 'listDir',
      description: 'List files and directories in a path',
      category: 'filesystem',
      handler: async (args) => {
        const dirPath = String(args.path ?? '.');
        try {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          const listing = entries.map((e) => {
            const type = e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'link' : 'file';
            return `${type}\t${e.name}`;
          });
          return { success: true, output: listing.join('\n') };
        } catch (err) {
          return {
            success: false,
            output: '',
            error: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    });

    this.tools.set('searchFiles', {
      name: 'searchFiles',
      description: 'Search for files matching a pattern using glob-like matching',
      category: 'filesystem',
      handler: async (args) => {
        const dir = String(args.path ?? '.');
        const pattern = String(args.pattern ?? '*');
        try {
          const results: string[] = [];
          this.walkDir(dir, pattern, results, 0, 100);
          return { success: true, output: results.join('\n') };
        } catch (err) {
          return {
            success: false,
            output: '',
            error: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    });

    // ── Git tools ──

    this.tools.set('gitStatus', {
      name: 'gitStatus',
      description: 'Show git working tree status',
      category: 'git',
      handler: async (args) => {
        const cwd = String(args.cwd ?? '.');
        try {
          const output = execSync('git status --porcelain', {
            cwd,
            encoding: 'utf-8',
            timeout: 10000,
          });
          return { success: true, output: output || '(clean working tree)' };
        } catch (err) {
          return {
            success: false,
            output: '',
            error: `git status failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    });

    this.tools.set('gitDiff', {
      name: 'gitDiff',
      description: 'Show git diff of unstaged changes',
      category: 'git',
      handler: async (args) => {
        const cwd = String(args.cwd ?? '.');
        const staged = args.staged === true ? '--staged' : '';
        try {
          const output = execSync(`git diff ${staged}`.trim(), {
            cwd,
            encoding: 'utf-8',
            timeout: 10000,
          });
          return { success: true, output: output || '(no changes)' };
        } catch (err) {
          return {
            success: false,
            output: '',
            error: `git diff failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    });

    this.tools.set('gitLog', {
      name: 'gitLog',
      description: 'Show recent git commit log',
      category: 'git',
      handler: async (args) => {
        const cwd = String(args.cwd ?? '.');
        const count = Number(args.count ?? 10);
        try {
          const output = execSync(
            `git log --oneline -n ${count}`,
            { cwd, encoding: 'utf-8', timeout: 10000 },
          );
          return { success: true, output };
        } catch (err) {
          return {
            success: false,
            output: '',
            error: `git log failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    });

    // ── Shell tools ──

    this.tools.set('shellExec', {
      name: 'shellExec',
      description: 'Execute a shell command (with safety restrictions)',
      category: 'shell',
      handler: async (args) => {
        const command = String(args.command ?? '');
        const cwd = String(args.cwd ?? '.');
        if (!command) {
          return { success: false, output: '', error: 'command is required' };
        }

        // Safety: block dangerous commands
        const blocked = ['rm -rf /', 'rm -rf ~', 'mkfs', 'dd if=', ':(){', 'chmod -R 777 /'];
        for (const pattern of blocked) {
          if (command.includes(pattern)) {
            return {
              success: false,
              output: '',
              error: `Blocked dangerous command: ${pattern}`,
            };
          }
        }

        try {
          const output = execSync(command, {
            cwd,
            encoding: 'utf-8',
            timeout: 30000,
            maxBuffer: 1024 * 1024, // 1MB
          });
          return { success: true, output };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          // execSync throws on non-zero exit, but we still want the output
          const execError = err as { stdout?: string; stderr?: string };
          const output = execError.stdout ?? execError.stderr ?? '';
          return { success: false, output, error };
        }
      },
    });

    // ── Analysis tools ──

    this.tools.set('analyzeCode', {
      name: 'analyzeCode',
      description: 'Analyze code for basic metrics (line count, complexity hints)',
      category: 'analysis',
      handler: async (args) => {
        const filePath = String(args.path ?? '');
        if (!filePath) {
          return { success: false, output: '', error: 'path is required' };
        }
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          const totalLines = lines.length;
          const blankLines = lines.filter((l) => l.trim() === '').length;
          const commentLines = lines.filter((l) => {
            const trimmed = l.trim();
            return trimmed.startsWith('//') || trimmed.startsWith('#') ||
              trimmed.startsWith('*') || trimmed.startsWith('/*');
          }).length;
          const codeLines = totalLines - blankLines - commentLines;

          // Simple complexity: count control flow keywords
          const complexityKeywords = ['if', 'else', 'for', 'while', 'switch', 'case', 'catch', 'try'];
          let complexity = 0;
          for (const keyword of complexityKeywords) {
            const regex = new RegExp(`\\b${keyword}\\b`, 'g');
            const matches = content.match(regex);
            complexity += matches?.length ?? 0;
          }

          // Count functions/methods
          const functionPattern = /\b(function|const\s+\w+\s*=\s*(?:async\s*)?\(|(?:async\s+)?(?:get|set)\s+\w+\s*\(|(?:public|private|protected|static)?\s*(?:async\s+)?\w+\s*\()/g;
          const functions = content.match(functionPattern)?.length ?? 0;

          const ext = path.extname(filePath);
          const analysis = [
            `File: ${filePath}`,
            `Extension: ${ext}`,
            `Total lines: ${totalLines}`,
            `Code lines: ${codeLines}`,
            `Blank lines: ${blankLines}`,
            `Comment lines: ${commentLines}`,
            `Functions/methods: ${functions}`,
            `Cyclomatic complexity (approx): ${complexity + 1}`,
          ];

          return { success: true, output: analysis.join('\n') };
        } catch (err) {
          return {
            success: false,
            output: '',
            error: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    });
  }

  /**
   * Walk a directory recursively, collecting files matching a simple pattern.
   */
  private walkDir(
    dir: string,
    pattern: string,
    results: string[],
    depth: number,
    maxResults: number,
  ): void {
    if (results.length >= maxResults || depth > 10) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;

        // Skip hidden directories and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          this.walkDir(fullPath, pattern, results, depth + 1, maxResults);
        } else if (this.matchesPattern(entry.name, pattern)) {
          results.push(fullPath);
        }
      }
    } catch {
      // Skip directories we cannot read
    }
  }

  /**
   * Simple glob-like pattern matching supporting * and ? wildcards.
   */
  private matchesPattern(filename: string, pattern: string): boolean {
    if (pattern === '*') return true;

    // Convert glob to regex
    const regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    try {
      return new RegExp(`^${regexStr}$`, 'i').test(filename);
    } catch {
      return filename.includes(pattern);
    }
  }
}
