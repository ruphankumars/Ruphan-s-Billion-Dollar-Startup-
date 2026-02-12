/**
 * ThoughtEvaluator — LLM-based scoring of candidate approaches.
 *
 * Scores each candidate approach on correctness, maintainability,
 * performance, security, and simplicity, producing a normalized 0-1 score.
 *
 * Part of the Tree-of-Thought reasoning system.
 */

import type { LLMProvider } from '../../providers/types.js';
import type { AgentTask } from '../../agents/types.js';
import type { CandidateApproach } from '../types.js';
import { getLogger } from '../../core/logger.js';

const logger = getLogger();

export class ThoughtEvaluator {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  /**
   * Score all candidate approaches for a given task.
   *
   * Calls the LLM once with ALL candidates in a single prompt, requesting
   * a score (1-10) for each on multiple criteria. Returns candidates with
   * updated scores normalized to 0-1.
   */
  async scoreAll(
    candidates: CandidateApproach[],
    task: AgentTask,
  ): Promise<CandidateApproach[]> {
    const candidateDescriptions = candidates
      .map((c) => `Candidate ${c.id}: "${c.description}"\nPlan: ${c.plan}`)
      .join('\n\n');

    const systemPrompt = `You are an expert software engineering evaluator. Score each candidate approach on these criteria (1-10 each):
- Correctness: Will it produce correct results?
- Maintainability: Is it clean and easy to maintain?
- Performance: Is it efficient?
- Security: Are there security concerns?
- Simplicity: Does it avoid unnecessary complexity?

Respond with ONLY a JSON array of overall scores (1-10) for each candidate, in order.
Example for 3 candidates: [7, 8, 6]

Do not include any other text.`;

    const userMessage = `## Task\n${task.description}\n\n## Candidates\n${candidateDescriptions}`;

    try {
      const response = await this.provider.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        maxTokens: 256,
      });

      const scores = this.parseScores(response.content, candidates.length);

      return candidates.map((c, i) => ({
        ...c,
        score: scores[i] / 10, // Normalize to 0-1
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { error: message },
        'ThoughtEvaluator: scoring failed, assigning equal scores',
      );

      // Fallback: equal scores
      const equalScore = 0.5;
      return candidates.map((c) => ({ ...c, score: equalScore }));
    }
  }

  /**
   * Parse an array of numeric scores from the LLM response.
   * Falls back to equal scores if parsing fails.
   */
  private parseScores(content: string, candidateCount: number): number[] {
    try {
      const match = content.match(/\[[\s\S]*?\]/);
      if (!match) throw new Error('No JSON array found');

      const raw: unknown = JSON.parse(match[0]);
      if (!Array.isArray(raw)) throw new Error('Not an array');

      const scores = raw.map((v) =>
        typeof v === 'number' ? Math.max(1, Math.min(10, v)) : 5,
      );

      // Pad or truncate to match candidate count
      while (scores.length < candidateCount) scores.push(5);
      return scores.slice(0, candidateCount);
    } catch {
      logger.warn('ThoughtEvaluator: Failed to parse scores, using defaults');
      return Array(candidateCount).fill(5);
    }
  }
}
