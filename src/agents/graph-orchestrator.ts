/**
 * GraphOrchestrator — Graph-of-Agents Orchestration Engine
 *
 * Manages a directed graph of agent nodes and edges, enabling graph-based
 * agent selection, directed message passing, topology analysis, BFS shortest
 * path, diversity-aware subset selection, and outcome-based learning.
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { CircularBuffer } from '../utils/circular-buffer.js';
import type {
  AgentNode,
  AgentEdge,
  EdgeType,
  GraphMessage,
  SubsetSelection,
  SelectionStrategy,
  GraphTopology,
  TopologyMetrics,
  GraphOrchestratorConfig,
  GraphOrchestratorStats,
} from './graph-types.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: GraphOrchestratorConfig = {
  enabled: true,
  maxNodes: 500,
  maxEdges: 5000,
  messageQueueSize: 10_000,
  topologyUpdateIntervalMs: 60_000,
  selectionStrategy: 'capability-match',
  learningRate: 0.1,
};

// ═══════════════════════════════════════════════════════════════
// GRAPH ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

export class GraphOrchestrator extends EventEmitter {
  private config: GraphOrchestratorConfig;
  private nodes: Map<string, AgentNode> = new Map();
  private edges: Map<string, AgentEdge> = new Map();
  private messageQueue: GraphMessage[] = [];
  private selectionHistory = new CircularBuffer<SubsetSelection>(1000);
  private topologyVersion = 0;
  private running = false;
  private updateTimer: ReturnType<typeof setInterval> | null = null;

  // Statistics counters
  private totalMessages = 0;
  private totalSelections = 0;
  private selectionScoreSum = 0;
  private topologyUpdates = 0;

  constructor(config?: Partial<GraphOrchestratorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  /**
   * Start the graph orchestrator and begin periodic topology updates.
   */
  start(): void {
    this.running = true;

    this.updateTimer = setInterval(
      () => this.optimizeTopology(),
      this.config.topologyUpdateIntervalMs,
    );

    this.emit('graph:orchestrator:started', { timestamp: Date.now() });
  }

  /**
   * Stop the graph orchestrator and clear the update timer.
   */
  stop(): void {
    this.running = false;

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    this.emit('graph:orchestrator:stopped', { timestamp: Date.now() });
  }

  /**
   * Whether the orchestrator is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // NODE MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Add a new agent node to the graph.
   * Emits `graph:node:added` on success.
   */
  addNode(node: Omit<AgentNode, 'id'>): AgentNode {
    if (this.nodes.size >= this.config.maxNodes) {
      throw new Error(`Maximum node limit reached (${this.config.maxNodes})`);
    }

    const id = `node_${randomUUID().slice(0, 8)}`;
    const fullNode: AgentNode = { ...node, id };

    this.nodes.set(id, fullNode);
    this.topologyVersion++;

    this.emit('graph:node:added', {
      timestamp: Date.now(),
      node: fullNode,
    });

    return fullNode;
  }

  /**
   * Remove a node and all its connected edges from the graph.
   * Returns true if the node existed and was removed.
   */
  removeNode(nodeId: string): boolean {
    if (!this.nodes.has(nodeId)) {
      return false;
    }

    this.nodes.delete(nodeId);

    // Remove all edges connected to this node
    const edgesToRemove: string[] = [];
    for (const [edgeId, edge] of this.edges) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        edgesToRemove.push(edgeId);
      }
    }
    for (const edgeId of edgesToRemove) {
      this.edges.delete(edgeId);
    }

    this.topologyVersion++;

    this.emit('graph:node:removed', {
      timestamp: Date.now(),
      nodeId,
      edgesRemoved: edgesToRemove.length,
    });

    return true;
  }

  /**
   * Update an existing node with partial updates.
   * Returns the updated node.
   */
  updateNode(
    nodeId: string,
    updates: Partial<Omit<AgentNode, 'id'>>,
  ): AgentNode {
    const existing = this.nodes.get(nodeId);
    if (!existing) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const updated: AgentNode = {
      ...existing,
      ...updates,
      id: existing.id,
    };

    this.nodes.set(nodeId, updated);
    this.topologyVersion++;

    this.emit('graph:node:updated', {
      timestamp: Date.now(),
      node: updated,
    });

    return updated;
  }

  // ─────────────────────────────────────────────────────────
  // EDGE MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Add a directed edge between two nodes.
   * Emits `graph:edge:added` on success.
   */
  addEdge(
    sourceId: string,
    targetId: string,
    edgeType: EdgeType,
    weight = 0.5,
  ): AgentEdge {
    if (this.edges.size >= this.config.maxEdges) {
      throw new Error(`Maximum edge limit reached (${this.config.maxEdges})`);
    }

    if (!this.nodes.has(sourceId)) {
      throw new Error(`Source node not found: ${sourceId}`);
    }
    if (!this.nodes.has(targetId)) {
      throw new Error(`Target node not found: ${targetId}`);
    }

    const id = `edge_${randomUUID().slice(0, 8)}`;

    const edge: AgentEdge = {
      id,
      sourceId,
      targetId,
      weight: Math.max(0, Math.min(1, weight)),
      latency: 0,
      reliability: 1.0,
      messageCount: 0,
      edgeType,
    };

    this.edges.set(id, edge);
    this.topologyVersion++;

    this.emit('graph:edge:added', {
      timestamp: Date.now(),
      edge,
    });

    return edge;
  }

  /**
   * Remove an edge by ID. Returns true if the edge existed and was removed.
   */
  removeEdge(edgeId: string): boolean {
    if (!this.edges.has(edgeId)) {
      return false;
    }

    this.edges.delete(edgeId);
    this.topologyVersion++;

    this.emit('graph:edge:removed', {
      timestamp: Date.now(),
      edgeId,
    });

    return true;
  }

  // ─────────────────────────────────────────────────────────
  // AGENT SELECTION (KEY METHOD)
  // ─────────────────────────────────────────────────────────

  /**
   * Select an optimal subset of agents for a task based on required
   * capabilities, using graph-aware scoring.
   *
   * Algorithm:
   * 1. Filter nodes by capability match
   * 2. Score each candidate:
   *    score = (performance * 0.4) + ((1 - load/maxConcurrency) * 0.3) + (capabilityOverlap * 0.3)
   * 3. For diversity: penalize subsets with >80% overlapping capabilities
   * 4. Select top-N by score
   * 5. Record selection for learning
   */
  selectAgents(
    taskCapabilities: string[],
    maxAgents: number,
    strategy?: SelectionStrategy,
  ): SubsetSelection {
    const effectiveStrategy = strategy ?? this.config.selectionStrategy;

    // Step 1: Filter nodes that have at least one required capability
    const candidates: Array<{ node: AgentNode; score: number }> = [];

    for (const node of this.nodes.values()) {
      const matchingCaps = taskCapabilities.filter((cap) =>
        node.capabilities.includes(cap),
      );

      if (matchingCaps.length === 0) continue;

      // Step 2: Compute score for each candidate
      const capabilityOverlap =
        taskCapabilities.length > 0
          ? matchingCaps.length / taskCapabilities.length
          : 0;

      const loadRatio =
        node.maxConcurrency > 0
          ? node.load / node.maxConcurrency
          : 1;

      let score: number;

      switch (effectiveStrategy) {
        case 'performance-based':
          score =
            node.performance * 0.6 +
            (1 - loadRatio) * 0.2 +
            capabilityOverlap * 0.2;
          break;

        case 'load-balanced':
          score =
            node.performance * 0.2 +
            (1 - loadRatio) * 0.6 +
            capabilityOverlap * 0.2;
          break;

        case 'cost-optimized':
          // Prefer lower-load agents (cheaper to use)
          score =
            node.performance * 0.2 +
            (1 - loadRatio) * 0.4 +
            capabilityOverlap * 0.4;
          break;

        case 'diversity-maximized':
          // Capability overlap weighted higher for diversity calc
          score =
            node.performance * 0.3 +
            (1 - loadRatio) * 0.2 +
            capabilityOverlap * 0.5;
          break;

        case 'capability-match':
        default:
          score =
            node.performance * 0.4 +
            (1 - loadRatio) * 0.3 +
            capabilityOverlap * 0.3;
          break;
      }

      // Bonus for well-connected nodes (edge analysis)
      const connectedEdges = [...this.edges.values()].filter(
        (e) => e.sourceId === node.id || e.targetId === node.id,
      );
      const avgEdgeWeight =
        connectedEdges.length > 0
          ? connectedEdges.reduce((sum, e) => sum + e.weight, 0) / connectedEdges.length
          : 0;
      const connectivityBonus = avgEdgeWeight * 0.1;
      score = Math.min(1, score + connectivityBonus);

      candidates.push({ node, score });
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Step 3: Apply diversity penalty for diversity-maximized strategy
    let selected: Array<{ node: AgentNode; score: number }>;

    if (effectiveStrategy === 'diversity-maximized' && candidates.length > maxAgents) {
      selected = this.selectWithDiversity(candidates, maxAgents, taskCapabilities);
    } else {
      // Step 4: Select top-N
      selected = candidates.slice(0, maxAgents);
    }

    // Compute overall selection score
    const avgScore =
      selected.length > 0
        ? selected.reduce((sum, s) => sum + s.score, 0) / selected.length
        : 0;

    const reasoning = this.buildSelectionReasoning(
      selected,
      taskCapabilities,
      effectiveStrategy,
    );

    // Step 5: Record selection for learning
    const selection: SubsetSelection = {
      nodeIds: selected.map((s) => s.node.id),
      score: Math.round(avgScore * 1000) / 1000,
      strategy: effectiveStrategy,
      reasoning,
    };

    this.selectionHistory.push(selection);
    this.totalSelections++;
    this.selectionScoreSum += selection.score;


    this.emit('graph:agents:selected', {
      timestamp: Date.now(),
      selection,
    });

    return selection;
  }

  // ─────────────────────────────────────────────────────────
  // MESSAGE PASSING
  // ─────────────────────────────────────────────────────────

  /**
   * Send a directed message from one node to another.
   * Updates the edge's message count and emits `graph:message:sent`.
   */
  sendMessage(
    sourceId: string,
    targetId: string,
    type: string,
    payload: unknown,
    priority = 0,
    ttl = 30_000,
  ): GraphMessage {
    if (!this.nodes.has(sourceId)) {
      throw new Error(`Source node not found: ${sourceId}`);
    }
    if (!this.nodes.has(targetId)) {
      throw new Error(`Target node not found: ${targetId}`);
    }

    const message: GraphMessage = {
      id: `msg_${randomUUID().slice(0, 8)}`,
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      type,
      payload,
      priority,
      timestamp: Date.now(),
      ttl,
    };

    // Add to queue, enforce max size
    this.messageQueue.push(message);
    if (this.messageQueue.length > this.config.messageQueueSize) {
      this.messageQueue = this.messageQueue.slice(
        this.messageQueue.length - this.config.messageQueueSize,
      );
    }

    this.totalMessages++;

    // Update edge message count if an edge exists between these nodes
    for (const edge of this.edges.values()) {
      if (edge.sourceId === sourceId && edge.targetId === targetId) {
        edge.messageCount++;
        break;
      }
    }

    this.emit('graph:message:sent', {
      timestamp: Date.now(),
      message,
    });

    return message;
  }

  /**
   * Broadcast a message from a source node to all directly connected nodes.
   */
  broadcastMessage(
    sourceId: string,
    type: string,
    payload: unknown,
  ): GraphMessage[] {
    if (!this.nodes.has(sourceId)) {
      throw new Error(`Source node not found: ${sourceId}`);
    }

    const neighbors = this.getNeighbors(sourceId);
    const messages: GraphMessage[] = [];

    for (const neighbor of neighbors) {
      const msg = this.sendMessage(sourceId, neighbor.id, type, payload);
      messages.push(msg);
    }

    this.emit('graph:message:broadcast', {
      timestamp: Date.now(),
      sourceId,
      recipientCount: messages.length,
    });

    return messages;
  }

  // ─────────────────────────────────────────────────────────
  // GRAPH TRAVERSAL
  // ─────────────────────────────────────────────────────────

  /**
   * Get all nodes directly connected to the given node (via edges
   * in either direction).
   */
  getNeighbors(nodeId: string): AgentNode[] {
    const neighborIds = new Set<string>();

    for (const edge of this.edges.values()) {
      if (edge.sourceId === nodeId) {
        neighborIds.add(edge.targetId);
      } else if (edge.targetId === nodeId) {
        neighborIds.add(edge.sourceId);
      }
    }

    const neighbors: AgentNode[] = [];
    for (const id of neighborIds) {
      const node = this.nodes.get(id);
      if (node) neighbors.push(node);
    }

    return neighbors;
  }

  /**
   * Find the shortest path between two nodes using BFS.
   * Returns an array of node IDs representing the path, or an empty
   * array if no path exists.
   */
  getShortestPath(sourceId: string, targetId: string): string[] {
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) {
      return [];
    }

    if (sourceId === targetId) {
      return [sourceId];
    }

    // Build adjacency list (treat edges as undirected for path finding)
    const adjacency = new Map<string, string[]>();
    for (const node of this.nodes.keys()) {
      adjacency.set(node, []);
    }

    for (const edge of this.edges.values()) {
      adjacency.get(edge.sourceId)?.push(edge.targetId);
      adjacency.get(edge.targetId)?.push(edge.sourceId);
    }

    // BFS
    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue: string[] = [sourceId];
    visited.add(sourceId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current === targetId) {
        // Reconstruct path
        const path: string[] = [];
        let node: string | undefined = targetId;
        while (node !== undefined) {
          path.unshift(node);
          node = parent.get(node);
        }
        return path;
      }

      const neighbors = adjacency.get(current) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          parent.set(neighbor, current);
          queue.push(neighbor);
        }
      }
    }

    // No path found
    return [];
  }

  // ─────────────────────────────────────────────────────────
  // TOPOLOGY
  // ─────────────────────────────────────────────────────────

  /**
   * Get a snapshot of the current graph topology.
   */
  getTopology(): GraphTopology {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      createdAt: 0,
      updatedAt: Date.now(),
    };
  }

  /**
   * Calculate graph metrics for the current topology.
   * Computes node count, edge count, average degree, density,
   * clustering coefficient, and average path length.
   */
  getTopologyMetrics(): TopologyMetrics {
    const nodeCount = this.nodes.size;
    const edgeCount = this.edges.size;

    if (nodeCount === 0) {
      return {
        nodeCount: 0,
        edgeCount: 0,
        avgDegree: 0,
        density: 0,
        clustering: 0,
        avgPathLength: 0,
      };
    }

    // Average degree: total edge endpoints / nodes
    // Each edge contributes 1 to source degree and 1 to target degree
    const avgDegree = nodeCount > 0 ? (2 * edgeCount) / nodeCount : 0;

    // Density: actual edges / possible edges in a directed graph
    const possibleEdges = nodeCount * (nodeCount - 1);
    const density = possibleEdges > 0 ? edgeCount / possibleEdges : 0;

    // Clustering coefficient (average local clustering)
    const clustering = this.computeClusteringCoefficient();

    // Average shortest path length (over all reachable pairs)
    const avgPathLength = this.computeAvgPathLength();

    return {
      nodeCount,
      edgeCount,
      avgDegree: Math.round(avgDegree * 1000) / 1000,
      density: Math.round(density * 1000) / 1000,
      clustering: Math.round(clustering * 1000) / 1000,
      avgPathLength: Math.round(avgPathLength * 1000) / 1000,
    };
  }

  /**
   * Optimize the graph topology by pruning weak edges and
   * strengthening frequently-used paths.
   * Emits `graph:topology:optimized` when complete.
   */
  optimizeTopology(): void {
    const edgesToRemove: string[] = [];
    const edgesToStrengthen: string[] = [];

    for (const [edgeId, edge] of this.edges) {
      // Prune edges with very low weight and no messages
      if (edge.weight < 0.1 && edge.messageCount === 0) {
        edgesToRemove.push(edgeId);
        continue;
      }

      // Strengthen frequently-used edges
      if (edge.messageCount > 10 && edge.weight < 0.9) {
        edge.weight = Math.min(1, edge.weight + this.config.learningRate);
        edgesToStrengthen.push(edgeId);
      }

      // Weaken unreliable edges
      if (edge.reliability < 0.5 && edge.weight > 0.2) {
        edge.weight = Math.max(0, edge.weight - this.config.learningRate * 0.5);
      }
    }

    // Remove pruned edges
    for (const edgeId of edgesToRemove) {
      this.edges.delete(edgeId);
    }

    if (edgesToRemove.length > 0 || edgesToStrengthen.length > 0) {
      this.topologyVersion++;
    }

    this.topologyUpdates++;

    this.emit('graph:topology:optimized', {
      timestamp: Date.now(),
      pruned: edgesToRemove.length,
      strengthened: edgesToStrengthen.length,
      version: this.topologyVersion,
    });
  }

  // ─────────────────────────────────────────────────────────
  // LEARNING
  // ─────────────────────────────────────────────────────────

  /**
   * Update node performance scores and edge weights based on the
   * outcome of a previous selection. Uses the configured learning
   * rate for incremental adjustments.
   */
  learnFromOutcome(
    selectionId: string,
    success: boolean,
    quality: number,
  ): void {
    // Find the selection in history by matching index.
    // (selectionId is treated as the index in the history)
    // Since selectionHistory is a CircularBuffer, convert to array for index access.
    const historyArray = this.selectionHistory.toArray();
    const selectionIndex = parseInt(selectionId, 10);
    const selection =
      !isNaN(selectionIndex) && selectionIndex >= 0 && selectionIndex < historyArray.length
        ? historyArray[selectionIndex]
        : this.selectionHistory.latest();

    if (!selection) return;

    const lr = this.config.learningRate;
    const reward = success ? quality : -quality * 0.5;

    // Update performance for each node in the selection
    for (const nodeId of selection.nodeIds) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;

      // Incremental performance update
      node.performance = Math.max(
        0,
        Math.min(1, node.performance + lr * reward),
      );
    }

    // Update edge weights between selected nodes
    for (let i = 0; i < selection.nodeIds.length; i++) {
      for (let j = i + 1; j < selection.nodeIds.length; j++) {
        const nodeA = selection.nodeIds[i];
        const nodeB = selection.nodeIds[j];

        // Find edge between these nodes
        for (const edge of this.edges.values()) {
          if (
            (edge.sourceId === nodeA && edge.targetId === nodeB) ||
            (edge.sourceId === nodeB && edge.targetId === nodeA)
          ) {
            edge.weight = Math.max(
              0,
              Math.min(1, edge.weight + lr * reward * 0.5),
            );
            if (success) {
              edge.reliability = Math.min(
                1,
                edge.reliability + lr * 0.1,
              );
            } else {
              edge.reliability = Math.max(
                0,
                edge.reliability - lr * 0.1,
              );
            }
            break;
          }
        }
      }
    }

    this.emit('graph:learning:updated', {
      timestamp: Date.now(),
      selectionNodeIds: selection.nodeIds,
      success,
      quality,
    });
  }

  // ─────────────────────────────────────────────────────────
  // STATISTICS
  // ─────────────────────────────────────────────────────────

  /**
   * Get current runtime statistics for the graph orchestrator.
   */
  getStats(): GraphOrchestratorStats {
    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      totalMessages: this.totalMessages,
      totalSelections: this.totalSelections,
      avgSelectionScore:
        this.totalSelections > 0
          ? Math.round((this.selectionScoreSum / this.totalSelections) * 1000) / 1000
          : 0,
      topologyUpdates: this.topologyUpdates,
    };
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────

  /**
   * Select agents with diversity penalty: avoid subsets where >80%
   * of capabilities overlap between any two selected agents.
   */
  private selectWithDiversity(
    candidates: Array<{ node: AgentNode; score: number }>,
    maxAgents: number,
    taskCapabilities: string[],
  ): Array<{ node: AgentNode; score: number }> {
    const selected: Array<{ node: AgentNode; score: number }> = [];

    for (const candidate of candidates) {
      if (selected.length >= maxAgents) break;

      // Check overlap with already-selected agents
      let tooSimilar = false;
      for (const existing of selected) {
        const overlap = this.computeCapabilityOverlap(
          candidate.node.capabilities,
          existing.node.capabilities,
        );
        if (overlap > 0.8) {
          tooSimilar = true;
          break;
        }
      }

      if (!tooSimilar) {
        selected.push(candidate);
      }
    }

    // If we could not fill the slots due to diversity constraints,
    // fill remaining from top candidates not yet selected
    if (selected.length < maxAgents) {
      const selectedIds = new Set(selected.map((s) => s.node.id));
      for (const candidate of candidates) {
        if (selected.length >= maxAgents) break;
        if (!selectedIds.has(candidate.node.id)) {
          selected.push(candidate);
        }
      }
    }

    return selected;
  }

  /**
   * Compute the fraction of overlapping capabilities between two
   * capability arrays. Returns 0-1.
   */
  private computeCapabilityOverlap(
    capsA: string[],
    capsB: string[],
  ): number {
    if (capsA.length === 0 && capsB.length === 0) return 1;
    if (capsA.length === 0 || capsB.length === 0) return 0;

    const setA = new Set(capsA);
    const setB = new Set(capsB);
    let intersection = 0;

    for (const cap of setA) {
      if (setB.has(cap)) intersection++;
    }

    const union = new Set([...capsA, ...capsB]).size;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Build a human-readable explanation of why particular agents
   * were selected.
   */
  private buildSelectionReasoning(
    selected: Array<{ node: AgentNode; score: number }>,
    taskCapabilities: string[],
    strategy: SelectionStrategy,
  ): string {
    if (selected.length === 0) {
      return `No agents found matching capabilities: ${taskCapabilities.join(', ')}`;
    }

    const parts: string[] = [
      `Strategy: ${strategy}.`,
      `Selected ${selected.length} agent(s) for capabilities: [${taskCapabilities.join(', ')}].`,
    ];

    for (const { node, score } of selected) {
      const matchedCaps = taskCapabilities.filter((cap) =>
        node.capabilities.includes(cap),
      );
      parts.push(
        `  - ${node.id} (agent: ${node.agentId}): score=${score.toFixed(3)}, ` +
          `perf=${node.performance.toFixed(2)}, ` +
          `load=${node.load}/${node.maxConcurrency}, ` +
          `matched=[${matchedCaps.join(', ')}]`,
      );
    }

    return parts.join(' ');
  }

  /**
   * Compute the average local clustering coefficient for the graph.
   * For each node, measures how many of its neighbors are connected
   * to each other.
   */
  private computeClusteringCoefficient(): number {
    if (this.nodes.size < 3) return 0;

    let totalCoeff = 0;
    let measurableNodes = 0;

    for (const nodeId of this.nodes.keys()) {
      const neighborIds = new Set<string>();

      for (const edge of this.edges.values()) {
        if (edge.sourceId === nodeId) neighborIds.add(edge.targetId);
        if (edge.targetId === nodeId) neighborIds.add(edge.sourceId);
      }

      const k = neighborIds.size;
      if (k < 2) continue;

      // Count edges between neighbors
      let edgesBetweenNeighbors = 0;
      const neighborArray = [...neighborIds];

      for (let i = 0; i < neighborArray.length; i++) {
        for (let j = i + 1; j < neighborArray.length; j++) {
          for (const edge of this.edges.values()) {
            if (
              (edge.sourceId === neighborArray[i] && edge.targetId === neighborArray[j]) ||
              (edge.sourceId === neighborArray[j] && edge.targetId === neighborArray[i])
            ) {
              edgesBetweenNeighbors++;
              break;
            }
          }
        }
      }

      const possibleEdges = (k * (k - 1)) / 2;
      totalCoeff += edgesBetweenNeighbors / possibleEdges;
      measurableNodes++;
    }

    return measurableNodes > 0 ? totalCoeff / measurableNodes : 0;
  }

  /**
   * Estimate the average shortest path length by sampling random pairs.
   * Samples up to 50 random pairs instead of computing all O(N^2) pairs
   * (which requires O(N^2) BFS calls, effectively O(N^3) for dense graphs).
   */
  private computeAvgPathLength(): number {
    const nodeIds = [...this.nodes.keys()];
    if (nodeIds.length < 2) return 0;

    const MAX_PAIRS = 50;
    const totalPairs = nodeIds.length * (nodeIds.length - 1);
    let totalLength = 0;
    let pathCount = 0;

    if (totalPairs <= MAX_PAIRS) {
      // Small graph: compute all pairs exactly
      for (const source of nodeIds) {
        for (const target of nodeIds) {
          if (source === target) continue;
          const path = this.getShortestPath(source, target);
          if (path.length > 1) {
            totalLength += path.length - 1;
            pathCount++;
          }
        }
      }
    } else {
      // Large graph: sample random pairs
      const sampled = new Set<string>();
      let attempts = 0;
      const maxAttempts = MAX_PAIRS * 3; // avoid infinite loop on sparse graphs

      while (sampled.size < MAX_PAIRS && attempts < maxAttempts) {
        attempts++;
        const srcIdx = Math.floor(Math.random() * nodeIds.length);
        const tgtIdx = Math.floor(Math.random() * nodeIds.length);
        if (srcIdx === tgtIdx) continue;

        const pairKey = `${srcIdx}:${tgtIdx}`;
        if (sampled.has(pairKey)) continue;
        sampled.add(pairKey);

        const path = this.getShortestPath(nodeIds[srcIdx], nodeIds[tgtIdx]);
        if (path.length > 1) {
          totalLength += path.length - 1;
          pathCount++;
        }
      }
    }

    return pathCount > 0 ? totalLength / pathCount : 0;
  }
}
