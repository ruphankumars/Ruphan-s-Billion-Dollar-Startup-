/**
 * `cortexos benchmark` — Self-validation benchmark command.
 *
 * Runs predefined coding tasks against CortexOS and reports
 * success rates, timing, cost, and quality metrics.
 */

import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { BenchmarkRunner, type BenchmarkEngineInterface } from '../../benchmark/runner.js';
import { BenchmarkReporter } from '../../benchmark/reporter.js';
import { getCategories } from '../../benchmark/tasks.js';
import type { BenchmarkCategory } from '../../benchmark/types.js';

export function createBenchmarkCommand(): Command {
  const cmd = new Command('benchmark');

  cmd
    .description('Run self-validation benchmarks against CortexOS')
    .option('--provider <name>', 'Provider to benchmark')
    .option('--model <model>', 'Specific model to use')
    .option('--category <category>', 'Run only one category: ' + getCategories().join(', '))
    .option('--output <path>', 'Write JSON report to file')
    .option('--timeout <ms>', 'Per-task timeout in milliseconds', parseInt)
    .option('--json', 'Output report as JSON to stdout')
    .action(async (options: BenchmarkOptions) => {
      await executeBenchmark(options);
    });

  return cmd;
}

interface BenchmarkOptions {
  provider?: string;
  model?: string;
  category?: string;
  output?: string;
  timeout?: number;
  json?: boolean;
}

async function executeBenchmark(options: BenchmarkOptions): Promise<void> {
  const reporter = new BenchmarkReporter();

  console.log('\n  CortexOS Benchmark Runner');
  console.log('  ========================\n');

  const runner = new BenchmarkRunner({
    provider: options.provider,
    model: options.model,
    category: options.category as BenchmarkCategory | undefined,
    timeout: options.timeout,
  });

  console.log(`  Running ${runner.taskCount} benchmark tasks...`);
  if (options.provider) console.log(`  Provider: ${options.provider}`);
  if (options.model) console.log(`  Model: ${options.model}`);
  if (options.category) console.log(`  Category: ${options.category}`);
  console.log('');

  // Create a minimal engine adapter
  // In real usage, this would use CortexEngine. For now, it provides the interface.
  const engine: BenchmarkEngineInterface = {
    execute: async (prompt: string) => {
      // Placeholder: in production, this connects to CortexEngine
      // Users should provide their own engine via programmatic API
      return {
        success: false,
        error: 'Benchmark engine not configured. Use the programmatic API with a real CortexEngine instance.',
        tokenUsage: { input: 0, output: 0 },
        costUsd: 0,
      };
    },
  };

  const report = await runner.run(engine);

  // Output results
  if (options.json) {
    console.log(reporter.formatJSON(report));
  } else {
    console.log(reporter.formatTable(report));
  }

  // Write to file if specified
  if (options.output) {
    writeFileSync(options.output, reporter.formatJSON(report), 'utf-8');
    console.log(`  Report saved to: ${options.output}\n`);
  }

  // Exit with appropriate code
  const exitCode = report.summary.successRate >= 0.5 ? 0 : 1;
  process.exitCode = exitCode;
}
