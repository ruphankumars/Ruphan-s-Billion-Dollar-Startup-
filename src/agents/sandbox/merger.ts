/**
 * Merge Manager — Combines agent worktree changes back into the main branch.
 * Auto-commits changes in worktrees, merges branches, handles conflicts.
 */

import { execSync } from 'child_process';
import { getLogger } from '../../core/logger.js';
import { mergeBranch, deleteBranch, getGitStatus } from '../../utils/git.js';
import type { WorktreeInfo } from './worktree.js';
import { WorktreeManager } from './worktree.js';

export interface MergeResult {
  taskId: string;
  branchName: string;
  success: boolean;
  conflicts: string[];
  error?: string;
}

export class MergeManager {
  private logger = getLogger();
  private repoDir: string;

  constructor(repoDir: string) {
    this.repoDir = repoDir;
  }

  /**
   * Auto-commit all changes in a worktree.
   * Returns true if there were changes to commit.
   */
  private commitWorktreeChanges(info: WorktreeInfo): boolean {
    const status = getGitStatus(info.worktreePath);
    if (!status) return false; // No changes

    try {
      execSync('git add -A', {
        cwd: info.worktreePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      execSync(`git commit -m "cortexos: ${info.taskId}"`, {
        cwd: info.worktreePath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.logger.debug({ taskId: info.taskId }, 'Auto-committed worktree changes');
      return true;
    } catch (err) {
      this.logger.warn({ taskId: info.taskId, error: (err as Error).message }, 'Failed to commit worktree changes');
      return false;
    }
  }

  /**
   * Merge a single worktree branch back into the main branch.
   */
  async mergeOne(info: WorktreeInfo): Promise<MergeResult> {
    // First, commit any uncommitted changes in the worktree
    this.commitWorktreeChanges(info);

    // Now merge the branch into the main branch (from repo root)
    const { success, output } = mergeBranch(this.repoDir, info.branchName);

    if (success) {
      this.logger.debug({ taskId: info.taskId, branch: info.branchName }, 'Branch merged successfully');
      return {
        taskId: info.taskId,
        branchName: info.branchName,
        success: true,
        conflicts: [],
      };
    }

    // Merge failed — likely a conflict
    this.logger.warn({ taskId: info.taskId, output }, 'Merge conflict detected');

    // Abort the merge to leave the repo in a clean state
    try {
      execSync('git merge --abort', {
        cwd: this.repoDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // If abort fails, repo might already be clean
    }

    return {
      taskId: info.taskId,
      branchName: info.branchName,
      success: false,
      conflicts: this.parseConflicts(output),
      error: output,
    };
  }

  /**
   * Merge all active worktrees from a WorktreeManager.
   * Processes sequentially to avoid merge conflicts between branches.
   */
  async mergeAll(worktreeManager: WorktreeManager): Promise<MergeResult[]> {
    const results: MergeResult[] = [];
    const worktrees = worktreeManager.getActiveWorktrees();

    for (const info of worktrees) {
      const result = await this.mergeOne(info);
      results.push(result);
    }

    return results;
  }

  /**
   * Clean up branches after merge (delete merged branches).
   */
  async cleanup(results: MergeResult[], worktreeManager: WorktreeManager): Promise<void> {
    for (const result of results) {
      // Remove the worktree first
      await worktreeManager.remove(result.taskId);

      // Then delete the branch
      if (result.success) {
        deleteBranch(this.repoDir, result.branchName);
        this.logger.debug({ branch: result.branchName }, 'Branch deleted after successful merge');
      }
    }
  }

  /**
   * Parse conflict file paths from merge output.
   */
  private parseConflicts(output: string): string[] {
    const conflicts: string[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Git merge conflict lines look like: "CONFLICT (content): Merge conflict in <file>"
      const match = line.match(/CONFLICT.*Merge conflict in (.+)/);
      if (match) {
        conflicts.push(match[1].trim());
      }
    }

    return conflicts;
  }
}
