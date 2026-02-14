/**
 * `cortexos chat` — Interactive REPL for chatting with CortexOS agents.
 * Maintains conversation history, supports /clear, /cost, /exit.
 */

import { Command } from 'commander';
import * as readline from 'readline';
import { resolve } from 'path';
import { ConfigManager } from '../../core/config.js';
import { ProviderRegistry } from '../../providers/registry.js';
import { CostTracker } from '../../cost/tracker.js';
import { formatCost } from '../../utils/tokens.js';
import { nanoid } from 'nanoid';
import type { LLMMessage } from '../../providers/types.js';
import type { CortexConfig } from '../../core/types.js';

export function createChatCommand(): Command {
  const cmd = new Command('chat');

  cmd
    .description('Start an interactive chat session with CortexOS')
    .option('-d, --dir <directory>', 'Project directory', '.')
    .option('--model <model>', 'Override default model')
    .option('--provider <provider>', 'Override default provider')
    .action(async (options: ChatOptions) => {
      await startChat(options);
    });

  return cmd;
}

interface ChatOptions {
  dir: string;
  model?: string;
  provider?: string;
}

async function startChat(options: ChatOptions): Promise<void> {
  // Verify TTY
  if (!process.stdin.isTTY) {
    console.error('Error: cortexos chat requires an interactive terminal (TTY)');
    process.exit(1);
  }

  const projectDir = resolve(options.dir);
  const configManager = new ConfigManager(projectDir);
  const config = configManager.load() as CortexConfig;

  // Apply CLI overrides
  if (options.provider) {
    config.providers = { ...config.providers, default: options.provider as CortexConfig['providers']['default'] };
  }

  // Create provider
  const registry = await ProviderRegistry.create(config);
  const providerName = options.provider || config.providers?.default || 'anthropic';
  const provider = registry.get(providerName);

  if (!provider) {
    console.error(`Error: Provider "${providerName}" not available. Check your API key.`);
    process.exit(1);
  }

  const costTracker = new CostTracker(`chat-${nanoid(6)}`);
  const messages: LLMMessage[] = [];

  // System prompt for chat mode
  messages.push({
    role: 'system',
    content: `You are CortexOS, an AI assistant specialized in software engineering. You help with code, architecture, debugging, and development questions. Be concise, precise, and helpful. The current project directory is: ${projectDir}`,
  });

  // Print header
  console.log();
  console.log('🧠 CortexOS Interactive Chat');
  console.log(`   Provider: ${providerName} | Model: ${options.model || provider.defaultModel}`);
  console.log('   Commands: /clear /cost /exit');
  console.log('─'.repeat(50));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Handle slash commands
    if (input.startsWith('/')) {
      const handled = handleSlashCommand(input, messages, costTracker);
      if (handled === 'exit') {
        rl.close();
        return;
      }
      rl.prompt();
      return;
    }

    // Add user message
    messages.push({ role: 'user', content: input });

    try {
      const response = await provider.complete({
        messages,
        model: options.model,
        maxTokens: 4096,
        temperature: 0.7,
      });

      // Track cost
      costTracker.record({
        model: response.model,
        provider: providerName,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      });

      // Add assistant response to history
      messages.push({ role: 'assistant', content: response.content });

      // Display response
      console.log();
      console.log(response.content);
      console.log();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ Error: ${message}\n`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    const summary = costTracker.getSummary(Infinity);
    console.log();
    console.log('─'.repeat(50));
    console.log(`Session cost: ${formatCost(summary.totalCost)} (${summary.totalTokens.toLocaleString()} tokens)`);
    console.log('Goodbye!');
    console.log();
    process.exit(0);
  });
}

function handleSlashCommand(
  input: string,
  messages: LLMMessage[],
  costTracker: CostTracker,
): string | void {
  const command = input.toLowerCase().split(/\s+/)[0];

  switch (command) {
    case '/exit':
    case '/quit':
    case '/q':
      return 'exit';

    case '/clear':
      // Keep system prompt, clear everything else
      const systemMsg = messages[0];
      messages.length = 0;
      messages.push(systemMsg);
      console.log('\n🗑️  Conversation cleared.\n');
      return;

    case '/cost': {
      const summary = costTracker.getSummary(Infinity);
      console.log(`\n Session: ${formatCost(summary.totalCost)} (${summary.totalTokens.toLocaleString()} tokens)\n`);
      return;
    }

    case '/help':
      console.log('\nCommands:');
      console.log('  /clear  — Clear conversation history');
      console.log('  /cost   — Show session cost');
      console.log('  /exit   — Exit chat');
      console.log('  /help   — Show this help\n');
      return;

    default:
      console.log(`\nUnknown command: ${command}. Type /help for available commands.\n`);
      return;
  }
}
