import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitState, CircuitOpenError } from '../../../src/providers/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxAttempts: 1,
    });
  });

  it('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should pass through successful calls in CLOSED state', async () => {
    const result = await breaker.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should stay CLOSED when failures are below threshold', async () => {
    const failing = async () => { throw new Error('fail'); };

    await expect(breaker.execute(failing)).rejects.toThrow('fail');
    await expect(breaker.execute(failing)).rejects.toThrow('fail');

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.getStats().failureCount).toBe(2);
  });

  it('should transition to OPEN after reaching failure threshold', async () => {
    const failing = async () => { throw new Error('fail'); };

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it('should throw CircuitOpenError when OPEN', async () => {
    const failing = async () => { throw new Error('fail'); };

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }

    // Now it should throw CircuitOpenError
    await expect(breaker.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError);
  });

  it('should include remaining time in CircuitOpenError', async () => {
    const failing = async () => { throw new Error('fail'); };

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }

    try {
      await breaker.execute(async () => 'ok');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect((err as CircuitOpenError).remainingMs).toBeGreaterThan(0);
      expect((err as CircuitOpenError).breakerName).toBe('test');
    }
  });

  it('should transition from OPEN to HALF_OPEN after timeout', async () => {
    const failing = async () => { throw new Error('fail'); };

    // Trip breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Fast-forward time
    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);

    const result = await breaker.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    vi.useRealTimers();
  });

  it('should re-open if HALF_OPEN attempt fails', async () => {
    const failing = async () => { throw new Error('fail'); };

    // Trip breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }

    // Fast-forward time
    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);

    // Fail in HALF_OPEN
    await expect(breaker.execute(failing)).rejects.toThrow('fail');
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    vi.useRealTimers();
  });

  it('should reset failure count on success in CLOSED state', async () => {
    const failing = async () => { throw new Error('fail'); };

    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(failing)).rejects.toThrow();
    expect(breaker.getStats().failureCount).toBe(2);

    // Success resets counter
    await breaker.execute(async () => 'ok');
    expect(breaker.getStats().failureCount).toBe(0);
  });

  it('should provide stats', async () => {
    await breaker.execute(async () => 'ok');
    const stats = breaker.getStats();

    expect(stats.state).toBe(CircuitState.CLOSED);
    expect(stats.successCount).toBe(1);
    expect(stats.failureCount).toBe(0);
  });

  it('should support manual reset', async () => {
    const failing = async () => { throw new Error('fail'); };

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow();
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    breaker.reset();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.getStats().failureCount).toBe(0);
  });

  it('should use default options when none provided', () => {
    const defaultBreaker = new CircuitBreaker('defaults');
    expect(defaultBreaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should propagate the original error through the circuit breaker', async () => {
    const error = new TypeError('type mismatch');
    await expect(breaker.execute(async () => { throw error; })).rejects.toThrow(TypeError);
    await expect(breaker.execute(async () => { throw error; })).rejects.toThrow('type mismatch');
  });

  it('should limit HALF_OPEN attempts', async () => {
    const failing = async () => { throw new Error('fail'); };

    // Trip breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }

    vi.useFakeTimers();
    vi.advanceTimersByTime(1001);

    // First HALF_OPEN attempt succeeds
    await breaker.execute(async () => 'ok');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    vi.useRealTimers();
  });
});
