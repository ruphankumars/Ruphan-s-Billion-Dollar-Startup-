/**
 * Integration test: Engine wiring — plugins, handoffs, messaging, IPC.
 * Tests the Phase 5 integration of subsystems within CortexEngine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CortexEngine } from '../../src/core/engine.js';
import { PluginRegistry, type CortexPlugin, type PluginContext } from '../../src/plugins/registry.js';
import { MessageBus } from '../../src/agents/message-bus.js';
import { HandoffManager } from '../../src/agents/handoff.js';
import { HandoffExecutor } from '../../src/agents/handoff-executor.js';
import { QualityVerifier } from '../../src/quality/verifier.js';
import type { Tool, ToolResult } from '../../src/tools/types.js';

// Mock provider registry
vi.mock('../../src/providers/registry.js', () => ({
  ProviderRegistry: {
    create: vi.fn().mockResolvedValue({
      getDefault: vi.fn().mockReturnValue(undefined),
      has: vi.fn().mockReturnValue(false),
      register: vi.fn(),
      listAvailable: vi.fn().mockReturnValue([]),
    }),
  },
}));

vi.mock('../../src/memory/manager.js', () => ({
  CortexMemoryManager: {
    create: vi.fn().mockReturnValue({
      recall: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    providers: { anthropicApiKey: '', openaiApiKey: '', default: 'anthropic' },
    memory: { enabled: false },
    agents: {
      maxParallel: 2,
      maxIterations: 10,
      worktreesEnabled: false,
      useChildProcess: false,
    },
    cost: { budgetPerRun: 5.0, budgetPerDay: 50.0, preferCheap: false, cacheEnabled: true },
    quality: { gates: ['syntax'] },
    globalDir: '/tmp/cortexos-test',
    ...overrides,
  };
}

describe('Engine Wiring Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should wire all subsystems on create', () => {
    const engine = CortexEngine.create({
      config: createConfig() as any,
      projectDir: '/tmp/test-project',
    });

    // All accessors should return valid objects
    expect(engine.getEventBus()).toBeDefined();
    expect(engine.getTracer()).toBeDefined();
    expect(engine.getMetrics()).toBeDefined();
    expect(engine.getPluginRegistry()).toBeDefined();
    expect(engine.getMessageBus()).toBeDefined();
  });

  it('should support full plugin lifecycle: load → use → unload', async () => {
    const engine = CortexEngine.create({
      config: createConfig() as any,
      projectDir: '/tmp/test-project',
    });

    const executeFn = vi.fn().mockResolvedValue({ success: true, output: 'ok' } as ToolResult);
    const unloadFn = vi.fn();

    const plugin: CortexPlugin = {
      name: 'lifecycle-plugin',
      version: '1.0.0',
      register(ctx: PluginContext) {
        ctx.registerTool({
          name: 'lifecycle-tool',
          description: 'Test tool',
          parameters: { type: 'object', properties: {}, required: [] },
          execute: executeFn,
        });
        ctx.registerGate('lifecycle-gate', {
          name: 'lifecycle-gate',
          run: vi.fn().mockResolvedValue({
            gate: 'lifecycle-gate',
            passed: true,
            issues: [],
            duration: 0,
          }),
        });
      },
      unload: unloadFn,
    };

    const registry = engine.getPluginRegistry();

    // Load
    await registry.load(plugin);
    expect(registry.isLoaded('lifecycle-plugin')).toBe(true);
    expect(registry.getTools().length).toBe(1);
    expect(registry.getGates().has('lifecycle-gate')).toBe(true);

    // Unload
    await registry.unload('lifecycle-plugin');
    expect(registry.isLoaded('lifecycle-plugin')).toBe(false);
    expect(registry.getTools().length).toBe(0);
    expect(unloadFn).toHaveBeenCalled();
  });

  it('should support message bus pub/sub', () => {
    const engine = CortexEngine.create({
      config: createConfig() as any,
      projectDir: '/tmp/test-project',
    });

    const bus = engine.getMessageBus();
    const received: any[] = [];

    bus.subscribe('coordinator', (msg) => received.push(msg));

    bus.send({
      from: 'agent-1',
      to: 'coordinator',
      type: 'status',
      payload: { progress: 50 },
    });

    expect(received.length).toBe(1);
    expect(received[0].from).toBe('agent-1');
    expect(received[0].payload).toEqual({ progress: 50 });
  });

  it('should support handoff manager request flow', () => {
    const engine = CortexEngine.create({
      config: createConfig() as any,
      projectDir: '/tmp/test-project',
    });

    const bus = engine.getMessageBus();
    const handoffManager = new HandoffManager(bus);
    const broadcastMessages: any[] = [];

    bus.subscribeAll((msg) => broadcastMessages.push(msg));

    handoffManager.requestHandoff({
      fromAgent: 'dev-1',
      fromRole: 'developer',
      toRole: 'tester',
      task: {
        id: 'task-test',
        description: 'Write tests for the feature',
        role: 'tester',
        dependencies: [],
        wave: 0,
      },
      reason: 'Implementation complete, needs testing',
      context: 'Feature X is implemented in src/feature.ts',
    });

    expect(broadcastMessages.length).toBe(1);
    expect(broadcastMessages[0].type).toBe('handoff');
  });

  it('should properly destroy message bus on shutdown', async () => {
    const engine = CortexEngine.create({
      config: createConfig() as any,
      projectDir: '/tmp/test-project',
    });

    const bus = engine.getMessageBus();
    const received: any[] = [];
    bus.subscribe('test-agent', (msg) => received.push(msg));

    // Send before shutdown — should work
    bus.send({ from: 'a', to: 'test-agent', type: 'status', payload: {} });
    expect(received.length).toBe(1);

    await engine.shutdown();

    // After shutdown, bus is destroyed — listeners removed
    bus.send({ from: 'a', to: 'test-agent', type: 'status', payload: {} });
    expect(received.length).toBe(1); // No new messages received
  });

  it('should track metrics on tracer', () => {
    const engine = CortexEngine.create({
      config: createConfig() as any,
      projectDir: '/tmp/test-project',
    });

    const tracer = engine.getTracer();
    const metrics = engine.getMetrics();

    // Tracer should start clean
    expect(tracer.getActiveTrace()).toBeUndefined();
    expect(tracer.getAllTraces().length).toBe(0);

    // Metrics should be empty
    const agg = metrics.aggregate();
    expect(agg.totalRuns).toBe(0);
  });

  it('should support plugin middleware execution', async () => {
    const engine = CortexEngine.create({
      config: createConfig() as any,
      projectDir: '/tmp/test-project',
    });

    const registry = engine.getPluginRegistry();

    const plugin: CortexPlugin = {
      name: 'middleware-plugin',
      version: '1.0.0',
      register(ctx: PluginContext) {
        ctx.registerMiddleware('pre-execute', (data: unknown) => ({
          ...(data as object),
          pluginEnhanced: true,
        }));
      },
    };

    await registry.load(plugin);

    const result = await registry.runMiddleware('pre-execute', { prompt: 'test' });
    expect(result).toEqual({ prompt: 'test', pluginEnhanced: true });
  });
});
