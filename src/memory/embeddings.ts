/**
 * Local Embedding Engine
 * Uses TF-IDF + cosine similarity (no external dependencies).
 * Provides lightweight embedding for memory search and deduplication.
 */

import type { EmbeddingEngine } from './types.js';

/**
 * TF-IDF based embedding engine for MVP
 * Generates sparse embeddings locally without API calls
 */
export class LocalEmbeddingEngine implements EmbeddingEngine {
  private vocabulary: Map<string, number> = new Map();
  private idfScores: Map<string, number> = new Map();
  private documentCount = 0;
  private readonly dims: number;

  constructor(dimensions = 384) {
    this.dims = dimensions;
  }

  dimensions(): number {
    return this.dims;
  }

  async embed(text: string): Promise<number[]> {
    const tokens = this.tokenize(text);
    return this.computeEmbedding(tokens);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }

  /**
   * Update vocabulary and IDF scores with new documents
   */
  updateVocabulary(documents: string[]): void {
    const docFreq = new Map<string, number>();

    for (const doc of documents) {
      const tokens = new Set(this.tokenize(doc));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
        if (!this.vocabulary.has(token)) {
          this.vocabulary.set(token, this.vocabulary.size);
        }
      }
    }

    this.documentCount += documents.length;

    // Update IDF scores
    for (const [term, freq] of docFreq) {
      const currentFreq = (this.idfScores.get(term) || 0) * (this.documentCount - documents.length) + freq;
      this.idfScores.set(term, Math.log(this.documentCount / (1 + currentFreq)));
    }
  }

  /**
   * Tokenize text into normalized terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1 && token.length < 50)
      .filter(token => !STOP_WORDS.has(token));
  }

  /**
   * Compute embedding vector from tokens using hash-based projection
   */
  private computeEmbedding(tokens: string[]): number[] {
    const embedding = new Float64Array(this.dims);

    // Term frequency
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // Hash-project each term's TF-IDF score into the embedding space
    for (const [term, freq] of tf) {
      const tfidf = (freq / tokens.length) * (this.idfScores.get(term) || 1.0);

      // Use multiple hash projections for each term
      const hash1 = this.hashString(term, 0);
      const hash2 = this.hashString(term, 1);
      const hash3 = this.hashString(term, 2);

      const idx1 = Math.abs(hash1) % this.dims;
      const idx2 = Math.abs(hash2) % this.dims;
      const idx3 = Math.abs(hash3) % this.dims;

      embedding[idx1] += tfidf * (hash1 > 0 ? 1 : -1);
      embedding[idx2] += tfidf * (hash2 > 0 ? 1 : -1);
      embedding[idx3] += tfidf * (hash3 > 0 ? 1 : -1);
    }

    // L2 normalize
    return this.normalize(Array.from(embedding));
  }

  /**
   * Simple string hash function with seed
   */
  private hashString(str: string, seed: number): number {
    let hash = seed;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash;
  }

  /**
   * L2 normalize a vector
   */
  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vec;
    return vec.map(val => val / magnitude);
  }
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'not', 'no', 'nor',
  'so', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'it',
  'its', 'my', 'your', 'his', 'her', 'our', 'their', 'we', 'you', 'he',
  'she', 'they', 'me', 'him', 'us', 'them', 'what', 'which', 'who',
  'whom', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
  'very', 'just', 'also', 'about', 'up', 'out', 'into', 'over', 'after',
  'before', 'between', 'under', 'above', 'below', 'through', 'during',
]);
