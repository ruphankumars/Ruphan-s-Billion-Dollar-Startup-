import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { DiscordBot } from '../../../src/surfaces/discord/discord-bot.js';
import type { DiscordBotConfig } from '../../../src/surfaces/types.js';

// Generate a real Ed25519 key pair for testing signature verification
const { publicKey: ed25519PublicKey, privateKey: ed25519PrivateKey } = generateKeyPairSync('ed25519');

// Export the raw public key in hex format (32 bytes = 64 hex chars)
const publicKeyHex = ed25519PublicKey.export({ type: 'spki', format: 'der' })
  .subarray(-32) // Last 32 bytes are the raw public key
  .toString('hex');

const TEST_CONFIG: DiscordBotConfig = {
  botToken: 'test-bot-token',
  applicationId: 'test-app-id-123',
  publicKey: publicKeyHex,
  port: 0, // OS-assigned port
  hostname: '127.0.0.1',
};

/** Sign a message with the Ed25519 private key and return hex signature */
function signMessage(timestamp: string, body: string): string {
  const message = Buffer.from(timestamp + body);
  const signature = sign(null, message, ed25519PrivateKey);
  return signature.toString('hex');
}

describe('DiscordBot', () => {
  let bot: DiscordBot;

  beforeEach(() => {
    bot = new DiscordBot(TEST_CONFIG);
  });

  // ── Constructor ──

  describe('constructor', () => {
    it('should create an instance with config stored', () => {
      expect(bot).toBeDefined();
      expect(bot.id).toMatch(/^discord_/);
      expect(bot.type).toBe('discord');
      expect(bot.isRunning()).toBe(false);
    });

    it('should use default port and hostname when not specified', () => {
      const minimal = new DiscordBot({
        botToken: 'token',
        applicationId: 'appid',
        publicKey: publicKeyHex,
      });
      expect(minimal).toBeDefined();
      expect(minimal.type).toBe('discord');
    });
  });

  // ── verifyDiscordSignature (via private access) ──

  describe('verifyInteraction (Ed25519 signature)', () => {
    it('should accept a valid Ed25519 signature', () => {
      const verify = (bot as unknown as {
        verifyDiscordSignature(body: string, signature: string, timestamp: string): boolean;
      }).verifyDiscordSignature.bind(bot);

      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = '{"type":1}';
      const signature = signMessage(timestamp, body);

      expect(verify(body, signature, timestamp)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      const verify = (bot as unknown as {
        verifyDiscordSignature(body: string, signature: string, timestamp: string): boolean;
      }).verifyDiscordSignature.bind(bot);

      const timestamp = String(Math.floor(Date.now() / 1000));
      // Use a completely invalid hex string of the correct length (64 bytes = 128 hex chars)
      const invalidSig = 'a'.repeat(128);

      expect(verify('{"type":1}', invalidSig, timestamp)).toBe(false);
    });

    it('should reject with tampered body', () => {
      const verify = (bot as unknown as {
        verifyDiscordSignature(body: string, signature: string, timestamp: string): boolean;
      }).verifyDiscordSignature.bind(bot);

      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = '{"type":1}';
      const signature = signMessage(timestamp, body);

      // Use signature from original body but pass tampered body
      expect(verify('{"type":2}', signature, timestamp)).toBe(false);
    });

    it('should handle malformed input gracefully', () => {
      const verify = (bot as unknown as {
        verifyDiscordSignature(body: string, signature: string, timestamp: string): boolean;
      }).verifyDiscordSignature.bind(bot);

      expect(verify('body', 'not-hex', 'timestamp')).toBe(false);
      expect(verify('body', '', '')).toBe(false);
    });
  });

  // ── getStats ──

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stats = bot.getStats();

      expect(stats.type).toBe('discord');
      expect(stats.isRunning).toBe(false);
      expect(stats.eventsReceived).toBe(0);
      expect(stats.eventsProcessed).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.uptime).toBe(0);
      expect(stats.interactionsReceived).toBe(0);
      expect(stats.commandsProcessed).toBe(0);
      expect(stats.messagesSent).toBe(0);
    });
  });

  // ── start/stop lifecycle ──

  describe('lifecycle', () => {
    it('should start and become running', async () => {
      await bot.start();
      expect(bot.isRunning()).toBe(true);

      const stats = bot.getStats();
      expect(stats.isRunning).toBe(true);
      expect(stats.uptime).toBeGreaterThanOrEqual(0);

      await bot.stop();
    });

    it('should stop and no longer be running', async () => {
      await bot.start();
      await bot.stop();
      expect(bot.isRunning()).toBe(false);
    });

    it('should emit surface:started on start', async () => {
      const listener = vi.fn();
      bot.on('surface:started', listener);

      await bot.start();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          surfaceId: bot.id,
          type: 'discord',
        }),
      );

      await bot.stop();
    });

    it('should emit surface:stopped on stop', async () => {
      const listener = vi.fn();
      bot.on('surface:stopped', listener);

      await bot.start();
      await bot.stop();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          surfaceId: bot.id,
          type: 'discord',
        }),
      );
    });

    it('should be idempotent on start when already running', async () => {
      await bot.start();
      await bot.start(); // Should not throw
      expect(bot.isRunning()).toBe(true);
      await bot.stop();
    });

    it('should handle stop when not started', async () => {
      await bot.stop(); // Should not throw
      expect(bot.isRunning()).toBe(false);
    });
  });

  // ── handleInteraction — PING ──

  describe('handleInteraction — PING', () => {
    it('should respond with PONG for PING interaction', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = JSON.stringify({ type: 1, id: 'ping-id', token: 'ping-token' });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signMessage(timestamp, body);

      const response = await fetch(`http://127.0.0.1:${port}/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-ed25519': signature,
          'x-signature-timestamp': timestamp,
        },
        body,
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.type).toBe(1); // PONG

      await bot.stop();
    });
  });

  // ── handleInteraction — APPLICATION_COMMAND ──

  describe('handleInteraction — APPLICATION_COMMAND', () => {
    it('should process a slash command and emit event', async () => {
      await bot.start();

      const listener = vi.fn();
      bot.on('surface:discord:command', listener);

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = JSON.stringify({
        type: 2,
        id: 'cmd-id',
        token: 'cmd-token',
        data: {
          id: 'data-id',
          name: 'cortex',
          options: [{ name: 'prompt', type: 3, value: 'hello' }],
        },
        guild_id: 'guild-123',
        channel_id: 'channel-456',
        member: { user: { id: 'user-1', username: 'testuser' } },
      });

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signMessage(timestamp, body);

      const response = await fetch(`http://127.0.0.1:${port}/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-ed25519': signature,
          'x-signature-timestamp': timestamp,
        },
        body,
      });

      expect(response.status).toBe(200);

      // Wait for async event processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'cortex',
          user: 'testuser',
          guildId: 'guild-123',
        }),
      );

      await bot.stop();
    });

    it('should call registered command handler', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      bot.registerCommandHandler('cortex', handler);

      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = JSON.stringify({
        type: 2,
        id: 'cmd-id-2',
        token: 'cmd-token-2',
        data: { id: 'data-id', name: 'cortex' },
        member: { user: { id: 'u1', username: 'user1' } },
      });

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signMessage(timestamp, body);

      await fetch(`http://127.0.0.1:${port}/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-ed25519': signature,
          'x-signature-timestamp': timestamp,
        },
        body,
      });

      // Wait for async handler invocation
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 2,
          data: expect.objectContaining({ name: 'cortex' }),
        }),
      );

      await bot.stop();
    });
  });

  // ── handleInteraction — invalid signature ──

  describe('handleInteraction — invalid signature', () => {
    it('should reject interaction with invalid signature', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-ed25519': 'a'.repeat(128),
          'x-signature-timestamp': String(Math.floor(Date.now() / 1000)),
        },
        body: '{"type":1}',
      });

      expect(response.status).toBe(401);

      await bot.stop();
    });

    it('should reject interaction with missing signature', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"type":1}',
      });

      expect(response.status).toBe(401);

      await bot.stop();
    });
  });

  // ── registerCommand (Discord REST API registration) ──

  describe('registerCommand', () => {
    it('should register command handlers that are called on matching interactions', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      bot.registerCommandHandler('help', handler);

      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = JSON.stringify({
        type: 2,
        id: 'help-id',
        token: 'help-token',
        data: { id: 'help-data-id', name: 'help' },
        user: { id: 'u1', username: 'user1' },
      });

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signMessage(timestamp, body);

      await fetch(`http://127.0.0.1:${port}/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-ed25519': signature,
          'x-signature-timestamp': timestamp,
        },
        body,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalled();

      await bot.stop();
    });
  });

  // ── HTTP routing ──

  describe('HTTP routing', () => {
    it('should return 404 for unknown paths', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/unknown`);
      expect(response.status).toBe(404);

      await bot.stop();
    });

    it('should return 200 for health check', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.status).toBe('ok');
      expect(json.surface).toBe('discord');

      await bot.stop();
    });

    it('should accept interactions at /discord/interactions path too', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = JSON.stringify({ type: 1, id: 'alt-ping', token: 'tok' });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signMessage(timestamp, body);

      const response = await fetch(`http://127.0.0.1:${port}/discord/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-ed25519': signature,
          'x-signature-timestamp': timestamp,
        },
        body,
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.type).toBe(1); // PONG

      await bot.stop();
    });
  });

  // ── setTaskHandler ──

  describe('setTaskHandler', () => {
    it('should forward unhandled commands to task handler', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      bot.setTaskHandler(handler);

      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = JSON.stringify({
        type: 2,
        id: 'task-id',
        token: 'task-token',
        data: { id: 'd', name: 'unregistered_command' },
        user: { id: 'u1', username: 'user1' },
      });

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signMessage(timestamp, body);

      await fetch(`http://127.0.0.1:${port}/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-ed25519': signature,
          'x-signature-timestamp': timestamp,
        },
        body,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith('discord:command', expect.objectContaining({
        command: 'unregistered_command',
      }));

      await bot.stop();
    });
  });

  // ── Stats tracking ──

  describe('stats tracking', () => {
    it('should increment eventsReceived and interactionsReceived on interactions', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = JSON.stringify({ type: 1, id: 'stat-ping', token: 'tok' });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signMessage(timestamp, body);

      await fetch(`http://127.0.0.1:${port}/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-ed25519': signature,
          'x-signature-timestamp': timestamp,
        },
        body,
      });

      const stats = bot.getStats();
      expect(stats.eventsReceived).toBe(1);
      expect(stats.interactionsReceived).toBe(1);
      expect(stats.eventsProcessed).toBe(1);

      await bot.stop();
    });

    it('should increment commandsProcessed for application commands', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = JSON.stringify({
        type: 2,
        id: 'cmd-stat-id',
        token: 'cmd-stat-token',
        data: { id: 'ds', name: 'stat_cmd' },
        user: { id: 'u1', username: 'user1' },
      });

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signMessage(timestamp, body);

      await fetch(`http://127.0.0.1:${port}/interactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature-ed25519': signature,
          'x-signature-timestamp': timestamp,
        },
        body,
      });

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = bot.getStats();
      expect(stats.commandsProcessed).toBe(1);

      await bot.stop();
    });
  });
});
