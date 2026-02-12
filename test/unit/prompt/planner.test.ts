import { describe, it, expect } from 'vitest';
import { ExecutionPlanner } from '../../../src/prompt/planner.js';
import type { DecomposedTask } from '../../../src/prompt/types.js';

/**
 * Helper to create a DecomposedTask with sensible defaults.
 */
function createTask(id: string, opts: Partial<DecomposedTask> = {}): DecomposedTask {
  return {
    id,
    title: opts.title ?? `Task ${id}`,
    description: opts.description ?? `Description for task ${id}`,
    role: opts.role ?? 'developer',
    dependencies: opts.dependencies ?? [],
    priority: opts.priority ?? 5,
    estimatedComplexity: opts.estimatedComplexity ?? 0.5,
    requiredTools: opts.requiredTools ?? [],
    context: opts.context ?? '',
  };
}

describe('ExecutionPlanner', () => {
  const planner = new ExecutionPlanner();

  describe('plan() - basic behavior', () => {
    it('should return an empty plan for empty tasks', () => {
      const result = planner.plan([]);
      expect(result.tasks).toEqual([]);
      expect(result.waves).toEqual([]);
      expect(result.totalEstimatedTokens).toBe(0);
      expect(result.totalEstimatedCost).toBe(0);
      expect(result.estimatedDuration).toBe(0);
    });

    it('should plan a single task into 1 wave', () => {
      const tasks = [createTask('t1')];
      const result = planner.plan(tasks);

      expect(result.tasks).toHaveLength(1);
      expect(result.waves).toHaveLength(1);
      expect(result.waves[0].taskIds).toContain('t1');
      expect(result.waves[0].waveNumber).toBe(1);
      expect(result.waves[0].canParallelize).toBe(false);
    });
  });

  describe('plan() - wave scheduling', () => {
    it('should place independent tasks in the same wave', () => {
      const tasks = [
        createTask('t1'),
        createTask('t2'),
        createTask('t3'),
      ];
      const result = planner.plan(tasks);

      expect(result.waves).toHaveLength(1);
      expect(result.waves[0].taskIds).toHaveLength(3);
      expect(result.waves[0].canParallelize).toBe(true);
    });

    it('should order dependent tasks into correct waves', () => {
      const tasks = [
        createTask('t1'),
        createTask('t2', { dependencies: ['t1'] }),
      ];
      const result = planner.plan(tasks);

      expect(result.waves.length).toBe(2);

      // t1 should be in wave 1
      const wave1 = result.waves.find(w => w.waveNumber === 1)!;
      expect(wave1.taskIds).toContain('t1');

      // t2 should be in wave 2
      const wave2 = result.waves.find(w => w.waveNumber === 2)!;
      expect(wave2.taskIds).toContain('t2');
    });

    it('should handle a chain of three dependent tasks (A -> B -> C)', () => {
      const tasks = [
        createTask('A'),
        createTask('B', { dependencies: ['A'] }),
        createTask('C', { dependencies: ['B'] }),
      ];
      const result = planner.plan(tasks);

      expect(result.waves).toHaveLength(3);
      expect(result.waves[0].taskIds).toContain('A');
      expect(result.waves[1].taskIds).toContain('B');
      expect(result.waves[2].taskIds).toContain('C');
    });

    it('should handle diamond dependency correctly', () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      const tasks = [
        createTask('A'),
        createTask('B', { dependencies: ['A'] }),
        createTask('C', { dependencies: ['A'] }),
        createTask('D', { dependencies: ['B', 'C'] }),
      ];
      const result = planner.plan(tasks);

      // Wave 1: A, Wave 2: B and C (parallel), Wave 3: D
      expect(result.waves).toHaveLength(3);

      const wave1 = result.waves[0];
      expect(wave1.taskIds).toContain('A');

      const wave2 = result.waves[1];
      expect(wave2.taskIds).toContain('B');
      expect(wave2.taskIds).toContain('C');
      expect(wave2.canParallelize).toBe(true);

      const wave3 = result.waves[2];
      expect(wave3.taskIds).toContain('D');
    });

    it('should place tasks with met dependencies in the earliest possible wave', () => {
      // A has no deps, B depends on A, C has no deps, D depends on B and C
      const tasks = [
        createTask('A'),
        createTask('B', { dependencies: ['A'] }),
        createTask('C'),
        createTask('D', { dependencies: ['B', 'C'] }),
      ];
      const result = planner.plan(tasks);

      // Wave 1: A, C (both independent)
      expect(result.waves[0].taskIds).toContain('A');
      expect(result.waves[0].taskIds).toContain('C');

      // Wave 2: B (depends on A, which is in wave 1)
      expect(result.waves[1].taskIds).toContain('B');

      // Wave 3: D (depends on B and C, both now complete)
      expect(result.waves[2].taskIds).toContain('D');
    });
  });

  describe('plan() - topological sort', () => {
    it('should sort tasks so dependencies come before dependents', () => {
      const tasks = [
        createTask('t2', { dependencies: ['t1'] }),
        createTask('t1'),
      ];
      const result = planner.plan(tasks);

      const ids = result.tasks.map(t => t.id);
      expect(ids.indexOf('t1')).toBeLessThan(ids.indexOf('t2'));
    });

    it('should prioritize higher-priority tasks first in topological sort', () => {
      const tasks = [
        createTask('low', { priority: 1 }),
        createTask('high', { priority: 10 }),
        createTask('mid', { priority: 5 }),
      ];
      const result = planner.plan(tasks);

      const ids = result.tasks.map(t => t.id);
      // All are independent, so sorted purely by priority (higher first)
      expect(ids[0]).toBe('high');
      expect(ids[1]).toBe('mid');
      expect(ids[2]).toBe('low');
    });

    it('should handle cycles without hanging', () => {
      // Create a cycle: A -> B -> C -> A
      const tasks = [
        createTask('A', { dependencies: ['C'] }),
        createTask('B', { dependencies: ['A'] }),
        createTask('C', { dependencies: ['B'] }),
      ];
      const result = planner.plan(tasks);

      // Should still return all tasks (cycle detection appends remaining)
      expect(result.tasks).toHaveLength(3);
      const ids = new Set(result.tasks.map(t => t.id));
      expect(ids.has('A')).toBe(true);
      expect(ids.has('B')).toBe(true);
      expect(ids.has('C')).toBe(true);
    });

    it('should handle partial cycles gracefully', () => {
      // D is independent, A -> B -> C -> A is a cycle
      const tasks = [
        createTask('D'),
        createTask('A', { dependencies: ['C'] }),
        createTask('B', { dependencies: ['A'] }),
        createTask('C', { dependencies: ['B'] }),
      ];
      const result = planner.plan(tasks);

      // D should be sorted first (no deps), then cycle tasks appended
      expect(result.tasks).toHaveLength(4);
      expect(result.tasks[0].id).toBe('D');
    });
  });

  describe('plan() - cost estimation', () => {
    it('should estimate tokens greater than 0 for non-empty tasks', () => {
      const tasks = [createTask('t1')];
      const result = planner.plan(tasks);
      expect(result.totalEstimatedTokens).toBeGreaterThan(0);
    });

    it('should estimate cost greater than 0 for non-empty tasks', () => {
      const tasks = [createTask('t1')];
      const result = planner.plan(tasks);
      expect(result.totalEstimatedCost).toBeGreaterThan(0);
    });

    it('should increase cost with more tasks', () => {
      const singleTask = planner.plan([createTask('t1')]);
      const multipleTasks = planner.plan([
        createTask('t1'),
        createTask('t2'),
        createTask('t3'),
      ]);
      expect(multipleTasks.totalEstimatedCost).toBeGreaterThan(singleTask.totalEstimatedCost);
    });

    it('should increase cost with higher task complexity', () => {
      const lowComplexity = planner.plan([createTask('t1', { estimatedComplexity: 0.1 })]);
      const highComplexity = planner.plan([createTask('t1', { estimatedComplexity: 0.9 })]);
      expect(highComplexity.totalEstimatedCost).toBeGreaterThan(lowComplexity.totalEstimatedCost);
    });

    it('should increase tokens with higher task complexity', () => {
      const lowComplexity = planner.plan([createTask('t1', { estimatedComplexity: 0.1 })]);
      const highComplexity = planner.plan([createTask('t1', { estimatedComplexity: 0.9 })]);
      expect(highComplexity.totalEstimatedTokens).toBeGreaterThan(lowComplexity.totalEstimatedTokens);
    });
  });

  describe('plan() - duration estimation', () => {
    it('should estimate duration greater than 0 for non-empty tasks', () => {
      const tasks = [createTask('t1')];
      const result = planner.plan(tasks);
      expect(result.estimatedDuration).toBeGreaterThan(0);
    });

    it('should have shorter duration for parallel tasks than sequential', () => {
      // Two independent tasks (same wave, parallel)
      const parallel = planner.plan([
        createTask('t1', { estimatedComplexity: 0.5 }),
        createTask('t2', { estimatedComplexity: 0.5 }),
      ]);

      // Two sequential tasks (t2 depends on t1)
      const sequential = planner.plan([
        createTask('t1', { estimatedComplexity: 0.5 }),
        createTask('t2', { estimatedComplexity: 0.5, dependencies: ['t1'] }),
      ]);

      // Parallel duration = max(t1, t2), sequential = t1 + t2
      expect(parallel.estimatedDuration).toBeLessThan(sequential.estimatedDuration);
    });

    it('should increase duration with more sequential waves', () => {
      const oneWave = planner.plan([createTask('t1')]);
      const threeWaves = planner.plan([
        createTask('t1'),
        createTask('t2', { dependencies: ['t1'] }),
        createTask('t3', { dependencies: ['t2'] }),
      ]);
      expect(threeWaves.estimatedDuration).toBeGreaterThan(oneWave.estimatedDuration);
    });

    it('should return integer duration (rounded)', () => {
      const result = planner.plan([createTask('t1', { estimatedComplexity: 0.33 })]);
      expect(Number.isInteger(result.estimatedDuration)).toBe(true);
    });
  });

  describe('plan() - role-based pricing', () => {
    it('should use different pricing for different roles', () => {
      // Developer uses claude-sonnet-4 (more expensive)
      const devPlan = planner.plan([createTask('t1', { role: 'developer', estimatedComplexity: 0.5 })]);
      // Tester uses claude-haiku-4 (cheaper)
      const testerPlan = planner.plan([createTask('t1', { role: 'tester', estimatedComplexity: 0.5 })]);

      // Same complexity but developer should cost more (sonnet vs haiku pricing)
      expect(devPlan.totalEstimatedCost).toBeGreaterThan(testerPlan.totalEstimatedCost);
    });
  });
});
