import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ACPAdapter } from '../../../src/mcp/acp-adapter.js';

/** Helper to create a minimal agent info input */
function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'A test agent',
    capabilities: ['code-gen', 'analysis'],
    endpoint: 'http://localhost:3001',
    version: '1.0.0',
    ...overrides,
  };
}

describe('ACPAdapter', () => {
  let adapter: ACPAdapter;

  beforeEach(() => {
    adapter = new ACPAdapter();
    adapter.start();
  });

  afterEach(() => {
    adapter.stop();
    adapter.removeAllListeners();
  });

  // ── Constructor & Lifecycle ─────────────────────────────────────

  describe('constructor and lifecycle', () => {
    it('should create an adapter with default config', () => {
      const a = new ACPAdapter();
      expect(a.isRunning()).toBe(false);
      const stats = a.getStats();
      expect(stats.totalMessages).toBe(0);
      expect(stats.registeredAgents).toBe(0);
    });

    it('should accept custom config overrides', () => {
      const a = new ACPAdapter({ port: 4000, baseUrl: 'http://example.com' });
      expect(a.isRunning()).toBe(false);
    });

    it('should transition through start and stop', () => {
      const a = new ACPAdapter();
      expect(a.isRunning()).toBe(false);
      a.start();
      expect(a.isRunning()).toBe(true);
      a.stop();
      expect(a.isRunning()).toBe(false);
    });

    it('should emit started and stopped events', () => {
      const a = new ACPAdapter();
      const startedHandler = vi.fn();
      const stoppedHandler = vi.fn();
      a.on('acp:adapter:started', startedHandler);
      a.on('acp:adapter:stopped', stoppedHandler);
      a.start();
      expect(startedHandler).toHaveBeenCalledOnce();
      a.stop();
      expect(stoppedHandler).toHaveBeenCalledOnce();
    });
  });

  // ── Agent registration ──────────────────────────────────────────

  describe('registerAgent / unregisterAgent', () => {
    it('should register an agent with available status', () => {
      const agent = adapter.registerAgent(makeAgent());
      expect(agent.id).toBe('agent-1');
      expect(agent.status).toBe('available');
      expect(agent.name).toBe('Test Agent');
    });

    it('should retrieve a registered agent by ID', () => {
      adapter.registerAgent(makeAgent({ id: 'a1' }));
      expect(adapter.getAgent('a1')).toBeDefined();
      expect(adapter.getAgent('a1')?.name).toBe('Test Agent');
      expect(adapter.getAgent('nonexistent')).toBeUndefined();
    });

    it('should unregister an agent', () => {
      adapter.registerAgent(makeAgent({ id: 'a1' }));
      expect(adapter.unregisterAgent('a1')).toBe(true);
      expect(adapter.getAgent('a1')).toBeUndefined();
    });

    it('should return false when unregistering a non-existent agent', () => {
      expect(adapter.unregisterAgent('fake')).toBe(false);
    });

    it('should update agent status', () => {
      adapter.registerAgent(makeAgent({ id: 'a1' }));
      adapter.updateAgentStatus('a1', 'busy');
      expect(adapter.getAgent('a1')?.status).toBe('busy');
    });

    it('should throw when updating status of non-existent agent', () => {
      expect(() => adapter.updateAgentStatus('fake', 'offline')).toThrow(
        /Agent not found/,
      );
    });

    it('should emit agent registered and unregistered events', () => {
      const regHandler = vi.fn();
      const unregHandler = vi.fn();
      adapter.on('acp:agent:registered', regHandler);
      adapter.on('acp:agent:unregistered', unregHandler);

      adapter.registerAgent(makeAgent({ id: 'a1' }));
      expect(regHandler).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'a1', name: 'Test Agent' }),
      );

      adapter.unregisterAgent('a1');
      expect(unregHandler).toHaveBeenCalledWith({ agentId: 'a1' });
    });
  });

  // ── discoverAgents ──────────────────────────────────────────────

  describe('discoverAgents', () => {
    it('should discover all agents when no filter is applied', () => {
      adapter.registerAgent(makeAgent({ id: 'a1' }));
      adapter.registerAgent(makeAgent({ id: 'a2', name: 'Agent 2' }));

      const result = adapter.discoverAgents();
      expect(result.agents).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter agents by capabilities', () => {
      adapter.registerAgent(makeAgent({ id: 'a1', capabilities: ['code-gen'] }));
      adapter.registerAgent(makeAgent({ id: 'a2', capabilities: ['analysis'] }));
      adapter.registerAgent(makeAgent({ id: 'a3', capabilities: ['code-gen', 'debug'] }));

      const result = adapter.discoverAgents(['code-gen']);
      expect(result.agents).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should support pagination', () => {
      for (let i = 0; i < 5; i++) {
        adapter.registerAgent(makeAgent({ id: `a${i}`, name: `Agent ${i}` }));
      }

      const page1 = adapter.discoverAgents(undefined, 1, 2);
      expect(page1.agents).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page3 = adapter.discoverAgents(undefined, 3, 2);
      expect(page3.agents).toHaveLength(1);
    });
  });

  // ── listAgents with filters ─────────────────────────────────────

  describe('listAgents', () => {
    it('should filter by capability and status', () => {
      adapter.registerAgent(makeAgent({ id: 'a1', capabilities: ['code-gen'] }));
      adapter.registerAgent(makeAgent({ id: 'a2', capabilities: ['analysis'] }));
      adapter.updateAgentStatus('a2', 'offline');

      expect(adapter.listAgents({ capability: 'code-gen' })).toHaveLength(1);
      expect(adapter.listAgents({ status: 'offline' })).toHaveLength(1);
      expect(adapter.listAgents({ status: 'available' })).toHaveLength(1);
    });
  });

  // ── sendMessage ─────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('should create and log a message', () => {
      adapter.registerAgent(makeAgent({ id: 'sender' }));
      adapter.registerAgent(makeAgent({ id: 'receiver' }));

      const msg = adapter.sendMessage('sender', 'receiver', 'task/execute', { task: 'build' });
      expect(msg.id).toMatch(/^msg-/);
      expect(msg.from).toBe('sender');
      expect(msg.to).toBe('receiver');
      expect(msg.method).toBe('task/execute');
      expect(msg.body).toEqual({ task: 'build' });
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('should emit message:sent event', () => {
      const handler = vi.fn();
      adapter.on('acp:message:sent', handler);

      adapter.registerAgent(makeAgent({ id: 's' }));
      adapter.registerAgent(makeAgent({ id: 'r' }));
      adapter.sendMessage('s', 'r', 'test', {});

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ from: 's', to: 'r', method: 'test' }),
      );
    });

    it('should emit message:failed when target agent is offline', () => {
      const handler = vi.fn();
      adapter.on('acp:message:failed', handler);

      adapter.registerAgent(makeAgent({ id: 'sender' }));
      adapter.registerAgent(makeAgent({ id: 'receiver' }));
      adapter.updateAgentStatus('receiver', 'offline');

      adapter.sendMessage('sender', 'receiver', 'ping', null);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('offline') }),
      );
    });

    it('should store messages in the message log', () => {
      adapter.sendMessage('a', 'b', 'test', 'hello');
      adapter.sendMessage('a', 'c', 'test', 'world');

      const log = adapter.getMessageLog();
      expect(log).toHaveLength(2);
    });

    it('should filter message log', () => {
      adapter.sendMessage('a', 'b', 'ping', null);
      adapter.sendMessage('c', 'b', 'pong', null);

      expect(adapter.getMessageLog({ from: 'a' })).toHaveLength(1);
      expect(adapter.getMessageLog({ to: 'b' })).toHaveLength(2);
      expect(adapter.getMessageLog({ method: 'ping' })).toHaveLength(1);
    });
  });

  // ── handleResponse ──────────────────────────────────────────────

  describe('handleResponse', () => {
    it('should create and log a response', () => {
      const msg = adapter.sendMessage('a', 'b', 'test', {});
      const res = adapter.handleResponse(msg.id, 200, { result: 'ok' });

      expect(res.id).toMatch(/^res-/);
      expect(res.requestId).toBe(msg.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ result: 'ok' });
    });

    it('should track latency from original message', () => {
      const msg = adapter.sendMessage('a', 'b', 'test', {});
      adapter.handleResponse(msg.id, 200, {});

      const stats = adapter.getStats();
      expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should count errors for status >= 400', () => {
      adapter.handleResponse('req-1', 500, { error: 'internal' });
      adapter.handleResponse('req-2', 404, { error: 'not found' });

      const stats = adapter.getStats();
      expect(stats.totalErrors).toBeGreaterThanOrEqual(2);
    });

    it('should emit response:received event', () => {
      const handler = vi.fn();
      adapter.on('acp:response:received', handler);

      adapter.handleResponse('req-1', 200, {});
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-1', status: 200 }),
      );
    });
  });

  // ── bridgeToMCP ─────────────────────────────────────────────────

  describe('bridgeToMCP', () => {
    it('should convert ACP message to MCP tool format', () => {
      const msg = adapter.sendMessage('a', 'b', 'code/generate', { language: 'ts' });
      const mcp = adapter.bridgeToMCP(msg);

      expect(mcp.tool).toBe('code_generate');
      expect(mcp.arguments['language']).toBe('ts');
      expect(mcp.arguments['_acp_from']).toBe('a');
      expect(mcp.arguments['_acp_to']).toBe('b');
      expect(mcp.arguments['_acp_message_id']).toBe(msg.id);
    });

    it('should convert dots and slashes in method to underscores', () => {
      const msg = adapter.sendMessage('a', 'b', 'ns.sub/action', {});
      const mcp = adapter.bridgeToMCP(msg);
      expect(mcp.tool).toBe('ns_sub_action');
    });

    it('should wrap non-object body as input parameter', () => {
      const msg = adapter.sendMessage('a', 'b', 'echo', 'hello world');
      const mcp = adapter.bridgeToMCP(msg);
      expect(mcp.arguments['input']).toBe('hello world');
    });

    it('should emit bridge:to-mcp event', () => {
      const handler = vi.fn();
      adapter.on('acp:bridge:to-mcp', handler);

      const msg = adapter.sendMessage('a', 'b', 'test', {});
      adapter.bridgeToMCP(msg);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: msg.id, tool: 'test' }),
      );
    });
  });

  // ── bridgeFromMCP ───────────────────────────────────────────────

  describe('bridgeFromMCP', () => {
    it('should convert MCP result to ACP response', () => {
      const res = adapter.bridgeFromMCP('code_generate', { code: 'console.log()' });

      expect(res.id).toMatch(/^res-/);
      expect(res.requestId).toBe('mcp:code_generate');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ code: 'console.log()' });
      expect(res.headers['x-bridge-source']).toBe('mcp');
      expect(res.headers['x-mcp-tool']).toBe('code_generate');
    });

    it('should add the response to the response log', () => {
      adapter.bridgeFromMCP('tool1', {});
      adapter.bridgeFromMCP('tool2', {});

      const stats = adapter.getStats();
      expect(stats.totalResponses).toBe(2);
    });
  });

  // ── bridgeToA2A ─────────────────────────────────────────────────

  describe('bridgeToA2A', () => {
    it('should convert ACP message to A2A task format', () => {
      const msg = adapter.sendMessage('a', 'b', 'task/run', { query: 'explain' });
      const a2a = adapter.bridgeToA2A(msg);

      expect(a2a.taskId).toMatch(/^a2a-/);
      expect(a2a.message).toBeDefined();
      const message = a2a.message as Record<string, unknown>;
      expect(message['role']).toBe('user');
      expect((message['parts'] as Array<Record<string, unknown>>)[0]['type']).toBe('text');
      expect((message['metadata'] as Record<string, unknown>)['acp_from']).toBe('a');
      expect((message['metadata'] as Record<string, unknown>)['acp_method']).toBe('task/run');
    });

    it('should serialize non-string body as JSON text', () => {
      const msg = adapter.sendMessage('a', 'b', 'test', { complex: true });
      const a2a = adapter.bridgeToA2A(msg);
      const message = a2a.message as Record<string, unknown>;
      const parts = message['parts'] as Array<Record<string, unknown>>;
      expect(parts[0]['text']).toBe(JSON.stringify({ complex: true }));
    });

    it('should pass string body directly as text', () => {
      const msg = adapter.sendMessage('a', 'b', 'test', 'plain text');
      // body needs to be a string for the direct path
      // But sendMessage wraps it - let's construct directly
      const directMsg = {
        id: 'msg-test',
        method: 'test',
        from: 'a',
        to: 'b',
        body: 'plain text',
        headers: {},
        timestamp: Date.now(),
      };
      const a2a = adapter.bridgeToA2A(directMsg);
      const message = a2a.message as Record<string, unknown>;
      const parts = message['parts'] as Array<Record<string, unknown>>;
      expect(parts[0]['text']).toBe('plain text');
    });

    it('should emit bridge:to-a2a event', () => {
      const handler = vi.fn();
      adapter.on('acp:bridge:to-a2a', handler);

      const msg = adapter.sendMessage('a', 'b', 'test', {});
      adapter.bridgeToA2A(msg);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: msg.id }),
      );
    });
  });

  // ── addRoute / getRoutes ────────────────────────────────────────

  describe('routing', () => {
    it('should add and retrieve routes', () => {
      adapter.addRoute({
        path: '/agents/discover',
        method: 'GET',
        handler: 'discoverHandler',
        description: 'Discover agents',
      });
      adapter.addRoute({
        path: '/agents/message',
        method: 'POST',
        handler: 'messageHandler',
        description: 'Send message',
      });

      const routes = adapter.getRoutes();
      expect(routes).toHaveLength(2);
      expect(routes[0].path).toBe('/agents/discover');
      expect(routes[1].method).toBe('POST');
    });

    it('should emit route:added event', () => {
      const handler = vi.fn();
      adapter.on('acp:route:added', handler);

      adapter.addRoute({
        path: '/test',
        method: 'GET',
        handler: 'testHandler',
        description: 'Test',
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/test', method: 'GET' }),
      );
    });
  });

  // ── getStats ────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct aggregate statistics', () => {
      adapter.registerAgent(makeAgent({ id: 'a1' }));
      adapter.registerAgent(makeAgent({ id: 'a2' }));
      adapter.updateAgentStatus('a2', 'offline');

      adapter.sendMessage('a1', 'a2', 'test', {});
      const msg = adapter.sendMessage('a1', 'a2', 'ping', {});
      adapter.handleResponse(msg.id, 200, {});

      const stats = adapter.getStats();
      expect(stats.totalMessages).toBe(2);
      expect(stats.totalResponses).toBe(1);
      expect(stats.registeredAgents).toBe(2);
      expect(stats.activeConnections).toBe(1); // only a1 is available
      expect(stats.totalErrors).toBeGreaterThanOrEqual(2); // offline target + no match
    });
  });
});
