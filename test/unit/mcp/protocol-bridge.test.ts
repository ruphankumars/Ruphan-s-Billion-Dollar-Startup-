import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolBridge } from '../../../src/mcp/protocol-bridge.js';
import type { UnifiedCapability, A2ATask } from '../../../src/mcp/types.js';

describe('ProtocolBridge', () => {
  let bridge: ProtocolBridge;

  beforeEach(() => {
    bridge = new ProtocolBridge();
  });

  describe('constructor', () => {
    it('creates bridge with defaults', () => {
      expect(bridge).toBeInstanceOf(ProtocolBridge);
      expect(bridge.getCapabilities()).toEqual([]);
    });

    it('accepts options', () => {
      const custom = new ProtocolBridge({
        config: { enabled: false, autoDiscover: false, exposeAsA2A: false },
      });
      expect(custom).toBeInstanceOf(ProtocolBridge);
    });
  });

  describe('registerLocalCapability()', () => {
    it('adds capability', () => {
      bridge.registerLocalCapability({
        id: 'local-test',
        name: 'Test Capability',
        description: 'A test capability',
      });

      const caps = bridge.getCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0].id).toBe('local-test');
      expect(caps[0].name).toBe('Test Capability');
      expect(caps[0].source).toBe('local');
      expect(caps[0].sourceId).toBe('cortexos');
    });

    it('emits event on registration', () => {
      const emitSpy = vi.fn();
      bridge.on('bridge:capability:registered', emitSpy);

      bridge.registerLocalCapability({
        id: 'cap-1',
        name: 'Cap 1',
        description: 'Description',
      });

      expect(emitSpy).toHaveBeenCalledWith({ id: 'cap-1', source: 'local' });
    });
  });

  describe('getCapabilities()', () => {
    it('returns all capabilities', () => {
      bridge.registerLocalCapability({
        id: 'cap-a',
        name: 'Cap A',
        description: 'Description A',
      });
      bridge.registerLocalCapability({
        id: 'cap-b',
        name: 'Cap B',
        description: 'Description B',
      });

      const caps = bridge.getCapabilities();
      expect(caps).toHaveLength(2);
    });
  });

  describe('findCapability()', () => {
    it('finds by name', () => {
      bridge.registerLocalCapability({
        id: 'find-me',
        name: 'Find Me',
        description: 'Findable capability',
      });

      const found = bridge.findCapability('find-me');
      expect(found).toBeDefined();
      expect(found!.id).toBe('find-me');
    });

    it('returns undefined for non-existent', () => {
      const found = bridge.findCapability('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('searchCapabilities()', () => {
    it('searches by text in name', () => {
      bridge.registerLocalCapability({
        id: 'code-gen',
        name: 'Code Generator',
        description: 'Generates code',
      });
      bridge.registerLocalCapability({
        id: 'doc-gen',
        name: 'Doc Writer',
        description: 'Writes documentation',
      });

      const results = bridge.searchCapabilities('code');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('code-gen');
    });

    it('searches by text in description', () => {
      bridge.registerLocalCapability({
        id: 'cap-x',
        name: 'Cap X',
        description: 'Handles authentication tasks',
      });

      const results = bridge.searchCapabilities('authentication');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('cap-x');
    });

    it('is case-insensitive', () => {
      bridge.registerLocalCapability({
        id: 'cap-y',
        name: 'Testing Tool',
        description: 'Runs tests',
      });

      const results = bridge.searchCapabilities('TESTING');
      expect(results).toHaveLength(1);
    });
  });

  describe('removeCapability()', () => {
    it('removes existing capability', () => {
      bridge.registerLocalCapability({
        id: 'to-remove',
        name: 'Remove Me',
        description: 'Will be removed',
      });

      expect(bridge.getCapabilities()).toHaveLength(1);

      const result = bridge.removeCapability('to-remove');
      expect(result).toBe(true);
      expect(bridge.getCapabilities()).toHaveLength(0);
    });

    it('returns false for non-existent', () => {
      const result = bridge.removeCapability('non-existent');
      expect(result).toBe(false);
    });

    it('emits event on removal', () => {
      bridge.registerLocalCapability({
        id: 'cap-rem',
        name: 'Rem',
        description: 'Removable',
      });

      const emitSpy = vi.fn();
      bridge.on('bridge:capability:removed', emitSpy);

      bridge.removeCapability('cap-rem');
      expect(emitSpy).toHaveBeenCalledWith({ id: 'cap-rem' });
    });
  });

  describe('mcpToolToA2ATask()', () => {
    it('creates valid task', () => {
      const task = bridge.mcpToolToA2ATask('read_file', { path: '/test.ts' });

      expect(task).toBeDefined();
      expect(task.id).toMatch(/^task_/);
      expect(task.status).toBe('submitted');
      expect(task.input).toBeDefined();
      expect(task.input.role).toBe('user');
      expect(task.input.parts.length).toBeGreaterThan(0);
      expect(task.input.parts[0].type).toBe('text');
      expect(task.metadata).toBeDefined();
      expect(task.metadata!.source).toBe('mcp-bridge');
      expect(task.metadata!.originalTool).toBe('read_file');
      expect(task.metadata!.originalArgs).toEqual({ path: '/test.ts' });
      expect(task.history).toEqual([]);
      expect(task.artifacts).toEqual([]);
      expect(typeof task.createdAt).toBe('number');
      expect(typeof task.updatedAt).toBe('number');
    });
  });

  describe('a2aTaskToMCPResult()', () => {
    it('converts completed task correctly', () => {
      const task: A2ATask = {
        id: 'task_abc',
        status: 'completed',
        input: { role: 'user', parts: [{ type: 'text', text: 'test' }] },
        output: {
          role: 'agent',
          parts: [{ type: 'text', text: 'Hello world' }],
        },
        artifacts: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = bridge.a2aTaskToMCPResult(task);
      expect(result).toBeDefined();
      expect(result.isError).toBe(false);
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect((result.content as any[])[0].type).toBe('text');
      expect((result.content as any[])[0].text).toBe('Hello world');
    });

    it('converts failed task correctly', () => {
      const task: A2ATask = {
        id: 'task_fail',
        status: 'failed',
        input: { role: 'user', parts: [{ type: 'text', text: 'test' }] },
        output: {
          role: 'agent',
          parts: [{ type: 'text', text: 'Error occurred' }],
        },
        artifacts: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = bridge.a2aTaskToMCPResult(task);
      expect(result.isError).toBe(true);
    });

    it('handles task with no output', () => {
      const task: A2ATask = {
        id: 'task_noout',
        status: 'completed',
        input: { role: 'user', parts: [{ type: 'text', text: 'test' }] },
        artifacts: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = bridge.a2aTaskToMCPResult(task);
      expect(result.content).toBeDefined();
      expect((result.content as any[])[0].text).toBe('No output');
    });
  });

  describe('getStats()', () => {
    it('returns correct counts initially', () => {
      const stats = bridge.getStats();
      expect(stats).toEqual({
        totalCapabilities: 0,
        bySource: { mcp: 0, a2a: 0, local: 0 },
        discoveredAgents: 0,
        cacheSize: 0,
      });
    });

    it('reflects registered capabilities', () => {
      bridge.registerLocalCapability({
        id: 'stat-cap',
        name: 'Stat Cap',
        description: 'For stats',
      });

      const stats = bridge.getStats();
      expect(stats.totalCapabilities).toBe(1);
      expect(stats.bySource.local).toBe(1);
    });
  });
});
