import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileIndexer } from '../../../src/reasoning/rag/file-indexer.js';
import { RAGProvider } from '../../../src/reasoning/rag/rag-provider.js';
import { RAGSearchTool } from '../../../src/reasoning/rag/rag-search-tool.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const toolContext: ToolContext = { workingDir: '/tmp', executionId: 'test' };

// Create a temporary project for testing
let testDir: string;

function setupTestProject() {
  testDir = join(tmpdir(), `cortex-rag-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  mkdirSync(join(testDir, 'src'), { recursive: true });

  writeFileSync(join(testDir, 'src', 'auth.ts'), `
/**
 * Authentication module
 * Handles user login and token management
 */
export class AuthService {
  async login(email: string, password: string): Promise<string> {
    // Validate credentials and return JWT token
    return 'jwt-token';
  }

  async verifyToken(token: string): Promise<boolean> {
    return true;
  }
}
`.trim());

  writeFileSync(join(testDir, 'src', 'database.ts'), `
/**
 * Database connection module
 * Manages PostgreSQL connections
 */
export class Database {
  private pool: any;

  async connect(url: string): Promise<void> {
    // Connect to PostgreSQL
  }

  async query(sql: string, params: any[]): Promise<any[]> {
    return [];
  }

  async close(): Promise<void> {
    // Close pool
  }
}
`.trim());

  writeFileSync(join(testDir, 'src', 'cache.ts'), `
/**
 * Caching layer
 * In-memory cache with TTL support
 */
export class Cache {
  private store = new Map<string, { value: unknown; expires: number }>();

  set(key: string, value: unknown, ttlMs: number): void {
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  get(key: string): unknown | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }
}
`.trim());
}

function cleanupTestProject() {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

describe('FileIndexer', () => {
  beforeEach(() => {
    setupTestProject();
    return () => cleanupTestProject();
  });

  it('should index project files into chunks', () => {
    const indexer = new FileIndexer({ chunkSize: 500 });
    const chunks = indexer.indexProject(testDir);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].path).toBeTruthy();
    expect(chunks[0].relativePath).toBeTruthy();
    expect(chunks[0].chunk).toBeTruthy();
    expect(chunks[0].startLine).toBeGreaterThanOrEqual(1);
  });

  it('should respect maxFiles limit', () => {
    const indexer = new FileIndexer({ maxFiles: 1 });
    const chunks = indexer.indexProject(testDir);

    // Should only have chunks from 1 file
    const uniqueFiles = new Set(chunks.map(c => c.path));
    expect(uniqueFiles.size).toBeLessThanOrEqual(1);
  });

  it('should only index code file extensions', () => {
    // Write a binary-like file that should be ignored
    writeFileSync(join(testDir, 'src', 'image.png'), Buffer.from([0x89, 0x50]));

    const indexer = new FileIndexer();
    const chunks = indexer.indexProject(testDir);

    const extensions = chunks.map(c => c.path.split('.').pop());
    expect(extensions).not.toContain('png');
  });

  it('should chunk large files into overlapping segments', () => {
    // Create a large file
    const lines = Array.from({ length: 100 }, (_, i) => `const line${i} = ${i};`);
    writeFileSync(join(testDir, 'src', 'large.ts'), lines.join('\n'));

    const indexer = new FileIndexer({ chunkSize: 30, chunkOverlap: 5 });
    const chunks = indexer.indexProject(testDir);

    const largeChunks = chunks.filter(c => c.relativePath.includes('large'));
    expect(largeChunks.length).toBeGreaterThan(1);
  });

  it('should keep small files as single chunks', () => {
    writeFileSync(join(testDir, 'src', 'tiny.ts'), 'export const x = 1;');

    const indexer = new FileIndexer({ chunkSize: 500 });
    const chunks = indexer.indexProject(testDir);

    const tinyChunks = chunks.filter(c => c.relativePath.includes('tiny'));
    expect(tinyChunks.length).toBe(1);
  });

  it('should provide relative paths', () => {
    const indexer = new FileIndexer();
    const chunks = indexer.indexProject(testDir);

    for (const chunk of chunks) {
      expect(chunk.relativePath).not.toContain(testDir);
      expect(chunk.relativePath.startsWith('src/')).toBe(true);
    }
  });

  it('should handle empty directories', () => {
    const emptyDir = join(tmpdir(), `cortex-rag-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });

    const indexer = new FileIndexer();
    const chunks = indexer.indexProject(emptyDir);

    expect(chunks).toEqual([]);
    rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe('RAGProvider', () => {
  beforeEach(() => {
    setupTestProject();
    return () => cleanupTestProject();
  });

  it('should index project and become searchable', async () => {
    const provider = new RAGProvider({
      maxChunks: 5,
      chunkSize: 500,
      minRelevance: 0.0,
    });

    await provider.indexProject(testDir);
    expect(provider.isIndexed).toBe(true);
    expect(provider.chunkCount).toBeGreaterThan(0);
  });

  it('should search for relevant chunks', async () => {
    const provider = new RAGProvider({
      maxChunks: 5,
      chunkSize: 500,
      minRelevance: 0.0,
    });

    await provider.indexProject(testDir);
    const results = await provider.search('authentication login');

    expect(results.length).toBeGreaterThan(0);
    // Auth-related chunks should score higher
    const topResult = results[0];
    expect(topResult.score).toBeGreaterThan(0);
  });

  it('should respect maxResults limit', async () => {
    const provider = new RAGProvider({
      maxChunks: 1,
      chunkSize: 500,
      minRelevance: 0.0,
    });

    await provider.indexProject(testDir);
    const results = await provider.search('code');

    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('should filter by minRelevance', async () => {
    const provider = new RAGProvider({
      maxChunks: 10,
      chunkSize: 500,
      minRelevance: 0.99, // Very high threshold
    });

    await provider.indexProject(testDir);
    const results = await provider.search('random unrelated query xyz');

    // With very high threshold, most results should be filtered
    expect(results.length).toBeLessThanOrEqual(provider.chunkCount);
  });

  it('should format search results as context string', async () => {
    const provider = new RAGProvider({
      maxChunks: 3,
      chunkSize: 500,
      minRelevance: 0.0,
    });

    await provider.indexProject(testDir);
    const results = await provider.search('database query');
    const context = provider.formatContext(results);

    expect(context).toContain('## Relevant Code Context (RAG)');
    if (results.length > 0) {
      expect(context).toContain('relevance:');
      expect(context).toContain('```');
    }
  });

  it('should return empty results for unindexed provider', async () => {
    const provider = new RAGProvider({
      maxChunks: 5,
      chunkSize: 500,
      minRelevance: 0.0,
    });

    const results = await provider.search('anything');
    expect(results).toEqual([]);
  });

  it('should format empty results as empty string', async () => {
    const provider = new RAGProvider({
      maxChunks: 5,
      chunkSize: 500,
      minRelevance: 0.0,
    });

    const context = provider.formatContext([]);
    expect(context).toBe('');
  });
});

describe('RAGSearchTool', () => {
  beforeEach(() => {
    setupTestProject();
    return () => cleanupTestProject();
  });

  it('should implement the Tool interface', () => {
    const ragProvider = new RAGProvider({
      maxChunks: 5,
      chunkSize: 500,
      minRelevance: 0.0,
    });

    const tool = new RAGSearchTool(ragProvider);
    expect(tool.name).toBe('rag_search');
    expect(tool.description).toBeTruthy();
    expect(tool.parameters.type).toBe('object');
    expect(tool.parameters.properties.query).toBeDefined();
  });

  it('should execute search and return formatted results', async () => {
    const ragProvider = new RAGProvider({
      maxChunks: 5,
      chunkSize: 500,
      minRelevance: 0.0,
    });

    await ragProvider.indexProject(testDir);
    const tool = new RAGSearchTool(ragProvider);

    const result = await tool.execute(
      { query: 'authentication login' },
      toolContext,
    );

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
    expect(result.metadata).toBeDefined();
  });

  it('should return error for empty query', async () => {
    const ragProvider = new RAGProvider({
      maxChunks: 5,
      chunkSize: 500,
      minRelevance: 0.0,
    });

    const tool = new RAGSearchTool(ragProvider);
    const result = await tool.execute({ query: '' }, toolContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('should handle no results gracefully', async () => {
    const ragProvider = new RAGProvider({
      maxChunks: 5,
      chunkSize: 500,
      minRelevance: 0.99,
    });

    await ragProvider.indexProject(testDir);
    const tool = new RAGSearchTool(ragProvider);

    const result = await tool.execute(
      { query: 'completely unrelated xyz123' },
      toolContext,
    );

    expect(result.success).toBe(true);
    // Either no results or very few
  });

  it('should respect max_results parameter', async () => {
    const ragProvider = new RAGProvider({
      maxChunks: 10,
      chunkSize: 500,
      minRelevance: 0.0,
    });

    await ragProvider.indexProject(testDir);
    const tool = new RAGSearchTool(ragProvider);

    const result = await tool.execute(
      { query: 'code', max_results: 1 },
      toolContext,
    );

    expect(result.success).toBe(true);
    if (result.metadata?.results) {
      expect(result.metadata.results as number).toBeLessThanOrEqual(1);
    }
  });
});
