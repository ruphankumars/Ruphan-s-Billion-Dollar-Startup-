/**
 * Benchmark Runner — Executes benchmark tasks and captures metrics.
 *
 * Creates isolated temp directories for each task, runs CortexOS
 * against the task prompt, validates results, and aggregates metrics
 * into a BenchmarkReport.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  BenchmarkConfig,
  BenchmarkTask,
  BenchmarkResult,
  BenchmarkReport,
  BenchmarkSummary,
  BenchmarkCategoryResult,
} from './types.js';
import { BENCHMARK_TASKS } from './tasks.js';
import type { CortexConfig } from '../core/types.js';

export interface BenchmarkEngineInterface {
  execute(prompt: string): Promise<{
    success: boolean;
    error?: string;
    tokenUsage?: { input: number; output: number };
    costUsd?: number;
  }>;
}

export class BenchmarkRunner {
  private config: BenchmarkConfig;
  private tasks: BenchmarkTask[];

  constructor(config: BenchmarkConfig = {}) {
    this.config = {
      timeout: 120000,
      ...config,
    };

    // Filter tasks by category if specified
    this.tasks = config.category
      ? BENCHMARK_TASKS.filter(t => t.category === config.category)
      : [...BENCHMARK_TASKS];
  }

  /** Run all selected benchmark tasks and return a report */
  async run(engine: BenchmarkEngineInterface): Promise<BenchmarkReport> {
    const results: BenchmarkResult[] = [];

    for (const task of this.tasks) {
      const result = await this.runTask(task, engine);
      results.push(result);
    }

    const summary = this.computeSummary(results);
    const categories = this.computeCategories(results);

    return {
      provider: this.config.provider || 'default',
      model: this.config.model || 'default',
      timestamp: new Date().toISOString(),
      results,
      summary,
      categories,
    };
  }

  /** Run a single benchmark task */
  private async runTask(
    task: BenchmarkTask,
    engine: BenchmarkEngineInterface,
  ): Promise<BenchmarkResult> {
    const taskDir = join(tmpdir(), `cortex-bench-${task.id}-${Date.now()}`);

    try {
      // Setup workspace
      mkdirSync(taskDir, { recursive: true });
      if (task.setupFiles) {
        for (const [filePath, content] of Object.entries(task.setupFiles)) {
          const fullPath = join(taskDir, filePath);
          const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
          mkdirSync(dir, { recursive: true });
          writeFileSync(fullPath, content, 'utf-8');
        }
      }

      // Run the task with timeout
      const startTime = Date.now();
      const timeoutMs = Math.min(task.maxTimeMs, this.config.timeout || 120000);

      let result: Awaited<ReturnType<BenchmarkEngineInterface['execute']>>;
      try {
        result = await Promise.race([
          engine.execute(task.prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Task timeout')), timeoutMs),
          ),
        ]);
      } catch (error) {
        const elapsed = Date.now() - startTime;
        return {
          taskId: task.id,
          success: false,
          timeMs: elapsed,
          tokensUsed: { input: 0, output: 0 },
          cost: 0,
          qualityScore: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const elapsed = Date.now() - startTime;

      // Validate results
      const qualityScore = this.validateTask(task, taskDir);

      return {
        taskId: task.id,
        success: result.success && qualityScore > 0,
        timeMs: elapsed,
        tokensUsed: result.tokenUsage || { input: 0, output: 0 },
        cost: result.costUsd || 0,
        qualityScore,
        error: result.error,
      };
    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        timeMs: 0,
        tokensUsed: { input: 0, output: 0 },
        cost: 0,
        qualityScore: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Cleanup
      try {
        rmSync(taskDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /** Validate a completed task and return a quality score 0-1 */
  private validateTask(task: BenchmarkTask, taskDir: string): number {
    let checks = 0;
    let passed = 0;

    // Check expected files exist
    if (task.expectedFiles) {
      for (const file of task.expectedFiles) {
        checks++;
        if (existsSync(join(taskDir, file))) {
          passed++;
        }
      }
    }

    // Check expected patterns in files
    if (task.expectedPatterns) {
      for (const [file, pattern] of Object.entries(task.expectedPatterns)) {
        checks++;
        const filePath = join(taskDir, file);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8');
          if (new RegExp(pattern).test(content)) {
            passed++;
          }
        }
      }
    }

    // If no validation criteria, give partial credit for execution
    if (checks === 0) return 0.5;

    return passed / checks;
  }

  /** Compute aggregate summary from results */
  private computeSummary(results: BenchmarkResult[]): BenchmarkSummary {
    const passed = results.filter(r => r.success).length;
    const totalTime = results.reduce((s, r) => s + r.timeMs, 0);
    const totalCost = results.reduce((s, r) => s + r.cost, 0);
    const totalQuality = results.reduce((s, r) => s + r.qualityScore, 0);

    return {
      totalTasks: results.length,
      passed,
      failed: results.length - passed,
      avgTimeMs: results.length > 0 ? Math.round(totalTime / results.length) : 0,
      totalCost: Math.round(totalCost * 10000) / 10000,
      avgQuality: results.length > 0 ? Math.round((totalQuality / results.length) * 100) / 100 : 0,
      successRate: results.length > 0 ? Math.round((passed / results.length) * 100) / 100 : 0,
    };
  }

  /** Compute per-category breakdowns */
  private computeCategories(results: BenchmarkResult[]): Record<string, BenchmarkCategoryResult> {
    const categories: Record<string, BenchmarkCategoryResult> = {};

    // Group results by task category
    const taskMap = new Map(BENCHMARK_TASKS.map(t => [t.id, t.category]));

    const grouped = new Map<string, BenchmarkResult[]>();
    for (const result of results) {
      const category = taskMap.get(result.taskId) || 'unknown';
      const existing = grouped.get(category) || [];
      existing.push(result);
      grouped.set(category, existing);
    }

    for (const [category, categoryResults] of grouped) {
      const passed = categoryResults.filter(r => r.success).length;
      const totalTime = categoryResults.reduce((s, r) => s + r.timeMs, 0);

      categories[category] = {
        passed,
        total: categoryResults.length,
        avgTimeMs: categoryResults.length > 0
          ? Math.round(totalTime / categoryResults.length)
          : 0,
      };
    }

    return categories;
  }

  /** Get the number of tasks that will be run */
  get taskCount(): number {
    return this.tasks.length;
  }
}
