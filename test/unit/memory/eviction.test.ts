import { describe, it, expect, vi } from 'vitest';
import { MemoryEvictor } from '../../../src/memory/eviction.js';

function createMockStore(memories: any[] = []) {
  const data = new Map(memories.map(m => [m.id, m]));
  return {
    count: vi.fn(async () => data.size),
    delete: vi.fn(async (id: string) => { data.delete(id); }),
    getAll: vi.fn(async () => [...data.values()].map(m => ({
      id: m.id,
      embedding: m.embedding || [],
      metadata: m.metadata,
    }))),
    getStorageSize: vi.fn(async () => 1024 * 1024), // 1MB
    search: vi.fn(async () => []),
    add: vi.fn(async () => {}),
    clear: vi.fn(async () => data.clear()),
    close: vi.fn(async () => {}),
  };
}

function createMemory(id: string, importance: number, hoursAgo: number, accessCount = 1) {
  const accessedAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  return {
    id,
    embedding: [],
    metadata: {
      importance,
      accessedAt,
      accessCount,
      decayFactor: 1.0,
      type: 'semantic',
      content: `Memory ${id}`,
    },
  };
}

describe('MemoryEvictor', () => {
  it('should not evict when under limit', async () => {
    const store = createMockStore([
      createMemory('m1', 0.5, 24),
      createMemory('m2', 0.5, 48),
    ]);

    const evictor = new MemoryEvictor({
      maxMemories: 10,
      policy: 'lru',
    });

    const result = await evictor.evictIfNeeded(store as any);
    expect(result).toBeNull();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('should evict LRU memories when over limit', async () => {
    const memories = [
      createMemory('old', 0.5, 720), // 30 days ago
      createMemory('medium', 0.5, 48), // 2 days ago
      createMemory('recent', 0.5, 1), // 1 hour ago
    ];
    const store = createMockStore(memories);

    const evictor = new MemoryEvictor({
      maxMemories: 2,
      policy: 'lru',
      evictBatchSize: 1,
    });

    const result = await evictor.evictIfNeeded(store as any);
    expect(result).not.toBeNull();
    expect(result!.evicted).toBe(1);
    // Should evict 'old' (least recently accessed)
    expect(store.delete).toHaveBeenCalledWith('old');
  });

  it('should evict by importance', async () => {
    const memories = [
      createMemory('low', 0.1, 1),
      createMemory('mid', 0.5, 1),
      createMemory('high', 0.8, 1),
    ];
    const store = createMockStore(memories);

    const evictor = new MemoryEvictor({
      maxMemories: 2,
      policy: 'importance',
      evictBatchSize: 1,
    });

    const result = await evictor.evictIfNeeded(store as any);
    expect(result).not.toBeNull();
    expect(store.delete).toHaveBeenCalledWith('low');
  });

  it('should protect high-importance memories from eviction', async () => {
    const memories = [
      createMemory('protected', 0.95, 720), // Old but very important
      createMemory('expendable', 0.3, 1),  // Recent but unimportant
    ];
    const store = createMockStore(memories);

    const evictor = new MemoryEvictor({
      maxMemories: 1,
      policy: 'lru',
      evictBatchSize: 1,
      protectedImportanceThreshold: 0.9,
    });

    const result = await evictor.evictIfNeeded(store as any);
    expect(result).not.toBeNull();
    // Should evict 'expendable' not 'protected'
    expect(store.delete).toHaveBeenCalledWith('expendable');
  });

  it('should use hybrid policy', async () => {
    const memories = [
      createMemory('old-low', 0.2, 720),
      createMemory('recent-low', 0.2, 1),
      createMemory('old-high', 0.8, 720),
      createMemory('recent-high', 0.8, 1),
    ];
    const store = createMockStore(memories);

    const evictor = new MemoryEvictor({
      maxMemories: 3,
      policy: 'hybrid',
      evictBatchSize: 1,
      lruWeight: 0.6,
    });

    const result = await evictor.evictIfNeeded(store as any);
    expect(result).not.toBeNull();
    expect(result!.evicted).toBe(1);
    expect(result!.policy).toBe('hybrid');
    // old-low should be evicted (old + low importance)
    expect(store.delete).toHaveBeenCalledWith('old-low');
  });

  it('should report eviction results', async () => {
    const memories = [
      createMemory('m1', 0.3, 100),
      createMemory('m2', 0.3, 200),
      createMemory('m3', 0.3, 300),
    ];
    const store = createMockStore(memories);

    const evictor = new MemoryEvictor({
      maxMemories: 1,
      policy: 'lru',
      evictBatchSize: 2,
    });

    const result = await evictor.evictIfNeeded(store as any);
    expect(result).not.toBeNull();
    expect(result!.memoriesBefore).toBe(3);
    expect(result!.evicted).toBe(2);
    expect(result!.duration).toBeGreaterThanOrEqual(0);
    expect(result!.reason).toContain('exceeds max');
  });

  it('should force evict with custom reason', async () => {
    const store = createMockStore([
      createMemory('m1', 0.3, 24),
    ]);

    const evictor = new MemoryEvictor({
      maxMemories: 100,
      policy: 'lru',
      evictBatchSize: 1,
    });

    const result = await evictor.evict(store as any, 'Manual cleanup');
    expect(result.reason).toBe('Manual cleanup');
  });

  it('should get and update config', () => {
    const evictor = new MemoryEvictor({
      maxMemories: 100,
      policy: 'lru',
    });

    expect(evictor.getConfig().maxMemories).toBe(100);

    evictor.updateConfig({ maxMemories: 200 });
    expect(evictor.getConfig().maxMemories).toBe(200);
    expect(evictor.getConfig().policy).toBe('lru'); // Unchanged
  });

  it('should handle eviction with no evictable candidates', async () => {
    // All memories are protected (high importance)
    const memories = [
      createMemory('p1', 0.95, 1),
      createMemory('p2', 0.95, 1),
    ];
    const store = createMockStore(memories);

    const evictor = new MemoryEvictor({
      maxMemories: 1,
      policy: 'importance',
      evictBatchSize: 1,
      protectedImportanceThreshold: 0.9,
    });

    const result = await evictor.evictIfNeeded(store as any);
    expect(result).not.toBeNull();
    expect(result!.evicted).toBe(0); // Nothing to evict
  });

  it('should handle storage size eviction', async () => {
    const store = createMockStore([
      createMemory('m1', 0.3, 24),
    ]);
    store.getStorageSize.mockResolvedValue(200 * 1024 * 1024); // 200MB

    const evictor = new MemoryEvictor({
      maxMemories: 100,
      policy: 'lru',
      maxStorageBytes: 100 * 1024 * 1024, // 100MB
      evictBatchSize: 1,
    });

    const result = await evictor.evictByStorageSize(store as any);
    expect(result).not.toBeNull();
  });

  it('should skip storage size eviction when under limit', async () => {
    const store = createMockStore([]);
    store.getStorageSize.mockResolvedValue(1024); // 1KB

    const evictor = new MemoryEvictor({
      maxMemories: 100,
      policy: 'lru',
      maxStorageBytes: 100 * 1024 * 1024,
    });

    const result = await evictor.evictByStorageSize(store as any);
    expect(result).toBeNull();
  });
});
