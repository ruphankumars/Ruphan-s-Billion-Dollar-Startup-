import { describe, it, expect, vi } from 'vitest';
import { SwarmCoordinator } from '../../../src/agents/coordinator.js';
import { MessageBus } from '../../../src/agents/message-bus.js';
import { EventBus } from '../../../src/core/events.js';

describe('SwarmCoordinator — Phase 5 MessageBus Integration', () => {
  function createMockProvider() {
    return {
      name: 'mock',
      models: ['mock-model'],
      defaultModel: 'mock-model',
      complete: vi.fn().mockResolvedValue({
        content: 'ok',
        model: 'mock-model',
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        finishReason: 'stop' as const,
      }),
      stream: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
      countTokens: vi.fn().mockReturnValue(10),
    };
  }

  it('should accept messageBus in options', () => {
    const bus = new MessageBus();
    const events = new EventBus();
    const provider = createMockProvider();

    const coordinator = new SwarmCoordinator({
      provider: provider as any,
      tools: [],
      toolContext: { workingDir: '/tmp', executionId: 'test' },
      events,
      messageBus: bus,
    });

    expect(coordinator).toBeDefined();
    bus.destroy();
  });

  it('should work without messageBus (backward compat)', () => {
    const events = new EventBus();
    const provider = createMockProvider();

    const coordinator = new SwarmCoordinator({
      provider: provider as any,
      tools: [],
      toolContext: { workingDir: '/tmp', executionId: 'test' },
      events,
    });

    expect(coordinator).toBeDefined();
  });

  it('should execute waves with in-process fallback', async () => {
    const events = new EventBus();
    const provider = createMockProvider();

    const coordinator = new SwarmCoordinator({
      provider: provider as any,
      tools: [],
      toolContext: { workingDir: '/tmp', executionId: 'test' },
      events,
      maxParallel: 2,
    });

    const tasks = [
      {
        id: 'task-1',
        title: 'Test task',
        description: 'Do something',
        role: 'developer',
        dependencies: [],
        priority: 1,
        estimatedComplexity: 0.3,
        requiredTools: [],
        context: '',
      },
    ];

    const waves = [{ waveNumber: 1, taskIds: ['task-1'], canParallelize: false }];

    const results = await coordinator.executeWaves(tasks, waves);
    expect(results.length).toBe(1);
    expect(results[0].taskId).toBe('task-1');
    expect(provider.complete).toHaveBeenCalled();
  });
});
