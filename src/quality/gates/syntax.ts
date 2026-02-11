import { readFileSync } from 'fs';
import { extname } from 'path';
import { BaseGate } from './base-gate.js';
import type { QualityContext, GateResult, GateIssue } from '../types.js';

/**
 * Syntax gate — validates basic syntax of changed files
 * Uses regex-based checks for common syntax errors
 */
export class SyntaxGate extends BaseGate {
  name = 'syntax';
  description = 'Checks for basic syntax errors in changed files';

  protected async execute(context: QualityContext): Promise<Omit<GateResult, 'gate' | 'duration'>> {
    const issues: GateIssue[] = [];

    for (const filePath of context.filesChanged) {
      const ext = extname(filePath);
      if (!['.ts', '.tsx', '.js', '.jsx', '.json'].includes(ext)) continue;

      try {
        const content = readFileSync(filePath, 'utf-8');

        if (ext === '.json') {
          try {
            JSON.parse(content);
          } catch (e) {
            const err = e as Error;
            issues.push({
              severity: 'error',
              message: `Invalid JSON: ${err.message}`,
              file: filePath,
              autoFixable: false,
            });
          }
          continue;
        }

        // Check for common syntax issues in JS/TS files
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum = i + 1;

          // Unmatched brackets (rough check)
          const openBraces = (line.match(/\{/g) || []).length;
          const closeBraces = (line.match(/\}/g) || []).length;
          const openParens = (line.match(/\(/g) || []).length;
          const closeParens = (line.match(/\)/g) || []).length;

          // Check for console.log left in code
          if (/console\.(log|debug|info)\(/.test(line) && !filePath.includes('logger')) {
            issues.push({
              severity: 'warning',
              message: 'console.log statement found — consider using logger instead',
              file: filePath,
              line: lineNum,
              autoFixable: false,
            });
          }

          // Check for debugger statements
          if (/^\s*debugger\s*;?\s*$/.test(line)) {
            issues.push({
              severity: 'error',
              message: 'debugger statement found',
              file: filePath,
              line: lineNum,
              autoFixable: true,
            });
          }

          // Check for TODO/FIXME/HACK comments
          if (/\/\/\s*(TODO|FIXME|HACK|XXX):?/i.test(line)) {
            issues.push({
              severity: 'info',
              message: 'TODO/FIXME comment found',
              file: filePath,
              line: lineNum,
              autoFixable: false,
            });
          }
        }

        // Check for balanced brackets in the entire file
        const allOpen = (content.match(/\{/g) || []).length;
        const allClose = (content.match(/\}/g) || []).length;
        if (allOpen !== allClose) {
          issues.push({
            severity: 'warning',
            message: `Potentially unbalanced braces: ${allOpen} open, ${allClose} close`,
            file: filePath,
            autoFixable: false,
          });
        }
      } catch (e) {
        const err = e as Error;
        issues.push({
          severity: 'error',
          message: `Could not read file: ${err.message}`,
          file: filePath,
          autoFixable: false,
        });
      }
    }

    const errors = issues.filter(i => i.severity === 'error');
    return {
      passed: errors.length === 0,
      issues,
    };
  }
}
