import { describe, it, expect, afterEach } from 'vitest';
import { DashboardServer } from '../../../src/dashboard/server.js';
import { EventBus } from '../../../src/core/events.js';
import { Tracer } from '../../../src/observability/tracer.js';
import { MetricsCollector } from '../../../src/observability/metrics.js';

function createDeps(port = 0) {
  return {
    port,
    eventBus: new EventBus(),
    tracer: new Tracer(),
    metrics: new MetricsCollector(),
  };
}

describe('DashboardServer', () => {
  let server: DashboardServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('should create server instance', () => {
    server = new DashboardServer(createDeps());
    expect(server).toBeDefined();
  });

  it('should accept DashboardOptions', () => {
    const deps = createDeps(3200);
    server = new DashboardServer(deps);
    expect(server).toBeDefined();
  });

  it('should start and return a URL', async () => {
    server = new DashboardServer(createDeps(0)); // port 0 = random
    const url = await server.start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('should serve index HTML on GET /', async () => {
    server = new DashboardServer(createDeps(0));
    const url = await server.start();

    const response = await fetch(url + '/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('CortexOS Dashboard');
  });

  it('should serve API routes', async () => {
    server = new DashboardServer(createDeps(0));
    const url = await server.start();

    const response = await fetch(url + '/api/status');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toHaveProperty('uptime');
  });

  it('should return 404 for unknown routes', async () => {
    server = new DashboardServer(createDeps(0));
    const url = await server.start();

    const response = await fetch(url + '/nonexistent');
    expect(response.status).toBe(404);
  });

  it('should serve health check', async () => {
    server = new DashboardServer(createDeps(0));
    const url = await server.start();

    const response = await fetch(url + '/health');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe('ok');
    expect(json.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should stop gracefully', async () => {
    server = new DashboardServer(createDeps(0));
    await server.start();
    await server.stop();
    server = null;
    // No error means success
  });

  it('should stop when not started', async () => {
    server = new DashboardServer(createDeps(0));
    await server.stop(); // Should not throw
    server = null;
  });

  it('should report client count', async () => {
    server = new DashboardServer(createDeps(0));
    await server.start();
    expect(server.clientCount).toBe(0);
  });

  it('should work without optional costTracker', () => {
    const deps = createDeps(0);
    server = new DashboardServer(deps);
    expect(server).toBeDefined();
  });

  it('should set CORS headers on API routes', async () => {
    server = new DashboardServer(createDeps(0));
    const url = await server.start();

    const response = await fetch(url + '/api/status');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
