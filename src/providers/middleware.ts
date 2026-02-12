/**
 * Provider Middleware — wraps LLMProvider with caching, logging, and cost tracking.
 * Implements the same LLMProvider interface so it's a drop-in wrapper.
 */

import { createHash } from 'crypto';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
} from './types.js';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

/** Cache entry with TTL */
interface CacheEntry {
  response: LLMResponse;
  createdAt: number;
  hitCount: number;
}

export interface MiddlewareOptions {
  /** Enable response caching */
  cacheEnabled?: boolean;
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTTL?: number;
  /** Maximum cache entries (default: 100) */
  maxCacheSize?: number;
  /** Hook called before each request */
  onRequest?: (request: LLMRequest) => void;
  /** Hook called after each response */
  onResponse?: (request: LLMRequest, response: LLMResponse) => void;
  /** Hook called on errors */
  onError?: (request: LLMRequest, error: Error) => void;
}

/**
 * MiddlewareProvider wraps an existing LLMProvider with cross-cutting concerns.
 */
export class MiddlewareProvider implements LLMProvider {
  readonly name: string;
  readonly models: string[];
  readonly defaultModel: string;

  private inner: LLMProvider;
  private cache = new Map<string, CacheEntry>();
  private options: Required<MiddlewareOptions>;

  constructor(provider: LLMProvider, options: MiddlewareOptions = {}) {
    this.inner = provider;
    this.name = provider.name;
    this.models = provider.models;
    this.defaultModel = provider.defaultModel;

    this.options = {
      cacheEnabled: options.cacheEnabled ?? false,
      cacheTTL: options.cacheTTL ?? 5 * 60 * 1000,
      maxCacheSize: options.maxCacheSize ?? 100,
      onRequest: options.onRequest ?? (() => {}),
      onResponse: options.onResponse ?? (() => {}),
      onError: options.onError ?? (() => {}),
    };
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    // Pre-hook
    this.options.onRequest(request);

    // Check cache
    if (this.options.cacheEnabled) {
      const cacheKey = this.computeCacheKey(request);
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.createdAt < this.options.cacheTTL) {
        cached.hitCount++;
        logger.debug({ provider: this.name, cacheHits: cached.hitCount }, 'Cache hit');
        return cached.response;
      }
    }

    try {
      const response = await this.inner.complete(request);

      // Post-hook
      this.options.onResponse(request, response);

      // Store in cache (only for non-tool-call responses to avoid stale tool results)
      if (this.options.cacheEnabled && response.toolCalls.length === 0) {
        this.addToCache(this.computeCacheKey(request), response);
      }

      return response;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onError(request, err);
      throw error;
    }
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    this.options.onRequest(request);
    yield* this.inner.stream(request);
  }

  async isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  countTokens(text: string): number {
    return this.inner.countTokens(text);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; hitRatio: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hitCount;
    }

    return {
      size: this.cache.size,
      maxSize: this.options.maxCacheSize,
      hitRatio: this.cache.size > 0 ? totalHits / this.cache.size : 0,
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Compute a deterministic cache key for a request.
   */
  private computeCacheKey(request: LLMRequest): string {
    const keyParts = {
      model: request.model,
      temperature: request.temperature,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content.substring(0, 500),
      })),
    };

    const hash = createHash('sha256')
      .update(JSON.stringify(keyParts))
      .digest('hex')
      .substring(0, 16);

    return `${this.name}:${hash}`;
  }

  /**
   * Add to cache with LRU eviction
   */
  private addToCache(key: string, response: LLMResponse): void {
    // Evict oldest if full
    if (this.cache.size >= this.options.maxCacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }

    this.cache.set(key, {
      response,
      createdAt: Date.now(),
      hitCount: 0,
    });
  }
}
