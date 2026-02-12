/**
 * Token Bucket Rate Limiter — controls the rate of API calls per provider.
 * Uses the token bucket algorithm: tokens refill at a steady rate,
 * each request consumes tokens. If empty, callers wait.
 */

import { sleep } from '../utils/retry.js';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

export interface RateLimiterOptions {
  /** Maximum tokens in the bucket (burst capacity). Default: 60 */
  maxTokens?: number;
  /** Tokens added per refill interval. Default: 10 */
  refillRate?: number;
  /** Refill interval in milliseconds. Default: 1000 */
  refillIntervalMs?: number;
}

/**
 * Token bucket rate limiter.
 * Allows bursts up to maxTokens, then throttles to refillRate/interval.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly refillIntervalMs: number;
  private lastRefillTime: number;

  constructor(options: RateLimiterOptions = {}) {
    this.maxTokens = options.maxTokens ?? 60;
    this.refillRate = options.refillRate ?? 10;
    this.refillIntervalMs = options.refillIntervalMs ?? 1000;
    this.tokens = this.maxTokens;
    this.lastRefillTime = Date.now();
  }

  /**
   * Acquire tokens from the bucket. Waits if insufficient tokens are available.
   * @param count Number of tokens to acquire (default: 1)
   */
  async acquire(count: number = 1): Promise<void> {
    if (count > this.maxTokens) {
      throw new Error(
        `Cannot acquire ${count} tokens; bucket capacity is ${this.maxTokens}`,
      );
    }

    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return;
    }

    // Calculate wait time until enough tokens are available
    const deficit = count - this.tokens;
    const intervalsNeeded = Math.ceil(deficit / this.refillRate);
    const waitMs = intervalsNeeded * this.refillIntervalMs;

    logger.debug(
      { deficit, waitMs, available: this.tokens, requested: count },
      'Rate limiter throttling — waiting for tokens',
    );

    await sleep(waitMs);

    // Refill after waiting and consume
    this.refill();
    this.tokens = Math.max(0, this.tokens - count);
  }

  /**
   * Try to acquire tokens without waiting.
   * @returns true if tokens were acquired, false if insufficient
   */
  tryAcquire(count: number = 1): boolean {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }

    return false;
  }

  /**
   * Get the current number of available tokens (after refill).
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Reset the bucket to full capacity.
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefillTime = Date.now();
  }

  /**
   * Refill tokens based on elapsed time since last refill.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;

    if (elapsed < this.refillIntervalMs) return;

    const intervals = Math.floor(elapsed / this.refillIntervalMs);
    const tokensToAdd = intervals * this.refillRate;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefillTime += intervals * this.refillIntervalMs;
    }
  }
}
