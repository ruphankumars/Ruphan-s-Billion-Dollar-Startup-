import { describe, it, expect, afterEach } from 'vitest';
import { DashboardServer } from '../../../src/dashboard/server.js';
import { EventBus } from '../../../src/core/events.js';
import { Tracer } from '../../../src/observability/tracer.js';
import { MetricsCollector } from '../../../src/observability/metrics.js';

function createServer() {
  return new DashboardServer({
    port: 0,
    eventBus: new EventBus(),
    tracer: new Tracer(),
    metrics: new MetricsCollector(),
  });
}

describe('Dashboard API', () => {
  let server: DashboardServer | null = null;
  let baseUrl = '';

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  async function setup() {
    server = createServer();
    baseUrl = await server.start();
  }

  it('GET /api/traces should return array', async () => {
    await setup();
    const res = await fetch(baseUrl + '/api/traces');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/traces should return empty array when no traces', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/traces')).json();
    expect(data).toEqual([]);
  });

  it('GET /api/traces/active should return null when no active trace', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/traces/active')).json();
    expect(data).toBeNull();
  });

  it('GET /api/traces/timeline should return array', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/traces/timeline')).json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/metrics should return aggregate metrics', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/metrics')).json();
    expect(data).toHaveProperty('totalRuns');
    expect(data).toHaveProperty('successRate');
    expect(data).toHaveProperty('avgDuration');
    expect(data).toHaveProperty('totalCost');
  });

  it('GET /api/metrics/timeseries should return array', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/metrics/timeseries')).json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/metrics/timeseries should accept field param', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/metrics/timeseries?field=cost')).json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/runs should return array', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/runs')).json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/runs should accept limit param', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/runs?limit=5')).json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/status should include uptime', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/status')).json();
    expect(data).toHaveProperty('uptime');
    expect(data.uptime).toBeGreaterThanOrEqual(0);
    expect(data).toHaveProperty('uptimeFormatted');
    expect(data).toHaveProperty('totalRuns');
  });

  it('GET /api/cost should return cost summary', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/cost')).json();
    expect(data).toHaveProperty('totalCost');
    expect(data).toHaveProperty('totalInputTokens');
    expect(data).toHaveProperty('totalOutputTokens');
  });

  it('GET /api/cost should handle missing costTracker', async () => {
    await setup();
    const data = await (await fetch(baseUrl + '/api/cost')).json();
    expect(data.totalCost).toBe(0);
  });

  it('should return 404 for unknown API routes', async () => {
    await setup();
    const res = await fetch(baseUrl + '/api/nonexistent');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  it('should return valid JSON for all endpoints', async () => {
    await setup();
    const endpoints = ['/api/traces', '/api/metrics', '/api/runs', '/api/status', '/api/cost'];
    for (const endpoint of endpoints) {
      const res = await fetch(baseUrl + endpoint);
      const contentType = res.headers.get('content-type');
      expect(contentType).toContain('application/json');
    }
  });
});
