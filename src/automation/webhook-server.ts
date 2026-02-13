/**
 * Webhook Server — HTTP Trigger Endpoints
 *
 * Receives external HTTP webhooks and triggers skill execution.
 * Supports HMAC signature verification for security.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { WebhookConfig } from './types.js';

export type WebhookHandler = (config: WebhookConfig, payload: unknown) => void | Promise<void>;

export class WebhookServer {
  private server: Server | null = null;
  private webhooks: Map<string, WebhookConfig> = new Map();
  private pathIndex: Map<string, string> = new Map(); // path -> webhook id
  private handler: WebhookHandler | null = null;
  private port: number;
  private globalSecret?: string;

  constructor(options: { port: number; secret?: string }) {
    this.port = options.port;
    this.globalSecret = options.secret;
  }

  /** Set the handler called when a webhook fires */
  onWebhook(handler: WebhookHandler): void {
    this.handler = handler;
  }

  /** Register a webhook endpoint */
  registerWebhook(config: WebhookConfig): void {
    this.webhooks.set(config.id, config);
    this.pathIndex.set(config.path, config.id);
  }

  /** Create and register a new webhook */
  createWebhook(skillId: string, path: string, options?: {
    secret?: string;
    inputMapping?: Record<string, string>;
  }): WebhookConfig {
    const config: WebhookConfig = {
      id: `wh_${randomUUID().slice(0, 8)}`,
      skillId,
      path: path.startsWith('/') ? path : `/${path}`,
      secret: options?.secret,
      inputMapping: options?.inputMapping,
      enabled: true,
      createdAt: Date.now(),
    };

    this.registerWebhook(config);
    return config;
  }

  /** Remove a webhook */
  removeWebhook(id: string): boolean {
    const config = this.webhooks.get(id);
    if (config) {
      this.pathIndex.delete(config.path);
      return this.webhooks.delete(id);
    }
    return false;
  }

  /** Get all webhooks */
  getWebhooks(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  /** Start the webhook server */
  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);

      this.server.listen(this.port, () => {
        resolve(`http://localhost:${this.port}`);
      });
    });
  }

  /** Stop the webhook server */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /** Check if server is running */
  isRunning(): boolean {
    return this.server?.listening ?? false;
  }

  // ─── Request Handling ─────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // Health check
    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', webhooks: this.webhooks.size }));
      return;
    }

    // Only accept POST
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Look up webhook by path
    const webhookId = this.pathIndex.get(path);
    if (!webhookId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook not found' }));
      return;
    }

    const config = this.webhooks.get(webhookId);
    if (!config || !config.enabled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook disabled' }));
      return;
    }

    // Read body
    const body = await this.readBody(req);

    // Verify signature if secret is configured
    const secret = config.secret || this.globalSecret;
    if (secret) {
      const signature = req.headers['x-signature-256'] as string ||
                       req.headers['x-hub-signature-256'] as string;
      if (!signature || !this.verifySignature(body, signature, secret)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }
    }

    // Parse payload
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = { raw: body };
    }

    // Apply input mapping
    if (config.inputMapping && typeof payload === 'object' && payload !== null) {
      const mapped: Record<string, unknown> = {};
      for (const [targetKey, sourcePath] of Object.entries(config.inputMapping)) {
        mapped[targetKey] = getNestedValue(payload as Record<string, unknown>, sourcePath);
      }
      payload = { ...payload as object, _mapped: mapped };
    }

    // Fire handler
    if (this.handler) {
      try {
        const result = this.handler(config, payload);
        if (result instanceof Promise) {
          result.catch(() => {}); // Fire and forget
        }
      } catch {
        // Handler errors don't affect response
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true, webhookId: config.id }));
  }

  // ─── Helpers ──────────────────────────────────────────────

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  private verifySignature(body: string, signature: string, secret: string): boolean {
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current: unknown, key) => {
    if (typeof current === 'object' && current !== null) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
