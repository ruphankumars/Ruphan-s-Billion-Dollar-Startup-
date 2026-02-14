import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphOrchestrator } from '../../../src/agents/graph-orchestrator.js';
import type { AgentNode } from '../../../src/agents/graph-types.js';

/** Helper to build a minimal agent node input. */
function makeNodeInput(overrides?: Partial<Omit<AgentNode, 'id'>>): Omit<AgentNode, 'id'> {
  return {
    agentId: 'agent-default',
    capabilities: ['code-gen'],
    performance: 0.8,
    load: 0,
    maxConcurrency: 10,
    metadata: {},
    ...overrides,
  };
}

describe('GraphOrchestrator', () => {
  let graph: GraphOrchestrator;

  beforeEach(() => {
    graph = new GraphOrchestrator({ topologyUpdateIntervalMs: 0 });
  });

  afterEach(() => {
    graph.stop();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('should create an instance with default config', () => {
      const g = new GraphOrchestrator();
      expect(g).toBeInstanceOf(GraphOrchestrator);
      expect(g.isRunning()).toBe(false);
    });

    it('should accept custom config overrides', () => {
      const g = new GraphOrchestrator({ maxNodes: 2 });
      g.start();
      g.addNode(makeNodeInput({ agentId: 'a1' }));
      g.addNode(makeNodeInput({ agentId: 'a2' }));
      expect(() => g.addNode(makeNodeInput({ agentId: 'a3' }))).toThrow(
        'Maximum node limit reached',
      );
      g.stop();
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should start and report running', () => {
      graph.start();
      expect(graph.isRunning()).toBe(true);
    });

    it('should stop and report not running', () => {
      graph.start();
      graph.stop();
      expect(graph.isRunning()).toBe(false);
    });

    it('should emit lifecycle events', () => {
      const startSpy = vi.fn();
      const stopSpy = vi.fn();
      graph.on('graph:orchestrator:started', startSpy);
      graph.on('graph:orchestrator:stopped', stopSpy);

      graph.start();
      expect(startSpy).toHaveBeenCalledTimes(1);

      graph.stop();
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Node Management ────────────────────────────────────────

  describe('node management', () => {
    beforeEach(() => {
      graph.start();
    });

    it('should add a node with auto-generated ID', () => {
      const node = graph.addNode(makeNodeInput({ agentId: 'agent-1' }));
      expect(node.id).toMatch(/^node_/);
      expect(node.agentId).toBe('agent-1');
      expect(node.capabilities).toEqual(['code-gen']);
    });

    it('should remove a node and return true', () => {
      const node = graph.addNode(makeNodeInput());
      expect(graph.removeNode(node.id)).toBe(true);
    });

    it('should return false when removing non-existent node', () => {
      expect(graph.removeNode('node_fake')).toBe(false);
    });

    it('should remove connected edges when a node is removed', () => {
      const n1 = graph.addNode(makeNodeInput({ agentId: 'a1' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'a2' }));
      graph.addEdge(n1.id, n2.id, 'delegation');

      graph.removeNode(n1.id);
      const topology = graph.getTopology();
      expect(topology.edges.length).toBe(0);
    });

    it('should update a node', () => {
      const node = graph.addNode(makeNodeInput({ performance: 0.5 }));
      const updated = graph.updateNode(node.id, { performance: 0.9 });
      expect(updated.performance).toBe(0.9);
      expect(updated.id).toBe(node.id);
    });

    it('should throw when updating a non-existent node', () => {
      expect(() => graph.updateNode('node_fake', { performance: 1 })).toThrow('Node not found');
    });

    it('should throw when exceeding max node limit', () => {
      const g = new GraphOrchestrator({ maxNodes: 1, topologyUpdateIntervalMs: 0 });
      g.start();
      g.addNode(makeNodeInput());
      expect(() => g.addNode(makeNodeInput())).toThrow('Maximum node limit reached');
      g.stop();
    });
  });

  // ── Edge Management ────────────────────────────────────────

  describe('edge management', () => {
    let n1Id: string;
    let n2Id: string;

    beforeEach(() => {
      graph.start();
      n1Id = graph.addNode(makeNodeInput({ agentId: 'a1' })).id;
      n2Id = graph.addNode(makeNodeInput({ agentId: 'a2' })).id;
    });

    it('should add an edge between two nodes', () => {
      const edge = graph.addEdge(n1Id, n2Id, 'collaboration', 0.7);
      expect(edge.id).toMatch(/^edge_/);
      expect(edge.sourceId).toBe(n1Id);
      expect(edge.targetId).toBe(n2Id);
      expect(edge.weight).toBe(0.7);
      expect(edge.edgeType).toBe('collaboration');
      expect(edge.messageCount).toBe(0);
    });

    it('should clamp edge weight to 0-1 range', () => {
      const edge1 = graph.addEdge(n1Id, n2Id, 'delegation', 1.5);
      expect(edge1.weight).toBe(1);

      const n3Id = graph.addNode(makeNodeInput({ agentId: 'a3' })).id;
      const edge2 = graph.addEdge(n1Id, n3Id, 'delegation', -0.5);
      expect(edge2.weight).toBe(0);
    });

    it('should remove an edge and return true', () => {
      const edge = graph.addEdge(n1Id, n2Id, 'delegation');
      expect(graph.removeEdge(edge.id)).toBe(true);
    });

    it('should return false when removing non-existent edge', () => {
      expect(graph.removeEdge('edge_fake')).toBe(false);
    });

    it('should throw when source node does not exist', () => {
      expect(() => graph.addEdge('node_fake', n2Id, 'delegation')).toThrow(
        'Source node not found',
      );
    });

    it('should throw when target node does not exist', () => {
      expect(() => graph.addEdge(n1Id, 'node_fake', 'delegation')).toThrow(
        'Target node not found',
      );
    });

    it('should throw when exceeding max edge limit', () => {
      const g = new GraphOrchestrator({ maxEdges: 1, topologyUpdateIntervalMs: 0 });
      g.start();
      const a = g.addNode(makeNodeInput({ agentId: 'a' }));
      const b = g.addNode(makeNodeInput({ agentId: 'b' }));
      const c = g.addNode(makeNodeInput({ agentId: 'c' }));
      g.addEdge(a.id, b.id, 'delegation');
      expect(() => g.addEdge(b.id, c.id, 'delegation')).toThrow('Maximum edge limit reached');
      g.stop();
    });
  });

  // ── Agent Selection ────────────────────────────────────────

  describe('selectAgents', () => {
    beforeEach(() => {
      graph.start();
      graph.addNode(
        makeNodeInput({
          agentId: 'code-agent',
          capabilities: ['code-gen', 'review'],
          performance: 0.9,
          load: 2,
          maxConcurrency: 10,
        }),
      );
      graph.addNode(
        makeNodeInput({
          agentId: 'test-agent',
          capabilities: ['testing', 'review'],
          performance: 0.7,
          load: 0,
          maxConcurrency: 5,
        }),
      );
      graph.addNode(
        makeNodeInput({
          agentId: 'doc-agent',
          capabilities: ['documentation'],
          performance: 0.6,
          load: 0,
          maxConcurrency: 5,
        }),
      );
    });

    it('should select agents matching required capabilities', () => {
      const selection = graph.selectAgents(['code-gen'], 2);
      expect(selection.nodeIds.length).toBeLessThanOrEqual(2);
      expect(selection.nodeIds.length).toBeGreaterThanOrEqual(1);
      expect(selection.strategy).toBe('capability-match');
      expect(selection.score).toBeGreaterThan(0);
      expect(selection.reasoning).toContain('code-gen');
    });

    it('should return empty selection when no capabilities match', () => {
      const selection = graph.selectAgents(['quantum-computing'], 5);
      expect(selection.nodeIds.length).toBe(0);
      expect(selection.score).toBe(0);
    });

    it('should respect maxAgents limit', () => {
      const selection = graph.selectAgents(['review'], 1);
      expect(selection.nodeIds.length).toBe(1);
    });

    it('should support performance-based strategy', () => {
      const selection = graph.selectAgents(['review'], 2, 'performance-based');
      expect(selection.strategy).toBe('performance-based');
      expect(selection.nodeIds.length).toBeGreaterThanOrEqual(1);
    });

    it('should support load-balanced strategy', () => {
      const selection = graph.selectAgents(['review'], 2, 'load-balanced');
      expect(selection.strategy).toBe('load-balanced');
    });

    it('should support diversity-maximized strategy', () => {
      const selection = graph.selectAgents(['review'], 2, 'diversity-maximized');
      expect(selection.strategy).toBe('diversity-maximized');
    });

    it('should record selection in history and track stats', () => {
      graph.selectAgents(['code-gen'], 2);
      graph.selectAgents(['review'], 1);

      const stats = graph.getStats();
      expect(stats.totalSelections).toBe(2);
      expect(stats.avgSelectionScore).toBeGreaterThan(0);
    });
  });

  // ── Message Passing ────────────────────────────────────────

  describe('sendMessage', () => {
    let n1Id: string;
    let n2Id: string;

    beforeEach(() => {
      graph.start();
      n1Id = graph.addNode(makeNodeInput({ agentId: 'sender' })).id;
      n2Id = graph.addNode(makeNodeInput({ agentId: 'receiver' })).id;
    });

    it('should send a message between two nodes', () => {
      const msg = graph.sendMessage(n1Id, n2Id, 'task', { data: 42 });
      expect(msg.id).toMatch(/^msg_/);
      expect(msg.sourceNodeId).toBe(n1Id);
      expect(msg.targetNodeId).toBe(n2Id);
      expect(msg.type).toBe('task');
      expect(msg.payload).toEqual({ data: 42 });
    });

    it('should increment edge message count', () => {
      const edge = graph.addEdge(n1Id, n2Id, 'delegation');
      graph.sendMessage(n1Id, n2Id, 'task', {});
      graph.sendMessage(n1Id, n2Id, 'task', {});

      const topology = graph.getTopology();
      const updatedEdge = topology.edges.find((e) => e.id === edge.id);
      expect(updatedEdge!.messageCount).toBe(2);
    });

    it('should throw when source node does not exist', () => {
      expect(() => graph.sendMessage('node_fake', n2Id, 'task', {})).toThrow(
        'Source node not found',
      );
    });

    it('should throw when target node does not exist', () => {
      expect(() => graph.sendMessage(n1Id, 'node_fake', 'task', {})).toThrow(
        'Target node not found',
      );
    });

    it('should track total messages in stats', () => {
      graph.sendMessage(n1Id, n2Id, 'task', {});
      graph.sendMessage(n1Id, n2Id, 'task', {});
      expect(graph.getStats().totalMessages).toBe(2);
    });
  });

  // ── BFS Shortest Path ──────────────────────────────────────

  describe('getShortestPath', () => {
    it('should find a direct path between connected nodes', () => {
      graph.start();
      const n1 = graph.addNode(makeNodeInput({ agentId: 'a' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'b' }));
      graph.addEdge(n1.id, n2.id, 'delegation');

      const path = graph.getShortestPath(n1.id, n2.id);
      expect(path).toEqual([n1.id, n2.id]);
    });

    it('should find a multi-hop path', () => {
      graph.start();
      const n1 = graph.addNode(makeNodeInput({ agentId: 'a' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'b' }));
      const n3 = graph.addNode(makeNodeInput({ agentId: 'c' }));
      graph.addEdge(n1.id, n2.id, 'delegation');
      graph.addEdge(n2.id, n3.id, 'delegation');

      const path = graph.getShortestPath(n1.id, n3.id);
      expect(path).toEqual([n1.id, n2.id, n3.id]);
    });

    it('should return [sourceId] when source equals target', () => {
      graph.start();
      const n1 = graph.addNode(makeNodeInput({ agentId: 'a' }));
      const path = graph.getShortestPath(n1.id, n1.id);
      expect(path).toEqual([n1.id]);
    });

    it('should return empty array when no path exists', () => {
      graph.start();
      const n1 = graph.addNode(makeNodeInput({ agentId: 'a' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'b' }));
      // No edge between them

      const path = graph.getShortestPath(n1.id, n2.id);
      expect(path).toEqual([]);
    });

    it('should return empty array for non-existent nodes', () => {
      graph.start();
      const path = graph.getShortestPath('node_fake1', 'node_fake2');
      expect(path).toEqual([]);
    });
  });

  // ── Topology ───────────────────────────────────────────────

  describe('topology', () => {
    beforeEach(() => {
      graph.start();
    });

    it('should return current topology snapshot', () => {
      const n1 = graph.addNode(makeNodeInput({ agentId: 'a' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'b' }));
      graph.addEdge(n1.id, n2.id, 'delegation');

      const topo = graph.getTopology();
      expect(topo.nodes.length).toBe(2);
      expect(topo.edges.length).toBe(1);
      expect(topo.updatedAt).toBeGreaterThan(0);
    });

    it('should compute topology metrics for empty graph', () => {
      const metrics = graph.getTopologyMetrics();
      expect(metrics.nodeCount).toBe(0);
      expect(metrics.edgeCount).toBe(0);
      expect(metrics.avgDegree).toBe(0);
      expect(metrics.density).toBe(0);
    });

    it('should compute topology metrics for non-empty graph', () => {
      const n1 = graph.addNode(makeNodeInput({ agentId: 'a' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'b' }));
      const n3 = graph.addNode(makeNodeInput({ agentId: 'c' }));
      graph.addEdge(n1.id, n2.id, 'delegation');
      graph.addEdge(n2.id, n3.id, 'collaboration');
      graph.addEdge(n1.id, n3.id, 'feedback');

      const metrics = graph.getTopologyMetrics();
      expect(metrics.nodeCount).toBe(3);
      expect(metrics.edgeCount).toBe(3);
      expect(metrics.avgDegree).toBe(2); // 2*3/3
      expect(metrics.density).toBeGreaterThan(0);
      expect(metrics.density).toBeLessThanOrEqual(1);
    });
  });

  // ── Optimize Topology ──────────────────────────────────────

  describe('optimizeTopology', () => {
    it('should prune weak, unused edges', () => {
      graph.start();
      const n1 = graph.addNode(makeNodeInput({ agentId: 'a' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'b' }));
      // Add a weak edge (weight < 0.1, messageCount = 0)
      graph.addEdge(n1.id, n2.id, 'delegation', 0.05);

      graph.optimizeTopology();

      const topo = graph.getTopology();
      expect(topo.edges.length).toBe(0);
    });

    it('should strengthen frequently-used edges', () => {
      graph.start();
      const n1 = graph.addNode(makeNodeInput({ agentId: 'a' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'b' }));
      const edge = graph.addEdge(n1.id, n2.id, 'delegation', 0.5);

      // Send enough messages to trigger strengthening (>10)
      for (let i = 0; i < 12; i++) {
        graph.sendMessage(n1.id, n2.id, 'task', {});
      }

      graph.optimizeTopology();

      const topo = graph.getTopology();
      const updated = topo.edges.find((e) => e.id === edge.id);
      expect(updated!.weight).toBeGreaterThan(0.5);
    });

    it('should track topology updates in stats', () => {
      graph.start();
      graph.optimizeTopology();
      graph.optimizeTopology();
      expect(graph.getStats().topologyUpdates).toBe(2);
    });
  });

  // ── Learning ───────────────────────────────────────────────

  describe('learnFromOutcome', () => {
    it('should increase node performance on successful outcome', () => {
      graph.start();
      const n1 = graph.addNode(
        makeNodeInput({ agentId: 'learner', capabilities: ['learn'], performance: 0.5 }),
      );

      // Perform a selection so there is history
      graph.selectAgents(['learn'], 1);

      // Learn from success
      graph.learnFromOutcome('0', true, 0.8);

      const topo = graph.getTopology();
      const node = topo.nodes.find((n) => n.id === n1.id);
      expect(node!.performance).toBeGreaterThan(0.5);
    });

    it('should decrease node performance on failed outcome', () => {
      graph.start();
      const n1 = graph.addNode(
        makeNodeInput({ agentId: 'learner', capabilities: ['learn'], performance: 0.5 }),
      );

      graph.selectAgents(['learn'], 1);
      graph.learnFromOutcome('0', false, 0.8);

      const topo = graph.getTopology();
      const node = topo.nodes.find((n) => n.id === n1.id);
      expect(node!.performance).toBeLessThan(0.5);
    });

    it('should update edge weights between selected nodes', () => {
      graph.start();
      const n1 = graph.addNode(
        makeNodeInput({ agentId: 'a', capabilities: ['cap'], performance: 0.8 }),
      );
      const n2 = graph.addNode(
        makeNodeInput({ agentId: 'b', capabilities: ['cap'], performance: 0.7 }),
      );
      const edge = graph.addEdge(n1.id, n2.id, 'collaboration', 0.5);

      graph.selectAgents(['cap'], 2);
      graph.learnFromOutcome('0', true, 0.9);

      const topo = graph.getTopology();
      const updatedEdge = topo.edges.find((e) => e.id === edge.id);
      expect(updatedEdge!.weight).toBeGreaterThan(0.5);
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      const stats = graph.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.totalEdges).toBe(0);
      expect(stats.totalMessages).toBe(0);
      expect(stats.totalSelections).toBe(0);
      expect(stats.avgSelectionScore).toBe(0);
      expect(stats.topologyUpdates).toBe(0);
    });

    it('should reflect current graph state', () => {
      graph.start();
      const n1 = graph.addNode(makeNodeInput({ agentId: 'a' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'b' }));
      graph.addEdge(n1.id, n2.id, 'delegation');
      graph.sendMessage(n1.id, n2.id, 'ping', {});

      const stats = graph.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.totalEdges).toBe(1);
      expect(stats.totalMessages).toBe(1);
    });
  });

  // ── Broadcast ──────────────────────────────────────────────

  describe('broadcastMessage', () => {
    it('should send messages to all connected neighbors', () => {
      graph.start();
      const n1 = graph.addNode(makeNodeInput({ agentId: 'hub' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'spoke-1' }));
      const n3 = graph.addNode(makeNodeInput({ agentId: 'spoke-2' }));
      graph.addEdge(n1.id, n2.id, 'delegation');
      graph.addEdge(n1.id, n3.id, 'delegation');

      const messages = graph.broadcastMessage(n1.id, 'announce', { data: 'hello' });
      expect(messages.length).toBe(2);
      expect(graph.getStats().totalMessages).toBe(2);
    });

    it('should throw when broadcasting from non-existent node', () => {
      graph.start();
      expect(() => graph.broadcastMessage('node_fake', 'ping', {})).toThrow(
        'Source node not found',
      );
    });
  });

  // ── Neighbors ──────────────────────────────────────────────

  describe('getNeighbors', () => {
    it('should return directly connected nodes', () => {
      graph.start();
      const n1 = graph.addNode(makeNodeInput({ agentId: 'center' }));
      const n2 = graph.addNode(makeNodeInput({ agentId: 'left' }));
      const n3 = graph.addNode(makeNodeInput({ agentId: 'right' }));
      graph.addEdge(n1.id, n2.id, 'delegation');
      graph.addEdge(n3.id, n1.id, 'feedback'); // reverse direction

      const neighbors = graph.getNeighbors(n1.id);
      expect(neighbors.length).toBe(2);
      const ids = neighbors.map((n) => n.id);
      expect(ids).toContain(n2.id);
      expect(ids).toContain(n3.id);
    });

    it('should return empty array for isolated node', () => {
      graph.start();
      const n1 = graph.addNode(makeNodeInput({ agentId: 'loner' }));
      expect(graph.getNeighbors(n1.id).length).toBe(0);
    });
  });
});
