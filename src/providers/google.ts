/**
 * Google Provider — Gemini API integration.
 *
 * Uses the @google/generative-ai SDK. The Gemini API has a different shape
 * from OpenAI, so this requires a dedicated implementation:
 * - Roles: 'user' and 'model' (not 'assistant')
 * - System instructions passed separately
 * - Tool calls via functionDeclarations / functionCall parts
 */

import { GoogleGenerativeAI, SchemaType, type GenerativeModel, type Content, type Part, type Tool as GeminiTool } from '@google/generative-ai';
import { BaseLLMProvider } from './base.js';
import type { LLMRequest, LLMResponse, LLMStreamChunk, ProviderConfig, ToolCall, LLMMessage } from './types.js';

export class GoogleProvider extends BaseLLMProvider {
  readonly name = 'google';
  readonly models = ['gemini-2.0-flash', 'gemini-2.0-pro'];
  readonly defaultModel = 'gemini-2.0-flash';

  private genAI: GoogleGenerativeAI | null = null;

  constructor(config: ProviderConfig = {}) {
    super(config);
  }

  private getGenAI(): GoogleGenerativeAI {
    if (!this.genAI) {
      const apiKey = this.config.apiKey || process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error('Google API key not configured');
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
    return this.genAI;
  }

  private getModel(modelName: string, request: LLMRequest): GenerativeModel {
    const systemMessage = request.messages.find(m => m.role === 'system');

    const tools: GeminiTool[] | undefined = request.tools?.length
      ? [{
          functionDeclarations: request.tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: {
              type: SchemaType.OBJECT,
              properties: ((t.parameters as any)?.properties || {}) as Record<string, any>,
              ...(((t.parameters as any)?.required?.length)
                ? { required: (t.parameters as any).required as string[] }
                : {}),
            },
          })),
        }]
      : undefined;

    return this.getGenAI().getGenerativeModel({
      model: modelName,
      ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
      ...(tools ? { tools } : {}),
      generationConfig: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
      },
    });
  }

  private convertMessages(messages: LLMMessage[]): Content[] {
    const contents: Content[] = [];

    for (const msg of messages) {
      // Skip system messages — handled via systemInstruction
      if (msg.role === 'system') continue;

      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        const parts: Part[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: JSON.parse(tc.arguments || '{}'),
              },
            });
          }
        }
        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'function' as any,
          parts: [{
            functionResponse: {
              name: msg.toolCallId || 'unknown',
              response: { result: msg.content },
            },
          }],
        });
      }
    }

    return contents;
  }

  async isAvailable(): Promise<boolean> {
    return !!(this.config.apiKey || process.env.GOOGLE_API_KEY);
  }

  protected async _complete(request: LLMRequest): Promise<LLMResponse> {
    const modelName = request.model || this.defaultModel;
    const model = this.getModel(modelName, request);
    const contents = this.convertMessages(request.messages);

    const result = await model.generateContent({ contents });
    const response = result.response;
    const candidate = response.candidates?.[0];

    let content = '';
    const toolCalls: ToolCall[] = [];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if ('text' in part && part.text) {
          content += part.text;
        }
        if ('functionCall' in part && part.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${toolCalls.length}`,
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {}),
          });
        }
      }
    }

    const usage = response.usageMetadata;

    return {
      content,
      toolCalls,
      model: modelName,
      usage: {
        inputTokens: usage?.promptTokenCount || 0,
        outputTokens: usage?.candidatesTokenCount || 0,
        totalTokens: (usage?.promptTokenCount || 0) + (usage?.candidatesTokenCount || 0),
      },
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      raw: response,
    };
  }

  protected async *_stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const modelName = request.model || this.defaultModel;
    const model = this.getModel(modelName, request);
    const contents = this.convertMessages(request.messages);

    const result = await model.generateContentStream({ contents });
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for await (const chunk of result.stream) {
      const candidate = chunk.candidates?.[0];

      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if ('text' in part && part.text) {
            yield { type: 'text', content: part.text };
          }
          if ('functionCall' in part && part.functionCall) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: `call_${Date.now()}`,
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {}),
              },
            };
          }
        }
      }

      const usage = chunk.usageMetadata;
      if (usage) {
        totalInputTokens = usage.promptTokenCount || 0;
        totalOutputTokens = usage.candidatesTokenCount || 0;
      }
    }

    yield {
      type: 'done',
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
      },
    };
  }
}
