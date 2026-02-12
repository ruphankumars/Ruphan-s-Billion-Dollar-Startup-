/**
 * Worktree Manager — Git worktree isolation for parallel agents.
 * Each agent gets its own worktree on a unique branch to avoid conflicts.
 */

import { join } from 'path';
import { getLogger } from '../../core/logger.js';
import {
  createWorktree,
  removeWorktree,
  isGitRepo,
  getCurrentBranch,
} from '../../utils/git.js';

export interface WorktreeInfo {
  taskId: string;
  branchName: string;
  worktreePath: string;
  baseBranch: string;
}

export class WorktreeManager {
  private activeWorktrees = new Map<string, WorktreeInfo>();
  private logger = getLogger();
  private repoDir: string;
  private worktreeBaseDir: string;

  constructor(repoDir: string) {
    this.repoDir = repoDir;
    this.worktreeBaseDir = join(repoDir, '.cortexos', 'worktrees');
  }

  /**
   * Check if worktrees can be used in this project.
   */
  isAvailable(): boolean {
    return isGitRepo(this.repoDir);
  }

  /**
   * Create a worktree for a specific task.
   */
  async create(executionId: string, taskId: string): Promise<WorktreeInfo> {
    const branchName = `cortex/${executionId}/${taskId}`;
    const worktreePath = join(this.worktreeBaseDir, taskId);
    const baseBranch = getCurrentBranch(this.repoDir) || 'main';

    this.logger.debug({ taskId, branchName, worktreePath }, 'Creating worktree');

    const success = createWorktree(this.repoDir, worktreePath, branchName);
    if (!success) {
      throw new Error(`Failed to create worktree for task ${taskId} at ${worktreePath}`);
    }

    const info: WorktreeInfo = { taskId, branchName, worktreePath, baseBranch };
    this.activeWorktrees.set(taskId, info);

    return info;
  }

  /**
   * Create worktrees for all tasks in a wave.
   */
  async createForWave(executionId: string, taskIds: string[]): Promise<Map<string, WorktreeInfo>> {
    const results = new Map<string, WorktreeInfo>();

    for (const taskId of taskIds) {
      const info = await this.create(executionId, taskId);
      results.set(taskId, info);
    }

    return results;
  }

  /**
   * Get the working directory for a task (its worktree path).
   */
  getWorkingDir(taskId: string): string | undefined {
    return this.activeWorktrees.get(taskId)?.worktreePath;
  }

  /**
   * Get info about an active worktree.
   */
  getInfo(taskId: string): WorktreeInfo | undefined {
    return this.activeWorktrees.get(taskId);
  }

  /**
   * Get all active worktrees.
   */
  getActiveWorktrees(): WorktreeInfo[] {
    return Array.from(this.activeWorktrees.values());
  }

  /**
   * Remove a single worktree and its tracking.
   */
  async remove(taskId: string): Promise<void> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) return;

    this.logger.debug({ taskId, worktreePath: info.worktreePath }, 'Removing worktree');
    removeWorktree(this.repoDir, info.worktreePath);
    this.activeWorktrees.delete(taskId);
  }

  /**
   * Clean up all active worktrees.
   */
  async cleanupAll(): Promise<void> {
    const taskIds = Array.from(this.activeWorktrees.keys());
    for (const taskId of taskIds) {
      await this.remove(taskId);
    }
    this.logger.debug('All worktrees cleaned up');
  }
}
