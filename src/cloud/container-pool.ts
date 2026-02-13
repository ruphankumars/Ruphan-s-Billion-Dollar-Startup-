/**
 * Container Pool — Task-to-Container Router
 *
 * Manages a pool of Docker containers for executing cloud tasks.
 * Handles task queuing, container lifecycle, and result collection.
 * Analogous to AgentPool but for Docker-based execution.
 */

import { randomUUID } from 'node:crypto';
import { DockerManager } from './docker-manager.js';
import { EnvironmentRegistry } from './environment-registry.js';
import type {
  CloudTask,
  CloudTaskResult,
  CloudTaskStatus,
  ContainerEvent,
  Environment,
  RepoMount,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// CONTAINER POOL
// ═══════════════════════════════════════════════════════════════

export interface ContainerPoolOptions {
  maxContainers: number;
  defaultEnvironment: string;
  containerTimeout: number;
  docker?: DockerManager;
  environments?: EnvironmentRegistry;
}

export class ContainerPool {
  readonly docker: DockerManager;
  readonly environments: EnvironmentRegistry;

  private maxContainers: number;
  private defaultEnvironment: string;
  private containerTimeout: number;

  private tasks: Map<string, CloudTask> = new Map();
  private taskQueue: string[] = [];
  private activeContainers = 0;
  private listeners: Map<string, Array<(event: ContainerEvent) => void>> = new Map();

  constructor(options: ContainerPoolOptions) {
    this.maxContainers = options.maxContainers;
    this.defaultEnvironment = options.defaultEnvironment;
    this.containerTimeout = options.containerTimeout;
    this.docker = options.docker ?? new DockerManager();
    this.environments = options.environments ?? new EnvironmentRegistry();
  }

  /** Submit a task for execution in a Docker container */
  async submit(options: {
    prompt: string;
    environmentId?: string;
    inputs?: Record<string, unknown>;
    mounts?: RepoMount[];
    onEvent?: (event: ContainerEvent) => void;
  }): Promise<CloudTask> {
    const taskId = `cloud_${randomUUID().slice(0, 8)}`;
    const envId = options.environmentId ?? this.defaultEnvironment;

    const task: CloudTask = {
      id: taskId,
      prompt: options.prompt,
      environmentId: envId,
      status: 'queued',
      inputs: options.inputs,
      createdAt: Date.now(),
    };

    this.tasks.set(taskId, task);

    if (options.onEvent) {
      if (!this.listeners.has(taskId)) this.listeners.set(taskId, []);
      this.listeners.get(taskId)!.push(options.onEvent);
    }

    // Try to execute immediately or queue
    if (this.activeContainers < this.maxContainers) {
      this.executeTask(task, options.mounts).catch(() => {
        // Error handled within executeTask
      });
    } else {
      this.taskQueue.push(taskId);
    }

    return task;
  }

  /** Cancel a running or queued task */
  async cancel(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'queued') {
      task.status = 'cancelled';
      this.taskQueue = this.taskQueue.filter((id) => id !== taskId);
      return true;
    }

    if (task.status === 'running' && task.containerId) {
      try {
        await this.docker.stopContainer(task.containerId);
        await this.docker.removeContainer(task.containerId, true);
      } catch {
        // Best effort
      }
      task.status = 'cancelled';
      task.completedAt = Date.now();
      this.activeContainers--;
      this.processQueue();
      return true;
    }

    return false;
  }

  /** Get a task by ID */
  getTask(taskId: string): CloudTask | undefined {
    return this.tasks.get(taskId);
  }

  /** Get all tasks with optional filtering */
  getTasks(filter?: { status?: CloudTaskStatus; environmentId?: string }): CloudTask[] {
    let tasks = [...this.tasks.values()];
    if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
    if (filter?.environmentId) tasks = tasks.filter((t) => t.environmentId === filter.environmentId);
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Get pool statistics */
  getStats(): {
    activeContainers: number;
    maxContainers: number;
    queuedTasks: number;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
  } {
    const all = [...this.tasks.values()];
    return {
      activeContainers: this.activeContainers,
      maxContainers: this.maxContainers,
      queuedTasks: this.taskQueue.length,
      totalTasks: all.length,
      completedTasks: all.filter((t) => t.status === 'completed').length,
      failedTasks: all.filter((t) => t.status === 'failed').length,
    };
  }

  /** Shut down the pool, cleaning up all containers */
  async shutdown(): Promise<void> {
    // Cancel all queued tasks
    for (const taskId of this.taskQueue) {
      const task = this.tasks.get(taskId);
      if (task) task.status = 'cancelled';
    }
    this.taskQueue = [];

    // Clean up all containers
    await this.docker.cleanup(true);
    this.activeContainers = 0;
  }

  // ─── Internal ─────────────────────────────────────────────

  private async executeTask(task: CloudTask, mounts?: RepoMount[]): Promise<void> {
    const environment = this.environments.get(task.environmentId);
    if (!environment) {
      task.status = 'failed';
      task.error = `Environment "${task.environmentId}" not found`;
      task.completedAt = Date.now();
      return;
    }

    this.activeContainers++;
    task.status = 'running';
    task.startedAt = Date.now();

    try {
      // Create container
      const containerInfo = await this.docker.createContainer({
        environment,
        command: ['sh', '-c', `echo '${this.escapeShell(task.prompt)}' | node -e "
          process.stdin.resume();
          let data='';
          process.stdin.on('data',c=>data+=c);
          process.stdin.on('end',()=>{
            console.log(JSON.stringify({status:'completed',output:'Task processed: '+data.trim()}));
          });
        "`],
        mounts,
        env: {
          CORTEXOS_TASK_ID: task.id,
          CORTEXOS_PROMPT: task.prompt,
          ...(task.inputs ? { CORTEXOS_INPUTS: JSON.stringify(task.inputs) } : {}),
        },
      });

      task.containerId = containerInfo.id;
      this.emitEvent(task.id, 'container:created', containerInfo.id);

      // Start container
      await this.docker.startContainer(containerInfo.id);
      this.emitEvent(task.id, 'container:started', containerInfo.id);

      // Wait for completion with timeout
      const timeout = environment.resourceLimits?.timeoutMs ?? this.containerTimeout;
      const { exitCode } = await this.docker.waitForContainer(containerInfo.id, timeout);

      // Collect logs
      const logs = await this.docker.getContainerLogs(containerInfo.id);
      const logLines = logs.split('\n').filter(Boolean);

      // Build result
      task.result = {
        success: exitCode === 0,
        output: logLines.join('\n'),
        exitCode,
        logs: logLines,
        duration: Date.now() - (task.startedAt ?? Date.now()),
      };

      task.status = exitCode === 0 ? 'completed' : 'failed';
      if (exitCode !== 0) task.error = `Container exited with code ${exitCode}`;

      this.emitEvent(task.id, exitCode === 0 ? 'container:completed' : 'container:failed', containerInfo.id);

      // Cleanup container
      try {
        await this.docker.removeContainer(containerInfo.id, true);
      } catch {
        // Best effort cleanup
      }
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);

      if (task.containerId) {
        this.emitEvent(task.id, 'container:failed', task.containerId);
        try {
          await this.docker.removeContainer(task.containerId, true);
        } catch {
          // Best effort cleanup
        }
      }
    } finally {
      task.completedAt = Date.now();
      this.activeContainers--;
      this.processQueue();
    }
  }

  private processQueue(): void {
    while (this.taskQueue.length > 0 && this.activeContainers < this.maxContainers) {
      const taskId = this.taskQueue.shift()!;
      const task = this.tasks.get(taskId);
      if (task && task.status === 'queued') {
        this.executeTask(task).catch(() => {});
      }
    }
  }

  private emitEvent(
    taskId: string,
    type: ContainerEvent['type'],
    containerId: string,
  ): void {
    const event: ContainerEvent = {
      type,
      containerId,
      taskId,
      timestamp: Date.now(),
    };
    const listeners = this.listeners.get(taskId) || [];
    for (const listener of listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  private escapeShell(str: string): string {
    return str.replace(/'/g, "'\\''");
  }
}
