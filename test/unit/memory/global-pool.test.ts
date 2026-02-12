import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GlobalMemoryPool } from '../../../src/memory/global-pool.js';

// Mock SQLiteVectorStore
const mockStore = {
  add: vi.fn(async () => {}),
  search: vi.fn(async () => []),
  count: vi.fn(async () => 0),
  getAll: vi.fn(async () => []),
  clear: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  getStorageSize: vi.fn(async () => 1024),
  updateMetadata: vi.fn(async () => {}),
};

vi.mock('../../../src/memory/store/vector-sqlite.js', () => ({
  SQLiteVectorStore: vi.fn().mockImplementation(() => mockStore),
}));

// Create a mock embedding engine
function createMockEmbeddingEngine() {
  return {
    embed: vi.fn(async (text: string) => Array(384).fill(0.1)),
    dimensions: 384,
  };
}

describe('GlobalMemoryPool', () => {
  let pool: GlobalMemoryPool;
  let embedEngine: ReturnType<typeof createMockEmbeddingEngine>;

  beforeEach(() => {
    vi.clearAllMocks();
    embedEngine = createMockEmbeddingEngine();
    pool = new GlobalMemoryPool('/tmp/test-global', embedEngine as any);
  });

  it('should instantiate with a global directory and embedding engine', () => {
    expect(pool).toBeDefined();
  });

  it('should store global memory with project tag', async () => {
    const id = await pool.storeGlobal('Important finding about API patterns', {
      type: 'semantic' as const,
      projectTag: 'project-a',
      importance: 0.9,
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
    expect(id.startsWith('global-')).toBe(true);
    expect(mockStore.add).toHaveBeenCalledTimes(1);
    expect(embedEngine.embed).toHaveBeenCalledWith('Important finding about API patterns');
  });

  it('should recall across projects', async () => {
    mockStore.search.mockResolvedValueOnce([
      {
        id: 'global-1',
        score: 0.9,
        metadata: {
          type: 'semantic',
          content: 'Cross-project insight',
          importance: 0.8,
          source: 'cross-project',
          project: 'project-b',
          tags: [],
          entities: [],
          createdAt: new Date().toISOString(),
          accessedAt: new Date().toISOString(),
          accessCount: 1,
          decayFactor: 1.0,
        },
      },
    ]);

    const results = await pool.recallAcrossProjects({
      text: 'testing',
      maxResults: 5,
    });

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);
    expect(results[0].entry.content).toBe('Cross-project insight');
    expect(results[0].relevance).toBe(0.9);
  });

  it('should sync high-importance memories from project store', async () => {
    const projectResults = [
      {
        id: 'mem-1',
        score: 0.9,
        metadata: {
          content: 'High importance memory',
          importance: 0.9,
          type: 'semantic',
          tags: [],
          entities: [],
        },
      },
    ];

    const synced = await pool.syncFromProject(projectResults as any, 'project-c', 0.7);
    expect(synced).toBe(1);
    expect(mockStore.add).toHaveBeenCalledTimes(1);
  });

  it('should skip low-importance memories during sync', async () => {
    const lowImportance = [
      {
        id: 'mem-low',
        score: 0.5,
        metadata: {
          content: 'Low importance',
          importance: 0.3,
          type: 'working',
          tags: [],
          entities: [],
        },
      },
    ];

    const synced = await pool.syncFromProject(lowImportance as any, 'project-d', 0.7);
    expect(synced).toBe(0);
    expect(mockStore.add).not.toHaveBeenCalled();
  });

  it('should close cleanly', async () => {
    await pool.close();
    expect(mockStore.close).toHaveBeenCalledTimes(1);
  });

  it('should handle empty recall gracefully', async () => {
    mockStore.search.mockResolvedValueOnce([]);

    const results = await pool.recallAcrossProjects({
      text: 'nonexistent',
      maxResults: 5,
    });
    expect(results).toEqual([]);
  });

  it('should handle store options with tags', async () => {
    const id = await pool.storeGlobal('Tagged memory', {
      type: 'procedural' as const,
      projectTag: 'project-e',
      importance: 0.85,
      tags: ['api', 'patterns'],
    });
    expect(id).toBeDefined();

    const addCall = mockStore.add.mock.calls[0];
    expect(addCall[2].tags).toEqual(['api', 'patterns']);
  });

  it('should limit results to maxResults', async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      id: `global-${i}`,
      score: 0.9 - i * 0.05,
      metadata: {
        type: 'semantic',
        content: `Memory ${i}`,
        importance: 0.8,
        source: 'cross-project',
        tags: [],
        entities: [],
        createdAt: new Date().toISOString(),
        accessedAt: new Date().toISOString(),
        accessCount: 0,
        decayFactor: 1.0,
      },
    }));

    mockStore.search.mockResolvedValueOnce(manyResults);

    const results = await pool.recallAcrossProjects({
      text: 'memory',
      maxResults: 3,
    });

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('should get stats about the global pool', async () => {
    mockStore.count.mockResolvedValueOnce(5);
    mockStore.getAll.mockResolvedValueOnce([
      { id: '1', metadata: { project: 'proj-a' } },
      { id: '2', metadata: { project: 'proj-b' } },
      { id: '3', metadata: { project: 'proj-a' } },
    ]);

    const stats = await pool.getStats();
    expect(stats.totalMemories).toBe(5);
    expect(stats.projects).toContain('proj-a');
    expect(stats.projects).toContain('proj-b');
  });
});
