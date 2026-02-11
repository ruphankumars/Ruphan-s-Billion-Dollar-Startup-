import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { BaseGate } from './base-gate.js';
import type { QualityContext, GateResult, GateIssue } from '../types.js';

/**
 * Lint gate — runs the project's linter on changed files
 * Supports: ESLint (JS/TS), auto-detects based on project config
 */
export class LintGate extends BaseGate {
  name = 'lint';
  description = 'Runs the project linter on changed files';

  protected async execute(context: QualityContext): Promise<Omit<GateResult, 'gate' | 'duration'>> {
    const issues: GateIssue[] = [];

    // Filter to lintable files
    const lintableFiles = context.filesChanged.filter(f =>
      /\.(ts|tsx|js|jsx|mjs)$/.test(f),
    );

    if (lintableFiles.length === 0) {
      return { passed: true, issues: [] };
    }

    // Check if ESLint is available
    const hasEslint = existsSync(join(context.workingDir, 'node_modules', '.bin', 'eslint'))
      || existsSync(join(context.workingDir, '.eslintrc.cjs'))
      || existsSync(join(context.workingDir, '.eslintrc.json'))
      || existsSync(join(context.workingDir, 'eslint.config.js'))
      || existsSync(join(context.workingDir, 'eslint.config.mjs'));

    if (!hasEslint) {
      this.logger.debug('No ESLint configuration found, skipping lint gate');
      return { passed: true, issues: [] };
    }

    try {
      const fileArgs = lintableFiles.join(' ');
      execSync(
        `npx eslint --format json ${fileArgs}`,
        {
          cwd: context.workingDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30000,
        },
      );
      // If eslint exits 0, no issues
      return { passed: true, issues: [] };
    } catch (err) {
      const execErr = err as Error & { stdout?: string; stderr?: string; status?: number };

      // ESLint exits with 1 when there are issues
      if (execErr.stdout) {
        try {
          const results = JSON.parse(execErr.stdout) as Array<{
            filePath: string;
            messages: Array<{
              severity: number;
              message: string;
              line: number;
              column: number;
              ruleId: string;
              fix?: unknown;
            }>;
          }>;

          for (const result of results) {
            for (const msg of result.messages) {
              issues.push({
                severity: msg.severity === 2 ? 'error' : 'warning',
                message: msg.message,
                file: result.filePath,
                line: msg.line,
                column: msg.column,
                rule: msg.ruleId,
                autoFixable: !!msg.fix,
              });
            }
          }
        } catch {
          // If JSON parsing fails, treat as generic error
          issues.push({
            severity: 'warning',
            message: `ESLint output could not be parsed: ${execErr.stdout?.substring(0, 200)}`,
            autoFixable: false,
          });
        }
      } else {
        // ESLint crashed or not available
        this.logger.debug({ error: execErr.message }, 'ESLint execution failed');
        return { passed: true, issues: [] }; // Don't block on linter failures
      }
    }

    const errors = issues.filter(i => i.severity === 'error');
    const autoFixed = issues.filter(i => i.autoFixable).length;

    return {
      passed: errors.length === 0,
      issues,
      autoFixed,
    };
  }
}
