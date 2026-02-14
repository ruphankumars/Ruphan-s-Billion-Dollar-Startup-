/**
 * Slack Bot Surface — Events API & Interactions Handler
 *
 * Full Slack bot integration surface for CortexOS. Receives events via
 * the Slack Events API, verifies request signatures, handles slash commands
 * and interactive payloads, and posts messages using the Slack Web API.
 *
 * Features:
 * - Request signature verification (x-slack-signature, HMAC-SHA256)
 * - Events API url_verification challenge handling
 * - Event routing: app_mention, message, slash commands
 * - Interactive payloads: block_actions, view_submission, shortcuts
 * - Slack Web API: sendMessage, respondToCommand, openModal
 * - CortexOS engine integration via setTaskHandler
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Surface,
  SurfaceType,
  SlackBotConfig,
  SlackEvent,
  SlackSlashCommand,
  SlackInteraction,
  SlackBlock,
  SlackBotStats,
} from '../types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const SLACK_API_BASE = 'https://slack.com/api';

/** Slack signature version prefix */
const SLACK_SIGNATURE_VERSION = 'v0';

/** Maximum allowed timestamp drift for signature verification (5 minutes) */
const MAX_TIMESTAMP_DRIFT_SECONDS = 300;

// ═══════════════════════════════════════════════════════════════
// SLACK BOT SURFACE
// ═══════════════════════════════════════════════════════════════

export class SlackBot extends EventEmitter implements Surface {
  readonly id: string;
  readonly type: SurfaceType = 'slack';

  private server: Server | null = null;
  private config: Required<SlackBotConfig>;
  private running = false;
  private startTime = 0;

  // Stats
  private eventsReceived = 0;
  private eventsProcessed = 0;
  private errorCount = 0;
  private messagesReceived = 0;
  private commandsProcessed = 0;
  private interactionsHandled = 0;
  private messagesSent = 0;

  // Task handler (wired to CortexOS engine)
  private taskHandler: ((event: string, payload: unknown) => Promise<unknown>) | null = null;

  // Command handlers
  private commandHandlers: Map<string, (cmd: SlackSlashCommand) => Promise<unknown>> = new Map();

  constructor(config: SlackBotConfig) {
    super();
    this.id = `slack_${randomUUID().slice(0, 8)}`;
    this.config = {
      botToken: config.botToken,
      signingSecret: config.signingSecret,
      appToken: config.appToken ?? '',
      port: config.port ?? 3301,
      hostname: config.hostname ?? '0.0.0.0',
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.errorCount++;
          this.emit('surface:error', {
            surfaceId: this.id,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          });
        });
      });

      this.server.on('error', (err) => {
        this.errorCount++;
        this.emit('surface:error', {
          surfaceId: this.id,
          error: err.message,
          timestamp: Date.now(),
        });
        reject(err);
      });

      this.server.listen(this.config.port, this.config.hostname, () => {
        this.running = true;
        this.startTime = Date.now();
        this.emit('surface:started', {
          surfaceId: this.id,
          type: this.type,
          port: this.config.port,
          timestamp: Date.now(),
        });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.running = false;
          this.emit('surface:stopped', {
            surfaceId: this.id,
            type: this.type,
            timestamp: Date.now(),
          });
          resolve();
        });
      } else {
        this.running = false;
        resolve();
      }
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getStats(): SlackBotStats {
    return {
      type: this.type,
      isRunning: this.running,
      eventsReceived: this.eventsReceived,
      eventsProcessed: this.eventsProcessed,
      errors: this.errorCount,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      messagesReceived: this.messagesReceived,
      commandsProcessed: this.commandsProcessed,
      interactionsHandled: this.interactionsHandled,
      messagesSent: this.messagesSent,
    };
  }

  // ─── Configuration ─────────────────────────────────────────

  /**
   * Set the task handler for CortexOS engine integration.
   */
  setTaskHandler(handler: (event: string, payload: unknown) => Promise<unknown>): void {
    this.taskHandler = handler;
  }

  /**
   * Register a handler for a specific slash command.
   */
  registerCommand(command: string, handler: (cmd: SlackSlashCommand) => Promise<unknown>): void {
    this.commandHandlers.set(command, handler);
  }

  // ─── Slack Web API Methods ─────────────────────────────────

  /**
   * Send a message to a Slack channel.
   */
  async sendMessage(
    channel: string,
    text: string,
    blocks?: SlackBlock[],
    threadTs?: string,
  ): Promise<{ ok: boolean; ts?: string; error?: string }> {
    const body: Record<string, unknown> = {
      channel,
      text,
    };

    if (blocks && blocks.length > 0) {
      body.blocks = blocks;
    }

    if (threadTs) {
      body.thread_ts = threadTs;
    }

    const result = await this.slackAPICall('chat.postMessage', body);
    if (result.ok) {
      this.messagesSent++;
    }

    return result as { ok: boolean; ts?: string; error?: string };
  }

  /**
   * Respond to a slash command using the response_url.
   */
  async respondToCommand(
    responseUrl: string,
    data: {
      text?: string;
      blocks?: SlackBlock[];
      response_type?: 'in_channel' | 'ephemeral';
      replace_original?: boolean;
    },
  ): Promise<void> {
    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Slack response_url error: ${response.status} ${response.statusText}`);
    }

    this.messagesSent++;
  }

  /**
   * Open a modal view using a trigger_id.
   */
  async openModal(
    triggerId: string,
    view: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.slackAPICall('views.open', {
      trigger_id: triggerId,
      view,
    }) as Promise<{ ok: boolean; error?: string }>;
  }

  /**
   * Update a message by its timestamp.
   */
  async updateMessage(
    channel: string,
    ts: string,
    text: string,
    blocks?: SlackBlock[],
  ): Promise<{ ok: boolean; error?: string }> {
    const body: Record<string, unknown> = {
      channel,
      ts,
      text,
    };

    if (blocks && blocks.length > 0) {
      body.blocks = blocks;
    }

    return this.slackAPICall('chat.update', body) as Promise<{ ok: boolean; error?: string }>;
  }

  /**
   * Add a reaction to a message.
   */
  async addReaction(
    channel: string,
    timestamp: string,
    emoji: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.slackAPICall('reactions.add', {
      channel,
      timestamp,
      name: emoji,
    }) as Promise<{ ok: boolean; error?: string }>;
  }

  // ─── HTTP Request Handling ─────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // Health check
    if (path === '/health' && req.method === 'GET') {
      this.jsonResponse(res, 200, {
        status: 'ok',
        surface: 'slack',
        messagesReceived: this.messagesReceived,
      });
      return;
    }

    // Only accept POST for Slack events/commands/interactions
    if (req.method !== 'POST') {
      this.jsonResponse(res, 405, { error: 'Method not allowed' });
      return;
    }

    // Read body
    const rawBody = await this.readBody(req);

    // Route based on path
    if (path === '/slack/events') {
      await this.handleEventsAPI(req, res, rawBody);
    } else if (path === '/slack/commands') {
      await this.handleSlashCommand(req, res, rawBody);
    } else if (path === '/slack/interactions') {
      await this.handleInteraction(req, res, rawBody);
    } else {
      this.jsonResponse(res, 404, { error: 'Not found' });
    }
  }

  // ─── Events API Handler ────────────────────────────────────

  private async handleEventsAPI(
    req: IncomingMessage,
    res: ServerResponse,
    rawBody: string,
  ): Promise<void> {
    this.eventsReceived++;

    // Verify signature
    if (!this.verifySlackSignature(req, rawBody)) {
      this.errorCount++;
      this.jsonResponse(res, 401, { error: 'Invalid signature' });
      return;
    }

    // Parse body
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      this.errorCount++;
      this.jsonResponse(res, 400, { error: 'Invalid JSON' });
      return;
    }

    // Handle url_verification challenge
    if (body.type === 'url_verification') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ challenge: body.challenge }));
      return;
    }

    // Acknowledge immediately
    this.jsonResponse(res, 200, { ok: true });

    // Route the event
    if (body.type === 'event_callback') {
      const event = body.event as SlackEvent | undefined;
      if (event) {
        this.routeEvent(event).catch((err) => {
          this.errorCount++;
          this.emit('surface:error', {
            surfaceId: this.id,
            error: `Event handling failed: ${err instanceof Error ? err.message : String(err)}`,
            eventType: event.type,
            timestamp: Date.now(),
          });
        });
      }
    }
  }

  // ─── Event Routing ─────────────────────────────────────────

  private async routeEvent(event: SlackEvent): Promise<void> {
    // Skip bot messages to avoid loops
    if (event.bot_id) return;

    switch (event.type) {
      case 'app_mention': {
        this.messagesReceived++;

        this.emit('surface:slack:message', {
          type: 'mention',
          user: event.user,
          channel: event.channel,
          text: event.text,
          threadTs: event.thread_ts,
          timestamp: Date.now(),
        });

        // Forward to task handler
        if (this.taskHandler) {
          await this.taskHandler('slack:mention', event);
        }
        break;
      }

      case 'message': {
        // Only handle direct messages or mentions
        if (event.channel?.startsWith('D') || event.text?.includes(`<@`)) {
          this.messagesReceived++;

          this.emit('surface:slack:message', {
            type: event.channel?.startsWith('D') ? 'dm' : 'message',
            user: event.user,
            channel: event.channel,
            text: event.text,
            threadTs: event.thread_ts,
            timestamp: Date.now(),
          });

          // Forward to task handler
          if (this.taskHandler) {
            await this.taskHandler('slack:message', event);
          }
        }
        break;
      }

      default: {
        // Forward unknown events to task handler
        if (this.taskHandler) {
          await this.taskHandler(`slack:event:${event.type}`, event);
        }
        break;
      }
    }

    this.eventsProcessed++;
  }

  // ─── Slash Command Handler ─────────────────────────────────

  private async handleSlashCommand(
    req: IncomingMessage,
    res: ServerResponse,
    rawBody: string,
  ): Promise<void> {
    this.eventsReceived++;

    // Verify signature
    if (!this.verifySlackSignature(req, rawBody)) {
      this.errorCount++;
      this.jsonResponse(res, 401, { error: 'Invalid signature' });
      return;
    }

    // Parse URL-encoded form data
    const params = new URLSearchParams(rawBody);
    const command: SlackSlashCommand = {
      command: params.get('command') || '',
      text: params.get('text') || '',
      user_id: params.get('user_id') || '',
      user_name: params.get('user_name') || '',
      channel_id: params.get('channel_id') || '',
      channel_name: params.get('channel_name') || '',
      team_id: params.get('team_id') || '',
      response_url: params.get('response_url') || '',
      trigger_id: params.get('trigger_id') || '',
    };

    this.commandsProcessed++;

    this.emit('surface:slack:command', {
      command: command.command,
      text: command.text,
      user: command.user_name,
      channel: command.channel_name,
      timestamp: Date.now(),
    });

    // Check for registered command handler
    const handler = this.commandHandlers.get(command.command);
    if (handler) {
      // Acknowledge immediately, process async
      this.jsonResponse(res, 200, {
        response_type: 'ephemeral',
        text: 'Processing your request...',
      });

      handler(command).catch((err) => {
        this.errorCount++;
        this.emit('surface:error', {
          surfaceId: this.id,
          error: `Command handler failed: ${err instanceof Error ? err.message : String(err)}`,
          command: command.command,
          timestamp: Date.now(),
        });
      });
    } else if (this.taskHandler) {
      // Forward to task handler
      this.jsonResponse(res, 200, {
        response_type: 'ephemeral',
        text: 'Processing your request...',
      });

      this.taskHandler('slack:command', command).catch((err) => {
        this.errorCount++;
        this.emit('surface:error', {
          surfaceId: this.id,
          error: `Task handler failed for command: ${err instanceof Error ? err.message : String(err)}`,
          command: command.command,
          timestamp: Date.now(),
        });
      });
    } else {
      this.jsonResponse(res, 200, {
        response_type: 'ephemeral',
        text: `Unknown command: ${command.command}`,
      });
    }

    this.eventsProcessed++;
  }

  // ─── Interaction Handler ───────────────────────────────────

  private async handleInteraction(
    req: IncomingMessage,
    res: ServerResponse,
    rawBody: string,
  ): Promise<void> {
    this.eventsReceived++;

    // Verify signature
    if (!this.verifySlackSignature(req, rawBody)) {
      this.errorCount++;
      this.jsonResponse(res, 401, { error: 'Invalid signature' });
      return;
    }

    // Interactions are URL-encoded with a `payload` field
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get('payload');

    if (!payloadStr) {
      this.errorCount++;
      this.jsonResponse(res, 400, { error: 'Missing payload' });
      return;
    }

    let interaction: SlackInteraction;
    try {
      interaction = JSON.parse(payloadStr);
    } catch {
      this.errorCount++;
      this.jsonResponse(res, 400, { error: 'Invalid payload JSON' });
      return;
    }

    this.interactionsHandled++;

    // Acknowledge immediately
    this.jsonResponse(res, 200, { ok: true });

    this.emit('surface:slack:interaction', {
      type: interaction.type,
      user: interaction.user?.name,
      triggerId: interaction.trigger_id,
      actions: interaction.actions?.map((a) => a.action_id),
      timestamp: Date.now(),
    });

    // Forward to task handler
    if (this.taskHandler) {
      this.taskHandler('slack:interaction', interaction).catch((err) => {
        this.errorCount++;
        this.emit('surface:error', {
          surfaceId: this.id,
          error: `Interaction handler failed: ${err instanceof Error ? err.message : String(err)}`,
          interactionType: interaction.type,
          timestamp: Date.now(),
        });
      });
    }

    this.eventsProcessed++;
  }

  // ─── Signature Verification ────────────────────────────────

  private verifySlackSignature(req: IncomingMessage, body: string): boolean {
    const timestamp = req.headers['x-slack-request-timestamp'] as string | undefined;
    const signature = req.headers['x-slack-signature'] as string | undefined;

    if (!timestamp || !signature) return false;

    // Check timestamp freshness (prevent replay attacks)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > MAX_TIMESTAMP_DRIFT_SECONDS) {
      return false;
    }

    // Compute expected signature
    const sigBasestring = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${body}`;
    const expectedSignature = `${SLACK_SIGNATURE_VERSION}=` +
      createHmac('sha256', this.config.signingSecret)
        .update(sigBasestring)
        .digest('hex');

    try {
      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch {
      return false;
    }
  }

  // ─── Slack API Helper ──────────────────────────────────────

  private async slackAPICall(
    method: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error ?? 'unknown_error'}`);
    }

    return data;
  }

  // ─── Helpers ───────────────────────────────────────────────

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  private jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
