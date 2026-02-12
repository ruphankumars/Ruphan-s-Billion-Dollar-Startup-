/**
 * Phase 3 Engine Integration Tests
 * Tests coordinator wiring, pool shutdown, and new features.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CortexEngine } from '../../../src/core/engine.js';
import type { CortexConfig } from '../../../src/core/types.js';

// Mock all external dependencies
vi.mock('../../../src/providers/registry.js', () => ({
  ProviderRegistry: {
    create: vi.fn().mockResolvedValue({
      getDefault: vi.fn().mockReturnValue({
        name: 'mock',
        models: ['mock-model'],
        defaultModel: 'mock-model',
        complete: vi.fn().mockResolvedValue({
          content: 'test response',
          toolCalls: [],
          model: 'mock-model',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          finishReason: 'stop',
        }),
        stream: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(true),
        countTokens: vi.fn().mockReturnValue(10),
      }),
      listAvailable: vi.fn().mockReturnValue(['mock']),
    }),
  },
}));

vi.mock('../../../src/memory/manager.js', () => ({
  CortexMemoryManager: {
    create: vi.fn().mockReturnValue({
      recall: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getStats: vi.fn().mockResolvedValue({ totalMemories: 0, byType: {}, averageImportance: 0 }),
    }),
  },
}));

// Mock git to prevent worktree checks from hitting real git
vi.mock('../../../src/utils/git.js', () => ({
  isGitRepo: vi.fn().mockReturnValue(false),
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  mergeBranch: vi.fn(),
  deleteBranch: vi.fn(),
  getCurrentBranch: vi.fn().mockReturnValue('main'),
  gitExec: vi.fn().mockReturnValue(''),
}));

function createConfig(overrides: Partial<CortexConfig> = {}): CortexConfig {
  return {
    providers: {
      default: 'mock',
    },
    agents: {
      maxParallel: 2,
      worktreesEnabled: false,
    },
    memory: {
      enabled: false,
    },
    quality: {
      gates: [],
    },
    cost: {
      budgetPerRun: 5.0,
      budgetPerDay: 50.0,
    },
    ...overrides,
  } as CortexConfig;
}

describe('CortexEngine Phase 3 Integration', () => {
  it('should create engine with default config', () => {
    const engine = CortexEngine.create({
      config: createConfig(),
      projectDir: '/tmp/test',
    });

    expect(engine).toBeDefined();
    expect(engine.getEventBus()).toBeDefined();
  });

  it('should shutdown cleanly', async () => {
    const engine = CortexEngine.create({
      config: createConfig(),
      projectDir: '/tmp/test',
    });

    // Should not throw
    await engine.shutdown();
  });

  it('should emit events during execution', async () => {
    const engine = CortexEngine.create({
      config: createConfig(),
      projectDir: '/tmp/test',
    });

    const events: string[] = [];
    const bus = engine.getEventBus();
    bus.on('engine:start', () => events.push('engine:start'));
    bus.on('stage:start', (data: any) => events.push(`stage:${data.stage}`));
    bus.on('engine:complete', () => events.push('engine:complete'));

    await engine.execute('test prompt');

    expect(events).toContain('engine:start');
    expect(events).toContain('stage:recall');
    expect(events).toContain('stage:analyze');
    expect(events).toContain('engine:complete');
  });

  it('should return valid execution result', async () => {
    const engine = CortexEngine.create({
      config: createConfig(),
      projectDir: '/tmp/test',
    });

    const result = await engine.execute('add a simple utility function');

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('response');
    expect(result).toHaveProperty('filesChanged');
    expect(result).toHaveProperty('plan');
    expect(result).toHaveProperty('quality');
    expect(result).toHaveProperty('cost');
    expect(result).toHaveProperty('duration');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should handle errors gracefully', async () => {
    const engine = CortexEngine.create({
      config: createConfig(),
      projectDir: '/tmp/test',
    });

    // Should not throw even with broken prompt
    const result = await engine.execute('');

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('response');
    expect(result).toHaveProperty('duration');
  });

  it('should disable memory when config says so', async () => {
    const engine = CortexEngine.create({
      config: createConfig({ memory: { enabled: false } }),
      projectDir: '/tmp/test',
    });

    const result = await engine.execute('test');
    expect(result.memoriesRecalled).toBe(0);
    expect(result.memoriesStored).toBe(0);
  });
});
