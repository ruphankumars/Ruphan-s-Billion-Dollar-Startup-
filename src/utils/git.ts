import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Check if a directory is a git repository
 */
export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

/**
 * Get the root of the git repository
 */
export function getGitRoot(dir: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the current branch name
 */
export function getCurrentBranch(dir: string): string | null {
  try {
    return execSync('git branch --show-current', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get git status (short format)
 */
export function getGitStatus(dir: string): string {
  try {
    return execSync('git status --short', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Create a git worktree for isolated agent work
 */
export function createWorktree(
  repoDir: string,
  worktreePath: string,
  branchName: string,
): boolean {
  try {
    execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a git worktree
 */
export function removeWorktree(repoDir: string, worktreePath: string): boolean {
  try {
    execSync(`git worktree remove "${worktreePath}" --force`, {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * List all worktrees
 */
export function listWorktrees(repoDir: string): string[] {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.replace('worktree ', ''));
  } catch {
    return [];
  }
}

/**
 * Get the diff of staged + unstaged changes
 */
export function getGitDiff(dir: string): string {
  try {
    const staged = execSync('git diff --cached', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const unstaged = execSync('git diff', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return (staged + '\n' + unstaged).trim();
  } catch {
    return '';
  }
}

/**
 * Merge a branch into the current branch
 */
export function mergeBranch(dir: string, branchName: string): { success: boolean; output: string } {
  try {
    const output = execSync(`git merge "${branchName}" --no-edit`, {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    const error = err as Error & { stdout?: string; stderr?: string };
    return {
      success: false,
      output: error.stderr || error.stdout || error.message,
    };
  }
}

/**
 * Delete a local branch
 */
export function deleteBranch(dir: string, branchName: string): boolean {
  try {
    execSync(`git branch -D "${branchName}"`, {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
