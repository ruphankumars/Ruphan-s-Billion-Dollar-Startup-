import Anthropic from '@anthropic-ai/sdk';
import { BaseLLMProvider } from './base.js';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderConfig, ToolCall } from './types.js';

export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic';
  readonly models = ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'];
  readonly defaultModel = 'claude-sonnet-4-20250514';

  private client: Anthropic;

  constructor(config: ProviderConfig = {}) {
    super(config);
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async isAvailable(): Promise<boolean> {
    return !!(this.config.apiKey || process.env.ANTHROPIC_API_KEY);
  }

  protected async _complete(request: LLMRequest): Promise<LLMResponse> {
    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    const anthropicMessages = nonSystemMessages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            tool_use_id: m.toolCallId || '',
            content: m.content,
          }],
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock> = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content, citations: [] } as Anthropic.TextBlock);
        }
        for (const tc of m.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments),
          } as Anthropic.ToolUseBlock);
        }
        return { role: 'assistant' as const, content };
      }
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content,
      };
    });

    const tools = request.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }));

    const params: Anthropic.MessageCreateParams = {
      model: request.model || this.defaultModel,
      max_tokens: request.maxTokens || 4096,
      messages: anthropicMessages as Anthropic.MessageParam[],
      ...(systemMessage ? { system: systemMessage.content } : {}),
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    };

    const response = await this.client.messages.create(params);

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      content,
      toolCalls,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      raw: response,
    };
  }

  protected async *_stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    // For MVP, use non-streaming and yield a single chunk
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
