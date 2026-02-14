/**
 * MCP Client — Connects to MCP Servers via stdio/SSE
 *
 * Implements the MCP Host role: discovers tools, resources, and prompts
 * from MCP servers and makes them available to CortexOS agents.
 * Uses child_process for stdio transport — zero npm dependencies.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  MCPServerConfig,
  MCPServerInstance,
  MCPCapabilities,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPConnectionState,
  JSONRPCRequest,
  JSONRPCResponse,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// MCP CLIENT
// ═══════════════════════════════════════════════════════════════

export class MCPClient extends EventEmitter {
  private servers: Map<string, MCPServerInstance> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private buffers: Map<string, string> = new Map();

  /** Connect to an MCP server */
  async connect(config: MCPServerConfig): Promise<MCPServerInstance> {
    if (config.enabled === false) {
      throw new Error(`MCP server "${config.id}" is disabled`);
    }

    const instance: MCPServerInstance = {
      config,
      state: 'connecting',
      capabilities: {},
      tools: [],
      resources: [],
      prompts: [],
    };

    this.servers.set(config.id, instance);

    try {
      if (config.transport === 'stdio') {
        await this.connectStdio(config, instance);
      } else if (config.transport === 'sse' || config.transport === 'streamable-http') {
        await this.connectHTTP(config, instance);
      } else {
        throw new Error(`Unsupported transport: ${config.transport}`);
      }

      // Initialize the connection
      instance.state = 'initializing';
      await this.initialize(config.id, instance);

      instance.state = 'ready';
      instance.connectedAt = Date.now();
      this.emit('mcp:server:connected', { serverId: config.id, capabilities: instance.capabilities });

      return instance;
    } catch (err) {
      instance.state = 'error';
      instance.lastError = err instanceof Error ? err.message : String(err);
      this.emit('mcp:server:error', { serverId: config.id, error: instance.lastError });
      throw err;
    }
  }

  /** Disconnect from an MCP server */
  async disconnect(serverId: string): Promise<void> {
    const process = this.processes.get(serverId);
    if (process) {
      process.kill('SIGTERM');
      this.processes.delete(serverId);
    }
    this.buffers.delete(serverId);
    const instance = this.servers.get(serverId);
    if (instance) {
      instance.state = 'disconnected';
    }
    this.emit('mcp:server:disconnected', { serverId });
  }

  /** Disconnect all servers */
  async disconnectAll(): Promise<void> {
    for (const serverId of this.servers.keys()) {
      await this.disconnect(serverId);
    }
  }

  /** Call a tool on an MCP server */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const instance = this.servers.get(serverId);
    if (!instance || instance.state !== 'ready') {
      throw new Error(`MCP server "${serverId}" is not ready`);
    }

    this.emit('mcp:tool:called', { serverId, toolName, args });

    const result = await this.sendRequest(serverId, 'tools/call', {
      name: toolName,
      arguments: args,
    });

    this.emit('mcp:tool:result', { serverId, toolName, result });
    return result;
  }

  /** Read a resource from an MCP server */
  async readResource(serverId: string, uri: string): Promise<unknown> {
    this.emit('mcp:resource:read', { serverId, uri });
    return this.sendRequest(serverId, 'resources/read', { uri });
  }

  /** Get a prompt from an MCP server */
  async getPrompt(
    serverId: string,
    promptName: string,
    args?: Record<string, string>,
  ): Promise<unknown> {
    return this.sendRequest(serverId, 'prompts/get', {
      name: promptName,
      arguments: args,
    });
  }

  /** List all connected servers */
  getServers(): MCPServerInstance[] {
    return [...this.servers.values()];
  }

  /** Get a specific server */
  getServer(serverId: string): MCPServerInstance | undefined {
    return this.servers.get(serverId);
  }

  /** Get all tools across all connected servers */
  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const instance of this.servers.values()) {
      if (instance.state === 'ready') {
        tools.push(...instance.tools);
      }
    }
    return tools;
  }

  /** Get all resources across all connected servers */
  getAllResources(): MCPResource[] {
    const resources: MCPResource[] = [];
    for (const instance of this.servers.values()) {
      if (instance.state === 'ready') {
        resources.push(...instance.resources);
      }
    }
    return resources;
  }

  /** Find a tool by name across all servers */
  findTool(toolName: string): { tool: MCPTool; serverId: string } | undefined {
    for (const instance of this.servers.values()) {
      const tool = instance.tools.find((t) => t.name === toolName);
      if (tool) return { tool, serverId: instance.config.id };
    }
    return undefined;
  }

  /** Get connection stats */
  getStats(): {
    totalServers: number;
    connectedServers: number;
    totalTools: number;
    totalResources: number;
    totalPrompts: number;
  } {
    const servers = [...this.servers.values()];
    return {
      totalServers: servers.length,
      connectedServers: servers.filter((s) => s.state === 'ready').length,
      totalTools: servers.reduce((sum, s) => sum + s.tools.length, 0),
      totalResources: servers.reduce((sum, s) => sum + s.resources.length, 0),
      totalPrompts: servers.reduce((sum, s) => sum + s.prompts.length, 0),
    };
  }

  // ─── Internal: stdio transport ─────────────────────────────

  private async connectStdio(
    config: MCPServerConfig,
    instance: MCPServerInstance,
  ): Promise<void> {
    if (!config.command) {
      throw new Error(`MCP server "${config.id}" requires a command for stdio transport`);
    }

    const child = spawn(config.command, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });

    if (!child.pid) {
      throw new Error(`Failed to spawn MCP server "${config.id}"`);
    }

    instance.pid = child.pid;
    this.processes.set(config.id, child);
    this.buffers.set(config.id, '');

    // Handle stdout (JSON-RPC responses)
    child.stdout?.on('data', (data: Buffer) => {
      const buffer = (this.buffers.get(config.id) ?? '') + data.toString();
      this.buffers.set(config.id, buffer);
      this.processBuffer(config.id);
    });

    // Handle stderr (logging)
    child.stderr?.on('data', (data: Buffer) => {
      // MCP servers may log to stderr — emit as info
      this.emit('mcp:server:log', { serverId: config.id, message: data.toString().trim() });
    });

    child.on('exit', (code) => {
      instance.state = 'disconnected';
      this.emit('mcp:server:disconnected', { serverId: config.id, exitCode: code });
    });

    child.on('error', (err) => {
      instance.state = 'error';
      instance.lastError = err.message;
      this.emit('mcp:server:error', { serverId: config.id, error: err.message });
    });
  }

  // ─── Internal: HTTP/SSE transport ──────────────────────────

  private async connectHTTP(
    config: MCPServerConfig,
    _instance: MCPServerInstance,
  ): Promise<void> {
    if (!config.url) {
      throw new Error(`MCP server "${config.id}" requires a URL for HTTP transport`);
    }
    // HTTP/SSE transport connects on-demand per request
    // No persistent connection needed — just validate the URL
    try {
      const url = new URL(config.url);
      if (!url.protocol.startsWith('http')) {
        throw new Error('Invalid URL protocol');
      }
    } catch {
      throw new Error(`Invalid URL for MCP server "${config.id}": ${config.url}`);
    }
  }

  // ─── Internal: Protocol ────────────────────────────────────

  private async initialize(serverId: string, instance: MCPServerInstance): Promise<void> {
    // Send initialize request
    const initResult = await this.sendRequest(serverId, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
      },
      clientInfo: {
        name: 'cortexos',
        version: '1.0.0',
      },
    }) as { capabilities?: MCPCapabilities } | undefined;

    instance.capabilities = initResult?.capabilities ?? {};

    // Send initialized notification
    await this.sendNotification(serverId, 'notifications/initialized', {});

    // Discover tools
    if (instance.capabilities.tools) {
      const toolsResult = await this.sendRequest(serverId, 'tools/list', {}) as {
        tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
      } | undefined;

      instance.tools = (toolsResult?.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as MCPTool['inputSchema'],
        serverId,
      }));
    }

    // Discover resources
    if (instance.capabilities.resources) {
      const resourcesResult = await this.sendRequest(serverId, 'resources/list', {}) as {
        resources?: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
      } | undefined;

      instance.resources = (resourcesResult?.resources ?? []).map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
        serverId,
      }));
    }

    // Discover prompts
    if (instance.capabilities.prompts) {
      const promptsResult = await this.sendRequest(serverId, 'prompts/list', {}) as {
        prompts?: Array<{ name: string; description?: string; arguments?: MCPPrompt['arguments'] }>;
      } | undefined;

      instance.prompts = (promptsResult?.prompts ?? []).map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
        serverId,
      }));
    }
  }

  private sendRequest(serverId: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const config = this.servers.get(serverId)?.config;
    if (!config) throw new Error(`Server "${serverId}" not found`);

    if (config.transport === 'stdio') {
      return this.sendStdioRequest(serverId, method, params);
    } else {
      return this.sendHTTPRequest(serverId, method, params);
    }
  }

  private sendStdioRequest(
    serverId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const process = this.processes.get(serverId);
      if (!process?.stdin) {
        reject(new Error(`No process for server "${serverId}"`));
        return;
      }

      const id = randomUUID();
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timeout: ${method} on ${serverId}`));
      }, this.servers.get(serverId)?.config.timeout ?? 30_000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const request: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };
      process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  private async sendHTTPRequest(
    serverId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const config = this.servers.get(serverId)?.config;
    if (!config?.url) throw new Error(`No URL for server "${serverId}"`);

    const id = randomUUID();
    const request: JSONRPCRequest = { jsonrpc: '2.0', id, method, params };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(config.timeout ?? 30_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const jsonResponse = await response.json() as JSONRPCResponse;
    if (jsonResponse.error) {
      throw new Error(`MCP error ${jsonResponse.error.code}: ${jsonResponse.error.message}`);
    }

    return jsonResponse.result;
  }

  private sendNotification(
    serverId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const process = this.processes.get(serverId);
    if (process?.stdin) {
      const notification = { jsonrpc: '2.0', method, params };
      process.stdin.write(JSON.stringify(notification) + '\n');
    }
    return Promise.resolve();
  }

  private processBuffer(serverId: string): void {
    const buffer = this.buffers.get(serverId) ?? '';
    const lines = buffer.split('\n');

    // Process all complete lines (keep last incomplete one in buffer)
    this.buffers.set(serverId, lines.pop() ?? '');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as JSONRPCResponse;

        if ('id' in message && message.id != null) {
          // Response to a pending request
          const pending = this.pendingRequests.get(String(message.id));
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(String(message.id));
            if (message.error) {
              pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
            } else {
              pending.resolve(message.result);
            }
          }
        } else if ('method' in message) {
          // Server-initiated notification
          this.emit('mcp:notification', { serverId, method: (message as any).method, params: (message as any).params });
        }
      } catch {
        // Skip non-JSON lines (could be server startup messages)
      }
    }
  }
}
