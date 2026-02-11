/**
 * Agent Process Pool
 * Manages a pool of child processes for parallel agent execution.
 * Phase 2 implementation — MVP uses in-process execution.
 */

import { EventEmitter } from 'events';
import { getLogger } from '../core/logger.js';
import type { AgentTask } from './types.js';
import type { AgentResult } from '../core/types.js';

const logger = getLogger();

export interface PoolOptions {
  maxWorkers: number;
  workerScript: string;
  idleTimeout?: number; // ms before killing idle workers
}

export interface PoolStats {
  totalWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  pendingTasks: number;
  completedTasks: number;
}

/**
 * Agent process pool — manages child process workers
 * Phase 2: Full implementation with fork() and IPC
 * MVP: Stub that runs tasks in-process
 */
export class AgentPool extends EventEmitter {
  private maxWorkers: number;
  private activeTasks = 0;
  private completedTasks = 0;
  private pendingQueue: Array<{
    task: AgentTask;
    resolve: (result: AgentResult) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(options: PoolOptions) {
    super();
    this.maxWorkers = options.maxWorkers;
    logger.info({ maxWorkers: this.maxWorkers }, 'Agent pool initialized');
  }

  /**
   * Submit a task for execution
   * Returns when the task is complete
   */
  async submit(task: AgentTask): Promise<AgentResult> {
    return new Promise((resolve, reject) => {
      this.pendingQueue.push({ task, resolve, reject });
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
      totalWorkers: this.maxWorkers,
      busyWorkers: this.activeTasks,
      idleWorkers: this.maxWorkers - this.activeTasks,
      pendingTasks: this.pendingQueue.length,
      completedTasks: this.completedTasks,
    };
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    // Clear pending queue
    for (const pending of this.pendingQueue) {
      pending.reject(new Error('Pool shutting down'));
    }
    this.pendingQueue = [];
    logger.info('Agent pool shut down');
  }

  /**
   * Process pending queue
   */
  private processQueue(): void {
    while (this.pendingQueue.length > 0 && this.activeTasks < this.maxWorkers) {
      const item = this.pendingQueue.shift()!;
      this.activeTasks++;

      this.executeInProcess(item.task)
        .then(result => {
          this.activeTasks--;
          this.completedTasks++;
          item.resolve(result);
          this.processQueue(); // Process next in queue
        })
        .catch(error => {
          this.activeTasks--;
          item.reject(error instanceof Error ? error : new Error(String(error)));
          this.processQueue();
        });
    }
  }

  /**
   * Execute task in-process (MVP fallback)
   * Phase 2 will use child_process.fork() instead
   */
  private async executeInProcess(task: AgentTask): Promise<AgentResult> {
    // MVP: Return a placeholder result
    // In Phase 2, this will fork a child process and communicate via IPC
    return {
      taskId: task.id,
      success: true,
      response: `Pool execution placeholder for task: ${task.description}`,
      filesChanged: [],
      tokensUsed: { input: 0, output: 0, total: 0 },
    };
  }
}
