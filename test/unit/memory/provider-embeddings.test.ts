import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderEmbeddingEngine, type ProviderEmbeddingConfig } from '../../../src/memory/provider-embeddings.js';

describe('ProviderEmbeddingEngine', () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should create with OpenAI config', () => {
      const engine = new ProviderEmbeddingEngine({ provider: 'openai' });
      expect(engine).toBeDefined();
    });

    it('should create with Cohere config', () => {
      const engine = new ProviderEmbeddingEngine({ provider: 'cohere' });
      expect(engine).toBeDefined();
    });
  });

  describe('dimensions', () => {
    it('should return 1536 for OpenAI', () => {
      const engine = new ProviderEmbeddingEngine({ provider: 'openai' });
      expect(engine.dimensions()).toBe(1536);
    });

    it('should return 1024 for Cohere', () => {
      const engine = new ProviderEmbeddingEngine({ provider: 'cohere' });
      expect(engine.dimensions()).toBe(1024);
    });
  });

  describe('isConfigured', () => {
    it('should return false when no API key is set', () => {
      delete process.env.OPENAI_API_KEY;
      const engine = new ProviderEmbeddingEngine({ provider: 'openai' });
      expect(engine.isConfigured()).toBe(false);
    });

    it('should return true when env var API key is set', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const engine = new ProviderEmbeddingEngine({ provider: 'openai' });
      expect(engine.isConfigured()).toBe(true);
    });

    it('should return true when config API key is provided', () => {
      delete process.env.OPENAI_API_KEY;
      const engine = new ProviderEmbeddingEngine({
        provider: 'openai',
        apiKey: 'direct-key',
      });
      expect(engine.isConfigured()).toBe(true);
    });

    it('should check COHERE_API_KEY for Cohere', () => {
      process.env.COHERE_API_KEY = 'cohere-key';
      const engine = new ProviderEmbeddingEngine({ provider: 'cohere' });
      expect(engine.isConfigured()).toBe(true);
    });
  });

  describe('embed (fallback behavior)', () => {
    it('should fall back to local engine when no API key', async () => {
      delete process.env.OPENAI_API_KEY;
      const engine = new ProviderEmbeddingEngine({ provider: 'openai' });

      const embedding = await engine.embed('test text');
      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(1536);
    });

    it('should fall back on API error', async () => {
      process.env.OPENAI_API_KEY = 'bad-key';

      // Mock fetch to fail
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const engine = new ProviderEmbeddingEngine({ provider: 'openai', apiKey: 'bad-key' });
      const embedding = await engine.embed('test text');

      // Should still return an embedding (from fallback)
      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(1536);
    });

    it('should fall back on non-OK response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });

      const engine = new ProviderEmbeddingEngine({ provider: 'openai', apiKey: 'bad-key' });
      const embedding = await engine.embed('test text');

      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(1536);
    });
  });

  describe('embedBatch (fallback behavior)', () => {
    it('should fall back to local engine when no API key', async () => {
      delete process.env.OPENAI_API_KEY;
      const engine = new ProviderEmbeddingEngine({ provider: 'openai' });

      const embeddings = await engine.embedBatch(['text 1', 'text 2']);
      expect(embeddings).toHaveLength(2);
      for (const emb of embeddings) {
        expect(emb.length).toBe(1536);
      }
    });

    it('should handle empty batch', async () => {
      delete process.env.OPENAI_API_KEY;
      const engine = new ProviderEmbeddingEngine({ provider: 'openai' });

      const embeddings = await engine.embedBatch([]);
      expect(embeddings).toEqual([]);
    });

    it('should fall back on API error for batch', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Batch error'));

      const engine = new ProviderEmbeddingEngine({ provider: 'cohere', apiKey: 'bad-key' });
      const embeddings = await engine.embedBatch(['text 1', 'text 2']);

      expect(embeddings).toHaveLength(2);
      for (const emb of embeddings) {
        expect(emb.length).toBe(1024);
      }
    });
  });

  describe('embed with successful API call (OpenAI)', () => {
    it('should return embedding from API response', async () => {
      const mockEmbedding = new Array(1536).fill(0).map((_, i) => i / 1536);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: mockEmbedding }],
        }),
      });

      const engine = new ProviderEmbeddingEngine({ provider: 'openai', apiKey: 'valid-key' });
      const result = await engine.embed('test text');

      expect(result).toEqual(mockEmbedding);
      expect(globalThis.fetch).toHaveBeenCalledOnce();
    });
  });

  describe('embed with successful API call (Cohere)', () => {
    it('should return embedding from API response', async () => {
      const mockEmbedding = new Array(1024).fill(0).map((_, i) => i / 1024);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          embeddings: { float: [mockEmbedding] },
        }),
      });

      const engine = new ProviderEmbeddingEngine({ provider: 'cohere', apiKey: 'valid-key' });
      const result = await engine.embed('test text');

      expect(result).toEqual(mockEmbedding);
      expect(globalThis.fetch).toHaveBeenCalledOnce();
    });
  });

  describe('embedBatch with successful API call (OpenAI)', () => {
    it('should return embeddings from API response', async () => {
      const mockEmbeddings = [
        new Array(1536).fill(0.1),
        new Array(1536).fill(0.2),
      ];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: mockEmbeddings.map(e => ({ embedding: e })),
        }),
      });

      const engine = new ProviderEmbeddingEngine({ provider: 'openai', apiKey: 'valid-key' });
      const result = await engine.embedBatch(['text 1', 'text 2']);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockEmbeddings[0]);
      expect(result[1]).toEqual(mockEmbeddings[1]);
    });
  });
});
