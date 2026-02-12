/**
 * `cortexos swebench` — SWE-bench real-world validation.
 *
 * Runs CortexOS against SWE-bench problem instances for
 * real-world code validation and reports resolution metrics.
 */

import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { SWEBenchAdapter } from '../../swebench/adapter.js';
import type { SWEBenchConfig } from '../../swebench/types.js';

export function createSWEBenchCommand(): Command {
  const cmd = new Command('swebench');

  cmd
    .description('Run CortexOS against SWE-bench for real-world validation')
    .requiredOption('--dataset <path>', 'Path to SWE-bench JSONL dataset')
    .option('--limit <n>', 'Maximum instances to process', parseInt)
    .option('--provider <name>', 'LLM provider to use')
    .option('--model <model>', 'Specific model to use')
    .option('--output <path>', 'Write JSON report to file')
    .option('--timeout <ms>', 'Per-instance timeout in milliseconds', parseInt, 300000)
    .option('--repo-cache <dir>', 'Directory for caching cloned repos')
    .option('--json', 'Output results as JSON to stdout')
    .action(async (options: SWEBenchCommandOptions) => {
      await executeSWEBench(options);
    });

  return cmd;
}

interface SWEBenchCommandOptions {
  dataset: string;
  limit?: number;
  provider?: string;
  model?: string;
  output?: string;
  timeout: number;
  repoCache?: string;
  json?: boolean;
}

async function executeSWEBench(options: SWEBenchCommandOptions): Promise<void> {
  console.log('\n  CortexOS SWE-bench Runner');
  console.log('  ========================\n');

  const config: SWEBenchConfig = {
    dataset: options.dataset,
    limit: options.limit,
    provider: options.provider,
    model: options.model,
    timeout: options.timeout,
    repoCache: options.repoCache,
  };

  console.log(`  Dataset: ${options.dataset}`);
  if (options.limit) console.log(`  Limit: ${options.limit} instances`);
  if (options.provider) console.log(`  Provider: ${options.provider}`);
  if (options.model) console.log(`  Model: ${options.model}`);
  console.log(`  Timeout: ${options.timeout}ms per instance`);
  console.log('');

  const adapter = new SWEBenchAdapter(config);

  try {
    const report = await adapter.run();

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      // Display summary
      console.log('  Results');
      console.log('  -------\n');

      for (const result of report.results) {
        const status = result.success ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
        const duration = (result.duration / 1000).toFixed(1) + 's';
        console.log(`  [${status}] ${result.instance_id} (${duration}, $${result.cost.toFixed(4)})`);
        if (result.error) {
          console.log(`         Error: ${result.error.slice(0, 100)}`);
        }
      }

      console.log('\n  Summary');
      console.log('  -------\n');
      console.log(`  Resolved: ${report.summary.resolved}/${report.summary.total} (${(report.summary.resolutionRate * 100).toFixed(1)}%)`);
      console.log(`  Avg Duration: ${(report.summary.avgDuration / 1000).toFixed(1)}s`);
      console.log(`  Avg Cost: $${report.summary.avgCost.toFixed(4)}`);
      console.log(`  Total Cost: $${report.summary.totalCost.toFixed(4)}`);
      console.log('');
    }

    // Write to file if specified
    if (options.output) {
      writeFileSync(options.output, JSON.stringify(report, null, 2), 'utf-8');
      console.log(`  Report saved to: ${options.output}\n`);
    }

    // Exit code based on resolution rate
    process.exitCode = report.summary.resolutionRate >= 0.1 ? 0 : 1;
  } catch (error) {
    console.error(`\n  Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
