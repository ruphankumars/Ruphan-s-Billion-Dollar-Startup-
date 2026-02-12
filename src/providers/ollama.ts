/**
 * Ollama Provider — Local LLM integration via Ollama REST API.
 *
 * Uses raw fetch() against Ollama's HTTP API (default: http://localhost:11434).
 * No external SDK dependency required — uses Node.js built-in fetch().
 *
 * Supports:
 * - Chat completions via POST /api/chat
 * - Tool/function calling
 * - Streaming responses
 * - Health check via GET /api/tags
 */

import { BaseLLMProvider } from './base.js';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderConfig, ToolCall } from './types.js';

export class OllamaProvider extends BaseLLMProvider {
  readonly name = 'ollama';
  readonly models = ['llama3.2', 'qwen2.5-coder'];
  readonly defaultModel = 'llama3.2';

  private baseUrl: string;

  constructor(config: ProviderConfig = {}) {
    super(config);
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  private convertMessages(messages: LLMRequest['messages']): Array<Record<string, unknown>> {
    return messages.map(m => {
      const msg: Record<string, unknown> = {
        role: m.role === 'tool' ? 'tool' : m.role,
        content: m.content,
      };

      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      return msg;
    });
  }

  private convertTools(tools?: LLMRequest['tools']): Array<Record<string, unknown>> | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  protected async _complete(request: LLMRequest): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: request.model || this.defaultModel,
      messages: this.convertMessages(request.messages),
      stream: false,
      options: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
      },
    };

    const tools = this.convertTools(request.tools);
    if (tools) {
      body.tools = tools;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as Record<string, any>;
    const message = data.message || {};
    const content = message.content || '';

    const toolCalls: ToolCall[] = (message.tool_calls || []).map((tc: any, idx: number) => ({
      id: tc.id || `call_ollama_${idx}`,
      name: tc.function?.name || '',
      arguments: typeof tc.function?.arguments === 'string'
        ? tc.function.arguments
        : JSON.stringify(tc.function?.arguments || {}),
    }));

    // Ollama reports eval_count for output tokens and prompt_eval_count for input
    const inputTokens = data.prompt_eval_count || 0;
    const outputTokens = data.eval_count || 0;

    return {
      content,
      toolCalls,
      model: data.model || request.model || this.defaultModel,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      finishReason: toolCalls.length > 0 ? 'tool_calls' : (data.done_reason === 'length' ? 'length' : 'stop'),
      raw: data,
    };
  }

  protected async *_stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const body: Record<string, unknown> = {
      model: request.model || this.defaultModel,
      messages: this.convertMessages(request.messages),
      stream: true,
      options: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
      },
    };

    const tools = this.convertTools(request.tools);
    if (tools) {
      body.tools = tools;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Ollama streaming response has no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line) as Record<string, any>;
            const message = data.message || {};

            if (message.content) {
              yield { type: 'text', content: message.content };
            }

            if (message.tool_calls) {
              for (const tc of message.tool_calls) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: tc.id || `call_ollama_stream_${Date.now()}`,
                    name: tc.function?.name || '',
                    arguments: typeof tc.function?.arguments === 'string'
                      ? tc.function.arguments
                      : JSON.stringify(tc.function?.arguments || {}),
                  },
                };
              }
            }

            if (data.prompt_eval_count) totalInputTokens = data.prompt_eval_count;
            if (data.eval_count) totalOutputTokens = data.eval_count;

            if (data.done) {
              yield {
                type: 'done',
                usage: {
                  inputTokens: totalInputTokens,
                  outputTokens: totalOutputTokens,
                  totalTokens: totalInputTokens + totalOutputTokens,
                },
              };
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
