/**
 * LocalProvider — Ollama REST API Wrapper
 *
 * Wraps the Ollama REST API for local model inference.
 * Supports generate, chat, embeddings, and model management.
 * Zero npm dependencies — uses node:http for all requests.
 */

import { EventEmitter } from 'node:events';
import * as http from 'node:http';
import type {
  OllamaModel,
  OllamaGenerateRequest,
  OllamaGenerateResponse,
  OllamaChatMessage,
  OllamaChatResponse,
  OllamaEmbeddingResponse,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes

// ═══════════════════════════════════════════════════════════════
// LOCAL PROVIDER
// ═══════════════════════════════════════════════════════════════

export class LocalProvider extends EventEmitter {
  private baseUrl: string;
  private running = false;

  constructor(baseUrl?: string) {
    super();
    this.baseUrl = baseUrl ?? DEFAULT_OLLAMA_URL;
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('sovereign:provider:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('sovereign:provider:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // API METHODS
  // ─────────────────────────────────────────────────────────

  /**
   * List all locally available models.
   * GET /api/tags
   */
  async listModels(): Promise<OllamaModel[]> {
    const response = await this.request<{ models: OllamaModel[] }>('GET', '/api/tags');
    return response.models ?? [];
  }

  /**
   * Generate a completion from a prompt.
   * POST /api/generate
   */
  async generate(
    model: string,
    prompt: string,
    options?: Record<string, unknown>,
  ): Promise<OllamaGenerateResponse> {
    const body: OllamaGenerateRequest = {
      model,
      prompt,
      stream: false,
      options,
    };

    this.emit('sovereign:generate:start', {
      timestamp: Date.now(),
      model,
      promptLength: prompt.length,
    });

    const response = await this.request<OllamaGenerateResponse>('POST', '/api/generate', body);

    this.emit('sovereign:generate:complete', {
      timestamp: Date.now(),
      model,
      responseLength: response.response?.length ?? 0,
      evalCount: response.eval_count,
    });

    return response;
  }

  /**
   * Chat with a model using message history.
   * POST /api/chat
   */
  async chat(
    model: string,
    messages: OllamaChatMessage[],
    options?: Record<string, unknown>,
  ): Promise<OllamaChatResponse> {
    const body = {
      model,
      messages,
      stream: false,
      options,
    };

    this.emit('sovereign:chat:start', {
      timestamp: Date.now(),
      model,
      messageCount: messages.length,
    });

    const response = await this.request<OllamaChatResponse>('POST', '/api/chat', body);

    this.emit('sovereign:chat:complete', {
      timestamp: Date.now(),
      model,
      responseLength: response.message?.content?.length ?? 0,
    });

    return response;
  }

  /**
   * Generate embeddings for a prompt.
   * POST /api/embeddings
   */
  async embeddings(
    model: string,
    prompt: string,
  ): Promise<OllamaEmbeddingResponse> {
    const body = { model, prompt };

    this.emit('sovereign:embedding:start', {
      timestamp: Date.now(),
      model,
      promptLength: prompt.length,
    });

    const response = await this.request<OllamaEmbeddingResponse>('POST', '/api/embeddings', body);

    this.emit('sovereign:embedding:complete', {
      timestamp: Date.now(),
      model,
      dimensions: response.embedding?.length ?? 0,
    });

    return response;
  }

  /**
   * Check if Ollama is running and available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.request<string>('GET', '/');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get detailed information about a specific model.
   * POST /api/show
   */
  async getModelInfo(name: string): Promise<Record<string, unknown>> {
    const response = await this.request<Record<string, unknown>>('POST', '/api/show', { name });
    return response;
  }

  /**
   * Get the base URL being used.
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — HTTP request helper
  // ─────────────────────────────────────────────────────────

  private request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = new URL(path, this.baseUrl);

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 11434,
        path: url.pathname,
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      };

      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Ollama API error (${res.statusCode}): ${rawBody}`));
            return;
          }

          try {
            const parsed = JSON.parse(rawBody) as T;
            resolve(parsed);
          } catch {
            // For non-JSON responses (like health check)
            resolve(rawBody as unknown as T);
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Ollama connection error: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Ollama request timed out'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }
}
