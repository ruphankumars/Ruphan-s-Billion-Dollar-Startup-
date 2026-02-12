import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from '../../../src/tools/registry.js';
import type { Tool, ToolResult } from '../../../src/tools/types.js';

function createMockTool(name: string, description = 'A mock tool'): Tool {
  return {
    name,
    description,
    parameters: { type: 'object', properties: { input: { type: 'string' } }, required: [] },
    execute: vi.fn().mockResolvedValue({ success: true, output: 'ok' } as ToolResult),
  };
}

describe('ToolRegistry', () => {
  it('should register and retrieve a tool', () => {
    const registry = new ToolRegistry();
    const tool = createMockTool('my-tool');

    registry.register(tool);
    expect(registry.has('my-tool')).toBe(true);
    expect(registry.get('my-tool')).toBe(tool);
  });

  it('should list all registered tools', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('tool-a'));
    registry.register(createMockTool('tool-b'));

    const tools = registry.list();
    expect(tools.length).toBe(2);
    expect(tools.map(t => t.name)).toContain('tool-a');
    expect(tools.map(t => t.name)).toContain('tool-b');
  });

  it('should throw when getting non-existent tool', () => {
    const registry = new ToolRegistry();
    expect(() => registry.get('nonexistent')).toThrow('Tool "nonexistent" not found');
  });

  it('should return false for has() on non-existent tool', () => {
    const registry = new ToolRegistry();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('should generate tool definitions', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('my-tool', 'Does something'));

    const defs = registry.getDefinitions();
    expect(defs.length).toBe(1);
    expect(defs[0].name).toBe('my-tool');
    expect(defs[0].description).toBe('Does something');
    expect(defs[0].parameters).toBeDefined();
  });

  it('should generate definitions for specific names', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('tool-a'));
    registry.register(createMockTool('tool-b'));
    registry.register(createMockTool('tool-c'));

    const defs = registry.getDefinitionsForNames(['tool-a', 'tool-c', 'nonexistent']);
    expect(defs.length).toBe(2);
    expect(defs.map(d => d.name)).toContain('tool-a');
    expect(defs.map(d => d.name)).toContain('tool-c');
  });

  it('should create default registry with built-in tools', () => {
    const registry = ToolRegistry.createDefault();
    const tools = registry.list();

    expect(tools.length).toBe(5);
    const names = tools.map(t => t.name);
    expect(names).toContain('file_read');
    expect(names).toContain('file_write');
    expect(names).toContain('file_search');
    expect(names).toContain('shell');
    expect(names).toContain('git');
  });

  it('should override tool on re-registration', () => {
    const registry = new ToolRegistry();
    const tool1 = createMockTool('my-tool', 'Version 1');
    const tool2 = createMockTool('my-tool', 'Version 2');

    registry.register(tool1);
    registry.register(tool2);

    expect(registry.get('my-tool').description).toBe('Version 2');
    expect(registry.list().length).toBe(1);
  });
});
