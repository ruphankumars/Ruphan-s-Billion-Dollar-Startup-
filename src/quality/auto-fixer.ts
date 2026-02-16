/**
 * Auto-Fixer — applies automatic fixes for quality gate issues.
 * Handles: ESLint auto-fix, debugger statement removal, and more.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { QualityContext, GateIssue } from './types.js';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

export interface FixResult {
  file: string;
  rule?: string;
  description: string;
  type: 'lint' | 'syntax' | 'suggestion';
  success: boolean;
}

/**
 * AutoFixer orchestrates automatic fixing of quality gate issues.
 */
export class AutoFixer {
  /**
   * Apply all available fixes for the given issues.
   * Orchestrates lint fixes and syntax fixes.
   */
  async applyFixes(issues: GateIssue[], context: QualityContext): Promise<FixResult[]> {
    const results: FixResult[] = [];

    // Separate issues by type
    const lintIssues = issues.filter(i => i.autoFixable && i.rule);
    const syntaxIssues = issues.filter(
      i => i.autoFixable && i.message.includes('debugger'),
    );

    // Apply lint fixes (eslint --fix)
    if (lintIssues.length > 0) {
      const lintFixes = await this.fixLintIssues(context);
      results.push(...lintFixes);
    }

    // Apply syntax fixes (debugger removal, etc.)
    if (syntaxIssues.length > 0) {
      const syntaxFixes = this.fixSyntaxIssues(syntaxIssues, context);
      results.push(...syntaxFixes);
    }

    logger.info(
      { total: results.length, successful: results.filter(r => r.success).length },
      'Auto-fix pass complete',
    );

    return results;
  }

  /**
   * Run ESLint with --fix flag on changed files.
   */
  async fixLintIssues(context: QualityContext): Promise<FixResult[]> {
    const results: FixResult[] = [];

    const lintableFiles = context.filesChanged.filter(f =>
      /\.(ts|tsx|js|jsx|mjs)$/.test(f) && existsSync(f),
    );

    if (lintableFiles.length === 0) return results;

    // Check if ESLint is available
    const hasEslint =
      existsSync(join(context.workingDir, 'node_modules', '.bin', 'eslint')) ||
      existsSync(join(context.workingDir, '.eslintrc.cjs')) ||
      existsSync(join(context.workingDir, '.eslintrc.json')) ||
      existsSync(join(context.workingDir, 'eslint.config.js')) ||
      existsSync(join(context.workingDir, 'eslint.config.mjs'));

    if (!hasEslint) {
      logger.debug('No ESLint configuration found, skipping lint auto-fix');
      return results;
    }

    try {
      const fileArgs = lintableFiles.join(' ');
      execSync(`npx eslint --fix ${fileArgs}`, {
        cwd: context.workingDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });

      // ESLint exited 0 — all fixable issues fixed
      results.push({
        file: '*',
        description: `ESLint --fix applied to ${lintableFiles.length} file(s)`,
        type: 'lint',
        success: true,
      });
    } catch (err) {
      const execErr = err as Error & { stdout?: string; status?: number; killed?: boolean; signal?: string };

      // Check for timeout / kill signal BEFORE checking exit status.
      // execSync with a timeout option sends SIGTERM and sets killed=true.
      if (execErr.killed || execErr.signal === 'SIGTERM') {
        results.push({
          file: '*',
          description: 'ESLint timed out',
          type: 'lint',
          success: false,
        });
      } else if (execErr.status === 1) {
        // ESLint exits with 1 if remaining unfixed issues exist — that's OK
        results.push({
          file: '*',
          description: `ESLint --fix applied (some issues remain)`,
          type: 'lint',
          success: true,
        });
      } else {
        logger.debug({ error: execErr.message }, 'ESLint --fix failed');
        results.push({
          file: '*',
          description: `ESLint --fix failed: ${execErr.message}`,
          type: 'lint',
          success: false,
        });
      }
    }

    return results;
  }

  /**
   * Fix syntax issues: remove debugger statements, etc.
   */
  fixSyntaxIssues(issues: GateIssue[], _context: QualityContext): FixResult[] {
    const results: FixResult[] = [];

    // Group by file
    const byFile = new Map<string, GateIssue[]>();
    for (const issue of issues) {
      if (!issue.file || !issue.line) continue;
      const list = byFile.get(issue.file) || [];
      list.push(issue);
      byFile.set(issue.file, list);
    }

    for (const [filePath, fileIssues] of byFile) {
      try {
        if (!existsSync(filePath)) continue;

        let content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        let modified = false;

        // Process issues in reverse line order (highest line number first) to
        // preserve line numbers: splicing earlier lines would shift the indices
        // of all subsequent lines, but processing from bottom-up avoids this.
        const sortedIssues = [...fileIssues].sort(
          (a, b) => (b.line ?? 0) - (a.line ?? 0),
        );

        for (const issue of sortedIssues) {
          if (!issue.line) continue;

          const lineIndex = issue.line - 1;
          if (lineIndex < 0 || lineIndex >= lines.length) continue;

          // Remove debugger statements
          if (issue.message.includes('debugger')) {
            const line = lines[lineIndex];
            if (/^\s*debugger\s*;?\s*$/.test(line)) {
              lines.splice(lineIndex, 1);
              modified = true;

              results.push({
                file: filePath,
                rule: 'no-debugger',
                description: `Removed debugger statement at line ${issue.line}`,
                type: 'syntax',
                success: true,
              });
            }
          }
        }

        if (modified) {
          content = lines.join('\n');
          writeFileSync(filePath, content, 'utf-8');
        }
      } catch (err) {
        const error = err as Error;
        logger.debug({ file: filePath, error: error.message }, 'Syntax fix failed');
        results.push({
          file: filePath,
          description: `Syntax fix failed: ${error.message}`,
          type: 'syntax',
          success: false,
        });
      }
    }

    return results;
  }
}
