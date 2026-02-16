/**
 * FeedbackLoop — Self-Improvement Engine
 *
 * Records execution outcomes, maintains strategy weights via exponential
 * moving average, and recommends optimal strategies based on historical
 * performance. Zero npm dependencies.
 *
 * **Integration with CortexEngine:**
 * This module is designed to be wired into the CortexEngine's post-execution
 * pipeline. After each task execution, the engine should call `recordOutcome()`
 * with the execution metrics. Before strategy selection, the engine (or
 * ReasoningOrchestrator) should call `getRecommendedStrategy()` to influence
 * which reasoning strategy is chosen for the next task. Currently these
 * integration points are NOT yet wired — see CLAUDE.md "Gap 1" for details.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  FeedbackRecord,
  SelfImproveConfig,
  SelfImproveStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: SelfImproveConfig = {
  enabled: true,
  feedbackWindowSize: 50,
  regressionThreshold: 0.15,
  learningRate: 0.1,
  maxHistory: 1000,
};

// ═══════════════════════════════════════════════════════════════
// FEEDBACK LOOP
// ═══════════════════════════════════════════════════════════════

export class FeedbackLoop extends EventEmitter {
  private config: SelfImproveConfig;
  private history: FeedbackRecord[] = [];
  private strategyWeights: Map<string, number> = new Map();
  private strategyTaskTypes: Map<string, Map<string, number[]>> = new Map();
  private adjustmentCount = 0;
  private running = false;

  constructor(config?: Partial<SelfImproveConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('self-improve:feedback:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('self-improve:feedback:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Record an execution outcome and adjust strategy weights accordingly.
   */
  recordOutcome(feedback: Omit<FeedbackRecord, 'id' | 'timestamp'>): FeedbackRecord {
    const record: FeedbackRecord = {
      id: `fb_${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      ...feedback,
    };

    this.history.push(record);

    // Enforce max history
    if (this.history.length > this.config.maxHistory) {
      this.history.splice(0, this.history.length - this.config.maxHistory);
    }

    // Adjust weights based on outcome
    this.adjustWeights(record);

    // Track per-task-type performance
    this.trackTaskTypePerformance(record);

    this.emit('self-improve:feedback:recorded', {
      timestamp: Date.now(),
      record,
    });

    return record;
  }

  /**
   * Get current strategy weights. Higher weight (0-1) means better historical performance.
   */
  getStrategyWeights(): Map<string, number> {
    return new Map(this.strategyWeights);
  }

  /**
   * Adjust strategy weight using exponential moving average based on feedback.
   *
   * On success: weight moves toward 1.0
   * On failure: weight moves toward 0.0
   * On partial: weight moves toward 0.5
   */
  adjustWeights(feedback: FeedbackRecord): void {
    const strategy = feedback.strategyUsed;
    const currentWeight = this.strategyWeights.get(strategy) ?? 0.5;

    // Compute the target based on outcome and metrics
    let target: number;
    switch (feedback.outcome) {
      case 'success': {
        // Average of all metrics as the success signal
        const { quality, speed, cost, tokenEfficiency } = feedback.metrics;
        target = (quality + speed + cost + tokenEfficiency) / 4;
        // Ensure at least 0.6 for successes
        target = Math.max(target, 0.6);
        break;
      }
      case 'failure':
        target = 0.0;
        break;
      case 'partial': {
        const { quality, speed, cost, tokenEfficiency } = feedback.metrics;
        target = (quality + speed + cost + tokenEfficiency) / 4;
        // Cap partial at 0.5
        target = Math.min(target, 0.5);
        break;
      }
    }

    // Exponential moving average: new_weight = (1 - lr) * old_weight + lr * target
    const newWeight = (1 - this.config.learningRate) * currentWeight +
      this.config.learningRate * target;

    // Clamp to [0, 1]
    this.strategyWeights.set(strategy, Math.max(0, Math.min(1, newWeight)));
    this.adjustmentCount++;

    this.emit('self-improve:strategy:adjusted', {
      timestamp: Date.now(),
      strategy,
      previousWeight: currentWeight,
      newWeight: this.strategyWeights.get(strategy),
    });
  }

  /**
   * Get the recommended strategy for a given task type based on historical performance.
   * Returns the strategy with the highest average score for that task type,
   * or the globally highest-weighted strategy if no task-type-specific data exists.
   */
  getRecommendedStrategy(taskType: string): { strategy: string; weight: number } | null {
    // First, check task-type-specific performance
    const taskTypeData = this.strategyTaskTypes.get(taskType);

    if (taskTypeData && taskTypeData.size > 0) {
      let bestStrategy = '';
      let bestAvg = -1;

      for (const [strategy, scores] of taskTypeData) {
        if (scores.length === 0) continue;
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestStrategy = strategy;
        }
      }

      if (bestStrategy) {
        return { strategy: bestStrategy, weight: bestAvg };
      }
    }

    // Fall back to global strategy weights
    if (this.strategyWeights.size === 0) {
      return null;
    }

    let bestStrategy = '';
    let bestWeight = -1;

    for (const [strategy, weight] of this.strategyWeights) {
      if (weight > bestWeight) {
        bestWeight = weight;
        bestStrategy = strategy;
      }
    }

    return bestStrategy ? { strategy: bestStrategy, weight: bestWeight } : null;
  }

  /**
   * Get recent feedback history, newest first.
   */
  getHistory(limit?: number): FeedbackRecord[] {
    const records = [...this.history].reverse();
    return limit !== undefined ? records.slice(0, limit) : records;
  }

  /**
   * Get aggregate statistics.
   */
  getStats(): SelfImproveStats {
    return {
      feedbackCount: this.history.length,
      regressionsDetected: 0, // Managed by RegressionDetector
      capabilitiesExpanded: 0, // Managed by CapabilityExpander
      strategyAdjustments: this.adjustmentCount,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL
  // ─────────────────────────────────────────────────────────

  /**
   * Track performance per task type per strategy for targeted recommendations.
   */
  private trackTaskTypePerformance(record: FeedbackRecord): void {
    const taskType = (record.context.taskType as string) ?? 'general';
    const strategy = record.strategyUsed;

    if (!this.strategyTaskTypes.has(taskType)) {
      this.strategyTaskTypes.set(taskType, new Map());
    }
    const taskMap = this.strategyTaskTypes.get(taskType)!;

    if (!taskMap.has(strategy)) {
      taskMap.set(strategy, []);
    }
    const scores = taskMap.get(strategy)!;

    // Compute an overall score from the feedback
    const { quality, speed, cost, tokenEfficiency } = record.metrics;
    const score = record.outcome === 'success'
      ? (quality + speed + cost + tokenEfficiency) / 4
      : record.outcome === 'partial'
        ? (quality + speed + cost + tokenEfficiency) / 8
        : 0;

    scores.push(score);

    // Keep only the most recent window
    if (scores.length > this.config.feedbackWindowSize) {
      scores.splice(0, scores.length - this.config.feedbackWindowSize);
    }
  }
}
