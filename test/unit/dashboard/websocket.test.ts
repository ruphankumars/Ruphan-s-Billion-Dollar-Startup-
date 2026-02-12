import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'http';
import { EventBus } from '../../../src/core/events.js';
import { createWebSocketHandler, type WebSocketHandler } from '../../../src/dashboard/websocket.js';

describe('Dashboard WebSocket', () => {
  let httpServer: ReturnType<typeof createServer> | null = null;
  let wsHandler: WebSocketHandler | null = null;
  let port = 0;

  async function setup(): Promise<string> {
    const eventBus = new EventBus();
    httpServer = createServer();
    wsHandler = createWebSocketHandler(httpServer, eventBus);

    return new Promise((resolve) => {
      httpServer!.listen(0, '127.0.0.1', () => {
        const addr = httpServer!.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`ws://127.0.0.1:${port}`);
      });
    });
  }

  afterEach(async () => {
    if (wsHandler) {
      wsHandler.close();
      wsHandler = null;
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      httpServer = null;
    }
  });

  it('should create WebSocketServer attached to HTTP server', async () => {
    await setup();
    expect(wsHandler).toBeDefined();
    expect(wsHandler!.wss).toBeDefined();
  });

  it('should report zero clients initially', async () => {
    await setup();
    expect(wsHandler!.clientCount()).toBe(0);
  });

  it('should accept connections and send welcome message', async () => {
    const wsUrl = await setup();

    const ws = new WebSocket(wsUrl);
    const message = await new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(e.data as string);
    });

    const parsed = JSON.parse(message);
    expect(parsed.event).toBe('connected');
    expect(parsed.data.message).toContain('CortexOS Dashboard');
    expect(parsed.timestamp).toBeGreaterThan(0);

    ws.close();
  });

  it('should broadcast EventBus events to clients', async () => {
    const eventBus = new EventBus();
    httpServer = createServer();
    wsHandler = createWebSocketHandler(httpServer, eventBus);

    const wsUrl = await new Promise<string>((resolve) => {
      httpServer!.listen(0, '127.0.0.1', () => {
        const addr = httpServer!.address();
        const p = typeof addr === 'object' && addr ? addr.port : 0;
        resolve(`ws://127.0.0.1:${p}`);
      });
    });

    const ws = new WebSocket(wsUrl);

    // Wait for welcome message first
    await new Promise<void>((resolve) => {
      ws.onmessage = () => resolve();
    });

    // Now listen for the broadcast event
    const eventPromise = new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(e.data as string);
    });

    // Emit an event on the EventBus
    eventBus.emit('stage:start', { stage: 'analyze' });

    const message = await eventPromise;
    const parsed = JSON.parse(message);
    expect(parsed.event).toBe('stage:start');
    expect(parsed.timestamp).toBeGreaterThan(0);

    ws.close();
  });

  it('should include timestamp in all messages', async () => {
    const wsUrl = await setup();
    const ws = new WebSocket(wsUrl);

    const message = await new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(e.data as string);
    });

    const parsed = JSON.parse(message);
    expect(typeof parsed.timestamp).toBe('number');
    expect(parsed.timestamp).toBeGreaterThan(Date.now() - 10000);

    ws.close();
  });

  it('should handle client disconnect gracefully', async () => {
    const wsUrl = await setup();
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    ws.close();

    // Wait a bit for disconnect to propagate
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not throw when broadcasting to empty clients
    expect(wsHandler!.clientCount()).toBe(0);
  });

  it('should send valid JSON messages', async () => {
    const wsUrl = await setup();
    const ws = new WebSocket(wsUrl);

    const message = await new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(e.data as string);
    });

    // Should not throw
    const parsed = JSON.parse(message);
    expect(parsed).toHaveProperty('event');
    expect(parsed).toHaveProperty('data');
    expect(parsed).toHaveProperty('timestamp');

    ws.close();
  });

  it('should close cleanly', async () => {
    await setup();
    wsHandler!.close();
    wsHandler = null;
    // No error means success
  });
});
