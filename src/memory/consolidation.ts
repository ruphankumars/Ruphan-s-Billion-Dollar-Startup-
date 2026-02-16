/**
 * Memory Consolidation — periodic maintenance for the memory system.
 * Deduplicates similar memories, sweeps decayed entries, computes statistics.
 */

import type {
  MemoryEntry,
  MemoryType,
  MemoryStats,
  MemoryConfig,
  VectorStore,
  EmbeddingEngine,
} from './types.js';
import { cosineSimilarity } from './embeddings.js';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

export interface ConsolidationResult {
  memoriesBefore: number;
  memoriesAfter: number;
  duplicatesRemoved: number;
  decayedRemoved: number;
  relationsCreated: number;
  duration: number;
}

export interface ConsolidationOptions {
  /** Cosine similarity threshold for duplicate detection (default: 0.92) */
  duplicateThreshold?: number;
  /** Minimum importance below which decayed memories are pruned (default: 0.05) */
  decayPruneThreshold?: number;
  /** Maximum memories to scan per consolidation (default: 1000) */
  batchSize?: number;
}

/**
 * MemoryConsolidator runs maintenance on the vector store.
 */
export class MemoryConsolidator {
  private store: VectorStore;
  private embedding: EmbeddingEngine;
  private config: MemoryConfig;
  private options: Required<ConsolidationOptions>;

  constructor(
    store: VectorStore,
    embedding: EmbeddingEngine,
    config: MemoryConfig,
    options: ConsolidationOptions = {},
  ) {
    this.store = store;
    this.embedding = embedding;
    this.config = config;
    this.options = {
      duplicateThreshold: options.duplicateThreshold ?? 0.92,
      decayPruneThreshold: options.decayPruneThreshold ?? 0.05,
      batchSize: options.batchSize ?? 1000,
    };
  }

  /**
   * Run a full consolidation pass.
   */
  async consolidate(): Promise<ConsolidationResult> {
    const startTime = Date.now();
    logger.info('Starting memory consolidation');

    const totalBefore = await this.store.count();

    // 1. Remove decayed memories
    const decayedRemoved = await this.sweepDecayed();

    // 2. Deduplicate similar memories
    const duplicatesRemoved = await this.deduplicateMemories();

    // 3. Discover relations between remaining memories
    const relationsCreated = await this.discoverRelations();

    const totalAfter = await this.store.count();
    const duration = Date.now() - startTime;

    const result: ConsolidationResult = {
      memoriesBefore: totalBefore,
      memoriesAfter: totalAfter,
      duplicatesRemoved,
      decayedRemoved,
      relationsCreated,
      duration,
    };

    logger.info(result, 'Memory consolidation complete');
    return result;
  }

  /**
   * Sweep memories whose decay factor has dropped below threshold.
   */
  private async sweepDecayed(): Promise<number> {
    if (!this.config.decayEnabled) return 0;

    const now = Date.now();
    let removed = 0;

    // Use getAll() if available for a true full scan; otherwise fall back to
    // a zero-vector search which acts as an approximate wildcard but may miss
    // entries that are orthogonal to the zero vector depending on the store impl.
    let allResults: Array<{ id: string; score: number; metadata: Record<string, unknown> }>;
    if ('getAll' in this.store && typeof (this.store as any).getAll === 'function') {
      const raw = await (this.store as any).getAll() as Array<{ id: string; embedding: number[]; metadata: Record<string, unknown> }>;
      allResults = raw.slice(0, this.options.batchSize).map(r => ({ id: r.id, score: 1, metadata: r.metadata }));
    } else {
      // Limitation: zero-vector search may not return all entries in every store impl.
      const dummyVec = new Array(this.embedding.dimensions()).fill(0);
      allResults = await this.store.search(dummyVec, this.options.batchSize);
    }

    for (const result of allResults) {
      const createdAt = result.metadata.createdAt
        ? new Date(result.metadata.createdAt as string).getTime()
        : now;
      const accessedAt = result.metadata.accessedAt
        ? new Date(result.metadata.accessedAt as string).getTime()
        : createdAt;
      const importance = (result.metadata.importance as number) || 0.5;
      const accessCount = (result.metadata.accessCount as number) || 0;

      // Compute decayed importance
      const daysSinceAccess = (now - accessedAt) / (1000 * 60 * 60 * 24);
      const stability = this.config.decayHalfLifeDays * (1 + Math.log(1 + accessCount));
      const retention = Math.exp(-daysSinceAccess / stability);
      const decayedImportance = importance * retention;

      if (decayedImportance < this.options.decayPruneThreshold) {
        await this.store.delete(result.id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug({ removed }, 'Swept decayed memories');
    }

    return removed;
  }

  /**
   * Find and merge duplicate memories (high cosine similarity).
   */
  private async deduplicateMemories(): Promise<number> {
    let removed = 0;
    const processed = new Set<string>();

    // Use getAll() if available; otherwise fall back to zero-vector search
    // (see sweepDecayed() comment for limitations of zero-vector approach).
    let allResults: Array<{ id: string; score: number; metadata: Record<string, unknown> }>;
    if ('getAll' in this.store && typeof (this.store as any).getAll === 'function') {
      const raw = await (this.store as any).getAll() as Array<{ id: string; embedding: number[]; metadata: Record<string, unknown> }>;
      allResults = raw.slice(0, this.options.batchSize).map(r => ({ id: r.id, score: 1, metadata: r.metadata }));
    } else {
      const dummyVec = new Array(this.embedding.dimensions()).fill(0);
      allResults = await this.store.search(dummyVec, this.options.batchSize);
    }

    for (const entry of allResults) {
      if (processed.has(entry.id)) continue;
      processed.add(entry.id);

      const content = (entry.metadata.content as string) || '';
      if (!content) continue;

      // Embed the content and search for near-duplicates
      const embedding = await this.embedding.embed(content);
      const similar = await this.store.search(embedding, 5);

      for (const match of similar) {
        if (match.id === entry.id || processed.has(match.id)) continue;

        if (match.score >= this.options.duplicateThreshold) {
          // Keep the one with higher importance
          const entryImportance = (entry.metadata.importance as number) || 0.5;
          const matchImportance = (match.metadata.importance as number) || 0.5;

          const toRemove = entryImportance >= matchImportance ? match.id : entry.id;
          await this.store.delete(toRemove);
          processed.add(toRemove);
          removed++;

          // If the current entry was the one removed, stop checking its
          // remaining matches — it no longer exists in the store.
          if (toRemove === entry.id) break;
        }
      }
    }

    if (removed > 0) {
      logger.debug({ removed }, 'Removed duplicate memories');
    }

    return removed;
  }

  /**
   * Discover relationships between memories based on entity overlap and similarity.
   * Persists discovered relations as metadata updates when the store supports it.
   * Returns count of new relations discovered.
   */
  private async discoverRelations(): Promise<number> {
    let relationsFound = 0;

    // Use getAll() if available; otherwise fall back to zero-vector search.
    const limit = Math.min(this.options.batchSize, 100);
    let allResults: Array<{ id: string; score: number; metadata: Record<string, unknown> }>;
    if ('getAll' in this.store && typeof (this.store as any).getAll === 'function') {
      const raw = await (this.store as any).getAll() as Array<{ id: string; embedding: number[]; metadata: Record<string, unknown> }>;
      allResults = raw.slice(0, limit).map(r => ({ id: r.id, score: 1, metadata: r.metadata }));
    } else {
      const dummyVec = new Array(this.embedding.dimensions()).fill(0);
      allResults = await this.store.search(dummyVec, limit);
    }

    if (allResults.length < 2) return 0;

    // Build entity → memory map
    const entityMap = new Map<string, string[]>();
    const memoryEntities = new Map<string, Set<string>>();

    for (const result of allResults) {
      const entities = (result.metadata.entities as string[]) || [];
      const entitySet = new Set(entities);
      memoryEntities.set(result.id, entitySet);

      for (const entity of entities) {
        const list = entityMap.get(entity) || [];
        list.push(result.id);
        entityMap.set(entity, list);
      }
    }

    // Discover and persist relations based on shared entities
    const newRelations = new Map<string, Array<{ type: string; targetId: string; strength: number }>>();

    for (const [_entity, memIds] of entityMap) {
      if (memIds.length < 2) continue;

      // Create pairwise relations for memories sharing this entity
      for (let i = 0; i < memIds.length; i++) {
        for (let j = i + 1; j < memIds.length; j++) {
          const idA = memIds[i];
          const idB = memIds[j];

          // Calculate strength: shared entities / union of all entities
          const entitiesA = memoryEntities.get(idA) || new Set();
          const entitiesB = memoryEntities.get(idB) || new Set();
          const shared = [...entitiesA].filter(e => entitiesB.has(e)).length;
          const union = new Set([...entitiesA, ...entitiesB]).size;
          const strength = union > 0 ? shared / union : 0;

          if (strength < 0.1) continue; // Skip very weak relations

          // Add bidirectional relations
          if (!newRelations.has(idA)) newRelations.set(idA, []);
          if (!newRelations.has(idB)) newRelations.set(idB, []);

          newRelations.get(idA)!.push({ type: 'related_to', targetId: idB, strength });
          newRelations.get(idB)!.push({ type: 'related_to', targetId: idA, strength });
          relationsFound++;
        }
      }
    }

    // Persist relations if the store supports updateMetadata
    if ('updateMetadata' in this.store && typeof (this.store as any).updateMetadata === 'function') {
      for (const [memId, relations] of newRelations) {
        try {
          // Deduplicate relations by targetId (keep strongest)
          const deduped = new Map<string, { type: string; targetId: string; strength: number }>();
          for (const rel of relations) {
            const existing = deduped.get(rel.targetId);
            if (!existing || rel.strength > existing.strength) {
              deduped.set(rel.targetId, rel);
            }
          }

          await (this.store as any).updateMetadata(memId, {
            relations: [...deduped.values()],
          });
        } catch (err) {
          logger.debug({ memId, error: (err as Error).message }, 'Failed to persist memory relations');
        }
      }
    }

    if (relationsFound > 0) {
      logger.debug({ relationsFound }, 'Discovered and persisted memory relations');
    }

    return relationsFound;
  }

  /**
   * Compute detailed statistics about the memory store.
   */
  async computeStats(): Promise<MemoryStats & { duplicateEstimate: number }> {
    const totalMemories = await this.store.count();

    const dummyVec = new Array(this.embedding.dimensions()).fill(0);
    const sample = await this.store.search(dummyVec, Math.min(totalMemories, 500));

    const byType: Record<MemoryType, number> = {
      working: 0,
      episodic: 0,
      semantic: 0,
      procedural: 0,
    };

    let importanceSum = 0;
    let oldest: Date | undefined;
    let newest: Date | undefined;
    let duplicateEstimate = 0;

    for (const result of sample) {
      const type = (result.metadata.type as MemoryType) || 'semantic';
      byType[type] = (byType[type] || 0) + 1;

      const importance = (result.metadata.importance as number) || 0.5;
      importanceSum += importance;

      const createdAt = result.metadata.createdAt
        ? new Date(result.metadata.createdAt as string)
        : undefined;
      if (createdAt) {
        if (!oldest || createdAt < oldest) oldest = createdAt;
        if (!newest || createdAt > newest) newest = createdAt;
      }
    }

    // Estimate duplicates from sample
    if (sample.length > 1) {
      const checked = new Set<string>();
      for (let i = 0; i < Math.min(sample.length, 20); i++) {
        const content = (sample[i].metadata.content as string) || '';
        if (!content || checked.has(sample[i].id)) continue;
        checked.add(sample[i].id);

        const emb = await this.embedding.embed(content);
        const matches = await this.store.search(emb, 3);
        for (const m of matches) {
          if (m.id !== sample[i].id && m.score >= this.options.duplicateThreshold) {
            duplicateEstimate++;
          }
        }
      }
    }

    return {
      totalMemories,
      byType,
      averageImportance: sample.length > 0 ? importanceSum / sample.length : 0,
      oldestMemory: oldest,
      newestMemory: newest,
      storageSize: 0, // Would need fs.stat on db file for real size
      duplicateEstimate,
    };
  }
}
