/**
 * TopologyGraph — Unit Tests
 *
 * Tests scene graph management: node CRUD, edge CRUD, layout algorithms
 * (force-directed, hierarchical, circular, grid), topology building,
 * camera management, serialization, and statistics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopologyGraph } from '../../../src/spatial/topology-graph.js';
import type { SceneNode, SceneEdge, SceneGraph } from '../../../src/spatial/types.js';

// ── Mock node:crypto ──────────────────────────────────────────

let uuidCounter = 0;
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => `uuid-${++uuidCounter}-1234-1234-123456789012`),
}));

// ── Helpers ───────────────────────────────────────────────────

function createNode(overrides?: Partial<SceneNode>): SceneNode {
  return {
    id: `node-${Math.random().toString(36).slice(2, 6)}`,
    type: 'agent',
    label: 'Test Agent',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#4CAF50',
    ...overrides,
  };
}

function createEdge(source: string, target: string, overrides?: Partial<SceneEdge>): SceneEdge {
  return {
    id: `edge-${Math.random().toString(36).slice(2, 6)}`,
    source,
    target,
    type: 'communication',
    weight: 1,
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────

describe('TopologyGraph', () => {
  let graph: TopologyGraph;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    graph = new TopologyGraph();
  });

  // ── Lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() sets running and emits event', () => {
      const spy = vi.fn();
      graph.on('spatial:graph:started', spy);
      graph.start();
      expect(graph.isRunning()).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('stop() clears running and emits event', () => {
      graph.start();
      const spy = vi.fn();
      graph.on('spatial:graph:stopped', spy);
      graph.stop();
      expect(graph.isRunning()).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── addNode ───────────────────────────────────────────────

  describe('addNode', () => {
    it('adds a node and returns it', () => {
      const node = createNode({ id: 'n1' });
      const result = graph.addNode(node);
      expect(result).toBe(node);
      expect(graph.getNode('n1')).toBe(node);
    });

    it('assigns default color based on type', () => {
      const node = createNode({ id: 'n2', type: 'tool', color: undefined as unknown as string });
      // Remove the color so default kicks in
      delete (node as Record<string, unknown>).color;
      graph.addNode(node);
      expect(node.color).toBe('#2196F3'); // tool color
    });

    it('assigns grey for unknown type', () => {
      const node = createNode({ id: 'n3', type: 'unknown' as SceneNode['type'] });
      delete (node as Record<string, unknown>).color;
      graph.addNode(node);
      expect(node.color).toBe('#CCCCCC');
    });

    it('emits spatial:node:added event', () => {
      const spy = vi.fn();
      graph.on('spatial:node:added', spy);
      graph.addNode(createNode({ id: 'n4' }));
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── removeNode ────────────────────────────────────────────

  describe('removeNode', () => {
    it('removes an existing node and returns true', () => {
      graph.addNode(createNode({ id: 'n1' }));
      const result = graph.removeNode('n1');
      expect(result).toBe(true);
      expect(graph.getNode('n1')).toBeUndefined();
    });

    it('returns false for non-existent node', () => {
      const result = graph.removeNode('nonexistent');
      expect(result).toBe(false);
    });

    it('removes all connected edges when a node is removed', () => {
      graph.addNode(createNode({ id: 'a' }));
      graph.addNode(createNode({ id: 'b' }));
      graph.addNode(createNode({ id: 'c' }));
      graph.addEdge(createEdge('a', 'b', { id: 'e1' }));
      graph.addEdge(createEdge('b', 'c', { id: 'e2' }));

      graph.removeNode('b');
      expect(graph.getEdge('e1')).toBeUndefined();
      expect(graph.getEdge('e2')).toBeUndefined();
    });

    it('emits spatial:node:removed event', () => {
      graph.addNode(createNode({ id: 'n1' }));
      const spy = vi.fn();
      graph.on('spatial:node:removed', spy);
      graph.removeNode('n1');
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── getNodes ──────────────────────────────────────────────

  describe('getNodes', () => {
    it('returns all nodes', () => {
      graph.addNode(createNode({ id: 'n1' }));
      graph.addNode(createNode({ id: 'n2' }));
      const nodes = graph.getNodes();
      expect(nodes).toHaveLength(2);
    });

    it('returns empty array when no nodes exist', () => {
      expect(graph.getNodes()).toEqual([]);
    });
  });

  // ── addEdge ───────────────────────────────────────────────

  describe('addEdge', () => {
    it('adds an edge between two existing nodes', () => {
      graph.addNode(createNode({ id: 'a' }));
      graph.addNode(createNode({ id: 'b' }));
      const edge = createEdge('a', 'b', { id: 'e1' });
      const result = graph.addEdge(edge);
      expect(result).toBe(edge);
      expect(graph.getEdge('e1')).toBe(edge);
    });

    it('throws when source node does not exist', () => {
      graph.addNode(createNode({ id: 'b' }));
      expect(() => graph.addEdge(createEdge('nonexistent', 'b'))).toThrow(
        'Source node not found',
      );
    });

    it('throws when target node does not exist', () => {
      graph.addNode(createNode({ id: 'a' }));
      expect(() => graph.addEdge(createEdge('a', 'nonexistent'))).toThrow(
        'Target node not found',
      );
    });

    it('emits spatial:edge:added event', () => {
      graph.addNode(createNode({ id: 'a' }));
      graph.addNode(createNode({ id: 'b' }));
      const spy = vi.fn();
      graph.on('spatial:edge:added', spy);
      graph.addEdge(createEdge('a', 'b'));
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── removeEdge ────────────────────────────────────────────

  describe('removeEdge', () => {
    it('removes an existing edge and returns true', () => {
      graph.addNode(createNode({ id: 'a' }));
      graph.addNode(createNode({ id: 'b' }));
      graph.addEdge(createEdge('a', 'b', { id: 'e1' }));

      const result = graph.removeEdge('e1');
      expect(result).toBe(true);
      expect(graph.getEdge('e1')).toBeUndefined();
    });

    it('returns false for non-existent edge', () => {
      expect(graph.removeEdge('nonexistent')).toBe(false);
    });

    it('emits spatial:edge:removed event', () => {
      graph.addNode(createNode({ id: 'a' }));
      graph.addNode(createNode({ id: 'b' }));
      graph.addEdge(createEdge('a', 'b', { id: 'e1' }));

      const spy = vi.fn();
      graph.on('spatial:edge:removed', spy);
      graph.removeEdge('e1');
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── getEdges ──────────────────────────────────────────────

  describe('getEdges', () => {
    it('returns all edges', () => {
      graph.addNode(createNode({ id: 'a' }));
      graph.addNode(createNode({ id: 'b' }));
      graph.addEdge(createEdge('a', 'b', { id: 'e1' }));
      expect(graph.getEdges()).toHaveLength(1);
    });
  });

  // ── Layout algorithms ─────────────────────────────────────

  describe('layout — force-directed', () => {
    it('positions nodes and emits layout events', () => {
      const startSpy = vi.fn();
      const completeSpy = vi.fn();
      graph.on('spatial:layout:start', startSpy);
      graph.on('spatial:layout:complete', completeSpy);

      graph.addNode(createNode({ id: 'a' }));
      graph.addNode(createNode({ id: 'b' }));
      graph.addEdge(createEdge('a', 'b'));

      graph.layout('force-directed');

      expect(startSpy).toHaveBeenCalledWith(
        expect.objectContaining({ algorithm: 'force-directed' }),
      );
      expect(completeSpy).toHaveBeenCalledOnce();

      // Nodes should have been repositioned (not all at 0,0,0)
      const nodes = graph.getNodes();
      const allAtOrigin = nodes.every(
        (n) => n.position.x === 0 && n.position.y === 0 && n.position.z === 0,
      );
      expect(allAtOrigin).toBe(false);
    });

    it('handles empty graph gracefully', () => {
      expect(() => graph.layout('force-directed')).not.toThrow();
    });
  });

  describe('layout — hierarchical', () => {
    it('arranges nodes in levels', () => {
      graph.addNode(createNode({ id: 'root' }));
      graph.addNode(createNode({ id: 'child1' }));
      graph.addNode(createNode({ id: 'child2' }));
      graph.addEdge(createEdge('root', 'child1'));
      graph.addEdge(createEdge('root', 'child2'));

      graph.layout('hierarchical');

      const root = graph.getNode('root')!;
      const child1 = graph.getNode('child1')!;

      // Root should be above children (y is negative for deeper levels)
      expect(root.position.y).toBeGreaterThan(child1.position.y);
    });
  });

  describe('layout — circular', () => {
    it('arranges nodes in a circle', () => {
      graph.addNode(createNode({ id: 'a' }));
      graph.addNode(createNode({ id: 'b' }));
      graph.addNode(createNode({ id: 'c' }));

      graph.layout('circular');

      const nodes = graph.getNodes();
      // All nodes should be at approximately the same distance from origin
      const distances = nodes.map((n) =>
        Math.sqrt(n.position.x ** 2 + n.position.y ** 2),
      );
      const radius = distances[0];
      for (const d of distances) {
        expect(d).toBeCloseTo(radius, 0);
      }
    });
  });

  describe('layout — grid', () => {
    it('arranges nodes in a grid', () => {
      for (let i = 0; i < 4; i++) {
        graph.addNode(createNode({ id: `n${i}` }));
      }

      graph.layout('grid');

      const nodes = graph.getNodes();
      // 4 nodes should form a 2x2 grid
      const positions = nodes.map((n) => ({ x: n.position.x, y: n.position.y }));
      // All positions should be distinct
      const uniquePositions = new Set(positions.map((p) => `${p.x},${p.y}`));
      expect(uniquePositions.size).toBe(4);
    });
  });

  describe('layout — uses configured default', () => {
    it('uses the configured layout algorithm when none is specified', () => {
      const circularGraph = new TopologyGraph({ layout: 'circular' });
      circularGraph.addNode(createNode({ id: 'a' }));
      circularGraph.addNode(createNode({ id: 'b' }));

      const spy = vi.fn();
      circularGraph.on('spatial:layout:start', spy);
      circularGraph.layout();

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ algorithm: 'circular' }),
      );
    });
  });

  // ── fromAgentTopology ─────────────────────────────────────

  describe('fromAgentTopology', () => {
    it('builds graph from agent and connection data', () => {
      const agents = [
        { id: 'agent1', name: 'Agent One', type: 'agent' },
        { id: 'agent2', name: 'Agent Two', type: 'tool' },
      ];
      const connections = [{ from: 'agent1', to: 'agent2', type: 'dataflow' }];

      const scene = graph.fromAgentTopology(agents, connections);

      expect(scene.nodes).toHaveLength(2);
      expect(scene.edges).toHaveLength(1);
      expect(scene.nodes[0].label).toBe('Agent One');
      expect(scene.nodes[1].label).toBe('Agent Two');
    });

    it('skips edges where source or target node is missing', () => {
      const agents = [{ id: 'agent1', name: 'Agent One' }];
      const connections = [{ from: 'agent1', to: 'nonexistent' }];

      const scene = graph.fromAgentTopology(agents, connections);
      expect(scene.edges).toHaveLength(0);
    });

    it('assigns default type "agent" when type is not specified', () => {
      const agents = [{ id: 'a', name: 'Test' }];
      const scene = graph.fromAgentTopology(agents, []);
      expect(scene.nodes[0].type).toBe('agent');
    });

    it('applies layout after building', () => {
      const spy = vi.fn();
      graph.on('spatial:layout:complete', spy);

      graph.fromAgentTopology(
        [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        [{ from: 'a', to: 'b' }],
      );

      expect(spy).toHaveBeenCalled();
    });
  });

  // ── Camera ────────────────────────────────────────────────

  describe('camera', () => {
    it('returns default camera state', () => {
      const camera = graph.getCamera();
      expect(camera.position).toEqual({ x: 0, y: 0, z: 100 });
      expect(camera.target).toEqual({ x: 0, y: 0, z: 0 });
      expect(camera.fov).toBe(60);
      expect(camera.zoom).toBe(1.0);
    });

    it('updates camera with partial state', () => {
      graph.setCamera({ fov: 90, zoom: 2.0 });
      const camera = graph.getCamera();
      expect(camera.fov).toBe(90);
      expect(camera.zoom).toBe(2.0);
      // Unset fields remain at defaults
      expect(camera.position).toEqual({ x: 0, y: 0, z: 100 });
    });

    it('updates camera position and target', () => {
      graph.setCamera({
        position: { x: 10, y: 20, z: 30 },
        target: { x: 1, y: 2, z: 3 },
      });
      const camera = graph.getCamera();
      expect(camera.position).toEqual({ x: 10, y: 20, z: 30 });
      expect(camera.target).toEqual({ x: 1, y: 2, z: 3 });
    });
  });

  // ── Serialization ─────────────────────────────────────────

  describe('toJSON / fromJSON', () => {
    it('serializes the graph to SceneGraph format', () => {
      graph.addNode(createNode({ id: 'n1', label: 'Node 1' }));
      graph.addNode(createNode({ id: 'n2', label: 'Node 2' }));
      graph.addEdge(createEdge('n1', 'n2', { id: 'e1' }));

      const json = graph.toJSON();
      expect(json.id).toContain('scene_');
      expect(json.nodes).toHaveLength(2);
      expect(json.edges).toHaveLength(1);
      expect(json.camera).toBeDefined();
    });

    it('loads a graph from SceneGraph JSON', () => {
      const sceneData: SceneGraph = {
        id: 'scene_test',
        nodes: [
          createNode({ id: 'x1', label: 'Loaded' }),
          createNode({ id: 'x2', label: 'Loaded2' }),
        ],
        edges: [createEdge('x1', 'x2', { id: 'ex1' })],
        camera: { position: { x: 5, y: 5, z: 5 }, target: { x: 0, y: 0, z: 0 }, fov: 45, zoom: 2 },
        metadata: { test: true },
      };

      graph.fromJSON(sceneData);
      expect(graph.getNodes()).toHaveLength(2);
      expect(graph.getEdges()).toHaveLength(1);
      expect(graph.getCamera().fov).toBe(45);
    });

    it('clears existing data when loading from JSON', () => {
      graph.addNode(createNode({ id: 'old' }));

      const sceneData: SceneGraph = {
        id: 'scene_new',
        nodes: [createNode({ id: 'new' })],
        edges: [],
        camera: { position: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 }, fov: 60, zoom: 1 },
        metadata: {},
      };

      graph.fromJSON(sceneData);
      expect(graph.getNode('old')).toBeUndefined();
      expect(graph.getNode('new')).toBeDefined();
    });
  });

  // ── getStats ──────────────────────────────────────────────

  describe('getStats', () => {
    it('returns initial statistics', () => {
      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
      expect(stats.density).toBe(0);
    });

    it('counts nodes and edges by type', () => {
      graph.addNode(createNode({ id: 'a', type: 'agent' }));
      graph.addNode(createNode({ id: 'b', type: 'tool' }));
      graph.addNode(createNode({ id: 'c', type: 'agent' }));
      graph.addEdge(createEdge('a', 'b', { id: 'e1', type: 'dataflow' }));
      graph.addEdge(createEdge('b', 'c', { id: 'e2', type: 'communication' }));

      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2);
      expect(stats.nodesByType.agent).toBe(2);
      expect(stats.nodesByType.tool).toBe(1);
      expect(stats.edgesByType.dataflow).toBe(1);
      expect(stats.edgesByType.communication).toBe(1);
    });

    it('calculates density correctly', () => {
      graph.addNode(createNode({ id: 'a' }));
      graph.addNode(createNode({ id: 'b' }));
      graph.addNode(createNode({ id: 'c' }));
      // Max edges for 3 nodes = 3
      graph.addEdge(createEdge('a', 'b', { id: 'e1' }));
      graph.addEdge(createEdge('b', 'c', { id: 'e2' }));
      graph.addEdge(createEdge('a', 'c', { id: 'e3' }));

      const stats = graph.getStats();
      expect(stats.density).toBe(1); // Fully connected
    });
  });
});
