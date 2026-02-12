/**
 * Dashboard WebSocket Handler — Bridges EventBus events to browser clients.
 *
 * Subscribes to all CortexOS event types and broadcasts them as JSON
 * messages to connected WebSocket clients for real-time dashboard updates.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { EventBus } from '../core/events.js';
import type { CortexEvents } from '../core/types.js';

/** All known CortexOS event types to bridge */
const BRIDGE_EVENTS: (keyof CortexEvents)[] = [
  'engine:start',
  'engine:complete',
  'engine:error',
  'stage:start',
  'stage:complete',
  'plan:created',
  'wave:start',
  'wave:complete',
  'agent:start',
  'agent:progress',
  'agent:tool',
  'agent:complete',
  'agent:error',
  'memory:recall',
  'memory:store',
  'quality:gate',
  'cost:update',
  'error',
];

export interface WebSocketHandler {
  wss: WebSocketServer;
  clientCount: () => number;
  close: () => void;
}

export function createWebSocketHandler(
  server: Server,
  eventBus: EventBus,
): WebSocketHandler {
  const wss = new WebSocketServer({ server });

  // Subscribe to ALL EventBus events and broadcast to connected clients
  for (const event of BRIDGE_EVENTS) {
    eventBus.on(event, (data: unknown) => {
      const message = JSON.stringify({
        event,
        data: sanitizeData(data),
        timestamp: Date.now(),
      });

      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch {
            // Ignore send errors for disconnecting clients
          }
        }
      }
    });
  }

  // Handle new connections with a welcome message
  wss.on('connection', (ws: WebSocket) => {
    const welcome = JSON.stringify({
      event: 'connected',
      data: { message: 'CortexOS Dashboard WebSocket connected', clientCount: wss.clients.size },
      timestamp: Date.now(),
    });
    ws.send(welcome);
  });

  return {
    wss,
    clientCount: () => wss.clients.size,
    close: () => {
      for (const client of wss.clients) {
        client.close();
      }
      wss.close();
    },
  };
}

/**
 * Sanitize event data for JSON serialization.
 * Handles circular references and non-serializable values.
 */
function sanitizeData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  try {
    // Quick check for serializability
    JSON.stringify(data);
    return data;
  } catch {
    // Fallback: extract safe properties
    if (typeof data === 'object' && data !== null) {
      const safe: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (typeof value !== 'function' && typeof value !== 'symbol') {
          try {
            JSON.stringify(value);
            safe[key] = value;
          } catch {
            safe[key] = String(value);
          }
        }
      }
      return safe;
    }
    return String(data);
  }
}
