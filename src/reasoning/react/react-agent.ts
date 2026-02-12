/**
 * ReActAgent — Implements the ReAct (Reasoning + Acting) pattern.
 *
 * Wraps the standard agentic loop with explicit THOUGHT → ACTION → OBSERVATION
 * steps, producing a structured ReasoningTrace alongside the normal AgentResult.
 *
 * Based on: Yao et al. 2023 — "ReAct: Synergizing Reasoning and Acting in Language Models"
 */

import { nanoid } from 'nanoid';
import type { LLMMessage, ToolDefinition } from '../../providers/types.js';
import type { Tool, ToolContext, ToolResult } from '../../tools/types.js';
import type { AgentRoleName, AgentTask } from '../../agents/types.js';
import type { TokenUsage, FileChange } from '../../core/types.js';
import type { ReasoningResult, ThoughtStep, ReasoningTrace } from '../types.js';
import type { LLMProvider } from '../../providers/types.js';
import { getLogger } from '../../core/logger.js';

/**
 * ReAct agent configuration options
 */
export interface ReActAgentOptions {
  role: AgentRoleName;
  provider: LLMProvider;
  tools: Tool[];
  toolContext: ToolContext;
  maxIterations?: number;
  temperature?: number;
  systemPrompt?: string;
  model?: string;
  maxThoughts: number;
}

const REACT_SYSTEM_PROMPT = `You are an AI agent that uses the ReAct (Reasoning + Acting) framework.

For each step, you MUST follow this pattern:

Thought: <analyze the current situation, what you know, and what you need to do next>
Action: <decide which tool to use and why>

After receiving an observation from a tool, reflect on the result before deciding the next action.

Always begin your response with "Thought:" to show your reasoning process.
When you have enough information to provide a final answer, state your conclusion clearly.`;

/**
 * ReActAgent — The core ReAct reasoning loop.
 *
 * Implements its own agentic loop (mirroring Agent's pattern) with
 * explicit THOUGHT injection before LLM calls and OBSERVATION recording
 * after tool results.
 */
export class ReActAgent {
  public readonly id: string;
  private options: ReActAgentOptions;
  private logger = getLogger();

  constructor(options: ReActAgentOptions) {
    this.id = nanoid(8);
    this.options = {
      ...options,
      maxIterations: options.maxIterations ?? 20,
      temperature: options.temperature ?? 0.2,
    };
  }

  /**
   * Execute a task using the ReAct reasoning loop.
   */
  async execute(task: AgentTask): Promise<ReasoningResult> {
    const startTime = Date.now();
    const maxIterations = this.options.maxIterations!;
    const totalTokens: TokenUsage = { input: 0, output: 0, total: 0 };
    const filesChanged: FileChange[] = [];
    const thoughtSteps: ThoughtStep[] = [];
    let thoughtCount = 0;

    const messages: LLMMessage[] = this.buildReActMessages(task);
    const toolDefs = this.getToolDefinitions();

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        // After the first iteration, inject a thought prompt
        if (iteration > 0 && thoughtCount < this.options.maxThoughts) {
          messages.push({
            role: 'user',
            content: 'Thought: Based on the observations so far, what should I do next?',
          });
        }

        const response = await this.options.provider.complete({
          messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          temperature: this.options.temperature,
          maxTokens: 4096,
          model: this.options.model,
        });

        // Track token usage
        if (response.usage) {
          totalTokens.input += response.usage.inputTokens;
          totalTokens.output += response.usage.outputTokens;
          totalTokens.total = totalTokens.input + totalTokens.output;
        }

        // Extract "Thought:" lines from LLM content
        if (response.content) {
          const thoughts = this.extractThoughts(response.content);
          for (const thought of thoughts) {
            thoughtCount++;
            thoughtSteps.push({
              type: 'thought',
              content: thought,
              timestamp: Date.now(),
              tokenCost: response.usage?.outputTokens ?? 0,
            });
          }
        }

        // Handle tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: response.toolCalls,
          });

          for (const toolCall of response.toolCalls) {
            let args: Record<string, unknown>;
            try {
              args = typeof toolCall.arguments === 'string'
                ? JSON.parse(toolCall.arguments)
                : toolCall.arguments;
            } catch {
              args = {};
            }

            // Record action step
            thoughtSteps.push({
              type: 'action',
              content: `Tool: ${toolCall.name}, Args: ${JSON.stringify(args)}`,
              timestamp: Date.now(),
              tokenCost: 0,
            });

            const result = await this.executeTool(toolCall.name, args);

            // Track file changes
            if (toolCall.name === 'file_write' && args.path && result.success) {
              filesChanged.push({
                path: args.path as string,
                type: 'create',
                content: args.content as string,
              });
            }

            // Record observation step
            const observationContent = result.success
              ? result.output
              : `Error: ${result.error || 'Unknown error'}`;

            thoughtSteps.push({
              type: 'observation',
              content: observationContent,
              timestamp: Date.now(),
              tokenCost: 0,
            });

            messages.push({
              role: 'tool',
              content: observationContent,
              toolCallId: toolCall.id,
            });
          }

          continue;
        }

        // No tool calls — LLM is done
        const duration = Date.now() - startTime;
        return {
          taskId: task.id,
          success: true,
          response: response.content || '',
          filesChanged,
          tokensUsed: totalTokens,
          reasoning: {
            strategy: 'react',
            steps: thoughtSteps,
            totalTokens,
            duration,
            outcome: 'success',
          },
        };
      }

      // Hit iteration limit
      const duration = Date.now() - startTime;
      return {
        taskId: task.id,
        success: false,
        response: 'ReAct agent reached maximum iteration limit',
        error: `Reached maximum iterations (${maxIterations})`,
        filesChanged,
        tokensUsed: totalTokens,
        reasoning: {
          strategy: 'react',
          steps: thoughtSteps,
          totalTokens,
          duration,
          outcome: 'failure',
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ agentId: this.id, error: message }, 'ReAct agent execution failed');

      return {
        taskId: task.id,
        success: false,
        response: '',
        error: message,
        filesChanged: [],
        tokensUsed: totalTokens,
        reasoning: {
          strategy: 'react',
          steps: thoughtSteps,
          totalTokens,
          duration: Date.now() - startTime,
          outcome: 'failure',
        },
      };
    }
  }

  private buildReActMessages(task: AgentTask): LLMMessage[] {
    const messages: LLMMessage[] = [];

    const baseSystemPrompt = this.options.systemPrompt || '';
    const combinedSystemPrompt = baseSystemPrompt
      ? `${baseSystemPrompt}\n\n${REACT_SYSTEM_PROMPT}`
      : REACT_SYSTEM_PROMPT;

    messages.push({ role: 'system', content: combinedSystemPrompt });

    let userContent = `## Task\n${task.description}`;
    if (task.context) {
      userContent += `\n\n## Context\n${task.context}`;
    }
    messages.push({ role: 'user', content: userContent });

    return messages;
  }

  private getToolDefinitions(): ToolDefinition[] {
    return this.options.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required || [],
      } as Record<string, unknown>,
    }));
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.options.tools.find(t => t.name === name);
    if (!tool) {
      return { success: false, output: '', error: `Unknown tool: ${name}` };
    }
    try {
      return await tool.execute(args, this.options.toolContext);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  }

  /**
   * Extract "Thought:" lines from LLM response content.
   */
  private extractThoughts(content: string): string[] {
    const thoughts: string[] = [];
    const regex = /Thought:\s*([\s\S]*?)(?=(?:Action:|Observation:|Thought:)|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const thought = match[1].trim();
      if (thought) {
        thoughts.push(thought);
      }
    }

    return thoughts;
  }
}
