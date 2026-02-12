/**
 * Agent Worker — Child Process Entry Point
 * Receives a task via IPC, initializes provider + tools, executes Agent, returns results.
 * When run as a child process (process.send exists), auto-starts the worker loop.
 */

import type { AgentTask } from './types.js';
import type { AgentResult } from '../core/types.js';
import type { LLMProvider } from '../providers/types.js';
import type { Tool, ToolContext } from '../tools/types.js';
import { Agent } from './agent.js';
import { getRole } from './roles/index.js';

export interface WorkerMessage {
  type: 'execute' | 'abort' | 'status';
  payload: unknown;
}

export interface ExecutePayload {
  task: AgentTask;
  providerConfig: {
    name: string;
    apiKey: string;
    model?: string;
  };
  tools: string[];
  workingDir: string;
  systemPrompt: string;
}

export interface WorkerResult {
  type: 'result' | 'error' | 'progress';
  payload: AgentResult | { message: string } | { progress: number; status: string };
}

/**
 * Create a provider instance from config.
 * Worker creates providers directly (no registry) to avoid circular deps.
 */
async function createProviderFromConfig(config: ExecutePayload['providerConfig']): Promise<LLMProvider> {
  switch (config.name) {
    case 'anthropic': {
      const { AnthropicProvider } = await import('../providers/anthropic.js');
      return new AnthropicProvider({ apiKey: config.apiKey, defaultModel: config.model });
    }
    case 'openai': {
      const { OpenAIProvider } = await import('../providers/openai.js');
      return new OpenAIProvider({ apiKey: config.apiKey, defaultModel: config.model });
    }
    default:
      throw new Error(`Unknown provider: ${config.name}`);
  }
}

/**
 * Create tool instances from name list.
 */
async function createToolsFromNames(names: string[]): Promise<Tool[]> {
  const { ToolRegistry } = await import('../tools/registry.js');
  const registry = ToolRegistry.createDefault();
  const tools: Tool[] = [];

  for (const name of names) {
    if (registry.has(name)) {
      tools.push(registry.get(name));
    }
  }

  return tools;
}

/**
 * Handle an execute message — the core worker logic.
 */
async function handleExecute(payload: ExecutePayload): Promise<void> {
  try {
    // 1. Create provider
    const provider = await createProviderFromConfig(payload.providerConfig);

    // 2. Create tools
    const tools = await createToolsFromNames(payload.tools);

    // 3. Build tool context
    const toolContext: ToolContext = {
      workingDir: payload.workingDir,
      executionId: payload.task.id,
    };

    // 4. Get role config for the task
    const role = getRole(payload.task.role);

    // 5. Create and execute agent
    const agent = new Agent({
      role: payload.task.role,
      provider,
      tools,
      toolContext,
      systemPrompt: payload.systemPrompt || role.systemPrompt,
      model: payload.providerConfig.model,
      temperature: role.temperature,
    });

    const result = await agent.execute(payload.task);

    // 6. Send result back
    process.send!({
      type: 'result',
      payload: result,
    } as WorkerResult);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    process.send!({
      type: 'error',
      payload: { message: err.message },
    } as WorkerResult);
  }
}

/**
 * Worker entry point — called when this file is run as a child process
 */
async function main(): Promise<void> {
  if (!process.send) {
    console.error('Worker must be run as a child process');
    process.exit(1);
  }

  process.on('message', async (message: WorkerMessage) => {
    switch (message.type) {
      case 'execute':
        await handleExecute(message.payload as ExecutePayload);
        break;

      case 'abort':
        process.send!({ type: 'result', payload: {
          taskId: 'aborted',
          success: false,
          response: 'Aborted',
        } as AgentResult });
        process.exit(0);
        break;

      case 'status':
        process.send!({ type: 'progress', payload: { progress: 0, status: 'idle' } });
        break;
    }
  });

  // Signal ready
  process.send({ type: 'progress', payload: { progress: 0, status: 'ready' } });
}

// Auto-start if run as a child process (process.send is set by fork())
if (process.send) {
  main().catch(err => {
    console.error('Worker fatal error:', err);
    process.exit(1);
  });
}

export { main as startWorker };
