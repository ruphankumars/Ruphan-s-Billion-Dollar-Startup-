/**
 * Test Gate — auto-detects and runs the project's test runner.
 * Supports: vitest, jest, npm test. Parses JSON reporter output.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BaseGate } from './base-gate.js';
import type { QualityContext, GateResult, GateIssue } from '../types.js';

type TestRunner = 'vitest' | 'jest' | 'npm';

export class TestGate extends BaseGate {
  name = 'test';
  description = 'Runs the project test suite and reports failures';

  protected async execute(context: QualityContext): Promise<Omit<GateResult, 'gate' | 'duration'>> {
    const runner = this.detectRunner(context.workingDir);

    if (!runner) {
      this.logger.debug('No test runner detected, skipping test gate');
      return { passed: true, issues: [] };
    }

    this.logger.debug({ runner }, 'Detected test runner');

    try {
      const { command, parseOutput } = this.getRunnerConfig(runner, context.workingDir);

      const output = execSync(command, {
        cwd: context.workingDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
        env: { ...process.env, CI: 'true', NODE_ENV: 'test' },
      });

      // Exit 0 = all tests pass
      return { passed: true, issues: [] };
    } catch (err) {
      const execErr = err as Error & { stdout?: string; stderr?: string; status?: number };
      const output = execErr.stdout || execErr.stderr || execErr.message;
      const issues = this.parseFailures(runner, output);

      if (issues.length === 0) {
        // Tests crashed but no parseable failures
        issues.push({
          severity: 'error',
          message: `Test runner "${runner}" exited with errors: ${output.substring(0, 300)}`,
          autoFixable: false,
        });
      }

      return {
        passed: false,
        issues,
      };
    }
  }

  /**
   * Detect which test runner the project uses.
   */
  detectRunner(workingDir: string): TestRunner | null {
    // Check for vitest
    if (
      existsSync(join(workingDir, 'vitest.config.ts')) ||
      existsSync(join(workingDir, 'vitest.config.js')) ||
      existsSync(join(workingDir, 'vitest.config.mts'))
    ) {
      return 'vitest';
    }

    // Check for jest
    if (
      existsSync(join(workingDir, 'jest.config.ts')) ||
      existsSync(join(workingDir, 'jest.config.js')) ||
      existsSync(join(workingDir, 'jest.config.json'))
    ) {
      return 'jest';
    }

    // Check package.json for test scripts
    const pkgPath = join(workingDir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts?.test) {
          // Check if the test script references vitest or jest
          const testScript = pkg.scripts.test;
          if (testScript.includes('vitest')) return 'vitest';
          if (testScript.includes('jest')) return 'jest';
          return 'npm'; // Generic npm test
        }

        // Check devDependencies
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.vitest) return 'vitest';
        if (deps.jest) return 'jest';
      } catch {
        // Ignore JSON parse errors
      }
    }

    return null;
  }

  /**
   * Get the command and parser for a given test runner.
   */
  private getRunnerConfig(runner: TestRunner, workingDir: string): {
    command: string;
    parseOutput: (output: string) => GateIssue[];
  } {
    switch (runner) {
      case 'vitest':
        return {
          command: 'npx vitest run --reporter=json 2>&1',
          parseOutput: (output) => this.parseFailures(runner, output),
        };

      case 'jest':
        return {
          command: 'npx jest --json --forceExit 2>&1',
          parseOutput: (output) => this.parseFailures(runner, output),
        };

      case 'npm':
        return {
          command: 'npm test 2>&1',
          parseOutput: (output) => this.parseFailures(runner, output),
        };
    }
  }

  /**
   * Parse test failures from runner output.
   */
  private parseFailures(runner: TestRunner, output: string): GateIssue[] {
    const issues: GateIssue[] = [];

    if (runner === 'vitest' || runner === 'jest') {
      // Try to parse JSON output
      try {
        // Find JSON block in output (may be mixed with other text)
        const jsonMatch = output.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          const testResults = data.testResults || [];

          for (const suite of testResults) {
            const failedTests = (suite.assertionResults || []).filter(
              (t: { status: string }) => t.status === 'failed',
            );

            for (const test of failedTests) {
              const messages = test.failureMessages || [];
              issues.push({
                severity: 'error',
                message: `Test failed: ${test.fullName || test.title}${messages.length > 0 ? ' — ' + messages[0].substring(0, 200) : ''}`,
                file: suite.name || suite.testFilePath,
                autoFixable: false,
              });
            }
          }
        }
      } catch {
        // JSON parsing failed, fall through to regex
      }
    }

    // Fallback: regex-based parsing for common patterns
    if (issues.length === 0) {
      const lines = output.split('\n');
      for (const line of lines) {
        // Match patterns like "FAIL src/foo.test.ts"
        const failMatch = line.match(/FAIL\s+(.+\.(?:test|spec)\.\w+)/);
        if (failMatch) {
          issues.push({
            severity: 'error',
            message: `Test suite failed: ${failMatch[1]}`,
            file: failMatch[1],
            autoFixable: false,
          });
        }

        // Match "✗" or "✕" or "×" failure markers
        const xMatch = line.match(/[✗✕×]\s+(.+)/);
        if (xMatch) {
          issues.push({
            severity: 'error',
            message: `Test failed: ${xMatch[1].trim()}`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  }
}
