/**
 * Mock LLM Provider for Testing
 */

import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk, ToolDefinition } from '../../src/providers/types.js';

export class MockProvider implements LLMProvider {
  name = 'mock';
  responses: LLMResponse[] = [];
  calls: LLMRequest[] = [];
  private responseIndex = 0;

  constructor(responses?: LLMResponse[]) {
    this.responses = responses ?? [{
      content: 'Mock response',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: 'stop',
      model: 'mock-model',
    }];
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.calls.push(request);
    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;
    return response;
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const response = await this.complete(request);
    yield {
      type: 'text',
      content: response.content,
    };
    yield {
      type: 'done',
      content: '',
      usage: response.usage,
      finishReason: response.finishReason,
    };
  }

  async countTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }

  listModels(): string[] {
    return ['mock-model'];
  }

  supportsTools(): boolean {
    return true;
  }

  supportsStreaming(): boolean {
    return true;
  }

  /**
   * Add a response to the queue
   */
  addResponse(response: Partial<LLMResponse>): void {
    this.responses.push({
      content: response.content ?? 'Mock response',
      toolCalls: response.toolCalls ?? [],
      usage: response.usage ?? { inputTokens: 10, outputTokens: 5 },
      finishReason: response.finishReason ?? 'stop',
      model: response.model ?? 'mock-model',
    });
  }

  /**
   * Set responses that include tool calls
   */
  setToolCallResponse(toolName: string, args: Record<string, unknown>): void {
    this.responses = [
      {
        content: '',
        toolCalls: [{
          id: 'tc_mock',
          name: toolName,
          arguments: args,
        }],
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'tool_use',
        model: 'mock-model',
      },
      {
        content: 'Task completed with tool use.',
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 10 },
        finishReason: 'stop',
        model: 'mock-model',
      },
    ];
    this.responseIndex = 0;
  }

  /**
   * Reset call history
   */
  reset(): void {
    this.calls = [];
    this.responseIndex = 0;
  }
}
