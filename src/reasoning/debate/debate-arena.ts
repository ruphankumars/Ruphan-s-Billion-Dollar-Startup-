/**
 * DebateArena — Multi-agent debate with diverse perspectives.
 *
 * Assigns distinct perspectives to N debaters, runs R rounds of debate
 * (with rebuttals in later rounds), then hands all arguments to a
 * JudgeAgent for final evaluation.
 *
 * Based on: Du et al. 2023 — "Improving Factuality and Reasoning via Multi-Agent Debate"
 */

import type { LLMProvider } from '../../providers/types.js';
import type { AgentTask } from '../../agents/types.js';
import type { PromptAnalysis } from '../../prompt/types.js';
import type { TokenUsage } from '../../core/types.js';
import type {
  DebaterArgument,
  ReasoningResult,
  ThoughtStep,
  ReasoningTrace,
} from '../types.js';
import type { AgentOptions } from '../../agents/agent.js';
import { Agent } from '../../agents/agent.js';
import { JudgeAgent } from './judge.js';
import { getLogger } from '../../core/logger.js';

const logger = getLogger();

const PERSPECTIVES = [
  'pragmatic-engineer',
  'performance-architect',
  'safety-advocate',
  'user-experience',
  'test-driven',
] as const;

interface DebateArenaConfig {
  debaters: number;
  rounds: number;
  complexityThreshold: number;
}

export class DebateArena {
  private config: DebateArenaConfig;
  private agentOptions: AgentOptions;
  private provider: LLMProvider;

  constructor(config: DebateArenaConfig, agentOptions: AgentOptions) {
    this.config = config;
    this.agentOptions = agentOptions;
    this.provider = agentOptions.provider;
  }

  /**
   * Run a multi-agent debate and execute the winning approach.
   */
  async debate(task: AgentTask, analysis: PromptAnalysis): Promise<ReasoningResult> {
    const startTime = Date.now();
    const steps: ThoughtStep[] = [];
    const totalTokens: TokenUsage = { input: 0, output: 0, total: 0 };
    const allArguments: DebaterArgument[] = [];

    logger.info(
      { taskId: task.id, debaters: this.config.debaters, rounds: this.config.rounds },
      'DebateArena: starting multi-agent debate',
    );

    // Step 1: Assign perspectives
    const perspectives = this.assignPerspectives();

    steps.push({
      type: 'thought',
      content: `Debate initiated with ${perspectives.length} perspectives: ${perspectives.join(', ')}`,
      timestamp: Date.now(),
      tokenCost: 0,
    });

    // Step 2: Run debate rounds
    for (let round = 0; round < this.config.rounds; round++) {
      steps.push({
        type: 'action',
        content: `Starting debate round ${round + 1} of ${this.config.rounds}`,
        timestamp: Date.now(),
        tokenCost: 0,
      });

      for (let debaterId = 0; debaterId < this.config.debaters; debaterId++) {
        const perspective = perspectives[debaterId];

        const argument = await this.getDebaterArgument(
          debaterId, perspective, task, allArguments, round,
        );

        allArguments.push({ debaterId, perspective, argument, round });

        steps.push({
          type: 'observation',
          content: `[Round ${round + 1}] ${perspective}: ${argument.slice(0, 150)}...`,
          timestamp: Date.now(),
          tokenCost: 0,
        });
      }
    }

    // Step 3: Judge evaluates all arguments
    steps.push({
      type: 'action',
      content: 'Submitting arguments to JudgeAgent for evaluation',
      timestamp: Date.now(),
      tokenCost: 0,
    });

    const judge = new JudgeAgent(this.provider);
    const verdict = await judge.evaluate(task, allArguments);

    steps.push({
      type: 'thought',
      content: `Judge verdict (confidence=${verdict.confidence.toFixed(2)}): ${verdict.selectedApproach.slice(0, 200)}`,
      timestamp: Date.now(),
      tokenCost: 0,
    });

    // Step 4: Execute via Agent with selected approach
    const enhancedTask: AgentTask = {
      ...task,
      context: [
        task.context ?? '',
        '',
        '## Selected Approach (Multi-Agent Debate)',
        `**Approach:** ${verdict.selectedApproach}`,
        `**Insights:** ${verdict.synthesizedInsights}`,
        `**Confidence:** ${verdict.confidence.toFixed(2)}`,
      ].join('\n'),
    };

    const agent = new Agent(this.agentOptions);
    const agentResult = await agent.execute(enhancedTask);

    if (agentResult.tokensUsed) {
      totalTokens.input += agentResult.tokensUsed.input;
      totalTokens.output += agentResult.tokensUsed.output;
      totalTokens.total += agentResult.tokensUsed.total;
    }

    const duration = Date.now() - startTime;
    const trace: ReasoningTrace = {
      strategy: 'debate',
      steps,
      totalTokens,
      duration,
      outcome: agentResult.success ? 'success' : 'failure',
    };

    logger.info(
      { taskId: task.id, confidence: verdict.confidence, success: agentResult.success, duration },
      'DebateArena: completed',
    );

    return { ...agentResult, reasoning: trace };
  }

  private assignPerspectives(): string[] {
    const count = Math.min(this.config.debaters, PERSPECTIVES.length);
    return PERSPECTIVES.slice(0, count) as unknown as string[];
  }

  private async getDebaterArgument(
    debaterId: number,
    perspective: string,
    task: AgentTask,
    previousArgs: DebaterArgument[],
    round: number,
  ): Promise<string> {
    const perspectivePrompts: Record<string, string> = {
      'pragmatic-engineer': 'You are a pragmatic engineer who values working solutions, clear code, and practical trade-offs.',
      'performance-architect': 'You are a performance-focused architect who prioritizes efficiency, scalability, and optimal resource usage.',
      'safety-advocate': 'You are a safety advocate who prioritizes error handling, input validation, and security best practices.',
      'user-experience': 'You are a user-experience advocate who prioritizes clear APIs, intuitive interfaces, and developer ergonomics.',
      'test-driven': 'You are a test-driven development advocate who prioritizes testability, clear contracts, and comprehensive coverage.',
    };

    const systemPrompt = `${perspectivePrompts[perspective] ?? `You are an expert with the perspective: ${perspective}.`}

${round === 0
      ? 'Present your initial approach and reasoning.'
      : 'Review the previous arguments and provide a rebuttal or refined position.'}

Provide a clear, concise argument (3-5 paragraphs) with concrete technical recommendations.`;

    let userMessage = `## Task\n${task.description}`;
    if (task.context) userMessage += `\n\n## Context\n${task.context}`;

    if (round > 0 && previousArgs.length > 0) {
      const prevFormatted = previousArgs
        .map((a) => `[Round ${a.round + 1}] ${a.perspective}: ${a.argument}`)
        .join('\n\n---\n\n');
      userMessage += `\n\n## Previous Arguments\n${prevFormatted}`;
    }

    try {
      const response = await this.provider.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.5,
        maxTokens: 1024,
      });
      return response.content || 'No argument provided.';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ debaterId, perspective, round, error: message }, 'DebateArena: debater argument failed');
      return `[${perspective}] Unable to generate argument. Recommending direct implementation.`;
    }
  }
}
