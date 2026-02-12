/**
 * Dashboard Server — HTTP + WebSocket server for real-time observability.
 *
 * Uses Node built-in `http` module (zero framework) and `ws` for WebSocket.
 * Serves a single HTML dashboard page with real-time event streaming.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { EventBus } from '../core/events.js';
import type { Tracer } from '../observability/tracer.js';
import type { MetricsCollector } from '../observability/metrics.js';
import type { CostTracker } from '../cost/tracker.js';
import { createAPIHandler, type APIDependencies } from './api.js';
import { createWebSocketHandler, type WebSocketHandler } from './websocket.js';

export interface DashboardOptions {
  port: number;
  eventBus: EventBus;
  tracer: Tracer;
  metrics: MetricsCollector;
  costTracker?: CostTracker;
}

export class DashboardServer {
  private server: Server | null = null;
  private wsHandler: WebSocketHandler | null = null;
  private options: DashboardOptions;
  private staticHTML: string;
  private startTime: number;

  constructor(options: DashboardOptions) {
    this.options = options;
    this.startTime = Date.now();

    // Load the static dashboard HTML at construction time
    try {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      this.staticHTML = readFileSync(join(__dirname, 'static', 'index.html'), 'utf-8');
    } catch {
      // Fallback: minimal HTML if static file isn't found (e.g., during tests)
      this.staticHTML = this.getFallbackHTML();
    }
  }

  /**
   * Start the dashboard server and return the URL.
   */
  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      const apiDeps: APIDependencies = {
        tracer: this.options.tracer,
        metrics: this.options.metrics,
        costTracker: this.options.costTracker,
        startTime: this.startTime,
      };

      const apiHandler = createAPIHandler(apiDeps);

      this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = req.url || '/';

        // API routes
        if (url.startsWith('/api/')) {
          apiHandler(req, res);
          return;
        }

        // Static dashboard
        if (url === '/' || url === '/index.html') {
          // Inject the WebSocket port into the HTML
          const html = this.staticHTML.replace('__WS_PORT__', String(this.options.port));
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
          });
          res.end(html);
          return;
        }

        // Health check
        if (url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', uptime: Date.now() - this.startTime }));
          return;
        }

        // 404 for everything else
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      });

      // Setup WebSocket handler
      this.wsHandler = createWebSocketHandler(this.server, this.options.eventBus);

      // Listen on 127.0.0.1 explicitly (avoids IPv6/IPv4 mismatch)
      this.server.listen(this.options.port, '127.0.0.1', () => {
        const addr = this.server!.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.options.port;
        const url = `http://127.0.0.1:${actualPort}`;
        resolve(url);
      });

      this.server.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  /**
   * Stop the dashboard server gracefully.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wsHandler) {
        this.wsHandler.close();
        this.wsHandler = null;
      }

      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the number of connected WebSocket clients.
   */
  get clientCount(): number {
    return this.wsHandler?.clientCount() ?? 0;
  }

  /**
   * Minimal fallback HTML when static file is unavailable.
   */
  private getFallbackHTML(): string {
    return `<!DOCTYPE html>
<html><head><title>CortexOS Dashboard</title></head>
<body style="font-family:system-ui;background:#0d1117;color:#c9d1d9;padding:2rem">
<h1>CortexOS Dashboard</h1>
<p>Dashboard static files not found. Run from the project root.</p>
<script>
const ws = new WebSocket('ws://localhost:__WS_PORT__');
ws.onmessage = (e) => {
  const div = document.createElement('div');
  div.textContent = e.data;
  document.body.appendChild(div);
};
</script>
</body></html>`;
  }
}
