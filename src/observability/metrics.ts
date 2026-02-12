/**
 * Telemetry & Metrics — Aggregated run statistics, cost analytics,
 * and performance metrics for CortexOS executions.
 */

import { getLogger } from '../core/logger.js';

const logger = getLogger();

export interface RunMetric {
  runId: string;
  timestamp: number;
  duration: number;
  success: boolean;
  prompt: string;
  stages: StageMetric[];
  agents: AgentMetric[];
  cost: CostMetric;
  quality: QualityMetric;
  memory: MemoryMetric;
}

export interface StageMetric {
  name: string;
  duration: number;
  success: boolean;
}

export interface AgentMetric {
  taskId: string;
  role: string;
  duration: number;
  success: boolean;
  tokensUsed: number;
  toolCalls: number;
  iterations: number;
}

export interface CostMetric {
  totalTokens: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  modelBreakdown: Array<{ model: string; tokens: number; cost: number }>;
}

export interface QualityMetric {
  passed: boolean;
  score: number;
  gatesRun: number;
  issuesFound: number;
}

export interface MemoryMetric {
  recalled: number;
  stored: number;
  cacheHits?: number;
}

export interface AggregateMetrics {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  totalCost: number;
  avgCostPerRun: number;
  totalTokens: number;
  avgTokensPerRun: number;
  avgQualityScore: number;
  mostUsedRoles: Array<{ role: string; count: number }>;
  costByModel: Array<{ model: string; totalCost: number; totalTokens: number }>;
  failureReasons: Array<{ reason: string; count: number }>;
}

/**
 * MetricsCollector aggregates and analyzes run metrics.
 */
export class MetricsCollector {
  private runs: RunMetric[] = [];
  private maxHistory: number;

  constructor(maxHistory = 1000) {
    this.maxHistory = maxHistory;
  }

  /**
   * Record a completed run
   */
  record(metric: RunMetric): void {
    this.runs.push(metric);

    // Trim history
    if (this.runs.length > this.maxHistory) {
      this.runs = this.runs.slice(-this.maxHistory);
    }

    logger.debug(
      { runId: metric.runId, duration: metric.duration, success: metric.success },
      'Run metric recorded',
    );
  }

  /**
   * Get aggregate metrics across all recorded runs
   */
  aggregate(since?: number): AggregateMetrics {
    const filtered = since
      ? this.runs.filter(r => r.timestamp >= since)
      : this.runs;

    if (filtered.length === 0) {
      return this.emptyAggregates();
    }

    const durations = filtered.map(r => r.duration).sort((a, b) => a - b);
    const successCount = filtered.filter(r => r.success).length;

    // Role usage
    const roleCount = new Map<string, number>();
    for (const run of filtered) {
      for (const agent of run.agents) {
        roleCount.set(agent.role, (roleCount.get(agent.role) || 0) + 1);
      }
    }

    // Cost by model
    const modelCost = new Map<string, { cost: number; tokens: number }>();
    for (const run of filtered) {
      for (const mb of run.cost.modelBreakdown) {
        const existing = modelCost.get(mb.model) || { cost: 0, tokens: 0 };
        existing.cost += mb.cost;
        existing.tokens += mb.tokens;
        modelCost.set(mb.model, existing);
      }
    }

    // Failure reasons
    const failReasons = new Map<string, number>();
    for (const run of filtered) {
      if (!run.success) {
        const reason = this.classifyFailure(run);
        failReasons.set(reason, (failReasons.get(reason) || 0) + 1);
      }
    }

    const totalCost = filtered.reduce((sum, r) => sum + r.cost.totalCost, 0);
    const totalTokens = filtered.reduce((sum, r) => sum + r.cost.totalTokens, 0);

    return {
      totalRuns: filtered.length,
      successRate: successCount / filtered.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      p50Duration: this.percentile(durations, 0.50),
      p95Duration: this.percentile(durations, 0.95),
      p99Duration: this.percentile(durations, 0.99),
      totalCost,
      avgCostPerRun: totalCost / filtered.length,
      totalTokens,
      avgTokensPerRun: totalTokens / filtered.length,
      avgQualityScore: filtered.reduce((sum, r) => sum + r.quality.score, 0) / filtered.length,
      mostUsedRoles: [...roleCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([role, count]) => ({ role, count })),
      costByModel: [...modelCost.entries()]
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([model, data]) => ({ model, totalCost: data.cost, totalTokens: data.tokens })),
      failureReasons: [...failReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({ reason, count })),
    };
  }

  /**
   * Get time-series data for charting
   */
  timeSeries(
    field: 'duration' | 'cost' | 'tokens' | 'quality',
    bucketMs = 3600000, // 1 hour default
  ): Array<{ timestamp: number; value: number; count: number }> {
    if (this.runs.length === 0) return [];

    const buckets = new Map<number, { sum: number; count: number }>();

    for (const run of this.runs) {
      const bucket = Math.floor(run.timestamp / bucketMs) * bucketMs;
      const existing = buckets.get(bucket) || { sum: 0, count: 0 };

      switch (field) {
        case 'duration': existing.sum += run.duration; break;
        case 'cost': existing.sum += run.cost.totalCost; break;
        case 'tokens': existing.sum += run.cost.totalTokens; break;
        case 'quality': existing.sum += run.quality.score; break;
      }
      existing.count++;
      buckets.set(bucket, existing);
    }

    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([timestamp, data]) => ({
        timestamp,
        value: data.sum / data.count,
        count: data.count,
      }));
  }

  /**
   * Get recent runs
   */
  getRecentRuns(limit = 10): RunMetric[] {
    return this.runs.slice(-limit).reverse();
  }

  /**
   * Get a specific run
   */
  getRun(runId: string): RunMetric | undefined {
    return this.runs.find(r => r.runId === runId);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.runs = [];
  }

  /**
   * Export all metrics as JSON
   */
  export(): { runs: RunMetric[]; aggregates: AggregateMetrics } {
    return {
      runs: this.runs,
      aggregates: this.aggregate(),
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  private classifyFailure(run: RunMetric): string {
    if (!run.quality.passed) return 'quality_gate_failure';
    const failedAgents = run.agents.filter(a => !a.success);
    if (failedAgents.length > 0) return 'agent_failure';
    return 'unknown';
  }

  private emptyAggregates(): AggregateMetrics {
    return {
      totalRuns: 0,
      successRate: 0,
      avgDuration: 0,
      p50Duration: 0,
      p95Duration: 0,
      p99Duration: 0,
      totalCost: 0,
      avgCostPerRun: 0,
      totalTokens: 0,
      avgTokensPerRun: 0,
      avgQualityScore: 0,
      mostUsedRoles: [],
      costByModel: [],
      failureReasons: [],
    };
  }
}
