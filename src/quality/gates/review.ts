/**
 * Review Gate — sends code diff to an LLM for automated code review.
 * Requires an LLMProvider; skips if none is supplied.
 */

import { BaseGate } from './base-gate.js';
import type { QualityContext, GateResult, GateIssue } from '../types.js';
import type { LLMProvider } from '../../providers/types.js';
import { CODE_REVIEW_TEMPLATE } from '../../prompt/templates/verification.js';
import { getGitDiff } from '../../utils/git.js';

export class ReviewGate extends BaseGate {
  name = 'review';
  description = 'LLM-powered code review of changes';

  private provider: LLMProvider | undefined;

  constructor(provider?: LLMProvider) {
    super();
    this.provider = provider;
  }

  protected async execute(context: QualityContext): Promise<Omit<GateResult, 'gate' | 'duration'>> {
    if (!this.provider) {
      this.logger.debug('No LLM provider for review gate, skipping');
      return { passed: true, issues: [] };
    }

    // Get the diff to review
    const diff = context.diff || getGitDiff(context.workingDir);
    if (!diff) {
      this.logger.debug('No diff available for review gate');
      return { passed: true, issues: [] };
    }

    // Truncate very large diffs to stay within token limits
    const maxDiffChars = 50000;
    const truncatedDiff = diff.length > maxDiffChars
      ? diff.substring(0, maxDiffChars) + '\n\n... (diff truncated)'
      : diff;

    const prompt = CODE_REVIEW_TEMPLATE.replace('{changes}', truncatedDiff);

    try {
      const response = await this.provider.complete({
        messages: [
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        maxTokens: 4096,
      });

      return this.parseReviewResponse(response.content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ error: message }, 'Review gate LLM call failed');
      // Don't block on LLM failures
      return { passed: true, issues: [] };
    }
  }

  /**
   * Parse structured JSON from the LLM review response.
   */
  private parseReviewResponse(content: string): Omit<GateResult, 'gate' | 'duration'> {
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1]?.trim() || content.trim();
      const data = JSON.parse(jsonStr);

      const issues: GateIssue[] = (data.issues || []).map((issue: {
        severity?: string;
        file?: string;
        line?: number;
        message?: string;
        suggestion?: string;
      }) => ({
        severity: issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info',
        message: issue.message || 'Unnamed issue',
        file: issue.file,
        line: issue.line,
        suggestion: issue.suggestion,
        autoFixable: false,
      }));

      const passed = data.verdict === 'PASS' || (data.score !== undefined && data.score >= 60);

      return { passed, issues };
    } catch {
      // If JSON parsing fails, treat the whole response as a review comment
      this.logger.debug('Could not parse review response as JSON, treating as info');
      return {
        passed: true,
        issues: [{
          severity: 'info',
          message: `Code review notes: ${content.substring(0, 500)}`,
          autoFixable: false,
        }],
      };
    }
  }
}
