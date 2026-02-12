/**
 * Agent Process Pool
 * Dual-mode: child_process.fork() for true parallelism, or in-process fallback.
 * When maxWorkers > 1 and useChildProcess is true, forks worker processes.
 * Otherwise, runs agents in-process (single-threaded) for simplicity.
 */

import { fork, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { getLogger } from '../core/logger.js';
import type { AgentTask } from './types.js';
import type { AgentResult } from '../core/types.js';
import type { LLMProvider } from '../providers/types.js';
import type { Tool, ToolContext } from '../tools/types.js';
import type { ExecutePayload, WorkerResult } from './worker.js';
import { Agent } from './agent.js';
import { getRole } from './roles/index.js';

const logger = getLogger();

export interface PoolOptions {
  maxWorkers: number;
  workerScript: string;
  idleTimeout?: number;
  useChildProcess?: boolean;
  providerConfig?: {
    name: string;
    apiKey: string;
    model?: string;
  };
  systemPrompt?: string;
  // In-process mode deps
  provider?: LLMProvider;
  tools?: Tool[];
  toolContext?: ToolContext;
}

export interface PoolStats {
  totalWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  pendingTasks: number;
  completedTasks: number;
}

interface QueueItem {
  task: AgentTask;
  workingDir?: string;
  tools?: string[];
  resolve: (result: AgentResult) => void;
  reject: (error: Error) => void;
}

/**
 * Agent process pool — dual-mode execution
 */
export class AgentPool extends EventEmitter {
  private options: PoolOptions;
  private activeTasks = 0;
  private completedTasks = 0;
  private pendingQueue: QueueItem[] = [];
  private workers: ChildProcess[] = [];
  private isShutdown = false;

  constructor(options: PoolOptions) {
    super();
    this.options = {
      ...options,
      useChildProcess: options.useChildProcess ?? false,
      idleTimeout: options.idleTimeout ?? 30000,
    };
    logger.info(
      { maxWorkers: this.options.maxWorkers, mode: this.options.useChildProcess ? 'fork' : 'in-process' },
      'Agent pool initialized',
    );
  }

  /**
   * Submit a task for execution.
   * Optionally accepts workingDir (for worktree isolation) and tool names.
   */
  async submit(
    task: AgentTask,
    workingDir?: string,
    tools?: string[],
  ): Promise<AgentResult> {
    if (this.isShutdown) {
      throw new Error('Pool is shut down');
    }

    return new Promise((resolve, reject) => {
      this.pendingQueue.push({ task, workingDir, tools, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Submit multiple tasks for parallel execution
   */
  async submitBatch(tasks: AgentTask[]): Promise<AgentResult[]> {
    return Promise.all(tasks.map(task => this.submit(task)));
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    return {
      totalWorkers: this.options.maxWorkers,
      busyWorkers: this.activeTasks,
      idleWorkers: Math.max(0, this.options.maxWorkers - this.activeTasks),
      pendingTasks: this.pendingQueue.length,
      completedTasks: this.completedTasks,
    };
  }

  /**
   * Shutdown the pool, kill any child processes
   */
  async shutdown(): Promise<void> {
    this.isShutdown = true;

    // Reject pending
    for (const pending of this.pendingQueue) {
      pending.reject(new Error('Pool shutting down'));
    }
    this.pendingQueue = [];

    // Kill child processes
    for (const worker of this.workers) {
      try {
        worker.kill('SIGTERM');
      } catch {
        // Best effort
      }
    }
    this.workers = [];

    logger.info('Agent pool shut down');
  }

  /**
   * Process the pending queue
   */
  private processQueue(): void {
    while (this.pendingQueue.length > 0 && this.activeTasks < this.options.maxWorkers) {
      const item = this.pendingQueue.shift()!;
      this.activeTasks++;

      const executePromise = this.options.useChildProcess
        ? this.executeViaFork(item)
        : this.executeInProcess(item);

      executePromise
        .then(result => {
          this.activeTasks--;
          this.completedTasks++;
          this.emit('task:complete', { taskId: item.task.id, success: result.success });
          item.resolve(result);
          this.processQueue();
        })
        .catch(error => {
          this.activeTasks--;
          this.emit('task:error', { taskId: item.task.id, error: String(error) });
          item.reject(error instanceof Error ? error : new Error(String(error)));
          this.processQueue();
        });
    }
  }

  /**
   * Execute via child_process.fork() — true parallelism
   */
  private async executeViaFork(item: QueueItem): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      const workerPath = this.options.workerScript;

      const child = fork(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env },
      });

      this.workers.push(child);

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Worker timed out for task ${item.task.id}`));
      }, 120000); // 2 minute timeout

      child.on('message', (msg: WorkerResult) => {
        if (msg.type === 'result') {
          clearTimeout(timeout);
          this.removeWorker(child);
          resolve(msg.payload as AgentResult);
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          this.removeWorker(child);
          const errorPayload = msg.payload as { message: string };
          reject(new Error(errorPayload.message));
        } else if (msg.type === 'progress') {
          const progress = msg.payload as { progress: number; status: string };
          if (progress.status === 'ready') {
            // Worker is ready, send the task
            const payload: ExecutePayload = {
              task: item.task,
              providerConfig: this.options.providerConfig || {
                name: 'anthropic',
                apiKey: process.env.ANTHROPIC_API_KEY || '',
              },
              tools: item.tools || [],
              workingDir: item.workingDir || process.cwd(),
              systemPrompt: this.options.systemPrompt || '',
            };
            child.send({ type: 'execute', payload });
          }
          this.emit('task:progress', {
            taskId: item.task.id,
            progress: progress.progress,
            status: progress.status,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.removeWorker(child);
        reject(err);
      });

      child.on('exit', (code) => {
        clearTimeout(timeout);
        this.removeWorker(child);
        if (code !== 0) {
          reject(new Error(`Worker exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Execute in-process — same-thread fallback for development/testing.
   * Uses the provider and tools from pool options directly.
   */
  private async executeInProcess(item: QueueItem): Promise<AgentResult> {
    const provider = this.options.provider;
    const tools = this.options.tools || [];
    const toolContext = this.options.toolContext || {
      workingDir: item.workingDir || process.cwd(),
      executionId: item.task.id,
    };

    if (!provider) {
      throw new Error(
        `No LLM provider configured for in-process pool execution (task: ${item.task.id}). ` +
        'Ensure a provider is passed to AgentPool options.',
      );
    }

    const role = getRole(item.task.role);
    const allowedTools = tools.filter(t => role.defaultTools.includes(t.name));

    const agent = new Agent({
      role: item.task.role,
      provider,
      tools: allowedTools,
      toolContext: {
        ...toolContext,
        workingDir: item.workingDir || toolContext.workingDir,
      },
      systemPrompt: this.options.systemPrompt || role.systemPrompt,
      temperature: role.temperature,
    });

    return agent.execute(item.task);
  }

  private removeWorker(child: ChildProcess): void {
    const idx = this.workers.indexOf(child);
    if (idx !== -1) this.workers.splice(idx, 1);
  }
}
