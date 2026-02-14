/**
 * SceneSerializer — Unit Tests
 *
 * Tests scene graph export formats: Three.js JSON, WebXR scene,
 * SVG markup, deserialization, and utility methods (lerp, distance,
 * normalize, colorFromString).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SceneSerializer } from '../../../src/spatial/scene-serializer.js';
import type { SceneGraph, SceneNode, SceneEdge, Vec3 } from '../../../src/spatial/types.js';

// ── Helpers ───────────────────────────────────────────────────

function createNode(overrides?: Partial<SceneNode>): SceneNode {
  return {
    id: 'node-1',
    type: 'agent',
    label: 'Test Agent',
    position: { x: 10, y: 20, z: 30 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#4CAF50',
    ...overrides,
  };
}

function createEdge(overrides?: Partial<SceneEdge>): SceneEdge {
  return {
    id: 'edge-1',
    source: 'node-1',
    target: 'node-2',
    type: 'communication',
    weight: 1,
    ...overrides,
  };
}

function createGraph(overrides?: Partial<SceneGraph>): SceneGraph {
  return {
    id: 'scene-test',
    nodes: [
      createNode({ id: 'node-1', label: 'Agent A', position: { x: 0, y: 0, z: 0 } }),
      createNode({ id: 'node-2', label: 'Agent B', type: 'tool', color: '#2196F3', position: { x: 50, y: 50, z: 0 } }),
    ],
    edges: [
      createEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' }),
    ],
    camera: {
      position: { x: 0, y: 0, z: 100 },
      target: { x: 0, y: 0, z: 0 },
      fov: 60,
      zoom: 1.0,
    },
    metadata: { test: true },
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────

describe('SceneSerializer', () => {
  let serializer: SceneSerializer;

  beforeEach(() => {
    vi.clearAllMocks();
    serializer = new SceneSerializer();
  });

  // ── toThreeJS ─────────────────────────────────────────────

  describe('toThreeJS', () => {
    it('generates a valid Three.js scene JSON', () => {
      const graph = createGraph();
      const result = serializer.toThreeJS(graph);

      expect(result.metadata).toBeDefined();
      expect((result.metadata as Record<string, unknown>).version).toBe(4.6);
      expect((result.metadata as Record<string, unknown>).generator).toContain('CortexOS');
    });

    it('creates Mesh objects for nodes', () => {
      const graph = createGraph();
      const result = serializer.toThreeJS(graph);

      const scene = result.object as Record<string, unknown>;
      const children = scene.children as Record<string, unknown>[];

      const meshes = children.filter((c) => c.type === 'Mesh');
      expect(meshes).toHaveLength(2);
      expect(meshes[0].name).toBe('Agent A');
      expect(meshes[1].name).toBe('Agent B');
    });

    it('assigns SphereGeometry for agent nodes', () => {
      const graph = createGraph({
        nodes: [createNode({ type: 'agent' })],
        edges: [],
      });
      const result = serializer.toThreeJS(graph);

      const scene = result.object as Record<string, unknown>;
      const children = scene.children as Record<string, unknown>[];
      const mesh = children[0];
      const geometry = mesh.geometry as Record<string, unknown>;
      expect(geometry.type).toBe('SphereGeometry');
    });

    it('assigns BoxGeometry for tool nodes', () => {
      const graph = createGraph({
        nodes: [createNode({ type: 'tool' })],
        edges: [],
      });
      const result = serializer.toThreeJS(graph);

      const scene = result.object as Record<string, unknown>;
      const children = scene.children as Record<string, unknown>[];
      const geometry = children[0].geometry as Record<string, unknown>;
      expect(geometry.type).toBe('BoxGeometry');
    });

    it('assigns CylinderGeometry for memory nodes', () => {
      const graph = createGraph({
        nodes: [createNode({ type: 'memory' })],
        edges: [],
      });
      const result = serializer.toThreeJS(graph);

      const scene = result.object as Record<string, unknown>;
      const children = scene.children as Record<string, unknown>[];
      const geometry = children[0].geometry as Record<string, unknown>;
      expect(geometry.type).toBe('CylinderGeometry');
    });

    it('creates Line objects for edges', () => {
      const graph = createGraph();
      const result = serializer.toThreeJS(graph);

      const scene = result.object as Record<string, unknown>;
      const children = scene.children as Record<string, unknown>[];
      const lines = children.filter((c) => c.type === 'Line');
      expect(lines).toHaveLength(1);
    });

    it('includes camera configuration', () => {
      const graph = createGraph();
      const result = serializer.toThreeJS(graph);

      const camera = result.camera as Record<string, unknown>;
      expect(camera.type).toBe('PerspectiveCamera');
      expect(camera.fov).toBe(60);
    });

    it('includes transformation matrix for nodes', () => {
      const graph = createGraph({
        nodes: [createNode({ position: { x: 5, y: 10, z: 15 }, scale: { x: 2, y: 2, z: 2 } })],
        edges: [],
      });
      const result = serializer.toThreeJS(graph);

      const scene = result.object as Record<string, unknown>;
      const children = scene.children as Record<string, unknown>[];
      const matrix = children[0].matrix as number[];
      // Column-major: [sx,0,0,0, 0,sy,0,0, 0,0,sz,0, tx,ty,tz,1]
      expect(matrix[0]).toBe(2);  // scale.x
      expect(matrix[5]).toBe(2);  // scale.y
      expect(matrix[10]).toBe(2); // scale.z
      expect(matrix[12]).toBe(5); // position.x
      expect(matrix[13]).toBe(10); // position.y
      expect(matrix[14]).toBe(15); // position.z
    });
  });

  // ── toWebXR ───────────────────────────────────────────────

  describe('toWebXR', () => {
    it('generates a WebXR scene description', () => {
      const graph = createGraph();
      const result = serializer.toWebXR(graph);

      expect(result.version).toBe('1.0');
      expect(result.type).toBe('webxr-scene');
      expect(result.generator).toContain('CortexOS');
    });

    it('includes session configuration', () => {
      const result = serializer.toWebXR(createGraph());
      const session = result.session as Record<string, unknown>;
      expect(session.mode).toBe('immersive-ar');
      expect(session.features).toContain('hand-tracking');
    });

    it('creates entities for nodes', () => {
      const graph = createGraph();
      const result = serializer.toWebXR(graph);

      const scene = result.scene as Record<string, unknown>;
      const entities = scene.entities as Record<string, unknown>[];
      expect(entities).toHaveLength(2);
      expect(entities[0].type).toBe('xr-entity');
      expect(entities[0].label).toBe('Agent A');
    });

    it('creates connections for edges', () => {
      const graph = createGraph();
      const result = serializer.toWebXR(graph);

      const scene = result.scene as Record<string, unknown>;
      const connections = scene.connections as Record<string, unknown>[];
      expect(connections).toHaveLength(1);
      expect(connections[0].type).toBe('xr-connection');
    });

    it('scales positions for room-scale XR', () => {
      const graph = createGraph({
        nodes: [createNode({ position: { x: 100, y: 0, z: 0 } })],
        edges: [],
      });
      const result = serializer.toWebXR(graph);

      const scene = result.scene as Record<string, unknown>;
      const entities = scene.entities as Record<string, unknown>[];
      const transform = entities[0].transform as Record<string, unknown>;
      const position = transform.position as Vec3;
      // x: 100 * 0.01 = 1.0, y: 0 * 0.01 + 1.5 = 1.5, z: 0 * 0.01 - 2.0 = -2.0
      expect(position.x).toBeCloseTo(1.0);
      expect(position.y).toBeCloseTo(1.5);
      expect(position.z).toBeCloseTo(-2.0);
    });

    it('scales down node sizes for XR', () => {
      const graph = createGraph({
        nodes: [createNode({ scale: { x: 1, y: 1, z: 1 } })],
        edges: [],
      });
      const result = serializer.toWebXR(graph);

      const scene = result.scene as Record<string, unknown>;
      const entities = scene.entities as Record<string, unknown>[];
      const transform = entities[0].transform as Record<string, unknown>;
      const scale = transform.scale as Vec3;
      expect(scale.x).toBe(0.1);
      expect(scale.y).toBe(0.1);
      expect(scale.z).toBe(0.1);
    });

    it('uses correct XR primitives for node types', () => {
      const types = ['agent', 'tool', 'memory', 'task', 'resource'] as const;
      const expectedPrimitives = ['sphere', 'box', 'cylinder', 'cone', 'octahedron'];

      for (let i = 0; i < types.length; i++) {
        const graph = createGraph({
          nodes: [createNode({ id: `n-${i}`, type: types[i] })],
          edges: [],
        });
        const result = serializer.toWebXR(graph);
        const scene = result.scene as Record<string, unknown>;
        const entities = scene.entities as Record<string, unknown>[];
        const appearance = entities[0].appearance as Record<string, unknown>;
        expect(appearance.primitive).toBe(expectedPrimitives[i]);
      }
    });

    it('includes interaction properties', () => {
      const result = serializer.toWebXR(createGraph());
      const scene = result.scene as Record<string, unknown>;
      const entities = scene.entities as Record<string, unknown>[];
      const interaction = entities[0].interaction as Record<string, boolean>;
      expect(interaction.grabbable).toBe(true);
      expect(interaction.hoverable).toBe(true);
      expect(interaction.clickable).toBe(true);
    });
  });

  // ── toSVG ─────────────────────────────────────────────────

  describe('toSVG', () => {
    it('generates valid SVG markup', () => {
      const graph = createGraph();
      const svg = serializer.toSVG(graph);

      expect(svg).toContain('<svg');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('</svg>');
    });

    it('returns empty SVG for graph with no nodes', () => {
      const graph = createGraph({ nodes: [], edges: [] });
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('<svg');
      expect(svg).not.toContain('<circle');
    });

    it('renders circle for agent nodes', () => {
      const graph = createGraph({
        nodes: [createNode({ type: 'agent' })],
        edges: [],
      });
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('<circle');
    });

    it('renders rect for tool nodes', () => {
      const graph = createGraph({
        nodes: [createNode({ type: 'tool' })],
        edges: [],
      });
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('<rect');
    });

    it('renders ellipse for memory nodes', () => {
      const graph = createGraph({
        nodes: [createNode({ type: 'memory' })],
        edges: [],
      });
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('<ellipse');
    });

    it('renders polygon for task nodes', () => {
      const graph = createGraph({
        nodes: [createNode({ type: 'task' })],
        edges: [],
      });
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('<polygon');
    });

    it('renders polygon for resource nodes', () => {
      const graph = createGraph({
        nodes: [createNode({ type: 'resource' })],
        edges: [],
      });
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('<polygon');
    });

    it('renders line elements for edges', () => {
      const graph = createGraph();
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('<line');
    });

    it('includes node labels as text elements', () => {
      const graph = createGraph({
        nodes: [createNode({ label: 'MyAgent' })],
        edges: [],
      });
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('MyAgent');
      expect(svg).toContain('<text');
    });

    it('includes arrowhead marker definition', () => {
      const graph = createGraph();
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('<marker');
      expect(svg).toContain('arrowhead');
    });

    it('escapes XML special characters in labels', () => {
      const graph = createGraph({
        nodes: [createNode({ label: 'A & B <test>' })],
        edges: [],
      });
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('A &amp; B &lt;test&gt;');
    });

    it('handles animated edges with dash array', () => {
      const graph = createGraph({
        edges: [createEdge({ animated: true })],
      });
      const svg = serializer.toSVG(graph);
      expect(svg).toContain('stroke-dasharray');
    });
  });

  // ── fromJSON ──────────────────────────────────────────────

  describe('fromJSON', () => {
    it('deserializes from a JSON string', () => {
      const json = JSON.stringify({
        id: 'scene-1',
        nodes: [createNode()],
        edges: [],
        camera: { position: { x: 0, y: 0, z: 100 }, target: { x: 0, y: 0, z: 0 }, fov: 60, zoom: 1 },
        metadata: {},
      });

      const result = serializer.fromJSON(json);
      expect(result.id).toBe('scene-1');
      expect(result.nodes).toHaveLength(1);
    });

    it('deserializes from a plain object', () => {
      const data = {
        id: 'scene-2',
        nodes: [createNode()],
        edges: [createEdge()],
        camera: { position: { x: 0, y: 0, z: 50 }, target: { x: 0, y: 0, z: 0 }, fov: 45, zoom: 2 },
        metadata: { key: 'value' },
      };

      const result = serializer.fromJSON(data);
      expect(result.id).toBe('scene-2');
      expect(result.edges).toHaveLength(1);
      expect(result.camera.fov).toBe(45);
    });

    it('provides defaults for missing fields', () => {
      const result = serializer.fromJSON({});
      expect(result.id).toBe('scene_unknown');
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.camera.fov).toBe(60);
    });
  });

  // ── Static utilities ──────────────────────────────────────

  describe('colorFromString', () => {
    it('generates an HSL color string from a string hash', () => {
      const color = SceneSerializer.colorFromString('test-agent');
      expect(color).toMatch(/^hsl\(\d+, 70%, 60%\)$/);
    });

    it('produces deterministic colors for the same input', () => {
      const c1 = SceneSerializer.colorFromString('hello');
      const c2 = SceneSerializer.colorFromString('hello');
      expect(c1).toBe(c2);
    });

    it('produces different colors for different inputs', () => {
      const c1 = SceneSerializer.colorFromString('agent-a');
      const c2 = SceneSerializer.colorFromString('agent-b');
      expect(c1).not.toBe(c2);
    });
  });

  describe('lerp', () => {
    it('interpolates between two Vec3 at t=0', () => {
      const a: Vec3 = { x: 0, y: 0, z: 0 };
      const b: Vec3 = { x: 10, y: 20, z: 30 };
      const result = SceneSerializer.lerp(a, b, 0);
      expect(result).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('interpolates between two Vec3 at t=1', () => {
      const a: Vec3 = { x: 0, y: 0, z: 0 };
      const b: Vec3 = { x: 10, y: 20, z: 30 };
      const result = SceneSerializer.lerp(a, b, 1);
      expect(result).toEqual({ x: 10, y: 20, z: 30 });
    });

    it('interpolates between two Vec3 at t=0.5', () => {
      const a: Vec3 = { x: 0, y: 0, z: 0 };
      const b: Vec3 = { x: 10, y: 20, z: 30 };
      const result = SceneSerializer.lerp(a, b, 0.5);
      expect(result).toEqual({ x: 5, y: 10, z: 15 });
    });

    it('handles negative coordinates', () => {
      const a: Vec3 = { x: -10, y: -20, z: -30 };
      const b: Vec3 = { x: 10, y: 20, z: 30 };
      const result = SceneSerializer.lerp(a, b, 0.5);
      expect(result).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  describe('distance', () => {
    it('returns 0 for same point', () => {
      const p: Vec3 = { x: 5, y: 5, z: 5 };
      expect(SceneSerializer.distance(p, p)).toBe(0);
    });

    it('calculates distance along a single axis', () => {
      const a: Vec3 = { x: 0, y: 0, z: 0 };
      const b: Vec3 = { x: 3, y: 0, z: 0 };
      expect(SceneSerializer.distance(a, b)).toBe(3);
    });

    it('calculates 3D distance correctly', () => {
      const a: Vec3 = { x: 0, y: 0, z: 0 };
      const b: Vec3 = { x: 1, y: 2, z: 2 };
      expect(SceneSerializer.distance(a, b)).toBe(3);
    });

    it('returns same distance regardless of direction', () => {
      const a: Vec3 = { x: 1, y: 2, z: 3 };
      const b: Vec3 = { x: 4, y: 5, z: 6 };
      expect(SceneSerializer.distance(a, b)).toBe(SceneSerializer.distance(b, a));
    });
  });

  describe('normalize', () => {
    it('normalizes a unit vector along x-axis', () => {
      const result = SceneSerializer.normalize({ x: 5, y: 0, z: 0 });
      expect(result.x).toBeCloseTo(1);
      expect(result.y).toBeCloseTo(0);
      expect(result.z).toBeCloseTo(0);
    });

    it('normalizes a vector to unit length', () => {
      const result = SceneSerializer.normalize({ x: 3, y: 4, z: 0 });
      const length = Math.sqrt(result.x ** 2 + result.y ** 2 + result.z ** 2);
      expect(length).toBeCloseTo(1);
    });

    it('returns zero vector for zero-length input', () => {
      const result = SceneSerializer.normalize({ x: 0, y: 0, z: 0 });
      expect(result).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('normalizes a 3D vector correctly', () => {
      const v: Vec3 = { x: 1, y: 1, z: 1 };
      const result = SceneSerializer.normalize(v);
      const expected = 1 / Math.sqrt(3);
      expect(result.x).toBeCloseTo(expected);
      expect(result.y).toBeCloseTo(expected);
      expect(result.z).toBeCloseTo(expected);
    });
  });
});
