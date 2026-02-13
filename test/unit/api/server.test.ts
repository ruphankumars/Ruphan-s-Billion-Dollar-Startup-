import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { APIServer } from '../../../src/api/server.js';

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: parsed,
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/** Find a free port by briefly opening and closing a server */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

describe('APIServer', () => {
  let server: APIServer;
  let port: number;

  beforeAll(async () => {
    // Find a free port first, then use it explicitly
    port = await findFreePort();
    server = new APIServer({ port });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('health endpoint returns ok', async () => {
    const res = await request(port, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /api/run creates a task', async () => {
    // The API expects { prompt: string, ... } not { skillId, params }
    const res = await request(port, 'POST', '/api/run', {
      prompt: 'Test task prompt',
      async: true,
    });
    // Async returns 202
    expect(res.status).toBe(202);
    expect(res.body.taskId).toBeDefined();
    expect(res.body.status).toBeDefined();
  });

  it('GET /api/run/:id returns task', async () => {
    // First create a task
    const createRes = await request(port, 'POST', '/api/run', {
      prompt: 'Lookup task prompt',
      async: true,
    });
    const taskId = createRes.body.taskId;

    // Then retrieve it
    const res = await request(port, 'GET', `/api/run/${taskId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(taskId);
    expect(res.body.prompt).toBe('Lookup task prompt');
  });

  it('GET /api/run/:id returns 404 for unknown', async () => {
    const res = await request(port, 'GET', '/api/run/nonexistent-id-12345');
    expect(res.status).toBe(404);
  });

  it('GET /api/tasks returns all tasks', async () => {
    const res = await request(port, 'GET', '/api/tasks');
    expect(res.status).toBe(200);
    // API returns { tasks: [...], total: number }
    expect(res.body.tasks).toBeDefined();
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  it('GET /api/health returns version and uptime', async () => {
    const res = await request(port, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.version).toBeDefined();
    expect(res.body.uptime).toBeDefined();
    expect(typeof res.body.uptime).toBe('number');
  });

  it('POST /api/run/:id/cancel cancels task', async () => {
    // First create a task (no executor set, so it stays in queued)
    const createRes = await request(port, 'POST', '/api/run', {
      prompt: 'Cancel task prompt',
      async: true,
    });
    const taskId = createRes.body.taskId;

    // Then cancel it
    const res = await request(port, 'POST', `/api/run/${taskId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('handles CORS headers', async () => {
    const res = await request(port, 'GET', '/api/health');
    const corsHeader =
      res.headers['access-control-allow-origin'] ?? '';
    expect(corsHeader).toBeDefined();
    expect(corsHeader.length).toBeGreaterThan(0);
  });
});
