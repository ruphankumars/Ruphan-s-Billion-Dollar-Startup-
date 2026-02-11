/**
 * Agent Worker — Child Process Entry Point
 * Phase 2: Used by the process pool for true parallelism.
 * Each worker receives a task via IPC, executes it, and returns results.
 *
 * MVP: This module defines the worker protocol but is not yet used.
 * The engine runs agents in-process via Promise.all for MVP.
 */

import type { AgentTask } from './types.js';
import type { AgentResult } from '../core/types.js';

export interface WorkerMessage {
  type: 'execute' | 'abort' | 'status';
  payload: unknown;
}

export interface ExecutePayload {
  task: AgentTask;
  providerConfig: {
    name: string;
    apiKey: string;
    model: string;
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
        process.send!({ type: 'result', payload: { success: false, response: 'Aborted' } });
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

async function handleExecute(payload: ExecutePayload): Promise<void> {
  try {
    // In Phase 2, this will:
    // 1. Initialize provider from config
    // 2. Initialize tools
    // 3. Create Agent instance
    // 4. Execute task
    // 5. Send result back via IPC

    // MVP placeholder — actual execution happens in-process
    process.send!({
      type: 'result',
      payload: {
        taskId: payload.task.id,
        success: true,
        response: 'Worker execution placeholder — Phase 2',
        filesChanged: [],
        tokensUsed: { input: 0, output: 0, total: 0 },
      } as AgentResult,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    process.send!({
      type: 'error',
      payload: { message: err.message },
    });
  }
}

// Auto-start if run as main module
if (process.argv[1] === import.meta.url?.replace('file://', '')) {
  main().catch(err => {
    console.error('Worker fatal error:', err);
    process.exit(1);
  });
}

export { main as startWorker };
