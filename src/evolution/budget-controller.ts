/**
 * BudgetController — Per-Layer Budget Enforcement
 *
 * Enforces hard resource limits at every level of the CRSAE architecture.
 * Tracks API calls, tokens, compute time, recursion depth, and cost.
 * Raises BudgetExceededError when any limit is hit.
 *
 * From: Microsoft STOP — budget-constrained self-improvement
 * From: RSA — compute allocation across N/K/T parameters
 *
 * Zero external dependencies.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { BudgetConfig, BudgetState, BudgetRemaining, BudgetTier } from './types.js';

const TIER_MULTIPLIERS: Record<BudgetTier, number> = {
  minimal: 0.25,
  standard: 1.0,
  enhanced: 2.0,
  critical: 4.0,
};

const DEFAULT_CONFIG: Required<BudgetConfig> = {
  maxApiCalls: 50,
  maxTokens: 100000,
  maxTimeMs: 120000, // 2 minutes
  maxDepth: 10,
  maxCostUsd: 1.0,
  autoScale: false,
  tier: 'standard',
};

export class BudgetExceededError extends Error {
  public readonly resource: string;
  public readonly used: number;
  public readonly limit: number;

  constructor(resource: string, used: number, limit: number) {
    super(`Budget exceeded: ${resource} used ${used}/${limit}`);
    this.name = 'BudgetExceededError';
    this.resource = resource;
    this.used = used;
    this.limit = limit;
  }
}

export class BudgetController extends EventEmitter {
  private config: Required<BudgetConfig>;
  private running = false;
  private budgets: Map<string, BudgetState & { startTime: number; config: Required<BudgetConfig> }> = new Map();
  private totalBudgetsCreated = 0;
  private totalBudgetsExhausted = 0;

  constructor(config?: Partial<BudgetConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.budgets.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Create a new budget for a task.
   * Applies tier multiplier to all limits.
   */
  createBudget(taskId: string, overrides?: Partial<BudgetConfig>): BudgetState {
    const taskConfig = { ...this.config, ...overrides };
    const multiplier = TIER_MULTIPLIERS[taskConfig.tier];

    const effectiveConfig: Required<BudgetConfig> = {
      ...taskConfig,
      maxApiCalls: Math.ceil(taskConfig.maxApiCalls * multiplier),
      maxTokens: Math.ceil(taskConfig.maxTokens * multiplier),
      maxTimeMs: Math.ceil(taskConfig.maxTimeMs * multiplier),
      maxCostUsd: taskConfig.maxCostUsd * multiplier,
    };

    const state: BudgetState & { startTime: number; config: Required<BudgetConfig> } = {
      apiCallsUsed: 0,
      tokensUsed: 0,
      elapsedMs: 0,
      currentDepth: 0,
      costUsd: 0,
      remaining: this.computeRemaining(effectiveConfig, 0, 0, 0, 0, 0),
      exhausted: false,
      startTime: Date.now(),
      config: effectiveConfig,
    };

    this.budgets.set(taskId, state);
    this.totalBudgetsCreated++;

    return state;
  }

  /**
   * Record API call usage.
   */
  recordApiCall(taskId: string, tokens: number = 0, costUsd: number = 0): void {
    const budget = this.budgets.get(taskId);
    if (!budget) return;

    budget.apiCallsUsed++;
    budget.tokensUsed += tokens;
    budget.costUsd += costUsd;
    budget.elapsedMs = Date.now() - budget.startTime;
    budget.remaining = this.computeRemaining(
      budget.config,
      budget.apiCallsUsed,
      budget.tokensUsed,
      budget.elapsedMs,
      budget.currentDepth,
      budget.costUsd
    );

    this.checkAndEmitWarnings(taskId, budget);
  }

  /**
   * Record entering a new recursion depth.
   */
  recordDepthIncrease(taskId: string): void {
    const budget = this.budgets.get(taskId);
    if (!budget) return;

    budget.currentDepth++;
    budget.remaining = this.computeRemaining(
      budget.config,
      budget.apiCallsUsed,
      budget.tokensUsed,
      Date.now() - budget.startTime,
      budget.currentDepth,
      budget.costUsd
    );
  }

  /**
   * Record exiting a recursion depth.
   */
  recordDepthDecrease(taskId: string): void {
    const budget = this.budgets.get(taskId);
    if (!budget) return;

    budget.currentDepth = Math.max(0, budget.currentDepth - 1);
  }

  /**
   * Check if a specific resource can still be consumed.
   * Throws BudgetExceededError if limit would be exceeded.
   */
  checkBudget(taskId: string): void {
    const budget = this.budgets.get(taskId);
    if (!budget) return;

    budget.elapsedMs = Date.now() - budget.startTime;

    if (budget.apiCallsUsed >= budget.config.maxApiCalls) {
      budget.exhausted = true;
      throw new BudgetExceededError('apiCalls', budget.apiCallsUsed, budget.config.maxApiCalls);
    }

    if (budget.tokensUsed >= budget.config.maxTokens) {
      budget.exhausted = true;
      throw new BudgetExceededError('tokens', budget.tokensUsed, budget.config.maxTokens);
    }

    if (budget.elapsedMs >= budget.config.maxTimeMs) {
      budget.exhausted = true;
      throw new BudgetExceededError('time', budget.elapsedMs, budget.config.maxTimeMs);
    }

    if (budget.currentDepth >= budget.config.maxDepth) {
      budget.exhausted = true;
      throw new BudgetExceededError('depth', budget.currentDepth, budget.config.maxDepth);
    }

    if (budget.costUsd >= budget.config.maxCostUsd) {
      budget.exhausted = true;
      throw new BudgetExceededError('cost', budget.costUsd, budget.config.maxCostUsd);
    }
  }

  /**
   * Check if budget is available without throwing.
   */
  hasBudget(taskId: string): boolean {
    try {
      this.checkBudget(taskId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current budget state.
   */
  getBudget(taskId: string): BudgetState | undefined {
    const budget = this.budgets.get(taskId);
    if (!budget) return undefined;

    budget.elapsedMs = Date.now() - budget.startTime;
    budget.remaining = this.computeRemaining(
      budget.config,
      budget.apiCallsUsed,
      budget.tokensUsed,
      budget.elapsedMs,
      budget.currentDepth,
      budget.costUsd
    );

    return {
      apiCallsUsed: budget.apiCallsUsed,
      tokensUsed: budget.tokensUsed,
      elapsedMs: budget.elapsedMs,
      currentDepth: budget.currentDepth,
      costUsd: budget.costUsd,
      remaining: budget.remaining,
      exhausted: budget.exhausted,
    };
  }

  /**
   * Get budget utilization as a percentage (0-1).
   */
  getUtilization(taskId: string): number {
    const budget = this.budgets.get(taskId);
    if (!budget) return 0;

    const apiUtil = budget.apiCallsUsed / budget.config.maxApiCalls;
    const tokenUtil = budget.tokensUsed / budget.config.maxTokens;
    const timeUtil = (Date.now() - budget.startTime) / budget.config.maxTimeMs;
    const costUtil = budget.costUsd / budget.config.maxCostUsd;

    // Return the maximum utilization across all resources
    return Math.max(apiUtil, tokenUtil, timeUtil, costUtil);
  }

  /**
   * Scale budget up for a task (if autoScale is enabled).
   */
  scaleBudget(taskId: string, factor: number): void {
    const budget = this.budgets.get(taskId);
    if (!budget || !budget.config.autoScale) return;

    budget.config.maxApiCalls = Math.ceil(budget.config.maxApiCalls * factor);
    budget.config.maxTokens = Math.ceil(budget.config.maxTokens * factor);
    budget.config.maxTimeMs = Math.ceil(budget.config.maxTimeMs * factor);
    budget.config.maxCostUsd *= factor;
    budget.exhausted = false;

    budget.remaining = this.computeRemaining(
      budget.config,
      budget.apiCallsUsed,
      budget.tokensUsed,
      Date.now() - budget.startTime,
      budget.currentDepth,
      budget.costUsd
    );
  }

  /**
   * Release a budget (task complete).
   */
  releaseBudget(taskId: string): BudgetState | undefined {
    const budget = this.budgets.get(taskId);
    if (!budget) return undefined;

    const finalState = this.getBudget(taskId)!;
    this.budgets.delete(taskId);

    if (finalState.exhausted) {
      this.totalBudgetsExhausted++;
    }

    return finalState;
  }

  /**
   * Compute remaining budget.
   */
  private computeRemaining(
    config: Required<BudgetConfig>,
    apiCallsUsed: number,
    tokensUsed: number,
    elapsedMs: number,
    currentDepth: number,
    costUsd: number
  ): BudgetRemaining {
    return {
      apiCalls: Math.max(0, config.maxApiCalls - apiCallsUsed),
      tokens: Math.max(0, config.maxTokens - tokensUsed),
      timeMs: Math.max(0, config.maxTimeMs - elapsedMs),
      depth: Math.max(0, config.maxDepth - currentDepth),
      costUsd: Math.max(0, config.maxCostUsd - costUsd),
    };
  }

  /**
   * Check budget levels and emit warnings/exhaustion events.
   */
  private checkAndEmitWarnings(
    taskId: string,
    budget: BudgetState & { config: Required<BudgetConfig> }
  ): void {
    const utilization = this.getUtilization(taskId);

    if (utilization >= 1) {
      budget.exhausted = true;
      this.totalBudgetsExhausted++;
      this.emit('evolution:budget:exhausted', { taskId, utilization });
    } else if (utilization >= 0.8) {
      this.emit('evolution:budget:warning', { taskId, utilization, level: 'high' });
    } else if (utilization >= 0.5) {
      this.emit('evolution:budget:warning', { taskId, utilization, level: 'medium' });
    }
  }

  getStats() {
    return {
      running: this.running,
      activeBudgets: this.budgets.size,
      totalBudgetsCreated: this.totalBudgetsCreated,
      totalBudgetsExhausted: this.totalBudgetsExhausted,
      exhaustionRate: this.totalBudgetsCreated > 0
        ? this.totalBudgetsExhausted / this.totalBudgetsCreated
        : 0,
      config: { ...this.config },
    };
  }
}
