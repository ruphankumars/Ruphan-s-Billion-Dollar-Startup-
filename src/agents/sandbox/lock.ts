/**
 * File Lock Manager — Advisory filesystem locks for non-git projects.
 * Uses mkdir-based locking (atomic on POSIX) to prevent concurrent writes.
 */

import { mkdirSync, rmdirSync, existsSync, mkdirSync as mkdirp } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { getLogger } from '../../core/logger.js';

export class FileLockManager {
  private lockDir: string;
  private activeLocks = new Set<string>();
  private logger = getLogger();

  constructor(projectDir: string) {
    this.lockDir = join(projectDir, '.cortexos', 'locks');
    if (!existsSync(this.lockDir)) {
      mkdirp(this.lockDir, { recursive: true });
    }
  }

  /**
   * Acquire a lock on a file path. Throws if already locked.
   */
  acquireLock(filePath: string): void {
    const lockPath = this.getLockPath(filePath);

    try {
      mkdirSync(lockPath);
      this.activeLocks.add(lockPath);
      this.logger.debug({ filePath, lockPath }, 'Lock acquired');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EEXIST') {
        throw new Error(`File is already locked: ${filePath}`);
      }
      throw err;
    }
  }

  /**
   * Release a lock on a file path.
   */
  releaseLock(filePath: string): void {
    const lockPath = this.getLockPath(filePath);

    try {
      if (existsSync(lockPath)) {
        rmdirSync(lockPath);
      }
      this.activeLocks.delete(lockPath);
      this.logger.debug({ filePath }, 'Lock released');
    } catch (err) {
      this.logger.warn({ filePath, error: (err as Error).message }, 'Failed to release lock');
    }
  }

  /**
   * Check if a file is currently locked.
   */
  isLocked(filePath: string): boolean {
    return existsSync(this.getLockPath(filePath));
  }

  /**
   * Release all active locks held by this manager.
   */
  releaseAll(): void {
    for (const lockPath of this.activeLocks) {
      try {
        if (existsSync(lockPath)) {
          rmdirSync(lockPath);
        }
      } catch {
        // Best effort cleanup
      }
    }
    this.activeLocks.clear();
    this.logger.debug('All locks released');
  }

  /**
   * Get the lock path for a given file.
   */
  private getLockPath(filePath: string): string {
    const hash = createHash('sha256').update(filePath).digest('hex').slice(0, 16);
    return join(this.lockDir, `${hash}.lock`);
  }
}
