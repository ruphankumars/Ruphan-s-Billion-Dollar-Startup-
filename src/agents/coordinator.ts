/**
 * Swarm Coordinator
 * Manages multi-agent execution in waves.
 * MVP: In-process parallel execution via Promise.all
 * Phase 2: Child process pool for true parallelism.
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

const logger = getLogger();

export interface CoordinatorOptions {
  provider: LLMProvider;
  tools: Tool[];
  toolContext: ToolContext;
  events: EventBus;
  maxParallel?: number;
  systemPrompt?: string;
}

export class SwarmCoordinator {
  private provider: LLMProvider;
  private tools: Tool[];
  private toolContext: ToolContext;
  private events: EventBus;
  private maxParallel: number;
  private systemPrompt: string;

  constructor(options: CoordinatorOptions) {
    this.provider = options.provider;
    this.tools = options.tools;
    this.toolContext = options.toolContext;
    this.events = options.events;
    this.maxParallel = options.maxParallel ?? 4;
    this.systemPrompt = options.systemPrompt ?? '';
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

      const waveResults = await this.executeWave(waveTasks, resultMap);

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
  ): Promise<AgentResult[]> {
    const batches: DecomposedTask[][] = [];
    for (let i = 0; i < tasks.length; i += this.maxParallel) {
      batches.push(tasks.slice(i, i + this.maxParallel));
    }

    const results: AgentResult[] = [];
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(task => this.executeTask(task, previousResults)),
      );
      results.push(...batchResults);
    }
    return results;
  }

  private async executeTask(
    task: DecomposedTask,
    previousResults: Map<string, AgentResult>,
  ): Promise<AgentResult> {
    const timer = new Timer();

    try {
      this.events.emit('agent:start', { taskId: task.id, role: task.role });

      const role = getRole(task.role as any);

      const allowedTools = this.tools.filter(t => role.defaultTools.includes(t.name));

      const dependencyContext = task.dependencies
        .map(depId => {
          const result = previousResults.get(depId);
          return result ? `[Previous: ${result.taskId}] ${result.response.substring(0, 500)}` : '';
        })
        .filter(Boolean)
        .join('\n\n');

      const agent = new Agent({
        role: task.role as any,
        provider: this.provider,
        tools: allowedTools,
        toolContext: this.toolContext,
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
}
