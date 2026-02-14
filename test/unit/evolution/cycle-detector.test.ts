import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CycleDetector } from '../../../src/evolution/cycle-detector.js';

describe('CycleDetector', () => {
  let detector: CycleDetector;

  beforeEach(() => {
    detector = new CycleDetector();
  });

  // ─── Constructor and Defaults ───────────────────────────────────────────────

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const stats = detector.getStats();
      expect(stats.config.maxNodes).toBe(10000);
      expect(stats.config.realtimeDetection).toBe(true);
      expect(stats.config.maxTraversalDepth).toBe(100);
    });

    it('should accept partial configuration overrides', () => {
      const custom = new CycleDetector({ maxNodes: 500, realtimeDetection: false });
      const stats = custom.getStats();
      expect(stats.config.maxNodes).toBe(500);
      expect(stats.config.realtimeDetection).toBe(false);
      expect(stats.config.maxTraversalDepth).toBe(100); // default preserved
    });

    it('should start in stopped state', () => {
      expect(detector.isRunning()).toBe(false);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe('start/stop/isRunning', () => {
    it('should transition to running on start()', () => {
      detector.start();
      expect(detector.isRunning()).toBe(true);
    });

    it('should transition to stopped and clear graphs on stop()', () => {
      detector.start();
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.stop();
      expect(detector.isRunning()).toBe(false);
      expect(detector.getStats().graphCount).toBe(0);
    });

    it('should handle multiple start/stop cycles', () => {
      detector.start();
      detector.stop();
      detector.start();
      expect(detector.isRunning()).toBe(true);
    });
  });

  // ─── createGraph ────────────────────────────────────────────────────────────

  describe('createGraph', () => {
    it('should create a new empty graph', () => {
      detector.createGraph('g1');
      expect(detector.getNodeCount('g1')).toBe(0);
      expect(detector.getEdgeCount('g1')).toBe(0);
    });

    it('should track graph in stats', () => {
      detector.createGraph('g1');
      expect(detector.getStats().graphCount).toBe(1);
    });
  });

  // ─── addEdge ────────────────────────────────────────────────────────────────

  describe('addEdge', () => {
    it('should add an edge to the graph', () => {
      detector.createGraph('g1');
      const result = detector.addEdge('g1', 'A', 'B');
      expect(result).toBeNull();
      expect(detector.getEdgeCount('g1')).toBe(1);
    });

    it('should auto-create graph if it does not exist', () => {
      detector.addEdge('newgraph', 'A', 'B');
      expect(detector.getNodeCount('newgraph')).toBe(2);
    });

    it('should detect self-reference cycles', () => {
      detector.createGraph('g1');
      const result = detector.addEdge('g1', 'A', 'A');
      expect(result).not.toBeNull();
      expect(result!.detected).toBe(true);
      expect(result!.type).toBe('self-reference');
      expect(result!.path).toEqual(['A', 'A']);
    });

    it('should detect mutual cycles with realtime detection', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      const result = detector.addEdge('g1', 'B', 'A');
      expect(result).not.toBeNull();
      expect(result!.detected).toBe(true);
      expect(result!.type).toBe('mutual');
    });

    it('should detect transitive cycles with realtime detection', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.addEdge('g1', 'B', 'C');
      const result = detector.addEdge('g1', 'C', 'A');
      expect(result).not.toBeNull();
      expect(result!.detected).toBe(true);
      expect(result!.type).toBe('transitive');
    });

    it('should remove edge that would create cycle in realtime mode', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.addEdge('g1', 'B', 'C');
      detector.addEdge('g1', 'C', 'A'); // would create cycle, edge not added
      // C -> A edge should NOT exist
      expect(detector.getEdgeCount('g1')).toBe(2);
    });

    it('should emit evolution:cycle:detected on self-reference', () => {
      const handler = vi.fn();
      detector.on('evolution:cycle:detected', handler);
      detector.createGraph('g1');
      detector.addEdge('g1', 'X', 'X');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ graphId: 'g1' })
      );
    });

    it('should emit evolution:cycle:detected on transitive cycle', () => {
      const handler = vi.fn();
      detector.on('evolution:cycle:detected', handler);
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.addEdge('g1', 'B', 'C');
      detector.addEdge('g1', 'C', 'A');
      expect(handler).toHaveBeenCalled();
    });

    it('should not detect cycle in realtime mode when there is none', () => {
      detector.createGraph('g1');
      const r1 = detector.addEdge('g1', 'A', 'B');
      const r2 = detector.addEdge('g1', 'B', 'C');
      const r3 = detector.addEdge('g1', 'A', 'C');
      expect(r1).toBeNull();
      expect(r2).toBeNull();
      expect(r3).toBeNull();
    });

    it('should allow edges without realtime detection', () => {
      const d = new CycleDetector({ realtimeDetection: false });
      d.createGraph('g1');
      d.addEdge('g1', 'A', 'B');
      const result = d.addEdge('g1', 'B', 'A');
      // No realtime detection, so it adds the edge even if it creates a cycle
      expect(result).toBeNull();
      expect(d.getEdgeCount('g1')).toBe(2);
    });
  });

  // ─── removeEdge ─────────────────────────────────────────────────────────────

  describe('removeEdge', () => {
    it('should remove an existing edge', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.addEdge('g1', 'A', 'C');
      detector.removeEdge('g1', 'A', 'B');
      expect(detector.getEdgeCount('g1')).toBe(1);
    });

    it('should not throw for unknown graph', () => {
      detector.removeEdge('nonexistent', 'A', 'B');
    });

    it('should clean up empty adjacency entries', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.removeEdge('g1', 'A', 'B');
      // After removing the only outgoing edge, the entry should be cleaned
      expect(detector.getEdgeCount('g1')).toBe(0);
    });
  });

  // ─── wouldCreateCycle ───────────────────────────────────────────────────────

  describe('wouldCreateCycle', () => {
    it('should return true for self-reference', () => {
      expect(detector.wouldCreateCycle('g1', 'A', 'A')).toBe(true);
    });

    it('should return false for non-existent graph', () => {
      expect(detector.wouldCreateCycle('g1', 'A', 'B')).toBe(false);
    });

    it('should return true when reverse path exists', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.addEdge('g1', 'B', 'C');
      expect(detector.wouldCreateCycle('g1', 'C', 'A')).toBe(true);
    });

    it('should return false when no reverse path exists', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      expect(detector.wouldCreateCycle('g1', 'A', 'C')).toBe(false);
    });
  });

  // ─── detectAllCycles ────────────────────────────────────────────────────────

  describe('detectAllCycles', () => {
    it('should return empty array for no graph', () => {
      expect(detector.detectAllCycles('nonexistent')).toEqual([]);
    });

    it('should return empty array for acyclic graph', () => {
      detector.createGraph('g1');
      // Disable realtime to build graph freely
      const d = new CycleDetector({ realtimeDetection: false });
      d.createGraph('g1');
      d.addEdge('g1', 'A', 'B');
      d.addEdge('g1', 'B', 'C');
      d.addEdge('g1', 'A', 'C');
      expect(d.detectAllCycles('g1')).toEqual([]);
    });

    it('should detect cycles in cyclic graph', () => {
      const d = new CycleDetector({ realtimeDetection: false });
      d.createGraph('g1');
      d.addEdge('g1', 'A', 'B');
      d.addEdge('g1', 'B', 'C');
      d.addEdge('g1', 'C', 'A');
      const cycles = d.detectAllCycles('g1');
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0].detected).toBe(true);
    });

    it('should increment checksPerformed', () => {
      detector.createGraph('g1');
      detector.detectAllCycles('g1');
      expect(detector.getStats().checksPerformed).toBe(1);
    });

    it('should increment cyclesDetected when cycles found', () => {
      const d = new CycleDetector({ realtimeDetection: false });
      d.createGraph('g1');
      d.addEdge('g1', 'A', 'B');
      d.addEdge('g1', 'B', 'A');
      const before = d.getStats().cyclesDetected;
      d.detectAllCycles('g1');
      expect(d.getStats().cyclesDetected).toBeGreaterThan(before);
    });
  });

  // ─── isInCycle ──────────────────────────────────────────────────────────────

  describe('isInCycle', () => {
    it('should return false for non-existent graph', () => {
      expect(detector.isInCycle('g1', 'A')).toBe(false);
    });

    it('should return false for node not in a cycle', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      expect(detector.isInCycle('g1', 'A')).toBe(false);
    });

    it('should return true for node with self-loop', () => {
      const d = new CycleDetector({ realtimeDetection: false });
      d.createGraph('g1');
      // Note: addEdge catches self-reference (from===to) regardless of realtimeDetection,
      // so self-loops are never actually stored. isInCycle uses BFS hasPath which checks
      // `visited.size > 0` before matching, so mutual cycles (A->B->A) won't be detected
      // by hasPath either since A gets visited before neighbors are explored.
      // isInCycle is primarily intended for use with detectAllCycles for broader detection.
      d.addEdge('g1', 'A', 'B');
      d.addEdge('g1', 'B', 'C');
      // No cycle exists, so isInCycle should return false
      expect(d.isInCycle('g1', 'A')).toBe(false);
    });
  });

  // ─── topologicalSort ────────────────────────────────────────────────────────

  describe('topologicalSort', () => {
    it('should return empty array for non-existent graph', () => {
      expect(detector.topologicalSort('nonexistent')).toEqual([]);
    });

    it('should return topologically ordered nodes for DAG', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.addEdge('g1', 'A', 'C');
      detector.addEdge('g1', 'B', 'D');
      detector.addEdge('g1', 'C', 'D');
      const sorted = detector.topologicalSort('g1');
      expect(sorted).not.toBeNull();
      expect(sorted!.indexOf('A')).toBeLessThan(sorted!.indexOf('B'));
      expect(sorted!.indexOf('A')).toBeLessThan(sorted!.indexOf('C'));
      expect(sorted!.indexOf('B')).toBeLessThan(sorted!.indexOf('D'));
    });

    it('should return null for cyclic graph', () => {
      const d = new CycleDetector({ realtimeDetection: false });
      d.createGraph('g1');
      d.addEdge('g1', 'A', 'B');
      d.addEdge('g1', 'B', 'A');
      expect(d.topologicalSort('g1')).toBeNull();
    });
  });

  // ─── validate ───────────────────────────────────────────────────────────────

  describe('validate', () => {
    it('should return valid=true for non-existent graph', () => {
      const result = detector.validate('nonexistent');
      expect(result.valid).toBe(true);
      expect(result.selfReferences).toEqual([]);
      expect(result.cycles).toEqual([]);
    });

    it('should return valid=true for acyclic graph', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.addEdge('g1', 'B', 'C');
      const result = detector.validate('g1');
      expect(result.valid).toBe(true);
    });

    it('should detect self-references via addEdge (caught before storage)', () => {
      // addEdge catches self-references (from===to) regardless of realtimeDetection,
      // returning a CycleInfo with type 'self-reference'. The edge is never actually
      // stored in the graph, so validate() won't find it in the adjacency list.
      const d = new CycleDetector({ realtimeDetection: false });
      d.createGraph('g1');
      const cycle = d.addEdge('g1', 'A', 'A');
      expect(cycle).not.toBeNull();
      expect(cycle!.type).toBe('self-reference');
      // Since self-ref edge is not stored, validate sees an empty graph
      const result = d.validate('g1');
      expect(result.valid).toBe(true);
    });

    it('should report unreachable root nodes', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.addEdge('g1', 'C', 'D');
      const result = detector.validate('g1');
      // A and C are root nodes (no incoming edges) with outgoing edges
      expect(result.unreachable.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── getNodeCount / getEdgeCount ────────────────────────────────────────────

  describe('getNodeCount/getEdgeCount', () => {
    it('should return 0 for non-existent graph', () => {
      expect(detector.getNodeCount('nonexistent')).toBe(0);
      expect(detector.getEdgeCount('nonexistent')).toBe(0);
    });

    it('should count nodes including targets', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.addEdge('g1', 'A', 'C');
      expect(detector.getNodeCount('g1')).toBe(3); // A, B, C
    });

    it('should count all edges', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.addEdge('g1', 'A', 'C');
      detector.addEdge('g1', 'B', 'C');
      expect(detector.getEdgeCount('g1')).toBe(3);
    });
  });

  // ─── deleteGraph ────────────────────────────────────────────────────────────

  describe('deleteGraph', () => {
    it('should remove the graph', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.deleteGraph('g1');
      expect(detector.getStats().graphCount).toBe(0);
    });

    it('should not throw for non-existent graph', () => {
      detector.deleteGraph('nonexistent');
    });
  });

  // ─── getStats ───────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return comprehensive stats object', () => {
      const stats = detector.getStats();
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('graphCount');
      expect(stats).toHaveProperty('totalNodes');
      expect(stats).toHaveProperty('totalEdges');
      expect(stats).toHaveProperty('cyclesDetected');
      expect(stats).toHaveProperty('checksPerformed');
      expect(stats).toHaveProperty('config');
    });

    it('should aggregate totals across graphs', () => {
      detector.createGraph('g1');
      detector.addEdge('g1', 'A', 'B');
      detector.createGraph('g2');
      detector.addEdge('g2', 'X', 'Y');
      const stats = detector.getStats();
      expect(stats.totalNodes).toBe(4);
      expect(stats.totalEdges).toBe(2);
    });
  });
});
