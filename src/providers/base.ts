import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk, ProviderConfig } from './types.js';
import { getLogger } from '../core/logger.js';
import { retry } from '../utils/retry.js';

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly models: string[];
  abstract readonly defaultModel: string;

  protected logger = getLogger();
  protected config: ProviderConfig;

  constructor(config: ProviderConfig = {}) {
    this.config = {
      maxRetries: 3,
      timeout: 120000,
      ...config,
    };
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.defaultModel;
    this.logger.debug({ provider: this.name, model }, 'LLM request');

    return retry(
      () => this._complete({ ...request, model }),
      {
        maxRetries: this.config.maxRetries || 3,
        baseDelay: 1000,
        retryableErrors: ['rate_limit', 'overloaded', 'timeout', '529', '503', '429'],
        onRetry: (attempt, error) => {
          this.logger.warn({ provider: this.name, attempt, error: error.message }, 'Retrying LLM call');
        },
      },
    );
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const model = request.model || this.defaultModel;
    yield* this._stream({ ...request, model });
  }

  abstract isAvailable(): Promise<boolean>;

  countTokens(text: string): number {
    // Rough heuristic: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  protected abstract _complete(request: LLMRequest): Promise<LLMResponse>;
  protected abstract _stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}
