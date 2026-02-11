import { nanoid } from 'nanoid';
import type { LLMProvider, LLMMessage, LLMResponse, ToolDefinition } from '../providers/types.js';
import type { Tool, ToolContext, ToolResult } from '../tools/types.js';
import type { AgentRoleName, AgentTask } from './types.js';
import type { AgentResult, TokenUsage } from '../core/types.js';
import { getLogger } from '../core/logger.js';

/**
 * Agent configuration options
 */
export interface AgentOptions {
  role: AgentRoleName;
  provider: LLMProvider;
  tools: Tool[];
  toolContext: ToolContext;
  maxIterations?: number;
  temperature?: number;
  systemPrompt?: string;
  model?: string;
}

/**
 * Agent — The core agentic loop. This is the heart of CortexOS.
 *
 * The loop: LLM call → tool execution → feed results back → repeat until done.
 */
export class Agent {
  public readonly id: string;
  private options: AgentOptions;
  private logger = getLogger();

  constructor(options: AgentOptions) {
    this.id = nanoid(8);
    this.options = {
      ...options,
      maxIterations: options.maxIterations ?? 20,
      temperature: options.temperature ?? 0.2,
    };
  }

  /**
   * THE CORE AGENTIC LOOP
   */
  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    const maxIterations = this.options.maxIterations!;
    let toolCallCount = 0;
    const totalTokens: TokenUsage = { input: 0, output: 0, total: 0 };
    const filesChanged: Array<{ path: string; type: 'create' | 'modify' | 'delete'; content?: string }> = [];

    // Build initial messages
    const messages: LLMMessage[] = this.buildMessages(task);

    // Get tool definitions
    const toolDefs = this.getToolDefinitions();

    try {
      // AGENTIC LOOP
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        // Call LLM
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

        // Handle tool calls
        if (response.toolCalls && response.toolCalls.length > 0) {
          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: response.toolCalls,
          });

          // Execute each tool call
          for (const toolCall of response.toolCalls) {
            toolCallCount++;

            let args: Record<string, unknown>;
            try {
              args = typeof toolCall.arguments === 'string'
                ? JSON.parse(toolCall.arguments)
                : toolCall.arguments;
            } catch {
              args = {};
            }

            // Execute tool
            const result = await this.executeTool(toolCall.name, args);

            // Track file changes
            if (toolCall.name === 'file_write' && args.path && result.success) {
              const path = args.path as string;
              filesChanged.push({
                path,
                type: 'create',
                content: args.content as string,
              });
            }

            // Add tool result to messages
            messages.push({
              role: 'tool',
              content: result.success
                ? result.output
                : `Error: ${result.error || 'Unknown error'}`,
              toolCallId: toolCall.id,
            });
          }

          // Continue loop — let LLM process tool results
          continue;
        }

        // No tool calls — LLM is done
        return {
          taskId: task.id,
          success: true,
          response: response.content || '',
          filesChanged: filesChanged.map(f => ({
            path: f.path,
            type: f.type,
            content: f.content,
          })),
          tokensUsed: totalTokens,
        };
      }

      // Hit iteration limit
      return {
        taskId: task.id,
        success: false,
        response: 'Agent reached maximum iteration limit',
        error: `Reached maximum iterations (${maxIterations})`,
        filesChanged: filesChanged.map(f => ({
          path: f.path,
          type: f.type,
          content: f.content,
        })),
        tokensUsed: totalTokens,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ agentId: this.id, error: message }, 'Agent execution failed');

      return {
        taskId: task.id,
        success: false,
        response: '',
        error: message,
        filesChanged: [],
        tokensUsed: totalTokens,
      };
    }
  }

  /**
   * Build initial message array
   */
  private buildMessages(task: AgentTask): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // System prompt
    if (this.options.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.options.systemPrompt,
      });
    }

    // User message with task + context
    let userContent = `## Task\n${task.description}`;

    if (task.context) {
      userContent += `\n\n## Context\n${task.context}`;
    }

    messages.push({ role: 'user', content: userContent });

    return messages;
  }

  /**
   * Get tool definitions for the LLM
   */
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

  /**
   * Execute a tool by name
   */
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
}
