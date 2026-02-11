import { BudgetExceededError } from '../core/errors.js';
import type { BudgetConfig } from './types.js';
import { getLogger } from '../core/logger.js';

/**
 * Manages budget enforcement for CortexOS executions
 */
export class BudgetManager {
  private logger = getLogger();
  private spent: number = 0;

  constructor(private config: BudgetConfig) {}

  /**
   * Check if spending an estimated amount would exceed the budget
   */
  checkEstimate(estimatedCost: number): void {
    if (this.spent + estimatedCost > this.config.perRun) {
      throw new BudgetExceededError(
        this.spent + estimatedCost,
        this.config.perRun,
      );
    }
  }

  /**
   * Record actual spending
   */
  spend(amount: number): void {
    this.spent += amount;
    this.logger.debug({ spent: this.spent, budget: this.config.perRun }, 'Budget update');

    if (this.spent > this.config.perRun) {
      throw new BudgetExceededError(this.spent, this.config.perRun);
    }
  }

  /**
   * Check if budget allows more spending
   */
  canSpend(amount: number): boolean {
    return this.spent + amount <= this.config.perRun;
  }

  /**
   * Get remaining budget
   */
  get remaining(): number {
    return Math.max(0, this.config.perRun - this.spent);
  }

  /**
   * Get percentage of budget used
   */
  get usedPercent(): number {
    if (this.config.perRun === 0) return 100;
    return Math.min(100, (this.spent / this.config.perRun) * 100);
  }

  /**
   * Get total spent
   */
  get totalSpent(): number {
    return this.spent;
  }

  /**
   * Check if budget is exceeded
   */
  get isExceeded(): boolean {
    return this.spent >= this.config.perRun;
  }

  /**
   * Reset the budget (for new execution)
   */
  reset(): void {
    this.spent = 0;
  }
}
