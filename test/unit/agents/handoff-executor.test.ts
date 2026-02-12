import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandoffExecutor } from '../../../src/agents/handoff-executor.js';
import { MessageBus } from '../../../src/agents/message-bus.js';
import { HandoffManager } from '../../../src/agents/handoff.js';

describe('HandoffExecutor', () => {
  let bus: MessageBus;
  let handoffManager: HandoffManager;

  function createMockProvider() {
    return {
      name: 'mock',
      models: ['mock-model'],
      defaultModel: 'mock-model',
      complete: vi.fn().mockResolvedValue({
        content: 'Handoff task completed',
        model: 'mock-model',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        finishReason: 'stop' as const,
      }),
      stream: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
      countTokens: vi.fn().mockReturnValue(10),
    };
  }

  beforeEach(() => {
    bus = new MessageBus();
    handoffManager = new HandoffManager(bus);
  });

  it('should start and stop without errors', async () => {
    const executor = new HandoffExecutor({
      provider: createMockProvider() as any,
      tools: [],
      toolContext: { workingDir: '/tmp', executionId: 'test' },
      messageBus: bus,
      handoffManager,
    });

    executor.start();
    await executor.stop();
  });

  it('should report initial stats', () => {
    const executor = new HandoffExecutor({
      provider: createMockProvider() as any,
      tools: [],
      toolContext: { workingDir: '/tmp', executionId: 'test' },
      messageBus: bus,
      handoffManager,
    });

    const stats = executor.getStats();
    expect(stats.activeHandoffs).toBe(0);
    expect(stats.completedHandoffs).toBe(0);
    expect(stats.maxConcurrent).toBe(3); // default
    expect(stats.avgDuration).toBe(0);
  });

  it('should not double-start', () => {
    const executor = new HandoffExecutor({
      provider: createMockProvider() as any,
      tools: [],
      toolContext: { workingDir: '/tmp', executionId: 'test' },
      messageBus: bus,
      handoffManager,
    });

    executor.start();
    executor.start(); // Should not throw

    // Clean up
    executor.stop();
  });

  it('should respect maxConcurrentHandoffs setting', () => {
    const executor = new HandoffExecutor({
      provider: createMockProvider() as any,
      tools: [],
      toolContext: { workingDir: '/tmp', executionId: 'test' },
      messageBus: bus,
      handoffManager,
      maxConcurrentHandoffs: 5,
    });

    expect(executor.getStats().maxConcurrent).toBe(5);
  });

  it('should return completed handoffs', async () => {
    const executor = new HandoffExecutor({
      provider: createMockProvider() as any,
      tools: [],
      toolContext: { workingDir: '/tmp', executionId: 'test' },
      messageBus: bus,
      handoffManager,
    });

    const completed = executor.getCompleted();
    expect(completed).toEqual([]);
  });
});

describe('HandoffManager', () => {
  it('should queue and complete handoffs', () => {
    const bus = new MessageBus();
    const manager = new HandoffManager(bus);

    const broadcastMessages: any[] = [];
    bus.subscribeAll((msg) => broadcastMessages.push(msg));

    manager.requestHandoff({
      fromAgent: 'dev-1',
      fromRole: 'developer',
      toRole: 'tester',
      task: { id: 'task-1', description: 'Test the feature', role: 'tester', dependencies: [], wave: 0 },
      reason: 'Implementation complete',
      context: 'Feature X',
    });

    expect(broadcastMessages.length).toBe(1);
    expect(broadcastMessages[0].type).toBe('handoff');

    const pending = manager.getAllPending();
    expect(pending.length).toBe(1);

    // Complete the handoff
    const handoffId = (broadcastMessages[0].payload as any).handoffId;
    manager.completeHandoff(handoffId, {
      taskId: 'task-1',
      success: true,
      response: 'Tests passed',
    });

    expect(manager.getAllPending().length).toBe(0);
    bus.destroy();
  });

  it('should get pending handoffs by role', () => {
    const bus = new MessageBus();
    const manager = new HandoffManager(bus);

    manager.requestHandoff({
      fromAgent: 'dev-1',
      fromRole: 'developer',
      toRole: 'tester',
      task: { id: 'task-1', description: 'Test', role: 'tester', dependencies: [], wave: 0 },
      reason: 'test',
      context: '',
    });

    manager.requestHandoff({
      fromAgent: 'dev-2',
      fromRole: 'developer',
      toRole: 'reviewer',
      task: { id: 'task-2', description: 'Review', role: 'validator', dependencies: [], wave: 0 },
      reason: 'review',
      context: '',
    });

    expect(manager.getPendingForRole('tester').length).toBe(1);
    expect(manager.getPendingForRole('reviewer').length).toBe(1);
    expect(manager.getPendingForRole('developer').length).toBe(0);

    bus.destroy();
  });

  it('should clear all pending handoffs', () => {
    const bus = new MessageBus();
    const manager = new HandoffManager(bus);

    manager.requestHandoff({
      fromAgent: 'dev-1',
      fromRole: 'developer',
      toRole: 'tester',
      task: { id: 'task-1', description: 'Test', role: 'tester', dependencies: [], wave: 0 },
      reason: 'test',
      context: '',
    });

    manager.clear();
    expect(manager.getAllPending().length).toBe(0);

    bus.destroy();
  });
});
