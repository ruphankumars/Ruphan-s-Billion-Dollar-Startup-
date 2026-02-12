/**
 * RAGProvider — Retrieval-Augmented Generation for project context.
 *
 * Indexes project files using FileIndexer, embeds chunks via LocalEmbeddingEngine,
 * and provides semantic search over the codebase. Agents can call `search()` to
 * retrieve relevant code snippets before generating responses.
 *
 * Based on: Lewis et al. 2020 — "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"
 */

import { LocalEmbeddingEngine, cosineSimilarity } from '../../memory/embeddings.js';
import { FileIndexer, type FileChunk, type IndexerOptions } from './file-indexer.js';
import { getLogger } from '../../core/logger.js';

const logger = getLogger();

export interface RAGSearchResult {
  chunk: FileChunk;
  score: number;
}

export interface RAGProviderConfig {
  maxChunks: number;
  chunkSize: number;
  minRelevance: number;
  indexerOptions?: IndexerOptions;
}

export class RAGProvider {
  private config: RAGProviderConfig;
  private indexer: FileIndexer;
  private embeddingEngine: LocalEmbeddingEngine;
  private chunks: FileChunk[] = [];
  private embeddings: number[][] = [];
  private indexed = false;

  constructor(config: RAGProviderConfig) {
    this.config = config;
    this.indexer = new FileIndexer({
      chunkSize: config.chunkSize,
      ...config.indexerOptions,
    });
    this.embeddingEngine = new LocalEmbeddingEngine();
  }

  /**
   * Index a project directory. Should be called once during initialization.
   */
  async indexProject(projectDir: string): Promise<void> {
    const startTime = Date.now();

    this.chunks = this.indexer.indexProject(projectDir);

    if (this.chunks.length === 0) {
      logger.warn('RAGProvider: no chunks indexed');
      this.indexed = true;
      return;
    }

    // Update vocabulary for better TF-IDF scores
    const texts = this.chunks.map(c => c.chunk);
    this.embeddingEngine.updateVocabulary(texts);

    // Embed all chunks
    this.embeddings = await this.embeddingEngine.embedBatch(texts);

    const duration = Date.now() - startTime;
    logger.info(
      { chunks: this.chunks.length, duration },
      'RAGProvider: project indexed and embedded',
    );

    this.indexed = true;
  }

  /**
   * Search for chunks most relevant to the query.
   */
  async search(query: string, maxResults?: number): Promise<RAGSearchResult[]> {
    if (!this.indexed || this.chunks.length === 0) {
      return [];
    }

    const limit = maxResults ?? this.config.maxChunks;
    const queryEmbedding = await this.embeddingEngine.embed(query);

    // Score all chunks by cosine similarity
    const scored: RAGSearchResult[] = this.chunks
      .map((chunk, i) => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, this.embeddings[i]),
      }))
      .filter(r => r.score >= this.config.minRelevance)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    logger.debug(
      { query: query.substring(0, 80), results: scored.length },
      'RAGProvider: search completed',
    );

    return scored;
  }

  /**
   * Format search results as context string for injection into prompts.
   */
  formatContext(results: RAGSearchResult[]): string {
    if (results.length === 0) return '';

    const sections = results.map((r, i) => {
      const header = `### [${i + 1}] ${r.chunk.relativePath} (lines ${r.chunk.startLine}-${r.chunk.endLine}, relevance: ${r.score.toFixed(2)})`;
      return `${header}\n\`\`\`\n${r.chunk.chunk}\n\`\`\``;
    });

    return `## Relevant Code Context (RAG)\n\n${sections.join('\n\n')}`;
  }

  /**
   * Check if the provider has been indexed.
   */
  get isIndexed(): boolean {
    return this.indexed;
  }

  /**
   * Get the total number of indexed chunks.
   */
  get chunkCount(): number {
    return this.chunks.length;
  }
}
