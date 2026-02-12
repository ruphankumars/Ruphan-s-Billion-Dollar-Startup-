/**
 * `cortexos memory` — Memory system introspection.
 * `memory stats`  — show memory statistics
 * `memory search` — search memories
 * `memory clear`  — clear all memories (with confirmation)
 */

import { Command } from 'commander';
import { resolve, join } from 'path';
import { ConfigManager } from '../../core/config.js';
import { CortexMemoryManager } from '../../memory/manager.js';
import type { MemoryConfig, MemoryType } from '../../memory/types.js';
import type { CortexConfig } from '../../core/types.js';

export function createMemoryCommand(): Command {
  const cmd = new Command('memory');

  cmd.description('Inspect and manage the CortexOS memory system');

  // memory stats
  cmd
    .command('stats')
    .description('Show memory system statistics')
    .option('-d, --dir <directory>', 'Project directory', '.')
    .option('--json', 'Output as JSON')
    .action(async (options: { dir: string; json?: boolean }) => {
      await showStats(options);
    });

  // memory search
  cmd
    .command('search <query>')
    .description('Search memories by text')
    .option('-d, --dir <directory>', 'Project directory', '.')
    .option('-n, --limit <count>', 'Max results', '5')
    .option('-t, --type <type>', 'Filter by memory type')
    .action(async (query: string, options: { dir: string; limit: string; type?: string }) => {
      await searchMemories(query, options);
    });

  // memory clear
  cmd
    .command('clear')
    .description('Clear all memories (destructive)')
    .option('-d, --dir <directory>', 'Project directory', '.')
    .option('--force', 'Skip confirmation')
    .action(async (options: { dir: string; force?: boolean }) => {
      await clearMemories(options);
    });

  return cmd;
}

function createMemoryManager(dir: string): { manager: CortexMemoryManager; config: CortexConfig } | null {
  const projectDir = resolve(dir);
  const configManager = new ConfigManager(projectDir);

  let config: CortexConfig;
  try {
    config = configManager.load() as CortexConfig;
  } catch {
    console.error('Error: Could not load CortexOS config. Run `cortexos init` first.');
    return null;
  }

  const memConfig: MemoryConfig = {
    enabled: true,
    globalDir: config.globalDir || '~/.cortexos',
    projectDir,
    maxMemories: 10000,
    embeddingModel: 'local-tfidf',
    decayEnabled: true,
    decayHalfLifeDays: 30,
    minImportanceThreshold: 0.1,
    consolidationInterval: 24,
  };

  return { manager: CortexMemoryManager.create(memConfig), config };
}

async function showStats(options: { dir: string; json?: boolean }): Promise<void> {
  const ctx = createMemoryManager(options.dir);
  if (!ctx) return;

  try {
    const stats = await ctx.manager.getStats();

    if (options.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log();
      console.log('  Memory Statistics');
      console.log('  ' + '\u2500'.repeat(30));
      console.log();
      console.log(`  Total Memories: ${stats.totalMemories}`);
      console.log();
      console.log('  By Type:');
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`    ${type}: ${count}`);
      }
      console.log();
      console.log(`  Avg Importance: ${stats.averageImportance.toFixed(2)}`);
      if (stats.oldestMemory) {
        console.log(`  Oldest: ${stats.oldestMemory.toISOString()}`);
      }
      if (stats.newestMemory) {
        console.log(`  Newest: ${stats.newestMemory.toISOString()}`);
      }
      console.log();
    }
  } finally {
    await ctx.manager.close();
  }
}

async function searchMemories(
  query: string,
  options: { dir: string; limit: string; type?: string },
): Promise<void> {
  const ctx = createMemoryManager(options.dir);
  if (!ctx) return;

  const limit = parseInt(options.limit, 10) || 5;

  try {
    const results = await ctx.manager.recall({
      text: query,
      type: options.type as MemoryType | undefined,
      maxResults: limit,
      includeDecayed: true,
    });

    if (results.length === 0) {
      console.log('\n  No memories found.\n');
      return;
    }

    console.log(`\n  Found ${results.length} memories:\n`);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const score = (r.finalScore * 100).toFixed(0);
      console.log(`  ${i + 1}. [${r.entry.type}] (${score}% match)`);
      console.log(`     ${r.entry.content.substring(0, 120)}`);
      if (r.entry.metadata.tags.length > 0) {
        console.log(`     Tags: ${r.entry.metadata.tags.join(', ')}`);
      }
      console.log();
    }
  } finally {
    await ctx.manager.close();
  }
}

async function clearMemories(options: { dir: string; force?: boolean }): Promise<void> {
  if (!options.force) {
    console.log('\n  This will permanently delete all memories.');
    console.log('  Use --force to confirm.\n');
    return;
  }

  const ctx = createMemoryManager(options.dir);
  if (!ctx) return;

  try {
    const count = await ctx.manager.clearAll();
    console.log(`\n  Cleared ${count} memories.\n`);
  } finally {
    await ctx.manager.close();
  }
}
