import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenBucketRateLimiter } from '../../../src/providers/rate-limiter.js';

describe('TokenBucketRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start with full bucket', () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 10 });
    expect(limiter.getAvailableTokens()).toBe(10);
  });

  it('should acquire tokens without waiting when available', async () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 10 });
    await limiter.acquire(5);
    expect(limiter.getAvailableTokens()).toBe(5);
  });

  it('should acquire single token by default', async () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 10 });
    await limiter.acquire();
    expect(limiter.getAvailableTokens()).toBe(9);
  });

  it('should throw when requesting more than max capacity', async () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 5 });
    await expect(limiter.acquire(10)).rejects.toThrow('Cannot acquire 10 tokens');
  });

  it('should try-acquire without blocking', () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 3 });

    expect(limiter.tryAcquire(2)).toBe(true);
    expect(limiter.getAvailableTokens()).toBe(1);

    expect(limiter.tryAcquire(2)).toBe(false);
    expect(limiter.getAvailableTokens()).toBe(1);
  });

  it('should refill tokens over time', () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 5,
      refillIntervalMs: 1000,
    });

    // Drain all
    expect(limiter.tryAcquire(10)).toBe(true);
    expect(limiter.getAvailableTokens()).toBe(0);

    // Advance time by 1 second
    vi.advanceTimersByTime(1000);
    expect(limiter.getAvailableTokens()).toBe(5);

    // Advance another second
    vi.advanceTimersByTime(1000);
    expect(limiter.getAvailableTokens()).toBe(10); // capped at max
  });

  it('should not exceed max tokens during refill', () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 20,
      refillIntervalMs: 1000,
    });

    vi.advanceTimersByTime(5000);
    expect(limiter.getAvailableTokens()).toBe(10); // capped at maxTokens
  });

  it('should reset to full capacity', () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 10 });

    limiter.tryAcquire(8);
    expect(limiter.getAvailableTokens()).toBe(2);

    limiter.reset();
    expect(limiter.getAvailableTokens()).toBe(10);
  });

  it('should use default options', () => {
    const limiter = new TokenBucketRateLimiter();
    expect(limiter.getAvailableTokens()).toBe(60); // default maxTokens
  });

  it('should handle multiple small acquisitions', async () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 5 });

    await limiter.acquire(1);
    await limiter.acquire(1);
    await limiter.acquire(1);
    expect(limiter.getAvailableTokens()).toBe(2);
  });

  it('should not refill before interval elapses', () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 5,
      refillIntervalMs: 1000,
    });

    limiter.tryAcquire(10);
    vi.advanceTimersByTime(500); // Half interval
    expect(limiter.getAvailableTokens()).toBe(0); // Not yet
  });

  it('should handle acquire with waiting', async () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 5,
      refillRate: 5,
      refillIntervalMs: 100,
    });

    // Drain all tokens
    await limiter.acquire(5);
    expect(limiter.getAvailableTokens()).toBe(0);

    // Acquiring more should wait
    const acquirePromise = limiter.acquire(3);

    // Advance time to allow refill
    vi.advanceTimersByTime(200);

    await acquirePromise;
    // After waiting and refill, tokens should be consumed
    expect(limiter.getAvailableTokens()).toBeGreaterThanOrEqual(0);
  });
});
