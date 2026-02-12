/**
 * Failover Provider — cascading provider fallback with health tracking.
 * Tries providers in priority order; on failure, moves to the next.
 */

import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk } from './types.js';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

interface ProviderHealth {
  successes: number;
  failures: number;
  lastFailure?: number;
  lastSuccess?: number;
  consecutiveFailures: number;
}

export interface FailoverOptions {
  /** Maximum providers to try before giving up (default: all) */
  maxAttempts?: number;
}

/**
 * FailoverProvider wraps multiple LLMProviders with cascading fallback.
 * On failure, automatically tries the next provider in the chain.
 */
export class FailoverProvider implements LLMProvider {
  readonly name = 'failover';
  readonly models: string[];
  readonly defaultModel: string;

  private healthScores = new Map<string, ProviderHealth>();
  private readonly maxAttempts: number;

  constructor(
    private readonly providers: LLMProvider[],
    options: FailoverOptions = {},
  ) {
    if (providers.length === 0) {
      throw new Error('FailoverProvider requires at least one provider');
    }

    this.maxAttempts = options.maxAttempts ?? providers.length;

    // Aggregate models from all providers
    const allModels = new Set<string>();
    for (const p of providers) {
      for (const m of p.models) allModels.add(m);
    }
    this.models = [...allModels];
    this.defaultModel = providers[0].defaultModel;

    // Initialize health tracking
    for (const p of providers) {
      this.healthScores.set(p.name, {
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
      });
    }
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const errors: Array<{ provider: string; error: Error }> = [];
    const attemptsToTry = Math.min(this.maxAttempts, this.providers.length);

    for (let i = 0; i < attemptsToTry; i++) {
      const provider = this.providers[i];
      try {
        const response = await provider.complete(request);
        this.recordSuccess(provider.name);
        return response;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.recordFailure(provider.name);
        errors.push({ provider: provider.name, error });

        logger.warn(
          { provider: provider.name, error: error.message, attempt: i + 1, total: attemptsToTry },
          'Provider failed, trying next in failover chain',
        );
      }
    }

    // All providers failed
    const errorSummary = errors.map(e => `${e.provider}: ${e.error.message}`).join('; ');
    throw new Error(`All ${errors.length} providers failed: ${errorSummary}`);
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const errors: Array<{ provider: string; error: Error }> = [];
    const attemptsToTry = Math.min(this.maxAttempts, this.providers.length);

    for (let i = 0; i < attemptsToTry; i++) {
      const provider = this.providers[i];
      try {
        yield* provider.stream(request);
        this.recordSuccess(provider.name);
        return; // Successfully streamed
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.recordFailure(provider.name);
        errors.push({ provider: provider.name, error });

        logger.warn(
          { provider: provider.name, error: error.message, attempt: i + 1 },
          'Provider stream failed, trying next',
        );
      }
    }

    const errorSummary = errors.map(e => `${e.provider}: ${e.error.message}`).join('; ');
    throw new Error(`All ${errors.length} providers failed streaming: ${errorSummary}`);
  }

  async isAvailable(): Promise<boolean> {
    for (const provider of this.providers) {
      if (await provider.isAvailable()) return true;
    }
    return false;
  }

  countTokens(text: string): number {
    return this.providers[0].countTokens(text);
  }

  /**
   * Get health report for all providers in the failover chain.
   */
  getHealthReport(): Record<string, {
    successRate: number;
    available: boolean;
    consecutiveFailures: number;
    totalCalls: number;
  }> {
    const report: Record<string, any> = {};

    for (const provider of this.providers) {
      const health = this.healthScores.get(provider.name)!;
      const total = health.successes + health.failures;

      report[provider.name] = {
        successRate: total > 0 ? health.successes / total : 1,
        available: health.consecutiveFailures < 3,
        consecutiveFailures: health.consecutiveFailures,
        totalCalls: total,
      };
    }

    return report;
  }

  /**
   * Get the list of providers in the failover chain.
   */
  getProviders(): string[] {
    return this.providers.map(p => p.name);
  }

  private recordSuccess(providerName: string): void {
    const health = this.healthScores.get(providerName);
    if (health) {
      health.successes++;
      health.consecutiveFailures = 0;
      health.lastSuccess = Date.now();
    }
  }

  private recordFailure(providerName: string): void {
    const health = this.healthScores.get(providerName);
    if (health) {
      health.failures++;
      health.consecutiveFailures++;
      health.lastFailure = Date.now();
    }
  }
}
