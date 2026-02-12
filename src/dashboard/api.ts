/**
 * Dashboard REST API — Route handlers for the observability dashboard.
 *
 * Serves JSON data from existing Tracer, MetricsCollector, and CostTracker
 * subsystems via simple HTTP endpoints.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { Tracer } from '../observability/tracer.js';
import type { MetricsCollector } from '../observability/metrics.js';
import type { CostTracker } from '../cost/tracker.js';

export interface APIDependencies {
  tracer: Tracer;
  metrics: MetricsCollector;
  costTracker?: CostTracker;
  startTime: number;
}

function sendJSON(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(data));
}

function send404(res: ServerResponse): void {
  sendJSON(res, { error: 'Not found' }, 404);
}

function send405(res: ServerResponse): void {
  sendJSON(res, { error: 'Method not allowed' }, 405);
}

export function createAPIHandler(deps: APIDependencies): (req: IncomingMessage, res: ServerResponse) => void {
  return (req: IncomingMessage, res: ServerResponse) => {
    // Only accept GET and OPTIONS
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      send405(res);
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    switch (path) {
      case '/api/traces': {
        const traces = deps.tracer.getAllTraces();
        sendJSON(res, traces);
        break;
      }

      case '/api/traces/active': {
        const active = deps.tracer.exportTrace();
        sendJSON(res, active || null);
        break;
      }

      case '/api/traces/timeline': {
        const traceId = url.searchParams.get('traceId') || undefined;
        const timeline = deps.tracer.getTimeline(traceId);
        sendJSON(res, timeline);
        break;
      }

      case '/api/metrics': {
        const since = url.searchParams.get('since');
        const aggregates = deps.metrics.aggregate(since ? parseInt(since, 10) : undefined);
        sendJSON(res, aggregates);
        break;
      }

      case '/api/metrics/timeseries': {
        const field = (url.searchParams.get('field') || 'duration') as 'duration' | 'cost' | 'tokens' | 'quality';
        const bucket = parseInt(url.searchParams.get('bucket') || '3600000', 10);
        const series = deps.metrics.timeSeries(field, bucket);
        sendJSON(res, series);
        break;
      }

      case '/api/runs': {
        const limit = parseInt(url.searchParams.get('limit') || '10', 10);
        const runs = deps.metrics.getRecentRuns(limit);
        sendJSON(res, runs);
        break;
      }

      case '/api/status': {
        const uptime = Date.now() - deps.startTime;
        const activeTrace = deps.tracer.exportTrace();
        const aggregates = deps.metrics.aggregate();
        sendJSON(res, {
          uptime,
          uptimeFormatted: formatUptime(uptime),
          activeTrace: activeTrace ? { traceId: activeTrace.traceId, spanCount: activeTrace.spanCount } : null,
          totalRuns: aggregates.totalRuns,
          successRate: aggregates.successRate,
          totalCost: aggregates.totalCost,
        });
        break;
      }

      case '/api/cost': {
        if (deps.costTracker) {
          sendJSON(res, {
            totalCost: deps.costTracker.totalCost,
            totalInputTokens: deps.costTracker.totalInputTokens,
            totalOutputTokens: deps.costTracker.totalOutputTokens,
          });
        } else {
          sendJSON(res, { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0 });
        }
        break;
      }

      default:
        send404(res);
    }
  };
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
