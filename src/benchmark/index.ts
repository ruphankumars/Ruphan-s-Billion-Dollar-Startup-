/**
 * Benchmark module — Self-validation harness for CortexOS.
 */

export { BenchmarkRunner, type BenchmarkEngineInterface } from './runner.js';
export { BenchmarkReporter } from './reporter.js';
export { BENCHMARK_TASKS, getTasksByCategory, getCategories } from './tasks.js';
export type {
  BenchmarkTask,
  BenchmarkResult,
  BenchmarkReport,
  BenchmarkConfig,
  BenchmarkSummary,
  BenchmarkCategoryResult,
  BenchmarkCategory,
  BenchmarkDifficulty,
} from './types.js';
