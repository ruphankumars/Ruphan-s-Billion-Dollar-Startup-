/**
 * Knowledge Graph Layer — Type Definitions
 *
 * Graph-based knowledge representation types for entities,
 * relationships, traversal, and inference in CortexOS.
 */

// ── Entity Types ────────────────────────────────────────────────────

export interface Entity {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  source: string;
}

// ── Relationship Types ──────────────────────────────────────────────

export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  weight: number;
  properties: Record<string, unknown>;
  createdAt: number;
  bidirectional: boolean;
}

// ── Graph Traversal Types ───────────────────────────────────────────

export interface GraphPath {
  entities: Entity[];
  relationships: Relationship[];
  totalWeight: number;
}

export interface GraphPattern {
  entityTypes?: string[];
  relationshipTypes?: string[];
  minDepth?: number;
  maxDepth?: number;
}

// ── Inference Types ─────────────────────────────────────────────────

export interface InferenceRule {
  id: string;
  name: string;
  description: string;
  condition: {
    sourceType: string;
    relationshipType: string;
    targetType: string;
  };
  inference: {
    relationshipType: string;
    weight: number;
  };
  enabled: boolean;
}

// ── Configuration ───────────────────────────────────────────────────

export interface KnowledgeGraphConfig {
  enabled: boolean;
  maxEntities: number;
  maxRelationships: number;
  maxInferenceDepth: number;
  autoInference: boolean;
  deduplicateEntities: boolean;
}

// ── Stats ───────────────────────────────────────────────────────────

export interface KnowledgeGraphStats {
  totalEntities: number;
  totalRelationships: number;
  totalInferences: number;
  entityTypes: Record<string, number>;
  relationshipTypes: Record<string, number>;
  avgDegree: number;
}
