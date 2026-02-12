/**
 * SWE-bench Evaluator — Runs test commands against patched repositories
 * and computes pass/fail metrics.
 *
 * Applies the test patch, runs FAIL_TO_PASS and PASS_TO_PASS test suites,
 * and determines whether the issue is resolved.
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { SWEBenchInstance } from './types.js';

export interface EvaluationResult {
  success: boolean;
  tests_passed: number;
  tests_total: number;
  failToPassResults: TestRunResult;
  passToPassResults: TestRunResult;
  error?: string;
}

export interface TestRunResult {
  passed: number;
  failed: number;
  total: number;
  errors: string[];
}

export class SWEBenchEvaluator {
  private timeout: number;

  constructor(timeout = 120000) {
    this.timeout = timeout;
  }

  /**
   * Evaluate a patch against a SWE-bench instance.
   */
  async evaluate(
    instance: SWEBenchInstance,
    workDir: string,
  ): Promise<EvaluationResult> {
    try {
      // Step 1: Apply test patch (adds the new tests that should pass)
      this.applyTestPatch(instance, workDir);

      // Step 2: Parse test lists
      const failToPass = this.parseTests(instance.FAIL_TO_PASS);
      const passToPass = this.parseTests(instance.PASS_TO_PASS);

      // Step 3: Detect test command
      const testCmd = this.detectTestCommand(workDir);

      // Step 4: Run FAIL_TO_PASS tests (these should now pass after fix)
      const failToPassResults = this.runTests(failToPass, testCmd, workDir);

      // Step 5: Run PASS_TO_PASS tests (these should still pass)
      const passToPassResults = this.runTests(passToPass, testCmd, workDir);

      // Step 6: Determine success
      const allFailToPassNowPass = failToPassResults.passed === failToPassResults.total;
      const allPassToPassStillPass = passToPassResults.failed === 0;
      const success = allFailToPassNowPass && allPassToPassStillPass;

      const totalPassed = failToPassResults.passed + passToPassResults.passed;
      const totalTests = failToPassResults.total + passToPassResults.total;

      return {
        success,
        tests_passed: totalPassed,
        tests_total: totalTests,
        failToPassResults,
        passToPassResults,
      };
    } catch (error) {
      return {
        success: false,
        tests_passed: 0,
        tests_total: 0,
        failToPassResults: { passed: 0, failed: 0, total: 0, errors: [] },
        passToPassResults: { passed: 0, failed: 0, total: 0, errors: [] },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Apply the test patch from the SWE-bench instance.
   */
  private applyTestPatch(instance: SWEBenchInstance, workDir: string): void {
    if (!instance.test_patch || instance.test_patch.trim().length === 0) {
      return;
    }

    const patchFile = join(workDir, '.swebench-test.patch');
    writeFileSync(patchFile, instance.test_patch, 'utf-8');

    try {
      execSync(`git apply "${patchFile}"`, {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      // Some test patches may not apply cleanly; continue anyway
    }
  }

  /**
   * Parse a JSON array string of test identifiers.
   */
  private parseTests(jsonStr: string): string[] {
    if (!jsonStr || jsonStr.trim().length === 0) return [];
    try {
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  /**
   * Detect the appropriate test command for the repository.
   */
  detectTestCommand(workDir: string): string {
    // Python: look for pytest/setup.py/tox
    if (existsSync(join(workDir, 'pytest.ini')) ||
        existsSync(join(workDir, 'pyproject.toml')) ||
        existsSync(join(workDir, 'setup.py')) ||
        existsSync(join(workDir, 'setup.cfg'))) {
      return 'python -m pytest';
    }

    // JavaScript: look for package.json
    if (existsSync(join(workDir, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(workDir, 'package.json'), 'utf-8'));
        if (pkg.scripts?.test) {
          return 'npm test --';
        }
      } catch {
        // Fall through
      }
      return 'npx vitest run';
    }

    // Rust
    if (existsSync(join(workDir, 'Cargo.toml'))) {
      return 'cargo test';
    }

    // Go
    if (existsSync(join(workDir, 'go.mod'))) {
      return 'go test ./...';
    }

    // Default to pytest (most SWE-bench problems are Python)
    return 'python -m pytest';
  }

  /**
   * Run a list of tests and capture results.
   */
  private runTests(
    testIds: string[],
    testCmd: string,
    workDir: string,
  ): TestRunResult {
    if (testIds.length === 0) {
      return { passed: 0, failed: 0, total: 0, errors: [] };
    }

    const errors: string[] = [];
    let passed = 0;
    let failed = 0;

    for (const testId of testIds) {
      try {
        const cmd = `${testCmd} ${testId}`;
        execSync(cmd, {
          cwd: workDir,
          encoding: 'utf-8',
          timeout: this.timeout,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        passed++;
      } catch (error) {
        failed++;
        const err = error as Error & { stderr?: string };
        errors.push(`${testId}: ${err.stderr?.slice(0, 200) || err.message}`);
      }
    }

    return {
      passed,
      failed,
      total: testIds.length,
      errors,
    };
  }
}
