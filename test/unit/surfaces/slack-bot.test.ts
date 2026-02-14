import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { SlackBot } from '../../../src/surfaces/slack/slack-bot.js';
import type { SlackBotConfig } from '../../../src/surfaces/types.js';

const TEST_CONFIG: SlackBotConfig = {
  botToken: 'xoxb-test-bot-token',
  signingSecret: 'test-signing-secret-12345',
  appToken: 'xapp-test-app-token',
  port: 0, // OS-assigned port
  hostname: '127.0.0.1',
};

/** Compute a valid Slack signature for a request body */
function computeSlackSignature(secret: string, timestamp: string, body: string): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  return 'v0=' + createHmac('sha256', secret).update(sigBasestring).digest('hex');
}

describe('SlackBot', () => {
  let bot: SlackBot;

  beforeEach(() => {
    bot = new SlackBot(TEST_CONFIG);
  });

  // ── Constructor ──

  describe('constructor', () => {
    it('should create an instance with config stored', () => {
      expect(bot).toBeDefined();
      expect(bot.id).toMatch(/^slack_/);
      expect(bot.type).toBe('slack');
      expect(bot.isRunning()).toBe(false);
    });

    it('should use default port and hostname when not specified', () => {
      const minimal = new SlackBot({
        botToken: 'xoxb-token',
        signingSecret: 'secret',
      });
      expect(minimal).toBeDefined();
      expect(minimal.type).toBe('slack');
    });
  });

  // ── verifySignature ──

  describe('verifySlackSignature (via private access)', () => {
    it('should accept a valid Slack signature', () => {
      const verify = (bot as unknown as {
        verifySlackSignature(req: { headers: Record<string, string | undefined> }, body: string): boolean;
      }).verifySlackSignature.bind(bot);

      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = '{"type":"event_callback"}';
      const signature = computeSlackSignature(TEST_CONFIG.signingSecret, timestamp, body);

      const req = {
        headers: {
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature,
        },
      };

      expect(verify(req, body)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      const verify = (bot as unknown as {
        verifySlackSignature(req: { headers: Record<string, string | undefined> }, body: string): boolean;
      }).verifySlackSignature.bind(bot);

      const timestamp = String(Math.floor(Date.now() / 1000));
      const req = {
        headers: {
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': 'v0=invalidsignaturehex',
        },
      };

      expect(verify(req, 'body')).toBe(false);
    });

    it('should reject when timestamp is missing', () => {
      const verify = (bot as unknown as {
        verifySlackSignature(req: { headers: Record<string, string | undefined> }, body: string): boolean;
      }).verifySlackSignature.bind(bot);

      const req = {
        headers: {
          'x-slack-signature': 'v0=something',
        },
      };

      expect(verify(req, 'body')).toBe(false);
    });

    it('should reject when signature is missing', () => {
      const verify = (bot as unknown as {
        verifySlackSignature(req: { headers: Record<string, string | undefined> }, body: string): boolean;
      }).verifySlackSignature.bind(bot);

      const timestamp = String(Math.floor(Date.now() / 1000));
      const req = {
        headers: {
          'x-slack-request-timestamp': timestamp,
        },
      };

      expect(verify(req, 'body')).toBe(false);
    });

    it('should reject stale timestamps (replay attack prevention)', () => {
      const verify = (bot as unknown as {
        verifySlackSignature(req: { headers: Record<string, string | undefined> }, body: string): boolean;
      }).verifySlackSignature.bind(bot);

      // Timestamp from 10 minutes ago (beyond the 5 minute window)
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
      const body = 'test body';
      const signature = computeSlackSignature(TEST_CONFIG.signingSecret, staleTimestamp, body);

      const req = {
        headers: {
          'x-slack-request-timestamp': staleTimestamp,
          'x-slack-signature': signature,
        },
      };

      expect(verify(req, body)).toBe(false);
    });
  });

  // ── getStats ──

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stats = bot.getStats();

      expect(stats.type).toBe('slack');
      expect(stats.isRunning).toBe(false);
      expect(stats.eventsReceived).toBe(0);
      expect(stats.eventsProcessed).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.uptime).toBe(0);
      expect(stats.messagesReceived).toBe(0);
      expect(stats.commandsProcessed).toBe(0);
      expect(stats.interactionsHandled).toBe(0);
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
          type: 'slack',
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
          type: 'slack',
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

  // ── handleEvent — Events API ──

  describe('handleEvent via HTTP', () => {
    it('should handle url_verification challenge', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = JSON.stringify({ type: 'url_verification', challenge: 'test-challenge-123' });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = computeSlackSignature(TEST_CONFIG.signingSecret, timestamp, body);

      const response = await fetch(`http://127.0.0.1:${port}/slack/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature,
        },
        body,
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.challenge).toBe('test-challenge-123');

      await bot.stop();
    });

    it('should reject events with invalid signature', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/slack/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-slack-signature': 'v0=invalid',
        },
        body: '{"type":"event_callback"}',
      });

      expect(response.status).toBe(401);

      await bot.stop();
    });

    it('should handle event_callback and emit event', async () => {
      await bot.start();

      const listener = vi.fn();
      bot.on('surface:slack:message', listener);

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = JSON.stringify({
        type: 'event_callback',
        event: {
          type: 'app_mention',
          user: 'U123',
          channel: 'C456',
          text: '<@BOT> help',
          ts: '1234567890.123456',
        },
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = computeSlackSignature(TEST_CONFIG.signingSecret, timestamp, body);

      const response = await fetch(`http://127.0.0.1:${port}/slack/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature,
        },
        body,
      });

      expect(response.status).toBe(200);

      // Wait for async event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mention',
          user: 'U123',
          channel: 'C456',
        }),
      );

      await bot.stop();
    });

    it('should return 404 for unknown paths', async () => {
      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/unknown`, {
        method: 'POST',
        body: '{}',
      });
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
      expect(json.surface).toBe('slack');

      await bot.stop();
    });
  });

  // ── registerCommand ──

  describe('registerCommand', () => {
    it('should register a slash command handler', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      bot.registerCommand('/cortex', handler);

      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = 'command=%2Fcortex&text=hello&user_id=U123&user_name=testuser&channel_id=C456&channel_name=general&team_id=T789&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands&trigger_id=trig123';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = computeSlackSignature(TEST_CONFIG.signingSecret, timestamp, body);

      const response = await fetch(`http://127.0.0.1:${port}/slack/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature,
        },
        body,
      });

      expect(response.status).toBe(200);

      // Wait for async handler invocation
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          command: '/cortex',
          text: 'hello',
          user_name: 'testuser',
        }),
      );

      await bot.stop();
    });

    it('should emit surface:slack:command event', async () => {
      const listener = vi.fn();
      bot.on('surface:slack:command', listener);

      await bot.start();

      const address = (bot as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const body = 'command=%2Ftest&text=args&user_id=U1&user_name=user&channel_id=C1&channel_name=ch&team_id=T1&response_url=https%3A%2F%2Fhooks.slack.com&trigger_id=t1';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = computeSlackSignature(TEST_CONFIG.signingSecret, timestamp, body);

      await fetch(`http://127.0.0.1:${port}/slack/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature,
        },
        body,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          command: '/test',
        }),
      );

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

      const body = 'command=%2Funknown&text=test&user_id=U1&user_name=user&channel_id=C1&channel_name=ch&team_id=T1&response_url=https%3A%2F%2Fhooks.slack.com&trigger_id=t1';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = computeSlackSignature(TEST_CONFIG.signingSecret, timestamp, body);

      await fetch(`http://127.0.0.1:${port}/slack/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature,
        },
        body,
      });

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith('slack:command', expect.anything());

      await bot.stop();
    });
  });
});
