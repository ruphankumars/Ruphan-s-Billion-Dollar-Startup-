export { CortexMemoryManager } from './manager.js';
export { LocalEmbeddingEngine, cosineSimilarity } from './embeddings.js';
export { SQLiteVectorStore } from './store/vector-sqlite.js';
export { MemoryExtractor } from './pipeline/extractor.js';
export { WorkingMemory } from './types/working.js';
export { EpisodicMemoryBuilder } from './types/episodic.js';
export { SemanticMemoryBuilder } from './types/semantic.js';
export type {
  MemoryEntry,
  MemoryQuery,
  MemoryRecallResult,
  MemoryStoreOptions,
  MemoryStats,
  MemoryConfig,
  MemoryType,
  MemoryMetadata,
  MemoryRelation,
  WorkingMemoryState,
  EpisodicMemoryEntry,
  SemanticMemoryEntry,
  ProceduralMemoryEntry,
  EmbeddingEngine,
  VectorStore,
  VectorSearchResult,
  MemoryManager,
} from './types.js';
