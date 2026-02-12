export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  stream?: boolean;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  cacheStats?: {
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  raw?: unknown;
}

export interface LLMStreamChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  toolCall?: ToolCall;
  usage?: LLMResponse['usage'];
}

export interface LLMProvider {
  readonly name: string;
  readonly models: string[];
  readonly defaultModel: string;

  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
  isAvailable(): Promise<boolean>;
  countTokens(text: string): number;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  maxRetries?: number;
  timeout?: number;
  circuitBreaker?: {
    failureThreshold?: number;
    resetTimeoutMs?: number;
  };
  rateLimit?: {
    maxTokens?: number;
    refillRate?: number;
    refillIntervalMs?: number;
  };
}
