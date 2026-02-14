import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPServer } from '../../../src/mcp/mcp-server.js';
import type { JSONRPCRequest } from '../../../src/mcp/types.js';

describe('MCPServer', () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer();
  });

  // ── Constructor ──

  describe('constructor', () => {
    it('should create an instance with default options', () => {
      expect(server).toBeDefined();
      expect(server.isRunning()).toBe(false);
      expect(server.getTools()).toEqual([]);
      expect(server.getResources()).toEqual([]);
      expect(server.getPrompts()).toEqual([]);
    });

    it('should accept custom options', () => {
      const custom = new MCPServer({
        name: 'test-server',
        version: '2.0.0',
        transport: 'http',
        port: 4000,
        hostname: '127.0.0.1',
      });

      const stats = custom.getStats();
      expect(stats.transport).toBe('http');
      expect(stats.isRunning).toBe(false);
    });
  });

  // ── Tool Registration ──

  describe('registerTool', () => {
    it('should add a tool that appears in getTools()', () => {
      server.registerTool({
        name: 'my_tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
      });

      const tools = server.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('my_tool');
      expect(tools[0].description).toBe('A test tool');
      expect(tools[0].serverId).toBe('cortexos');
    });

    it('should add multiple tools', () => {
      server.registerTool({
        name: 'tool_a',
        description: 'Tool A',
        inputSchema: { type: 'object' },
      });
      server.registerTool({
        name: 'tool_b',
        description: 'Tool B',
        inputSchema: { type: 'object' },
      });

      expect(server.getTools()).toHaveLength(2);
    });
  });

  describe('removeTool', () => {
    it('should remove a registered tool', () => {
      server.registerTool({
        name: 'remove_me',
        description: 'Will be removed',
        inputSchema: { type: 'object' },
      });

      expect(server.getTools()).toHaveLength(1);
      const removed = server.removeTool('remove_me');
      expect(removed).toBe(true);
      expect(server.getTools()).toHaveLength(0);
    });

    it('should return false for non-existent tool', () => {
      const removed = server.removeTool('nonexistent');
      expect(removed).toBe(false);
    });
  });

  // ── Resource Registration ──

  describe('registerResource', () => {
    it('should add a resource that appears in getResources()', () => {
      server.registerResource({
        uri: 'cortexos://test',
        name: 'Test Resource',
        description: 'A test resource',
        mimeType: 'application/json',
      });

      const resources = server.getResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe('cortexos://test');
      expect(resources[0].name).toBe('Test Resource');
      expect(resources[0].serverId).toBe('cortexos');
    });
  });

  describe('removeResource', () => {
    it('should remove a registered resource', () => {
      server.registerResource({
        uri: 'cortexos://removable',
        name: 'Removable',
      });
      const removed = server.removeResource('cortexos://removable');
      expect(removed).toBe(true);
      expect(server.getResources()).toHaveLength(0);
    });
  });

  // ── Prompt Registration ──

  describe('registerPrompt', () => {
    it('should add a prompt that appears in getPrompts()', () => {
      server.registerPrompt({
        name: 'test_prompt',
        description: 'A test prompt',
        arguments: [
          { name: 'task', description: 'The task', required: true },
        ],
      });

      const prompts = server.getPrompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe('test_prompt');
      expect(prompts[0].description).toBe('A test prompt');
      expect(prompts[0].serverId).toBe('cortexos');
    });
  });

  describe('removePrompt', () => {
    it('should remove a registered prompt', () => {
      server.registerPrompt({
        name: 'removable_prompt',
        description: 'Will be removed',
      });
      const removed = server.removePrompt('removable_prompt');
      expect(removed).toBe(true);
      expect(server.getPrompts()).toHaveLength(0);
    });
  });

  // ── handleRequest: initialize ──

  describe('handleRequest — initialize', () => {
    it('should return server info and capabilities', async () => {
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test-client' }, protocolVersion: '2024-11-05' },
      };

      const response = await server.handleRequest(request);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.error).toBeUndefined();

      const result = response.result as {
        protocolVersion: string;
        serverInfo: { name: string; version: string };
        capabilities: Record<string, unknown>;
      };

      expect(result.protocolVersion).toBe('2024-11-05');
      expect(result.serverInfo.name).toBe('cortexos');
      expect(result.serverInfo.version).toBe('1.0.0');
      expect(result.capabilities).toBeDefined();
      expect(result.capabilities.tools).toBeDefined();
      expect(result.capabilities.resources).toBeDefined();
      expect(result.capabilities.prompts).toBeDefined();
    });

    it('should emit client connected event', async () => {
      const listener = vi.fn();
      server.on('mcp:server:client:connected', listener);

      await server.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test' } },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          clientInfo: { name: 'test' },
        }),
      );
    });
  });

  // ── handleRequest: tools/list ──

  describe('handleRequest — tools/list', () => {
    it('should return empty list when no tools registered', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });

      const result = response.result as { tools: unknown[] };
      expect(result.tools).toEqual([]);
    });

    it('should return registered tools', async () => {
      server.registerTool({
        name: 'echo',
        description: 'Echo input',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      });

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      });

      const result = response.result as { tools: Array<{ name: string; description: string }> };
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('echo');
      expect(result.tools[0].description).toBe('Echo input');
    });
  });

  // ── handleRequest: tools/call ──

  describe('handleRequest — tools/call', () => {
    it('should call the handler and return result', async () => {
      const toolHandler = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result from tool' }],
      });

      server.setToolHandler(toolHandler);
      server.registerTool({
        name: 'test_tool',
        description: 'A tool',
        inputSchema: { type: 'object' },
      });

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'test_tool', arguments: { key: 'value' } },
      });

      expect(response.error).toBeUndefined();
      expect(toolHandler).toHaveBeenCalledWith('test_tool', { key: 'value' });

      const result = response.result as { content: Array<{ type: string; text: string }> };
      expect(result.content[0].text).toBe('result from tool');
    });

    it('should return error for unknown tool', async () => {
      server.setToolHandler(vi.fn());

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'nonexistent' },
      });

      expect(response.error).toBeDefined();
      expect(response.error!.message).toContain('Tool not found');
    });

    it('should return error when no tool handler is set', async () => {
      server.registerTool({
        name: 'no_handler_tool',
        description: 'No handler',
        inputSchema: { type: 'object' },
      });

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'no_handler_tool' },
      });

      expect(response.error).toBeDefined();
      expect(response.error!.message).toContain('No tool handler registered');
    });

    it('should emit tool invoked event', async () => {
      const listener = vi.fn();
      server.on('mcp:server:tool:invoked', listener);

      server.setToolHandler(vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      }));
      server.registerTool({
        name: 'event_tool',
        description: 'Emits event',
        inputSchema: { type: 'object' },
      });

      await server.handleRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'event_tool', arguments: { x: 1 } },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'event_tool', args: { x: 1 } }),
      );
    });

    it('should increment toolInvocations stat', async () => {
      server.setToolHandler(vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      }));
      server.registerTool({
        name: 'stat_tool',
        description: 'Stats',
        inputSchema: { type: 'object' },
      });

      await server.handleRequest({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'stat_tool' },
      });

      expect(server.getStats().toolInvocations).toBe(1);
    });
  });

  // ── handleRequest: resources/list ──

  describe('handleRequest — resources/list', () => {
    it('should return registered resources', async () => {
      server.registerResource({
        uri: 'cortexos://config',
        name: 'Config',
        description: 'The config',
        mimeType: 'application/json',
      });

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 9,
        method: 'resources/list',
      });

      const result = response.result as { resources: Array<{ uri: string; name: string }> };
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].uri).toBe('cortexos://config');
      expect(result.resources[0].name).toBe('Config');
    });
  });

  // ── handleRequest: resources/read ──

  describe('handleRequest — resources/read', () => {
    it('should call the handler and return content', async () => {
      const resourceHandler = vi.fn().mockResolvedValue({
        contents: [{ uri: 'cortexos://data', text: '{"key":"val"}', mimeType: 'application/json' }],
      });

      server.setResourceHandler(resourceHandler);
      server.registerResource({
        uri: 'cortexos://data',
        name: 'Data',
      });

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 10,
        method: 'resources/read',
        params: { uri: 'cortexos://data' },
      });

      expect(response.error).toBeUndefined();
      expect(resourceHandler).toHaveBeenCalledWith('cortexos://data');

      const result = response.result as { contents: Array<{ uri: string; text: string }> };
      expect(result.contents[0].text).toBe('{"key":"val"}');
    });

    it('should return error for unknown resource', async () => {
      server.setResourceHandler(vi.fn());

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 11,
        method: 'resources/read',
        params: { uri: 'cortexos://unknown' },
      });

      expect(response.error).toBeDefined();
      expect(response.error!.message).toContain('Resource not found');
    });

    it('should return error when no resource handler is set', async () => {
      server.registerResource({
        uri: 'cortexos://no-handler',
        name: 'No Handler',
      });

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 12,
        method: 'resources/read',
        params: { uri: 'cortexos://no-handler' },
      });

      expect(response.error).toBeDefined();
      expect(response.error!.message).toContain('No resource handler registered');
    });

    it('should increment resourceReads stat', async () => {
      server.setResourceHandler(vi.fn().mockResolvedValue({
        contents: [{ uri: 'cortexos://stat', text: 'data' }],
      }));
      server.registerResource({
        uri: 'cortexos://stat',
        name: 'Stat',
      });

      await server.handleRequest({
        jsonrpc: '2.0',
        id: 13,
        method: 'resources/read',
        params: { uri: 'cortexos://stat' },
      });

      expect(server.getStats().resourceReads).toBe(1);
    });
  });

  // ── handleRequest: prompts/list ──

  describe('handleRequest — prompts/list', () => {
    it('should return registered prompts', async () => {
      server.registerPrompt({
        name: 'debug_prompt',
        description: 'Debug',
        arguments: [
          { name: 'error', description: 'The error', required: true },
        ],
      });

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 14,
        method: 'prompts/list',
      });

      const result = response.result as { prompts: Array<{ name: string; description?: string }> };
      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0].name).toBe('debug_prompt');
      expect(result.prompts[0].description).toBe('Debug');
    });
  });

  // ── handleRequest: prompts/get ──

  describe('handleRequest — prompts/get', () => {
    it('should call the prompt handler and return result', async () => {
      const promptHandler = vi.fn().mockResolvedValue({
        description: 'Debugging prompt',
        messages: [
          { role: 'user', content: { type: 'text', text: 'Debug this error: test error' } },
        ],
      });

      server.setPromptHandler(promptHandler);
      server.registerPrompt({
        name: 'debug',
        description: 'Debug prompt',
      });

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 15,
        method: 'prompts/get',
        params: { name: 'debug', arguments: { error: 'test error' } },
      });

      expect(response.error).toBeUndefined();
      expect(promptHandler).toHaveBeenCalledWith('debug', { error: 'test error' });

      const result = response.result as { messages: Array<{ role: string }> };
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
    });

    it('should return error for unknown prompt', async () => {
      server.setPromptHandler(vi.fn());

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 16,
        method: 'prompts/get',
        params: { name: 'nonexistent' },
      });

      expect(response.error).toBeDefined();
      expect(response.error!.message).toContain('Prompt not found');
    });

    it('should return error when no prompt handler is set', async () => {
      server.registerPrompt({
        name: 'no_handler_prompt',
        description: 'No handler',
      });

      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 17,
        method: 'prompts/get',
        params: { name: 'no_handler_prompt' },
      });

      expect(response.error).toBeDefined();
      expect(response.error!.message).toContain('No prompt handler registered');
    });

    it('should increment promptRequests stat', async () => {
      server.setPromptHandler(vi.fn().mockResolvedValue({
        messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
      }));
      server.registerPrompt({ name: 'stat_prompt', description: 'Stats' });

      await server.handleRequest({
        jsonrpc: '2.0',
        id: 18,
        method: 'prompts/get',
        params: { name: 'stat_prompt' },
      });

      expect(server.getStats().promptRequests).toBe(1);
    });
  });

  // ── handleRequest: unknown method ──

  describe('handleRequest — unknown method', () => {
    it('should return an error for unknown methods', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 19,
        method: 'unknown/method',
      });

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32603);
      expect(response.error!.message).toContain('Unknown method');
    });
  });

  // ── handleRequest: ping ──

  describe('handleRequest — ping', () => {
    it('should respond to ping', async () => {
      const response = await server.handleRequest({
        jsonrpc: '2.0',
        id: 20,
        method: 'ping',
      });

      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({});
    });
  });

  // ── getStats ──

  describe('getStats', () => {
    it('should return correct initial statistics', () => {
      const stats = server.getStats();
      expect(stats.transport).toBe('stdio');
      expect(stats.isRunning).toBe(false);
      expect(stats.clientsConnected).toBe(0);
      expect(stats.toolInvocations).toBe(0);
      expect(stats.resourceReads).toBe(0);
      expect(stats.promptRequests).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.uptime).toBe(0);
    });

    it('should track error count on failed requests', async () => {
      await server.handleRequest({
        jsonrpc: '2.0',
        id: 21,
        method: 'nonexistent',
      });

      expect(server.getStats().errors).toBe(1);
    });

    it('should track multiple tool invocations', async () => {
      server.setToolHandler(vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      }));
      server.registerTool({
        name: 'multi_tool',
        description: 'Multi',
        inputSchema: { type: 'object' },
      });

      await server.handleRequest({
        jsonrpc: '2.0', id: 22, method: 'tools/call',
        params: { name: 'multi_tool' },
      });
      await server.handleRequest({
        jsonrpc: '2.0', id: 23, method: 'tools/call',
        params: { name: 'multi_tool' },
      });

      expect(server.getStats().toolInvocations).toBe(2);
    });
  });

  // ── Default registrations ──

  describe('registerDefaults', () => {
    it('should register default tools, resources, and prompts', () => {
      server.registerDefaults();

      expect(server.getTools().length).toBeGreaterThanOrEqual(5);
      expect(server.getResources().length).toBeGreaterThanOrEqual(3);
      expect(server.getPrompts().length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Events ──

  describe('events', () => {
    it('should emit mcp:server:resource:read on resource read', async () => {
      const listener = vi.fn();
      server.on('mcp:server:resource:read', listener);

      server.setResourceHandler(vi.fn().mockResolvedValue({
        contents: [{ uri: 'cortexos://ev', text: 'data' }],
      }));
      server.registerResource({ uri: 'cortexos://ev', name: 'EV' });

      await server.handleRequest({
        jsonrpc: '2.0',
        id: 24,
        method: 'resources/read',
        params: { uri: 'cortexos://ev' },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ uri: 'cortexos://ev' }),
      );
    });

    it('should emit mcp:server:prompt:requested on prompt get', async () => {
      const listener = vi.fn();
      server.on('mcp:server:prompt:requested', listener);

      server.setPromptHandler(vi.fn().mockResolvedValue({
        messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
      }));
      server.registerPrompt({ name: 'ev_prompt', description: 'Event' });

      await server.handleRequest({
        jsonrpc: '2.0',
        id: 25,
        method: 'prompts/get',
        params: { name: 'ev_prompt', arguments: { key: 'val' } },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'ev_prompt', args: { key: 'val' } }),
      );
    });
  });

  // ── Custom server name ──

  describe('custom server name', () => {
    it('should use custom name in initialize response and tool registration', async () => {
      const custom = new MCPServer({ name: 'my-app', version: '3.0.0' });
      custom.registerTool({
        name: 'custom_tool',
        description: 'Custom',
        inputSchema: { type: 'object' },
      });

      expect(custom.getTools()[0].serverId).toBe('my-app');

      const response = await custom.handleRequest({
        jsonrpc: '2.0',
        id: 26,
        method: 'initialize',
        params: {},
      });

      const result = response.result as { serverInfo: { name: string; version: string } };
      expect(result.serverInfo.name).toBe('my-app');
      expect(result.serverInfo.version).toBe('3.0.0');
    });
  });
});
