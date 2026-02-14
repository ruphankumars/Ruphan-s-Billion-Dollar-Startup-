/**
 * LocalProvider — Unit Tests
 *
 * Tests Ollama REST API wrapper: lifecycle, listModels, generate,
 * chat, embeddings, isAvailable, getModelInfo, and error handling.
 * Mocks node:http to avoid real network calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock node:http ────────────────────────────────────────────

// We need per-test control over request/response behavior, so we store
// a callback that each test can set before triggering the request.
let onRequest: ((
  req: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> },
  resCb: (res: EventEmitter & { statusCode: number }) => void,
) => void) | null = null;

vi.mock('node:http', () => ({
  request: vi.fn((
    _opts: unknown,
    cb: (res: EventEmitter & { statusCode: number }) => void,
  ) => {
    const req = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    });

    // When end() is called, trigger the test's request handler
    req.end = vi.fn(() => {
      if (onRequest) {
        onRequest(req, cb);
      }
    });

    return req;
  }),
}));

import { LocalProvider } from '../../../src/sovereign/local-provider.js';
import * as http from 'node:http';

// ── Helpers ───────────────────────────────────────────────────

function setupResponse(
  statusCode: number,
  body: unknown,
): void {
  onRequest = (_req, resCb) => {
    const res = Object.assign(new EventEmitter(), { statusCode });
    // Invoke callback, then emit data/end
    resCb(res);
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    res.emit('data', Buffer.from(raw));
    res.emit('end');
  };
}

function setupError(errorMessage: string): void {
  onRequest = (req, _resCb) => {
    req.emit('error', new Error(errorMessage));
  };
}

function setupTimeout(): void {
  onRequest = (req, _resCb) => {
    req.emit('timeout');
  };
}

// ── Test suite ────────────────────────────────────────────────

describe('LocalProvider', () => {
  let provider: LocalProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    onRequest = null;
    provider = new LocalProvider('http://localhost:11434');
  });

  // ── Constructor ───────────────────────────────────────────

  describe('constructor', () => {
    it('stores the provided base URL', () => {
      const p = new LocalProvider('http://custom:9999');
      expect(p.getBaseUrl()).toBe('http://custom:9999');
    });

    it('defaults to localhost:11434 when no URL is provided', () => {
      const p = new LocalProvider();
      expect(p.getBaseUrl()).toBe('http://localhost:11434');
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() sets running to true and emits event', () => {
      const spy = vi.fn();
      provider.on('sovereign:provider:started', spy);
      provider.start();
      expect(provider.isRunning()).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('stop() sets running to false and emits event', () => {
      provider.start();
      const spy = vi.fn();
      provider.on('sovereign:provider:stopped', spy);
      provider.stop();
      expect(provider.isRunning()).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── listModels ────────────────────────────────────────────

  describe('listModels', () => {
    it('returns an array of models from GET /api/tags', async () => {
      const models = [
        { name: 'llama3', size: 4_000_000_000, digest: 'abc', modified_at: '2024-01-01' },
      ];
      setupResponse(200, { models });

      const result = await provider.listModels();
      expect(result).toEqual(models);
    });

    it('returns empty array when response has no models field', async () => {
      setupResponse(200, {});
      const result = await provider.listModels();
      expect(result).toEqual([]);
    });
  });

  // ── generate ──────────────────────────────────────────────

  describe('generate', () => {
    it('sends POST /api/generate and returns the response', async () => {
      const generateSpy = vi.fn();
      provider.on('sovereign:generate:start', generateSpy);

      const completeSpy = vi.fn();
      provider.on('sovereign:generate:complete', completeSpy);

      const responseData = {
        model: 'llama3',
        response: 'Hello world',
        done: true,
        eval_count: 5,
      };
      setupResponse(200, responseData);

      const result = await provider.generate('llama3', 'Say hello');
      expect(result.response).toBe('Hello world');
      expect(result.model).toBe('llama3');
      expect(generateSpy).toHaveBeenCalledOnce();
      expect(completeSpy).toHaveBeenCalledOnce();
    });

    it('passes options through to the request body', async () => {
      let capturedBody = '';
      onRequest = (req, resCb) => {
        capturedBody = req.write.mock.calls[0]?.[0] ?? '';
        const res = Object.assign(new EventEmitter(), { statusCode: 200 });
        resCb(res);
        res.emit('data', Buffer.from(JSON.stringify({ model: 'llama3', response: 'ok', done: true })));
        res.emit('end');
      };

      await provider.generate('llama3', 'test', { temperature: 0.5 });

      const body = JSON.parse(capturedBody);
      expect(body.options).toEqual({ temperature: 0.5 });
      expect(body.stream).toBe(false);
    });
  });

  // ── chat ──────────────────────────────────────────────────

  describe('chat', () => {
    it('sends POST /api/chat and returns the response', async () => {
      const chatStartSpy = vi.fn();
      provider.on('sovereign:chat:start', chatStartSpy);

      const messages = [
        { role: 'user' as const, content: 'Hello' },
      ];

      const responseData = {
        model: 'llama3',
        message: { role: 'assistant', content: 'Hi there!' },
        done: true,
      };
      setupResponse(200, responseData);

      const result = await provider.chat('llama3', messages);
      expect(result.message.content).toBe('Hi there!');
      expect(chatStartSpy).toHaveBeenCalledOnce();
    });
  });

  // ── embeddings ────────────────────────────────────────────

  describe('embeddings', () => {
    it('sends POST /api/embeddings and returns the vector', async () => {
      const embeddingSpy = vi.fn();
      provider.on('sovereign:embedding:complete', embeddingSpy);

      setupResponse(200, { embedding: [0.1, 0.2, 0.3, 0.4] });

      const result = await provider.embeddings('nomic-embed-text', 'Hello world');
      expect(result.embedding).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(embeddingSpy).toHaveBeenCalledOnce();
    });
  });

  // ── isAvailable ───────────────────────────────────────────

  describe('isAvailable', () => {
    it('returns true when GET / succeeds', async () => {
      setupResponse(200, 'Ollama is running');
      const result = await provider.isAvailable();
      expect(result).toBe(true);
    });

    it('returns false when the request errors', async () => {
      setupError('ECONNREFUSED');
      const result = await provider.isAvailable();
      expect(result).toBe(false);
    });
  });

  // ── getModelInfo ──────────────────────────────────────────

  describe('getModelInfo', () => {
    it('sends POST /api/show and returns model details', async () => {
      const modelInfo = { modelfile: 'FROM llama3', parameters: 'num_ctx 4096' };
      setupResponse(200, modelInfo);
      const result = await provider.getModelInfo('llama3');
      expect(result).toEqual(modelInfo);
    });
  });

  // ── Error handling ────────────────────────────────────────

  describe('error handling', () => {
    it('rejects on HTTP 4xx/5xx errors', async () => {
      setupResponse(404, { error: 'not found' });
      await expect(provider.listModels()).rejects.toThrow('Ollama API error (404)');
    });

    it('rejects on connection error', async () => {
      setupError('ECONNREFUSED');
      await expect(provider.listModels()).rejects.toThrow('Ollama connection error');
    });

    it('rejects on timeout', async () => {
      setupTimeout();
      await expect(provider.listModels()).rejects.toThrow('Ollama request timed out');
    });
  });
});
