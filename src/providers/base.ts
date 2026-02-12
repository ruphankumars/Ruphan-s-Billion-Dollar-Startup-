import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk, ProviderConfig } from './types.js';
import { getLogger } from '../core/logger.js';
import { retry } from '../utils/retry.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { TokenBucketRateLimiter } from './rate-limiter.js';

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly models: string[];
  abstract readonly defaultModel: string;

  protected logger = getLogger();
  protected config: ProviderConfig;
  protected circuitBreaker?: CircuitBreaker;
  protected rateLimiter?: TokenBucketRateLimiter;

  constructor(config: ProviderConfig = {}) {
    this.config = {
      maxRetries: 3,
      timeout: 120000,
      ...config,
    };

    // Initialize circuit breaker if configured
    if (config.circuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(
        config.defaultModel || 'provider',
        config.circuitBreaker,
      );
    }

    // Initialize rate limiter if configured
    if (config.rateLimit) {
      this.rateLimiter = new TokenBucketRateLimiter(config.rateLimit);
    }
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || this.defaultModel;
    this.logger.debug({ provider: this.name, model }, 'LLM request');

    const executeWithRetry = () =>
      retry(
        async () => {
          // Rate limiting: acquire a token before each attempt
          if (this.rateLimiter) {
            await this.rateLimiter.acquire();
          }
          return this._complete({ ...request, model });
        },
        {
          maxRetries: this.config.maxRetries || 3,
          baseDelay: 1000,
          retryableErrors: ['rate_limit', 'overloaded', 'timeout', '529', '503', '429'],
          onRetry: (attempt, error) => {
            this.logger.warn({ provider: this.name, attempt, error: error.message }, 'Retrying LLM call');
          },
        },
      );

    // Circuit breaker wraps the entire retry logic
    if (this.circuitBreaker) {
      return this.circuitBreaker.execute(executeWithRetry);
    }

    return executeWithRetry();
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const model = request.model || this.defaultModel;

    // Rate limiting for stream requests
    if (this.rateLimiter) {
      await this.rateLimiter.acquire();
    }

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
