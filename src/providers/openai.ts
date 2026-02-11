import OpenAI from 'openai';
import { BaseLLMProvider } from './base.js';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderConfig, ToolCall } from './types.js';

export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'openai';
  readonly models = ['gpt-4o', 'gpt-4o-mini'];
  readonly defaultModel = 'gpt-4o';

  private client: OpenAI | null = null;

  constructor(config: ProviderConfig = {}) {
    super(config);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey || process.env.OPENAI_API_KEY,
      });
    }
    return this.client;
  }

  async isAvailable(): Promise<boolean> {
    return !!(this.config.apiKey || process.env.OPENAI_API_KEY);
  }

  protected async _complete(request: LLMRequest): Promise<LLMResponse> {
    const messages = request.messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          tool_call_id: m.toolCallId || '',
          content: m.content,
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        };
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      };
    });

    const tools = request.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.getClient().chat.completions.create({
      model: request.model || this.defaultModel,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      max_tokens: request.maxTokens || 4096,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    });

    const choice = response.choices[0];
    const content = choice.message.content || '';
    const toolCalls: ToolCall[] = (choice.message.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content,
      toolCalls,
      model: response.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
      raw: response,
    };
  }

  protected async *_stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const response = await this._complete(request);
    if (response.content) {
      yield { type: 'text', content: response.content };
    }
    for (const tc of response.toolCalls) {
      yield { type: 'tool_call', toolCall: tc };
    }
    yield { type: 'done', usage: response.usage };
  }
}
