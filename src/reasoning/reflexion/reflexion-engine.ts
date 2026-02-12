/**
 * ReflexionEngine — Retry-with-self-reflection.
 *
 * When an agent execution fails, generates a self-reflection on what went wrong,
 * stores it in ReflexionMemory, and retries the task with accumulated reflections
 * prepended as additional context.
 *
 * Based on: Shinn et al. 2023 — "Reflexion: Language Agents with Verbal Reinforcement Learning"
 */

import type { LLMProvider } from '../../providers/types.js';
import type { Tool, ToolContext } from '../../tools/types.js';
import type { AgentRoleName, AgentTask } from '../../agents/types.js';
import type { ReasoningResult, ThoughtStep } from '../types.js';
import { Agent } from '../../agents/agent.js';
import type { AgentOptions } from '../../agents/agent.js';
import { ReflexionMemory } from './reflexion-memory.js';
import { getLogger } from '../../core/logger.js';

export interface ReflexionEngineOptions {
  maxRetries: number;
  triggerOn: 'failure' | 'low-quality' | 'both';
  role: AgentRoleName;
  provider: LLMProvider;
  tools: Tool[];
  toolContext: ToolContext;
  maxIterations?: number;
  temperature?: number;
  systemPrompt?: string;
  model?: string;
}

export class ReflexionEngine {
  private options: ReflexionEngineOptions;
  private memory: ReflexionMemory;
  private logger = getLogger();

  constructor(options: ReflexionEngineOptions) {
    this.options = options;
    this.memory = new ReflexionMemory();
  }

  /**
   * Reflect on a failed result and retry the task with accumulated reflections.
   */
  async reflectAndRetry(
    task: AgentTask,
    failedResult: ReasoningResult,
  ): Promise<ReasoningResult> {
    const startTime = Date.now();
    const thoughtSteps: ThoughtStep[] = [];
    let currentFailedResult = failedResult;

    this.logger.info(
      { taskId: task.id, maxRetries: this.options.maxRetries },
      'ReflexionEngine: starting reflect-and-retry loop',
    );

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      // 1. Generate reflection on the failure
      const reflection = await this.generateReflection(task, currentFailedResult);

      thoughtSteps.push({
        type: 'reflection',
        content: reflection,
        timestamp: Date.now(),
        tokenCost: 0,
      });

      // 2. Store in memory
      this.memory.addReflection(reflection);

      // 3. Create enhanced task with reflections prepended
      const reflectionContext = this.memory.serialize();
      const enhancedContext = task.context
        ? `## Previous Reflections\n${reflectionContext}\n\n${task.context}`
        : `## Previous Reflections\n${reflectionContext}`;

      const enhancedTask: AgentTask = { ...task, context: enhancedContext };

      // 4. Create new Agent and execute
      const agentOptions: AgentOptions = {
        role: this.options.role,
        provider: this.options.provider,
        tools: this.options.tools,
        toolContext: this.options.toolContext,
        maxIterations: this.options.maxIterations,
        temperature: this.options.temperature,
        systemPrompt: this.options.systemPrompt,
        model: this.options.model,
      };

      const agent = new Agent(agentOptions);
      const result = await agent.execute(enhancedTask);

      // 5. Check if successful
      if (result.success) {
        const duration = Date.now() - startTime;
        this.logger.info(
          { taskId: task.id, attempt: attempt + 1 },
          'ReflexionEngine: retry succeeded',
        );

        return {
          ...result,
          reasoning: {
            strategy: 'reflexion',
            steps: thoughtSteps,
            totalTokens: result.tokensUsed ?? { input: 0, output: 0, total: 0 },
            duration,
            outcome: 'success',
          },
        };
      }

      // 6. Still failing — update for next iteration
      this.logger.warn(
        { taskId: task.id, attempt: attempt + 1, error: result.error },
        'ReflexionEngine: retry failed',
      );

      currentFailedResult = { ...result, reasoning: currentFailedResult.reasoning };
    }

    // All retries exhausted
    const duration = Date.now() - startTime;
    this.logger.error(
      { taskId: task.id, retries: this.options.maxRetries },
      'ReflexionEngine: all retries exhausted',
    );

    return {
      ...currentFailedResult,
      reasoning: {
        strategy: 'reflexion',
        steps: thoughtSteps,
        totalTokens: currentFailedResult.tokensUsed ?? { input: 0, output: 0, total: 0 },
        duration,
        outcome: 'failure',
      },
    };
  }

  /**
   * Generate a reflection on what went wrong via LLM.
   */
  private async generateReflection(
    task: AgentTask,
    failedResult: ReasoningResult,
  ): Promise<string> {
    const response = await this.options.provider.complete({
      messages: [
        {
          role: 'system',
          content:
            'You are a self-reflective AI agent. Analyze what went wrong and suggest specific improvements. ' +
            'Be concise and actionable. Focus on what should be done differently in the next attempt.',
        },
        {
          role: 'user',
          content: [
            '## Failed Task',
            task.description,
            '',
            '## Error',
            failedResult.error || '(no error message)',
            '',
            '## Agent Response',
            (failedResult.response || '(no response)').substring(0, 1000),
            '',
            'Analyze why this task failed and provide a concise reflection with specific suggestions for improvement.',
          ].join('\n'),
        },
      ],
      temperature: 0.3,
      maxTokens: 1024,
      model: this.options.model,
    });

    return response.content || 'Unable to generate reflection.';
  }
}
