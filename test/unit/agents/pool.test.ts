import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentPool } from '../../../src/agents/pool.js';
import type { AgentTask } from '../../../src/agents/types.js';
import type { LLMProvider } from '../../../src/providers/types.js';

function createTask(id: string, role = 'developer' as const): AgentTask {
  return {
    id,
    description: `Test task ${id}`,
    role,
    dependencies: [],
    wave: 0,
  };
}

function createMockProvider(): LLMProvider {
  return {
    name: 'mock',
    models: ['mock-model'],
    defaultModel: 'mock-model',
    complete: vi.fn().mockResolvedValue({
      content: 'Task completed successfully',
      model: 'mock-model',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      finishReason: 'stop' as const,
    }),
    stream: vi.fn(),
    isAvailable: vi.fn().mockResolvedValue(true),
    countTokens: vi.fn().mockReturnValue(10),
  } as unknown as LLMProvider;
}

describe('AgentPool', () => {
  let pool: AgentPool;

  beforeEach(() => {
    pool = new AgentPool({
      maxWorkers: 2,
      workerScript: 'dist/workers/worker.js',
      useChildProcess: false,
      provider: createMockProvider(),
      tools: [],
      toolContext: { workingDir: '/tmp', executionId: 'test' },
    });
  });

  it('should submit and resolve a task in-process', async () => {
    const task = createTask('task-001');
    const result = await pool.submit(task);

    expect(result).toBeDefined();
    expect(result.taskId).toBe('task-001');
    expect(result.success).toBe(true);
  });

  it('should submit a batch of tasks', async () => {
    const tasks = [
      createTask('task-001'),
      createTask('task-002'),
      createTask('task-003'),
    ];

    const results = await pool.submitBatch(tasks);

    expect(results).toHaveLength(3);
    expect(results[0].taskId).toBe('task-001');
    expect(results[1].taskId).toBe('task-002');
    expect(results[2].taskId).toBe('task-003');
  });

  it('should report correct stats', async () => {
    const stats = pool.getStats();

    expect(stats.totalWorkers).toBe(2);
    expect(stats.busyWorkers).toBe(0);
    expect(stats.idleWorkers).toBe(2);
    expect(stats.pendingTasks).toBe(0);
    expect(stats.completedTasks).toBe(0);
  });

  it('should update stats after task completion', async () => {
    const task = createTask('task-001');
    await pool.submit(task);

    const stats = pool.getStats();
    expect(stats.completedTasks).toBe(1);
  });

  it('should shutdown and reject pending tasks', async () => {
    await pool.shutdown();

    await expect(pool.submit(createTask('after-shutdown'))).rejects.toThrow('Pool is shut down');
  });

  it('should emit events on task completion', async () => {
    const completeSpy = vi.fn();
    pool.on('task:complete', completeSpy);

    await pool.submit(createTask('task-001'));

    expect(completeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-001', success: true }),
    );
  });
});
