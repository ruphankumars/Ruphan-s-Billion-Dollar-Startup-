/**
 * Knowledge Graph — Graph-based knowledge representation engine.
 *
 * Provides entity and relationship management, BFS-based pattern
 * matching queries, Dijkstra shortest-path computation, rule-based
 * inference, and graph merging for CortexOS memory systems.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type {
  Entity,
  Relationship,
  GraphPath,
  GraphPattern,
  InferenceRule,
  KnowledgeGraphConfig,
  KnowledgeGraphStats,
} from './knowledge-graph-types.js';

/** Default configuration */
const DEFAULT_CONFIG: KnowledgeGraphConfig = {
  enabled: true,
  maxEntities: 100_000,
  maxRelationships: 500_000,
  maxInferenceDepth: 5,
  autoInference: false,
  deduplicateEntities: true,
};

/**
 * KnowledgeGraph provides a full-featured in-memory graph database
 * for AI agent knowledge management with entity deduplication,
 * relationship tracking, BFS pattern queries, Dijkstra pathfinding,
 * and rule-based inference.
 */
export class KnowledgeGraph extends EventEmitter {
  private entities: Map<string, Entity> = new Map();
  private relationships: Map<string, Relationship> = new Map();
  private inferenceRules: Map<string, InferenceRule> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map();
  private inferenceCount = 0;
  private config: KnowledgeGraphConfig;

  constructor(config?: Partial<KnowledgeGraphConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add an entity to the graph.
   * If deduplication is enabled and an entity with the same name+type
   * already exists, the existing entity is updated instead.
   */
  addEntity(
    entity: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>,
  ): Entity {
    // Deduplication check
    if (this.config.deduplicateEntities) {
      for (const existing of this.entities.values()) {
        if (existing.name === entity.name && existing.type === entity.type) {
          existing.properties = { ...existing.properties, ...entity.properties };
          existing.updatedAt = Date.now();
          this.emit('kg:entity:updated', { entityId: existing.id, name: existing.name });
          return existing;
        }
      }
    }

    // Enforce capacity
    if (this.entities.size >= this.config.maxEntities) {
      throw new Error(`Knowledge graph entity capacity reached: ${this.config.maxEntities}`);
    }

    const now = Date.now();
    const id = `ent-${randomUUID().slice(0, 8)}`;
    const fullEntity: Entity = {
      id,
      createdAt: now,
      updatedAt: now,
      ...entity,
    };

    this.entities.set(id, fullEntity);
    this.adjacencyList.set(id, new Set());

    this.emit('kg:entity:added', { entityId: id, type: entity.type, name: entity.name });

    // Auto-inference if enabled
    if (this.config.autoInference) {
      this.runInference();
    }

    return fullEntity;
  }

  /**
   * Update an existing entity's properties.
   */
  updateEntity(
    id: string,
    updates: Partial<Omit<Entity, 'id' | 'createdAt'>>,
  ): Entity {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new Error(`Entity not found: ${id}`);
    }

    if (updates.type !== undefined) entity.type = updates.type;
    if (updates.name !== undefined) entity.name = updates.name;
    if (updates.source !== undefined) entity.source = updates.source;
    if (updates.properties !== undefined) {
      entity.properties = { ...entity.properties, ...updates.properties };
    }
    entity.updatedAt = Date.now();

    this.emit('kg:entity:updated', { entityId: id, name: entity.name });
    return entity;
  }

  /**
   * Remove an entity and all its connected relationships.
   */
  removeEntity(id: string): boolean {
    if (!this.entities.has(id)) return false;

    // Remove all relationships connected to this entity
    const relIdsToRemove: string[] = [];
    for (const [relId, rel] of this.relationships) {
      if (rel.sourceId === id || rel.targetId === id) {
        relIdsToRemove.push(relId);
      }
    }

    for (const relId of relIdsToRemove) {
      this.removeRelationship(relId);
    }

    // Remove from adjacency list
    this.adjacencyList.delete(id);
    for (const neighbors of this.adjacencyList.values()) {
      neighbors.delete(id);
    }

    this.entities.delete(id);
    this.emit('kg:entity:removed', { entityId: id });
    return true;
  }

  /** Get a specific entity by ID */
  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /**
   * Find entities matching optional filter criteria.
   */
  findEntities(filter: {
    type?: string;
    name?: string;
    source?: string;
  }): Entity[] {
    let results = [...this.entities.values()];

    if (filter.type !== undefined) {
      results = results.filter(e => e.type === filter.type);
    }
    if (filter.name !== undefined) {
      results = results.filter(e =>
        e.name.toLowerCase().includes(filter.name!.toLowerCase()),
      );
    }
    if (filter.source !== undefined) {
      results = results.filter(e => e.source === filter.source);
    }

    return results;
  }

  /**
   * Add a relationship between two entities.
   * Also maintains the adjacency list for efficient graph traversal.
   */
  addRelationship(
    rel: Omit<Relationship, 'id' | 'createdAt'>,
  ): Relationship {
    // Validate entities exist
    if (!this.entities.has(rel.sourceId)) {
      throw new Error(`Source entity not found: ${rel.sourceId}`);
    }
    if (!this.entities.has(rel.targetId)) {
      throw new Error(`Target entity not found: ${rel.targetId}`);
    }

    // Enforce capacity
    if (this.relationships.size >= this.config.maxRelationships) {
      throw new Error(`Knowledge graph relationship capacity reached: ${this.config.maxRelationships}`);
    }

    const id = `rel-${randomUUID().slice(0, 8)}`;
    const fullRel: Relationship = {
      id,
      createdAt: Date.now(),
      ...rel,
    };

    this.relationships.set(id, fullRel);

    // Update adjacency list
    this.ensureAdjacencyEntry(rel.sourceId);
    this.ensureAdjacencyEntry(rel.targetId);
    this.adjacencyList.get(rel.sourceId)!.add(rel.targetId);
    if (rel.bidirectional) {
      this.adjacencyList.get(rel.targetId)!.add(rel.sourceId);
    }

    this.emit('kg:relationship:added', {
      relationshipId: id,
      sourceId: rel.sourceId,
      targetId: rel.targetId,
      type: rel.type,
    });

    // Auto-inference if enabled
    if (this.config.autoInference) {
      this.runInference();
    }

    return fullRel;
  }

  /**
   * Remove a relationship and update the adjacency list.
   */
  removeRelationship(id: string): boolean {
    const rel = this.relationships.get(id);
    if (!rel) return false;

    this.relationships.delete(id);

    // Rebuild adjacency for affected entities
    this.rebuildAdjacencyForEntity(rel.sourceId);
    if (rel.bidirectional) {
      this.rebuildAdjacencyForEntity(rel.targetId);
    }

    this.emit('kg:relationship:removed', { relationshipId: id });
    return true;
  }

  /**
   * Get relationships connected to a specific entity.
   */
  getRelationships(
    entityId: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'both',
  ): Relationship[] {
    const results: Relationship[] = [];

    for (const rel of this.relationships.values()) {
      if (direction === 'outgoing' || direction === 'both') {
        if (rel.sourceId === entityId) {
          results.push(rel);
          continue;
        }
      }
      if (direction === 'incoming' || direction === 'both') {
        if (rel.targetId === entityId) {
          results.push(rel);
          continue;
        }
      }
      // Also include bidirectional relationships where this entity is the target
      if (direction === 'outgoing' && rel.bidirectional && rel.targetId === entityId) {
        results.push(rel);
      }
    }

    return results;
  }

  /**
   * Find relationships matching filter criteria.
   */
  findRelationships(filter: {
    type?: string;
    sourceType?: string;
    targetType?: string;
  }): Relationship[] {
    let results = [...this.relationships.values()];

    if (filter.type !== undefined) {
      results = results.filter(r => r.type === filter.type);
    }
    if (filter.sourceType !== undefined) {
      results = results.filter(r => {
        const source = this.entities.get(r.sourceId);
        return source && source.type === filter.sourceType;
      });
    }
    if (filter.targetType !== undefined) {
      results = results.filter(r => {
        const target = this.entities.get(r.targetId);
        return target && target.type === filter.targetType;
      });
    }

    return results;
  }

  /**
   * Query the graph using BFS traversal with pattern matching.
   * Starts from a given entity and finds all paths matching the
   * specified pattern constraints (entity types, relationship types, depth).
   */
  query(startEntityId: string, pattern: GraphPattern): GraphPath[] {
    const startEntity = this.entities.get(startEntityId);
    if (!startEntity) return [];

    const maxDepth = pattern.maxDepth ?? this.config.maxInferenceDepth;
    const minDepth = pattern.minDepth ?? 0;
    const paths: GraphPath[] = [];

    // BFS queue: each entry is a partial path
    interface BFSEntry {
      entityId: string;
      entities: Entity[];
      relationships: Relationship[];
      totalWeight: number;
      depth: number;
      visited: Set<string>;
    }

    const queue: BFSEntry[] = [{
      entityId: startEntityId,
      entities: [startEntity],
      relationships: [],
      totalWeight: 0,
      depth: 0,
      visited: new Set([startEntityId]),
    }];

    while (queue.length > 0) {
      const current = queue.shift()!;

      // If path meets minimum depth, record it
      if (current.depth >= minDepth && current.depth > 0) {
        paths.push({
          entities: [...current.entities],
          relationships: [...current.relationships],
          totalWeight: current.totalWeight,
        });
      }

      // Don't exceed max depth
      if (current.depth >= maxDepth) continue;

      // Explore neighbors
      const outRels = this.getOutgoingRelationships(current.entityId);
      for (const rel of outRels) {
        const targetId = rel.sourceId === current.entityId
          ? rel.targetId
          : rel.sourceId;

        if (current.visited.has(targetId)) continue;

        const targetEntity = this.entities.get(targetId);
        if (!targetEntity) continue;

        // Check pattern constraints
        if (pattern.relationshipTypes && pattern.relationshipTypes.length > 0) {
          if (!pattern.relationshipTypes.includes(rel.type)) continue;
        }
        if (pattern.entityTypes && pattern.entityTypes.length > 0) {
          if (!pattern.entityTypes.includes(targetEntity.type)) continue;
        }

        const newVisited = new Set(current.visited);
        newVisited.add(targetId);

        queue.push({
          entityId: targetId,
          entities: [...current.entities, targetEntity],
          relationships: [...current.relationships, rel],
          totalWeight: current.totalWeight + rel.weight,
          depth: current.depth + 1,
          visited: newVisited,
        });
      }
    }

    return paths;
  }

  /**
   * Get all entities within N hops of the given entity.
   */
  getNeighbors(entityId: string, depth = 1): Entity[] {
    if (!this.entities.has(entityId)) return [];

    const visited = new Set<string>([entityId]);
    let currentLevel = new Set<string>([entityId]);

    for (let d = 0; d < depth; d++) {
      const nextLevel = new Set<string>();

      for (const id of currentLevel) {
        const neighbors = this.adjacencyList.get(id);
        if (!neighbors) continue;

        for (const neighborId of neighbors) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            nextLevel.add(neighborId);
          }
        }

        // Also check incoming edges (for non-bidirectional)
        for (const rel of this.relationships.values()) {
          if (rel.targetId === id && !visited.has(rel.sourceId)) {
            visited.add(rel.sourceId);
            nextLevel.add(rel.sourceId);
          }
        }
      }

      currentLevel = nextLevel;
    }

    // Remove the start entity from results
    visited.delete(entityId);

    const results: Entity[] = [];
    for (const id of visited) {
      const entity = this.entities.get(id);
      if (entity) results.push(entity);
    }

    return results;
  }

  /**
   * Find the shortest path between two entities using Dijkstra's algorithm.
   * Uses relationship weights as edge costs (lower weight = cheaper path).
   */
  getShortestPath(fromId: string, toId: string): GraphPath | null {
    if (!this.entities.has(fromId) || !this.entities.has(toId)) {
      return null;
    }

    if (fromId === toId) {
      const entity = this.entities.get(fromId)!;
      return { entities: [entity], relationships: [], totalWeight: 0 };
    }

    // Dijkstra's algorithm
    const dist = new Map<string, number>();
    const prev = new Map<string, { entityId: string; relationship: Relationship } | null>();
    const visited = new Set<string>();

    // Initialize distances
    for (const id of this.entities.keys()) {
      dist.set(id, Infinity);
      prev.set(id, null);
    }
    dist.set(fromId, 0);

    while (true) {
      // Find unvisited node with minimum distance
      let minDist = Infinity;
      let minNode: string | null = null;

      for (const [id, d] of dist) {
        if (!visited.has(id) && d < minDist) {
          minDist = d;
          minNode = id;
        }
      }

      if (minNode === null || minDist === Infinity) break;
      if (minNode === toId) break;

      visited.add(minNode);

      // Relax edges from minNode
      const outRels = this.getOutgoingRelationships(minNode);
      for (const rel of outRels) {
        const neighborId = rel.sourceId === minNode
          ? rel.targetId
          : rel.sourceId;

        if (visited.has(neighborId)) continue;

        const newDist = (dist.get(minNode) ?? Infinity) + rel.weight;
        if (newDist < (dist.get(neighborId) ?? Infinity)) {
          dist.set(neighborId, newDist);
          prev.set(neighborId, { entityId: minNode, relationship: rel });
        }
      }
    }

    // Reconstruct path
    if (dist.get(toId) === Infinity) return null;

    const pathEntities: Entity[] = [];
    const pathRelationships: Relationship[] = [];
    let current: string | null = toId;

    while (current !== null) {
      const entity = this.entities.get(current);
      if (entity) pathEntities.unshift(entity);

      const prevEntry = prev.get(current);
      if (prevEntry) {
        pathRelationships.unshift(prevEntry.relationship);
        current = prevEntry.entityId;
      } else {
        current = null;
      }
    }

    return {
      entities: pathEntities,
      relationships: pathRelationships,
      totalWeight: dist.get(toId) ?? 0,
    };
  }

  /**
   * Add a rule for automatic relationship inference.
   */
  addInferenceRule(rule: Omit<InferenceRule, 'id'>): InferenceRule {
    const id = `rule-${randomUUID().slice(0, 8)}`;
    const fullRule: InferenceRule = { id, ...rule };
    this.inferenceRules.set(id, fullRule);

    this.emit('kg:inference:rule-added', { ruleId: id, name: rule.name });
    return fullRule;
  }

  /**
   * Run all enabled inference rules to derive new relationships.
   * For each rule, finds matching entity-relationship-entity triples
   * and creates inferred relationships between source and target entities.
   */
  runInference(): Relationship[] {
    const newRelationships: Relationship[] = [];

    for (const rule of this.inferenceRules.values()) {
      if (!rule.enabled) continue;

      // Find all relationships matching the rule condition
      for (const rel of this.relationships.values()) {
        if (rel.type !== rule.condition.relationshipType) continue;

        const source = this.entities.get(rel.sourceId);
        const target = this.entities.get(rel.targetId);

        if (!source || !target) continue;
        if (source.type !== rule.condition.sourceType) continue;
        if (target.type !== rule.condition.targetType) continue;

        // Check if inferred relationship already exists
        const alreadyExists = [...this.relationships.values()].some(
          existing =>
            existing.sourceId === rel.sourceId &&
            existing.targetId === rel.targetId &&
            existing.type === rule.inference.relationshipType,
        );

        if (alreadyExists) continue;

        // Create inferred relationship
        try {
          const inferred = this.addRelationship({
            sourceId: rel.sourceId,
            targetId: rel.targetId,
            type: rule.inference.relationshipType,
            weight: rule.inference.weight,
            properties: {
              _inferred: true,
              _ruleId: rule.id,
              _ruleName: rule.name,
              _sourceRelationshipId: rel.id,
            },
            bidirectional: false,
          });

          newRelationships.push(inferred);
          this.inferenceCount++;
        } catch {
          // Skip if capacity is reached
        }
      }
    }

    if (newRelationships.length > 0) {
      this.emit('kg:inference:complete', {
        newRelationships: newRelationships.length,
        totalInferences: this.inferenceCount,
      });
    }

    return newRelationships;
  }

  /**
   * Merge external graph data into this graph.
   * Handles entity deduplication and relationship re-linking.
   */
  merge(other: {
    entities: Entity[];
    relationships: Relationship[];
  }): {
    entitiesAdded: number;
    relationshipsAdded: number;
    duplicatesSkipped: number;
  } {
    let entitiesAdded = 0;
    let relationshipsAdded = 0;
    let duplicatesSkipped = 0;

    // Map old IDs to new IDs for re-linking relationships
    const idMap = new Map<string, string>();

    // Import entities
    for (const entity of other.entities) {
      // Check for duplicates
      if (this.config.deduplicateEntities) {
        const existing = [...this.entities.values()].find(
          e => e.name === entity.name && e.type === entity.type,
        );

        if (existing) {
          idMap.set(entity.id, existing.id);
          // Merge properties
          existing.properties = { ...existing.properties, ...entity.properties };
          existing.updatedAt = Date.now();
          duplicatesSkipped++;
          continue;
        }
      }

      const newId = `ent-${randomUUID().slice(0, 8)}`;
      idMap.set(entity.id, newId);

      const now = Date.now();
      const newEntity: Entity = {
        ...entity,
        id: newId,
        createdAt: now,
        updatedAt: now,
      };

      this.entities.set(newId, newEntity);
      this.adjacencyList.set(newId, new Set());
      entitiesAdded++;
    }

    // Import relationships with re-linked IDs
    for (const rel of other.relationships) {
      const newSourceId = idMap.get(rel.sourceId) ?? rel.sourceId;
      const newTargetId = idMap.get(rel.targetId) ?? rel.targetId;

      // Validate both entities exist
      if (!this.entities.has(newSourceId) || !this.entities.has(newTargetId)) {
        continue;
      }

      try {
        this.addRelationship({
          sourceId: newSourceId,
          targetId: newTargetId,
          type: rel.type,
          weight: rel.weight,
          properties: rel.properties,
          bidirectional: rel.bidirectional,
        });
        relationshipsAdded++;
      } catch {
        // Skip if capacity reached
      }
    }

    this.emit('kg:merge:complete', {
      entitiesAdded,
      relationshipsAdded,
      duplicatesSkipped,
    });

    return { entitiesAdded, relationshipsAdded, duplicatesSkipped };
  }

  /**
   * Get knowledge graph statistics.
   */
  getStats(): KnowledgeGraphStats {
    const entityTypes: Record<string, number> = {};
    for (const entity of this.entities.values()) {
      entityTypes[entity.type] = (entityTypes[entity.type] ?? 0) + 1;
    }

    const relationshipTypes: Record<string, number> = {};
    for (const rel of this.relationships.values()) {
      relationshipTypes[rel.type] = (relationshipTypes[rel.type] ?? 0) + 1;
    }

    // Calculate average degree (edges per node)
    const totalDegree = this.relationships.size * 2; // each edge contributes to 2 nodes
    const avgDegree = this.entities.size > 0
      ? totalDegree / this.entities.size
      : 0;

    return {
      totalEntities: this.entities.size,
      totalRelationships: this.relationships.size,
      totalInferences: this.inferenceCount,
      entityTypes,
      relationshipTypes,
      avgDegree,
    };
  }

  /**
   * Export all entities and relationships as plain arrays.
   */
  export(): { entities: Entity[]; relationships: Relationship[] } {
    return {
      entities: [...this.entities.values()],
      relationships: [...this.relationships.values()],
    };
  }

  /**
   * Clear all graph data.
   */
  clear(): void {
    this.entities.clear();
    this.relationships.clear();
    this.inferenceRules.clear();
    this.adjacencyList.clear();
    this.inferenceCount = 0;
    this.emit('kg:cleared');
  }

  /**
   * Get all outgoing relationships from an entity,
   * including bidirectional relationships where the entity is the target.
   */
  private getOutgoingRelationships(entityId: string): Relationship[] {
    const rels: Relationship[] = [];
    for (const rel of this.relationships.values()) {
      if (rel.sourceId === entityId) {
        rels.push(rel);
      } else if (rel.bidirectional && rel.targetId === entityId) {
        rels.push(rel);
      }
    }
    return rels;
  }

  /** Ensure an adjacency list entry exists for an entity */
  private ensureAdjacencyEntry(entityId: string): void {
    if (!this.adjacencyList.has(entityId)) {
      this.adjacencyList.set(entityId, new Set());
    }
  }

  /**
   * Rebuild the adjacency set for a specific entity by scanning
   * all relationships. Used after relationship removal.
   */
  private rebuildAdjacencyForEntity(entityId: string): void {
    const neighbors = new Set<string>();

    for (const rel of this.relationships.values()) {
      if (rel.sourceId === entityId) {
        neighbors.add(rel.targetId);
      }
      if (rel.bidirectional && rel.targetId === entityId) {
        neighbors.add(rel.sourceId);
      }
    }

    this.adjacencyList.set(entityId, neighbors);
  }
}
