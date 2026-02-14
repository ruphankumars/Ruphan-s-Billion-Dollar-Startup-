/**
 * StrategyEvolver — Meta-RL Strategy Evolution System
 *
 * Evolves reasoning strategy selection weights based on task outcomes.
 * Uses epsilon-greedy exploration with EMA weight updates.
 * Supports cross-task transfer learning.
 *
 * From: Microsoft STOP — code-as-improvable-artifact, meta-optimization
 * From: Self-Evolving Agents survey — STaR bootstrapping, Reflexion pattern
 * From: Godel Agent — provably beneficial self-modification
 *
 * Zero external dependencies.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  StrategyEvolverConfig,
  StrategyVariant,
  PerformanceMetric,
} from './types.js';

const DEFAULT_CONFIG: Required<StrategyEvolverConfig> = {
  learningRate: 0.1,
  explorationRate: 0.15,
  minSamples: 5,
  maxVariants: 20,
  crossTaskTransfer: true,
};

export class StrategyEvolver extends EventEmitter {
  private config: Required<StrategyEvolverConfig>;
  private running = false;
  private variants: Map<string, StrategyVariant> = new Map();
  private history: Array<{ variantId: string; taskType: string; outcome: PerformanceMetric }> = [];
  private totalEvolutions = 0;
  private totalSelections = 0;

  constructor(config?: Partial<StrategyEvolverConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.running = true;
    this.initializeDefaultStrategies();
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Initialize with default reasoning strategies from CortexOS.
   */
  private initializeDefaultStrategies(): void {
    const defaults = [
      { name: 'passthrough', config: { complexity: 'low' } },
      { name: 'react', config: { complexity: 'medium', maxSteps: 10 } },
      { name: 'tree-of-thought', config: { complexity: 'high', branches: 3, depth: 3 } },
      { name: 'multi-agent-debate', config: { complexity: 'high', agents: 3, rounds: 2 } },
      { name: 'reflexion', config: { complexity: 'any', retries: 3 } },
      { name: 'population-rsa', config: { N: 5, K: 3, T: 3 } },
      { name: 'hybrid-scaling', config: { parallel: 3, sequential: 2 } },
    ];

    for (const def of defaults) {
      if (!this.variants.has(def.name)) {
        this.registerVariant(def.name, def.config);
      }
    }
  }

  /**
   * Register a new strategy variant.
   */
  registerVariant(name: string, config: Record<string, unknown>): StrategyVariant {
    const variant: StrategyVariant = {
      id: `strat_${randomUUID().slice(0, 8)}`,
      name,
      config,
      weight: 1.0,
      taskTypePerformance: new Map(),
      generationNumber: 0,
      parentId: null,
    };

    this.variants.set(name, variant);
    return variant;
  }

  /**
   * Select the best strategy for a given task type.
   * Uses epsilon-greedy: explore with probability epsilon, exploit otherwise.
   */
  selectStrategy(taskType: string): StrategyVariant {
    this.totalSelections++;
    const candidates = [...this.variants.values()];

    if (candidates.length === 0) {
      throw new Error('No strategy variants available');
    }

    // Epsilon-greedy exploration
    if (Math.random() < this.config.explorationRate) {
      const selected = candidates[Math.floor(Math.random() * candidates.length)];
      this.emit('evolution:strategy:selected', {
        strategy: selected.name,
        reason: 'exploration',
        taskType,
      });
      return selected;
    }

    // Exploitation: select best-performing strategy for this task type
    let bestVariant = candidates[0];
    let bestScore = -Infinity;

    for (const variant of candidates) {
      const score = this.getStrategyScore(variant, taskType);
      if (score > bestScore) {
        bestScore = score;
        bestVariant = variant;
      }
    }

    this.emit('evolution:strategy:selected', {
      strategy: bestVariant.name,
      reason: 'exploitation',
      score: bestScore,
      taskType,
    });

    return bestVariant;
  }

  /**
   * Record the outcome of a strategy execution.
   * Updates weights via EMA.
   */
  recordOutcome(
    strategyName: string,
    taskType: string,
    outcome: {
      success: boolean;
      quality: number;
      speedMs: number;
      costUsd: number;
    }
  ): void {
    const variant = this.variants.get(strategyName);
    if (!variant) return;

    // Compute performance metric
    const metric: PerformanceMetric = {
      successRate: outcome.success ? 1 : 0,
      avgQuality: outcome.quality,
      avgSpeed: outcome.speedMs,
      avgCost: outcome.costUsd,
      sampleCount: 1,
    };

    // Update task-type-specific performance
    const existing = variant.taskTypePerformance.get(taskType);
    if (existing) {
      const lr = this.config.learningRate;
      existing.successRate = (1 - lr) * existing.successRate + lr * metric.successRate;
      existing.avgQuality = (1 - lr) * existing.avgQuality + lr * metric.avgQuality;
      existing.avgSpeed = (1 - lr) * existing.avgSpeed + lr * metric.avgSpeed;
      existing.avgCost = (1 - lr) * existing.avgCost + lr * metric.avgCost;
      existing.sampleCount++;
    } else {
      variant.taskTypePerformance.set(taskType, { ...metric });
    }

    // Update global weight
    const qualitySignal = outcome.quality * (outcome.success ? 1 : 0.3);
    const lr = this.config.learningRate;
    variant.weight = (1 - lr) * variant.weight + lr * qualitySignal;

    // Cross-task transfer: if this strategy did well, slightly boost it for all tasks
    if (this.config.crossTaskTransfer && outcome.success && outcome.quality > 0.8) {
      for (const [taskKey, perf] of variant.taskTypePerformance) {
        if (taskKey !== taskType) {
          perf.avgQuality = Math.min(1, perf.avgQuality + 0.01);
        }
      }
    }

    // Track history
    this.history.push({ variantId: variant.id, taskType, outcome: metric });
    if (this.history.length > 500) {
      this.history.splice(0, this.history.length - 500);
    }
  }

  /**
   * Evolve a new variant from the best-performing strategy.
   * Mutates config parameters slightly.
   */
  evolveNewVariant(baseStrategyName: string): StrategyVariant | null {
    const base = this.variants.get(baseStrategyName);
    if (!base) return null;

    // Check if we've hit max variants
    if (this.variants.size >= this.config.maxVariants) {
      this.pruneWeakVariants();
    }

    // Mutate config
    const mutatedConfig: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(base.config)) {
      if (typeof value === 'number') {
        // Mutate numeric values by ±20%
        const mutation = 1 + (Math.random() - 0.5) * 0.4;
        mutatedConfig[key] = Math.round(value * mutation * 100) / 100;
      } else {
        mutatedConfig[key] = value;
      }
    }

    const newName = `${base.name}_gen${base.generationNumber + 1}_${randomUUID().slice(0, 4)}`;
    const newVariant: StrategyVariant = {
      id: `strat_${randomUUID().slice(0, 8)}`,
      name: newName,
      config: mutatedConfig,
      weight: base.weight * 0.9, // Start slightly below parent
      taskTypePerformance: new Map(),
      generationNumber: base.generationNumber + 1,
      parentId: base.id,
    };

    this.variants.set(newName, newVariant);
    this.totalEvolutions++;

    this.emit('evolution:strategy:evolved', {
      parent: base.name,
      child: newName,
      generation: newVariant.generationNumber,
      mutatedConfig,
    });

    return newVariant;
  }

  /**
   * Get the composite score for a strategy on a specific task type.
   */
  private getStrategyScore(variant: StrategyVariant, taskType: string): number {
    // Check task-type-specific performance
    const taskPerf = variant.taskTypePerformance.get(taskType);

    if (taskPerf && taskPerf.sampleCount >= this.config.minSamples) {
      // Weighted combination: quality (40%), success (30%), speed inverse (20%), cost inverse (10%)
      const speedScore = taskPerf.avgSpeed > 0 ? 1 / (1 + taskPerf.avgSpeed / 10000) : 0.5;
      const costScore = taskPerf.avgCost > 0 ? 1 / (1 + taskPerf.avgCost) : 0.5;

      return (
        taskPerf.avgQuality * 0.4 +
        taskPerf.successRate * 0.3 +
        speedScore * 0.2 +
        costScore * 0.1
      );
    }

    // Fall back to global weight if insufficient task-specific data
    // Add exploration bonus for under-sampled strategies
    const totalSamples = taskPerf?.sampleCount ?? 0;
    const explorationBonus = Math.sqrt(2 * Math.log(this.totalSelections + 1) / (totalSamples + 1));

    return variant.weight * 0.5 + explorationBonus * 0.5;
  }

  /**
   * Remove the weakest variants to make room for new ones.
   */
  private pruneWeakVariants(): void {
    const sorted = [...this.variants.entries()]
      .sort(([, a], [, b]) => a.weight - b.weight);

    // Remove bottom 20% (but keep at least 5 strategies)
    const toRemove = Math.max(0, Math.floor(sorted.length * 0.2));
    for (let i = 0; i < toRemove && this.variants.size > 5; i++) {
      this.variants.delete(sorted[i][0]);
    }
  }

  /**
   * Get all strategy variants.
   */
  getAllVariants(): StrategyVariant[] {
    return [...this.variants.values()];
  }

  /**
   * Get a specific variant.
   */
  getVariant(name: string): StrategyVariant | undefined {
    return this.variants.get(name);
  }

  /**
   * Get the top N strategies for a task type.
   */
  getTopStrategies(taskType: string, n: number = 3): StrategyVariant[] {
    return [...this.variants.values()]
      .map(v => ({ variant: v, score: this.getStrategyScore(v, taskType) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(x => x.variant);
  }

  /**
   * Get strategy performance report.
   */
  getPerformanceReport(): Record<string, {
    weight: number;
    generation: number;
    taskTypes: Record<string, PerformanceMetric>;
  }> {
    const report: Record<string, any> = {};

    for (const [name, variant] of this.variants) {
      const taskTypes: Record<string, PerformanceMetric> = {};
      for (const [taskType, perf] of variant.taskTypePerformance) {
        taskTypes[taskType] = { ...perf };
      }

      report[name] = {
        weight: variant.weight,
        generation: variant.generationNumber,
        taskTypes,
      };
    }

    return report;
  }

  getStats() {
    return {
      running: this.running,
      variantCount: this.variants.size,
      totalSelections: this.totalSelections,
      totalEvolutions: this.totalEvolutions,
      topStrategy: [...this.variants.values()]
        .sort((a, b) => b.weight - a.weight)[0]?.name ?? 'none',
      config: { ...this.config },
    };
  }
}
