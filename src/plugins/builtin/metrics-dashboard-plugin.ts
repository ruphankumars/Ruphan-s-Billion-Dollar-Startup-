/**
 * Metrics Dashboard Plugin — Registers tools and gates for real-time
 * execution metrics, cost tracking, and performance monitoring.
 *
 * Provides:
 * - `metrics_snapshot` tool: Returns current run metrics (tokens, cost, timing)
 * - `metrics_history` tool: Returns historical execution metrics
 * - `performance-budget` gate: Fails if execution exceeds token/cost thresholds
 */

import type { CortexPlugin, PluginContext } from '../registry.js';
import type { Tool, ToolResult, ToolContext } from '../../tools/types.js';
import type { QualityGate, QualityContext, GateResult, GateIssue } from '../../quality/types.js';

// ===== Internal Metrics Store =====

interface MetricEntry {
  executionId: string;
  timestamp: number;
  tokensUsed: number;
  costUsd: number;
  durationMs: number;
  stagesCompleted: number;
  agentCount: number;
}

class MetricsStore {
  private entries: MetricEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  record(entry: MetricEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  getLatest(count = 10): MetricEntry[] {
    return this.entries.slice(-count);
  }

  getAll(): MetricEntry[] {
    return [...this.entries];
  }

  getAverages(): { avgTokens: number; avgCost: number; avgDuration: number } {
    if (this.entries.length === 0) {
      return { avgTokens: 0, avgCost: 0, avgDuration: 0 };
    }
    const sum = this.entries.reduce(
      (acc, e) => ({
        tokens: acc.tokens + e.tokensUsed,
        cost: acc.cost + e.costUsd,
        duration: acc.duration + e.durationMs,
      }),
      { tokens: 0, cost: 0, duration: 0 },
    );
    return {
      avgTokens: Math.round(sum.tokens / this.entries.length),
      avgCost: Math.round((sum.cost / this.entries.length) * 10000) / 10000,
      avgDuration: Math.round(sum.duration / this.entries.length),
    };
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}

// ===== Tools =====

function createSnapshotTool(store: MetricsStore): Tool {
  return {
    name: 'metrics_snapshot',
    description: 'Get a snapshot of current execution metrics including tokens used, cost, and timing',
    parameters: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of recent entries to return (default: 5)',
          default: 5,
        },
      },
      required: [],
    },
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      const count = (args.count as number) || 5;
      const latest = store.getLatest(count);
      const averages = store.getAverages();

      return {
        success: true,
        output: JSON.stringify({
          recentExecutions: latest,
          averages,
          totalRecorded: store.size,
        }, null, 2),
        metadata: { entriesReturned: latest.length },
      };
    },
  };
}

function createHistoryTool(store: MetricsStore): Tool {
  return {
    name: 'metrics_history',
    description: 'Get full execution metrics history with aggregated statistics',
    parameters: {
      type: 'object',
      properties: {
        since: {
          type: 'number',
          description: 'Unix timestamp to filter entries from (optional)',
        },
        format: {
          type: 'string',
          description: 'Output format: "summary" or "detailed" (default: "summary")',
          enum: ['summary', 'detailed'],
        },
      },
      required: [],
    },
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      let entries = store.getAll();
      const since = args.since as number | undefined;
      if (since) {
        entries = entries.filter(e => e.timestamp >= since);
      }

      const format = (args.format as string) || 'summary';

      if (format === 'summary') {
        const averages = store.getAverages();
        const totalCost = entries.reduce((s, e) => s + e.costUsd, 0);
        const totalTokens = entries.reduce((s, e) => s + e.tokensUsed, 0);

        return {
          success: true,
          output: JSON.stringify({
            executionCount: entries.length,
            totalTokens,
            totalCost: Math.round(totalCost * 10000) / 10000,
            averages,
          }, null, 2),
        };
      }

      return {
        success: true,
        output: JSON.stringify({ entries }, null, 2),
        metadata: { entriesReturned: entries.length },
      };
    },
  };
}

// ===== Quality Gate =====

interface BudgetGateConfig {
  maxTokensPerExecution: number;
  maxCostPerExecution: number;
  maxDurationMs: number;
}

function createPerformanceBudgetGate(
  store: MetricsStore,
  config: BudgetGateConfig,
): QualityGate {
  return {
    name: 'performance-budget',
    description: 'Validates execution stayed within token, cost, and time budgets',
    async run(context: QualityContext): Promise<GateResult> {
      const startTime = Date.now();
      const issues: GateIssue[] = [];

      const latest = store.getLatest(1);
      if (latest.length === 0) {
        return {
          gate: 'performance-budget',
          passed: true,
          issues: [],
          duration: Date.now() - startTime,
        };
      }

      const entry = latest[0];

      if (entry.tokensUsed > config.maxTokensPerExecution) {
        issues.push({
          severity: 'warning',
          message: `Token usage (${entry.tokensUsed}) exceeds budget (${config.maxTokensPerExecution})`,
          autoFixable: false,
        });
      }

      if (entry.costUsd > config.maxCostPerExecution) {
        issues.push({
          severity: 'error',
          message: `Cost ($${entry.costUsd.toFixed(4)}) exceeds budget ($${config.maxCostPerExecution.toFixed(4)})`,
          autoFixable: false,
        });
      }

      if (entry.durationMs > config.maxDurationMs) {
        issues.push({
          severity: 'warning',
          message: `Duration (${entry.durationMs}ms) exceeds budget (${config.maxDurationMs}ms)`,
          autoFixable: false,
        });
      }

      return {
        gate: 'performance-budget',
        passed: issues.filter(i => i.severity === 'error').length === 0,
        issues,
        duration: Date.now() - startTime,
      };
    },
  };
}

// ===== Plugin Definition =====

export const MetricsDashboardPlugin: CortexPlugin = {
  name: 'cortexos-metrics-dashboard',
  version: '1.0.0',
  description: 'Real-time execution metrics, cost tracking, and performance budget gates',
  author: 'CortexOS',

  register(ctx: PluginContext): void {
    const config = ctx.getConfig('metricsDashboard') as Partial<BudgetGateConfig> | undefined;
    const store = new MetricsStore(1000);

    // Register tools
    ctx.registerTool(createSnapshotTool(store));
    ctx.registerTool(createHistoryTool(store));

    // Register gate
    ctx.registerGate(
      'performance-budget',
      createPerformanceBudgetGate(store, {
        maxTokensPerExecution: config?.maxTokensPerExecution ?? 100000,
        maxCostPerExecution: config?.maxCostPerExecution ?? 5.0,
        maxDurationMs: config?.maxDurationMs ?? 300000,
      }),
    );

    // Register middleware to capture metrics on each execution
    ctx.registerMiddleware('post-execute', (data: unknown) => {
      const execData = data as Record<string, unknown> | undefined;
      if (execData && typeof execData === 'object') {
        store.record({
          executionId: (execData.executionId as string) || 'unknown',
          timestamp: Date.now(),
          tokensUsed: (execData.tokensUsed as number) || 0,
          costUsd: (execData.costUsd as number) || 0,
          durationMs: (execData.durationMs as number) || 0,
          stagesCompleted: (execData.stagesCompleted as number) || 0,
          agentCount: (execData.agentCount as number) || 1,
        });
      }
      return data;
    });
  },
};

export { MetricsStore, type MetricEntry, type BudgetGateConfig };
