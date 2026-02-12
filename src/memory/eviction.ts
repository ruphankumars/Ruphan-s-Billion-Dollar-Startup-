/**
 * Memory Eviction — LRU eviction, storage pressure handling,
 * and memory compaction for the persistent memory system.
 *
 * Policies:
 * - LRU (Least Recently Used): evict by access time
 * - Importance: evict lowest importance first
 * - Hybrid: weighted combination of LRU + importance
 * - Size-based: evict when storage exceeds threshold
 */

import type { VectorStore } from './types.js';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

export type EvictionPolicy = 'lru' | 'importance' | 'hybrid' | 'size';

export interface EvictionConfig {
  /** Maximum number of memories before eviction triggers */
  maxMemories: number;
  /** Eviction policy */
  policy: EvictionPolicy;
  /** How many memories to evict when threshold is reached (default: 10% of max) */
  evictBatchSize?: number;
  /** Minimum importance to protect from eviction (default: 0.9) */
  protectedImportanceThreshold?: number;
  /** Maximum storage size in bytes before eviction (default: 100MB) */
  maxStorageBytes?: number;
  /** Weight for LRU factor in hybrid mode (0-1, default: 0.6) */
  lruWeight?: number;
}

export interface EvictionResult {
  evicted: number;
  reason: string;
  policy: EvictionPolicy;
  memoriesBefore: number;
  memoriesAfter: number;
  duration: number;
}

interface MemoryCandidate {
  id: string;
  importance: number;
  accessedAt: number;
  accessCount: number;
  decayFactor: number;
  score: number; // Lower = more likely to evict
}

/**
 * MemoryEvictor manages memory cleanup when storage pressure occurs.
 */
export class MemoryEvictor {
  private config: EvictionConfig;

  constructor(config: EvictionConfig) {
    this.config = config;
  }

  /**
   * Check if eviction is needed and perform it
   */
  async evictIfNeeded(store: VectorStore): Promise<EvictionResult | null> {
    const count = await store.count();

    if (count <= this.config.maxMemories) {
      return null; // No eviction needed
    }

    return this.evict(store, `Memory count (${count}) exceeds max (${this.config.maxMemories})`);
  }

  /**
   * Check storage size and evict if needed
   */
  async evictByStorageSize(store: VectorStore): Promise<EvictionResult | null> {
    const maxBytes = this.config.maxStorageBytes ?? 100 * 1024 * 1024; // 100MB

    if (typeof store.getStorageSize !== 'function') return null;

    const size = await store.getStorageSize();
    if (size <= maxBytes) return null;

    return this.evict(store, `Storage size (${formatBytes(size)}) exceeds max (${formatBytes(maxBytes)})`);
  }

  /**
   * Force eviction of the specified number of memories
   */
  async evict(store: VectorStore, reason: string): Promise<EvictionResult> {
    const startTime = Date.now();
    const memoriesBefore = await store.count();

    const batchSize = this.config.evictBatchSize ?? Math.max(1, Math.floor(this.config.maxMemories * 0.1));
    const protectedThreshold = this.config.protectedImportanceThreshold ?? 0.9;

    // Get all memories
    const getAll = store.getAll;
    if (!getAll) {
      return {
        evicted: 0,
        reason: 'Store does not support getAll()',
        policy: this.config.policy,
        memoriesBefore,
        memoriesAfter: memoriesBefore,
        duration: Date.now() - startTime,
      };
    }

    const allMemories = await getAll.call(store);

    // Score each memory
    const candidates: MemoryCandidate[] = allMemories.map(m => {
      const metadata = m.metadata;
      const importance = (metadata.importance as number) ?? 0.5;
      const accessedAt = metadata.accessedAt ? new Date(metadata.accessedAt as string).getTime() : 0;
      const accessCount = (metadata.accessCount as number) ?? 0;
      const decayFactor = (metadata.decayFactor as number) ?? 1.0;

      return {
        id: m.id,
        importance,
        accessedAt,
        accessCount,
        decayFactor,
        score: this.calculateEvictionScore(importance, accessedAt, accessCount, decayFactor),
      };
    });

    // Filter out protected memories
    const evictable = candidates.filter(c => c.importance < protectedThreshold);

    // Sort by score (lowest score = evict first)
    evictable.sort((a, b) => a.score - b.score);

    // Evict up to batchSize
    const toEvict = evictable.slice(0, batchSize);

    for (const candidate of toEvict) {
      try {
        await store.delete(candidate.id);
      } catch (err) {
        logger.warn({ id: candidate.id, error: (err as Error).message }, 'Failed to evict memory');
      }
    }

    const memoriesAfter = await store.count();
    const duration = Date.now() - startTime;

    logger.info(
      { evicted: toEvict.length, reason, policy: this.config.policy, duration },
      'Memory eviction complete',
    );

    return {
      evicted: toEvict.length,
      reason,
      policy: this.config.policy,
      memoriesBefore,
      memoriesAfter,
      duration,
    };
  }

  /**
   * Calculate eviction score based on policy.
   * Lower score = more likely to be evicted.
   */
  private calculateEvictionScore(
    importance: number,
    accessedAt: number,
    accessCount: number,
    decayFactor: number,
  ): number {
    const now = Date.now();
    const hoursSinceAccess = Math.max(0, (now - accessedAt) / (1000 * 60 * 60));

    switch (this.config.policy) {
      case 'lru': {
        // Pure LRU: more recently accessed = higher score (keep)
        return 1 / (1 + hoursSinceAccess);
      }

      case 'importance': {
        // Pure importance: higher importance = higher score (keep)
        return importance * decayFactor;
      }

      case 'hybrid': {
        // Weighted combination
        const lruWeight = this.config.lruWeight ?? 0.6;
        const importanceWeight = 1 - lruWeight;

        const recencyScore = 1 / (1 + hoursSinceAccess);
        const importanceScore = importance * decayFactor;
        const accessScore = Math.min(1, accessCount / 20); // Normalize

        return (recencyScore * lruWeight) + (importanceScore * importanceWeight) + (accessScore * 0.1);
      }

      case 'size': {
        // For size-based, prefer evicting older, less important items
        const ageScore = 1 / (1 + hoursSinceAccess);
        return importance * 0.5 + ageScore * 0.5;
      }

      default:
        return importance;
    }
  }

  /**
   * Get the current eviction configuration
   */
  getConfig(): EvictionConfig {
    return { ...this.config };
  }

  /**
   * Update eviction configuration
   */
  updateConfig(updates: Partial<EvictionConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
