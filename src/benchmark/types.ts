/**
 * Benchmark Types — Definitions for the self-validation harness.
 *
 * Provides types for benchmark tasks, results, reports, and configuration.
 * Used by BenchmarkRunner, BenchmarkReporter, and the CLI command.
 */

export type BenchmarkCategory = 'file-ops' | 'code-gen' | 'debugging' | 'multi-step';
export type BenchmarkDifficulty = 'easy' | 'medium' | 'hard';

export interface BenchmarkTask {
  /** Unique task identifier */
  id: string;
  /** Human-readable task name */
  name: string;
  /** Task category for grouping */
  category: BenchmarkCategory;
  /** The prompt to send to CortexOS */
  prompt: string;
  /** Description of what constitutes a successful outcome */
  expectedOutcome: string;
  /** Maximum allowed time in milliseconds */
  maxTimeMs: number;
  /** Task difficulty level */
  difficulty: BenchmarkDifficulty;
  /** Files to create in the temp workspace before running */
  setupFiles?: Record<string, string>;
  /** Validation: files that should exist after execution */
  expectedFiles?: string[];
  /** Validation: patterns that should appear in output files */
  expectedPatterns?: Record<string, string>;
}

export interface BenchmarkResult {
  /** Task that was benchmarked */
  taskId: string;
  /** Whether the task passed validation */
  success: boolean;
  /** Execution time in milliseconds */
  timeMs: number;
  /** Token usage during execution */
  tokensUsed: { input: number; output: number };
  /** Estimated cost in dollars */
  cost: number;
  /** Quality score 0-1 based on validation checks */
  qualityScore: number;
  /** Error message if the task failed */
  error?: string;
}

export interface BenchmarkCategoryResult {
  /** Number of tasks passed */
  passed: number;
  /** Total number of tasks in category */
  total: number;
  /** Average time across tasks in ms */
  avgTimeMs: number;
}

export interface BenchmarkSummary {
  totalTasks: number;
  passed: number;
  failed: number;
  avgTimeMs: number;
  totalCost: number;
  avgQuality: number;
  successRate: number;
}

export interface BenchmarkReport {
  /** Provider used for the benchmark */
  provider: string;
  /** Model used for the benchmark */
  model: string;
  /** ISO timestamp of when the benchmark ran */
  timestamp: string;
  /** Per-task results */
  results: BenchmarkResult[];
  /** Aggregate summary */
  summary: BenchmarkSummary;
  /** Results broken down by category */
  categories: Record<string, BenchmarkCategoryResult>;
}

export interface BenchmarkConfig {
  /** Provider to benchmark (default: config default) */
  provider?: string;
  /** Specific model to use */
  model?: string;
  /** Run only tasks from this category */
  category?: BenchmarkCategory;
  /** Write JSON report to this path */
  outputPath?: string;
  /** Per-task timeout in milliseconds */
  timeout?: number;
}
