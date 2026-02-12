/**
 * `cortexos status` — Show project status, config, and system health.
 */

import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { ConfigManager } from '../../core/config.js';
import { VERSION } from '../../version.js';
import type { CortexConfig } from '../../core/types.js';

export function createStatusCommand(): Command {
  const cmd = new Command('status');

  cmd
    .description('Show CortexOS project status and configuration')
    .option('-d, --dir <directory>', 'Project directory', '.')
    .option('--json', 'Output as JSON')
    .action((options: { dir: string; json?: boolean }) => {
      showStatus(options);
    });

  return cmd;
}

function showStatus(options: { dir: string; json?: boolean }): void {
  const projectDir = resolve(options.dir);
  const configManager = new ConfigManager(projectDir);
  const cortexDir = join(projectDir, '.cortexos');
  const hasInit = existsSync(cortexDir);

  // Collect status info
  const status = {
    version: VERSION,
    projectDir,
    initialized: hasInit,
    config: null as CortexConfig | null,
    providers: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
    },
    memory: {
      enabled: false,
      dbExists: false,
      dbSize: 0,
    },
    git: {
      isRepo: existsSync(join(projectDir, '.git')),
    },
  };

  // Load config if initialized
  if (hasInit) {
    try {
      status.config = configManager.load() as CortexConfig;
    } catch {
      // Config may not be parseable
    }
  }

  // Check memory database
  const memDbPath = join(cortexDir, 'memory', 'vectors.db');
  if (existsSync(memDbPath)) {
    status.memory.dbExists = true;
    try {
      const stat = statSync(memDbPath);
      status.memory.dbSize = stat.size;
    } catch {
      // Ignore
    }
  }
  status.memory.enabled = status.config?.memory?.enabled !== false;

  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  // Pretty output
  console.log();
  console.log(`  CortexOS v${VERSION}`);
  console.log('  ' + '\u2500'.repeat(40));
  console.log();

  // Project
  console.log(`  Project:     ${projectDir}`);
  console.log(`  Initialized: ${status.initialized ? 'Yes' : 'No (run `cortexos init`)'}`);
  console.log();

  // Providers
  console.log('  Providers:');
  console.log(`    Anthropic: ${status.providers.anthropic ? 'Configured' : 'Not configured'}`);
  console.log(`    OpenAI:    ${status.providers.openai ? 'Configured' : 'Not configured'}`);
  console.log();

  // Memory
  console.log('  Memory:');
  console.log(`    Enabled:  ${status.memory.enabled ? 'Yes' : 'No'}`);
  if (status.memory.dbExists) {
    const sizeKB = Math.round(status.memory.dbSize / 1024);
    console.log(`    Database: ${sizeKB} KB`);
  } else {
    console.log('    Database: Not created yet');
  }
  console.log();

  // Config highlights
  if (status.config) {
    const c = status.config;
    console.log('  Configuration:');
    console.log(`    Provider:    ${c.providers?.default || 'anthropic'}`);
    console.log(`    Max Agents:  ${c.agents?.maxParallel || 4}`);
    console.log(`    Budget/Run:  $${c.cost?.budgetPerRun || 1.0}`);
    console.log(`    Gates:       ${(c.quality?.gates || ['syntax', 'lint']).join(', ')}`);
    console.log();
  }

  // Git
  console.log(`  Git: ${status.git.isRepo ? 'Yes' : 'No'}`);
  console.log();
}
