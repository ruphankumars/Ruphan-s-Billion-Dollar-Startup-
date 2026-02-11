/**
 * Execution Planner
 * Takes decomposed tasks and creates an execution plan with:
 * - Topological sort (respecting dependencies)
 * - Wave scheduling (parallel groups)
 * - Cost estimation
 * - Duration estimation
 */

import type { DecomposedTask, ExecutionPlan, PlanWave } from './types.js';
import type { ModelPricing } from '../cost/types.js';
import { getModelPricing } from '../cost/pricing.js';

export class ExecutionPlanner {
  /**
   * Create an execution plan from decomposed tasks
   */
  plan(tasks: DecomposedTask[]): ExecutionPlan {
    // Topological sort
    const sorted = this.topologicalSort(tasks);

    // Group into waves (tasks that can run in parallel)
    const waves = this.createWaves(sorted, tasks);

    // Estimate costs
    const costEstimate = this.estimateCost(tasks);

    // Estimate duration
    const durationEstimate = this.estimateDuration(waves, tasks);

    return {
      tasks: sorted,
      waves,
      totalEstimatedTokens: costEstimate.tokens,
      totalEstimatedCost: costEstimate.cost,
      estimatedDuration: durationEstimate,
    };
  }

  /**
   * Topological sort of tasks respecting dependencies
   * Uses Kahn's algorithm
   */
  private topologicalSort(tasks: DecomposedTask[]): DecomposedTask[] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // Initialize
    for (const task of tasks) {
      inDegree.set(task.id, 0);
      adjacency.set(task.id, []);
    }

    // Build graph
    for (const task of tasks) {
      for (const dep of task.dependencies) {
        if (taskMap.has(dep)) {
          adjacency.get(dep)!.push(task.id);
          inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted: DecomposedTask[] = [];
    while (queue.length > 0) {
      // Sort queue by priority (higher first)
      queue.sort((a, b) => {
        const taskA = taskMap.get(a)!;
        const taskB = taskMap.get(b)!;
        return taskB.priority - taskA.priority;
      });

      const id = queue.shift()!;
      sorted.push(taskMap.get(id)!);

      for (const neighbor of adjacency.get(id) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // If we didn't sort all tasks, there's a cycle — add remaining
    if (sorted.length < tasks.length) {
      const sortedIds = new Set(sorted.map(t => t.id));
      for (const task of tasks) {
        if (!sortedIds.has(task.id)) {
          sorted.push(task);
        }
      }
    }

    return sorted;
  }

  /**
   * Create execution waves (parallel groups)
   * Tasks in the same wave have all dependencies satisfied by previous waves
   */
  private createWaves(sorted: DecomposedTask[], allTasks: DecomposedTask[]): PlanWave[] {
    const waves: PlanWave[] = [];
    const completed = new Set<string>();

    let remaining = [...sorted];
    let waveNumber = 1;

    while (remaining.length > 0) {
      // Find tasks whose dependencies are all completed
      const waveTaskIds: string[] = [];
      const nextRemaining: DecomposedTask[] = [];

      for (const task of remaining) {
        const depsCompleted = task.dependencies.every(dep => completed.has(dep));
        if (depsCompleted) {
          waveTaskIds.push(task.id);
        } else {
          nextRemaining.push(task);
        }
      }

      // Safety: if no tasks can be scheduled, force the first one
      if (waveTaskIds.length === 0 && nextRemaining.length > 0) {
        waveTaskIds.push(nextRemaining.shift()!.id);
      }

      waves.push({
        waveNumber,
        taskIds: waveTaskIds,
        canParallelize: waveTaskIds.length > 1,
      });

      // Mark as completed
      for (const id of waveTaskIds) {
        completed.add(id);
      }

      remaining = nextRemaining;
      waveNumber++;
    }

    return waves;
  }

  /**
   * Estimate total token usage and cost
   */
  private estimateCost(tasks: DecomposedTask[]): { tokens: number; cost: number } {
    let totalTokens = 0;
    let totalCost = 0;

    // Default pricing (Claude Haiku for estimation)
    const defaultPricing: ModelPricing = getModelPricing('claude-haiku-4-20250414') ?? {
      model: 'claude-haiku-4-20250414',
      provider: 'anthropic',
      inputPer1M: 1.0,
      outputPer1M: 5.0,
      contextWindow: 200000,
      tier: 'fast',
    };

    for (const task of tasks) {
      // Estimate tokens based on complexity
      const estimatedInput = Math.round(2000 + task.estimatedComplexity * 8000);
      const estimatedOutput = Math.round(500 + task.estimatedComplexity * 3000);
      totalTokens += estimatedInput + estimatedOutput;

      // Use role-specific pricing
      const pricing = this.getPricingForRole(task.role) || defaultPricing;
      const taskCost =
        (estimatedInput / 1_000_000) * pricing.inputPer1M +
        (estimatedOutput / 1_000_000) * pricing.outputPer1M;
      totalCost += taskCost;
    }

    return { tokens: totalTokens, cost: totalCost };
  }

  /**
   * Estimate duration in seconds
   * Accounts for parallelism within waves
   */
  private estimateDuration(waves: PlanWave[], tasks: DecomposedTask[]): number {
    let totalSeconds = 0;
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    for (const wave of waves) {
      // Wave duration = max task duration in wave (parallel execution)
      let maxWaveDuration = 0;

      for (const taskId of wave.taskIds) {
        const task = taskMap.get(taskId);
        if (!task) continue;

        // Estimate: 3-30 seconds per task depending on complexity
        const taskDuration = 3 + task.estimatedComplexity * 27;
        maxWaveDuration = Math.max(maxWaveDuration, taskDuration);
      }

      totalSeconds += maxWaveDuration;
    }

    return Math.round(totalSeconds);
  }

  /**
   * Get pricing for a role (maps roles to models)
   */
  private getPricingForRole(role: string): ModelPricing | undefined {
    const roleModelMap: Record<string, string> = {
      orchestrator: 'claude-sonnet-4-20250514',
      researcher: 'claude-haiku-4-20250414',
      developer: 'claude-sonnet-4-20250514',
      architect: 'claude-sonnet-4-20250514',
      tester: 'claude-haiku-4-20250414',
      validator: 'claude-haiku-4-20250414',
      'ux-agent': 'claude-haiku-4-20250414',
    };

    const model = roleModelMap[role];
    return model ? getModelPricing(model) : undefined;
  }
}
