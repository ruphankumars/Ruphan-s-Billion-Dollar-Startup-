/**
 * API Authentication Middleware
 *
 * Simple API key-based authentication using Node.js crypto.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Generate a cryptographically secure API key
 */
export function generateApiKey(prefix = 'ctx'): string {
  const bytes = randomBytes(24);
  return `${prefix}_${bytes.toString('base64url')}`;
}

/**
 * Constant-time comparison of API keys to prevent timing attacks
 */
export function verifyApiKey(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
) => void;

/**
 * Create an API key authentication middleware
 */
export function createAuthMiddleware(apiKey: string): RequestHandler {
  return (req, res, next) => {
    // Skip auth for health checks
    if (req.url === '/api/health') {
      return next();
    }

    const authHeader = req.headers.authorization;
    const queryKey = new URL(req.url || '/', `http://${req.headers.host}`).searchParams.get('api_key');

    const providedKey = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : queryKey;

    if (!providedKey || !verifyApiKey(providedKey, apiKey)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized', code: 'INVALID_API_KEY' }));
      return;
    }

    next();
  };
}

/**
 * Create CORS middleware
 */
export function createCorsMiddleware(origins: string[] = ['*']): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin || '*';
    const allowed = origins.includes('*') || origins.includes(origin);

    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origins.includes('*') ? '*' : origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    next();
  };
}
