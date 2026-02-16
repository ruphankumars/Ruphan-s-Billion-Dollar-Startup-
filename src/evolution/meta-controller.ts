/**
 * MetaController — The CRSAE Kernel / Orchestrator-of-Orchestrators
 *
 * The top-level decision maker that determines:
 * - WHICH orchestration mode to use (linear-wave, graph-based, hybrid, single)
 * - WHAT reasoning depth to apply (shallow, standard, deep, exhaustive)
 * - HOW much compute to allocate (minimal, standard, parallel, sequential, hybrid)
 * - WHEN to escalate or de-escalate based on confidence
 *
 * Evolves its own decision function over time via meta-RL.
 *
 * From: Modular Agentic Planner (MAP) — modular decision components
 * From: RSA — adaptive compute allocation across N/K/T
 * From: Godel Agent — self-referential improvement of decision-making
 * From: Microsoft STOP — meta-optimization of the optimizer itself
 *
 * Zero external dependencies.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { BoundedMap } from '../utils/bounded-map.js';
import type {
  MetaControllerConfig,
  OrchestrationMode,
  ComputeScale,
  ReasoningDepth,
  OrchestrationDecision,
  DecisionOutcome,
  PopulationConfig,
  BudgetConfig,
} from './types.js';

const DEFAULT_CONFIG: Required<MetaControllerConfig> = {
  adaptiveStrategy: true,
  adaptiveCompute: true,
  selfEvolve: true,
  learningRate: 0.1,
  maxDecisionHistory: 200,
  escalationThreshold: 0.5,
};

interface TaskAnalysis {
  complexity: number;  // 0-1
  taskType: string;
  fileCount: number;
  hasTests: boolean;
  hasDependencies: boolean;
  isRefactoring: boolean;
  estimatedTokens: number;
}

export class MetaController extends EventEmitter {
  private config: Required<MetaControllerConfig>;
  private running = false;
  private decisions: Map<string, OrchestrationDecision> = new Map();
  private outcomes: BoundedMap<string, DecisionOutcome> = new BoundedMap(200);
  private decisionHistory: OrchestrationDecision[] = [];

  // Learned thresholds (evolve over time)
  private complexityThresholds = {
    shallow: 0.2,
    standard: 0.4,
    deep: 0.7,
    exhaustive: 0.9,
  };

  // Strategy success rates (learned from outcomes)
  private modeSuccessRates: Map<OrchestrationMode, { rate: number; count: number }> = new Map([
    ['single-agent', { rate: 0.6, count: 0 }],
    ['linear-wave', { rate: 0.7, count: 0 }],
    ['graph-based', { rate: 0.7, count: 0 }],
    ['hybrid', { rate: 0.8, count: 0 }],
  ]);

  private totalDecisions = 0;
  private successfulDecisions = 0;

  constructor(config?: Partial<MetaControllerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Make an orchestration decision for a task.
   * This is the primary entry point — the "kernel syscall."
   */
  decide(taskId: string, analysis: TaskAnalysis): OrchestrationDecision {
    this.totalDecisions++;

    // 1. Determine orchestration mode
    const mode = this.selectMode(analysis);

    // 2. Determine compute scale
    const computeScale = this.selectComputeScale(analysis);

    // 3. Determine reasoning depth
    const reasoningDepth = this.selectReasoningDepth(analysis);

    // 4. Configure population parameters based on scale
    const populationConfig = this.configurePopulation(computeScale, analysis);

    // 5. Configure budget based on complexity
    const budgetAllocation = this.configureBudget(analysis);

    // 6. Compute decision confidence
    const confidence = this.computeConfidence(analysis, mode, computeScale);

    const decision: OrchestrationDecision = {
      id: `dec_${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      taskId,
      mode,
      computeScale,
      reasoningDepth,
      populationConfig,
      budgetAllocation,
      confidence,
      reasoning: this.explainDecision(analysis, mode, computeScale, reasoningDepth),
    };

    this.decisions.set(decision.id, decision);

    // Track history
    this.decisionHistory.push(decision);
    if (this.decisionHistory.length > this.config.maxDecisionHistory) {
      this.decisionHistory.splice(0, this.decisionHistory.length - this.config.maxDecisionHistory);

      // After trimming decisionHistory, remove decisions not in history
      const historyIds = new Set(this.decisionHistory.map(d => d.id));
      for (const key of this.decisions.keys()) {
        if (!historyIds.has(key)) this.decisions.delete(key);
      }
    }

    this.emit('evolution:meta:decision', {
      decisionId: decision.id,
      taskId,
      mode,
      computeScale,
      reasoningDepth,
      confidence,
    });

    return decision;
  }

  /**
   * Record the outcome of a decision and update learned parameters.
   */
  recordOutcome(decisionId: string, outcome: DecisionOutcome): void {
    const decision = this.decisions.get(decisionId);
    if (!decision) return;

    this.outcomes.set(decisionId, outcome);

    if (outcome.success) {
      this.successfulDecisions++;
    }

    // Update mode success rates
    const modeStats = this.modeSuccessRates.get(decision.mode);
    if (modeStats) {
      const lr = this.config.learningRate;
      modeStats.rate = (1 - lr) * modeStats.rate + lr * (outcome.success ? 1 : 0);
      modeStats.count++;
    }

    // Self-evolution: adjust thresholds based on outcomes
    if (this.config.selfEvolve) {
      this.evolveThresholds(decision, outcome);
    }
  }

  /**
   * Select the best orchestration mode.
   */
  private selectMode(analysis: TaskAnalysis): OrchestrationMode {
    if (!this.config.adaptiveStrategy) return 'linear-wave';

    // Single agent for simple tasks
    if (analysis.complexity < this.complexityThresholds.shallow && analysis.fileCount <= 1) {
      return 'single-agent';
    }

    // Graph-based for complex multi-dependency tasks
    if (analysis.hasDependencies && analysis.complexity >= this.complexityThresholds.deep) {
      return 'graph-based';
    }

    // Hybrid for very complex tasks
    if (analysis.complexity >= this.complexityThresholds.exhaustive) {
      return 'hybrid';
    }

    // Linear-wave is the default for medium tasks
    return 'linear-wave';
  }

  /**
   * Select compute scaling strategy.
   */
  private selectComputeScale(analysis: TaskAnalysis): ComputeScale {
    if (!this.config.adaptiveCompute) return 'standard';

    if (analysis.complexity < 0.3) return 'minimal';
    if (analysis.complexity < 0.5) return 'standard';
    if (analysis.complexity < 0.7) return 'parallel';
    if (analysis.complexity < 0.9) return 'sequential';
    return 'hybrid'; // Maximum quality for critical tasks
  }

  /**
   * Select reasoning depth.
   */
  private selectReasoningDepth(analysis: TaskAnalysis): ReasoningDepth {
    if (analysis.complexity < this.complexityThresholds.shallow) return 'shallow';
    if (analysis.complexity < this.complexityThresholds.standard) return 'standard';
    if (analysis.complexity < this.complexityThresholds.deep) return 'deep';
    return 'exhaustive';
  }

  /**
   * Configure population reasoning parameters.
   */
  private configurePopulation(
    scale: ComputeScale,
    analysis: TaskAnalysis
  ): Partial<PopulationConfig> {
    switch (scale) {
      case 'minimal':
        return { populationSize: 1, aggregationSetSize: 1, maxIterations: 1 };
      case 'standard':
        return { populationSize: 3, aggregationSetSize: 2, maxIterations: 2 };
      case 'parallel':
        return { populationSize: 5, aggregationSetSize: 3, maxIterations: 2 };
      case 'sequential':
        return { populationSize: 3, aggregationSetSize: 2, maxIterations: 4 };
      case 'hybrid':
        return { populationSize: 8, aggregationSetSize: 3, maxIterations: 4 };
      default:
        return { populationSize: 5, aggregationSetSize: 3, maxIterations: 3 };
    }
  }

  /**
   * Configure budget allocation based on task complexity.
   */
  private configureBudget(analysis: TaskAnalysis): Partial<BudgetConfig> {
    const baseApiCalls = 50;
    const baseTokens = 100000;
    const baseTimeMs = 120000;

    // Scale by complexity
    const multiplier = 1 + analysis.complexity * 3; // 1x to 4x

    return {
      maxApiCalls: Math.ceil(baseApiCalls * multiplier),
      maxTokens: Math.ceil(baseTokens * multiplier),
      maxTimeMs: Math.ceil(baseTimeMs * multiplier),
      maxDepth: analysis.isRefactoring ? 15 : 10,
      tier: analysis.complexity > 0.8 ? 'critical' : analysis.complexity > 0.5 ? 'enhanced' : 'standard',
    };
  }

  /**
   * Compute confidence in the decision.
   * Higher confidence = more historical data supporting this combination.
   */
  private computeConfidence(
    analysis: TaskAnalysis,
    mode: OrchestrationMode,
    scale: ComputeScale
  ): number {
    // Base confidence from mode success rate
    const modeStats = this.modeSuccessRates.get(mode);
    const modeConfidence = modeStats && modeStats.count >= 3 ? modeStats.rate : 0.5;

    // Experience bonus: more decisions = higher confidence
    const experienceBonus = Math.min(0.2, this.totalDecisions / 100 * 0.2);

    // Complexity penalty: higher complexity = lower confidence
    const complexityPenalty = analysis.complexity * 0.3;

    return Math.max(0.1, Math.min(1.0, modeConfidence + experienceBonus - complexityPenalty));
  }

  /**
   * Generate human-readable explanation of the decision.
   */
  private explainDecision(
    analysis: TaskAnalysis,
    mode: OrchestrationMode,
    scale: ComputeScale,
    depth: ReasoningDepth
  ): string {
    const parts: string[] = [];

    parts.push(`Task complexity: ${(analysis.complexity * 100).toFixed(0)}%`);
    parts.push(`Mode: ${mode} (files: ${analysis.fileCount}, deps: ${analysis.hasDependencies})`);
    parts.push(`Compute: ${scale}, Reasoning: ${depth}`);

    if (analysis.isRefactoring) parts.push('Refactoring detected: extended depth limit');
    if (analysis.hasTests) parts.push('Tests present: verification enabled');

    return parts.join('. ');
  }

  /**
   * Self-evolution: adjust complexity thresholds based on outcomes.
   */
  private evolveThresholds(decision: OrchestrationDecision, outcome: DecisionOutcome): void {
    const lr = this.config.learningRate * 0.5; // Slower evolution for thresholds

    // If we used too much compute for a simple task (success but slow)
    if (outcome.success && outcome.speedMs > 30000 && decision.computeScale === 'hybrid') {
      this.complexityThresholds.exhaustive = Math.min(0.99,
        this.complexityThresholds.exhaustive + lr * 0.05
      );
    }

    // If we used too little compute and failed
    if (!outcome.success && decision.computeScale === 'minimal') {
      this.complexityThresholds.shallow = Math.max(0.05,
        this.complexityThresholds.shallow - lr * 0.05
      );
    }

    // If we succeeded with standard compute on a "deep" task, we can be less aggressive
    if (outcome.success && outcome.qualityScore > 0.8 && decision.reasoningDepth === 'standard') {
      this.complexityThresholds.standard = Math.min(
        this.complexityThresholds.deep - 0.05,
        this.complexityThresholds.standard + lr * 0.02
      );
    }
  }

  /**
   * Get a decision by ID.
   */
  getDecision(decisionId: string): OrchestrationDecision | undefined {
    return this.decisions.get(decisionId);
  }

  /**
   * Get current learned thresholds.
   */
  getThresholds(): typeof this.complexityThresholds {
    return { ...this.complexityThresholds };
  }

  /**
   * Get mode performance report.
   */
  getModeReport(): Record<string, { rate: number; count: number }> {
    const report: Record<string, { rate: number; count: number }> = {};
    for (const [mode, stats] of this.modeSuccessRates) {
      report[mode] = { ...stats };
    }
    return report;
  }

  /**
   * Escalate a task: increase compute budget and reasoning depth.
   * Called when initial attempt has low confidence or fails.
   */
  escalate(decisionId: string): OrchestrationDecision | null {
    const original = this.decisions.get(decisionId);
    if (!original) return null;

    const escalated: OrchestrationDecision = {
      ...original,
      id: `dec_${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      computeScale: this.escalateScale(original.computeScale),
      reasoningDepth: this.escalateDepth(original.reasoningDepth),
      populationConfig: {
        ...original.populationConfig,
        populationSize: Math.min(10, (original.populationConfig.populationSize ?? 5) + 2),
        maxIterations: Math.min(6, (original.populationConfig.maxIterations ?? 3) + 1),
      },
      budgetAllocation: {
        ...original.budgetAllocation,
        maxApiCalls: Math.ceil((original.budgetAllocation.maxApiCalls ?? 50) * 1.5),
        maxTokens: Math.ceil((original.budgetAllocation.maxTokens ?? 100000) * 1.5),
        maxTimeMs: Math.ceil((original.budgetAllocation.maxTimeMs ?? 120000) * 1.5),
      },
      confidence: original.confidence * 0.7, // Lower confidence for escalated attempt
      reasoning: `ESCALATED from ${decisionId}. ${original.reasoning}`,
    };

    this.decisions.set(escalated.id, escalated);
    return escalated;
  }

  private escalateScale(current: ComputeScale): ComputeScale {
    const order: ComputeScale[] = ['minimal', 'standard', 'parallel', 'sequential', 'hybrid'];
    const idx = order.indexOf(current);
    return order[Math.min(idx + 1, order.length - 1)];
  }

  private escalateDepth(current: ReasoningDepth): ReasoningDepth {
    const order: ReasoningDepth[] = ['shallow', 'standard', 'deep', 'exhaustive'];
    const idx = order.indexOf(current);
    return order[Math.min(idx + 1, order.length - 1)];
  }

  getStats() {
    return {
      running: this.running,
      totalDecisions: this.totalDecisions,
      successfulDecisions: this.successfulDecisions,
      successRate: this.totalDecisions > 0
        ? this.successfulDecisions / this.totalDecisions
        : 0,
      activeDecisions: this.decisions.size,
      thresholds: { ...this.complexityThresholds },
      modeReport: this.getModeReport(),
      config: { ...this.config },
    };
  }
}
