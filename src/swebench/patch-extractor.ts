/**
 * SWE-bench Patch Extractor — Extracts unified diff patches
 * from CortexOS execution results.
 *
 * Primary strategy: use `git diff` in the working directory.
 * Fallback: synthesize from ExecutionResult.filesChanged using the `diff` package.
 */

import { execSync } from 'child_process';
import { createPatch } from 'diff';
import { readFileSync, existsSync } from 'fs';
import type { FileChange } from '../core/types.js';

export class PatchExtractor {
  /**
   * Extract a unified diff from the working directory or execution result.
   */
  extract(filesChanged: FileChange[], workDir: string): string {
    // Strategy 1: git diff (preferred — produces proper unified format)
    const gitDiff = this.extractFromGit(workDir);
    if (gitDiff) return gitDiff;

    // Strategy 2: synthesize from filesChanged
    if (filesChanged && filesChanged.length > 0) {
      return this.synthesizeFromChanges(filesChanged, workDir);
    }

    return '';
  }

  /**
   * Extract diff from git working directory.
   */
  private extractFromGit(workDir: string): string | null {
    try {
      // Include both staged and unstaged changes
      const diff = execSync('git diff HEAD', {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return diff.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Synthesize a unified diff from FileChange objects.
   * Uses the `diff` npm package (already a project dependency).
   */
  private synthesizeFromChanges(changes: FileChange[], workDir: string): string {
    const patches: string[] = [];

    for (const change of changes) {
      const filePath = change.path;

      if (change.type === 'create') {
        // New file: diff against empty
        const patch = createPatch(filePath, '', change.content || '', 'before', 'after');
        patches.push(patch);
      } else if (change.type === 'modify') {
        // Modified file: try to read original, diff against new
        let original = '';
        try {
          const fullPath = workDir ? `${workDir}/${filePath}` : filePath;
          if (existsSync(fullPath)) {
            original = readFileSync(fullPath, 'utf-8');
          }
        } catch {
          // Can't read original, treat as create
        }
        const patch = createPatch(filePath, original, change.content || '', 'before', 'after');
        patches.push(patch);
      } else if (change.type === 'delete') {
        // Deleted file: diff from content to empty
        let original = '';
        try {
          const fullPath = workDir ? `${workDir}/${filePath}` : filePath;
          if (existsSync(fullPath)) {
            original = readFileSync(fullPath, 'utf-8');
          }
        } catch {
          // Can't read original
        }
        const patch = createPatch(filePath, original, '', 'before', 'after');
        patches.push(patch);
      }
    }

    return patches.join('\n');
  }

  /**
   * Validate that a string is a valid unified diff.
   */
  isValidUnifiedDiff(patch: string): boolean {
    if (!patch || patch.trim().length === 0) return false;

    // A valid unified diff should contain --- and +++ headers
    // and at least one @@ hunk header
    const hasOldHeader = /^---\s/m.test(patch);
    const hasNewHeader = /^\+\+\+\s/m.test(patch);
    const hasHunkHeader = /^@@\s/m.test(patch);

    return hasOldHeader && hasNewHeader && hasHunkHeader;
  }
}
