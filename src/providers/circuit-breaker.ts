/**
 * Circuit Breaker — prevents cascade failures by tracking provider health.
 * States: CLOSED (normal) → OPEN (blocking) → HALF_OPEN (testing recovery).
 */

import { getLogger } from '../core/logger.js';

const logger = getLogger();

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before transitioning from OPEN to HALF_OPEN (default: 60000) */
  resetTimeoutMs?: number;
  /** Max attempts allowed in HALF_OPEN before deciding (default: 1) */
  halfOpenMaxAttempts?: number;
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly breakerName: string,
    public readonly remainingMs: number,
  ) {
    super(`Circuit breaker "${breakerName}" is OPEN. Retry in ${Math.ceil(remainingMs / 1000)}s.`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Circuit Breaker implementation with three states:
 * - CLOSED: requests flow through normally
 * - OPEN: requests are blocked (fail-fast)
 * - HALF_OPEN: a limited number of requests are allowed to test recovery
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private halfOpenEnteredAt = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxAttempts: number;
  /** Maximum time to stay in HALF_OPEN before auto-resetting to CLOSED (ms) */
  private readonly halfOpenTimeoutMs: number;

  constructor(
    private readonly name: string,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60000;
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts ?? 1;
    this.halfOpenTimeoutMs = 60000; // Auto-reset HALF_OPEN after 60s
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitOpenError(this.name, this.resetTimeoutMs - elapsed);
      }
    }

    // In HALF_OPEN, limit attempts. If stuck in HALF_OPEN for too long
    // (e.g., all test attempts failed but no further calls came in to
    // transition state), auto-reset to CLOSED after halfOpenTimeoutMs.
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        // Check time-based auto-reset: if we've been in HALF_OPEN too long, reset
        const elapsed = Date.now() - this.halfOpenEnteredAt;
        if (elapsed >= this.halfOpenTimeoutMs) {
          this.transitionTo(CircuitState.CLOSED);
          this.failureCount = 0;
          this.halfOpenAttempts = 0;
        } else {
          // Already used our test attempts, treat as still open
          throw new CircuitOpenError(this.name, this.halfOpenTimeoutMs - elapsed);
        }
      }
    }

    try {
      const result = await fn();
      // Increment halfOpenAttempts AFTER successful execution (not before),
      // so a thrown exception does not consume an attempt slot.
      if (this.state === CircuitState.HALF_OPEN) {
        this.halfOpenAttempts++;
      }
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.state === CircuitState.HALF_OPEN) {
        this.halfOpenAttempts++;
      }
      this.onFailure();
      throw error;
    }
  }

  /**
   * Get the current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Force reset the circuit breaker to CLOSED state
   */
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    this.lastFailureTime = 0;
  }

  private onSuccess(): void {
    this.successCount++;

    if (this.state === CircuitState.HALF_OPEN) {
      // Recovery confirmed — close the circuit
      this.transitionTo(CircuitState.CLOSED);
      this.failureCount = 0;
      this.halfOpenAttempts = 0;
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Recovery failed — re-open the circuit
      this.transitionTo(CircuitState.OPEN);
      this.halfOpenAttempts = 0;
    } else if (this.state === CircuitState.CLOSED) {
      if (this.failureCount >= this.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      logger.info(
        { breaker: this.name, from: this.state, to: newState, failures: this.failureCount },
        'Circuit breaker state transition',
      );
      this.state = newState;
      if (newState === CircuitState.HALF_OPEN) {
        this.halfOpenEnteredAt = Date.now();
      }
    }
  }
}
