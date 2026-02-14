/**
 * FileWatcher — Ambient file system monitoring
 *
 * Watches directories for file changes using Node.js fs.watch with recursive
 * support, falling back to manual directory walking + fs.stat polling.
 * Computes MD5 hashes for change detection, debounces rapid changes,
 * and matches files against configurable WatchRule patterns.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { FileEvent, WatchRule } from './types.js';

// ═══════════════════════════════════════════════════════════════
// GLOB MATCHING (minimatch-like, zero dependencies)
// ═══════════════════════════════════════════════════════════════

/**
 * Simple glob matcher supporting:
 *  - `*` matches any characters except path separator
 *  - `**` matches any characters including path separators (nested dirs)
 *  - `?` matches a single character (not path separator)
 *  - Literal characters matched exactly
 */
function globToRegex(pattern: string): RegExp {
  // Normalize to forward slashes
  const normalized = pattern.replace(/\\/g, '/');
  let regex = '';
  let i = 0;

  while (i < normalized.length) {
    const char = normalized[i];

    if (char === '*') {
      if (normalized[i + 1] === '*') {
        // ** — match anything including path separators
        if (normalized[i + 2] === '/') {
          // **/  — match zero or more directory segments
          regex += '(?:.+/)?';
          i += 3;
        } else {
          // ** at end — match everything
          regex += '.*';
          i += 2;
        }
      } else {
        // Single * — match anything except /
        regex += '[^/]*';
        i += 1;
      }
    } else if (char === '?') {
      regex += '[^/]';
      i += 1;
    } else if (char === '.') {
      regex += '\\.';
      i += 1;
    } else if (char === '(' || char === ')' || char === '[' || char === ']' || char === '{' || char === '}' || char === '+' || char === '^' || char === '$' || char === '|') {
      regex += '\\' + char;
      i += 1;
    } else {
      regex += char;
      i += 1;
    }
  }

  return new RegExp('^' + regex + '$');
}

/**
 * Test if a file path matches a glob pattern.
 * The path is normalized to forward slashes before matching.
 */
export function matchGlob(pattern: string, filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const re = globToRegex(pattern);
  return re.test(normalizedPath);
}

// ═══════════════════════════════════════════════════════════════
// FILE WATCHER
// ═══════════════════════════════════════════════════════════════

interface FileWatcherOptions {
  /** Polling interval for stat-based fallback (ms). Default: 30000 */
  pollIntervalMs?: number;
  /** Maximum number of files to track. Default: 5000 */
  maxFiles?: number;
}

interface PendingChange {
  filePath: string;
  type: 'create' | 'modify' | 'delete' | 'rename';
  timer: ReturnType<typeof setTimeout>;
}

export class FileWatcher extends EventEmitter {
  private watchedDirs: Map<string, fs.FSWatcher> = new Map();
  private fileHashes: Map<string, string> = new Map();
  private fileSizes: Map<string, number> = new Map();
  private rules: WatchRule[] = [];
  private pollInterval: number;
  private maxFiles: number;
  private _isWatching = false;
  private pollTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private pendingChanges: Map<string, PendingChange> = new Map();

  /** Debounce window in ms for coalescing rapid file changes */
  private static readonly DEBOUNCE_MS = 100;

  constructor(options?: FileWatcherOptions) {
    super();
    this.pollInterval = options?.pollIntervalMs ?? 30000;
    this.maxFiles = options?.maxFiles ?? 5000;
  }

  // ─────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────

  /**
   * Start watching a directory recursively for file changes.
   * Uses fs.watch({ recursive: true }) where available (macOS, Windows),
   * falling back to manual directory walking + stat polling on Linux.
   */
  watch(dir: string): void {
    const absDir = path.resolve(dir);

    if (this.watchedDirs.has(absDir)) {
      return; // Already watching
    }

    try {
      // Attempt native recursive watching (macOS & Windows support)
      const watcher = fs.watch(absDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const filePath = path.join(absDir, filename);
        this.handleNativeEvent(eventType, filePath);
      });

      watcher.on('error', (error) => {
        this.emit('watcher:error', { dir: absDir, error });
      });

      this.watchedDirs.set(absDir, watcher);
      this._isWatching = true;

      // Initial scan to build hash map
      this.scanDirectory(absDir).catch((err) => {
        this.emit('watcher:error', { dir: absDir, error: err });
      });
    } catch {
      // Fallback: manual polling
      this.startPolling(absDir);
    }
  }

  /**
   * Stop watching a specific directory.
   */
  unwatch(dir: string): void {
    const absDir = path.resolve(dir);
    const watcher = this.watchedDirs.get(absDir);

    if (watcher) {
      watcher.close();
      this.watchedDirs.delete(absDir);
    }

    // Stop polling timer if any
    const pollTimer = this.pollTimers.get(absDir);
    if (pollTimer) {
      clearInterval(pollTimer);
      this.pollTimers.delete(absDir);
    }

    // Remove tracked hashes for this directory
    for (const [filePath] of this.fileHashes) {
      if (filePath.startsWith(absDir)) {
        this.fileHashes.delete(filePath);
        this.fileSizes.delete(filePath);
      }
    }

    if (this.watchedDirs.size === 0 && this.pollTimers.size === 0) {
      this._isWatching = false;
    }
  }

  /**
   * Stop watching all directories and clean up.
   */
  unwatchAll(): void {
    for (const [dir, watcher] of this.watchedDirs) {
      watcher.close();
      this.watchedDirs.delete(dir);
    }

    for (const [dir, timer] of this.pollTimers) {
      clearInterval(timer);
      this.pollTimers.delete(dir);
    }

    // Cancel all pending debounced changes
    for (const [, pending] of this.pendingChanges) {
      clearTimeout(pending.timer);
    }
    this.pendingChanges.clear();

    this.fileHashes.clear();
    this.fileSizes.clear();
    this._isWatching = false;
  }

  /**
   * Add a watch rule for file matching.
   */
  addRule(rule: WatchRule): void {
    // Validate priority range
    const clamped: WatchRule = {
      ...rule,
      priority: Math.max(1, Math.min(10, rule.priority)),
    };
    this.rules.push(clamped);
    // Sort by priority descending so higher-priority rules match first
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a rule by its pattern.
   */
  removeRule(pattern: string): void {
    this.rules = this.rules.filter((r) => r.pattern !== pattern);
  }

  /**
   * Get all current rules.
   */
  getRules(): WatchRule[] {
    return [...this.rules];
  }

  /**
   * Get all currently watched directories.
   */
  getWatchedDirs(): string[] {
    const dirs = new Set<string>();
    for (const dir of this.watchedDirs.keys()) dirs.add(dir);
    for (const dir of this.pollTimers.keys()) dirs.add(dir);
    return [...dirs];
  }

  /**
   * Whether the watcher is currently active.
   */
  isActive(): boolean {
    return this._isWatching;
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Native fs.watch handler
  // ─────────────────────────────────────────────────────────

  private handleNativeEvent(_eventType: string, filePath: string): void {
    // Debounce: if we already have a pending change for this path, reset its timer
    const existing = this.pendingChanges.get(filePath);
    if (existing) {
      clearTimeout(existing.timer);
      this.pendingChanges.delete(filePath);
    }

    const timer = setTimeout(() => {
      this.pendingChanges.delete(filePath);
      this.processFileChange(filePath).catch((err) => {
        this.emit('watcher:error', { file: filePath, error: err });
      });
    }, FileWatcher.DEBOUNCE_MS);

    this.pendingChanges.set(filePath, {
      filePath,
      type: 'modify', // Will be resolved in processFileChange
      timer,
    });
  }

  private async processFileChange(filePath: string): Promise<void> {
    // Check if file matches an ignore rule first
    const rule = this.matchRule(filePath);
    if (rule && rule.action === 'ignore') {
      return;
    }

    try {
      const stat = await fs.promises.stat(filePath);

      // Skip directories
      if (stat.isDirectory()) {
        return;
      }

      // Enforce max file limit
      if (!this.fileHashes.has(filePath) && this.fileHashes.size >= this.maxFiles) {
        return;
      }

      const hash = await this.computeFileHash(filePath);
      const previousHash = this.fileHashes.get(filePath);

      if (previousHash === undefined) {
        // New file
        this.fileHashes.set(filePath, hash);
        this.fileSizes.set(filePath, stat.size);
        const event: FileEvent = {
          path: filePath,
          type: 'create',
          timestamp: Date.now(),
          size: stat.size,
          hash,
        };
        this.emit('file:created', event);
      } else if (previousHash !== hash) {
        // Modified file
        this.fileHashes.set(filePath, hash);
        this.fileSizes.set(filePath, stat.size);
        const event: FileEvent = {
          path: filePath,
          type: 'modify',
          timestamp: Date.now(),
          size: stat.size,
          hash,
        };
        this.emit('file:changed', event);
      }
      // If hash is unchanged, do nothing (spurious event)
    } catch (err: unknown) {
      // File was deleted
      if (this.isNodeError(err) && err.code === 'ENOENT') {
        if (this.fileHashes.has(filePath)) {
          this.fileHashes.delete(filePath);
          const previousSize = this.fileSizes.get(filePath);
          this.fileSizes.delete(filePath);
          const event: FileEvent = {
            path: filePath,
            type: 'delete',
            timestamp: Date.now(),
            size: previousSize,
          };
          this.emit('file:deleted', event);
        }
      } else {
        this.emit('watcher:error', { file: filePath, error: err });
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Polling fallback
  // ─────────────────────────────────────────────────────────

  private startPolling(dir: string): void {
    // Do an initial scan
    this.scanDirectory(dir).catch((err) => {
      this.emit('watcher:error', { dir, error: err });
    });

    const timer = setInterval(() => {
      this.pollDirectory(dir).catch((err) => {
        this.emit('watcher:error', { dir, error: err });
      });
    }, this.pollInterval);

    this.pollTimers.set(dir, timer);
    this._isWatching = true;
  }

  private async pollDirectory(dir: string): Promise<void> {
    const currentFiles = new Map<string, string>();
    await this.walkDirectory(dir, currentFiles);

    // Detect new and modified files
    for (const [filePath, hash] of currentFiles) {
      const previousHash = this.fileHashes.get(filePath);
      if (previousHash === undefined) {
        this.fileHashes.set(filePath, hash);
        let stat: fs.Stats | undefined;
        try {
          stat = await fs.promises.stat(filePath);
          this.fileSizes.set(filePath, stat.size);
        } catch {
          // Ignore stat errors
        }
        const event: FileEvent = {
          path: filePath,
          type: 'create',
          timestamp: Date.now(),
          size: stat?.size,
          hash,
        };
        this.emit('file:created', event);
      } else if (previousHash !== hash) {
        this.fileHashes.set(filePath, hash);
        let stat: fs.Stats | undefined;
        try {
          stat = await fs.promises.stat(filePath);
          this.fileSizes.set(filePath, stat.size);
        } catch {
          // Ignore stat errors
        }
        const event: FileEvent = {
          path: filePath,
          type: 'modify',
          timestamp: Date.now(),
          size: stat?.size,
          hash,
        };
        this.emit('file:changed', event);
      }
    }

    // Detect deleted files
    for (const [filePath] of this.fileHashes) {
      if (filePath.startsWith(dir) && !currentFiles.has(filePath)) {
        const previousSize = this.fileSizes.get(filePath);
        this.fileHashes.delete(filePath);
        this.fileSizes.delete(filePath);
        const event: FileEvent = {
          path: filePath,
          type: 'delete',
          timestamp: Date.now(),
          size: previousSize,
        };
        this.emit('file:deleted', event);
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Directory scanning & hashing
  // ─────────────────────────────────────────────────────────

  private async scanDirectory(dir: string): Promise<void> {
    const files = new Map<string, string>();
    await this.walkDirectory(dir, files);

    for (const [filePath, hash] of files) {
      if (this.fileHashes.size >= this.maxFiles) {
        break;
      }
      this.fileHashes.set(filePath, hash);
      try {
        const stat = await fs.promises.stat(filePath);
        this.fileSizes.set(filePath, stat.size);
      } catch {
        // Ignore — file may have been deleted between walk and stat
      }
    }
  }

  private async walkDirectory(dir: string, out: Map<string, string>): Promise<void> {
    if (out.size >= this.maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Permission denied or directory gone
    }

    for (const entry of entries) {
      if (out.size >= this.maxFiles) break;

      const fullPath = path.join(dir, entry.name);

      // Skip common noise directories
      if (entry.isDirectory()) {
        const name = entry.name;
        if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.next' || name === '__pycache__') {
          continue;
        }
        await this.walkDirectory(fullPath, out);
      } else if (entry.isFile()) {
        // Check ignore rules before hashing
        const rule = this.matchRule(fullPath);
        if (rule && rule.action === 'ignore') {
          continue;
        }

        try {
          const hash = await this.computeFileHash(fullPath);
          out.set(fullPath, hash);
        } catch {
          // File may have disappeared
        }
      }
    }
  }

  private async computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Rule matching
  // ─────────────────────────────────────────────────────────

  /**
   * Find the highest-priority matching rule for a file path.
   * Rules are pre-sorted by priority descending.
   */
  private matchRule(filePath: string): WatchRule | null {
    // Normalize to forward slashes for glob matching
    const normalized = filePath.replace(/\\/g, '/');

    for (const rule of this.rules) {
      if (matchGlob(rule.pattern, normalized)) {
        return rule;
      }
      // Also try matching against just the filename or relative segments
      const basename = path.basename(filePath);
      if (matchGlob(rule.pattern, basename)) {
        return rule;
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Utilities
  // ─────────────────────────────────────────────────────────

  private isNodeError(err: unknown): err is NodeJS.ErrnoException {
    return err instanceof Error && 'code' in err;
  }
}
