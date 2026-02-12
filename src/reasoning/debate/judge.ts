/**
 * JudgeAgent — Evaluates debate arguments and selects a winner.
 *
 * After all debaters have argued across all rounds, the JudgeAgent
 * reviews every argument and produces a verdict: which approach to
 * adopt, synthesized insights, and a confidence score.
 *
 * Part of the Multi-Agent Debate reasoning system.
 */

import type { LLMProvider } from '../../providers/types.js';
import type { AgentTask } from '../../agents/types.js';
import type { DebaterArgument, JudgeVerdict } from '../types.js';
import { getLogger } from '../../core/logger.js';

const logger = getLogger();

export class JudgeAgent {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  /**
   * Evaluate all debate arguments and select the winning approach.
   */
  async evaluate(
    task: AgentTask,
    debateArguments: DebaterArgument[],
  ): Promise<JudgeVerdict> {
    const formattedArguments = debateArguments
      .map(
        (arg) =>
          `[Round ${arg.round + 1}] Debater ${arg.debaterId + 1} (${arg.perspective}):\n${arg.argument}`,
      )
      .join('\n\n---\n\n');

    const systemPrompt = `You are an impartial judge evaluating a technical debate. Multiple engineers with different perspectives have debated how to approach a task. Your job is to:

1. Evaluate each perspective on: correctness, maintainability, performance, security, simplicity
2. Select the best overall approach (you may synthesize ideas from multiple debaters)
3. Summarize key insights from the debate
4. Rate your confidence (0.0 to 1.0)

Respond with ONLY a JSON object:
{
  "selectedApproach": "A clear description of the approach to take",
  "synthesizedInsights": "Key insights drawn from all perspectives",
  "confidence": 0.85
}

Do not include any other text.`;

    try {
      const response = await this.provider.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `## Task\n${task.description}\n\n## Debate Arguments\n${formattedArguments}` },
        ],
        temperature: 0.2,
        maxTokens: 1024,
      });

      return this.parseVerdict(response.content, debateArguments);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ error: message }, 'JudgeAgent: evaluation failed, using fallback');
      return this.buildFallbackVerdict(debateArguments);
    }
  }

  private parseVerdict(content: string, debateArguments: DebaterArgument[]): JudgeVerdict {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON object found');

      const raw: Record<string, unknown> = JSON.parse(match[0]);

      return {
        selectedApproach: String(raw.selectedApproach ?? 'No approach selected'),
        synthesizedInsights: String(raw.synthesizedInsights ?? 'No insights available'),
        confidence: typeof raw.confidence === 'number'
          ? Math.max(0, Math.min(1, raw.confidence))
          : 0.5,
      };
    } catch {
      logger.warn('JudgeAgent: verdict parse failed, using fallback');
      return this.buildFallbackVerdict(debateArguments);
    }
  }

  private buildFallbackVerdict(debateArguments: DebaterArgument[]): JudgeVerdict {
    const lastRound = Math.max(...debateArguments.map((a) => a.round));
    const finalArgs = debateArguments.filter((a) => a.round === lastRound);

    const synthesized = finalArgs
      .map((a) => `[${a.perspective}]: ${a.argument.slice(0, 150)}`)
      .join('\n');

    return {
      selectedApproach: finalArgs.length > 0
        ? finalArgs[0].argument.slice(0, 300)
        : 'Direct implementation approach',
      synthesizedInsights: synthesized || 'No insights available from debate',
      confidence: 0.5,
    };
  }
}
