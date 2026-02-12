/**
 * CLI Bootstrap
 * Creates and configures the Commander.js CLI application
 */

import { Command } from 'commander';
import { VERSION, NAME } from '../version.js';
import { createRunCommand } from './commands/run.js';
import { createInitCommand } from './commands/init.js';
import { createChatCommand } from './commands/chat.js';
import { createAgentsCommand } from './commands/agents.js';

export function createCLI(): Command {
  const program = new Command();

  program
    .name(NAME)
    .version(VERSION)
    .description('CortexOS — The Operating System for AI Agent Teams')
    .option('-v, --verbose', 'Enable verbose output')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--no-memory', 'Disable memory system')
    .option('--no-color', 'Disable colored output')
    .option('--budget <amount>', 'Set maximum budget for this run (in dollars)', parseFloat)
    .option('--model <model>', 'Override the default model')
    .option('--provider <provider>', 'Override the default provider');

  // Register commands
  program.addCommand(createRunCommand());
  program.addCommand(createInitCommand());
  program.addCommand(createChatCommand());
  program.addCommand(createAgentsCommand());

  // Default action: treat positional args as a prompt (like `cortexos "fix the auth bug"`)
  program
    .argument('[prompt...]', 'Task prompt (shortcut for `cortexos run`)')
    .action(async (promptParts: string[], options: Record<string, unknown>) => {
      if (promptParts.length > 0) {
        const prompt = promptParts.join(' ');
        // Delegate to run command
        const run = createRunCommand();
        await run.parseAsync(['node', 'cortexos', 'run', prompt, ...process.argv.slice(2)]);
      } else {
        program.help();
      }
    });

  return program;
}

export async function main(): Promise<void> {
  const cli = createCLI();

  try {
    await cli.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\n❌ ${error.message}\n`);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}
