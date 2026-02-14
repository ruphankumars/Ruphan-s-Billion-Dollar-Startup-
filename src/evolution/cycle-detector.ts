/**
 * CycleDetector — Graph-Based Cycle Detection
 *
 * Prevents infinite recursion in all entity resolution, dependency tracking,
 * and recursive agent pipelines. Uses DFS with visited-set tracking.
 *
 * From: Backstage Issue #27063 — self-referencing entities causing cascading failures
 * From: Microsoft STOP — depth-constrained execution
 *
 * Zero external dependencies.
 */

import { EventEmitter } from 'node:events';
import type { CycleDetectorConfig, CycleInfo } from './types.js';

const DEFAULT_CONFIG: Required<CycleDetectorConfig> = {
  maxNodes: 10000,
  realtimeDetection: true,
  maxTraversalDepth: 100,
};

export class CycleDetector extends EventEmitter {
  private config: Required<CycleDetectorConfig>;
  private running = false;
  private graphs: Map<string, Map<string, Set<string>>> = new Map();
  private cyclesDetected = 0;
  private checksPerformed = 0;

  constructor(config?: Partial<CycleDetectorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.graphs.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Create a new graph context.
   */
  createGraph(graphId: string): void {
    this.graphs.set(graphId, new Map());
  }

  /**
   * Add an edge to a graph. If realtime detection is enabled,
   * checks for cycles before adding.
   */
  addEdge(graphId: string, from: string, to: string): CycleInfo | null {
    if (!this.graphs.has(graphId)) {
      this.graphs.set(graphId, new Map());
    }

    const graph = this.graphs.get(graphId)!;

    // Check for self-reference
    if (from === to) {
      this.cyclesDetected++;
      const cycle: CycleInfo = {
        detected: true,
        path: [from, to],
        depth: 0,
        type: 'self-reference',
      };
      this.emit('evolution:cycle:detected', { graphId, cycle });
      return cycle;
    }

    // Realtime cycle detection: check if adding this edge creates a cycle
    if (this.config.realtimeDetection) {
      // Temporarily add edge and check for cycle
      if (!graph.has(from)) graph.set(from, new Set());
      graph.get(from)!.add(to);

      const cycle = this.detectCycleFrom(graph, to, from);
      if (cycle) {
        // Remove the edge that would create a cycle
        graph.get(from)!.delete(to);
        this.cyclesDetected++;
        this.emit('evolution:cycle:detected', { graphId, cycle });
        return cycle;
      }
    } else {
      if (!graph.has(from)) graph.set(from, new Set());
      graph.get(from)!.add(to);
    }

    // Prune if too large
    if (this.getNodeCount(graphId) > this.config.maxNodes) {
      this.pruneGraph(graphId);
    }

    return null;
  }

  /**
   * Remove an edge from a graph.
   */
  removeEdge(graphId: string, from: string, to: string): void {
    const graph = this.graphs.get(graphId);
    if (!graph) return;

    graph.get(from)?.delete(to);
    if (graph.get(from)?.size === 0) {
      graph.delete(from);
    }
  }

  /**
   * Check if adding a specific edge would create a cycle.
   * Does NOT modify the graph.
   */
  wouldCreateCycle(graphId: string, from: string, to: string): boolean {
    if (from === to) return true;

    const graph = this.graphs.get(graphId);
    if (!graph) return false;

    // Check if there's already a path from 'to' to 'from'
    return this.hasPath(graph, to, from);
  }

  /**
   * Detect all cycles in a graph using DFS.
   */
  detectAllCycles(graphId: string): CycleInfo[] {
    this.checksPerformed++;
    const graph = this.graphs.get(graphId);
    if (!graph) return [];

    const cycles: CycleInfo[] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const allNodes = new Set<string>();
    for (const [from, tos] of graph) {
      allNodes.add(from);
      for (const to of tos) allNodes.add(to);
    }

    for (const node of allNodes) {
      if (!visited.has(node)) {
        const path: string[] = [];
        this.dfsDetectCycles(graph, node, visited, recStack, path, cycles);
      }
    }

    this.cyclesDetected += cycles.length;
    return cycles;
  }

  /**
   * Check if a specific node is part of a cycle.
   */
  isInCycle(graphId: string, nodeId: string): boolean {
    const graph = this.graphs.get(graphId);
    if (!graph) return false;

    return this.hasPath(graph, nodeId, nodeId);
  }

  /**
   * Get topological sort of a graph. Returns null if cycles exist.
   */
  topologicalSort(graphId: string): string[] | null {
    const graph = this.graphs.get(graphId);
    if (!graph) return [];

    const allNodes = new Set<string>();
    for (const [from, tos] of graph) {
      allNodes.add(from);
      for (const to of tos) allNodes.add(to);
    }

    const visited = new Set<string>();
    const temp = new Set<string>();
    const result: string[] = [];
    let hasCycle = false;

    const visit = (node: string): void => {
      if (hasCycle) return;
      if (temp.has(node)) {
        hasCycle = true;
        return;
      }
      if (visited.has(node)) return;

      temp.add(node);
      const neighbors = graph.get(node) ?? new Set();
      for (const neighbor of neighbors) {
        visit(neighbor);
      }
      temp.delete(node);
      visited.add(node);
      result.unshift(node);
    };

    for (const node of allNodes) {
      if (!visited.has(node)) {
        visit(node);
      }
    }

    return hasCycle ? null : result;
  }

  /**
   * Validate an entity reference graph for issues.
   * Returns all detected problems.
   */
  validate(graphId: string): {
    valid: boolean;
    selfReferences: string[];
    cycles: CycleInfo[];
    unreachable: string[];
  } {
    const graph = this.graphs.get(graphId);
    if (!graph) {
      return { valid: true, selfReferences: [], cycles: [], unreachable: [] };
    }

    // Find self-references
    const selfReferences: string[] = [];
    for (const [from, tos] of graph) {
      if (tos.has(from)) {
        selfReferences.push(from);
      }
    }

    // Find cycles
    const cycles = this.detectAllCycles(graphId);

    // Find unreachable nodes (no incoming edges)
    const allNodes = new Set<string>();
    const hasIncoming = new Set<string>();
    for (const [from, tos] of graph) {
      allNodes.add(from);
      for (const to of tos) {
        allNodes.add(to);
        hasIncoming.add(to);
      }
    }

    const unreachable = [...allNodes].filter(n =>
      !hasIncoming.has(n) && (graph.get(n)?.size ?? 0) > 0
    );

    return {
      valid: selfReferences.length === 0 && cycles.length === 0,
      selfReferences,
      cycles,
      unreachable,
    };
  }

  /**
   * Get node count for a graph.
   */
  getNodeCount(graphId: string): number {
    const graph = this.graphs.get(graphId);
    if (!graph) return 0;

    const nodes = new Set<string>();
    for (const [from, tos] of graph) {
      nodes.add(from);
      for (const to of tos) nodes.add(to);
    }
    return nodes.size;
  }

  /**
   * Get edge count for a graph.
   */
  getEdgeCount(graphId: string): number {
    const graph = this.graphs.get(graphId);
    if (!graph) return 0;

    let count = 0;
    for (const tos of graph.values()) {
      count += tos.size;
    }
    return count;
  }

  /**
   * DFS cycle detection from a specific starting node.
   */
  private detectCycleFrom(
    graph: Map<string, Set<string>>,
    startNode: string,
    targetNode: string,
    maxDepth: number = this.config.maxTraversalDepth
  ): CycleInfo | null {
    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string, depth: number): CycleInfo | null => {
      if (depth > maxDepth) return null;
      if (node === targetNode) {
        return {
          detected: true,
          path: [...path, node],
          depth,
          type: path.length === 1 ? 'mutual' : 'transitive',
        };
      }
      if (visited.has(node)) return null;

      visited.add(node);
      path.push(node);

      const neighbors = graph.get(node) ?? new Set();
      for (const neighbor of neighbors) {
        const result = dfs(neighbor, depth + 1);
        if (result) return result;
      }

      path.pop();
      return null;
    };

    return dfs(startNode, 0);
  }

  /**
   * DFS to detect all cycles.
   */
  private dfsDetectCycles(
    graph: Map<string, Set<string>>,
    node: string,
    visited: Set<string>,
    recStack: Set<string>,
    path: string[],
    cycles: CycleInfo[]
  ): void {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const neighbors = graph.get(node) ?? new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        this.dfsDetectCycles(graph, neighbor, visited, recStack, path, cycles);
      } else if (recStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = path.indexOf(neighbor);
        const cyclePath = cycleStart >= 0
          ? [...path.slice(cycleStart), neighbor]
          : [node, neighbor];

        cycles.push({
          detected: true,
          path: cyclePath,
          depth: cyclePath.length - 1,
          type: cyclePath.length === 2 ? 'mutual' : 'transitive',
        });
      }
    }

    path.pop();
    recStack.delete(node);
  }

  /**
   * Check if there's a path from source to target.
   */
  private hasPath(graph: Map<string, Set<string>>, source: string, target: string): boolean {
    const visited = new Set<string>();
    const queue = [source];

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node === target && visited.size > 0) return true;

      if (visited.has(node)) continue;
      visited.add(node);

      if (visited.size > this.config.maxTraversalDepth) return false;

      const neighbors = graph.get(node) ?? new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    return false;
  }

  /**
   * Prune graph to stay within maxNodes limit.
   * Removes nodes with no outgoing edges first.
   */
  private pruneGraph(graphId: string): void {
    const graph = this.graphs.get(graphId);
    if (!graph) return;

    // Remove leaf nodes (no outgoing edges)
    const toRemove: string[] = [];
    for (const [node, edges] of graph) {
      if (edges.size === 0) {
        toRemove.push(node);
      }
    }

    for (const node of toRemove) {
      graph.delete(node);
      // Also remove incoming edges to this node
      for (const edges of graph.values()) {
        edges.delete(node);
      }
    }
  }

  /**
   * Delete a graph context.
   */
  deleteGraph(graphId: string): void {
    this.graphs.delete(graphId);
  }

  getStats() {
    let totalNodes = 0;
    let totalEdges = 0;
    for (const graphId of this.graphs.keys()) {
      totalNodes += this.getNodeCount(graphId);
      totalEdges += this.getEdgeCount(graphId);
    }

    return {
      running: this.running,
      graphCount: this.graphs.size,
      totalNodes,
      totalEdges,
      cyclesDetected: this.cyclesDetected,
      checksPerformed: this.checksPerformed,
      config: { ...this.config },
    };
  }
}
