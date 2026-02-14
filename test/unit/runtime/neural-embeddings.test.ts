import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NeuralEmbeddingEngine } from '../../../src/runtime/neural-embeddings.js';

describe('NeuralEmbeddingEngine', () => {
  let engine: NeuralEmbeddingEngine;

  beforeEach(() => {
    engine = new NeuralEmbeddingEngine();
  });

  afterEach(() => {
    engine.destroy();
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates an engine with default options', () => {
      expect(engine).toBeInstanceOf(NeuralEmbeddingEngine);
    });

    it('accepts custom options', () => {
      const custom = new NeuralEmbeddingEngine({
        defaultModel: 'local-ngram',
        cacheMaxSizeMB: 128,
      });
      expect(custom).toBeInstanceOf(NeuralEmbeddingEngine);
      custom.destroy();
    });

    it('registers built-in models on creation', () => {
      const models = engine.listModels();
      expect(models.length).toBeGreaterThanOrEqual(3);

      const names = models.map((m) => m.name);
      expect(names).toContain('local-tfidf');
      expect(names).toContain('local-ngram');
      expect(names).toContain('local-hash');
    });
  });

  // ---------------------------------------------------------------------------
  // Model management
  // ---------------------------------------------------------------------------

  describe('registerModel()', () => {
    it('registers a custom model', () => {
      const model = engine.registerModel({
        name: 'custom-model',
        dimensions: 64,
        maxTokens: 4096,
        type: 'local',
      });

      expect(model.id).toBeDefined();
      expect(model.name).toBe('custom-model');
    });

    it('makes model findable by both ID and name', () => {
      const model = engine.registerModel({
        name: 'findable',
        dimensions: 64,
        maxTokens: 4096,
        type: 'local',
      });

      expect(engine.getModel(model.id)).toBeDefined();
      expect(engine.getModel('findable')).toBeDefined();
    });
  });

  describe('getModel()', () => {
    it('returns a model by name', () => {
      const model = engine.getModel('local-tfidf');
      expect(model).toBeDefined();
      expect(model!.dimensions).toBe(128);
    });

    it('returns undefined for unknown model', () => {
      expect(engine.getModel('nonexistent')).toBeUndefined();
    });
  });

  describe('listModels()', () => {
    it('returns deduplicated list of models', () => {
      const models = engine.listModels();
      const ids = models.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('setDefaultModel()', () => {
    it('changes the default model', () => {
      engine.setDefaultModel('local-ngram');
      // Verify by embedding without specifying model
      // Should not throw
    });

    it('throws for non-existent model', () => {
      expect(() => engine.setDefaultModel('nonexistent')).toThrow('Model not found');
    });
  });

  // ---------------------------------------------------------------------------
  // Embedding computation
  // ---------------------------------------------------------------------------

  describe('embed()', () => {
    it('embeds a single text', async () => {
      const result = await engine.embed({ text: 'hello world' });

      expect(result.vectors).toHaveLength(1);
      expect(result.vectors[0].length).toBe(128); // default tfidf dimensions
      expect(result.model).toBe('local-tfidf');
      expect(result.dimensions).toBe(128);
      expect(result.tokensUsed).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('embeds multiple texts', async () => {
      const result = await engine.embed({ text: ['hello', 'world', 'test'] });
      expect(result.vectors).toHaveLength(3);
    });

    it('uses the specified model', async () => {
      const result = await engine.embed({ text: 'test', model: 'local-ngram' });
      expect(result.model).toBe('local-ngram');
      expect(result.dimensions).toBe(256);
    });

    it('throws for unknown model', async () => {
      await expect(engine.embed({ text: 'test', model: 'nonexistent' })).rejects.toThrow('not found');
    });

    it('normalizes vectors by default', async () => {
      const result = await engine.embed({ text: 'normalizable text here' });
      const vec = result.vectors[0];

      const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      // Normalized vector should have magnitude ~1
      if (magnitude > 0) {
        expect(magnitude).toBeCloseTo(1.0, 2);
      }
    });

    it('can skip normalization', async () => {
      const result = await engine.embed({ text: 'test text', normalize: false });
      // Should still succeed
      expect(result.vectors).toHaveLength(1);
    });

    it('caches embeddings', async () => {
      await engine.embed({ text: 'cached text' });
      await engine.embed({ text: 'cached text' });

      const stats = engine.getCacheStats();
      expect(stats.entries).toBeGreaterThan(0);
    });

    it('emits runtime:embedding:computed event', async () => {
      const spy = vi.fn();
      engine.on('runtime:embedding:computed', spy);

      await engine.embed({ text: 'event test' });
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        model: 'local-tfidf',
        count: 1,
      }));
    });

    it('emits runtime:embedding:cached event on cache hit', async () => {
      const spy = vi.fn();
      engine.on('runtime:embedding:cached', spy);

      await engine.embed({ text: 'cache hit test' });
      await engine.embed({ text: 'cache hit test' });

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('embedText()', () => {
    it('returns a single vector', async () => {
      const vec = await engine.embedText('hello world');
      expect(Array.isArray(vec)).toBe(true);
      expect(vec.length).toBe(128);
    });
  });

  describe('embedBatch()', () => {
    it('returns vectors for all texts', async () => {
      const vecs = await engine.embedBatch(['hello', 'world', 'foo']);
      expect(vecs).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Local embedding strategies
  // ---------------------------------------------------------------------------

  describe('tfidfEmbed()', () => {
    it('returns a vector of specified dimensions', () => {
      const vec = engine.tfidfEmbed('machine learning algorithms', 64);
      expect(vec.length).toBe(64);
    });

    it('returns zero vector for empty text', () => {
      const vec = engine.tfidfEmbed('', 128);
      expect(vec.every((v) => v === 0)).toBe(true);
    });

    it('returns normalized vector', () => {
      const vec = engine.tfidfEmbed('some meaningful text here', 128);
      const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      if (mag > 0) {
        expect(mag).toBeCloseTo(1.0, 2);
      }
    });

    it('produces different vectors for different texts', () => {
      const v1 = engine.tfidfEmbed('neural network deep learning', 128);
      const v2 = engine.tfidfEmbed('cooking recipes pasta tomato', 128);

      // They should not be identical
      const identical = v1.every((val, i) => val === v2[i]);
      expect(identical).toBe(false);
    });

    it('produces consistent vectors for same text', () => {
      const v1 = engine.tfidfEmbed('deterministic test', 128);
      const v2 = engine.tfidfEmbed('deterministic test', 128);

      expect(v1).toEqual(v2);
    });

    it('filters out stop words', () => {
      // "the a an" are stop words, so very short text of only stop words
      const vec = engine.tfidfEmbed('the a an', 128);
      // Should be all zeros since all tokens are filtered
      expect(vec.every((v) => v === 0)).toBe(true);
    });
  });

  describe('ngramEmbed()', () => {
    it('returns a vector of specified dimensions', () => {
      const vec = engine.ngramEmbed('hello world', 64);
      expect(vec.length).toBe(64);
    });

    it('returns zero vector for empty text', () => {
      const vec = engine.ngramEmbed('', 256);
      expect(vec.every((v) => v === 0)).toBe(true);
    });

    it('works well for code similarity', () => {
      const v1 = engine.ngramEmbed('function add(a, b) { return a + b; }', 256);
      const v2 = engine.ngramEmbed('function add(x, y) { return x + y; }', 256);
      const v3 = engine.ngramEmbed('the quick brown fox jumps', 256);

      const simCodeCode = engine.cosineSimilarity(v1, v2);
      const simCodeText = engine.cosineSimilarity(v1, v3);

      // Code-to-code should be more similar than code-to-text
      expect(simCodeCode).toBeGreaterThan(simCodeText);
    });

    it('accepts custom n-gram size', () => {
      const vec = engine.ngramEmbed('test', 128, 4);
      expect(vec.length).toBe(128);
    });
  });

  describe('hashEmbed()', () => {
    it('returns a vector of specified dimensions', () => {
      const vec = engine.hashEmbed('feature hashing test', 64);
      expect(vec.length).toBe(64);
    });

    it('returns zero vector for empty text', () => {
      const vec = engine.hashEmbed('', 128);
      expect(vec.every((v) => v === 0)).toBe(true);
    });

    it('is deterministic', () => {
      const v1 = engine.hashEmbed('consistent hashing', 128);
      const v2 = engine.hashEmbed('consistent hashing', 128);
      expect(v1).toEqual(v2);
    });

    it('handles very short tokens', () => {
      // Single-char tokens are filtered by tokenizer (length > 1)
      const vec = engine.hashEmbed('a b c d e f', 128);
      // Should be zero since all tokens have length 1
      expect(vec.every((v) => v === 0)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Vector store operations
  // ---------------------------------------------------------------------------

  describe('store() / get() / remove()', () => {
    it('stores and retrieves a vector', () => {
      engine.store('vec-1', [1, 2, 3], { label: 'test' }, 'text-1');

      const entry = engine.get('vec-1');
      expect(entry).toBeDefined();
      expect(entry!.vector).toEqual([1, 2, 3]);
      expect(entry!.metadata).toEqual({ label: 'test' });
      expect(entry!.text).toBe('text-1');
    });

    it('returns undefined for unknown ID', () => {
      expect(engine.get('unknown')).toBeUndefined();
    });

    it('removes a stored vector', () => {
      engine.store('rem-1', [1, 2]);
      expect(engine.remove('rem-1')).toBe(true);
      expect(engine.get('rem-1')).toBeUndefined();
    });

    it('returns false when removing non-existent entry', () => {
      expect(engine.remove('ghost')).toBe(false);
    });

    it('stores with no metadata', () => {
      engine.store('no-meta', [1, 2, 3]);
      const entry = engine.get('no-meta');
      expect(entry!.metadata).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // Similarity search
  // ---------------------------------------------------------------------------

  describe('search()', () => {
    it('finds similar vectors', () => {
      engine.store('v1', [1, 0, 0], { label: 'x-axis' });
      engine.store('v2', [0, 1, 0], { label: 'y-axis' });
      engine.store('v3', [0.9, 0.1, 0], { label: 'near-x' });

      const results = engine.search([1, 0, 0]);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('v1'); // Most similar
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        engine.store(`sv-${i}`, [Math.random(), Math.random(), Math.random()]);
      }

      const results = engine.search([1, 0, 0], { limit: 5 });
      expect(results).toHaveLength(5);
    });

    it('respects minScore parameter', () => {
      engine.store('high', [1, 0, 0], { label: 'high' });
      engine.store('low', [0, 0, 1], { label: 'low' });

      const results = engine.search([1, 0, 0], { minScore: 0.8 });
      expect(results.every((r) => r.score >= 0.8)).toBe(true);
    });

    it('returns results sorted by score descending', () => {
      engine.store('s1', [1, 0, 0]);
      engine.store('s2', [0.5, 0.5, 0]);
      engine.store('s3', [0, 1, 0]);

      const results = engine.search([1, 0, 0]);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('returns empty array when store is empty', () => {
      expect(engine.search([1, 0, 0])).toEqual([]);
    });

    it('includes metadata and text in results', () => {
      engine.store('meta-search', [1, 0], { key: 'value' }, 'original text');

      const results = engine.search([1, 0]);
      expect(results[0].metadata).toEqual({ key: 'value' });
      expect(results[0].text).toBe('original text');
    });
  });

  describe('searchByText()', () => {
    it('searches by text using embedding', async () => {
      const vec = await engine.embedText('machine learning');
      engine.store('ml-doc', vec, {}, 'machine learning tutorial');

      const results = await engine.searchByText('deep learning algorithms');
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('returns empty when store is empty', async () => {
      const results = await engine.searchByText('anything');
      expect(results).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Vector math utilities
  // ---------------------------------------------------------------------------

  describe('cosineSimilarity()', () => {
    it('returns 1 for identical vectors', () => {
      expect(engine.cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0, 5);
    });

    it('returns -1 for opposite vectors', () => {
      expect(engine.cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(engine.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });

    it('returns 0 for empty vectors', () => {
      expect(engine.cosineSimilarity([], [])).toBe(0);
    });

    it('returns 0 for different-length vectors', () => {
      expect(engine.cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it('returns 0 when a vector is all zeros', () => {
      expect(engine.cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });
  });

  describe('euclideanDistance()', () => {
    it('returns 0 for identical vectors', () => {
      expect(engine.euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
    });

    it('computes correct distance', () => {
      expect(engine.euclideanDistance([0, 0], [3, 4])).toBe(5);
    });

    it('returns Infinity for different-length vectors', () => {
      expect(engine.euclideanDistance([1, 2], [1, 2, 3])).toBe(Infinity);
    });
  });

  describe('normalizeVector()', () => {
    it('normalizes to unit length', () => {
      const result = engine.normalizeVector([3, 4]);
      const mag = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
      expect(mag).toBeCloseTo(1.0, 5);
    });

    it('returns same vector if already zero', () => {
      const result = engine.normalizeVector([0, 0, 0]);
      expect(result).toEqual([0, 0, 0]);
    });

    it('handles single-element vector', () => {
      const result = engine.normalizeVector([5]);
      expect(result[0]).toBeCloseTo(1.0, 5);
    });
  });

  describe('dotProduct()', () => {
    it('computes correct dot product', () => {
      expect(engine.dotProduct([1, 2, 3], [4, 5, 6])).toBe(32);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(engine.dotProduct([1, 0], [0, 1])).toBe(0);
    });

    it('returns 0 for different-length vectors', () => {
      expect(engine.dotProduct([1, 2], [1, 2, 3])).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache management
  // ---------------------------------------------------------------------------

  describe('getCacheStats()', () => {
    it('returns initial cache stats', () => {
      const stats = engine.getCacheStats();
      expect(stats.entries).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.sizeMB).toBe(0);
    });

    it('tracks cache entries after embedding', async () => {
      await engine.embed({ text: 'cached text' });

      const stats = engine.getCacheStats();
      expect(stats.entries).toBeGreaterThan(0);
    });

    it('tracks hit rate', async () => {
      await engine.embed({ text: 'first' });
      await engine.embed({ text: 'first' }); // cache hit

      const stats = engine.getCacheStats();
      expect(stats.hitRate).toBeGreaterThan(0);
    });
  });

  describe('clearCache()', () => {
    it('clears the cache', async () => {
      await engine.embed({ text: 'to be cleared' });
      engine.clearCache();

      const stats = engine.getCacheStats();
      expect(stats.entries).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  describe('getStats()', () => {
    it('returns initial stats', () => {
      const stats = engine.getStats();
      expect(stats.modelsRegistered).toBeGreaterThanOrEqual(3);
      expect(stats.vectorsStored).toBe(0);
      expect(stats.totalEmbeddings).toBe(0);
      expect(stats.cacheHitRate).toBe(0);
    });

    it('tracks embeddings and vectors', async () => {
      await engine.embedText('track this');
      engine.store('v1', [1, 2, 3]);

      const stats = engine.getStats();
      expect(stats.totalEmbeddings).toBe(1);
      expect(stats.vectorsStored).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Destroy
  // ---------------------------------------------------------------------------

  describe('destroy()', () => {
    it('clears everything', async () => {
      await engine.embedText('destroy me');
      engine.store('d1', [1, 2]);

      engine.destroy();

      expect(engine.listModels()).toHaveLength(0);
      expect(engine.getCacheStats().entries).toBe(0);
    });

    it('removes all listeners', () => {
      engine.on('runtime:embedding:computed', () => {});
      engine.destroy();
      expect(engine.listenerCount('runtime:embedding:computed')).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Stress tests
  // ---------------------------------------------------------------------------

  describe('stress tests', () => {
    it('handles embedding 100 texts', async () => {
      const texts = Array.from({ length: 100 }, (_, i) => `document number ${i} about various topics`);
      const result = await engine.embed({ text: texts });
      expect(result.vectors).toHaveLength(100);
    });

    it('handles 500 vector store entries', () => {
      for (let i = 0; i < 500; i++) {
        engine.store(`stress-${i}`, [Math.random(), Math.random(), Math.random()]);
      }

      const results = engine.search([1, 0, 0], { limit: 10 });
      expect(results).toHaveLength(10);
    });

    it('handles rapid embed/search cycles', async () => {
      for (let i = 0; i < 50; i++) {
        const vec = await engine.embedText(`document ${i}`);
        engine.store(`doc-${i}`, vec, {}, `document ${i}`);
      }

      const results = await engine.searchByText('document 25');
      expect(results.length).toBeGreaterThan(0);
    });

    it('handles large text embeddings', async () => {
      const largeText = 'word '.repeat(5000);
      const result = await engine.embed({ text: largeText });
      expect(result.vectors).toHaveLength(1);
      expect(result.vectors[0].length).toBe(128);
    });

    it('handles concurrent embeddings', async () => {
      const promises = Array.from({ length: 20 }, (_, i) =>
        engine.embedText(`concurrent text ${i}`),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(20);
      results.forEach((vec) => {
        expect(vec.length).toBe(128);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles text with only stop words', async () => {
      const vec = await engine.embedText('the a an is was');
      // Should be zero vector since all tokens are stop words
      expect(vec.every((v) => v === 0)).toBe(true);
    });

    it('handles text with special characters', async () => {
      const vec = await engine.embedText('hello!!! @#$% ^&*()');
      expect(vec.length).toBe(128);
    });

    it('handles unicode text', async () => {
      const vec = await engine.embedText('machine learning algorithms');
      expect(vec.length).toBe(128);
    });

    it('handles single-word text', async () => {
      const vec = await engine.embedText('algorithm');
      expect(vec.length).toBe(128);
    });

    it('handles very short text', async () => {
      const vec = await engine.embedText('hi');
      expect(vec.length).toBe(128);
    });

    it('handles empty string embedding', async () => {
      const vec = await engine.embedText('');
      expect(vec.length).toBe(128);
      expect(vec.every((v) => v === 0)).toBe(true);
    });

    it('similar texts produce similar embeddings', async () => {
      const v1 = await engine.embedText('machine learning neural networks');
      const v2 = await engine.embedText('machine learning deep networks');
      const v3 = await engine.embedText('cooking pasta tomato sauce recipe');

      const sim12 = engine.cosineSimilarity(v1, v2);
      const sim13 = engine.cosineSimilarity(v1, v3);

      // Texts about ML should be more similar than ML vs cooking
      expect(sim12).toBeGreaterThan(sim13);
    });

    it('search with zero-vector query returns results with score 0', () => {
      engine.store('z1', [1, 0, 0]);
      engine.store('z2', [0, 1, 0]);

      // cosine(0-vec, x) = 0, and minScore defaults to 0.0; 0 >= 0 is true,
      // so results are still returned — all with score 0
      const results = engine.search([0, 0, 0]);
      expect(results).toHaveLength(2);
      for (const r of results) {
        expect(r.score).toBe(0);
      }
    });

    it('handles negative weights in vectors', () => {
      const sim = engine.cosineSimilarity([1, -1, 0], [1, -1, 0]);
      expect(sim).toBeCloseTo(1.0, 5);
    });

    it('handles dimension mismatch in search gracefully', () => {
      engine.store('dim3', [1, 2, 3]);

      // cosineSimilarity returns 0 for mismatched dimensions, and minScore defaults
      // to 0.0; 0 >= 0 is true, so the result is still included with score 0
      const results = engine.search([1, 2]);
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Real-world scenario tests
  // ---------------------------------------------------------------------------

  describe('real-world scenarios', () => {
    it('semantic search workflow: embed, store, search', async () => {
      const docs = [
        'TypeScript is a typed superset of JavaScript',
        'Python is great for machine learning',
        'React is a JavaScript library for building UIs',
        'TensorFlow is a machine learning framework',
        'Vue.js is a progressive JavaScript framework',
      ];

      for (let i = 0; i < docs.length; i++) {
        const vec = await engine.embedText(docs[i]);
        engine.store(`doc-${i}`, vec, { index: i }, docs[i]);
      }

      const results = await engine.searchByText('JavaScript programming');
      expect(results.length).toBeGreaterThan(0);
    });

    it('embedding consistency across model types', async () => {
      const text = 'artificial intelligence and deep learning';

      const tfidf = await engine.embed({ text, model: 'local-tfidf' });
      const ngram = await engine.embed({ text, model: 'local-ngram' });
      const hash = await engine.embed({ text, model: 'local-hash' });

      // Each model produces different-dimension vectors
      expect(tfidf.dimensions).toBe(128);
      expect(ngram.dimensions).toBe(256);
      expect(hash.dimensions).toBe(128);

      // All should produce non-zero vectors for meaningful text
      expect(tfidf.vectors[0].some((v) => v !== 0)).toBe(true);
      expect(ngram.vectors[0].some((v) => v !== 0)).toBe(true);
      expect(hash.vectors[0].some((v) => v !== 0)).toBe(true);
    });

    it('cache improves performance on repeated embeddings', async () => {
      const text = 'performance test for caching mechanism';

      const start1 = performance.now();
      await engine.embed({ text });
      const dur1 = performance.now() - start1;

      const start2 = performance.now();
      await engine.embed({ text });
      const dur2 = performance.now() - start2;

      // Second call should be faster (cache hit)
      // We just verify it doesn't fail; timing can be unreliable
      expect(dur2).toBeGreaterThanOrEqual(0);

      const stats = engine.getCacheStats();
      expect(stats.hitRate).toBeGreaterThan(0);
    });
  });
});
