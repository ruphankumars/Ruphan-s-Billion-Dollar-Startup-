/**
 * Discord Bot Surface — Interactions Endpoint & REST API Client
 *
 * Full Discord bot integration surface for CortexOS. Implements the
 * Discord Interactions endpoint for receiving slash commands, button
 * clicks, and other component interactions. Verifies Ed25519 signatures
 * and communicates with the Discord REST API.
 *
 * Features:
 * - Ed25519 signature verification (x-signature-ed25519, x-signature-timestamp)
 * - PING (type 1) handling for endpoint verification
 * - APPLICATION_COMMAND (type 2) routing
 * - MESSAGE_COMPONENT (type 3) handling
 * - Slash command registration via Discord REST API
 * - Interaction responses and follow-up messages
 * - CortexOS engine integration via setTaskHandler
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID, verify } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Surface,
  SurfaceType,
  DiscordBotConfig,
  DiscordInteraction,
  DiscordBotStats,
} from '../types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** Discord interaction types */
const INTERACTION_TYPES = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

/** Discord interaction response types */
const INTERACTION_RESPONSE_TYPES = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9,
} as const;

// ═══════════════════════════════════════════════════════════════
// DISCORD COMMAND DEFINITION
// ═══════════════════════════════════════════════════════════════

export interface DiscordCommandOption {
  name: string;
  description: string;
  type: number; // 1=SUB_COMMAND, 2=SUB_COMMAND_GROUP, 3=STRING, 4=INTEGER, 5=BOOLEAN, ...
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
}

export interface DiscordCommandDefinition {
  name: string;
  description: string;
  options?: DiscordCommandOption[];
}

// ═══════════════════════════════════════════════════════════════
// DISCORD BOT SURFACE
// ═══════════════════════════════════════════════════════════════

export class DiscordBot extends EventEmitter implements Surface {
  readonly id: string;
  readonly type: SurfaceType = 'discord';

  private server: Server | null = null;
  private config: Required<DiscordBotConfig>;
  private running = false;
  private startTime = 0;

  // Stats
  private eventsReceived = 0;
  private eventsProcessed = 0;
  private errorCount = 0;
  private interactionsReceived = 0;
  private commandsProcessed = 0;
  private messagesSent = 0;

  // Task handler (wired to CortexOS engine)
  private taskHandler: ((event: string, payload: unknown) => Promise<unknown>) | null = null;

  // Registered command handlers
  private commandHandlers: Map<string, (interaction: DiscordInteraction) => Promise<unknown>> = new Map();

  constructor(config: DiscordBotConfig) {
    super();
    this.id = `discord_${randomUUID().slice(0, 8)}`;
    this.config = {
      botToken: config.botToken,
      applicationId: config.applicationId,
      publicKey: config.publicKey,
      port: config.port ?? 3302,
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

  getStats(): DiscordBotStats {
    return {
      type: this.type,
      isRunning: this.running,
      eventsReceived: this.eventsReceived,
      eventsProcessed: this.eventsProcessed,
      errors: this.errorCount,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      interactionsReceived: this.interactionsReceived,
      commandsProcessed: this.commandsProcessed,
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
   * Register a handler for a specific slash command name.
   */
  registerCommandHandler(
    name: string,
    handler: (interaction: DiscordInteraction) => Promise<unknown>,
  ): void {
    this.commandHandlers.set(name, handler);
  }

  // ─── Slash Command Registration (Discord REST API) ─────────

  /**
   * Register a global slash command with Discord.
   * This uses the Discord REST API to create/update application commands.
   */
  async registerCommand(
    name: string,
    description: string,
    options?: DiscordCommandOption[],
  ): Promise<void> {
    const body: Record<string, unknown> = {
      name,
      description,
    };

    if (options && options.length > 0) {
      body.options = options;
    }

    const response = await fetch(
      `${DISCORD_API_BASE}/applications/${this.config.applicationId}/commands`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error registering command "${name}": ${response.status} — ${error}`);
    }
  }

  /**
   * Register a guild-specific slash command with Discord.
   */
  async registerGuildCommand(
    guildId: string,
    name: string,
    description: string,
    options?: DiscordCommandOption[],
  ): Promise<void> {
    const body: Record<string, unknown> = {
      name,
      description,
    };

    if (options && options.length > 0) {
      body.options = options;
    }

    const response = await fetch(
      `${DISCORD_API_BASE}/applications/${this.config.applicationId}/guilds/${guildId}/commands`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error registering guild command "${name}": ${response.status} — ${error}`);
    }
  }

  // ─── Interaction Responses ─────────────────────────────────

  /**
   * Respond to a Discord interaction.
   * Must be called within 3 seconds of receiving the interaction.
   */
  async respondToInteraction(
    interaction: DiscordInteraction,
    content: string,
    options?: {
      ephemeral?: boolean;
      embeds?: Array<Record<string, unknown>>;
    },
  ): Promise<void> {
    const data: Record<string, unknown> = { content };

    if (options?.ephemeral) {
      data.flags = 64; // EPHEMERAL flag
    }

    if (options?.embeds) {
      data.embeds = options.embeds;
    }

    const response = await fetch(
      `${DISCORD_API_BASE}/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: INTERACTION_RESPONSE_TYPES.CHANNEL_MESSAGE_WITH_SOURCE,
          data,
        }),
        signal: AbortSignal.timeout(3_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Discord interaction response error: ${response.status}`);
    }

    this.messagesSent++;
  }

  /**
   * Send a deferred response (shows "Bot is thinking...").
   * Use this when processing takes longer than 3 seconds.
   */
  async deferResponse(
    interaction: DiscordInteraction,
    ephemeral = false,
  ): Promise<void> {
    const data: Record<string, unknown> = {};
    if (ephemeral) {
      data.flags = 64;
    }

    const response = await fetch(
      `${DISCORD_API_BASE}/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: INTERACTION_RESPONSE_TYPES.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
          data,
        }),
        signal: AbortSignal.timeout(3_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Discord defer response error: ${response.status}`);
    }
  }

  /**
   * Send a follow-up message after a deferred response.
   * Can be called any time after deferring.
   */
  async sendFollowup(
    token: string,
    content: string,
    options?: {
      ephemeral?: boolean;
      embeds?: Array<Record<string, unknown>>;
    },
  ): Promise<void> {
    const body: Record<string, unknown> = { content };

    if (options?.ephemeral) {
      body.flags = 64;
    }

    if (options?.embeds) {
      body.embeds = options.embeds;
    }

    const response = await fetch(
      `${DISCORD_API_BASE}/webhooks/${this.config.applicationId}/${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Discord follow-up error: ${response.status}`);
    }

    this.messagesSent++;
  }

  /**
   * Edit the original interaction response.
   */
  async editOriginalResponse(
    token: string,
    content: string,
    embeds?: Array<Record<string, unknown>>,
  ): Promise<void> {
    const body: Record<string, unknown> = { content };

    if (embeds) {
      body.embeds = embeds;
    }

    const response = await fetch(
      `${DISCORD_API_BASE}/webhooks/${this.config.applicationId}/${token}/messages/@original`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Discord edit original response error: ${response.status}`);
    }
  }

  // ─── HTTP Request Handling ─────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // Health check
    if (path === '/health' && req.method === 'GET') {
      this.jsonResponse(res, 200, {
        status: 'ok',
        surface: 'discord',
        interactionsReceived: this.interactionsReceived,
      });
      return;
    }

    // Interactions endpoint
    if ((path === '/interactions' || path === '/discord/interactions') && req.method === 'POST') {
      await this.handleInteraction(req, res);
      return;
    }

    this.jsonResponse(res, 404, { error: 'Not found' });
  }

  private async handleInteraction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.eventsReceived++;
    this.interactionsReceived++;

    // Read body
    const rawBody = await this.readBody(req);

    // Verify Ed25519 signature
    const signature = req.headers['x-signature-ed25519'] as string | undefined;
    const timestamp = req.headers['x-signature-timestamp'] as string | undefined;

    if (!signature || !timestamp || !this.verifyDiscordSignature(rawBody, signature, timestamp)) {
      this.errorCount++;
      this.jsonResponse(res, 401, { error: 'Invalid request signature' });
      return;
    }

    // Parse payload
    let interaction: DiscordInteraction;
    try {
      interaction = JSON.parse(rawBody);
    } catch {
      this.errorCount++;
      this.jsonResponse(res, 400, { error: 'Invalid JSON payload' });
      return;
    }

    // Route by interaction type
    switch (interaction.type) {
      case INTERACTION_TYPES.PING: {
        // Discord verification ping — must respond with PONG
        this.jsonResponse(res, 200, { type: INTERACTION_RESPONSE_TYPES.PONG });
        break;
      }

      case INTERACTION_TYPES.APPLICATION_COMMAND: {
        await this.handleApplicationCommand(interaction, res);
        break;
      }

      case INTERACTION_TYPES.MESSAGE_COMPONENT: {
        await this.handleMessageComponent(interaction, res);
        break;
      }

      case INTERACTION_TYPES.APPLICATION_COMMAND_AUTOCOMPLETE: {
        await this.handleAutocomplete(interaction, res);
        break;
      }

      case INTERACTION_TYPES.MODAL_SUBMIT: {
        await this.handleModalSubmit(interaction, res);
        break;
      }

      default: {
        this.jsonResponse(res, 400, { error: `Unknown interaction type: ${interaction.type}` });
        break;
      }
    }

    this.eventsProcessed++;
  }

  // ─── Interaction Handlers ──────────────────────────────────

  private async handleApplicationCommand(
    interaction: DiscordInteraction,
    res: ServerResponse,
  ): Promise<void> {
    this.commandsProcessed++;

    const commandName = interaction.data?.name;
    if (!commandName) {
      this.jsonResponse(res, 400, { error: 'Missing command name' });
      return;
    }

    const user = interaction.member?.user ?? interaction.user;

    this.emit('surface:discord:command', {
      command: commandName,
      options: interaction.data?.options,
      user: user?.username,
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      timestamp: Date.now(),
    });

    // Check for registered handler
    const handler = this.commandHandlers.get(commandName);
    if (handler) {
      // Send deferred response, process async
      this.jsonResponse(res, 200, {
        type: INTERACTION_RESPONSE_TYPES.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      });

      handler(interaction).catch((err) => {
        this.errorCount++;
        this.emit('surface:error', {
          surfaceId: this.id,
          error: `Command handler failed: ${err instanceof Error ? err.message : String(err)}`,
          command: commandName,
          timestamp: Date.now(),
        });

        // Send error follow-up
        this.sendFollowup(
          interaction.token,
          `An error occurred while processing the \`/${commandName}\` command.`,
          { ephemeral: true },
        ).catch(() => { /* ignore follow-up errors */ });
      });
    } else if (this.taskHandler) {
      // Forward to task handler
      this.jsonResponse(res, 200, {
        type: INTERACTION_RESPONSE_TYPES.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      });

      this.taskHandler('discord:command', {
        command: commandName,
        interaction,
      }).catch((err) => {
        this.errorCount++;
        this.emit('surface:error', {
          surfaceId: this.id,
          error: `Task handler failed for command: ${err instanceof Error ? err.message : String(err)}`,
          command: commandName,
          timestamp: Date.now(),
        });
      });
    } else {
      // No handler — respond with a helpful message
      this.jsonResponse(res, 200, {
        type: INTERACTION_RESPONSE_TYPES.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `Unknown command: \`/${commandName}\`. Use \`/help\` to see available commands.`,
          flags: 64, // EPHEMERAL
        },
      });
    }
  }

  private async handleMessageComponent(
    interaction: DiscordInteraction,
    res: ServerResponse,
  ): Promise<void> {
    this.emit('surface:discord:interaction', {
      type: 'message_component',
      interactionId: interaction.id,
      user: (interaction.member?.user ?? interaction.user)?.username,
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      timestamp: Date.now(),
    });

    // Acknowledge with deferred update
    this.jsonResponse(res, 200, {
      type: INTERACTION_RESPONSE_TYPES.DEFERRED_UPDATE_MESSAGE,
    });

    // Forward to task handler
    if (this.taskHandler) {
      this.taskHandler('discord:component', interaction).catch((err) => {
        this.errorCount++;
        this.emit('surface:error', {
          surfaceId: this.id,
          error: `Component handler failed: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        });
      });
    }
  }

  private async handleAutocomplete(
    interaction: DiscordInteraction,
    res: ServerResponse,
  ): Promise<void> {
    // Forward to task handler if available
    if (this.taskHandler) {
      try {
        const result = await this.taskHandler('discord:autocomplete', interaction) as
          { choices?: Array<{ name: string; value: string }> } | undefined;

        this.jsonResponse(res, 200, {
          type: INTERACTION_RESPONSE_TYPES.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
          data: {
            choices: result?.choices ?? [],
          },
        });
      } catch {
        this.jsonResponse(res, 200, {
          type: INTERACTION_RESPONSE_TYPES.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
          data: { choices: [] },
        });
      }
    } else {
      this.jsonResponse(res, 200, {
        type: INTERACTION_RESPONSE_TYPES.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
        data: { choices: [] },
      });
    }
  }

  private async handleModalSubmit(
    interaction: DiscordInteraction,
    res: ServerResponse,
  ): Promise<void> {
    this.emit('surface:discord:interaction', {
      type: 'modal_submit',
      interactionId: interaction.id,
      user: (interaction.member?.user ?? interaction.user)?.username,
      timestamp: Date.now(),
    });

    // Acknowledge immediately
    this.jsonResponse(res, 200, {
      type: INTERACTION_RESPONSE_TYPES.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });

    // Forward to task handler
    if (this.taskHandler) {
      this.taskHandler('discord:modal_submit', interaction).catch((err) => {
        this.errorCount++;
        this.emit('surface:error', {
          surfaceId: this.id,
          error: `Modal submit handler failed: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        });
      });
    }
  }

  // ─── Ed25519 Signature Verification ────────────────────────

  /**
   * Verify Discord interaction signature using Ed25519.
   *
   * Discord requires verifying the x-signature-ed25519 and
   * x-signature-timestamp headers against the request body
   * using the application's public key.
   */
  private verifyDiscordSignature(
    body: string,
    signature: string,
    timestamp: string,
  ): boolean {
    try {
      const message = Buffer.from(timestamp + body);
      const sig = Buffer.from(signature, 'hex');
      const pubKey = Buffer.from(this.config.publicKey, 'hex');

      // Use Node.js crypto.verify with Ed25519
      return verify(
        null, // Ed25519 does not use a digest algorithm
        message,
        {
          key: Buffer.concat([
            // Ed25519 DER public key header
            Buffer.from('302a300506032b6570032100', 'hex'),
            pubKey,
          ]),
          format: 'der',
          type: 'spki',
        },
        sig,
      );
    } catch {
      return false;
    }
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
