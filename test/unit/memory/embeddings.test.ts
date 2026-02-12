import { describe, it, expect, beforeEach } from 'vitest';
import { LocalEmbeddingEngine, cosineSimilarity } from '../../../src/memory/embeddings.js';

describe('LocalEmbeddingEngine', () => {
  let engine: LocalEmbeddingEngine;

  beforeEach(() => {
    engine = new LocalEmbeddingEngine(128);
  });

  describe('dimensions', () => {
    it('should return the value passed to the constructor', () => {
      expect(engine.dimensions()).toBe(128);

      const engine256 = new LocalEmbeddingEngine(256);
      expect(engine256.dimensions()).toBe(256);
    });

    it('should default to 384 when no argument is provided', () => {
      const defaultEngine = new LocalEmbeddingEngine();
      expect(defaultEngine.dimensions()).toBe(384);
    });
  });

  describe('embed', () => {
    it('should return a vector of correct length', async () => {
      const embedding = await engine.embed('hello world programming');
      expect(embedding).toHaveLength(128);
    });

    it('should return a normalized vector with magnitude approximately 1.0', async () => {
      const embedding = await engine.embed('TypeScript is a great language for development');
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1.0, 1);
    });

    it('should produce the same embedding for the same text', async () => {
      const text = 'deterministic embedding test content';
      const embedding1 = await engine.embed(text);
      const embedding2 = await engine.embed(text);
      expect(embedding1).toEqual(embedding2);
    });

    it('should produce different embeddings for different text', async () => {
      const embedding1 = await engine.embed('TypeScript React frontend application');
      const embedding2 = await engine.embed('Python Django backend server database');
      expect(embedding1).not.toEqual(embedding2);
    });
  });

  describe('embedBatch', () => {
    it('should return an array of correct length', async () => {
      const texts = ['first document', 'second document', 'third document'];
      const embeddings = await engine.embedBatch(texts);
      expect(embeddings).toHaveLength(3);
      for (const embedding of embeddings) {
        expect(embedding).toHaveLength(128);
      }
    });
  });

  describe('updateVocabulary', () => {
    it('should change embedding results after vocabulary update', async () => {
      const text = 'machine learning neural network';
      const embeddingBefore = await engine.embed(text);

      engine.updateVocabulary([
        'machine learning is a subset of artificial intelligence',
        'neural networks are used in deep learning',
        'supervised learning requires labeled data',
      ]);

      const embeddingAfter = await engine.embed(text);
      expect(embeddingBefore).not.toEqual(embeddingAfter);
    });
  });

  describe('similarity relationships', () => {
    it('should produce higher cosine similarity for similar texts than dissimilar texts', async () => {
      engine.updateVocabulary([
        'JavaScript TypeScript React Angular Vue frontend web development',
        'Python machine learning data science pandas numpy tensorflow',
        'database SQL PostgreSQL MySQL query optimization indexing',
      ]);

      const jsEmbed = await engine.embed('JavaScript TypeScript frontend web development');
      const reactEmbed = await engine.embed('React Angular Vue frontend web application');
      const pythonEmbed = await engine.embed('Python machine learning data science');

      const similarScore = cosineSimilarity(jsEmbed, reactEmbed);
      const dissimilarScore = cosineSimilarity(jsEmbed, pythonEmbed);

      expect(similarScore).toBeGreaterThan(dissimilarScore);
    });
  });
});

describe('cosineSimilarity', () => {
  it('should return 1.0 for identical vectors', () => {
    const vec = [0.5, 0.3, 0.8, 0.1];
    const similarity = cosineSimilarity(vec, vec);
    expect(similarity).toBeCloseTo(1.0, 5);
  });

  it('should return 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0, 0];
    const b = [0, 1, 0, 0];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(0.0, 5);
  });

  it('should return 0 for vectors of different lengths', () => {
    const a = [1, 2, 3];
    const b = [1, 2, 3, 4];
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBe(0);
  });
});
