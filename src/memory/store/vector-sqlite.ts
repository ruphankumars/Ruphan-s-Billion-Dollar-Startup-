/**
 * SQLite-based Vector Store
 * Stores embeddings and performs brute-force cosine similarity search
 * Good for up to ~100K vectors. Phase 3 adds LanceDB for scale.
 */

import type { VectorStore, VectorSearchResult } from '../types.js';
import { cosineSimilarity } from '../embeddings.js';
import { ensureDir } from '../../utils/fs.js';
import { dirname } from 'path';

interface StoredVector {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

/**
 * SQLite-backed vector store using better-sqlite3
 * Falls back to in-memory store if SQLite is unavailable
 */
export class SQLiteVectorStore implements VectorStore {
  private db: any = null;
  private inMemoryStore: Map<string, StoredVector> = new Map();
  private readonly dbPath: string;
  private initialized = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await ensureDir(dirname(this.dbPath));
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(this.dbPath);

      // Enable WAL mode for better concurrent reads
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');

      // Create vectors table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS vectors (
          id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL,
          metadata TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);

      // Create index for faster lookups
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_vectors_id ON vectors(id)
      `);
    } catch {
      // Fall back to in-memory store
      this.db = null;
    }

    this.initialized = true;
  }

  async add(id: string, embedding: number[], metadata: Record<string, unknown>): Promise<void> {
    await this.initialize();

    if (this.db) {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO vectors (id, embedding, metadata)
        VALUES (?, ?, ?)
      `);
      stmt.run(
        id,
        Buffer.from(new Float64Array(embedding).buffer),
        JSON.stringify(metadata),
      );
    } else {
      this.inMemoryStore.set(id, { id, embedding, metadata });
    }
  }

  async search(
    query: number[],
    limit: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]> {
    await this.initialize();

    const vectors = await this.getAllVectors();
    const results: VectorSearchResult[] = [];

    for (const vec of vectors) {
      // Apply metadata filter
      if (filter && !this.matchesFilter(vec.metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(query, vec.embedding);
      results.push({ id: vec.id, score, metadata: vec.metadata });
    }

    // Sort by score descending and take top N
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    await this.initialize();

    if (this.db) {
      this.db.prepare('DELETE FROM vectors WHERE id = ?').run(id);
    } else {
      this.inMemoryStore.delete(id);
    }
  }

  async count(): Promise<number> {
    await this.initialize();

    if (this.db) {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM vectors').get();
      return row.count;
    }
    return this.inMemoryStore.size;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  /**
   * Get all vectors from store
   */
  private async getAllVectors(): Promise<StoredVector[]> {
    if (this.db) {
      const rows = this.db.prepare('SELECT id, embedding, metadata FROM vectors').all();
      return rows.map((row: any) => ({
        id: row.id,
        embedding: Array.from(new Float64Array(row.embedding.buffer)),
        metadata: JSON.parse(row.metadata),
      }));
    }
    return Array.from(this.inMemoryStore.values());
  }

  /**
   * Check if metadata matches filter criteria
   */
  private matchesFilter(
    metadata: Record<string, unknown>,
    filter: Record<string, unknown>,
  ): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key] !== value) return false;
    }
    return true;
  }
}
