import type { QualityGate, QualityContext, GateResult, GateIssue } from './types.js';
import { SyntaxGate } from './gates/syntax.js';
import { LintGate } from './gates/lint.js';
import { TypeCheckGate } from './gates/type-check.js';
import { TestGate } from './gates/test.js';
import { ReviewGate } from './gates/review.js';
import { SecurityGate } from './gates/security.js';
import { getLogger } from '../core/logger.js';
import type { QualityReport } from '../core/types.js';
import type { LLMProvider } from '../providers/types.js';

/**
 * Quality Verifier — runs a pipeline of quality gates on agent output
 */
export class QualityVerifier {
  private gates: QualityGate[] = [];
  private logger = getLogger();

  constructor(enabledGates: string[] = ['syntax', 'lint'], provider?: LLMProvider) {
    // Register available gates
    const availableGates: Record<string, QualityGate> = {
      syntax: new SyntaxGate(),
      lint: new LintGate(),
      'type-check': new TypeCheckGate(),
      test: new TestGate(),
      review: new ReviewGate(provider),
      security: new SecurityGate(),
    };

    // Enable only the requested gates
    for (const gateName of enabledGates) {
      const gate = availableGates[gateName];
      if (gate) {
        this.gates.push(gate);
      } else {
        this.logger.warn({ gate: gateName }, 'Unknown quality gate requested');
      }
    }
  }

  /**
   * Run all enabled quality gates on the given context
   */
  async verify(context: QualityContext): Promise<QualityReport> {
    if (context.filesChanged.length === 0) {
      return {
        passed: true,
        gates: [],
        issues: [],
        autoFixed: 0,
      };
    }

    const gateResults: GateResult[] = [];
    const allIssues: QualityReport['issues'] = [];
    let totalAutoFixed = 0;

    for (const gate of this.gates) {
      this.logger.debug({ gate: gate.name }, 'Running quality gate');
      const result = await gate.run(context);
      gateResults.push(result);

      // Collect issues
      for (const issue of result.issues) {
        allIssues.push({
          ...issue,
          gate: gate.name,
        });
      }

      if (result.autoFixed) {
        totalAutoFixed += result.autoFixed;
      }
    }

    const allPassed = gateResults.every(r => r.passed);

    return {
      passed: allPassed,
      gates: gateResults.map(r => ({
        gate: r.gate,
        passed: r.passed,
        issues: r.issues.map(i => ({
          severity: i.severity,
          message: i.message,
          file: i.file,
          line: i.line,
          gate: r.gate,
          autoFixable: i.autoFixable,
        })),
        duration: r.duration,
      })),
      issues: allIssues,
      autoFixed: totalAutoFixed,
    };
  }

  /**
   * Dynamically add a quality gate (e.g. from a plugin)
   */
  addGate(_name: string, gate: QualityGate): void {
    // Avoid duplicates
    if (!this.gates.some(g => g.name === gate.name)) {
      this.gates.push(gate);
      this.logger.debug({ gate: gate.name }, 'Quality gate added dynamically');
    }
  }

  /**
   * Get list of enabled gates
   */
  getEnabledGates(): string[] {
    return this.gates.map(g => g.name);
  }
}
