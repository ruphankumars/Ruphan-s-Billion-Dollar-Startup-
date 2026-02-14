/**
 * Spatial Computing Types — CortexOS
 *
 * Type definitions for the spatial computing subsystem: 3D scene graphs,
 * topology visualization, force-directed layouts, and export formats.
 */

// ═══════════════════════════════════════════════════════════════
// VECTORS
// ═══════════════════════════════════════════════════════════════

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ═══════════════════════════════════════════════════════════════
// CAMERA
// ═══════════════════════════════════════════════════════════════

export interface CameraState {
  /** Camera position in 3D space */
  position: Vec3;
  /** Point the camera is looking at */
  target: Vec3;
  /** Field of view in degrees */
  fov: number;
  /** Zoom level (1.0 = default) */
  zoom: number;
}

// ═══════════════════════════════════════════════════════════════
// SCENE NODES
// ═══════════════════════════════════════════════════════════════

export type SceneNodeType = 'agent' | 'tool' | 'memory' | 'task' | 'resource';

export interface SceneNode {
  /** Unique node identifier */
  id: string;
  /** Node type for visual rendering */
  type: SceneNodeType;
  /** Display label */
  label: string;
  /** Position in 3D space */
  position: Vec3;
  /** Scale factors */
  scale: Vec3;
  /** CSS color or hex code */
  color: string;
  /** Optional associated data */
  data?: Record<string, unknown>;
  /** Child node IDs for hierarchical layouts */
  children?: string[];
}

// ═══════════════════════════════════════════════════════════════
// SCENE EDGES
// ═══════════════════════════════════════════════════════════════

export type SceneEdgeType = 'dataflow' | 'dependency' | 'communication' | 'hierarchy';

export interface SceneEdge {
  /** Unique edge identifier */
  id: string;
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Edge type for visual rendering */
  type: SceneEdgeType;
  /** Edge weight (affects force-directed layout) */
  weight?: number;
  /** Edge color */
  color?: string;
  /** Whether edge should be animated */
  animated?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// SCENE GRAPH
// ═══════════════════════════════════════════════════════════════

export interface SceneGraph {
  /** Unique scene identifier */
  id: string;
  /** All nodes in the scene */
  nodes: SceneNode[];
  /** All edges in the scene */
  edges: SceneEdge[];
  /** Camera state */
  camera: CameraState;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export type LayoutAlgorithm = 'force-directed' | 'hierarchical' | 'circular' | 'grid';

export interface SpatialConfig {
  /** Layout algorithm */
  layout: LayoutAlgorithm;
  /** Number of dimensions (2 or 3) */
  dimensions: 2 | 3;
  /** Whether physics simulation is enabled */
  physics: boolean;
}
