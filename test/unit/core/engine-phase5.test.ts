import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CortexEngine } from '../../../src/core/engine.js';
import { PluginRegistry, type CortexPlugin, type PluginContext } from '../../../src/plugins/registry.js';
import { QualityVerifier } from '../../../src/quality/verifier.js';
import type { Tool, ToolResult } from '../../../src/tools/types.js';

// Mock the provider registry to avoid needing real API keys
vi.mock('../../../src/providers/registry.js', () => ({
  ProviderRegistry: {
    create: vi.fn().mockResolvedValue({
      getDefault: vi.fn().mockReturnValue(undefined),
      has: vi.fn().mockReturnValue(false),
      register: vi.fn(),
      listAvailable: vi.fn().mockReturnValue([]),
    }),
  },
}));

// Mock memory manager (it touches filesystem)
vi.mock('../../../src/memory/manager.js', () => ({
  CortexMemoryManager: {
    create: vi.fn().mockReturnValue({
      recall: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

function createMockConfig() {
  return {
    providers: {
      anthropicApiKey: '',
      openaiApiKey: '',
      default: 'anthropic',
    },
    memory: { enabled: false },
    agents: {
      maxParallel: 2,
      maxIterations: 10,
      worktreesEnabled: false,
      useChildProcess: false,
    },
    cost: {
      budgetPerRun: 5.0,
      budgetPerDay: 50.0,
      preferCheap: false,
      cacheEnabled: true,
    },
    quality: { gates: ['syntax', 'lint'] },
    globalDir: '/tmp/cortexos-test',
  };
}

describe('CortexEngine Phase 5 — Plugin Wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have plugin registry accessible', () => {
    const engine = CortexEngine.create({
      config: createMockConfig() as any,
      projectDir: '/tmp/test-project',
    });

    const registry = engine.getPluginRegistry();
    expect(registry).toBeInstanceOf(PluginRegistry);
    expect(registry.listPlugins().length).toBe(0);
  });

  it('should have message bus accessible', () => {
    const engine = CortexEngine.create({
      config: createMockConfig() as any,
      projectDir: '/tmp/test-project',
    });

    const bus = engine.getMessageBus();
    expect(bus).toBeDefined();
    expect(bus.send).toBeDefined();
    expect(bus.subscribe).toBeDefined();
  });

  it('should have null handoff executor before initialization', () => {
    const engine = CortexEngine.create({
      config: createMockConfig() as any,
      projectDir: '/tmp/test-project',
    });

    expect(engine.getHandoffExecutor()).toBeNull();
  });

  it('should support loading plugins into the registry', async () => {
    const engine = CortexEngine.create({
      config: createMockConfig() as any,
      projectDir: '/tmp/test-project',
    });

    const mockTool: Tool = {
      name: 'plugin-tool',
      description: 'A plugin tool',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn().mockResolvedValue({ success: true, output: 'ok' } as ToolResult),
    };

    const plugin: CortexPlugin = {
      name: 'test-plugin',
      version: '1.0.0',
      register(ctx: PluginContext) {
        ctx.registerTool(mockTool);
      },
    };

    await engine.getPluginRegistry().load(plugin);
    expect(engine.getPluginRegistry().isLoaded('test-plugin')).toBe(true);
    expect(engine.getPluginRegistry().getTools().length).toBe(1);
  });

  it('should shutdown cleanly without errors', async () => {
    const engine = CortexEngine.create({
      config: createMockConfig() as any,
      projectDir: '/tmp/test-project',
    });

    // Should not throw even without initialization
    await expect(engine.shutdown()).resolves.not.toThrow();
  });

  it('should have tracer and metrics accessible', () => {
    const engine = CortexEngine.create({
      config: createMockConfig() as any,
      projectDir: '/tmp/test-project',
    });

    expect(engine.getTracer()).toBeDefined();
    expect(engine.getMetrics()).toBeDefined();
    expect(engine.getEventBus()).toBeDefined();
  });
});

describe('QualityVerifier — Dynamic Gate Addition', () => {
  it('should add a gate dynamically', () => {
    const verifier = new QualityVerifier([]);
    expect(verifier.getEnabledGates().length).toBe(0);

    const mockGate = {
      name: 'custom-gate',
      run: vi.fn().mockResolvedValue({
        gate: 'custom-gate',
        passed: true,
        issues: [],
        duration: 0,
      }),
    };

    verifier.addGate('custom-gate', mockGate);
    expect(verifier.getEnabledGates()).toContain('custom-gate');
  });

  it('should not add duplicate gates', () => {
    const verifier = new QualityVerifier(['syntax']);
    const initialCount = verifier.getEnabledGates().length;

    const mockGate = {
      name: 'syntax',
      run: vi.fn(),
    };

    verifier.addGate('syntax', mockGate);
    expect(verifier.getEnabledGates().length).toBe(initialCount);
  });

  it('should run dynamically added gates during verify', async () => {
    const verifier = new QualityVerifier([]);
    const mockGate = {
      name: 'test-gate',
      run: vi.fn().mockResolvedValue({
        gate: 'test-gate',
        passed: true,
        issues: [],
        duration: 10,
      }),
    };

    verifier.addGate('test-gate', mockGate);

    const report = await verifier.verify({
      workingDir: '/tmp',
      filesChanged: ['test.ts'],
      executionId: 'test-exec',
    });

    expect(mockGate.run).toHaveBeenCalled();
    expect(report.passed).toBe(true);
  });
});
