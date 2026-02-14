/**
 * A2A Gateway — Agent-to-Agent Protocol Gateway
 *
 * Implements the A2A specification: publishes Agent Cards, accepts A2A tasks,
 * routes tasks to CortexOS agents, streams results via SSE.
 * Uses Node.js built-in http module — zero npm dependencies.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AgentCard,
  AgentSkill,
  AgentCapability,
  A2ATask,
  A2ATaskStatus,
  A2AMessage,
  A2APart,
  A2AArtifact,
  A2APushNotification,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// A2A GATEWAY
// ═══════════════════════════════════════════════════════════════

export interface A2AGatewayOptions {
  port?: number;
  hostname?: string;
  agentCard?: Partial<AgentCard>;
  maxConcurrentTasks?: number;
  taskTimeout?: number;
  /** Callback to execute tasks — wired to CortexOS engine */
  taskHandler?: (task: A2ATask) => Promise<A2ATask>;
}

export class A2AGateway extends EventEmitter {
  private server: Server | null = null;
  private agentCard: AgentCard;
  private tasks: Map<string, A2ATask> = new Map();
  private sseClients: Map<string, Set<ServerResponse>> = new Map(); // taskId → SSE connections
  private pushSubscriptions: Map<string, A2APushNotification[]> = new Map(); // taskId → push configs
  private activeTasks = 0;
  private readonly maxConcurrentTasks: number;
  private readonly taskTimeout: number;
  private taskHandler: ((task: A2ATask) => Promise<A2ATask>) | null;

  constructor(options: A2AGatewayOptions = {}) {
    super();
    this.maxConcurrentTasks = options.maxConcurrentTasks ?? 10;
    this.taskTimeout = options.taskTimeout ?? 300_000; // 5 minutes
    this.taskHandler = options.taskHandler ?? null;

    // Build Agent Card
    this.agentCard = {
      name: options.agentCard?.name ?? 'CortexOS',
      description: options.agentCard?.description ??
        'AI Agent Operating System — multi-agent orchestration kernel with reasoning, memory, and quality gates',
      url: `http://${options.hostname ?? 'localhost'}:${options.port ?? 3200}`,
      version: '1.0.0',
      capabilities: options.agentCard?.capabilities ?? this.defaultCapabilities(),
      skills: options.agentCard?.skills ?? this.defaultSkills(),
      authentication: options.agentCard?.authentication ?? { type: 'none' },
      provider: options.agentCard?.provider ?? { name: 'CortexOS' },
      defaultInputModes: options.agentCard?.defaultInputModes ?? ['text', 'code'],
      defaultOutputModes: options.agentCard?.defaultOutputModes ?? ['text', 'code', 'file'],
      metadata: {
        ...options.agentCard?.metadata,
        protocol: 'a2a',
        protocolVersion: '1.0',
      },
    };
  }

  /** Start the A2A gateway server */
  async start(port?: number, hostname?: string): Promise<void> {
    const p = port ?? 3200;
    const h = hostname ?? '0.0.0.0';

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        this.emit('a2a:error', { error: err.message });
        reject(err);
      });

      this.server.listen(p, h, () => {
        this.agentCard.url = `http://${h === '0.0.0.0' ? 'localhost' : h}:${p}`;
        this.emit('a2a:started', { port: p, hostname: h });
        resolve();
      });
    });
  }

  /** Stop the gateway */
  async stop(): Promise<void> {
    // Close all SSE connections
    for (const clients of this.sseClients.values()) {
      for (const res of clients) {
        try { res.end(); } catch { /* ignore */ }
      }
    }
    this.sseClients.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.emit('a2a:stopped', {});
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /** Get the Agent Card */
  getAgentCard(): AgentCard {
    return { ...this.agentCard };
  }

  /** Update skills dynamically */
  updateSkills(skills: AgentSkill[]): void {
    this.agentCard.skills = skills;
    this.emit('a2a:skills:updated', { count: skills.length });
  }

  /** Set the task handler (wired to CortexOS engine) */
  setTaskHandler(handler: (task: A2ATask) => Promise<A2ATask>): void {
    this.taskHandler = handler;
  }

  /** Get a task by ID */
  getTask(taskId: string): A2ATask | undefined {
    return this.tasks.get(taskId);
  }

  /** List all tasks */
  listTasks(filter?: { status?: A2ATaskStatus }): A2ATask[] {
    const tasks = [...this.tasks.values()];
    if (filter?.status) return tasks.filter((t) => t.status === filter.status);
    return tasks;
  }

  /** Get gateway stats */
  getStats(): {
    totalTasks: number;
    activeTasks: number;
    completedTasks: number;
    failedTasks: number;
    sseConnections: number;
  } {
    const tasks = [...this.tasks.values()];
    return {
      totalTasks: tasks.length,
      activeTasks: this.activeTasks,
      completedTasks: tasks.filter((t) => t.status === 'completed').length,
      failedTasks: tasks.filter((t) => t.status === 'failed').length,
      sseConnections: [...this.sseClients.values()].reduce((sum, s) => sum + s.size, 0),
    };
  }

  /** Cancel a task */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'canceled') {
      return false;
    }
    task.status = 'canceled';
    task.updatedAt = Date.now();
    this.notifyTaskUpdate(taskId, task);
    this.emit('a2a:task:canceled', { taskId });
    return true;
  }

  /** Provide additional input for a task in 'input-required' state */
  async provideInput(taskId: string, message: A2AMessage): Promise<A2ATask | null> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'input-required') return null;

    task.history = task.history ?? [];
    task.history.push(message);
    task.status = 'working';
    task.updatedAt = Date.now();

    this.notifyTaskUpdate(taskId, task);

    // Re-execute with new input
    if (this.taskHandler) {
      this.executeTask(task);
    }

    return task;
  }

  // ─── HTTP Request Handler ─────────────────────────────────

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    // Route requests
    if (path === '/.well-known/agent.json' && req.method === 'GET') {
      this.handleGetAgentCard(res);
    } else if (path === '/a2a/tasks' && req.method === 'POST') {
      this.handleCreateTask(req, res);
    } else if (path === '/a2a/tasks' && req.method === 'GET') {
      this.handleListTasks(req, res);
    } else if (path.match(/^\/a2a\/tasks\/[^/]+$/) && req.method === 'GET') {
      const taskId = path.split('/').pop()!;
      this.handleGetTask(taskId, req, res);
    } else if (path.match(/^\/a2a\/tasks\/[^/]+\/cancel$/) && req.method === 'POST') {
      const taskId = path.split('/')[3];
      this.handleCancelTask(taskId, res);
    } else if (path.match(/^\/a2a\/tasks\/[^/]+\/input$/) && req.method === 'POST') {
      const taskId = path.split('/')[3];
      this.handleProvideInput(taskId, req, res);
    } else if (path.match(/^\/a2a\/tasks\/[^/]+\/subscribe$/) && req.method === 'GET') {
      const taskId = path.split('/')[3];
      this.handleSubscribeSSE(taskId, res, req);
    } else if (path.match(/^\/a2a\/tasks\/[^/]+\/push$/) && req.method === 'POST') {
      const taskId = path.split('/')[3];
      this.handleSetPushNotification(taskId, req, res);
    } else if (path === '/a2a/health' && req.method === 'GET') {
      this.jsonResponse(res, 200, { status: 'ok', activeTasks: this.activeTasks });
    } else {
      this.jsonResponse(res, 404, { error: 'Not found' });
    }
  }

  // ─── Endpoint Handlers ────────────────────────────────────

  private handleGetAgentCard(res: ServerResponse): void {
    this.jsonResponse(res, 200, this.agentCard);
  }

  private async handleCreateTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body) {
      this.jsonResponse(res, 400, { error: 'Invalid request body' });
      return;
    }

    if (this.activeTasks >= this.maxConcurrentTasks) {
      this.jsonResponse(res, 429, { error: 'Too many concurrent tasks' });
      return;
    }

    const input = body.input as A2AMessage | undefined;
    if (!input?.parts?.length) {
      this.jsonResponse(res, 400, { error: 'Task must have input with at least one part' });
      return;
    }

    const now = Date.now();
    const task: A2ATask = {
      id: (typeof body.id === 'string' ? body.id : null) ?? `task_${randomUUID().slice(0, 12)}`,
      status: 'submitted',
      input,
      history: [],
      artifacts: [],
      metadata: (body.metadata as Record<string, unknown>) ?? {},
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    this.emit('a2a:task:received', { taskId: task.id, input });

    // Start execution asynchronously
    if (this.taskHandler) {
      this.executeTask(task);
    }

    this.jsonResponse(res, 201, task);
  }

  private handleListTasks(_req: IncomingMessage, res: ServerResponse): void {
    const tasks = [...this.tasks.values()].map((t) => ({
      id: t.id,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    this.jsonResponse(res, 200, { tasks });
  }

  private handleGetTask(taskId: string, req: IncomingMessage, res: ServerResponse): void {
    const accept = req.headers.accept ?? '';

    // Check if client wants SSE
    if (accept.includes('text/event-stream')) {
      this.handleSubscribeSSE(taskId, res, req);
      return;
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      this.jsonResponse(res, 404, { error: `Task "${taskId}" not found` });
      return;
    }
    this.jsonResponse(res, 200, task);
  }

  private async handleCancelTask(taskId: string, res: ServerResponse): Promise<void> {
    const canceled = await this.cancelTask(taskId);
    if (canceled) {
      this.jsonResponse(res, 200, { status: 'canceled' });
    } else {
      this.jsonResponse(res, 404, { error: 'Task not found or already terminal' });
    }
  }

  private async handleProvideInput(taskId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body?.message) {
      this.jsonResponse(res, 400, { error: 'Request must include a message' });
      return;
    }

    const task = await this.provideInput(taskId, body.message as A2AMessage);
    if (task) {
      this.jsonResponse(res, 200, task);
    } else {
      this.jsonResponse(res, 400, { error: 'Task not in input-required state' });
    }
  }

  private handleSubscribeSSE(taskId: string, res: ServerResponse, req?: IncomingMessage): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      this.jsonResponse(res, 404, { error: `Task "${taskId}" not found` });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Register this client
    if (!this.sseClients.has(taskId)) {
      this.sseClients.set(taskId, new Set());
    }
    this.sseClients.get(taskId)!.add(res);

    // Send current state
    this.sendSSE(res, 'task:status', task);

    // Clean up on disconnect
    if (req) {
      req.on('close', () => {
        this.sseClients.get(taskId)?.delete(res);
        if (this.sseClients.get(taskId)?.size === 0) {
          this.sseClients.delete(taskId);
        }
      });
    }
  }

  private async handleSetPushNotification(taskId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (!body?.url) {
      this.jsonResponse(res, 400, { error: 'Push notification requires a URL' });
      return;
    }

    const pushConfig: A2APushNotification = {
      url: body.url as string,
      events: body.events as A2ATaskStatus[] | undefined,
      authentication: body.authentication as A2APushNotification['authentication'],
    };

    if (!this.pushSubscriptions.has(taskId)) {
      this.pushSubscriptions.set(taskId, []);
    }
    this.pushSubscriptions.get(taskId)!.push(pushConfig);

    this.jsonResponse(res, 200, { status: 'subscribed' });
  }

  // ─── Task Execution ───────────────────────────────────────

  private async executeTask(task: A2ATask): Promise<void> {
    this.activeTasks++;
    task.status = 'working';
    task.updatedAt = Date.now();
    this.notifyTaskUpdate(task.id, task);
    this.emit('a2a:task:working', { taskId: task.id });

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      if (task.status === 'working') {
        task.status = 'failed';
        task.output = {
          role: 'agent',
          parts: [{ type: 'text', text: 'Task timed out' }],
        };
        task.updatedAt = Date.now();
        this.activeTasks = Math.max(0, this.activeTasks - 1);
        this.notifyTaskUpdate(task.id, task);
        this.emit('a2a:task:failed', { taskId: task.id, error: 'timeout' });
      }
    }, this.taskTimeout);

    try {
      const result = await this.taskHandler!(task);
      clearTimeout(timeoutHandle);

      // Update task with result
      task.status = result.status;
      task.output = result.output;
      task.artifacts = result.artifacts ?? task.artifacts;
      task.updatedAt = Date.now();

      this.notifyTaskUpdate(task.id, task);

      if (task.status === 'completed') {
        this.emit('a2a:task:completed', { taskId: task.id });
      } else if (task.status === 'failed') {
        this.emit('a2a:task:failed', { taskId: task.id, error: task.output?.parts?.[0] });
      }
    } catch (err) {
      clearTimeout(timeoutHandle);
      task.status = 'failed';
      task.output = {
        role: 'agent',
        parts: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
      };
      task.updatedAt = Date.now();
      this.notifyTaskUpdate(task.id, task);
      this.emit('a2a:task:failed', { taskId: task.id, error: task.output.parts[0] });
    } finally {
      this.activeTasks = Math.max(0, this.activeTasks - 1);
    }
  }

  // ─── Notifications ────────────────────────────────────────

  private notifyTaskUpdate(taskId: string, task: A2ATask): void {
    // SSE notifications
    const clients = this.sseClients.get(taskId);
    if (clients) {
      for (const client of clients) {
        this.sendSSE(client, 'task:status', task);
      }
    }

    // Push notifications (fire-and-forget)
    const pushConfigs = this.pushSubscriptions.get(taskId);
    if (pushConfigs) {
      for (const config of pushConfigs) {
        if (!config.events || config.events.includes(task.status)) {
          this.sendPushNotification(config, task).catch(() => {
            // Silently ignore push failures
          });
        }
      }
    }
  }

  private sendSSE(res: ServerResponse, event: string, data: unknown): void {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Connection may have closed
    }
  }

  private async sendPushNotification(config: A2APushNotification, task: A2ATask): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.authentication?.type === 'bearer') {
      headers['Authorization'] = `Bearer ${(config.authentication.config as Record<string, string>)?.token ?? ''}`;
    }

    await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ taskId: task.id, status: task.status, task }),
      signal: AbortSignal.timeout(5_000),
    });
  }

  // ─── Helpers ──────────────────────────────────────────────

  private async readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });
  }

  private jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private defaultCapabilities(): AgentCapability[] {
    return [
      {
        name: 'code-generation',
        description: 'Generate, modify, and refactor code across multiple files',
        inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } },
      },
      {
        name: 'multi-agent-orchestration',
        description: 'Coordinate multiple specialized agents for complex tasks',
      },
      {
        name: 'code-review',
        description: 'Review code for quality, security, and best practices',
      },
      {
        name: 'testing',
        description: 'Generate and run test suites',
      },
      {
        name: 'reasoning',
        description: 'Advanced reasoning via ReAct, Reflexion, Tree-of-Thought, Debate, and RAG',
      },
    ];
  }

  private defaultSkills(): AgentSkill[] {
    return [
      {
        id: 'implement',
        name: 'Implement Feature',
        description: 'Implement a feature end-to-end with tests and quality verification',
        tags: ['coding', 'implementation', 'testing'],
        inputModes: ['text'],
        outputModes: ['text', 'code', 'file'],
      },
      {
        id: 'review',
        name: 'Code Review',
        description: 'Review code changes for bugs, security issues, and best practices',
        tags: ['review', 'quality', 'security'],
        inputModes: ['text', 'code'],
        outputModes: ['text'],
      },
      {
        id: 'refactor',
        name: 'Refactor Code',
        description: 'Refactor code for better architecture, performance, or readability',
        tags: ['refactoring', 'architecture'],
        inputModes: ['text', 'code'],
        outputModes: ['code', 'file'],
      },
      {
        id: 'debug',
        name: 'Debug Issue',
        description: 'Diagnose and fix bugs using reasoning and code analysis',
        tags: ['debugging', 'reasoning'],
        inputModes: ['text', 'code'],
        outputModes: ['text', 'code'],
      },
      {
        id: 'plan',
        name: 'Architecture Planning',
        description: 'Create implementation plans for complex features',
        tags: ['planning', 'architecture'],
        inputModes: ['text'],
        outputModes: ['text'],
      },
    ];
  }
}
