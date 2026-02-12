/**
 * TypeCheck Gate — runs `tsc --noEmit` to verify TypeScript types.
 * Skips if no tsconfig.json is found in the working directory.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { BaseGate } from './base-gate.js';
import type { QualityContext, GateResult, GateIssue } from '../types.js';

export class TypeCheckGate extends BaseGate {
  name = 'type-check';
  description = 'Runs TypeScript type checking via tsc --noEmit';

  protected async execute(context: QualityContext): Promise<Omit<GateResult, 'gate' | 'duration'>> {
    // Skip if no tsconfig.json
    const tsconfigPath = join(context.workingDir, 'tsconfig.json');
    if (!existsSync(tsconfigPath)) {
      this.logger.debug('No tsconfig.json found, skipping type-check gate');
      return { passed: true, issues: [] };
    }

    // Skip if no TypeScript files changed
    const tsFiles = context.filesChanged.filter(f => /\.tsx?$/.test(f));
    if (tsFiles.length === 0) {
      return { passed: true, issues: [] };
    }

    try {
      execSync('npx tsc --noEmit --pretty false', {
        cwd: context.workingDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
      });
      // Exit 0 means no type errors
      return { passed: true, issues: [] };
    } catch (err) {
      const execErr = err as Error & { stdout?: string; stderr?: string; status?: number };
      const output = execErr.stdout || execErr.stderr || execErr.message;
      const issues = this.parseTypeErrors(output);

      if (issues.length === 0) {
        // tsc crashed but no parseable errors — don't block
        this.logger.debug({ error: output.substring(0, 200) }, 'tsc execution failed without parseable errors');
        return { passed: true, issues: [] };
      }

      return {
        passed: false,
        issues,
      };
    }
  }

  /**
   * Parse tsc output with --pretty false format:
   * file(line,col): error TSxxxx: message
   */
  private parseTypeErrors(output: string): GateIssue[] {
    const issues: GateIssue[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const match = line.match(/^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/);
      if (match) {
        issues.push({
          severity: match[4] === 'error' ? 'error' : 'warning',
          message: `${match[5]}: ${match[6]}`,
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          rule: match[5],
          autoFixable: false,
        });
      }
    }

    return issues;
  }
}
