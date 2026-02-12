import { describe, it, expect, vi } from 'vitest';
import { PluginRegistry, type CortexPlugin, type PluginContext } from '../../../src/plugins/registry.js';
import type { Tool, ToolResult, ToolContext } from '../../../src/tools/types.js';

function createMockTool(name: string): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: vi.fn().mockResolvedValue({ success: true, output: 'ok' } as ToolResult),
  };
}

function createMockPlugin(name: string, setup?: (ctx: PluginContext) => void): CortexPlugin {
  return {
    name,
    version: '1.0.0',
    register(ctx: PluginContext) {
      if (setup) setup(ctx);
    },
  };
}

describe('PluginRegistry', () => {
  it('should load a plugin', async () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin('test-plugin');

    await registry.load(plugin);

    expect(registry.isLoaded('test-plugin')).toBe(true);
    expect(registry.listPlugins().length).toBe(1);
    expect(registry.listPlugins()[0].name).toBe('test-plugin');
  });

  it('should register tools via plugin', async () => {
    const registry = new PluginRegistry();
    const tool = createMockTool('custom-lint');

    const plugin = createMockPlugin('lint-plugin', (ctx) => {
      ctx.registerTool(tool);
    });

    await registry.load(plugin);

    const tools = registry.getTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('custom-lint');
    expect(registry.getTool('custom-lint')).toBeDefined();
  });

  it('should register providers via plugin', async () => {
    const registry = new PluginRegistry();
    const mockProvider = {
      name: 'custom-llm',
      models: ['model-1'],
      defaultModel: 'model-1',
      complete: vi.fn(),
      stream: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
      countTokens: vi.fn(),
    };

    const plugin = createMockPlugin('provider-plugin', (ctx) => {
      ctx.registerProvider('custom-llm', mockProvider);
    });

    await registry.load(plugin);

    const providers = registry.getProviders();
    expect(providers.has('custom-llm')).toBe(true);
  });

  it('should register quality gates via plugin', async () => {
    const registry = new PluginRegistry();
    const mockGate = {
      name: 'custom-gate',
      description: 'Custom quality gate',
      run: vi.fn(),
    };

    const plugin = createMockPlugin('gate-plugin', (ctx) => {
      ctx.registerGate('custom-gate', mockGate);
    });

    await registry.load(plugin);

    const gates = registry.getGates();
    expect(gates.has('custom-gate')).toBe(true);
  });

  it('should register roles via plugin', async () => {
    const registry = new PluginRegistry();

    const plugin = createMockPlugin('role-plugin', (ctx) => {
      ctx.registerRole('security-auditor', {
        systemPrompt: 'You are a security auditor.',
        defaultModel: 'claude-3-sonnet',
        defaultTools: ['file_read', 'shell'],
      });
    });

    await registry.load(plugin);

    const roles = registry.getRoles();
    expect(roles.has('security-auditor')).toBe(true);
    expect(roles.get('security-auditor')?.systemPrompt).toContain('security auditor');
  });

  it('should register and run middleware', async () => {
    const registry = new PluginRegistry();
    const handler = vi.fn((data: unknown) => ({ ...data as object, enhanced: true }));

    const plugin = createMockPlugin('mw-plugin', (ctx) => {
      ctx.registerMiddleware('pre-execute', handler);
    });

    await registry.load(plugin);

    const result = await registry.runMiddleware('pre-execute', { prompt: 'test' });
    expect(handler).toHaveBeenCalled();
    expect(result).toEqual({ prompt: 'test', enhanced: true });
  });

  it('should unload a plugin and remove registrations', async () => {
    const registry = new PluginRegistry();
    const tool = createMockTool('temp-tool');

    const plugin = createMockPlugin('temp-plugin', (ctx) => {
      ctx.registerTool(tool);
    });
    plugin.unload = vi.fn();

    await registry.load(plugin);
    expect(registry.getTools().length).toBe(1);

    await registry.unload('temp-plugin');
    expect(registry.isLoaded('temp-plugin')).toBe(false);
    expect(registry.getTools().length).toBe(0);
    expect(plugin.unload).toHaveBeenCalled();
  });

  it('should replace plugin on reload', async () => {
    const registry = new PluginRegistry();
    const unload = vi.fn();

    const pluginV1 = createMockPlugin('my-plugin', (ctx) => {
      ctx.registerTool(createMockTool('tool-v1'));
    });
    pluginV1.unload = unload;

    const pluginV2: CortexPlugin = {
      name: 'my-plugin',
      version: '2.0.0',
      register(ctx) {
        ctx.registerTool(createMockTool('tool-v2'));
      },
    };

    await registry.load(pluginV1);
    expect(registry.getTool('tool-v1')).toBeDefined();

    await registry.load(pluginV2);
    expect(unload).toHaveBeenCalled();
    expect(registry.getTool('tool-v1')).toBeUndefined();
    expect(registry.getTool('tool-v2')).toBeDefined();
  });

  it('should access plugin config', async () => {
    const config = {
      plugins: {
        'my-plugin': {
          apiUrl: 'https://example.com',
          maxRetries: 3,
        },
      },
    };

    const registry = new PluginRegistry(config);
    let capturedConfig: unknown;

    const plugin = createMockPlugin('my-plugin', (ctx) => {
      capturedConfig = ctx.getConfig('apiUrl');
    });

    await registry.load(plugin);
    expect(capturedConfig).toBe('https://example.com');
  });

  it('should list plugin details', async () => {
    const registry = new PluginRegistry();

    const plugin = createMockPlugin('test-plugin', (ctx) => {
      ctx.registerTool(createMockTool('t1'));
      ctx.registerTool(createMockTool('t2'));
      ctx.registerGate('g1', { name: 'g1', description: 'test', run: vi.fn() });
    });

    await registry.load(plugin);

    const list = registry.listPlugins();
    expect(list.length).toBe(1);
    expect(list[0].tools).toEqual(['t1', 't2']);
    expect(list[0].gates).toEqual(['g1']);
    expect(list[0].loadedAt).toBeGreaterThan(0);
  });

  it('should handle plugin registration failure', async () => {
    const registry = new PluginRegistry();

    const badPlugin: CortexPlugin = {
      name: 'bad-plugin',
      version: '1.0.0',
      register() {
        throw new Error('Registration failed');
      },
    };

    await expect(registry.load(badPlugin)).rejects.toThrow('Registration failed');
    expect(registry.isLoaded('bad-plugin')).toBe(false);
  });

  it('should return empty data for middleware with no handlers', async () => {
    const registry = new PluginRegistry();
    const result = await registry.runMiddleware('pre-execute', { data: 'test' });
    expect(result).toEqual({ data: 'test' });
  });
});
