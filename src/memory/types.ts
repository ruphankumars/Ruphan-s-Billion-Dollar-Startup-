/**
 * Memory System Type Definitions
 * Supports 4 memory types: Working, Episodic, Semantic, Procedural
 */

export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  embedding?: number[];
  metadata: MemoryMetadata;
  createdAt: Date;
  updatedAt: Date;
  accessedAt: Date;
  accessCount: number;
  importance: number; // 0-1 scale
  decayFactor: number; // Ebbinghaus forgetting curve factor
}

export interface MemoryMetadata {
  source: string; // Where this memory came from
  project?: string; // Project scope
  tags: string[];
  entities: string[]; // Named entities referenced
  relations: MemoryRelation[];
  confidence: number; // 0-1, how confident we are in this memory
}

export interface MemoryRelation {
  type: 'depends_on' | 'related_to' | 'contradicts' | 'extends' | 'implements';
  targetId: string;
  strength: number; // 0-1
}

export interface MemoryQuery {
  text: string;
  type?: MemoryType;
  project?: string;
  tags?: string[];
  minImportance?: number;
  maxResults?: number;
  includeDecayed?: boolean;
  /** Search across all projects in the global memory pool */
  crossProject?: boolean;
}

export interface MemoryRecallResult {
  entry: MemoryEntry;
  relevance: number; // 0-1 cosine similarity
  recencyBoost: number;
  finalScore: number;
}

export interface MemoryStoreOptions {
  type: MemoryType;
  importance?: number;
  tags?: string[];
  entities?: string[];
  project?: string;
  source?: string;
}

export interface WorkingMemoryState {
  sessionId: string;
  goal: string;
  context: string[];
  recentActions: string[];
  activeEntities: string[];
  scratchpad: Record<string, unknown>;
}

export interface EpisodicMemoryEntry extends MemoryEntry {
  type: 'episodic';
  event: string;
  outcome: 'success' | 'failure' | 'partial';
  duration?: number;
  cost?: number;
}

export interface SemanticMemoryEntry extends MemoryEntry {
  type: 'semantic';
  category: string;
  factType: 'definition' | 'relationship' | 'property' | 'rule';
}

export interface ProceduralMemoryEntry extends MemoryEntry {
  type: 'procedural';
  trigger: string; // When to apply this procedure
  steps: string[];
  successRate: number;
}

export interface EmbeddingEngine {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions(): number;
}

export interface VectorStore {
  add(id: string, embedding: number[], metadata: Record<string, unknown>): Promise<void>;
  search(query: number[], limit: number, filter?: Record<string, unknown>): Promise<VectorSearchResult[]>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
  close(): Promise<void>;
  /** Update metadata for an existing entry (optional — for relation discovery) */
  updateMetadata?(id: string, updates: Record<string, unknown>): Promise<void>;
  /** Get all entries (optional — for consolidation) */
  getAll?(): Promise<Array<{ id: string; embedding: number[]; metadata: Record<string, unknown> }>>;
  /** Get storage size in bytes (optional — for eviction) */
  getStorageSize?(): Promise<number>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface MemoryManager {
  recall(query: MemoryQuery): Promise<MemoryRecallResult[]>;
  store(content: string, options: MemoryStoreOptions): Promise<MemoryEntry>;
  forget(id: string): Promise<void>;
  getStats(): Promise<MemoryStats>;
  close(): Promise<void>;
}

export interface MemoryStats {
  totalMemories: number;
  byType: Record<MemoryType, number>;
  averageImportance: number;
  oldestMemory?: Date;
  newestMemory?: Date;
  storageSize: number;
}

export interface MemoryConfig {
  enabled: boolean;
  globalDir: string;
  projectDir?: string;
  maxMemories: number;
  embeddingModel: string;
  decayEnabled: boolean;
  decayHalfLifeDays: number;
  minImportanceThreshold: number;
  consolidationInterval: number; // hours
  /** Enable cross-project memory sharing via global pool */
  crossProjectEnabled?: boolean;
  /** Minimum importance for auto-syncing to global pool (default: 0.7) */
  crossProjectThreshold?: number;
}
