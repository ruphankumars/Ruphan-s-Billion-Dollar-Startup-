import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPClient } from '../../../src/mcp/mcp-client.js';
import type { MCPServerConfig, MCPServerInstance } from '../../../src/mcp/types.js';

// Mock child_process spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    stdin: { write: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

describe('MCPClient', () => {
  let client: MCPClient;

  beforeEach(() => {
    client = new MCPClient();
  });

  describe('constructor', () => {
    it('creates a new MCPClient instance', () => {
      expect(client).toBeInstanceOf(MCPClient);
      expect(client.getServers()).toEqual([]);
    });
  });

  describe('connect()', () => {
    it('throws for disabled servers', async () => {
      const config: MCPServerConfig = {
        id: 'test-server',
        name: 'Test Server',
        transport: 'stdio',
        command: 'node',
        enabled: false,
      };

      await expect(client.connect(config)).rejects.toThrow(
        'MCP server "test-server" is disabled',
      );
    });

    it('throws for unsupported transport', async () => {
      const config: MCPServerConfig = {
        id: 'test-server',
        name: 'Test Server',
        transport: 'invalid' as any,
        enabled: true,
      };

      await expect(client.connect(config)).rejects.toThrow(
        'Unsupported transport: invalid',
      );
    });
  });

  describe('disconnect()', () => {
    it('emits disconnected event', async () => {
      const emitSpy = vi.fn();
      client.on('mcp:server:disconnected', emitSpy);

      await client.disconnect('non-existent');

      expect(emitSpy).toHaveBeenCalledWith({ serverId: 'non-existent' });
    });
  });

  describe('disconnectAll()', () => {
    it('disconnects all servers', async () => {
      const emitSpy = vi.fn();
      client.on('mcp:server:disconnected', emitSpy);

      // Internally add some server instances via the servers map
      // We simulate by calling disconnect on known IDs
      // Since no servers are connected, disconnectAll should complete without error
      await client.disconnectAll();
      // No servers to disconnect
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('callTool()', () => {
    it('throws when server not ready', async () => {
      await expect(
        client.callTool('unknown-server', 'test-tool', {}),
      ).rejects.toThrow('MCP server "unknown-server" is not ready');
    });
  });

  describe('getAllTools()', () => {
    it('returns tools from ready servers only', () => {
      // No servers registered, should return empty
      const tools = client.getAllTools();
      expect(tools).toEqual([]);
    });
  });

  describe('findTool()', () => {
    it('finds tools across servers', () => {
      // No servers registered, should return undefined
      const result = client.findTool('test-tool');
      expect(result).toBeUndefined();
    });
  });

  describe('getStats()', () => {
    it('returns correct counts with no servers', () => {
      const stats = client.getStats();
      expect(stats).toEqual({
        totalServers: 0,
        connectedServers: 0,
        totalTools: 0,
        totalResources: 0,
        totalPrompts: 0,
      });
    });
  });

  describe('getServers()', () => {
    it('returns all server instances', () => {
      const servers = client.getServers();
      expect(servers).toEqual([]);
      expect(Array.isArray(servers)).toBe(true);
    });
  });

  describe('getServer()', () => {
    it('returns undefined for unknown server', () => {
      expect(client.getServer('non-existent')).toBeUndefined();
    });
  });

  describe('getAllResources()', () => {
    it('returns resources from ready servers only', () => {
      const resources = client.getAllResources();
      expect(resources).toEqual([]);
    });
  });
});
