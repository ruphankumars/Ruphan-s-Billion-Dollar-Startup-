/**
 * ContextManager — The Memory Management Unit (MMU) of CortexOS
 *
 * Manages short-term memory (STM) and long-term memory (LTM) with:
 * - Q-value based eviction (MemRL pattern)
 * - Slime mold garbage collection (Focus pattern)
 * - Semantic indexing (SimpleMem pattern)
 * - STM ↔ LTM promotion/demotion
 * - Knowledge block compression
 *
 * Every memory operation in CortexOS flows through this manager.
 *
 * Research Foundations:
 * - MemRL (2025): Q-value based memory management
 * - Focus (2025): Slime mold GC / context compression
 * - SimpleMem (2025): Memory indexing for efficient retrieval
 * - Voyager (2023): Persistent skill library pattern
 *
 * Zero external dependencies. Node.js built-ins only.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { BoundedMap } from '../utils/bounded-map.js';
import type {
  ContextManagerConfig,
  MemoryEntry,
  KnowledgeBlock,
  SemanticIndex,
  ContextManagerStats,
} from './types.js';

const DEFAULT_CONFIG: Required<ContextManagerConfig> = {
  stmCapacity: 100,
  ltmCapacity: 1000,
  qLearningRate: 0.1,
  qDiscountFactor: 0.95,
  autoCompressThreshold: 0.8,
  promotionQThreshold: 0.7,
  enableSemanticIndex: true,
};

export class ContextManager extends EventEmitter {
  private config: Required<ContextManagerConfig>;
  private running = false;

  // Primary stores
  private stm: Map<string, MemoryEntry> = new Map();
  private ltm: Map<string, MemoryEntry> = new Map();

  // Secondary indices
  private keyIndex: Map<string, string> = new Map(); // key → memoryId
  private tagIndex: Map<string, Set<string>> = new Map(); // tag → Set<memoryId>
  private semanticIndex: Map<string, SemanticIndex> = new Map(); // entryId → index

  // Knowledge blocks from compression
  private knowledgeBlocks = new BoundedMap<string, KnowledgeBlock>(200);

  // Metrics
  private totalStored = 0;
  private totalRetrieved = 0;
  private totalEvicted = 0;
  private totalCompressed = 0;

  constructor(config?: Partial<ContextManagerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.running = true;
    this.emit('kernel:context:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('kernel:context:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Store a memory entry. Defaults to STM.
   * Auto-evicts lowest Q-value entries when at capacity.
   */
  store(
    key: string,
    value: unknown,
    options?: {
      scope?: 'stm' | 'ltm';
      tags?: string[];
      importance?: number;
    }
  ): MemoryEntry {
    const scope = options?.scope ?? 'stm';
    const store = scope === 'stm' ? this.stm : this.ltm;
    const capacity = scope === 'stm' ? this.config.stmCapacity : this.config.ltmCapacity;

    // Check if key already exists — update instead
    const existingId = this.keyIndex.get(`${scope}:${key}`);
    if (existingId && store.has(existingId)) {
      return this.updateExisting(existingId, value, store, options?.tags, options?.importance);
    }

    // Evict if at capacity
    if (store.size >= capacity) {
      this.evictLowestQ(store, scope);
    }

    const entry: MemoryEntry = {
      id: `mem_${randomUUID().slice(0, 8)}`,
      key,
      value,
      scope,
      qValue: options?.importance ?? 0.5,
      accessCount: 0,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      tags: options?.tags ?? [],
      importance: options?.importance ?? 0.5,
    };

    store.set(entry.id, entry);
    this.keyIndex.set(`${scope}:${key}`, entry.id);
    this.totalStored++;

    // Update tag index
    for (const tag of entry.tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(entry.id);
    }

    // Update semantic index
    if (this.config.enableSemanticIndex) {
      this.indexEntry(entry);
    }

    this.emit('kernel:context:stored', {
      memoryId: entry.id,
      key,
      scope,
      qValue: entry.qValue,
      timestamp: Date.now(),
    });

    return entry;
  }

  /**
   * Retrieve memories matching a query.
   * Uses composite scoring: Q-value (40%) + keyword match (30%) + recency (20%) + frequency (10%)
   */
  retrieve(
    query: string,
    options?: {
      scope?: 'stm' | 'ltm' | 'all';
      topK?: number;
      minScore?: number;
      tags?: string[];
    }
  ): MemoryEntry[] {
    const scope = options?.scope ?? 'all';
    const topK = options?.topK ?? 10;
    const minScore = options?.minScore ?? 0.0;

    // Gather candidates from specified scope(s)
    let candidates: MemoryEntry[] = [];

    if (scope === 'stm' || scope === 'all') {
      candidates.push(...this.stm.values());
    }
    if (scope === 'ltm' || scope === 'all') {
      candidates.push(...this.ltm.values());
    }

    // Filter by tags if specified
    if (options?.tags && options.tags.length > 0) {
      const tagMatching = new Set<string>();
      for (const tag of options.tags) {
        const ids = this.tagIndex.get(tag);
        if (ids) {
          for (const id of ids) tagMatching.add(id);
        }
      }
      candidates = candidates.filter(c => tagMatching.has(c.id));
    }

    // Score and rank
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const now = Date.now();

    const scored = candidates.map(entry => {
      // Keyword match score
      const entryText = `${entry.key} ${String(entry.value)} ${entry.tags.join(' ')}`.toLowerCase();
      const matchCount = queryWords.filter(w => entryText.includes(w)).length;
      const keywordScore = queryWords.length > 0 ? matchCount / queryWords.length : 0;

      // Recency score (decay over 24h)
      const ageMs = now - entry.lastAccessedAt;
      const recencyScore = 1 / (1 + ageMs / (24 * 3600 * 1000));

      // Frequency score (log-normalized)
      const frequencyScore = Math.log2(entry.accessCount + 1) / 10;

      // Q-value score (normalized 0-1)
      const qScore = Math.max(0, Math.min(1, entry.qValue));

      // Composite score
      const score = qScore * 0.4 + keywordScore * 0.3 + recencyScore * 0.2 + frequencyScore * 0.1;

      return { entry, score };
    });

    const results = scored
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => {
        // Update access metrics
        s.entry.accessCount++;
        s.entry.lastAccessedAt = now;
        return s.entry;
      });

    this.totalRetrieved += results.length;

    this.emit('kernel:context:retrieved', {
      query,
      resultCount: results.length,
      scope,
      timestamp: now,
    });

    return results;
  }

  /**
   * Update the value of an existing memory entry.
   */
  update(memoryId: string, value: unknown): boolean {
    const entry = this.stm.get(memoryId) ?? this.ltm.get(memoryId);
    if (!entry) return false;

    entry.value = value;
    entry.lastAccessedAt = Date.now();
    entry.accessCount++;

    return true;
  }

  /**
   * Discard a memory entry.
   */
  discard(memoryId: string): boolean {
    let entry = this.stm.get(memoryId);
    let store = this.stm;

    if (!entry) {
      entry = this.ltm.get(memoryId);
      store = this.ltm;
    }

    if (!entry) return false;

    // Clean up indices
    this.keyIndex.delete(`${entry.scope}:${entry.key}`);
    for (const tag of entry.tags) {
      const tagSet = this.tagIndex.get(tag);
      if (tagSet) {
        tagSet.delete(memoryId);
        if (tagSet.size === 0) this.tagIndex.delete(tag);
      }
    }
    this.semanticIndex.delete(memoryId);

    store.delete(memoryId);
    return true;
  }

  /**
   * Compress STM by consolidating low-Q-value entries into knowledge blocks.
   * Inspired by the "slime mold" GC pattern from Focus (2025).
   */
  compress(): KnowledgeBlock | null {
    const entries = [...this.stm.values()]
      .sort((a, b) => a.qValue - b.qValue);

    // Take bottom 30% of entries by Q-value
    const compressCount = Math.max(1, Math.floor(entries.length * 0.3));
    const toCompress = entries.slice(0, compressCount);

    if (toCompress.length < 2) return null;

    // Build summary from compressed entries
    const summaryParts = toCompress.map(e =>
      `[${e.key}]: ${typeof e.value === 'string' ? e.value.slice(0, 100) : JSON.stringify(e.value).slice(0, 100)}`
    );

    const block: KnowledgeBlock = {
      id: `kb_${randomUUID().slice(0, 8)}`,
      summary: summaryParts.join(' | '),
      sourceIds: toCompress.map(e => e.id),
      createdAt: Date.now(),
      compressionRatio: toCompress.length,
    };

    // Remove compressed entries from STM
    for (const entry of toCompress) {
      this.keyIndex.delete(`stm:${entry.key}`);
      for (const tag of entry.tags) {
        const tagSet = this.tagIndex.get(tag);
        if (tagSet) {
          tagSet.delete(entry.id);
          if (tagSet.size === 0) this.tagIndex.delete(tag);
        }
      }
      this.semanticIndex.delete(entry.id);
      this.stm.delete(entry.id);
    }

    this.knowledgeBlocks.set(block.id, block);
    this.totalCompressed += toCompress.length;

    this.emit('kernel:context:compressed', {
      blockId: block.id,
      entriesCompressed: toCompress.length,
      timestamp: Date.now(),
    });

    return block;
  }

  /**
   * Update the Q-value of a memory entry (MemRL pattern).
   * Q(s,a) = Q(s,a) + α * (r + γ * max Q(s',a') - Q(s,a))
   */
  updateQValue(memoryId: string, reward: number): void {
    const entry = this.stm.get(memoryId) ?? this.ltm.get(memoryId);
    if (!entry) return;

    const lr = this.config.qLearningRate;
    const gamma = this.config.qDiscountFactor;

    // Q-update: Q = (1-α)Q + α(r + γ * max Q(other entries))
    // Find max Q among all OTHER entries (STM + LTM)
    const allEntries = [...this.stm.values(), ...this.ltm.values()];
    const otherMax = allEntries
      .filter(e => e.id !== entry.id)
      .reduce((max, e) => Math.max(max, e.qValue ?? 0), 0);
    entry.qValue = (1 - lr) * entry.qValue + lr * (reward + gamma * otherMax);

    // Clamp to [0, 1]
    entry.qValue = Math.max(0, Math.min(1, entry.qValue));

    // Auto-promote to LTM if Q-value exceeds threshold
    if (entry.scope === 'stm' && entry.qValue >= this.config.promotionQThreshold) {
      this.promote(memoryId);
    }
  }

  /**
   * Batch update Q-values for multiple memories.
   */
  batchUpdateQValues(memoryIds: string[], reward: number): void {
    for (const id of memoryIds) {
      this.updateQValue(id, reward);
    }
  }

  /**
   * Search the semantic index.
   */
  searchIndex(query: string, topK: number = 5): SemanticIndex[] {
    if (!this.config.enableSemanticIndex) return [];

    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);

    return [...this.semanticIndex.values()]
      .map(idx => {
        const matchCount = queryWords.filter(w =>
          idx.keywords.some(k => k.includes(w) || w.includes(k))
        ).length;
        return { ...idx, score: queryWords.length > 0 ? matchCount / queryWords.length : 0 };
      })
      .filter(idx => idx.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Promote a memory from STM to LTM.
   */
  promote(memoryId: string): boolean {
    const entry = this.stm.get(memoryId);
    if (!entry) return false;

    // Evict from LTM if at capacity
    if (this.ltm.size >= this.config.ltmCapacity) {
      this.evictLowestQ(this.ltm, 'ltm');
    }

    // Move to LTM
    this.stm.delete(memoryId);
    this.keyIndex.delete(`stm:${entry.key}`);

    entry.scope = 'ltm';
    this.ltm.set(memoryId, entry);
    this.keyIndex.set(`ltm:${entry.key}`, memoryId);

    this.emit('kernel:context:promoted', {
      memoryId,
      key: entry.key,
      qValue: entry.qValue,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * Demote a memory from LTM to STM.
   */
  demote(memoryId: string): boolean {
    const entry = this.ltm.get(memoryId);
    if (!entry) return false;

    // Evict from STM if at capacity
    if (this.stm.size >= this.config.stmCapacity) {
      this.evictLowestQ(this.stm, 'stm');
    }

    // Move to STM
    this.ltm.delete(memoryId);
    this.keyIndex.delete(`ltm:${entry.key}`);

    entry.scope = 'stm';
    this.stm.set(memoryId, entry);
    this.keyIndex.set(`stm:${entry.key}`, memoryId);

    this.emit('kernel:context:demoted', {
      memoryId,
      key: entry.key,
      qValue: entry.qValue,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * Get a memory by key and scope.
   */
  getByKey(key: string, scope?: 'stm' | 'ltm'): MemoryEntry | undefined {
    if (scope) {
      const id = this.keyIndex.get(`${scope}:${key}`);
      if (!id) return undefined;
      return scope === 'stm' ? this.stm.get(id) : this.ltm.get(id);
    }

    // Search both scopes
    const stmId = this.keyIndex.get(`stm:${key}`);
    if (stmId) return this.stm.get(stmId);

    const ltmId = this.keyIndex.get(`ltm:${key}`);
    if (ltmId) return this.ltm.get(ltmId);

    return undefined;
  }

  /**
   * Get a memory by ID.
   */
  getById(memoryId: string): MemoryEntry | undefined {
    return this.stm.get(memoryId) ?? this.ltm.get(memoryId);
  }

  /**
   * Export all LTM entries for persistence.
   */
  exportLTM(): MemoryEntry[] {
    return [...this.ltm.values()];
  }

  /**
   * Import LTM entries from persistence.
   */
  importLTM(entries: MemoryEntry[]): number {
    let imported = 0;
    for (const entry of entries) {
      if (!this.ltm.has(entry.id) && this.ltm.size < this.config.ltmCapacity) {
        const restored: MemoryEntry = { ...entry, scope: 'ltm' };
        this.ltm.set(restored.id, restored);
        this.keyIndex.set(`ltm:${restored.key}`, restored.id);

        for (const tag of restored.tags) {
          if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
          this.tagIndex.get(tag)!.add(restored.id);
        }

        if (this.config.enableSemanticIndex) {
          this.indexEntry(restored);
        }

        imported++;
      }
    }
    return imported;
  }

  /**
   * Clear all memories in specified scope.
   */
  clear(scope?: 'stm' | 'ltm' | 'all'): void {
    const clearScope = scope ?? 'all';

    if (clearScope === 'stm' || clearScope === 'all') {
      for (const entry of this.stm.values()) {
        this.keyIndex.delete(`stm:${entry.key}`);
        for (const tag of entry.tags) {
          const tagSet = this.tagIndex.get(tag);
          if (tagSet) {
            tagSet.delete(entry.id);
            if (tagSet.size === 0) this.tagIndex.delete(tag);
          }
        }
        this.semanticIndex.delete(entry.id);
      }
      this.stm.clear();
    }

    if (clearScope === 'ltm' || clearScope === 'all') {
      for (const entry of this.ltm.values()) {
        this.keyIndex.delete(`ltm:${entry.key}`);
        for (const tag of entry.tags) {
          const tagSet = this.tagIndex.get(tag);
          if (tagSet) {
            tagSet.delete(entry.id);
            if (tagSet.size === 0) this.tagIndex.delete(tag);
          }
        }
        this.semanticIndex.delete(entry.id);
      }
      this.ltm.clear();
    }

    if (clearScope === 'all') {
      this.knowledgeBlocks.clear();
    }
  }

  /**
   * Get knowledge blocks from compression.
   */
  getKnowledgeBlocks(): KnowledgeBlock[] {
    return [...this.knowledgeBlocks.values()];
  }

  /**
   * Get comprehensive statistics.
   */
  getStats(): ContextManagerStats {
    const allEntries = [...this.stm.values(), ...this.ltm.values()];
    const avgQ = allEntries.length > 0
      ? allEntries.reduce((sum, e) => sum + e.qValue, 0) / allEntries.length
      : 0;

    return {
      running: this.running,
      stmSize: this.stm.size,
      stmCapacity: this.config.stmCapacity,
      ltmSize: this.ltm.size,
      ltmCapacity: this.config.ltmCapacity,
      totalStored: this.totalStored,
      totalRetrieved: this.totalRetrieved,
      totalEvicted: this.totalEvicted,
      totalCompressed: this.totalCompressed,
      avgQValue: avgQ,
      knowledgeBlocks: this.knowledgeBlocks.size,
      indexSize: this.semanticIndex.size,
      config: { ...this.config },
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private updateExisting(
    memoryId: string,
    value: unknown,
    store: Map<string, MemoryEntry>,
    tags?: string[],
    importance?: number
  ): MemoryEntry {
    const entry = store.get(memoryId)!;
    entry.value = value;
    entry.lastAccessedAt = Date.now();
    entry.accessCount++;

    // Update importance if provided
    if (importance !== undefined) {
      entry.importance = importance;
      entry.qValue = importance;
    }

    // Update tags if provided
    if (tags !== undefined) {
      // Remove old tag index entries
      for (const oldTag of entry.tags) {
        const tagSet = this.tagIndex.get(oldTag);
        if (tagSet) {
          tagSet.delete(memoryId);
          if (tagSet.size === 0) this.tagIndex.delete(oldTag);
        }
      }
      // Set new tags and update index
      entry.tags = tags;
      for (const tag of tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(memoryId);
      }
    }

    return entry;
  }

  private evictLowestQ(store: Map<string, MemoryEntry>, scope: string): void {
    let lowestId: string | null = null;
    let lowestQ = Infinity;

    for (const [id, entry] of store) {
      if (entry.qValue < lowestQ) {
        lowestQ = entry.qValue;
        lowestId = id;
      }
    }

    if (lowestId) {
      const entry = store.get(lowestId)!;
      this.keyIndex.delete(`${scope}:${entry.key}`);
      for (const tag of entry.tags) {
        const tagSet = this.tagIndex.get(tag);
        if (tagSet) {
          tagSet.delete(lowestId);
          if (tagSet.size === 0) this.tagIndex.delete(tag);
        }
      }
      this.semanticIndex.delete(lowestId);
      store.delete(lowestId);
      this.totalEvicted++;

      this.emit('kernel:context:evicted', {
        memoryId: lowestId,
        key: entry.key,
        qValue: entry.qValue,
        scope,
        timestamp: Date.now(),
      });
    }
  }

  private indexEntry(entry: MemoryEntry): void {
    // Extract keywords from key, value (if string), and tags
    const text = [
      entry.key,
      typeof entry.value === 'string' ? entry.value : '',
      ...entry.tags,
    ].join(' ').toLowerCase();

    const words = text.split(/\s+/).filter(w => w.length > 2);
    const keywords = [...new Set(words)].slice(0, 20);

    this.semanticIndex.set(entry.id, {
      entryId: entry.id,
      keywords,
      score: entry.qValue,
    });
  }
}
