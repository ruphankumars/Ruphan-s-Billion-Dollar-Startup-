/**
 * Agent FinOps — Financial operations engine for AI agents.
 *
 * Manages consumption tracking, cost forecasting via linear regression,
 * budget enforcement, rightsizing recommendations, and comprehensive
 * financial reporting for CortexOS agent orchestration.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type {
  ConsumptionRecord,
  CostForecast,
  TaggedCost,
  RightsizingRecommendation,
  Budget,
  BudgetAlert,
  BudgetLevel,
  FinOpsReport,
  FinOpsConfig,
  FinOpsStats,
} from './types.js';

/** Default configuration */
const DEFAULT_CONFIG: FinOpsConfig = {
  enabled: true,
  maxRecords: 100_000,
  forecastEnabled: true,
  rightsizingEnabled: true,
  reportIntervalMs: 3_600_000, // 1 hour
  defaultBudgetAlertThreshold: 0.8,
};

/**
 * Model pricing tiers (per 1K tokens) used for rightsizing analysis.
 * Ordered from most expensive to cheapest.
 */
const MODEL_PRICING: Record<string, { input: number; output: number; tier: number }> = {
  'gpt-4': { input: 0.03, output: 0.06, tier: 4 },
  'gpt-4-turbo': { input: 0.01, output: 0.03, tier: 4 },
  'claude-3-opus': { input: 0.015, output: 0.075, tier: 4 },
  'claude-3.5-sonnet': { input: 0.003, output: 0.015, tier: 3 },
  'claude-3-sonnet': { input: 0.003, output: 0.015, tier: 3 },
  'gpt-4o': { input: 0.005, output: 0.015, tier: 3 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006, tier: 2 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125, tier: 2 },
  'claude-3.5-haiku': { input: 0.0008, output: 0.004, tier: 2 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015, tier: 1 },
};

/**
 * Cheaper model alternatives by tier, ordered by preference.
 */
const DOWNGRADE_MAP: Record<string, string[]> = {
  'gpt-4': ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
  'gpt-4-turbo': ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
  'claude-3-opus': ['claude-3.5-sonnet', 'claude-3-haiku', 'claude-3.5-haiku'],
  'claude-3.5-sonnet': ['claude-3.5-haiku', 'claude-3-haiku'],
  'claude-3-sonnet': ['claude-3.5-haiku', 'claude-3-haiku'],
  'gpt-4o': ['gpt-4o-mini', 'gpt-3.5-turbo'],
};

/**
 * AgentFinOps provides comprehensive financial operations for AI agent
 * deployments, including cost tracking, budget management, forecasting,
 * and intelligent rightsizing recommendations.
 */
export class AgentFinOps extends EventEmitter {
  private records: ConsumptionRecord[] = [];
  private budgets: Map<string, Budget> = new Map();
  private recommendations: RightsizingRecommendation[] = [];
  private budgetAlertsTriggered = 0;
  private running = false;
  private config: FinOpsConfig;

  constructor(config?: Partial<FinOpsConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start the FinOps engine */
  start(): void {
    this.running = true;
    this.emit('finops:engine:started');
  }

  /** Stop the FinOps engine */
  stop(): void {
    this.running = false;
    this.emit('finops:engine:stopped');
  }

  /** Check if the FinOps engine is running */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Record a consumption event. Generates an ID and timestamp,
   * then checks all budgets for threshold violations.
   */
  recordConsumption(
    record: Omit<ConsumptionRecord, 'id' | 'timestamp'>,
  ): ConsumptionRecord {
    const fullRecord: ConsumptionRecord = {
      id: `cr-${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      ...record,
    };

    this.records.push(fullRecord);

    // Trim records if over capacity
    if (this.records.length > this.config.maxRecords) {
      this.records = this.records.slice(-this.config.maxRecords);
    }

    this.emit('finops:consumption:recorded', {
      id: fullRecord.id,
      agentId: fullRecord.agentId,
      cost: fullRecord.cost,
      model: fullRecord.model,
    });

    // Auto-update matching budgets
    for (const budget of this.budgets.values()) {
      if (this.recordMatchesBudget(fullRecord, budget)) {
        this.updateBudgetSpend(budget.id, fullRecord.cost);
      }
    }

    return fullRecord;
  }

  /**
   * Get consumption records with optional filtering.
   */
  getConsumption(filter?: {
    agentId?: string;
    taskId?: string;
    model?: string;
    since?: number;
    until?: number;
  }): ConsumptionRecord[] {
    let results = [...this.records];

    if (filter?.agentId !== undefined) {
      results = results.filter(r => r.agentId === filter.agentId);
    }
    if (filter?.taskId !== undefined) {
      results = results.filter(r => r.taskId === filter.taskId);
    }
    if (filter?.model !== undefined) {
      results = results.filter(r => r.model === filter.model);
    }
    if (filter?.since !== undefined) {
      results = results.filter(r => r.timestamp >= filter.since!);
    }
    if (filter?.until !== undefined) {
      results = results.filter(r => r.timestamp <= filter.until!);
    }

    return results;
  }

  /**
   * Generate a cost forecast for an agent using linear regression
   * on historical consumption data.
   */
  forecast(
    agentId: string,
    period: 'hourly' | 'daily' | 'weekly' | 'monthly',
  ): CostForecast {
    const agentRecords = this.records.filter(r => r.agentId === agentId);
    return this.calculateForecast(agentRecords, period, agentId);
  }

  /**
   * Get aggregated cost breakdown filtered by matching tags.
   */
  getCostByTags(tags: Record<string, string>): TaggedCost {
    let totalCost = 0;
    let totalTokens = 0;
    let recordCount = 0;

    for (const record of this.records) {
      const matches = Object.entries(tags).every(
        ([key, value]) => record.tags[key] === value,
      );

      if (matches) {
        totalCost += record.cost;
        totalTokens += record.inputTokens + record.outputTokens;
        recordCount++;
      }
    }

    return { tags, totalCost, totalTokens, recordCount };
  }

  /**
   * Get cost breakdown by agent and model for a time range.
   */
  getCostBreakdown(
    since: number,
    until: number,
  ): {
    byAgent: Map<string, number>;
    byModel: Map<string, number>;
    total: number;
  } {
    const byAgent = new Map<string, number>();
    const byModel = new Map<string, number>();
    let total = 0;

    for (const record of this.records) {
      if (record.timestamp < since || record.timestamp > until) continue;

      total += record.cost;
      byAgent.set(record.agentId, (byAgent.get(record.agentId) ?? 0) + record.cost);
      byModel.set(record.model, (byModel.get(record.model) ?? 0) + record.cost);
    }

    return { byAgent, byModel, total };
  }

  /**
   * Create a new budget with tracking.
   */
  createBudget(
    budget: Omit<Budget, 'id' | 'spent' | 'createdAt'>,
  ): Budget {
    const id = `bgt-${randomUUID().slice(0, 8)}`;
    const fullBudget: Budget = {
      id,
      spent: 0,
      createdAt: Date.now(),
      ...budget,
    };

    this.budgets.set(id, fullBudget);
    this.emit('finops:budget:created', {
      budgetId: id,
      name: budget.name,
      limit: budget.limit,
      level: budget.level,
    });

    return fullBudget;
  }

  /**
   * Update budget spend by adding an amount. Checks threshold and
   * emits alert if budget usage exceeds the configured alert threshold.
   */
  updateBudgetSpend(budgetId: string, amount: number): Budget {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      throw new Error(`Budget not found: ${budgetId}`);
    }

    budget.spent += amount;

    // Check threshold
    const percentUsed = budget.spent / budget.limit;
    if (percentUsed >= budget.alertThreshold) {
      const alert: BudgetAlert = {
        id: `ba-${randomUUID().slice(0, 8)}`,
        budgetId: budget.id,
        budgetName: budget.name,
        percentUsed,
        message: `Budget "${budget.name}" is at ${(percentUsed * 100).toFixed(1)}% usage ($${budget.spent.toFixed(4)} of $${budget.limit.toFixed(4)})`,
        timestamp: Date.now(),
      };

      this.budgetAlertsTriggered++;
      this.emit('finops:budget:alert', alert);
    }

    if (percentUsed >= 1.0) {
      this.emit('finops:budget:exceeded', {
        budgetId: budget.id,
        budgetName: budget.name,
        spent: budget.spent,
        limit: budget.limit,
      });
    }

    return budget;
  }

  /**
   * Check all budgets for threshold violations and return alerts.
   */
  checkBudgets(): BudgetAlert[] {
    const alerts: BudgetAlert[] = [];

    for (const budget of this.budgets.values()) {
      const percentUsed = budget.spent / budget.limit;
      if (percentUsed >= budget.alertThreshold) {
        alerts.push({
          id: `ba-${randomUUID().slice(0, 8)}`,
          budgetId: budget.id,
          budgetName: budget.name,
          percentUsed,
          message: `Budget "${budget.name}" is at ${(percentUsed * 100).toFixed(1)}% usage ($${budget.spent.toFixed(4)} of $${budget.limit.toFixed(4)})`,
          timestamp: Date.now(),
        });
      }
    }

    return alerts;
  }

  /** Get a budget by ID */
  getBudget(id: string): Budget | undefined {
    return this.budgets.get(id);
  }

  /** List all budgets, optionally filtered by level */
  listBudgets(level?: BudgetLevel): Budget[] {
    const all = [...this.budgets.values()];
    if (level) {
      return all.filter(b => b.level === level);
    }
    return all;
  }

  /**
   * Generate rightsizing recommendations based on actual consumption patterns.
   *
   * Analyzes agent usage to identify:
   * 1. Expensive models used for simple tasks (low output token avg)
   * 2. Models with consistent low quality variance suggesting cheaper alternatives
   * 3. Concrete savings estimates based on pricing differences
   */
  generateRecommendations(agentId?: string): RightsizingRecommendation[] {
    if (!this.config.rightsizingEnabled) return [];

    const newRecommendations: RightsizingRecommendation[] = [];
    const recordsByAgent = new Map<string, ConsumptionRecord[]>();

    // Group records by agent
    for (const record of this.records) {
      if (agentId && record.agentId !== agentId) continue;
      const agentRecords = recordsByAgent.get(record.agentId) ?? [];
      agentRecords.push(record);
      recordsByAgent.set(record.agentId, agentRecords);
    }

    for (const [agent, agentRecords] of recordsByAgent) {
      // Group by model
      const byModel = new Map<string, ConsumptionRecord[]>();
      for (const record of agentRecords) {
        const modelRecords = byModel.get(record.model) ?? [];
        modelRecords.push(record);
        byModel.set(record.model, modelRecords);
      }

      for (const [model, modelRecords] of byModel) {
        const pricing = MODEL_PRICING[model];
        if (!pricing) continue;

        const downgrades = DOWNGRADE_MAP[model];
        if (!downgrades || downgrades.length === 0) continue;

        // Calculate average output tokens per request
        const avgOutputTokens =
          modelRecords.reduce((sum, r) => sum + r.outputTokens, 0) / modelRecords.length;

        // Calculate average input tokens per request
        const avgInputTokens =
          modelRecords.reduce((sum, r) => sum + r.inputTokens, 0) / modelRecords.length;

        // Calculate total cost for this model
        const totalModelCost = modelRecords.reduce((sum, r) => sum + r.cost, 0);

        // Rule 1: Expensive model for simple tasks (low output token average)
        // If average output is under 100 tokens, the task is likely simple
        if (avgOutputTokens < 100 && pricing.tier >= 3) {
          const recommended = downgrades[0];
          const recPricing = MODEL_PRICING[recommended];
          if (recPricing) {
            const currentCostPer1k =
              (avgInputTokens * pricing.input + avgOutputTokens * pricing.output) / 1000;
            const newCostPer1k =
              (avgInputTokens * recPricing.input + avgOutputTokens * recPricing.output) / 1000;

            const savingsRatio = currentCostPer1k > 0
              ? 1 - newCostPer1k / currentCostPer1k
              : 0;
            const estimatedSavings = totalModelCost * savingsRatio;

            if (estimatedSavings > 0) {
              newRecommendations.push({
                id: `rec-${randomUUID().slice(0, 8)}`,
                agentId: agent,
                currentModel: model,
                recommendedModel: recommended,
                estimatedSavings,
                qualityImpact: 0.05, // Minimal impact for simple tasks
                reasoning: `Agent "${agent}" uses ${model} but averages only ${avgOutputTokens.toFixed(0)} output tokens/request, suggesting simple tasks. Switching to ${recommended} could save ~$${estimatedSavings.toFixed(4)} (${(savingsRatio * 100).toFixed(0)}% reduction).`,
                generatedAt: Date.now(),
              });
            }
          }
        }

        // Rule 2: Low cost variance suggests model is over-provisioned
        // If the coefficient of variation of cost is low, tasks are uniform
        if (modelRecords.length >= 10 && pricing.tier >= 3) {
          const costs = modelRecords.map(r => r.cost);
          const meanCost = costs.reduce((a, b) => a + b, 0) / costs.length;
          const variance = costs.reduce((sum, c) => sum + (c - meanCost) ** 2, 0) / costs.length;
          const stdDev = Math.sqrt(variance);
          const cv = meanCost > 0 ? stdDev / meanCost : 0;

          // Low CV (< 0.3) means consistent, predictable usage
          if (cv < 0.3 && avgOutputTokens < 500) {
            const recommended = downgrades[downgrades.length > 1 ? 1 : 0];
            const recPricing = MODEL_PRICING[recommended];
            if (recPricing) {
              const currentCostPer1k =
                (avgInputTokens * pricing.input + avgOutputTokens * pricing.output) / 1000;
              const newCostPer1k =
                (avgInputTokens * recPricing.input + avgOutputTokens * recPricing.output) / 1000;

              const savingsRatio = currentCostPer1k > 0
                ? 1 - newCostPer1k / currentCostPer1k
                : 0;
              const estimatedSavings = totalModelCost * savingsRatio;

              // Only recommend if not already recommended for this agent+model
              const alreadyRecommended = newRecommendations.some(
                r => r.agentId === agent && r.currentModel === model,
              );

              if (estimatedSavings > 0 && !alreadyRecommended) {
                newRecommendations.push({
                  id: `rec-${randomUUID().slice(0, 8)}`,
                  agentId: agent,
                  currentModel: model,
                  recommendedModel: recommended,
                  estimatedSavings,
                  qualityImpact: 0.1, // Low variance suggests consistent quality needs
                  reasoning: `Agent "${agent}" has very consistent ${model} usage (CV=${cv.toFixed(2)}, avg ${avgOutputTokens.toFixed(0)} output tokens). Uniform workloads often perform well with ${recommended}, saving ~$${estimatedSavings.toFixed(4)}.`,
                  generatedAt: Date.now(),
                });
              }
            }
          }
        }
      }
    }

    this.recommendations.push(...newRecommendations);
    this.emit('finops:recommendations:generated', {
      count: newRecommendations.length,
    });

    return newRecommendations;
  }

  /**
   * Generate a comprehensive FinOps report for a time period.
   */
  generateReport(periodStart: number, periodEnd: number): FinOpsReport {
    const periodRecords = this.records.filter(
      r => r.timestamp >= periodStart && r.timestamp <= periodEnd,
    );

    // Aggregate by agent
    const agentMap = new Map<string, { cost: number; tokens: number }>();
    for (const record of periodRecords) {
      const existing = agentMap.get(record.agentId) ?? { cost: 0, tokens: 0 };
      existing.cost += record.cost;
      existing.tokens += record.inputTokens + record.outputTokens;
      agentMap.set(record.agentId, existing);
    }

    // Aggregate by model
    const modelMap = new Map<string, { cost: number; tokens: number }>();
    for (const record of periodRecords) {
      const existing = modelMap.get(record.model) ?? { cost: 0, tokens: 0 };
      existing.cost += record.cost;
      existing.tokens += record.inputTokens + record.outputTokens;
      modelMap.set(record.model, existing);
    }

    // Aggregate by unique tag combinations
    const tagMap = new Map<string, TaggedCost>();
    for (const record of periodRecords) {
      const tagKey = JSON.stringify(
        Object.entries(record.tags).sort(([a], [b]) => a.localeCompare(b)),
      );

      const existing = tagMap.get(tagKey) ?? {
        tags: record.tags,
        totalCost: 0,
        totalTokens: 0,
        recordCount: 0,
      };
      existing.totalCost += record.cost;
      existing.totalTokens += record.inputTokens + record.outputTokens;
      existing.recordCount++;
      tagMap.set(tagKey, existing);
    }

    const totalCost = periodRecords.reduce((sum, r) => sum + r.cost, 0);
    const totalTokens = periodRecords.reduce(
      (sum, r) => sum + r.inputTokens + r.outputTokens,
      0,
    );

    // Filter recommendations relevant to the period
    const relevantRecommendations = this.recommendations.filter(
      r => r.generatedAt >= periodStart && r.generatedAt <= periodEnd,
    );

    return {
      periodStart,
      periodEnd,
      totalCost,
      totalTokens,
      byAgent: [...agentMap.entries()]
        .map(([agentId, data]) => ({ agentId, cost: data.cost, tokens: data.tokens }))
        .sort((a, b) => b.cost - a.cost),
      byModel: [...modelMap.entries()]
        .map(([model, data]) => ({ model, cost: data.cost, tokens: data.tokens }))
        .sort((a, b) => b.cost - a.cost),
      byTag: [...tagMap.values()].sort((a, b) => b.totalCost - a.totalCost),
      recommendations: relevantRecommendations,
      budgetStatus: [...this.budgets.values()],
      generatedAt: Date.now(),
    };
  }

  /**
   * Get FinOps statistics.
   */
  getStats(): FinOpsStats {
    const totalCost = this.records.reduce((sum, r) => sum + r.cost, 0);
    const totalTokens = this.records.reduce(
      (sum, r) => sum + r.inputTokens + r.outputTokens,
      0,
    );

    // Calculate avg cost per unique task
    const taskIds = new Set(this.records.filter(r => r.taskId).map(r => r.taskId));
    const avgCostPerTask = taskIds.size > 0 ? totalCost / taskIds.size : 0;

    return {
      totalRecords: this.records.length,
      totalCost,
      totalTokens,
      activeBudgets: this.budgets.size,
      budgetAlertsTriggered: this.budgetAlertsTriggered,
      recommendationsGenerated: this.recommendations.length,
      avgCostPerTask,
    };
  }

  /**
   * Calculate a cost forecast using linear regression on historical data.
   * Extrapolates consumption trends to estimate future costs.
   */
  private calculateForecast(
    records: ConsumptionRecord[],
    period: string,
    agentId: string,
  ): CostForecast {
    const now = Date.now();

    if (records.length === 0) {
      return {
        agentId,
        period: period as CostForecast['period'],
        estimatedCost: 0,
        estimatedTokens: 0,
        confidence: 0,
        basedOnSamples: 0,
        generatedAt: now,
      };
    }

    // Period multiplier in milliseconds
    const periodMs: Record<string, number> = {
      hourly: 3_600_000,
      daily: 86_400_000,
      weekly: 604_800_000,
      monthly: 2_592_000_000, // 30 days
    };

    const targetMs = periodMs[period] ?? periodMs.daily;

    // Simple linear regression: y = mx + b
    // where x = time, y = cumulative cost
    const sortedRecords = [...records].sort((a, b) => a.timestamp - b.timestamp);

    // Use timestamp as x values, cost as y values
    const n = sortedRecords.length;
    const xs = sortedRecords.map(r => r.timestamp);
    const ys = sortedRecords.map(r => r.cost);

    // Calculate cumulative cost at each point
    const cumulativeY: number[] = [];
    let cumSum = 0;
    for (const y of ys) {
      cumSum += y;
      cumulativeY.push(cumSum);
    }

    // Linear regression on cumulative costs
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = cumulativeY.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (xs[i] - xMean) * (cumulativeY[i] - yMean);
      denominator += (xs[i] - xMean) ** 2;
    }

    // Slope = rate of cost accumulation per millisecond
    const slope = denominator !== 0 ? numerator / denominator : 0;

    // Estimate cost for the target period
    const estimatedCost = Math.max(0, slope * targetMs);

    // Estimate tokens similarly
    const tokenYs: number[] = [];
    let tokenCum = 0;
    for (const r of sortedRecords) {
      tokenCum += r.inputTokens + r.outputTokens;
      tokenYs.push(tokenCum);
    }

    const tokenYMean = tokenYs.reduce((a, b) => a + b, 0) / n;
    let tokenNum = 0;
    let tokenDen = 0;
    for (let i = 0; i < n; i++) {
      tokenNum += (xs[i] - xMean) * (tokenYs[i] - tokenYMean);
      tokenDen += (xs[i] - xMean) ** 2;
    }
    const tokenSlope = tokenDen !== 0 ? tokenNum / tokenDen : 0;
    const estimatedTokens = Math.max(0, Math.round(tokenSlope * targetMs));

    // Calculate R-squared as confidence measure
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
      const predicted = yMean + slope * (xs[i] - xMean);
      ssRes += (cumulativeY[i] - predicted) ** 2;
      ssTot += (cumulativeY[i] - yMean) ** 2;
    }
    const rSquared = ssTot !== 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

    return {
      agentId,
      period: period as CostForecast['period'],
      estimatedCost,
      estimatedTokens,
      confidence: Math.min(1, rSquared * Math.min(1, n / 10)), // Scale confidence with sample size
      basedOnSamples: n,
      generatedAt: now,
    };
  }

  /**
   * Check if a consumption record matches a budget's scope.
   */
  private recordMatchesBudget(record: ConsumptionRecord, budget: Budget): boolean {
    switch (budget.level) {
      case 'agent':
        return record.agentId === budget.entityId;
      case 'task':
        return record.taskId === budget.entityId;
      case 'team':
        return record.tags['team'] === budget.entityId;
      case 'organization':
        return true; // Organization budgets match all records
      default:
        return false;
    }
  }
}
