/**
 * Graph-of-Agents Orchestrator Types — CortexOS
 *
 * Type definitions for the graph-based agent orchestration subsystem:
 * agent nodes, directed edges, message passing, subset selection,
 * topology metrics, and learning-based optimization.
 *
 * Part of CortexOS Agent Graph Module
 */

// ═══════════════════════════════════════════════════════════════
// AGENT NODES
// ═══════════════════════════════════════════════════════════════

/** A node in the agent graph representing a single agent */
export interface AgentNode {
  /** Unique node identifier */
  id: string;
  /** Agent identifier this node represents */
  agentId: string;
  /** List of capabilities this agent provides */
  capabilities: string[];
  /** Performance score (0-1), updated via learning */
  performance: number;
  /** Current load level (0 to maxConcurrency) */
  load: number;
  /** Maximum concurrent tasks this agent can handle */
  maxConcurrency: number;
  /** Arbitrary metadata attached to the node */
  metadata: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// EDGE TYPES
// ═══════════════════════════════════════════════════════════════

/** Classification of the relationship between two agent nodes */
export type EdgeType =
  | 'delegation'
  | 'collaboration'
  | 'supervision'
  | 'feedback'
  | 'data-flow';

// ═══════════════════════════════════════════════════════════════
// AGENT EDGES
// ═══════════════════════════════════════════════════════════════

/** A directed edge between two agent nodes in the graph */
export interface AgentEdge {
  /** Unique edge identifier */
  id: string;
  /** Source node identifier */
  sourceId: string;
  /** Target node identifier */
  targetId: string;
  /** Edge weight (0-1), higher means stronger connection */
  weight: number;
  /** Average latency in milliseconds for messages on this edge */
  latency: number;
  /** Reliability score (0-1), fraction of successful messages */
  reliability: number;
  /** Total number of messages sent along this edge */
  messageCount: number;
  /** Type of relationship this edge represents */
  edgeType: EdgeType;
}

// ═══════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════

/** A directed message passed between nodes in the graph */
export interface GraphMessage {
  /** Unique message identifier */
  id: string;
  /** Source node that sent the message */
  sourceNodeId: string;
  /** Target node that receives the message */
  targetNodeId: string;
  /** Message type (application-defined) */
  type: string;
  /** Message payload */
  payload: unknown;
  /** Message priority (higher = more urgent) */
  priority: number;
  /** Unix timestamp (ms) when the message was created */
  timestamp: number;
  /** Time-to-live in milliseconds */
  ttl: number;
}

// ═══════════════════════════════════════════════════════════════
// SUBSET SELECTION
// ═══════════════════════════════════════════════════════════════

/** Strategy for selecting a subset of agents for a task */
export type SelectionStrategy =
  | 'capability-match'
  | 'performance-based'
  | 'load-balanced'
  | 'cost-optimized'
  | 'diversity-maximized';

/** Result of agent subset selection */
export interface SubsetSelection {
  /** Node IDs of the selected agents */
  nodeIds: string[];
  /** Overall score of this selection (0-1) */
  score: number;
  /** Strategy used for this selection */
  strategy: SelectionStrategy;
  /** Human-readable explanation of the selection rationale */
  reasoning: string;
}

// ═══════════════════════════════════════════════════════════════
// TOPOLOGY
// ═══════════════════════════════════════════════════════════════

/** Snapshot of the full graph topology */
export interface GraphTopology {
  /** All nodes in the graph */
  nodes: AgentNode[];
  /** All edges in the graph */
  edges: AgentEdge[];
  /** Unix timestamp (ms) when the topology was created */
  createdAt: number;
  /** Unix timestamp (ms) when the topology was last updated */
  updatedAt: number;
}

/** Computed metrics for the graph topology */
export interface TopologyMetrics {
  /** Total number of nodes */
  nodeCount: number;
  /** Total number of edges */
  edgeCount: number;
  /** Average degree (edges per node) */
  avgDegree: number;
  /** Graph density (actual edges / possible edges) */
  density: number;
  /** Average clustering coefficient */
  clustering: number;
  /** Average shortest path length between all reachable pairs */
  avgPathLength: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

/** Configuration for the graph orchestrator */
export interface GraphOrchestratorConfig {
  /** Whether the graph orchestrator is enabled */
  enabled: boolean;
  /** Maximum number of nodes allowed in the graph */
  maxNodes: number;
  /** Maximum number of edges allowed in the graph */
  maxEdges: number;
  /** Maximum size of the message queue */
  messageQueueSize: number;
  /** Interval in ms for periodic topology updates */
  topologyUpdateIntervalMs: number;
  /** Default strategy for agent selection */
  selectionStrategy: SelectionStrategy;
  /** Learning rate for outcome-based updates (0-1) */
  learningRate: number;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

/** Runtime statistics for the graph orchestrator */
export interface GraphOrchestratorStats {
  /** Total number of nodes in the graph */
  totalNodes: number;
  /** Total number of edges in the graph */
  totalEdges: number;
  /** Total messages sent through the graph */
  totalMessages: number;
  /** Total agent selections performed */
  totalSelections: number;
  /** Average score of all selections */
  avgSelectionScore: number;
  /** Number of topology optimization cycles */
  topologyUpdates: number;
}
