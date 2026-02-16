/**
 * Swarm Coordinator
 * Manages multi-agent execution in waves with optional pool routing,
 * worktree isolation, and IPC-based inter-agent messaging.
 * Falls back to in-process Promise.all when pool/worktrees not provided.
 */

import type { AgentTask } from './types.js';
import type { AgentResult } from '../core/types.js';
import type { LLMProvider } from '../providers/types.js';
import type { Tool, ToolContext } from '../tools/types.js';
import type { DecomposedTask, PlanWave } from '../prompt/types.js';
import { Agent } from './agent.js';
import { getRole } from './roles/index.js';
import { EventBus } from '../core/events.js';
import { getLogger } from '../core/logger.js';
import { Timer } from '../utils/timer.js';
import type { AgentPool } from './pool.js';
import type { WorktreeManager, WorktreeInfo } from './sandbox/worktree.js';
import type { MergeManager } from './sandbox/merger.js';
import type { MessageBus } from './message-bus.js';

const logger = getLogger();

export interface CoordinatorOptions {
  provider: LLMProvider;
  tools: Tool[];
  toolContext: ToolContext;
  events: EventBus;
  maxParallel?: number;
  systemPrompt?: string;
  pool?: AgentPool;
  worktreeManager?: WorktreeManager;
  mergeManager?: MergeManager;
  messageBus?: MessageBus;
  executionId?: string;
}

export class SwarmCoordinator {
  private provider: LLMProvider;
  private tools: Tool[];
  private toolContext: ToolContext;
  private events: EventBus;
  private maxParallel: number;
  private systemPrompt: string;
  private pool: AgentPool | undefined;
  private worktreeManager: WorktreeManager | undefined;
  private mergeManager: MergeManager | undefined;
  private messageBus: MessageBus | undefined;
  private executionId: string;

  constructor(options: CoordinatorOptions) {
    this.provider = options.provider;
    this.tools = options.tools;
    this.toolContext = options.toolContext;
    this.events = options.events;
    this.maxParallel = options.maxParallel ?? 4;
    this.systemPrompt = options.systemPrompt ?? '';
    this.pool = options.pool;
    this.worktreeManager = options.worktreeManager;
    this.mergeManager = options.mergeManager;
    this.messageBus = options.messageBus;
    this.executionId = options.executionId ?? 'exec-default';
  }

  /**
   * Execute all tasks according to wave schedule
   */
  async executeWaves(
    tasks: DecomposedTask[],
    waves: PlanWave[],
  ): Promise<AgentResult[]> {
    const timer = new Timer();
    const allResults: AgentResult[] = [];
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const resultMap = new Map<string, AgentResult>();

    logger.info({ waves: waves.length, tasks: tasks.length }, 'Starting wave execution');

    for (const wave of waves) {
      this.events.emit('wave:start', { wave: wave.waveNumber, tasks: wave.taskIds });
      const waveTimer = new Timer();

      const waveTasks = wave.taskIds
        .map(id => taskMap.get(id))
        .filter(Boolean) as DecomposedTask[];

      // Create worktrees for this wave if available
      let worktreeMap: Map<string, WorktreeInfo> | undefined;
      if (this.worktreeManager?.isAvailable()) {
        try {
          worktreeMap = await this.worktreeManager.createForWave(
            this.executionId,
            waveTasks.map(t => t.id),
          );
        } catch (err) {
          logger.warn({ error: (err as Error).message }, 'Failed to create worktrees, falling back to shared dir');
        }
      }

      const waveResults = await this.executeWave(waveTasks, resultMap, worktreeMap);

      // Merge worktree results back
      if (worktreeMap && this.mergeManager) {
        for (const result of waveResults) {
          const wtInfo = worktreeMap.get(result.taskId);
          if (wtInfo) {
            try {
              const mergeResult = await this.mergeManager.mergeOne(wtInfo);
              if (!mergeResult.success) {
                logger.warn(
                  { taskId: result.taskId, conflicts: mergeResult.conflicts },
                  'Merge conflict during worktree merge',
                );
                result.success = false;
                result.error = `Merge conflict: ${mergeResult.conflicts.join(', ')}`;
              }
            } catch (err) {
              logger.warn({ taskId: result.taskId, error: (err as Error).message }, 'Worktree merge failed');
            }
          }
        }

        // Cleanup worktrees for this wave
        if (this.worktreeManager) {
          for (const taskId of waveTasks.map(t => t.id)) {
            try {
              await this.worktreeManager.remove(taskId);
            } catch {
              // Best effort cleanup
            }
          }
        }
      }

      for (const result of waveResults) {
        resultMap.set(result.taskId, result);
        allResults.push(result);
      }

      const waveElapsed = waveTimer.elapsed;
      logger.info(
        { wave: wave.waveNumber, tasks: waveTasks.length, duration: waveElapsed },
        'Wave completed',
      );
      this.events.emit('wave:complete', {
        wave: wave.waveNumber,
        duration: waveElapsed,
        results: waveResults.map(r => ({ taskId: r.taskId, success: r.success })),
      });
    }

    logger.info({ totalDuration: timer.elapsed, totalResults: allResults.length }, 'All waves completed');
    return allResults;
  }

  private async executeWave(
    tasks: DecomposedTask[],
    previousResults: Map<string, AgentResult>,
    worktreeMap?: Map<string, WorktreeInfo>,
  ): Promise<AgentResult[]> {
    const batches: DecomposedTask[][] = [];
    for (let i = 0; i < tasks.length; i += this.maxParallel) {
      batches.push(tasks.slice(i, i + this.maxParallel));
    }

    const results: AgentResult[] = [];
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(task => {
          const workingDir = worktreeMap?.get(task.id)?.worktreePath;

          // Route through pool if available
          if (this.pool) {
            return this.executeViaPool(task, previousResults, workingDir);
          }

          return this.executeTask(task, previousResults, workingDir);
        }),
      );
      results.push(...batchResults);
    }
    return results;
  }

  /**
   * Execute a task via the agent pool.
   */
  private async executeViaPool(
    task: DecomposedTask,
    previousResults: Map<string, AgentResult>,
    workingDir?: string,
  ): Promise<AgentResult> {
    const timer = new Timer();

    try {
      this.events.emit('agent:start', { taskId: task.id, role: task.role });

      const role = getRole(task.role as any);
      const dependencyContext = this.buildDependencyContext(task, previousResults);

      const agentTask: AgentTask = {
        id: task.id,
        description: task.description,
        context: [task.context, dependencyContext].filter(Boolean).join('\n\n'),
        role: task.role as any,
        dependencies: task.dependencies,
        wave: 0,
      };

      const result = await this.pool!.submit(
        agentTask,
        workingDir,
        role.defaultTools,
      );

      this.events.emit('agent:complete', {
        taskId: task.id,
        role: task.role,
        success: result.success,
        duration: timer.elapsed,
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ taskId: task.id, error: err.message }, 'Pool execution failed');
      this.events.emit('agent:error', { taskId: task.id, error: err.message });

      return {
        taskId: task.id,
        success: false,
        response: `Task failed: ${err.message}`,
        error: err.message,
      };
    }
  }

  /**
   * Execute a task directly in-process (original MVP path).
   */
  private async executeTask(
    task: DecomposedTask,
    previousResults: Map<string, AgentResult>,
    workingDir?: string,
  ): Promise<AgentResult> {
    const timer = new Timer();

    try {
      this.events.emit('agent:start', { taskId: task.id, role: task.role });

      const role = getRole(task.role as any);
      const allowedTools = this.tools.filter(t => role.defaultTools.includes(t.name));
      const dependencyContext = this.buildDependencyContext(task, previousResults);

      const toolContext = workingDir
        ? { ...this.toolContext, workingDir }
        : this.toolContext;

      const agent = new Agent({
        role: task.role as any,
        provider: this.provider,
        tools: allowedTools,
        toolContext,
        systemPrompt: this.systemPrompt,
      });

      const agentTask: AgentTask = {
        id: task.id,
        description: task.description,
        context: [task.context, dependencyContext].filter(Boolean).join('\n\n'),
        role: task.role as any,
        dependencies: task.dependencies,
        wave: 0,
      };

      const result = await agent.execute(agentTask);

      this.events.emit('agent:complete', {
        taskId: task.id,
        role: task.role,
        success: result.success,
        duration: timer.elapsed,
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ taskId: task.id, error: err.message }, 'Agent execution failed');
      this.events.emit('agent:error', { taskId: task.id, error: err.message });

      return {
        taskId: task.id,
        success: false,
        response: `Task failed: ${err.message}`,
        error: err.message,
      };
    }
  }

  /**
   * Build context string from dependency results.
   */
  private buildDependencyContext(
    task: DecomposedTask,
    previousResults: Map<string, AgentResult>,
  ): string {
    return task.dependencies
      .map(depId => {
        const result = previousResults.get(depId);
        return result ? `[Previous: ${result.taskId}] ${result.response.substring(0, 500)}` : '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
}
