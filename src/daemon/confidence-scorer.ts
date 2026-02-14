/**
 * ConfidenceScorer — Computes confidence scores for agent outputs
 *
 * Evaluates execution quality through multiple weighted factors:
 * tests, lint, type checking, critic verdicts, efficiency,
 * change size, and response quality.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import type { CriticReport, ConfidenceScore, ConfidenceFactor } from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface ConfidenceScorerOptions {
  /** Custom weights for scoring factors. Keys match factor names. */
  weights?: Record<string, number>;
}

interface ScoreContext {
  filesChanged?: Array<{
    path: string;
    content: string;
    linesAdded?: number;
    linesRemoved?: number;
  }>;
  testsPassed?: boolean;
  testsRun?: number;
  lintPassed?: boolean;
  typeCheckPassed?: boolean;
  criticReport?: CriticReport;
  iterationsUsed?: number;
  maxIterations?: number;
  tokensUsed?: number;
  duration?: number;
  prompt?: string;
  response?: string;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT WEIGHTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_WEIGHTS: Record<string, number> = {
  tests: 0.25,
  lint: 0.15,
  typeCheck: 0.15,
  critic: 0.20,
  efficiency: 0.10,
  changeSize: 0.05,
  responseQuality: 0.10,
};

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE SCORER
// ═══════════════════════════════════════════════════════════════

export class ConfidenceScorer {
  private weights: Record<string, number>;

  constructor(options?: ConfidenceScorerOptions) {
    this.weights = { ...DEFAULT_WEIGHTS, ...options?.weights };

    // Normalize weights so they sum to 1.0
    const totalWeight = Object.values(this.weights).reduce((sum, w) => sum + w, 0);
    if (totalWeight > 0 && Math.abs(totalWeight - 1.0) > 0.001) {
      for (const key of Object.keys(this.weights)) {
        this.weights[key] = this.weights[key] / totalWeight;
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // MAIN SCORING
  // ─────────────────────────────────────────────────────────

  /**
   * Compute an overall confidence score from multiple execution signals.
   * Only factors with available data contribute to the score.
   */
  score(context: ScoreContext): ConfidenceScore {
    const factors: ConfidenceFactor[] = [];

    // Collect all applicable factors
    if (context.testsPassed !== undefined && context.testsRun !== undefined) {
      factors.push(this.scoreTestCoverage(context.testsPassed, context.testsRun));
    }

    if (context.lintPassed !== undefined) {
      factors.push(this.scoreLintCompliance(context.lintPassed));
    }

    if (context.typeCheckPassed !== undefined) {
      factors.push(this.scoreTypeCheck(context.typeCheckPassed));
    }

    if (context.criticReport) {
      factors.push(this.scoreCriticVerdict(context.criticReport));
    }

    if (context.iterationsUsed !== undefined && context.maxIterations !== undefined) {
      factors.push(this.scoreEfficiency(context.iterationsUsed, context.maxIterations));
    }

    if (context.filesChanged) {
      const totalAdded = context.filesChanged.reduce((sum, f) => sum + (f.linesAdded ?? 0), 0);
      const totalRemoved = context.filesChanged.reduce((sum, f) => sum + (f.linesRemoved ?? 0), 0);
      factors.push(this.scoreChangeSize(context.filesChanged.length, totalAdded, totalRemoved));
    }

    if (context.prompt !== undefined && context.response !== undefined) {
      factors.push(this.scoreResponseQuality(context.prompt, context.response));
    }

    // Compute weighted overall score
    let weightedSum = 0;
    let weightSum = 0;

    for (const factor of factors) {
      weightedSum += factor.score * factor.weight;
      weightSum += factor.weight;
    }

    // Normalize by actual weight sum (some factors may be missing)
    const overall = weightSum > 0 ? weightedSum / weightSum : 0;

    // Build breakdown map
    const breakdown: Record<string, number> = {};
    for (const factor of factors) {
      breakdown[factor.name] = factor.score;
    }

    return {
      overall: Math.max(0, Math.min(1, overall)),
      breakdown,
      factors,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INDIVIDUAL FACTOR SCORERS
  // ─────────────────────────────────────────────────────────

  /**
   * Score based on test results.
   * Full score if all tests pass, partial if some run but fail.
   */
  scoreTestCoverage(testsPassed: boolean, testsRun: number): ConfidenceFactor {
    const weight = this.weights.tests ?? DEFAULT_WEIGHTS.tests;

    if (testsRun === 0) {
      return {
        name: 'tests',
        weight,
        score: 0.3,
        reason: 'No tests were run. Consider adding tests for verification.',
      };
    }

    if (testsPassed) {
      // Score increases with number of tests run
      const coverage = Math.min(1.0, 0.7 + (testsRun / 50) * 0.3);
      return {
        name: 'tests',
        weight,
        score: coverage,
        reason: `All ${testsRun} test(s) passed.`,
      };
    }

    return {
      name: 'tests',
      weight,
      score: 0.1,
      reason: `Tests failed (${testsRun} test(s) run).`,
    };
  }

  /**
   * Score based on linting results.
   * Binary: pass or fail.
   */
  scoreLintCompliance(passed: boolean): ConfidenceFactor {
    const weight = this.weights.lint ?? DEFAULT_WEIGHTS.lint;

    return {
      name: 'lint',
      weight,
      score: passed ? 1.0 : 0.2,
      reason: passed ? 'Lint checks passed.' : 'Lint checks failed. Code may have style or quality issues.',
    };
  }

  /**
   * Score based on TypeScript type checking.
   * Binary: pass or fail.
   */
  scoreTypeCheck(passed: boolean): ConfidenceFactor {
    const weight = this.weights.typeCheck ?? DEFAULT_WEIGHTS.typeCheck;

    return {
      name: 'typeCheck',
      weight,
      score: passed ? 1.0 : 0.1,
      reason: passed ? 'Type checking passed.' : 'Type checking failed. There are type errors that need attention.',
    };
  }

  /**
   * Score based on critic agent verdict.
   * Maps verdict to score, adjusted by critic's own confidence.
   */
  scoreCriticVerdict(report: CriticReport): ConfidenceFactor {
    const weight = this.weights.critic ?? DEFAULT_WEIGHTS.critic;

    const verdictScores: Record<string, number> = {
      pass: 1.0,
      warn: 0.6,
      fail: 0.15,
    };

    const baseScore = verdictScores[report.verdict] ?? 0.5;
    // Blend with the critic's own confidence
    const score = baseScore * 0.7 + report.confidence * 0.3;

    const issueCount = report.issues.length;
    const criticalCount = report.issues.filter((i) => i.severity === 'critical').length;

    let reason: string;
    if (report.verdict === 'pass') {
      reason = `Critic passed with ${issueCount} issue(s).`;
    } else if (report.verdict === 'warn') {
      reason = `Critic warned with ${issueCount} issue(s) (${criticalCount} critical).`;
    } else {
      reason = `Critic failed with ${issueCount} issue(s) (${criticalCount} critical).`;
    }

    return {
      name: 'critic',
      weight,
      score: Math.max(0, Math.min(1, score)),
      reason,
    };
  }

  /**
   * Score based on how efficiently the agent used its iteration budget.
   * Lower iteration usage = higher efficiency score.
   */
  scoreEfficiency(iterationsUsed: number, maxIterations: number): ConfidenceFactor {
    const weight = this.weights.efficiency ?? DEFAULT_WEIGHTS.efficiency;

    if (maxIterations <= 0) {
      return {
        name: 'efficiency',
        weight,
        score: 0.5,
        reason: 'Invalid max iterations.',
      };
    }

    const usage = iterationsUsed / maxIterations;

    let score: number;
    let reason: string;

    if (usage <= 0.25) {
      // Completed in first quarter — excellent
      score = 1.0;
      reason = `Completed efficiently in ${iterationsUsed}/${maxIterations} iterations (${Math.round(usage * 100)}% budget used).`;
    } else if (usage <= 0.5) {
      score = 0.85;
      reason = `Completed in ${iterationsUsed}/${maxIterations} iterations (${Math.round(usage * 100)}% budget used).`;
    } else if (usage <= 0.75) {
      score = 0.6;
      reason = `Used ${iterationsUsed}/${maxIterations} iterations (${Math.round(usage * 100)}% budget). Consider if the task was well-scoped.`;
    } else if (usage < 1.0) {
      score = 0.35;
      reason = `Used ${iterationsUsed}/${maxIterations} iterations (${Math.round(usage * 100)}% budget). Task may have been too complex or ambiguous.`;
    } else {
      // Hit the limit
      score = 0.1;
      reason = `Exhausted all ${maxIterations} iterations. Task may not be fully complete.`;
    }

    return {
      name: 'efficiency',
      weight,
      score,
      reason,
    };
  }

  /**
   * Score based on the size and scope of changes.
   * Smaller, focused changes score higher. Very large changes may indicate
   * scope creep or incomplete decomposition.
   */
  scoreChangeSize(filesChanged: number, linesAdded: number, linesRemoved: number): ConfidenceFactor {
    const weight = this.weights.changeSize ?? DEFAULT_WEIGHTS.changeSize;
    const totalChurn = linesAdded + linesRemoved;

    let score: number;
    let reason: string;

    if (filesChanged === 0 && totalChurn === 0) {
      score = 0.3;
      reason = 'No files were changed. The task may not have been completed.';
    } else if (filesChanged <= 3 && totalChurn <= 100) {
      score = 1.0;
      reason = `Small, focused change: ${filesChanged} file(s), ${linesAdded} added, ${linesRemoved} removed.`;
    } else if (filesChanged <= 8 && totalChurn <= 500) {
      score = 0.8;
      reason = `Moderate change: ${filesChanged} file(s), ${linesAdded} added, ${linesRemoved} removed.`;
    } else if (filesChanged <= 15 && totalChurn <= 1500) {
      score = 0.6;
      reason = `Large change: ${filesChanged} file(s), ${linesAdded} added, ${linesRemoved} removed. Consider breaking into smaller PRs.`;
    } else {
      score = 0.3;
      reason = `Very large change: ${filesChanged} file(s), ${totalChurn} lines churned. High risk of unintended side effects.`;
    }

    return {
      name: 'changeSize',
      weight,
      score,
      reason,
    };
  }

  /**
   * Score the quality of the response relative to the prompt.
   * Heuristics: length ratio, presence of code blocks, explanation quality.
   */
  scoreResponseQuality(prompt: string, response: string): ConfidenceFactor {
    const weight = this.weights.responseQuality ?? DEFAULT_WEIGHTS.responseQuality;

    if (!response || response.trim().length === 0) {
      return {
        name: 'responseQuality',
        weight,
        score: 0.0,
        reason: 'Empty response.',
      };
    }

    let score = 0.5; // Base score
    const reasons: string[] = [];

    // Length ratio: response should be substantive relative to prompt
    const promptLength = prompt.trim().length;
    const responseLength = response.trim().length;

    if (promptLength > 0) {
      const ratio = responseLength / promptLength;
      if (ratio >= 1.0 && ratio <= 50) {
        score += 0.1;
        reasons.push('Response length is proportional to prompt');
      } else if (ratio < 0.5) {
        score -= 0.15;
        reasons.push('Response seems too short relative to the prompt');
      } else if (ratio > 100) {
        score -= 0.05;
        reasons.push('Response seems disproportionately long');
      }
    }

    // Check for code blocks (good indicator of code-related responses)
    const codeBlockCount = (response.match(/```/g) || []).length / 2;
    if (codeBlockCount >= 1) {
      score += 0.1;
      reasons.push(`Contains ${Math.floor(codeBlockCount)} code block(s)`);
    }

    // Check for structured content (bullet points, numbered lists, headers)
    const hasStructure = /^[\s]*[-*][\s]/m.test(response) || /^[\s]*\d+\./m.test(response) || /^#+\s/m.test(response);
    if (hasStructure) {
      score += 0.05;
      reasons.push('Response is well-structured');
    }

    // Check for error or failure indicators
    const hasErrors = /\b(error|failed|cannot|unable|impossible)\b/i.test(response);
    if (hasErrors) {
      score -= 0.1;
      reasons.push('Response indicates potential errors or failures');
    }

    // Check for uncertainty markers
    const hasUncertainty = /\b(might|maybe|perhaps|not sure|uncertain|unclear)\b/i.test(response);
    if (hasUncertainty) {
      score -= 0.05;
      reasons.push('Response contains uncertainty markers');
    }

    return {
      name: 'responseQuality',
      weight,
      score: Math.max(0, Math.min(1, score)),
      reason: reasons.length > 0 ? reasons.join('. ') + '.' : 'Response quality assessed.',
    };
  }

  // ─────────────────────────────────────────────────────────
  // UTILITY
  // ─────────────────────────────────────────────────────────

  /**
   * Get the default weight configuration.
   */
  getDefaultWeights(): Record<string, number> {
    return { ...DEFAULT_WEIGHTS };
  }
}
