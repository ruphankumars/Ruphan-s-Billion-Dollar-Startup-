import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KnowledgeGraph } from '../../../src/memory/knowledge-graph.js';

/** Helper to create a minimal entity input */
function makeEntity(overrides: Record<string, unknown> = {}) {
  return {
    type: 'person',
    name: 'Alice',
    properties: { role: 'engineer' },
    source: 'test',
    ...overrides,
  };
}

describe('KnowledgeGraph', () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = new KnowledgeGraph();
  });

  afterEach(() => {
    graph.removeAllListeners();
  });

  // ── Constructor ─────────────────────────────────────────────────

  describe('constructor', () => {
    it('should create a graph with default config', () => {
      const stats = graph.getStats();
      expect(stats.totalEntities).toBe(0);
      expect(stats.totalRelationships).toBe(0);
      expect(stats.totalInferences).toBe(0);
    });

    it('should accept custom config overrides', () => {
      const g = new KnowledgeGraph({ maxEntities: 10, deduplicateEntities: false });
      const stats = g.getStats();
      expect(stats.totalEntities).toBe(0);
    });
  });

  // ── addEntity / getEntity / removeEntity ────────────────────────

  describe('entity management', () => {
    it('should add an entity with generated id and timestamps', () => {
      const entity = graph.addEntity(makeEntity());
      expect(entity.id).toMatch(/^ent-/);
      expect(entity.name).toBe('Alice');
      expect(entity.type).toBe('person');
      expect(entity.createdAt).toBeGreaterThan(0);
      expect(entity.updatedAt).toBeGreaterThan(0);
    });

    it('should retrieve an entity by ID', () => {
      const entity = graph.addEntity(makeEntity());
      expect(graph.getEntity(entity.id)).toBeDefined();
      expect(graph.getEntity(entity.id)?.name).toBe('Alice');
      expect(graph.getEntity('ent-nonexistent')).toBeUndefined();
    });

    it('should deduplicate entities with same name and type', () => {
      const first = graph.addEntity(makeEntity({ properties: { role: 'engineer' } }));
      const second = graph.addEntity(makeEntity({ properties: { level: 'senior' } }));

      // Should return the same entity with merged properties
      expect(second.id).toBe(first.id);
      expect(second.properties).toEqual({ role: 'engineer', level: 'senior' });
    });

    it('should not deduplicate when deduplicateEntities is false', () => {
      const g = new KnowledgeGraph({ deduplicateEntities: false });
      const first = g.addEntity(makeEntity());
      const second = g.addEntity(makeEntity());
      expect(first.id).not.toBe(second.id);
    });

    it('should remove an entity and its connected relationships', () => {
      const a = graph.addEntity(makeEntity({ name: 'A' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      graph.addRelationship({
        sourceId: a.id,
        targetId: b.id,
        type: 'works_at',
        weight: 1.0,
        properties: {},
        bidirectional: false,
      });

      expect(graph.removeEntity(a.id)).toBe(true);
      expect(graph.getEntity(a.id)).toBeUndefined();
      // Relationship should also be removed
      const rels = graph.getRelationships(b.id);
      expect(rels).toHaveLength(0);
    });

    it('should return false when removing a non-existent entity', () => {
      expect(graph.removeEntity('ent-nonexistent')).toBe(false);
    });

    it('should throw when exceeding entity capacity', () => {
      const g = new KnowledgeGraph({ maxEntities: 2, deduplicateEntities: false });
      g.addEntity(makeEntity({ name: 'A' }));
      g.addEntity(makeEntity({ name: 'B' }));
      expect(() => g.addEntity(makeEntity({ name: 'C' }))).toThrow(
        /capacity reached/,
      );
    });

    it('should emit entity:added and entity:removed events', () => {
      const addHandler = vi.fn();
      const removeHandler = vi.fn();
      graph.on('kg:entity:added', addHandler);
      graph.on('kg:entity:removed', removeHandler);

      const entity = graph.addEntity(makeEntity());
      expect(addHandler).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: entity.id, name: 'Alice' }),
      );

      graph.removeEntity(entity.id);
      expect(removeHandler).toHaveBeenCalledWith({ entityId: entity.id });
    });

    it('should update an existing entity', () => {
      const entity = graph.addEntity(makeEntity());
      const updated = graph.updateEntity(entity.id, {
        name: 'Alice Updated',
        properties: { title: 'CTO' },
      });

      expect(updated.name).toBe('Alice Updated');
      expect(updated.properties).toEqual({ role: 'engineer', title: 'CTO' });
    });

    it('should throw when updating a non-existent entity', () => {
      expect(() => graph.updateEntity('ent-fake', { name: 'nope' })).toThrow(
        /Entity not found/,
      );
    });
  });

  // ── findEntities ────────────────────────────────────────────────

  describe('findEntities', () => {
    it('should find entities by type and name', () => {
      graph.addEntity(makeEntity({ name: 'Alice', type: 'person' }));
      graph.addEntity(makeEntity({ name: 'Acme Corp', type: 'org' }));
      graph.addEntity(makeEntity({ name: 'Bob', type: 'person' }));

      expect(graph.findEntities({ type: 'person' })).toHaveLength(2);
      expect(graph.findEntities({ name: 'Acme' })).toHaveLength(1);
      expect(graph.findEntities({ source: 'test' })).toHaveLength(3);
    });
  });

  // ── addRelationship / getRelationships / removeRelationship ─────

  describe('relationship management', () => {
    it('should add a relationship between two entities', () => {
      const a = graph.addEntity(makeEntity({ name: 'A' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));

      const rel = graph.addRelationship({
        sourceId: a.id,
        targetId: b.id,
        type: 'works_at',
        weight: 1.0,
        properties: { since: 2020 },
        bidirectional: false,
      });

      expect(rel.id).toMatch(/^rel-/);
      expect(rel.sourceId).toBe(a.id);
      expect(rel.targetId).toBe(b.id);
      expect(rel.type).toBe('works_at');
      expect(rel.createdAt).toBeGreaterThan(0);
    });

    it('should throw when source entity does not exist', () => {
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      expect(() =>
        graph.addRelationship({
          sourceId: 'ent-fake',
          targetId: b.id,
          type: 'x',
          weight: 1,
          properties: {},
          bidirectional: false,
        }),
      ).toThrow(/Source entity not found/);
    });

    it('should throw when target entity does not exist', () => {
      const a = graph.addEntity(makeEntity({ name: 'A' }));
      expect(() =>
        graph.addRelationship({
          sourceId: a.id,
          targetId: 'ent-fake',
          type: 'x',
          weight: 1,
          properties: {},
          bidirectional: false,
        }),
      ).toThrow(/Target entity not found/);
    });

    it('should get outgoing, incoming, and both relationships', () => {
      const a = graph.addEntity(makeEntity({ name: 'A' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      graph.addRelationship({
        sourceId: a.id,
        targetId: b.id,
        type: 'knows',
        weight: 1,
        properties: {},
        bidirectional: false,
      });

      expect(graph.getRelationships(a.id, 'outgoing')).toHaveLength(1);
      expect(graph.getRelationships(b.id, 'incoming')).toHaveLength(1);
      expect(graph.getRelationships(a.id, 'both')).toHaveLength(1);
    });

    it('should remove a relationship', () => {
      const a = graph.addEntity(makeEntity({ name: 'A' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      const rel = graph.addRelationship({
        sourceId: a.id,
        targetId: b.id,
        type: 'knows',
        weight: 1,
        properties: {},
        bidirectional: false,
      });

      expect(graph.removeRelationship(rel.id)).toBe(true);
      expect(graph.getRelationships(a.id)).toHaveLength(0);
    });

    it('should return false when removing a non-existent relationship', () => {
      expect(graph.removeRelationship('rel-fake')).toBe(false);
    });

    it('should throw when exceeding relationship capacity', () => {
      const g = new KnowledgeGraph({ maxRelationships: 1, deduplicateEntities: false });
      const a = g.addEntity(makeEntity({ name: 'A' }));
      const b = g.addEntity(makeEntity({ name: 'B', type: 'org' }));
      const c = g.addEntity(makeEntity({ name: 'C', type: 'tool' }));

      g.addRelationship({
        sourceId: a.id, targetId: b.id, type: 'x',
        weight: 1, properties: {}, bidirectional: false,
      });

      expect(() =>
        g.addRelationship({
          sourceId: a.id, targetId: c.id, type: 'y',
          weight: 1, properties: {}, bidirectional: false,
        }),
      ).toThrow(/capacity reached/);
    });
  });

  // ── query (BFS traversal) ──────────────────────────────────────

  describe('query (BFS)', () => {
    it('should find paths matching a pattern', () => {
      const a = graph.addEntity(makeEntity({ name: 'A', type: 'person' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      const c = graph.addEntity(makeEntity({ name: 'C', type: 'project' }));

      graph.addRelationship({
        sourceId: a.id, targetId: b.id, type: 'works_at',
        weight: 1, properties: {}, bidirectional: false,
      });
      graph.addRelationship({
        sourceId: b.id, targetId: c.id, type: 'owns',
        weight: 2, properties: {}, bidirectional: false,
      });

      const paths = graph.query(a.id, { maxDepth: 3 });
      expect(paths.length).toBeGreaterThanOrEqual(1);
      // Should find A->B and A->B->C
      const deepPath = paths.find(p => p.entities.length === 3);
      expect(deepPath).toBeDefined();
      expect(deepPath!.totalWeight).toBe(3);
    });

    it('should filter by relationship types', () => {
      const a = graph.addEntity(makeEntity({ name: 'A', type: 'person' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      const c = graph.addEntity(makeEntity({ name: 'C', type: 'project' }));

      graph.addRelationship({
        sourceId: a.id, targetId: b.id, type: 'works_at',
        weight: 1, properties: {}, bidirectional: false,
      });
      graph.addRelationship({
        sourceId: a.id, targetId: c.id, type: 'contributes_to',
        weight: 1, properties: {}, bidirectional: false,
      });

      const paths = graph.query(a.id, {
        relationshipTypes: ['works_at'],
        maxDepth: 2,
      });
      // All paths should only use works_at relationships
      for (const path of paths) {
        for (const rel of path.relationships) {
          expect(rel.type).toBe('works_at');
        }
      }
    });

    it('should filter by entity types', () => {
      const a = graph.addEntity(makeEntity({ name: 'A', type: 'person' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      const c = graph.addEntity(makeEntity({ name: 'C', type: 'person' }));

      graph.addRelationship({
        sourceId: a.id, targetId: b.id, type: 'works_at',
        weight: 1, properties: {}, bidirectional: false,
      });
      graph.addRelationship({
        sourceId: a.id, targetId: c.id, type: 'knows',
        weight: 1, properties: {}, bidirectional: false,
      });

      const paths = graph.query(a.id, {
        entityTypes: ['person'],
        maxDepth: 2,
      });
      // Target entities should all be person type
      for (const path of paths) {
        const lastEntity = path.entities[path.entities.length - 1];
        expect(lastEntity.type).toBe('person');
      }
    });

    it('should return empty for non-existent start entity', () => {
      expect(graph.query('ent-fake', { maxDepth: 2 })).toEqual([]);
    });

    it('should respect minDepth', () => {
      const a = graph.addEntity(makeEntity({ name: 'A', type: 'person' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      const c = graph.addEntity(makeEntity({ name: 'C', type: 'project' }));

      graph.addRelationship({
        sourceId: a.id, targetId: b.id, type: 'x',
        weight: 1, properties: {}, bidirectional: false,
      });
      graph.addRelationship({
        sourceId: b.id, targetId: c.id, type: 'x',
        weight: 1, properties: {}, bidirectional: false,
      });

      const paths = graph.query(a.id, { minDepth: 2, maxDepth: 3 });
      for (const path of paths) {
        expect(path.entities.length).toBeGreaterThanOrEqual(3); // start + 2 hops
      }
    });
  });

  // ── getShortestPath (Dijkstra) ──────────────────────────────────

  describe('getShortestPath', () => {
    it('should find the shortest path between two entities', () => {
      const a = graph.addEntity(makeEntity({ name: 'A', type: 'node' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'node' }));
      const c = graph.addEntity(makeEntity({ name: 'C', type: 'node' }));

      // Direct path A->C with weight 10
      graph.addRelationship({
        sourceId: a.id, targetId: c.id, type: 'edge',
        weight: 10, properties: {}, bidirectional: false,
      });
      // Indirect path A->B->C with total weight 3
      graph.addRelationship({
        sourceId: a.id, targetId: b.id, type: 'edge',
        weight: 1, properties: {}, bidirectional: false,
      });
      graph.addRelationship({
        sourceId: b.id, targetId: c.id, type: 'edge',
        weight: 2, properties: {}, bidirectional: false,
      });

      const path = graph.getShortestPath(a.id, c.id);
      expect(path).not.toBeNull();
      expect(path!.totalWeight).toBe(3);
      expect(path!.entities).toHaveLength(3); // A, B, C
      expect(path!.relationships).toHaveLength(2);
    });

    it('should return self-path for same entity', () => {
      const a = graph.addEntity(makeEntity({ name: 'A' }));
      const path = graph.getShortestPath(a.id, a.id);
      expect(path).not.toBeNull();
      expect(path!.entities).toHaveLength(1);
      expect(path!.totalWeight).toBe(0);
    });

    it('should return null when no path exists', () => {
      const a = graph.addEntity(makeEntity({ name: 'A' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      // No relationship between them
      const path = graph.getShortestPath(a.id, b.id);
      expect(path).toBeNull();
    });

    it('should return null for non-existent entities', () => {
      expect(graph.getShortestPath('ent-fake', 'ent-also-fake')).toBeNull();
    });

    it('should work with bidirectional relationships', () => {
      const a = graph.addEntity(makeEntity({ name: 'A', type: 'node' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'node' }));

      graph.addRelationship({
        sourceId: a.id, targetId: b.id, type: 'edge',
        weight: 5, properties: {}, bidirectional: true,
      });

      // Path from B to A should work via bidirectional edge
      const path = graph.getShortestPath(b.id, a.id);
      expect(path).not.toBeNull();
      expect(path!.totalWeight).toBe(5);
    });
  });

  // ── runInference ────────────────────────────────────────────────

  describe('runInference', () => {
    it('should create inferred relationships based on rules', () => {
      const alice = graph.addEntity(makeEntity({ name: 'Alice', type: 'person' }));
      const acme = graph.addEntity(makeEntity({ name: 'Acme', type: 'company' }));

      graph.addRelationship({
        sourceId: alice.id, targetId: acme.id, type: 'works_at',
        weight: 1.0, properties: {}, bidirectional: false,
      });

      graph.addInferenceRule({
        name: 'Employee implies loyalty',
        description: 'If a person works at a company, infer loyalty',
        condition: {
          sourceType: 'person',
          relationshipType: 'works_at',
          targetType: 'company',
        },
        inference: {
          relationshipType: 'loyal_to',
          weight: 0.5,
        },
        enabled: true,
      });

      const inferred = graph.runInference();
      expect(inferred).toHaveLength(1);
      expect(inferred[0].type).toBe('loyal_to');
      expect(inferred[0].properties['_inferred']).toBe(true);
    });

    it('should not create duplicate inferred relationships', () => {
      const alice = graph.addEntity(makeEntity({ name: 'Alice', type: 'person' }));
      const acme = graph.addEntity(makeEntity({ name: 'Acme', type: 'company' }));

      graph.addRelationship({
        sourceId: alice.id, targetId: acme.id, type: 'works_at',
        weight: 1.0, properties: {}, bidirectional: false,
      });

      graph.addInferenceRule({
        name: 'Infer',
        description: 'test',
        condition: {
          sourceType: 'person',
          relationshipType: 'works_at',
          targetType: 'company',
        },
        inference: { relationshipType: 'loyal_to', weight: 0.5 },
        enabled: true,
      });

      graph.runInference();
      const secondRun = graph.runInference();
      expect(secondRun).toHaveLength(0); // Already exists
    });

    it('should skip disabled inference rules', () => {
      const alice = graph.addEntity(makeEntity({ name: 'Alice', type: 'person' }));
      const acme = graph.addEntity(makeEntity({ name: 'Acme', type: 'company' }));

      graph.addRelationship({
        sourceId: alice.id, targetId: acme.id, type: 'works_at',
        weight: 1.0, properties: {}, bidirectional: false,
      });

      graph.addInferenceRule({
        name: 'Disabled Rule',
        description: 'disabled',
        condition: {
          sourceType: 'person',
          relationshipType: 'works_at',
          targetType: 'company',
        },
        inference: { relationshipType: 'inferred_rel', weight: 0.5 },
        enabled: false,
      });

      const inferred = graph.runInference();
      expect(inferred).toHaveLength(0);
    });

    it('should emit inference:complete event', () => {
      const handler = vi.fn();
      graph.on('kg:inference:complete', handler);

      const alice = graph.addEntity(makeEntity({ name: 'Alice', type: 'person' }));
      const acme = graph.addEntity(makeEntity({ name: 'Acme', type: 'company' }));

      graph.addRelationship({
        sourceId: alice.id, targetId: acme.id, type: 'works_at',
        weight: 1.0, properties: {}, bidirectional: false,
      });

      graph.addInferenceRule({
        name: 'Inf',
        description: 'test',
        condition: {
          sourceType: 'person',
          relationshipType: 'works_at',
          targetType: 'company',
        },
        inference: { relationshipType: 'loyal_to', weight: 0.5 },
        enabled: true,
      });

      graph.runInference();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ newRelationships: 1 }),
      );
    });
  });

  // ── merge ───────────────────────────────────────────────────────

  describe('merge', () => {
    it('should merge entities and relationships from another graph', () => {
      const a = graph.addEntity(makeEntity({ name: 'A', type: 'node' }));

      const result = graph.merge({
        entities: [
          { id: 'ext-1', type: 'node', name: 'B', properties: {}, createdAt: 0, updatedAt: 0, source: 'external' },
          { id: 'ext-2', type: 'node', name: 'C', properties: {}, createdAt: 0, updatedAt: 0, source: 'external' },
        ],
        relationships: [
          {
            id: 'ext-rel-1', sourceId: 'ext-1', targetId: 'ext-2', type: 'connects',
            weight: 1, properties: {}, createdAt: 0, bidirectional: false,
          },
        ],
      });

      expect(result.entitiesAdded).toBe(2);
      expect(result.relationshipsAdded).toBe(1);
      expect(result.duplicatesSkipped).toBe(0);
      expect(graph.getStats().totalEntities).toBe(3);
    });

    it('should handle entity deduplication during merge', () => {
      graph.addEntity(makeEntity({ name: 'Alice', type: 'person', properties: { role: 'dev' } }));

      const result = graph.merge({
        entities: [
          {
            id: 'ext-1', type: 'person', name: 'Alice',
            properties: { level: 'senior' }, createdAt: 0, updatedAt: 0, source: 'external',
          },
        ],
        relationships: [],
      });

      expect(result.duplicatesSkipped).toBe(1);
      expect(result.entitiesAdded).toBe(0);
      // Properties should be merged
      const entities = graph.findEntities({ name: 'Alice' });
      expect(entities).toHaveLength(1);
      expect(entities[0].properties).toEqual({ role: 'dev', level: 'senior' });
    });

    it('should re-link relationships to deduplicated entities', () => {
      const existing = graph.addEntity(makeEntity({ name: 'Alice', type: 'person' }));

      const result = graph.merge({
        entities: [
          { id: 'ext-alice', type: 'person', name: 'Alice', properties: {}, createdAt: 0, updatedAt: 0, source: 'ext' },
          { id: 'ext-bob', type: 'person', name: 'Bob', properties: {}, createdAt: 0, updatedAt: 0, source: 'ext' },
        ],
        relationships: [
          {
            id: 'ext-rel', sourceId: 'ext-alice', targetId: 'ext-bob', type: 'knows',
            weight: 1, properties: {}, createdAt: 0, bidirectional: false,
          },
        ],
      });

      expect(result.duplicatesSkipped).toBe(1);
      expect(result.relationshipsAdded).toBe(1);
      // The relationship should link existing Alice to new Bob
      const rels = graph.getRelationships(existing.id, 'outgoing');
      expect(rels).toHaveLength(1);
      expect(rels[0].type).toBe('knows');
    });

    it('should emit merge:complete event', () => {
      const handler = vi.fn();
      graph.on('kg:merge:complete', handler);

      graph.merge({ entities: [], relationships: [] });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          entitiesAdded: 0,
          relationshipsAdded: 0,
          duplicatesSkipped: 0,
        }),
      );
    });
  });

  // ── getNeighbors ────────────────────────────────────────────────

  describe('getNeighbors', () => {
    it('should get immediate neighbors', () => {
      const a = graph.addEntity(makeEntity({ name: 'A', type: 'node' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'node' }));
      const c = graph.addEntity(makeEntity({ name: 'C', type: 'node' }));

      graph.addRelationship({
        sourceId: a.id, targetId: b.id, type: 'edge',
        weight: 1, properties: {}, bidirectional: false,
      });
      graph.addRelationship({
        sourceId: a.id, targetId: c.id, type: 'edge',
        weight: 1, properties: {}, bidirectional: false,
      });

      const neighbors = graph.getNeighbors(a.id, 1);
      expect(neighbors).toHaveLength(2);
    });

    it('should return empty for non-existent entity', () => {
      expect(graph.getNeighbors('ent-fake')).toEqual([]);
    });
  });

  // ── clear / export ──────────────────────────────────────────────

  describe('clear and export', () => {
    it('should export all entities and relationships', () => {
      const a = graph.addEntity(makeEntity({ name: 'A' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      graph.addRelationship({
        sourceId: a.id, targetId: b.id, type: 'x',
        weight: 1, properties: {}, bidirectional: false,
      });

      const exported = graph.export();
      expect(exported.entities).toHaveLength(2);
      expect(exported.relationships).toHaveLength(1);
    });

    it('should clear all data', () => {
      graph.addEntity(makeEntity({ name: 'A' }));
      graph.clear();
      const stats = graph.getStats();
      expect(stats.totalEntities).toBe(0);
      expect(stats.totalRelationships).toBe(0);
      expect(stats.totalInferences).toBe(0);
    });
  });

  // ── getStats ────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct aggregate statistics', () => {
      const a = graph.addEntity(makeEntity({ name: 'A', type: 'person' }));
      const b = graph.addEntity(makeEntity({ name: 'B', type: 'org' }));
      graph.addRelationship({
        sourceId: a.id, targetId: b.id, type: 'works_at',
        weight: 1, properties: {}, bidirectional: false,
      });

      const stats = graph.getStats();
      expect(stats.totalEntities).toBe(2);
      expect(stats.totalRelationships).toBe(1);
      expect(stats.entityTypes).toEqual({ person: 1, org: 1 });
      expect(stats.relationshipTypes).toEqual({ works_at: 1 });
      expect(stats.avgDegree).toBe(1); // 1 relationship * 2 / 2 entities
    });
  });
});
