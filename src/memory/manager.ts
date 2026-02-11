/**
 * Memory Manager — Unified facade for the memory system
 * Handles recall (search), store, forget, and statistics.
 * Implements Ebbinghaus forgetting curves for memory decay.
 */

import type {
  MemoryManager as IMemoryManager,
  MemoryEntry,
  MemoryQuery,
  MemoryRecallResult,
  MemoryStoreOptions,
  MemoryStats,
  MemoryConfig,
  MemoryType,
  MemoryMetadata,
} from './types.js';
import { LocalEmbeddingEngine } from './embeddings.js';
import { SQLiteVectorStore } from './store/vector-sqlite.js';
import { nanoid } from 'nanoid';
import { join } from 'path';

export class CortexMemoryManager implements IMemoryManager {
  private embeddingEngine: LocalEmbeddingEngine;
  private vectorStore: SQLiteVectorStore;
  private memoryCache: Map<string, MemoryEntry> = new Map();
  private config: MemoryConfig;

  constructor(config: MemoryConfig) {
    this.config = config;
    this.embeddingEngine = new LocalEmbeddingEngine(384);

    const dbPath = config.projectDir
      ? join(config.projectDir, '.cortexos', 'memory', 'vectors.db')
      : join(config.globalDir, 'memory', 'vectors.db');

    this.vectorStore = new SQLiteVectorStore(dbPath);
  }

  /**
   * Recall relevant memories for a query
   * Returns memories ranked by relevance + recency + importance
   */
  async recall(query: MemoryQuery): Promise<MemoryRecallResult[]> {
    if (!this.config.enabled) return [];

    const maxResults = query.maxResults ?? 10;

    // Generate query embedding
    const queryEmbedding = await this.embeddingEngine.embed(query.text);

    // Build filter
    const filter: Record<string, unknown> = {};
    if (query.type) filter.type = query.type;
    if (query.project) filter.project = query.project;

    // Search vector store
    const searchResults = await this.vectorStore.search(
      queryEmbedding,
      maxResults * 2, // Fetch extra for post-filtering
      Object.keys(filter).length > 0 ? filter : undefined,
    );

    // Post-process results with decay and importance scoring
    const results: MemoryRecallResult[] = [];

    for (const result of searchResults) {
      const entry = this.reconstructEntry(result.id, result.metadata);
      if (!entry) continue;

      // Apply Ebbinghaus forgetting curve
      const decayedImportance = this.applyDecay(entry);

      // Skip decayed memories unless explicitly included
      if (!query.includeDecayed && decayedImportance < this.config.minImportanceThreshold) {
        continue;
      }

      // Filter by minimum importance
      if (query.minImportance && decayedImportance < query.minImportance) {
        continue;
      }

      // Filter by tags
      if (query.tags && query.tags.length > 0) {
        const entryTags = new Set(entry.metadata.tags);
        if (!query.tags.some(t => entryTags.has(t))) {
          continue;
        }
      }

      // Calculate final score
      const recencyBoost = this.calculateRecencyBoost(entry.accessedAt);
      const finalScore = (result.score * 0.6) + (decayedImportance * 0.25) + (recencyBoost * 0.15);

      results.push({
        entry: { ...entry, importance: decayedImportance },
        relevance: result.score,
        recencyBoost,
        finalScore,
      });
    }

    // Sort by final score and limit
    results.sort((a, b) => b.finalScore - a.finalScore);
    return results.slice(0, maxResults);
  }

  /**
   * Store a new memory
   */
  async store(content: string, options: MemoryStoreOptions): Promise<MemoryEntry> {
    if (!this.config.enabled) {
      throw new Error('Memory system is disabled');
    }

    const id = nanoid();
    const now = new Date();

    // Generate embedding
    const embedding = await this.embeddingEngine.embed(content);

    // Update vocabulary for better future embeddings
    this.embeddingEngine.updateVocabulary([content]);

    const metadata: MemoryMetadata = {
      source: options.source ?? 'manual',
      project: options.project,
      tags: options.tags ?? [],
      entities: options.entities ?? [],
      relations: [],
      confidence: 1.0,
    };

    const entry: MemoryEntry = {
      id,
      type: options.type,
      content,
      embedding,
      metadata,
      createdAt: now,
      updatedAt: now,
      accessedAt: now,
      accessCount: 0,
      importance: options.importance ?? 0.5,
      decayFactor: 1.0,
    };

    // Store in vector database
    await this.vectorStore.add(id, embedding, {
      type: options.type,
      project: options.project,
      content,
      importance: entry.importance,
      tags: options.tags ?? [],
      entities: options.entities ?? [],
      source: options.source ?? 'manual',
      createdAt: now.toISOString(),
      accessedAt: now.toISOString(),
      accessCount: 0,
      decayFactor: 1.0,
    });

    // Cache in memory
    this.memoryCache.set(id, entry);

    return entry;
  }

  /**
   * Forget (delete) a memory
   */
  async forget(id: string): Promise<void> {
    await this.vectorStore.delete(id);
    this.memoryCache.delete(id);
  }

  /**
   * Get memory system statistics
   */
  async getStats(): Promise<MemoryStats> {
    const totalMemories = await this.vectorStore.count();

    return {
      totalMemories,
      byType: {
        working: 0,
        episodic: 0,
        semantic: 0,
        procedural: 0,
      },
      averageImportance: 0.5,
      storageSize: 0,
    };
  }

  /**
   * Close memory system and release resources
   */
  async close(): Promise<void> {
    await this.vectorStore.close();
    this.memoryCache.clear();
  }

  /**
   * Apply Ebbinghaus forgetting curve to a memory entry
   * Returns the decayed importance value
   */
  private applyDecay(entry: MemoryEntry): number {
    if (!this.config.decayEnabled) return entry.importance;

    const now = Date.now();
    const lastAccess = entry.accessedAt.getTime();
    const daysSinceAccess = (now - lastAccess) / (1000 * 60 * 60 * 24);

    // Ebbinghaus: R = e^(-t/S)
    // S (stability) increases with each access
    const stability = this.config.decayHalfLifeDays * (1 + Math.log(1 + entry.accessCount));
    const retention = Math.exp(-daysSinceAccess / stability);

    return entry.importance * retention * entry.decayFactor;
  }

  /**
   * Calculate recency boost (memories accessed recently get a boost)
   */
  private calculateRecencyBoost(accessedAt: Date): number {
    const hoursSinceAccess = (Date.now() - accessedAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceAccess < 1) return 1.0;
    if (hoursSinceAccess < 24) return 0.8;
    if (hoursSinceAccess < 168) return 0.5; // 1 week
    if (hoursSinceAccess < 720) return 0.3; // 30 days
    return 0.1;
  }

  /**
   * Reconstruct a MemoryEntry from vector store metadata
   */
  private reconstructEntry(
    id: string,
    metadata: Record<string, unknown>,
  ): MemoryEntry | null {
    // Check cache first
    const cached = this.memoryCache.get(id);
    if (cached) return cached;

    try {
      const entry: MemoryEntry = {
        id,
        type: (metadata.type as MemoryType) || 'semantic',
        content: (metadata.content as string) || '',
        metadata: {
          source: (metadata.source as string) || 'unknown',
          project: metadata.project as string | undefined,
          tags: (metadata.tags as string[]) || [],
          entities: (metadata.entities as string[]) || [],
          relations: [],
          confidence: 1.0,
        },
        createdAt: new Date((metadata.createdAt as string) || Date.now()),
        updatedAt: new Date((metadata.createdAt as string) || Date.now()),
        accessedAt: new Date((metadata.accessedAt as string) || Date.now()),
        accessCount: (metadata.accessCount as number) || 0,
        importance: (metadata.importance as number) || 0.5,
        decayFactor: (metadata.decayFactor as number) || 1.0,
      };

      this.memoryCache.set(id, entry);
      return entry;
    } catch {
      return null;
    }
  }

  /**
   * Static factory
   */
  static create(config: MemoryConfig): CortexMemoryManager {
    return new CortexMemoryManager(config);
  }
}
