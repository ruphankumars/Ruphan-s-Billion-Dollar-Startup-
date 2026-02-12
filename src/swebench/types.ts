/**
 * SWE-bench Types — Interfaces for real-world code validation.
 *
 * SWE-bench is a benchmark of real GitHub issues. CortexOS loads
 * problem instances, runs the engine, extracts patches, and evaluates
 * against the repository's test suite.
 */

// ===== Dataset Types =====

export interface SWEBenchInstance {
  /** Unique identifier, e.g. "django__django-16379" */
  instance_id: string;
  /** Repository name, e.g. "django/django" */
  repo: string;
  /** Git SHA to checkout before attempting the fix */
  base_commit: string;
  /** Bug report / issue description */
  problem_statement: string;
  /** Optional hints about the fix */
  hints_text: string;
  /** Unified diff of the test that should pass after the fix */
  test_patch: string;
  /** Gold patch for reference (not used during generation) */
  patch: string;
  /** JSON array string of test IDs that should go from fail→pass */
  FAIL_TO_PASS: string;
  /** JSON array string of test IDs that should remain passing */
  PASS_TO_PASS: string;
  /** Commit SHA for environment setup */
  environment_setup_commit: string;
  /** Version of the software */
  version: string;
}

// ===== Result Types =====

export interface SWEBenchResult {
  instance_id: string;
  model_name_or_path: string;
  /** The unified diff CortexOS produced */
  model_patch: string;
  success: boolean;
  tests_passed: number;
  tests_total: number;
  cost: number;
  duration: number;
  error?: string;
}

export interface SWEBenchReport {
  model: string;
  provider: string;
  dataset: string;
  timestamp: string;
  results: SWEBenchResult[];
  summary: SWEBenchSummary;
}

export interface SWEBenchSummary {
  total: number;
  resolved: number;
  resolutionRate: number;
  avgCost: number;
  avgDuration: number;
  totalCost: number;
}

// ===== Config Types =====

export interface SWEBenchConfig {
  /** Path to JSONL dataset file */
  dataset: string;
  /** Max instances to process */
  limit?: number;
  /** LLM provider to use */
  provider?: string;
  /** Specific model to use */
  model?: string;
  /** Per-instance timeout in milliseconds */
  timeout?: number;
  /** Where to write JSON report */
  outputPath?: string;
  /** Directory to cache cloned repos */
  repoCache?: string;
}
