/**
 * Global Memory Pool — cross-project memory sharing.
 * Stores high-importance memories in a global SQLite DB,
 * enabling recall across project boundaries.
 */

import { SQLiteVectorStore } from './store/vector-sqlite.js';
import type {
  MemoryStoreOptions,
  MemoryRecallResult,
  MemoryQuery,
  MemoryEntry,
  MemoryType,
  EmbeddingEngine,
  VectorSearchResult,
} from './types.js';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

export interface GlobalStoreOptions extends MemoryStoreOptions {
  /** Tag identifying the source project */
  projectTag: string;
}

/**
 * GlobalMemoryPool manages a shared memory store accessible across all projects.
 */
export class GlobalMemoryPool {
  private store: SQLiteVectorStore;
  private embeddingEngine: EmbeddingEngine;

  constructor(globalDir: string, embeddingEngine: EmbeddingEngine) {
    const dbPath = join(globalDir, 'memory', 'global-vectors.db');
    this.store = new SQLiteVectorStore(dbPath);
    this.embeddingEngine = embeddingEngine;
  }

  /**
   * Store a memory in the global pool with a project tag.
   */
  async storeGlobal(content: string, options: GlobalStoreOptions): Promise<string> {
    const id = `global-${nanoid()}`;
    const now = new Date();

    const embedding = await this.embeddingEngine.embed(content);

    await this.store.add(id, embedding, {
      type: options.type,
      project: options.projectTag,
      content,
      importance: options.importance ?? 0.5,
      tags: options.tags ?? [],
      entities: options.entities ?? [],
      source: options.source ?? 'cross-project',
      createdAt: now.toISOString(),
      accessedAt: now.toISOString(),
      accessCount: 0,
      decayFactor: 1.0,
    });

    logger.debug(
      { id, project: options.projectTag, importance: options.importance },
      'Stored memory in global pool',
    );

    return id;
  }

  /**
   * Recall memories from the global pool across all projects.
   * Returns results ranked by relevance, regardless of project origin.
   */
  async recallAcrossProjects(
    query: MemoryQuery,
  ): Promise<MemoryRecallResult[]> {
    const maxResults = query.maxResults ?? 10;
    const queryEmbedding = await this.embeddingEngine.embed(query.text);

    // Build filter — no project filter for cross-project search
    const filter: Record<string, unknown> = {};
    if (query.type) filter.type = query.type;

    const searchResults = await this.store.search(
      queryEmbedding,
      maxResults * 2,
      Object.keys(filter).length > 0 ? filter : undefined,
    );

    const results: MemoryRecallResult[] = [];

    for (const result of searchResults) {
      const entry = this.resultToEntry(result);
      if (!entry) continue;

      // Filter by tags if specified
      if (query.tags && query.tags.length > 0) {
        const entryTags = new Set(entry.metadata.tags);
        if (!query.tags.some(t => entryTags.has(t))) continue;
      }

      // Filter by minimum importance
      if (query.minImportance && entry.importance < query.minImportance) continue;

      // Calculate recency boost
      const recencyBoost = this.calculateRecencyBoost(entry.accessedAt);
      const finalScore = (result.score * 0.6) + (entry.importance * 0.25) + (recencyBoost * 0.15);

      results.push({
        entry,
        relevance: result.score,
        recencyBoost,
        finalScore,
      });
    }

    results.sort((a, b) => b.finalScore - a.finalScore);
    return results.slice(0, maxResults);
  }

  /**
   * Sync high-importance memories from a project store to the global pool.
   * @returns Number of memories synced.
   */
  async syncFromProject(
    projectResults: VectorSearchResult[],
    projectTag: string,
    importanceThreshold: number = 0.7,
  ): Promise<number> {
    let synced = 0;

    for (const result of projectResults) {
      const importance = (result.metadata.importance as number) ?? 0.5;
      if (importance < importanceThreshold) continue;

      const content = result.metadata.content as string;
      if (!content) continue;

      try {
        await this.storeGlobal(content, {
          type: (result.metadata.type as MemoryType) || 'semantic',
          projectTag,
          importance,
          tags: (result.metadata.tags as string[]) || [],
          entities: (result.metadata.entities as string[]) || [],
          source: 'project-sync',
        });
        synced++;
      } catch (err) {
        logger.debug({ error: (err as Error).message, id: result.id }, 'Failed to sync memory to global pool');
      }
    }

    if (synced > 0) {
      logger.info({ synced, project: projectTag }, 'Synced memories to global pool');
    }

    return synced;
  }

  /**
   * Get statistics about the global memory pool.
   */
  async getStats(): Promise<{ totalMemories: number; projects: string[] }> {
    const total = await this.store.count();
    const all = await this.store.getAll();
    const projects = new Set<string>();
    for (const vec of all) {
      const proj = vec.metadata?.project as string;
      if (proj) projects.add(proj);
    }
    return { totalMemories: total, projects: [...projects] };
  }

  /**
   * Close the global memory pool.
   */
  async close(): Promise<void> {
    await this.store.close();
  }

  private resultToEntry(result: VectorSearchResult): MemoryEntry | null {
    try {
      return {
        id: result.id,
        type: (result.metadata.type as MemoryType) || 'semantic',
        content: (result.metadata.content as string) || '',
        metadata: {
          source: (result.metadata.source as string) || 'global',
          project: result.metadata.project as string | undefined,
          tags: (result.metadata.tags as string[]) || [],
          entities: (result.metadata.entities as string[]) || [],
          relations: [],
          confidence: 1.0,
        },
        createdAt: new Date((result.metadata.createdAt as string) || Date.now()),
        updatedAt: new Date((result.metadata.createdAt as string) || Date.now()),
        accessedAt: new Date((result.metadata.accessedAt as string) || Date.now()),
        accessCount: (result.metadata.accessCount as number) || 0,
        importance: (result.metadata.importance as number) || 0.5,
        decayFactor: (result.metadata.decayFactor as number) || 1.0,
      };
    } catch {
      return null;
    }
  }

  private calculateRecencyBoost(accessedAt: Date): number {
    const hoursSinceAccess = (Date.now() - accessedAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceAccess < 1) return 1.0;
    if (hoursSinceAccess < 24) return 0.8;
    if (hoursSinceAccess < 168) return 0.5;
    if (hoursSinceAccess < 720) return 0.3;
    return 0.1;
  }
}
