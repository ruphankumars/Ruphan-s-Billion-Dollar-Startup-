/**
 * MCP Server — Expose CortexOS AS an MCP Server
 *
 * Makes CortexOS discoverable by other AI tools (Claude Code, Cursor, etc.)
 * Implements MCP Server role: exposes tools, resources, and prompts via JSON-RPC 2.0.
 * Supports stdio and HTTP/SSE transports — zero npm dependencies.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  MCPCapabilities,
  MCPTool,
  MCPResource,
  MCPPrompt,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// MCP SERVER TYPES
// ═══════════════════════════════════════════════════════════════

export interface MCPServerOptions {
  /** Server name advertised to clients */
  name?: string;
  /** Server version */
  version?: string;
  /** Transport mode: 'stdio' reads stdin/writes stdout, 'http' starts HTTP server */
  transport?: 'stdio' | 'http';
  /** Port for HTTP transport */
  port?: number;
  /** Hostname for HTTP transport */
  hostname?: string;
  /** Server capabilities to advertise */
  capabilities?: Partial<MCPCapabilities>;
  /** Tool handler — called when a client invokes a tool */
  toolHandler?: MCPToolHandler;
  /** Resource handler — called when a client reads a resource */
  resourceHandler?: MCPResourceHandler;
  /** Prompt handler — called when a client requests a prompt */
  promptHandler?: MCPPromptHandler;
}

export type MCPToolHandler = (
  name: string,
  args: Record<string, unknown>,
) => Promise<MCPToolResult>;

export type MCPResourceHandler = (uri: string) => Promise<MCPResourceContent>;

export type MCPPromptHandler = (
  name: string,
  args?: Record<string, string>,
) => Promise<MCPPromptResult>;

export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'resource'; resource: { uri: string; text: string; mimeType?: string } }>;
  isError?: boolean;
}

export interface MCPResourceContent {
  contents: Array<{
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  }>;
}

export interface MCPPromptResult {
  description?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: { type: 'text'; text: string };
  }>;
}

export interface MCPServerStats {
  transport: 'stdio' | 'http';
  isRunning: boolean;
  clientsConnected: number;
  toolInvocations: number;
  resourceReads: number;
  promptRequests: number;
  errors: number;
  uptime: number;
}

// ═══════════════════════════════════════════════════════════════
// MCP SERVER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class MCPServer extends EventEmitter {
  private tools: Map<string, MCPTool> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private prompts: Map<string, MCPPrompt> = new Map();
  private toolHandler: MCPToolHandler | null;
  private resourceHandler: MCPResourceHandler | null;
  private promptHandler: MCPPromptHandler | null;
  private httpServer: Server | null = null;
  private sseClients: Set<ServerResponse> = new Set();
  private stdinBuffer = '';
  private stdinListener: ((data: Buffer) => void) | null = null;
  private running = false;
  private startedAt = 0;

  // Stats
  private stats = {
    clientsConnected: 0,
    toolInvocations: 0,
    resourceReads: 0,
    promptRequests: 0,
    errors: 0,
  };

  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly transport: 'stdio' | 'http';
  private readonly port: number;
  private readonly hostname: string;
  private readonly capabilities: MCPCapabilities;

  constructor(options: MCPServerOptions = {}) {
    super();
    this.serverName = options.name ?? 'cortexos';
    this.serverVersion = options.version ?? '1.0.0';
    this.transport = options.transport ?? 'stdio';
    this.port = options.port ?? 3300;
    this.hostname = options.hostname ?? '0.0.0.0';
    this.toolHandler = options.toolHandler ?? null;
    this.resourceHandler = options.resourceHandler ?? null;
    this.promptHandler = options.promptHandler ?? null;
    this.capabilities = {
      tools: { listChanged: true },
      resources: { subscribe: false, listChanged: true },
      prompts: { listChanged: true },
      ...options.capabilities,
    };
  }

  // ─── Tool Registration ──────────────────────────────────────

  /** Register a tool the server exposes */
  registerTool(tool: Omit<MCPTool, 'serverId'>): void {
    this.tools.set(tool.name, { ...tool, serverId: this.serverName });
    if (this.running) {
      this.broadcastNotification('notifications/tools/list_changed', {});
    }
  }

  /** Remove a registered tool */
  removeTool(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed && this.running) {
      this.broadcastNotification('notifications/tools/list_changed', {});
    }
    return removed;
  }

  /** Get all registered tools */
  getTools(): MCPTool[] {
    return [...this.tools.values()];
  }

  // ─── Resource Registration ──────────────────────────────────

  /** Register a resource the server exposes */
  registerResource(resource: Omit<MCPResource, 'serverId'>): void {
    this.resources.set(resource.uri, { ...resource, serverId: this.serverName });
    if (this.running) {
      this.broadcastNotification('notifications/resources/list_changed', {});
    }
  }

  /** Remove a registered resource */
  removeResource(uri: string): boolean {
    const removed = this.resources.delete(uri);
    if (removed && this.running) {
      this.broadcastNotification('notifications/resources/list_changed', {});
    }
    return removed;
  }

  /** Get all registered resources */
  getResources(): MCPResource[] {
    return [...this.resources.values()];
  }

  // ─── Prompt Registration ────────────────────────────────────

  /** Register a prompt template the server exposes */
  registerPrompt(prompt: Omit<MCPPrompt, 'serverId'>): void {
    this.prompts.set(prompt.name, { ...prompt, serverId: this.serverName });
    if (this.running) {
      this.broadcastNotification('notifications/prompts/list_changed', {});
    }
  }

  /** Remove a registered prompt */
  removePrompt(name: string): boolean {
    const removed = this.prompts.delete(name);
    if (removed && this.running) {
      this.broadcastNotification('notifications/prompts/list_changed', {});
    }
    return removed;
  }

  /** Get all registered prompts */
  getPrompts(): MCPPrompt[] {
    return [...this.prompts.values()];
  }

  // ─── Handler Registration ───────────────────────────────────

  /** Set the tool execution handler */
  setToolHandler(handler: MCPToolHandler): void {
    this.toolHandler = handler;
  }

  /** Set the resource read handler */
  setResourceHandler(handler: MCPResourceHandler): void {
    this.resourceHandler = handler;
  }

  /** Set the prompt request handler */
  setPromptHandler(handler: MCPPromptHandler): void {
    this.promptHandler = handler;
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  /** Start the MCP server */
  async start(): Promise<void> {
    if (this.running) return;

    if (this.transport === 'stdio') {
      await this.startStdio();
    } else {
      await this.startHTTP();
    }

    this.running = true;
    this.startedAt = Date.now();
    this.emit('mcp:server:started', { transport: this.transport });
  }

  /** Stop the MCP server */
  async stop(): Promise<void> {
    if (!this.running) return;

    if (this.transport === 'stdio') {
      this.stopStdio();
    } else {
      await this.stopHTTP();
    }

    this.running = false;
    this.emit('mcp:server:stopped', {});
  }

  /** Check if server is running */
  isRunning(): boolean {
    return this.running;
  }

  /** Get server statistics */
  getStats(): MCPServerStats {
    return {
      transport: this.transport,
      isRunning: this.running,
      clientsConnected: this.transport === 'http' ? this.sseClients.size : (this.running ? 1 : 0),
      toolInvocations: this.stats.toolInvocations,
      resourceReads: this.stats.resourceReads,
      promptRequests: this.stats.promptRequests,
      errors: this.stats.errors,
      uptime: this.running ? Date.now() - this.startedAt : 0,
    };
  }

  // ─── Default CortexOS Tools ─────────────────────────────────

  /** Register the default set of CortexOS tools */
  registerDefaultTools(): void {
    this.registerTool({
      name: 'cortexos_execute',
      description: 'Execute a task using the CortexOS multi-agent engine. Supports code generation, refactoring, debugging, and more.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The task to execute' },
          sessionId: { type: 'string', description: 'Optional session ID for context continuity' },
        },
        required: ['prompt'],
      },
    });

    this.registerTool({
      name: 'cortexos_analyze',
      description: 'Analyze code for quality, complexity, security issues, and improvement opportunities.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File or directory path to analyze' },
          depth: { type: 'string', description: 'Analysis depth: quick, standard, or deep' },
        },
        required: ['path'],
      },
    });

    this.registerTool({
      name: 'cortexos_review',
      description: 'Review code changes with multi-agent quality gates (type-check, lint, test, security).',
      inputSchema: {
        type: 'object',
        properties: {
          diff: { type: 'string', description: 'The diff or description of changes to review' },
          gates: { type: 'string', description: 'Comma-separated quality gates to run' },
        },
        required: ['diff'],
      },
    });

    this.registerTool({
      name: 'cortexos_memory_query',
      description: 'Query the CortexOS memory system for relevant past context, solutions, and patterns.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query to search memories' },
          type: { type: 'string', description: 'Memory type: semantic, episodic, or working' },
          limit: { type: 'number', description: 'Maximum results to return' },
        },
        required: ['query'],
      },
    });

    this.registerTool({
      name: 'cortexos_agent_status',
      description: 'Get the status of CortexOS agents, running tasks, and system health.',
      inputSchema: {
        type: 'object',
        properties: {
          verbose: { type: 'boolean', description: 'Include detailed metrics' },
        },
      },
    });

    this.registerTool({
      name: 'cortexos_marketplace_search',
      description: 'Search the CortexOS agent marketplace for specialized agents.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for agent capabilities' },
          maxCost: { type: 'number', description: 'Maximum cost per invocation' },
        },
        required: ['query'],
      },
    });
  }

  /** Register the default set of CortexOS resources */
  registerDefaultResources(): void {
    this.registerResource({
      uri: 'cortexos://config',
      name: 'CortexOS Configuration',
      description: 'Current CortexOS configuration including providers, quality gates, and cost settings',
      mimeType: 'application/json',
    });

    this.registerResource({
      uri: 'cortexos://agents',
      name: 'Agent Registry',
      description: 'List of available and active agents in the CortexOS system',
      mimeType: 'application/json',
    });

    this.registerResource({
      uri: 'cortexos://metrics',
      name: 'System Metrics',
      description: 'Real-time metrics including token usage, costs, quality scores, and performance',
      mimeType: 'application/json',
    });

    this.registerResource({
      uri: 'cortexos://memory/recent',
      name: 'Recent Memories',
      description: 'Recently stored memories and context from past executions',
      mimeType: 'application/json',
    });
  }

  /** Register the default set of CortexOS prompts */
  registerDefaultPrompts(): void {
    this.registerPrompt({
      name: 'cortexos_task',
      description: 'Generate a well-structured prompt for CortexOS task execution',
      arguments: [
        { name: 'task', description: 'Description of the task', required: true },
        { name: 'context', description: 'Additional context about the codebase' },
        { name: 'constraints', description: 'Any constraints or requirements' },
      ],
    });

    this.registerPrompt({
      name: 'cortexos_review',
      description: 'Generate a code review prompt for CortexOS quality analysis',
      arguments: [
        { name: 'changes', description: 'Description of the changes to review', required: true },
        { name: 'focus', description: 'Focus areas: security, performance, style, correctness' },
      ],
    });

    this.registerPrompt({
      name: 'cortexos_debug',
      description: 'Generate a debugging prompt for CortexOS diagnostic reasoning',
      arguments: [
        { name: 'error', description: 'The error or unexpected behavior', required: true },
        { name: 'stack', description: 'Stack trace or error output' },
        { name: 'context', description: 'What was happening when the error occurred' },
      ],
    });
  }

  /** Register all defaults (tools, resources, prompts) */
  registerDefaults(): void {
    this.registerDefaultTools();
    this.registerDefaultResources();
    this.registerDefaultPrompts();
  }

  // ─── JSON-RPC Request Handling ──────────────────────────────

  /** Handle an incoming JSON-RPC request and return a response */
  async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    try {
      const result = await this.routeRequest(request.method, request.params ?? {});
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (err) {
      this.stats.errors++;
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message },
      };
    }
  }

  private async routeRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.handleInitialize(params);
      case 'tools/list':
        return this.handleToolsList();
      case 'tools/call':
        return this.handleToolsCall(params);
      case 'resources/list':
        return this.handleResourcesList();
      case 'resources/read':
        return this.handleResourcesRead(params);
      case 'prompts/list':
        return this.handlePromptsList();
      case 'prompts/get':
        return this.handlePromptsGet(params);
      case 'ping':
        return {};
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private handleInitialize(params: Record<string, unknown>): {
    protocolVersion: string;
    capabilities: MCPCapabilities;
    serverInfo: { name: string; version: string };
  } {
    this.stats.clientsConnected++;
    this.emit('mcp:server:client:connected', {
      clientInfo: params.clientInfo,
      protocolVersion: params.protocolVersion,
    });
    return {
      protocolVersion: '2024-11-05',
      capabilities: this.capabilities,
      serverInfo: { name: this.serverName, version: this.serverVersion },
    };
  }

  private handleToolsList(): { tools: Array<{ name: string; description: string; inputSchema: MCPTool['inputSchema'] }> } {
    return {
      tools: [...this.tools.values()].map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  }

  private async handleToolsCall(params: Record<string, unknown>): Promise<MCPToolResult> {
    const name = params.name as string;
    const args = (params.arguments as Record<string, unknown>) ?? {};

    if (!this.tools.has(name)) {
      throw new Error(`Tool not found: ${name}`);
    }

    this.stats.toolInvocations++;
    this.emit('mcp:server:tool:invoked', { name, args });

    if (!this.toolHandler) {
      throw new Error('No tool handler registered');
    }

    return this.toolHandler(name, args);
  }

  private handleResourcesList(): {
    resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  } {
    return {
      resources: [...this.resources.values()].map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  }

  private async handleResourcesRead(params: Record<string, unknown>): Promise<MCPResourceContent> {
    const uri = params.uri as string;

    if (!this.resources.has(uri)) {
      throw new Error(`Resource not found: ${uri}`);
    }

    this.stats.resourceReads++;
    this.emit('mcp:server:resource:read', { uri });

    if (!this.resourceHandler) {
      throw new Error('No resource handler registered');
    }

    return this.resourceHandler(uri);
  }

  private handlePromptsList(): {
    prompts: Array<{ name: string; description?: string; arguments?: MCPPrompt['arguments'] }>;
  } {
    return {
      prompts: [...this.prompts.values()].map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      })),
    };
  }

  private async handlePromptsGet(params: Record<string, unknown>): Promise<MCPPromptResult> {
    const name = params.name as string;
    const args = params.arguments as Record<string, string> | undefined;

    if (!this.prompts.has(name)) {
      throw new Error(`Prompt not found: ${name}`);
    }

    this.stats.promptRequests++;
    this.emit('mcp:server:prompt:requested', { name, args });

    if (!this.promptHandler) {
      throw new Error('No prompt handler registered');
    }

    return this.promptHandler(name, args);
  }

  // ─── stdio Transport ────────────────────────────────────────

  private async startStdio(): Promise<void> {
    this.stdinListener = (data: Buffer) => {
      this.stdinBuffer += data.toString();
      this.processStdinBuffer();
    };
    process.stdin.on('data', this.stdinListener);
    process.stdin.resume();
  }

  private stopStdio(): void {
    if (this.stdinListener) {
      process.stdin.removeListener('data', this.stdinListener);
      this.stdinListener = null;
    }
    this.stdinBuffer = '';
  }

  private processStdinBuffer(): void {
    const lines = this.stdinBuffer.split('\n');
    this.stdinBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);

        if ('method' in message && 'id' in message) {
          // JSON-RPC request
          this.handleRequest(message as JSONRPCRequest).then((response) => {
            this.writeStdout(response);
          });
        } else if ('method' in message && !('id' in message)) {
          // JSON-RPC notification (no response needed)
          this.handleNotification(message as JSONRPCNotification);
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  }

  private writeStdout(data: unknown): void {
    process.stdout.write(JSON.stringify(data) + '\n');
  }

  private handleNotification(notification: JSONRPCNotification): void {
    switch (notification.method) {
      case 'notifications/initialized':
        this.emit('mcp:server:client:initialized', {});
        break;
      case 'notifications/cancelled':
        this.emit('mcp:server:request:cancelled', notification.params);
        break;
      default:
        // Unknown notification — ignore
        break;
    }
  }

  // ─── HTTP Transport ─────────────────────────────────────────

  private async startHTTP(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer((req, res) => this.handleHTTPRequest(req, res));

      this.httpServer.on('error', (err) => {
        this.emit('mcp:server:error', { error: err.message });
        reject(err);
      });

      this.httpServer.listen(this.port, this.hostname, () => {
        resolve();
      });
    });
  }

  private async stopHTTP(): Promise<void> {
    // Close SSE connections
    for (const client of this.sseClients) {
      try { client.end(); } catch { /* ignore */ }
    }
    this.sseClients.clear();

    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          this.httpServer = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleHTTPRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // SSE endpoint for streaming notifications
    if (url.pathname === '/sse' && req.method === 'GET') {
      this.handleSSEConnection(req, res);
      return;
    }

    // Health check
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ...this.getStats() }));
      return;
    }

    // JSON-RPC endpoint
    if (req.method === 'POST') {
      const body = await this.readBody(req);
      if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
        return;
      }

      try {
        const request = JSON.parse(body) as JSONRPCRequest;
        const response = await this.handleRequest(request);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON-RPC request' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleSSEConnection(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    this.sseClients.add(res);
    this.stats.clientsConnected++;
    this.emit('mcp:server:client:connected', { transport: 'sse' });

    // Send initial capabilities
    this.sendSSE(res, 'endpoint', `/message`);

    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private sendSSE(res: ServerResponse, event: string, data: unknown): void {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
    } catch {
      // Connection may have closed
    }
  }

  private broadcastNotification(method: string, params: Record<string, unknown>): void {
    if (this.transport === 'stdio') {
      this.writeStdout({ jsonrpc: '2.0', method, params });
    } else {
      const notification = { jsonrpc: '2.0', method, params };
      for (const client of this.sseClients) {
        this.sendSSE(client, 'message', notification);
      }
    }
  }

  private readBody(req: IncomingMessage): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', () => resolve(null));
    });
  }
}
