import { describe, it, expect, vi } from 'vitest';
import { MemoryConsolidator } from '../../../src/memory/consolidation.js';
import type { MemoryConfig, VectorStore, EmbeddingEngine } from '../../../src/memory/types.js';

function createMockStore(entries: Array<{ id: string; metadata: Record<string, unknown>; score: number }> = []): VectorStore {
  return {
    add: vi.fn(),
    search: vi.fn().mockResolvedValue(entries),
    delete: vi.fn(),
    count: vi.fn().mockResolvedValue(entries.length),
    close: vi.fn(),
    clear: vi.fn(),
  };
}

function createMockEmbedding(): EmbeddingEngine {
  return {
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
    embedBatch: vi.fn().mockResolvedValue([]),
    dimensions: vi.fn().mockReturnValue(384),
  };
}

function createConfig(): MemoryConfig {
  return {
    enabled: true,
    globalDir: '~/.cortexos',
    projectDir: '/tmp/test',
    maxMemories: 10000,
    embeddingModel: 'local-tfidf',
    decayEnabled: true,
    decayHalfLifeDays: 30,
    minImportanceThreshold: 0.1,
    consolidationInterval: 24,
  };
}

describe('MemoryConsolidator', () => {
  it('should return consolidation result with correct structure', async () => {
    const store = createMockStore();
    const embedding = createMockEmbedding();
    const consolidator = new MemoryConsolidator(store, embedding, createConfig());

    const result = await consolidator.consolidate();

    expect(result).toHaveProperty('memoriesBefore');
    expect(result).toHaveProperty('memoriesAfter');
    expect(result).toHaveProperty('duplicatesRemoved');
    expect(result).toHaveProperty('decayedRemoved');
    expect(result).toHaveProperty('relationsCreated');
    expect(result).toHaveProperty('duration');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty store', async () => {
    const store = createMockStore([]);
    const embedding = createMockEmbedding();
    const consolidator = new MemoryConsolidator(store, embedding, createConfig());

    const result = await consolidator.consolidate();

    expect(result.memoriesBefore).toBe(0);
    expect(result.duplicatesRemoved).toBe(0);
    expect(result.decayedRemoved).toBe(0);
  });

  it('should sweep decayed memories', async () => {
    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year old
    const entries = [
      {
        id: 'mem-1',
        score: 0.5,
        metadata: {
          content: 'Old memory',
          importance: 0.1,
          createdAt: oldDate,
          accessedAt: oldDate,
          accessCount: 0,
        },
      },
    ];
    const store = createMockStore(entries);
    const embedding = createMockEmbedding();
    const consolidator = new MemoryConsolidator(store, embedding, createConfig());

    const result = await consolidator.consolidate();

    expect(result.decayedRemoved).toBe(1);
    expect(store.delete).toHaveBeenCalledWith('mem-1');
  });

  it('should not sweep decayed when decay is disabled', async () => {
    const config = createConfig();
    config.decayEnabled = false;

    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const entries = [
      {
        id: 'mem-1',
        score: 0.5,
        metadata: {
          content: 'Old memory',
          importance: 0.1,
          createdAt: oldDate,
          accessedAt: oldDate,
          accessCount: 0,
        },
      },
    ];
    const store = createMockStore(entries);
    const embedding = createMockEmbedding();
    const consolidator = new MemoryConsolidator(store, embedding, config);

    const result = await consolidator.consolidate();

    expect(result.decayedRemoved).toBe(0);
  });

  it('should keep recently accessed memories even if old', async () => {
    const recentDate = new Date().toISOString();
    const entries = [
      {
        id: 'mem-1',
        score: 0.5,
        metadata: {
          content: 'Frequently accessed',
          importance: 0.8,
          createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
          accessedAt: recentDate,
          accessCount: 50,
        },
      },
    ];
    const store = createMockStore(entries);
    const embedding = createMockEmbedding();
    const consolidator = new MemoryConsolidator(store, embedding, createConfig());

    const result = await consolidator.consolidate();

    // Should NOT be deleted — high importance, frequent access, recent access
    expect(result.decayedRemoved).toBe(0);
  });

  it('should detect and remove duplicates', async () => {
    const entries = [
      {
        id: 'mem-1',
        score: 0.5,
        metadata: { content: 'Some memory', importance: 0.6, createdAt: new Date().toISOString(), accessedAt: new Date().toISOString(), accessCount: 0 },
      },
      {
        id: 'mem-2',
        score: 0.95, // very similar
        metadata: { content: 'Some memory (dup)', importance: 0.5, createdAt: new Date().toISOString(), accessedAt: new Date().toISOString(), accessCount: 0 },
      },
    ];

    // search() for initial scan returns all, then for duplicate search returns same set
    const store = createMockStore(entries);
    (store.search as any).mockResolvedValue(entries);

    const embedding = createMockEmbedding();
    const consolidator = new MemoryConsolidator(store, embedding, createConfig());

    const result = await consolidator.consolidate();

    // Should remove the duplicate with lower importance
    expect(result.duplicatesRemoved).toBe(1);
    expect(store.delete).toHaveBeenCalledWith('mem-2');
  });

  it('should discover relations from shared entities', async () => {
    const entries = [
      {
        id: 'mem-1',
        score: 0.5,
        metadata: {
          content: 'Auth module',
          entities: ['auth', 'jwt'],
          importance: 0.8,
          createdAt: new Date().toISOString(),
          accessedAt: new Date().toISOString(),
          accessCount: 0,
        },
      },
      {
        id: 'mem-2',
        score: 0.3,
        metadata: {
          content: 'JWT tokens',
          entities: ['jwt', 'token'],
          importance: 0.7,
          createdAt: new Date().toISOString(),
          accessedAt: new Date().toISOString(),
          accessCount: 0,
        },
      },
    ];

    const store = createMockStore(entries);
    const embedding = createMockEmbedding();
    const consolidator = new MemoryConsolidator(store, embedding, createConfig());

    const result = await consolidator.consolidate();

    // 'jwt' is shared between mem-1 and mem-2 → 1 relation
    expect(result.relationsCreated).toBeGreaterThanOrEqual(1);
  });

  it('should compute stats with correct structure', async () => {
    const entries = [
      {
        id: 'mem-1',
        score: 0.5,
        metadata: {
          type: 'semantic',
          importance: 0.8,
          content: 'Test memory',
          createdAt: new Date().toISOString(),
        },
      },
      {
        id: 'mem-2',
        score: 0.3,
        metadata: {
          type: 'episodic',
          importance: 0.6,
          content: 'Another memory',
          createdAt: new Date(Date.now() - 86400000).toISOString(),
        },
      },
    ];

    const store = createMockStore(entries);
    const embedding = createMockEmbedding();
    const consolidator = new MemoryConsolidator(store, embedding, createConfig());

    const stats = await consolidator.computeStats();

    expect(stats.totalMemories).toBe(2);
    expect(stats.byType.semantic).toBe(1);
    expect(stats.byType.episodic).toBe(1);
    expect(stats.averageImportance).toBe(0.7);
    expect(stats.oldestMemory).toBeDefined();
    expect(stats.newestMemory).toBeDefined();
    expect(stats).toHaveProperty('duplicateEstimate');
  });

  it('should respect custom consolidation options', async () => {
    const store = createMockStore([]);
    const embedding = createMockEmbedding();
    const consolidator = new MemoryConsolidator(store, embedding, createConfig(), {
      duplicateThreshold: 0.99,
      decayPruneThreshold: 0.01,
      batchSize: 50,
    });

    const result = await consolidator.consolidate();
    expect(result).toBeDefined();

    // verify batchSize was used in search call
    expect(store.search).toHaveBeenCalledWith(expect.any(Array), 50);
  });
});
