import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SwarmCoordinator } from '../../src/agents/coordinator.js';
import { EventBus } from '../../src/core/events.js';
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk } from '../../src/providers/types.js';
import type { DecomposedTask, PlanWave } from '../../src/prompt/types.js';

/**
 * Mock LLM provider that returns deterministic responses
 */
function createMockProvider(): LLMProvider {
  return {
    name: 'mock',
    models: ['mock-model'],
    defaultModel: 'mock-model',
    async complete(request: LLMRequest): Promise<LLMResponse> {
      return {
        content: `Response for: ${request.messages[request.messages.length - 1].content.substring(0, 50)}`,
        toolCalls: [],
        model: 'mock-model',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      };
    },
    async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
      yield { type: 'text', content: 'streaming mock' };
      yield { type: 'done', usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } };
    },
    async isAvailable() { return true; },
    countTokens(text: string) { return Math.ceil(text.length / 4); },
  };
}

function createTasks(): DecomposedTask[] {
  return [
    {
      id: 'task-research',
      role: 'researcher',
      title: 'Research auth patterns',
      description: 'Research authentication patterns for the project',
      dependencies: [],
      context: 'Initial research',
      estimatedComplexity: 0.3,
      estimatedTokens: 3000,
    },
    {
      id: 'task-arch',
      role: 'architect',
      title: 'Design auth system',
      description: 'Design the authentication system architecture',
      dependencies: ['task-research'],
      context: 'Architecture design',
      estimatedComplexity: 0.6,
      estimatedTokens: 4000,
    },
    {
      id: 'task-dev',
      role: 'developer',
      title: 'Implement auth',
      description: 'Implement the authentication system',
      dependencies: ['task-arch'],
      context: 'Implementation',
      estimatedComplexity: 0.8,
      estimatedTokens: 5000,
    },
    {
      id: 'task-test',
      role: 'tester',
      title: 'Test auth',
      description: 'Write tests for authentication',
      dependencies: ['task-dev'],
      context: 'Testing',
      estimatedComplexity: 0.5,
      estimatedTokens: 3000,
    },
  ];
}

function createWaves(): PlanWave[] {
  return [
    { waveNumber: 1, taskIds: ['task-research'], canParallelize: true },
    { waveNumber: 2, taskIds: ['task-arch'], canParallelize: true },
    { waveNumber: 3, taskIds: ['task-dev'], canParallelize: true },
    { waveNumber: 4, taskIds: ['task-test'], canParallelize: true },
  ];
}

describe('Swarm Execution Integration', () => {
  let coordinator: SwarmCoordinator;
  let events: EventBus;
  let provider: LLMProvider;

  beforeEach(() => {
    events = new EventBus();
    provider = createMockProvider();
    coordinator = new SwarmCoordinator({
      provider,
      tools: [],
      toolContext: { workingDir: '/tmp/test', executionId: 'test-exec' },
      events,
    });
  });

  it('should execute all waves in order', async () => {
    const tasks = createTasks();
    const waves = createWaves();

    const results = await coordinator.executeWaves(tasks, waves);

    expect(results).toHaveLength(4);
    expect(results.every(r => r.success)).toBe(true);
  });

  it('should preserve wave ordering', async () => {
    const tasks = createTasks();
    const waves = createWaves();

    const waveOrder: number[] = [];
    events.on('wave:start', (data: any) => {
      waveOrder.push(data.wave);
    });

    await coordinator.executeWaves(tasks, waves);

    expect(waveOrder).toEqual([1, 2, 3, 4]);
  });

  it('should emit events for each agent', async () => {
    const tasks = createTasks();
    const waves = createWaves();

    const agentStarts: string[] = [];
    const agentCompletes: string[] = [];

    events.on('agent:start', (data: any) => agentStarts.push(data.taskId));
    events.on('agent:complete', (data: any) => agentCompletes.push(data.taskId));

    await coordinator.executeWaves(tasks, waves);

    expect(agentStarts).toHaveLength(4);
    expect(agentCompletes).toHaveLength(4);
    expect(agentStarts).toContain('task-research');
    expect(agentStarts).toContain('task-dev');
  });

  it('should pass dependency context between waves', async () => {
    const tasks = createTasks();
    const waves = createWaves();

    const results = await coordinator.executeWaves(tasks, waves);

    // Later tasks should have results (not empty)
    const devResult = results.find(r => r.taskId === 'task-dev');
    expect(devResult).toBeDefined();
    expect(devResult!.response).toBeTruthy();
  });

  it('should handle parallel tasks in same wave', async () => {
    const tasks: DecomposedTask[] = [
      {
        id: 'task-a',
        role: 'developer',
        title: 'Task A',
        description: 'Parallel task A',
        dependencies: [],
        context: '',
        estimatedComplexity: 0.5,
        estimatedTokens: 3000,
      },
      {
        id: 'task-b',
        role: 'researcher',
        title: 'Task B',
        description: 'Parallel task B',
        dependencies: [],
        context: '',
        estimatedComplexity: 0.5,
        estimatedTokens: 3000,
      },
    ];

    const waves: PlanWave[] = [
      { waveNumber: 1, taskIds: ['task-a', 'task-b'], canParallelize: true },
    ];

    const results = await coordinator.executeWaves(tasks, waves);

    expect(results).toHaveLength(2);
    expect(results.every(r => r.success)).toBe(true);
  });

  it('should handle agent errors gracefully', async () => {
    // Create a provider that fails on specific tasks
    const failingProvider: LLMProvider = {
      ...createMockProvider(),
      async complete(request: LLMRequest): Promise<LLMResponse> {
        const content = request.messages[request.messages.length - 1].content;
        if (content.includes('Fail this')) {
          throw new Error('Simulated LLM failure');
        }
        return {
          content: 'Success',
          toolCalls: [],
          model: 'mock-model',
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          finishReason: 'stop',
        };
      },
    };

    const failCoordinator = new SwarmCoordinator({
      provider: failingProvider,
      tools: [],
      toolContext: { workingDir: '/tmp/test', executionId: 'test-exec' },
      events,
    });

    const tasks: DecomposedTask[] = [
      {
        id: 'task-fail',
        role: 'developer',
        title: 'Failing task',
        description: 'Fail this task',
        dependencies: [],
        context: '',
        estimatedComplexity: 0.5,
        estimatedTokens: 3000,
      },
    ];

    const waves: PlanWave[] = [
      { waveNumber: 1, taskIds: ['task-fail'], canParallelize: true },
    ];

    const results = await failCoordinator.executeWaves(tasks, waves);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });
});
