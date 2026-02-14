/**
 * TopologyGraph — Scene Graph Management
 *
 * Manages a 3D scene graph of nodes and edges representing agent topologies.
 * Supports multiple layout algorithms including force-directed simulation.
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  SceneGraph,
  SceneNode,
  SceneEdge,
  Vec3,
  CameraState,
  LayoutAlgorithm,
  SpatialConfig,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: SpatialConfig = {
  layout: 'force-directed',
  dimensions: 3,
  physics: true,
};

const DEFAULT_CAMERA: CameraState = {
  position: { x: 0, y: 0, z: 100 },
  target: { x: 0, y: 0, z: 0 },
  fov: 60,
  zoom: 1.0,
};

/** Force-directed simulation parameters */
const REPULSION_STRENGTH = 500;
const ATTRACTION_STRENGTH = 0.01;
const DAMPING = 0.9;
const MIN_DISTANCE = 1;
const SIMULATION_ITERATIONS = 100;

// ═══════════════════════════════════════════════════════════════
// NODE COLORS
// ═══════════════════════════════════════════════════════════════

const NODE_COLORS: Record<string, string> = {
  agent: '#4CAF50',
  tool: '#2196F3',
  memory: '#FF9800',
  task: '#9C27B0',
  resource: '#607D8B',
};

// ═══════════════════════════════════════════════════════════════
// TOPOLOGY GRAPH
// ═══════════════════════════════════════════════════════════════

export class TopologyGraph extends EventEmitter {
  private config: SpatialConfig;
  private nodes: Map<string, SceneNode> = new Map();
  private edges: Map<string, SceneEdge> = new Map();
  private camera: CameraState;
  private metadata: Record<string, unknown> = {};
  private running = false;

  constructor(config?: Partial<SpatialConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.camera = { ...DEFAULT_CAMERA };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('spatial:graph:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('spatial:graph:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // NODE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Add a node to the scene graph.
   */
  addNode(node: SceneNode): SceneNode {
    // Default color by type if not specified
    if (!node.color) {
      node.color = NODE_COLORS[node.type] ?? '#CCCCCC';
    }

    this.nodes.set(node.id, node);

    this.emit('spatial:node:added', {
      timestamp: Date.now(),
      node,
    });

    return node;
  }

  /**
   * Remove a node and all connected edges.
   */
  removeNode(id: string): boolean {
    const deleted = this.nodes.delete(id);

    if (deleted) {
      // Remove all connected edges
      for (const [edgeId, edge] of this.edges) {
        if (edge.source === id || edge.target === id) {
          this.edges.delete(edgeId);
        }
      }

      this.emit('spatial:node:removed', {
        timestamp: Date.now(),
        nodeId: id,
      });
    }

    return deleted;
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): SceneNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all nodes.
   */
  getNodes(): SceneNode[] {
    return [...this.nodes.values()];
  }

  // ─────────────────────────────────────────────────────────
  // EDGE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Add an edge between two nodes.
   */
  addEdge(edge: SceneEdge): SceneEdge {
    if (!this.nodes.has(edge.source)) {
      throw new Error(`Source node not found: ${edge.source}`);
    }
    if (!this.nodes.has(edge.target)) {
      throw new Error(`Target node not found: ${edge.target}`);
    }

    this.edges.set(edge.id, edge);

    this.emit('spatial:edge:added', {
      timestamp: Date.now(),
      edge,
    });

    return edge;
  }

  /**
   * Remove an edge by ID.
   */
  removeEdge(id: string): boolean {
    const deleted = this.edges.delete(id);

    if (deleted) {
      this.emit('spatial:edge:removed', {
        timestamp: Date.now(),
        edgeId: id,
      });
    }

    return deleted;
  }

  /**
   * Get an edge by ID.
   */
  getEdge(id: string): SceneEdge | undefined {
    return this.edges.get(id);
  }

  /**
   * Get all edges.
   */
  getEdges(): SceneEdge[] {
    return [...this.edges.values()];
  }

  // ─────────────────────────────────────────────────────────
  // LAYOUT
  // ─────────────────────────────────────────────────────────

  /**
   * Auto-layout nodes using the specified or configured algorithm.
   */
  layout(algorithm?: LayoutAlgorithm): void {
    const algo = algorithm ?? this.config.layout;

    this.emit('spatial:layout:start', {
      timestamp: Date.now(),
      algorithm: algo,
    });

    switch (algo) {
      case 'force-directed':
        this.forceDirectedLayout();
        break;
      case 'hierarchical':
        this.hierarchicalLayout();
        break;
      case 'circular':
        this.circularLayout();
        break;
      case 'grid':
        this.gridLayout();
        break;
    }

    this.emit('spatial:layout:complete', {
      timestamp: Date.now(),
      algorithm: algo,
      nodeCount: this.nodes.size,
    });
  }

  // ─────────────────────────────────────────────────────────
  // SERIALIZATION
  // ─────────────────────────────────────────────────────────

  /**
   * Serialize as JSON scene graph.
   */
  toJSON(): SceneGraph {
    return {
      id: `scene_${randomUUID().slice(0, 8)}`,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      camera: { ...this.camera },
      metadata: { ...this.metadata },
    };
  }

  /**
   * Load from a JSON scene graph.
   */
  fromJSON(graph: SceneGraph): void {
    this.nodes.clear();
    this.edges.clear();

    for (const node of graph.nodes) {
      this.nodes.set(node.id, node);
    }
    for (const edge of graph.edges) {
      this.edges.set(edge.id, edge);
    }
    this.camera = { ...graph.camera };
    this.metadata = { ...graph.metadata };
  }

  // ─────────────────────────────────────────────────────────
  // TOPOLOGY BUILDING
  // ─────────────────────────────────────────────────────────

  /**
   * Build a graph from CortexOS agent topology data.
   */
  fromAgentTopology(
    agents: Array<{ id: string; name: string; type?: string; data?: Record<string, unknown> }>,
    connections: Array<{ from: string; to: string; type?: string }>,
  ): SceneGraph {
    this.nodes.clear();
    this.edges.clear();

    // Create nodes from agents
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const node: SceneNode = {
        id: agent.id,
        type: (agent.type as SceneNode['type']) ?? 'agent',
        label: agent.name,
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        color: NODE_COLORS[(agent.type as string) ?? 'agent'] ?? '#4CAF50',
        data: agent.data,
      };
      this.nodes.set(node.id, node);
    }

    // Create edges from connections
    for (let i = 0; i < connections.length; i++) {
      const conn = connections[i];
      const edge: SceneEdge = {
        id: `edge_${randomUUID().slice(0, 8)}`,
        source: conn.from,
        target: conn.to,
        type: (conn.type as SceneEdge['type']) ?? 'communication',
        weight: 1,
      };
      if (this.nodes.has(edge.source) && this.nodes.has(edge.target)) {
        this.edges.set(edge.id, edge);
      }
    }

    // Apply layout
    this.layout();

    return this.toJSON();
  }

  // ─────────────────────────────────────────────────────────
  // CAMERA
  // ─────────────────────────────────────────────────────────

  getCamera(): CameraState {
    return { ...this.camera };
  }

  setCamera(camera: Partial<CameraState>): void {
    if (camera.position) this.camera.position = camera.position;
    if (camera.target) this.camera.target = camera.target;
    if (camera.fov !== undefined) this.camera.fov = camera.fov;
    if (camera.zoom !== undefined) this.camera.zoom = camera.zoom;
  }

  // ─────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────

  getStats(): {
    nodeCount: number;
    edgeCount: number;
    nodesByType: Record<string, number>;
    edgesByType: Record<string, number>;
    density: number;
  } {
    const nodesByType: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
    }

    const edgesByType: Record<string, number> = {};
    for (const edge of this.edges.values()) {
      edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;
    }

    const n = this.nodes.size;
    const maxEdges = n > 1 ? n * (n - 1) / 2 : 1;
    const density = this.edges.size / maxEdges;

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      nodesByType,
      edgesByType,
      density: Math.min(1, density),
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Layout algorithms
  // ─────────────────────────────────────────────────────────

  /**
   * Force-directed layout using spring-electric model.
   * Nodes repel each other (Coulomb's law) and edges attract (Hooke's law).
   */
  private forceDirectedLayout(): void {
    const nodeList = [...this.nodes.values()];
    if (nodeList.length === 0) return;

    const is3D = this.config.dimensions === 3;

    // Initialize positions randomly
    for (const node of nodeList) {
      node.position = {
        x: (Math.random() - 0.5) * 100,
        y: (Math.random() - 0.5) * 100,
        z: is3D ? (Math.random() - 0.5) * 100 : 0,
      };
    }

    // Velocity map for simulation
    const velocities = new Map<string, Vec3>();
    for (const node of nodeList) {
      velocities.set(node.id, { x: 0, y: 0, z: 0 });
    }

    // Run simulation
    for (let iter = 0; iter < SIMULATION_ITERATIONS; iter++) {
      // Calculate repulsion forces between all node pairs
      for (let i = 0; i < nodeList.length; i++) {
        for (let j = i + 1; j < nodeList.length; j++) {
          const a = nodeList[i];
          const b = nodeList[j];
          const dx = a.position.x - b.position.x;
          const dy = a.position.y - b.position.y;
          const dz = is3D ? a.position.z - b.position.z : 0;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), MIN_DISTANCE);

          const force = REPULSION_STRENGTH / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          const fz = is3D ? (dz / dist) * force : 0;

          const va = velocities.get(a.id)!;
          const vb = velocities.get(b.id)!;
          va.x += fx; va.y += fy; va.z += fz;
          vb.x -= fx; vb.y -= fy; vb.z -= fz;
        }
      }

      // Calculate attraction forces along edges
      for (const edge of this.edges.values()) {
        const a = this.nodes.get(edge.source);
        const b = this.nodes.get(edge.target);
        if (!a || !b) continue;

        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = is3D ? b.position.z - a.position.z : 0;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const weight = edge.weight ?? 1;
        const force = ATTRACTION_STRENGTH * dist * weight;
        const fx = (dx / Math.max(dist, MIN_DISTANCE)) * force;
        const fy = (dy / Math.max(dist, MIN_DISTANCE)) * force;
        const fz = is3D ? (dz / Math.max(dist, MIN_DISTANCE)) * force : 0;

        const va = velocities.get(a.id)!;
        const vb = velocities.get(b.id)!;
        va.x += fx; va.y += fy; va.z += fz;
        vb.x -= fx; vb.y -= fy; vb.z -= fz;
      }

      // Apply velocities with damping
      for (const node of nodeList) {
        const v = velocities.get(node.id)!;
        node.position.x += v.x;
        node.position.y += v.y;
        if (is3D) node.position.z += v.z;

        v.x *= DAMPING;
        v.y *= DAMPING;
        v.z *= DAMPING;
      }
    }

    // Center the graph
    this.centerNodes(nodeList);
  }

  /**
   * Hierarchical layout: top-down tree based on parent-child relationships.
   */
  private hierarchicalLayout(): void {
    const nodeList = [...this.nodes.values()];
    if (nodeList.length === 0) return;

    const is3D = this.config.dimensions === 3;

    // Find root nodes (nodes with no incoming edges)
    const hasIncoming = new Set<string>();
    for (const edge of this.edges.values()) {
      hasIncoming.add(edge.target);
    }
    const roots = nodeList.filter((n) => !hasIncoming.has(n.id));
    if (roots.length === 0) roots.push(nodeList[0]); // Fallback

    // BFS to assign levels
    const levels = new Map<string, number>();
    const queue: string[] = roots.map((r) => r.id);
    for (const rootId of queue) {
      levels.set(rootId, 0);
    }

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentLevel = levels.get(currentId) ?? 0;

      for (const edge of this.edges.values()) {
        if (edge.source === currentId && !levels.has(edge.target)) {
          levels.set(edge.target, currentLevel + 1);
          queue.push(edge.target);
        }
      }
    }

    // Assign levels for unvisited nodes
    for (const node of nodeList) {
      if (!levels.has(node.id)) {
        levels.set(node.id, 0);
      }
    }

    // Group by level
    const levelGroups = new Map<number, SceneNode[]>();
    for (const node of nodeList) {
      const level = levels.get(node.id)!;
      if (!levelGroups.has(level)) levelGroups.set(level, []);
      levelGroups.get(level)!.push(node);
    }

    // Position nodes
    const levelSpacing = 30;
    const nodeSpacing = 20;

    for (const [level, nodes] of levelGroups) {
      const totalWidth = (nodes.length - 1) * nodeSpacing;
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].position = {
          x: -totalWidth / 2 + i * nodeSpacing,
          y: -level * levelSpacing,
          z: is3D ? 0 : 0,
        };
      }
    }

    this.centerNodes(nodeList);
  }

  /**
   * Circular layout: nodes arranged in a circle.
   */
  private circularLayout(): void {
    const nodeList = [...this.nodes.values()];
    if (nodeList.length === 0) return;

    const is3D = this.config.dimensions === 3;
    const radius = Math.max(20, nodeList.length * 5);
    const angleStep = (2 * Math.PI) / nodeList.length;

    for (let i = 0; i < nodeList.length; i++) {
      const angle = i * angleStep;
      nodeList[i].position = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: is3D ? 0 : 0,
      };
    }
  }

  /**
   * Grid layout: nodes arranged in a rectangular grid.
   */
  private gridLayout(): void {
    const nodeList = [...this.nodes.values()];
    if (nodeList.length === 0) return;

    const is3D = this.config.dimensions === 3;
    const cols = Math.ceil(Math.sqrt(nodeList.length));
    const spacing = 20;

    for (let i = 0; i < nodeList.length; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      nodeList[i].position = {
        x: col * spacing - (cols * spacing) / 2,
        y: row * spacing - (Math.ceil(nodeList.length / cols) * spacing) / 2,
        z: is3D ? 0 : 0,
      };
    }
  }

  /**
   * Center nodes around the origin.
   */
  private centerNodes(nodes: SceneNode[]): void {
    if (nodes.length === 0) return;

    let cx = 0, cy = 0, cz = 0;
    for (const node of nodes) {
      cx += node.position.x;
      cy += node.position.y;
      cz += node.position.z;
    }
    cx /= nodes.length;
    cy /= nodes.length;
    cz /= nodes.length;

    for (const node of nodes) {
      node.position.x -= cx;
      node.position.y -= cy;
      node.position.z -= cz;
    }
  }
}
