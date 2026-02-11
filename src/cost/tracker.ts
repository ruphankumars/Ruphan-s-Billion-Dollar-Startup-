import { nanoid } from 'nanoid';
import type { CostEntry, CostSummary } from './types.js';
import { calculateModelCost } from './pricing.js';
import { getLogger } from '../core/logger.js';

/**
 * Tracks token usage and costs across an execution
 */
export class CostTracker {
  private entries: CostEntry[] = [];
  private executionId: string;
  private logger = getLogger();

  constructor(executionId: string) {
    this.executionId = executionId;
  }

  /**
   * Record a model usage entry
   */
  record(params: {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    taskId?: string;
    agentRole?: string;
  }): CostEntry {
    const cost = calculateModelCost(params.model, params.inputTokens, params.outputTokens);

    const entry: CostEntry = {
      id: nanoid(8),
      timestamp: Date.now(),
      model: params.model,
      provider: params.provider,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cost,
      executionId: this.executionId,
      taskId: params.taskId,
      agentRole: params.agentRole,
    };

    this.entries.push(entry);
    this.logger.debug({ entry }, 'Cost recorded');
    return entry;
  }

  /**
   * Get total cost so far
   */
  get totalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.cost, 0);
  }

  /**
   * Get total input tokens
   */
  get totalInputTokens(): number {
    return this.entries.reduce((sum, e) => sum + e.inputTokens, 0);
  }

  /**
   * Get total output tokens
   */
  get totalOutputTokens(): number {
    return this.entries.reduce((sum, e) => sum + e.outputTokens, 0);
  }

  /**
   * Get a comprehensive cost summary
   */
  getSummary(budget: number): CostSummary {
    const modelMap = new Map<string, {
      model: string;
      provider: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      cost: number;
    }>();

    for (const entry of this.entries) {
      const key = `${entry.provider}:${entry.model}`;
      const existing = modelMap.get(key);
      if (existing) {
        existing.calls++;
        existing.inputTokens += entry.inputTokens;
        existing.outputTokens += entry.outputTokens;
        existing.cost += entry.cost;
      } else {
        modelMap.set(key, {
          model: entry.model,
          provider: entry.provider,
          calls: 1,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cost: entry.cost,
        });
      }
    }

    const total = this.totalCost;

    return {
      totalCost: total,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      modelBreakdown: Array.from(modelMap.values()),
      budgetUsed: total,
      budgetRemaining: budget - total,
    };
  }

  /**
   * Get all entries
   */
  getEntries(): CostEntry[] {
    return [...this.entries];
  }

  /**
   * Reset the tracker
   */
  reset(): void {
    this.entries = [];
  }
}
