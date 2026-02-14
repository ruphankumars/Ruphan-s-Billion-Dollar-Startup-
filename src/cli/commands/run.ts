/**
 * `cortexos run "prompt"` — Main execution command
 * Takes a user prompt and runs it through the CortexEngine pipeline.
 */

import { Command } from 'commander';
import { resolve } from 'path';
import { CortexEngine } from '../../core/engine.js';
import { ConfigManager } from '../../core/config.js';
import { formatCost } from '../../utils/tokens.js';
import { formatDuration } from '../../utils/timer.js';

export function createRunCommand(): Command {
  const cmd = new Command('run');

  cmd
    .description('Execute a task with CortexOS agent swarm')
    .argument('<prompt>', 'The task to execute')
    .option('-d, --dir <directory>', 'Project directory', '.')
    .option('--budget <amount>', 'Maximum budget in dollars', parseFloat)
    .option('--model <model>', 'Override default model')
    .option('--provider <provider>', 'Override default provider')
    .option('--no-memory', 'Disable memory recall/store')
    .option('--no-verify', 'Skip quality verification')
    .option('--dry-run', 'Show plan without executing')
    .option('--json', 'Output results as JSON')
    .action(async (prompt: string, options: RunOptions) => {
      await executeRun(prompt, options);
    });

  return cmd;
}

interface RunOptions {
  dir: string;
  budget?: number;
  model?: string;
  provider?: string;
  memory?: boolean;
  verify?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

async function executeRun(prompt: string, options: RunOptions): Promise<void> {
  const projectDir = resolve(options.dir);

  // Load config
  const configManager = new ConfigManager(projectDir);
  const config = configManager.load() as any;

  // Apply CLI overrides
  if (options.budget) {
    config.budget = { ...config.budget, maxCostPerRun: options.budget };
  }
  if (options.model) {
    config.defaultModel = options.model;
  }
  if (options.provider) {
    config.defaultProvider = options.provider;
  }
  if (options.memory === false) {
    config.memory = { ...config.memory, enabled: false };
  }

  // Print header
  if (!options.json) {
    console.log();
    console.log(`🧠 CortexOS v${(await import('../../version.js')).VERSION}`);
    console.log();
  }

  // Create engine
  const engine = CortexEngine.create({ config, projectDir });
  const events = engine.getEventBus();

  // Subscribe to events for live output
  if (!options.json) {
    events.on('stage:start', (data) => {
      const stageNames: Record<string, string> = {
        recall: '📚 Recalling memories...',
        analyze: '🔍 Analyzing prompt...',
        enhance: '✨ Enhancing with context...',
        decompose: '🔧 Decomposing into subtasks...',
        plan: '📋 Creating execution plan...',
        execute: '⚡ Executing agent swarm...',
        verify: '✅ Verifying quality...',
        memorize: '💾 Storing learnings...',
      };
      const stage = (data as Record<string, unknown>).stage as string;
      console.log(stageNames[stage] || `  ${stage}...`);
    });

    events.on('plan:created', (plan) => {
      const p = plan as any;
      if (p.waves) {
        console.log();
        console.log(`  Plan: ${p.tasks?.length || 0} tasks across ${p.waves?.length || 0} waves`);
        for (const wave of (p.waves || [])) {
          const taskNames = wave.taskIds?.map((id: string) => {
            const task = p.tasks?.find((t: any) => t.id === id);
            return task ? `[${task.role}] ${task.title}` : id;
          });
          console.log(`    Wave ${wave.waveNumber}: ${taskNames?.join(' | ') || 'empty'}`);
        }
        console.log();
      }
    });

    events.on('agent:start', (data) => {
      const d = data as any;
      console.log(`  🤖 [${d.role}] Starting task ${d.taskId}...`);
    });

    events.on('agent:complete', (data) => {
      const d = data as any;
      const status = d.success ? '✓' : '✗';
      const dur = typeof d.duration === 'number' ? ` (${formatDuration(d.duration)})` : '';
      console.log(`  ${status} [${d.role}] ${d.success ? 'done' : 'failed'}${dur}`);
    });
  }

  // Execute
  try {
    const result = await engine.execute(prompt);

    // Output results
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log();
      console.log('─'.repeat(60));
      console.log();

      if (result.success) {
        console.log('✅ Task completed successfully');
      } else {
        console.log('❌ Task completed with issues');
      }

      // Quality
      if (result.quality) {
        const score = result.quality.score;
        console.log(`Quality: ${score}/100 ${result.quality.passed ? '(passed)' : '(failed)'}`);
      }

      // Files changed
      if (result.filesChanged.length > 0) {
        console.log(`Files: ${result.filesChanged.length} changed`);
        for (const file of result.filesChanged.slice(0, 10)) {
          console.log(`  ${file.type === 'create' ? '+' : file.type === 'delete' ? '-' : '~'} ${file.path}`);
        }
        if (result.filesChanged.length > 10) {
          console.log(`  ... and ${result.filesChanged.length - 10} more`);
        }
      }

      // Memory
      if (result.memoriesRecalled > 0 || result.memoriesStored > 0) {
        console.log(`Memory: ${result.memoriesRecalled} recalled, ${result.memoriesStored} stored`);
      }

      // Cost
      console.log(`Cost: ${formatCost(result.cost.totalCost)} (${result.cost.totalTokens.toLocaleString()} tokens)`);
      console.log(`Time: ${formatDuration(result.duration)}`);
      console.log();
    }

    // Shutdown
    await engine.shutdown();

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    await engine.shutdown();
    throw error;
  }
}
