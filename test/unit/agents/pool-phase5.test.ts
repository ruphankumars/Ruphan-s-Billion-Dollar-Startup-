import { describe, it, expect, vi } from 'vitest';
import { AgentPool } from '../../../src/agents/pool.js';

describe('AgentPool — Phase 5 Error Handling', () => {
  it('should throw explicit error when no provider in in-process mode', async () => {
    const pool = new AgentPool({
      maxWorkers: 2,
      workerScript: 'dist/workers/worker.js',
      useChildProcess: false,
      // No provider!
    });

    await expect(
      pool.submit({
        id: 'task-1',
        description: 'Test task',
        role: 'developer',
        dependencies: [],
        wave: 0,
      }),
    ).rejects.toThrow('No LLM provider configured');

    await pool.shutdown();
  });

  it('should reject pending tasks on shutdown', async () => {
    const pool = new AgentPool({
      maxWorkers: 1,
      workerScript: 'dist/workers/worker.js',
      useChildProcess: false,
    });

    // Submit multiple tasks — first will start executing and throw (no provider)
    // But second is queued
    const p1 = pool.submit({
      id: 'task-1',
      description: 'Task 1',
      role: 'developer',
      dependencies: [],
      wave: 0,
    });

    const p2 = pool.submit({
      id: 'task-2',
      description: 'Task 2',
      role: 'developer',
      dependencies: [],
      wave: 0,
    });

    // Shut down should reject pending tasks
    await pool.shutdown();

    // Both should reject with errors
    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow();
  });

  it('should report stats correctly', () => {
    const pool = new AgentPool({
      maxWorkers: 4,
      workerScript: 'dist/workers/worker.js',
      useChildProcess: false,
    });

    const stats = pool.getStats();
    expect(stats.totalWorkers).toBe(4);
    expect(stats.busyWorkers).toBe(0);
    expect(stats.idleWorkers).toBe(4);
    expect(stats.pendingTasks).toBe(0);
    expect(stats.completedTasks).toBe(0);
  });

  it('should not accept tasks after shutdown', async () => {
    const pool = new AgentPool({
      maxWorkers: 2,
      workerScript: 'dist/workers/worker.js',
      useChildProcess: false,
    });

    await pool.shutdown();

    await expect(
      pool.submit({
        id: 'task-post-shutdown',
        description: 'Should fail',
        role: 'developer',
        dependencies: [],
        wave: 0,
      }),
    ).rejects.toThrow('Pool is shut down');
  });
});
