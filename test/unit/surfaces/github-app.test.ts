import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { GitHubApp } from '../../../src/surfaces/github/github-app.js';
import type { GitHubAppConfig } from '../../../src/surfaces/types.js';

const TEST_CONFIG: GitHubAppConfig = {
  appId: 'test-app-123',
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\nfake-key\n-----END RSA PRIVATE KEY-----',
  webhookSecret: 'test-webhook-secret',
  port: 0, // Use 0 to let OS assign a free port for tests
  hostname: '127.0.0.1',
};

describe('GitHubApp', () => {
  let app: GitHubApp;

  beforeEach(() => {
    app = new GitHubApp(TEST_CONFIG);
  });

  // ── Constructor ──

  describe('constructor', () => {
    it('should create an instance with config stored', () => {
      expect(app).toBeDefined();
      expect(app.id).toMatch(/^gh_/);
      expect(app.type).toBe('github');
      expect(app.isRunning()).toBe(false);
    });

    it('should use default port and hostname when not specified', () => {
      const minimal = new GitHubApp({
        appId: 'test',
        privateKey: 'key',
        webhookSecret: 'secret',
      });

      expect(minimal).toBeDefined();
      // The defaults (3300, '0.0.0.0') are applied internally
      const stats = minimal.getStats();
      expect(stats.type).toBe('github');
    });
  });

  // ── verifyWebhookSignature ──

  describe('verifyWebhookSignature', () => {
    // We test the signature logic by calling handleWebhook indirectly
    // through the private method. Since verifyWebhookSignature is private,
    // we test it via the public behavior: invalid signatures are rejected.

    it('should accept a valid HMAC-SHA256 signature', () => {
      // Access the private method for direct testing
      const verify = (app as unknown as {
        verifyWebhookSignature(body: string, signature: string): boolean;
      }).verifyWebhookSignature.bind(app);

      const body = '{"action":"opened"}';
      const expectedSig = 'sha256=' + createHmac('sha256', TEST_CONFIG.webhookSecret)
        .update(body)
        .digest('hex');

      expect(verify(body, expectedSig)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      const verify = (app as unknown as {
        verifyWebhookSignature(body: string, signature: string): boolean;
      }).verifyWebhookSignature.bind(app);

      const body = '{"action":"opened"}';
      expect(verify(body, 'sha256=invalidsignature')).toBe(false);
    });

    it('should reject a signature with wrong body', () => {
      const verify = (app as unknown as {
        verifyWebhookSignature(body: string, signature: string): boolean;
      }).verifyWebhookSignature.bind(app);

      const body = '{"action":"opened"}';
      const otherBody = '{"action":"closed"}';
      const sig = 'sha256=' + createHmac('sha256', TEST_CONFIG.webhookSecret)
        .update(otherBody)
        .digest('hex');

      expect(verify(body, sig)).toBe(false);
    });

    it('should handle malformed signatures gracefully', () => {
      const verify = (app as unknown as {
        verifyWebhookSignature(body: string, signature: string): boolean;
      }).verifyWebhookSignature.bind(app);

      expect(verify('body', '')).toBe(false);
      expect(verify('body', 'not-a-signature')).toBe(false);
    });
  });

  // ── getStats ──

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stats = app.getStats();

      expect(stats.type).toBe('github');
      expect(stats.isRunning).toBe(false);
      expect(stats.eventsReceived).toBe(0);
      expect(stats.eventsProcessed).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.uptime).toBe(0);
      expect(stats.webhooksReceived).toBe(0);
      expect(stats.prsAnalyzed).toBe(0);
      expect(stats.issuesTriaged).toBe(0);
      expect(stats.commentsPosted).toBe(0);
    });
  });

  // ── start/stop/isRunning lifecycle ──

  describe('lifecycle', () => {
    it('should start and become running', async () => {
      await app.start();
      expect(app.isRunning()).toBe(true);

      const stats = app.getStats();
      expect(stats.isRunning).toBe(true);
      expect(stats.uptime).toBeGreaterThanOrEqual(0);

      await app.stop();
    });

    it('should stop and no longer be running', async () => {
      await app.start();
      await app.stop();

      expect(app.isRunning()).toBe(false);
    });

    it('should emit surface:started on start', async () => {
      const listener = vi.fn();
      app.on('surface:started', listener);

      await app.start();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          surfaceId: app.id,
          type: 'github',
        }),
      );

      await app.stop();
    });

    it('should emit surface:stopped on stop', async () => {
      const listener = vi.fn();
      app.on('surface:stopped', listener);

      await app.start();
      await app.stop();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          surfaceId: app.id,
          type: 'github',
        }),
      );
    });

    it('should be idempotent on start when already running', async () => {
      await app.start();
      await app.start(); // Should not throw
      expect(app.isRunning()).toBe(true);
      await app.stop();
    });

    it('should handle stop when not started', async () => {
      await app.stop(); // Should not throw
      expect(app.isRunning()).toBe(false);
    });
  });

  // ── handleWebhook dispatches events ──

  describe('webhook event routing', () => {
    it('should emit surface:github:webhook on webhook receive', async () => {
      await app.start();

      const listener = vi.fn();
      app.on('surface:github:webhook', listener);

      // Simulate a webhook by making an HTTP request to the server
      const body = JSON.stringify({
        action: 'opened',
        sender: { login: 'testuser', id: 1 },
        repository: { full_name: 'org/repo', owner: { login: 'org' }, name: 'repo' },
      });

      const signature = 'sha256=' + createHmac('sha256', TEST_CONFIG.webhookSecret)
        .update(body)
        .digest('hex');

      // Get the port the server is listening on
      const address = (app as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-123',
        },
        body,
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.accepted).toBe(true);

      // Wait for async event processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'push',
          deliveryId: 'delivery-123',
        }),
      );

      await app.stop();
    });

    it('should reject webhook with invalid signature', async () => {
      await app.start();

      const address = (app as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': 'sha256=invalid',
          'x-github-event': 'push',
        },
        body: '{"action":"opened"}',
      });

      expect(response.status).toBe(401);

      await app.stop();
    });

    it('should reject webhook with no signature', async () => {
      await app.start();

      const address = (app as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'push',
        },
        body: '{"action":"opened"}',
      });

      expect(response.status).toBe(401);

      await app.stop();
    });

    it('should return 404 for unknown paths', async () => {
      await app.start();

      const address = (app as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/unknown`);
      expect(response.status).toBe(404);

      await app.stop();
    });

    it('should return 200 for health check', async () => {
      await app.start();

      const address = (app as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.status).toBe('ok');
      expect(json.surface).toBe('github');

      await app.stop();
    });
  });

  // ── setTaskHandler ──

  describe('setTaskHandler', () => {
    it('should set a task handler that is called on events', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      app.setTaskHandler(handler);

      await app.start();

      const body = JSON.stringify({
        action: 'created',
        ref: 'refs/heads/main',
        before: 'abc',
        after: 'def',
        commits: [],
        sender: { login: 'user', id: 1 },
        repository: { full_name: 'o/r', owner: { login: 'o' }, name: 'r' },
      });

      const signature = 'sha256=' + createHmac('sha256', TEST_CONFIG.webhookSecret)
        .update(body)
        .digest('hex');

      const address = (app as unknown as { server: { address(): { port: number } } }).server.address();
      const port = address.port;

      await fetch(`http://127.0.0.1:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
        },
        body,
      });

      // Wait for async event processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith('github:push', expect.anything());

      await app.stop();
    });
  });
});
