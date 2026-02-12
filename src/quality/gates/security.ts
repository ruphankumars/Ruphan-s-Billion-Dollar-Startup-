/**
 * Security Gate — detects leaked secrets and known vulnerability patterns.
 * Checks for API keys, tokens, passwords in code + basic dependency audit.
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { BaseGate } from './base-gate.js';
import type { QualityContext, GateResult, GateIssue } from '../types.js';

/** Regex patterns for common secret types */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; severity: 'error' | 'warning' }> = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g, severity: 'error' },
  { name: 'AWS Secret Key', pattern: /(?:aws_secret_access_key|secret)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi, severity: 'error' },
  { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,251}/g, severity: 'error' },
  { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]([A-Za-z0-9\-._~]{20,})['"]/gi, severity: 'warning' },
  { name: 'Generic Secret', pattern: /(?:secret|password|passwd|token)\s*[:=]\s*['"]([^'"]{8,})['"]/gi, severity: 'warning' },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, severity: 'error' },
  { name: 'Bearer Token', pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, severity: 'warning' },
  { name: 'Slack Token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g, severity: 'error' },
  { name: 'NPM Token', pattern: /npm_[A-Za-z0-9]{36}/g, severity: 'error' },
  { name: 'Anthropic API Key', pattern: /sk-ant-[A-Za-z0-9\-]{20,}/g, severity: 'error' },
  { name: 'OpenAI API Key', pattern: /sk-[A-Za-z0-9]{20,}/g, severity: 'error' },
];

/** Files that are expected to contain secrets (should be in .gitignore) */
const IGNORED_FILES = [
  '.env', '.env.local', '.env.development', '.env.production',
  '.env.test', '.env.example',
];

export class SecurityGate extends BaseGate {
  name = 'security';
  description = 'Scans for leaked secrets and known vulnerability patterns';

  protected async execute(context: QualityContext): Promise<Omit<GateResult, 'gate' | 'duration'>> {
    const issues: GateIssue[] = [];

    // 1. Scan changed files for secrets
    for (const filePath of context.filesChanged) {
      const fileName = filePath.split('/').pop() || '';

      // Skip expected secret files
      if (IGNORED_FILES.some(f => fileName === f || fileName.startsWith(f + '.'))) {
        continue;
      }

      // Skip binary-ish files
      if (/\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|svg|pdf|zip|tar|gz)$/.test(filePath)) {
        continue;
      }

      try {
        const content = readFileSync(filePath, 'utf-8');
        const secretIssues = this.scanForSecrets(content, filePath);
        issues.push(...secretIssues);
      } catch {
        // Can't read file, skip
      }
    }

    // 2. Check for .env files committed
    const envIssues = this.checkEnvFiles(context);
    issues.push(...envIssues);

    // 3. Run npm audit if package.json changed
    const pkgChanged = context.filesChanged.some(f =>
      f.endsWith('package.json') || f.endsWith('package-lock.json'),
    );
    if (pkgChanged) {
      const auditIssues = this.runDependencyAudit(context.workingDir);
      issues.push(...auditIssues);
    }

    const errors = issues.filter(i => i.severity === 'error');
    return {
      passed: errors.length === 0,
      issues,
    };
  }

  /**
   * Scan file content for secret patterns.
   */
  private scanForSecrets(content: string, filePath: string): GateIssue[] {
    const issues: GateIssue[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Skip comments that just mention secrets as example/placeholder
      if (/(?:example|placeholder|TODO|FIXME|your[_-]?\w+[_-]?here)/i.test(line)) {
        continue;
      }

      for (const pattern of SECRET_PATTERNS) {
        // Reset regex lastIndex
        pattern.pattern.lastIndex = 0;

        if (pattern.pattern.test(line)) {
          issues.push({
            severity: pattern.severity,
            message: `Potential ${pattern.name} detected`,
            file: filePath,
            line: lineNum,
            rule: 'no-secrets',
            autoFixable: false,
            suggestion: `Remove the secret and use an environment variable instead`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check if .env files are in the file changes (shouldn't be committed).
   */
  private checkEnvFiles(context: QualityContext): GateIssue[] {
    const issues: GateIssue[] = [];

    for (const filePath of context.filesChanged) {
      const fileName = filePath.split('/').pop() || '';
      if (fileName === '.env' || (fileName.startsWith('.env.') && !fileName.includes('example'))) {
        issues.push({
          severity: 'error',
          message: `Environment file "${fileName}" should not be committed — add it to .gitignore`,
          file: filePath,
          rule: 'no-env-commit',
          autoFixable: false,
          suggestion: `Add "${fileName}" to .gitignore`,
        });
      }
    }

    return issues;
  }

  /**
   * Run npm audit for dependency vulnerabilities.
   */
  private runDependencyAudit(workingDir: string): GateIssue[] {
    const issues: GateIssue[] = [];

    if (!existsSync(join(workingDir, 'package-lock.json'))) {
      return issues;
    }

    try {
      execSync('npm audit --json --audit-level=high', {
        cwd: workingDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
      // Exit 0 = no vulnerabilities
    } catch (err) {
      const execErr = err as Error & { stdout?: string; status?: number };

      if (execErr.stdout) {
        try {
          const audit = JSON.parse(execErr.stdout);
          const vulnCount = audit.metadata?.vulnerabilities?.high || 0;
          const critCount = audit.metadata?.vulnerabilities?.critical || 0;

          if (critCount > 0) {
            issues.push({
              severity: 'error',
              message: `${critCount} critical vulnerability(ies) found in dependencies`,
              rule: 'npm-audit',
              autoFixable: false,
              suggestion: 'Run `npm audit fix` to resolve',
            });
          }

          if (vulnCount > 0) {
            issues.push({
              severity: 'warning',
              message: `${vulnCount} high severity vulnerability(ies) found in dependencies`,
              rule: 'npm-audit',
              autoFixable: false,
              suggestion: 'Run `npm audit` for details',
            });
          }
        } catch {
          // Couldn't parse audit JSON — skip
        }
      }
    }

    return issues;
  }
}
