/**
 * CortexOS REST API Server
 *
 * Programmatic HTTP API for executing tasks, managing sessions,
 * and monitoring CortexOS. Uses Node.js built-in http module.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createAuthMiddleware, createCorsMiddleware, type RequestHandler } from './auth.js';
import type {
  APIServerConfig,
  TaskRecord,
  TaskStatus,
  RunTaskRequest,
  RunTaskResponse,
  HealthResponse,
  APIError,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// API SERVER
// ═══════════════════════════════════════════════════════════════

export class APIServer {
  private server: Server | null = null;
  private config: Required<APIServerConfig>;
  private tasks: Map<string, TaskRecord> = new Map();
  private startedAt: number = 0;
  private totalTasksRun: number = 0;
  private middleware: RequestHandler[] = [];
  private taskExecutor: TaskExecutor | null = null;

  constructor(config: APIServerConfig) {
    this.config = {
      port: config.port,
      apiKey: config.apiKey ?? '',
      corsOrigins: config.corsOrigins ?? ['*'],
      maxConcurrentTasks: config.maxConcurrentTasks ?? 4,
    };

    // Add CORS middleware
    this.middleware.push(createCorsMiddleware(this.config.corsOrigins));

    // Add auth middleware if API key configured
    if (this.config.apiKey) {
      this.middleware.push(createAuthMiddleware(this.config.apiKey));
    }
  }

  /** Set the task executor (usually wraps CortexEngine.execute) */
  setTaskExecutor(executor: TaskExecutor): void {
    this.taskExecutor = executor;
  }

  /** Start the API server */
  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.startedAt = Date.now();

      this.server = createServer((req, res) => {
        this.runMiddleware(req, res, 0, () => {
          this.handleRequest(req, res);
        });
      });

      this.server.on('error', reject);

      this.server.listen(this.config.port, () => {
        const url = `http://localhost:${this.config.port}`;
        resolve(url);
      });
    });
  }

  /** Stop the API server */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /** Get server status */
  isRunning(): boolean {
    return this.server?.listening ?? false;
  }

  /** Get all tasks */
  getTasks(filter?: { status?: TaskStatus; limit?: number }): TaskRecord[] {
    let tasks = Array.from(this.tasks.values());

    if (filter?.status) {
      tasks = tasks.filter(t => t.status === filter.status);
    }

    tasks.sort((a, b) => b.createdAt - a.createdAt);

    if (filter?.limit) {
      tasks = tasks.slice(0, filter.limit);
    }

    return tasks;
  }

  /** Get a specific task */
  getTask(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  // ─── Request Handling ─────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const method = req.method?.toUpperCase() || 'GET';
    const path = url.pathname;

    try {
      // Health check
      if (path === '/api/health' && method === 'GET') {
        return this.handleHealth(res);
      }

      // Task submission
      if (path === '/api/run' && method === 'POST') {
        return await this.handleRunTask(req, res);
      }

      // Task status
      const taskMatch = path.match(/^\/api\/run\/([^/]+)$/);
      if (taskMatch) {
        const taskId = taskMatch[1];
        if (method === 'GET') {
          return this.handleGetTask(taskId, res);
        }
        if (method === 'POST' && path.endsWith('/cancel')) {
          return this.handleCancelTask(taskId, res);
        }
      }

      // Task cancel
      const cancelMatch = path.match(/^\/api\/run\/([^/]+)\/cancel$/);
      if (cancelMatch && method === 'POST') {
        return this.handleCancelTask(cancelMatch[1], res);
      }

      // List tasks
      if (path === '/api/tasks' && method === 'GET') {
        return this.handleListTasks(url, res);
      }

      // Sessions
      if (path === '/api/sessions' && method === 'GET') {
        return this.handleListSessions(res);
      }

      // Config (sanitized)
      if (path === '/api/config' && method === 'GET') {
        return this.handleGetConfig(res);
      }

      // 404
      this.sendJSON(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
    } catch (err) {
      this.sendJSON(res, 500, {
        error: err instanceof Error ? err.message : 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  private handleHealth(res: ServerResponse): void {
    const activeTasks = Array.from(this.tasks.values()).filter(t => t.status === 'running').length;
    const response: HealthResponse = {
      status: activeTasks < this.config.maxConcurrentTasks ? 'ok' : 'degraded',
      version: '1.0.0',
      uptime: Date.now() - this.startedAt,
      activeTasks,
      totalTasksRun: this.totalTasksRun,
    };
    this.sendJSON(res, 200, response);
  }

  private async handleRunTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    let request: RunTaskRequest;

    try {
      request = JSON.parse(body);
    } catch {
      return this.sendJSON(res, 400, { error: 'Invalid JSON body', code: 'INVALID_JSON' });
    }

    if (!request.prompt || typeof request.prompt !== 'string') {
      return this.sendJSON(res, 400, { error: 'Missing required field: prompt', code: 'MISSING_PROMPT' });
    }

    // Check concurrent task limit
    const activeTasks = Array.from(this.tasks.values()).filter(t => t.status === 'running').length;
    if (activeTasks >= this.config.maxConcurrentTasks) {
      return this.sendJSON(res, 429, { error: 'Too many concurrent tasks', code: 'RATE_LIMITED' });
    }

    // Create task record
    const task: TaskRecord = {
      id: randomUUID(),
      prompt: request.prompt,
      status: 'queued',
      sessionId: request.sessionId || randomUUID(),
      createdAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    this.totalTasksRun++;

    // If async mode or no executor, return immediately
    if (request.async || !this.taskExecutor) {
      task.status = this.taskExecutor ? 'queued' : 'queued';

      if (this.taskExecutor) {
        // Fire and forget
        this.executeTaskAsync(task);
      }

      const response: RunTaskResponse = {
        taskId: task.id,
        status: task.status,
        sessionId: task.sessionId,
        createdAt: task.createdAt,
      };
      return this.sendJSON(res, 202, response);
    }

    // Synchronous execution
    await this.executeTaskSync(task);

    const response: RunTaskResponse = {
      taskId: task.id,
      status: task.status,
      sessionId: task.sessionId,
      createdAt: task.createdAt,
      result: task.result,
      error: task.error,
    };

    this.sendJSON(res, task.status === 'completed' ? 200 : 500, response);
  }

  private handleGetTask(taskId: string, res: ServerResponse): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return this.sendJSON(res, 404, { error: 'Task not found', code: 'NOT_FOUND' });
    }
    this.sendJSON(res, 200, task);
  }

  private handleCancelTask(taskId: string, res: ServerResponse): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return this.sendJSON(res, 404, { error: 'Task not found', code: 'NOT_FOUND' });
    }
    if (task.status !== 'running' && task.status !== 'queued') {
      return this.sendJSON(res, 400, { error: 'Task is not cancellable', code: 'NOT_CANCELLABLE' });
    }
    task.status = 'cancelled';
    task.completedAt = Date.now();
    this.sendJSON(res, 200, task);
  }

  private handleListTasks(url: URL, res: ServerResponse): void {
    const status = url.searchParams.get('status') as TaskStatus | null;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const tasks = this.getTasks({ status: status ?? undefined, limit });
    this.sendJSON(res, 200, { tasks, total: this.tasks.size });
  }

  private handleListSessions(res: ServerResponse): void {
    // Aggregate sessions from tasks
    const sessions = new Map<string, { id: string; taskCount: number; lastActivity: number }>();
    for (const task of this.tasks.values()) {
      const existing = sessions.get(task.sessionId);
      if (existing) {
        existing.taskCount++;
        existing.lastActivity = Math.max(existing.lastActivity, task.createdAt);
      } else {
        sessions.set(task.sessionId, {
          id: task.sessionId,
          taskCount: 1,
          lastActivity: task.createdAt,
        });
      }
    }
    this.sendJSON(res, 200, { sessions: Array.from(sessions.values()) });
  }

  private handleGetConfig(res: ServerResponse): void {
    // Return sanitized config (no secrets)
    this.sendJSON(res, 200, {
      api: {
        port: this.config.port,
        maxConcurrentTasks: this.config.maxConcurrentTasks,
        authEnabled: Boolean(this.config.apiKey),
      },
    });
  }

  // ─── Task Execution ───────────────────────────────────────

  private async executeTaskAsync(task: TaskRecord): Promise<void> {
    try {
      task.status = 'running';
      task.startedAt = Date.now();
      const result = await this.taskExecutor!(task.prompt);
      task.status = 'completed';
      task.result = result;
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
    } finally {
      task.completedAt = Date.now();
    }
  }

  private async executeTaskSync(task: TaskRecord): Promise<void> {
    return this.executeTaskAsync(task);
  }

  // ─── Helpers ──────────────────────────────────────────────

  private runMiddleware(req: IncomingMessage, res: ServerResponse, index: number, done: () => void): void {
    if (index >= this.middleware.length) return done();
    this.middleware[index](req, res, () => this.runMiddleware(req, res, index + 1, done));
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  private sendJSON(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type TaskExecutor = (prompt: string) => Promise<any>;
