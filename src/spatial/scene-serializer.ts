/**
 * SceneSerializer — Scene Graph Export Formats
 *
 * Converts scene graphs to various output formats for rendering:
 * Three.js JSON, WebXR-compatible scenes, and 2D SVG representations.
 * Zero npm dependencies.
 */

import { EventEmitter } from 'node:events';
import type {
  SceneGraph,
  SceneNode,
  SceneEdge,
  Vec3,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// SCENE SERIALIZER
// ═══════════════════════════════════════════════════════════════

export class SceneSerializer extends EventEmitter {
  constructor() {
    super();
  }

  // ─────────────────────────────────────────────────────────
  // THREE.JS EXPORT
  // ─────────────────────────────────────────────────────────

  /**
   * Convert scene graph to Three.js-compatible Object3D JSON format.
   */
  toThreeJS(graph: SceneGraph): Record<string, unknown> {
    const children: Record<string, unknown>[] = [];

    // Convert nodes to Three.js objects
    for (const node of graph.nodes) {
      const geometry = this.getThreeJSGeometry(node.type);
      const material = {
        type: 'MeshStandardMaterial',
        color: this.colorToHex(node.color),
        metalness: 0.3,
        roughness: 0.7,
      };

      children.push({
        uuid: node.id,
        type: 'Mesh',
        name: node.label,
        geometry,
        material,
        matrix: this.positionToMatrix(node.position, node.scale),
        userData: {
          nodeType: node.type,
          ...node.data,
        },
      });
    }

    // Convert edges to Three.js line objects
    for (const edge of graph.edges) {
      const sourceNode = graph.nodes.find((n) => n.id === edge.source);
      const targetNode = graph.nodes.find((n) => n.id === edge.target);

      if (sourceNode && targetNode) {
        children.push({
          uuid: edge.id,
          type: 'Line',
          name: `edge_${edge.source}_${edge.target}`,
          geometry: {
            type: 'BufferGeometry',
            data: {
              attributes: {
                position: {
                  itemSize: 3,
                  type: 'Float32Array',
                  array: [
                    sourceNode.position.x, sourceNode.position.y, sourceNode.position.z,
                    targetNode.position.x, targetNode.position.y, targetNode.position.z,
                  ],
                },
              },
            },
          },
          material: {
            type: 'LineBasicMaterial',
            color: this.colorToHex(edge.color ?? '#999999'),
            linewidth: edge.weight ?? 1,
          },
          userData: {
            edgeType: edge.type,
            animated: edge.animated ?? false,
          },
        });
      }
    }

    return {
      metadata: {
        version: 4.6,
        type: 'Object',
        generator: 'CortexOS SceneSerializer',
      },
      object: {
        uuid: graph.id,
        type: 'Scene',
        name: 'CortexOS Agent Topology',
        children,
        background: 0x111111,
      },
      camera: {
        type: 'PerspectiveCamera',
        fov: graph.camera.fov,
        position: graph.camera.position,
        lookAt: graph.camera.target,
        zoom: graph.camera.zoom,
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // WEBXR EXPORT
  // ─────────────────────────────────────────────────────────

  /**
   * Convert scene graph to WebXR-compatible scene description.
   * Follows the immersive web conventions for spatial placement.
   */
  toWebXR(graph: SceneGraph): Record<string, unknown> {
    const entities: Record<string, unknown>[] = [];

    for (const node of graph.nodes) {
      entities.push({
        id: node.id,
        type: 'xr-entity',
        label: node.label,
        transform: {
          position: this.scaleForXR(node.position),
          rotation: { x: 0, y: 0, z: 0, w: 1 }, // Identity quaternion
          scale: {
            x: node.scale.x * 0.1, // Scale down for room-scale XR
            y: node.scale.y * 0.1,
            z: node.scale.z * 0.1,
          },
        },
        appearance: {
          primitive: this.getXRPrimitive(node.type),
          color: node.color,
          opacity: 1.0,
        },
        interaction: {
          grabbable: true,
          hoverable: true,
          clickable: true,
        },
        metadata: {
          nodeType: node.type,
          ...node.data,
        },
      });
    }

    // Edges as visual connections
    const connections: Record<string, unknown>[] = [];
    for (const edge of graph.edges) {
      connections.push({
        id: edge.id,
        type: 'xr-connection',
        source: edge.source,
        target: edge.target,
        style: {
          lineType: edge.animated ? 'dashed' : 'solid',
          color: edge.color ?? '#666666',
          width: (edge.weight ?? 1) * 0.002,
        },
      });
    }

    return {
      version: '1.0',
      type: 'webxr-scene',
      generator: 'CortexOS SceneSerializer',
      session: {
        mode: 'immersive-ar',
        features: ['local-floor', 'hand-tracking'],
      },
      scene: {
        id: graph.id,
        entities,
        connections,
        environment: {
          lighting: 'ambient',
          background: 'transparent',
        },
      },
      camera: {
        position: this.scaleForXR(graph.camera.position),
        target: this.scaleForXR(graph.camera.target),
        fov: graph.camera.fov,
      },
      metadata: graph.metadata,
    };
  }

  // ─────────────────────────────────────────────────────────
  // SVG EXPORT
  // ─────────────────────────────────────────────────────────

  /**
   * Convert scene graph to a 2D SVG representation.
   * Projects 3D positions to 2D using simple orthographic projection.
   */
  toSVG(graph: SceneGraph): string {
    if (graph.nodes.length === 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"></svg>';
    }

    // Find bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const node of graph.nodes) {
      minX = Math.min(minX, node.position.x);
      maxX = Math.max(maxX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxY = Math.max(maxY, node.position.y);
    }

    const padding = 60;
    const width = 800;
    const height = 600;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    // Transform function: map world coords to SVG viewport
    const toSVGX = (x: number) => padding + ((x - minX) / rangeX) * (width - 2 * padding);
    const toSVGY = (y: number) => padding + ((y - minY) / rangeY) * (height - 2 * padding);

    const lines: string[] = [];
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
    lines.push('  <defs>');
    lines.push('    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">');
    lines.push('      <polygon points="0 0, 10 3.5, 0 7" fill="#999" />');
    lines.push('    </marker>');
    lines.push('  </defs>');
    lines.push(`  <rect width="${width}" height="${height}" fill="#111111" />`);

    // Draw edges first (behind nodes)
    for (const edge of graph.edges) {
      const source = graph.nodes.find((n) => n.id === edge.source);
      const target = graph.nodes.find((n) => n.id === edge.target);
      if (!source || !target) continue;

      const x1 = toSVGX(source.position.x);
      const y1 = toSVGY(source.position.y);
      const x2 = toSVGX(target.position.x);
      const y2 = toSVGY(target.position.y);
      const color = edge.color ?? '#555555';
      const strokeWidth = (edge.weight ?? 1) * 1.5;
      const dashArray = edge.animated ? 'stroke-dasharray="5,5"' : '';

      lines.push(`  <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${strokeWidth}" ${dashArray} marker-end="url(#arrowhead)" />`);
    }

    // Draw nodes
    for (const node of graph.nodes) {
      const cx = toSVGX(node.position.x);
      const cy = toSVGY(node.position.y);
      const r = this.getNodeRadius(node.type);
      const shape = this.getSVGShape(node, cx, cy, r);

      lines.push(shape);

      // Label
      lines.push(`  <text x="${cx.toFixed(1)}" y="${(cy + r + 14).toFixed(1)}" text-anchor="middle" fill="#CCCCCC" font-size="11" font-family="sans-serif">${this.escapeXml(node.label)}</text>`);
    }

    lines.push('</svg>');
    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────
  // DESERIALIZATION
  // ─────────────────────────────────────────────────────────

  /**
   * Deserialize a scene graph from JSON.
   */
  fromJSON(json: string | Record<string, unknown>): SceneGraph {
    const data = typeof json === 'string' ? JSON.parse(json) as Record<string, unknown> : json;

    return {
      id: (data.id as string) ?? 'scene_unknown',
      nodes: (data.nodes as SceneNode[]) ?? [],
      edges: (data.edges as SceneEdge[]) ?? [],
      camera: (data.camera as SceneGraph['camera']) ?? {
        position: { x: 0, y: 0, z: 100 },
        target: { x: 0, y: 0, z: 0 },
        fov: 60,
        zoom: 1.0,
      },
      metadata: (data.metadata as Record<string, unknown>) ?? {},
    };
  }

  // ─────────────────────────────────────────────────────────
  // STATIC UTILITIES
  // ─────────────────────────────────────────────────────────

  /**
   * Generate a color from a string hash.
   */
  static colorFromString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash % 360);
    return `hsl(${h}, 70%, 60%)`;
  }

  /**
   * Linear interpolation between two Vec3 points.
   */
  static lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }

  /**
   * Calculate the distance between two Vec3 points.
   */
  static distance(a: Vec3, b: Vec3): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Normalize a Vec3 to unit length.
   */
  static normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len === 0) return { x: 0, y: 0, z: 0 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────────────

  /**
   * Get Three.js geometry type based on node type.
   */
  private getThreeJSGeometry(type: string): Record<string, unknown> {
    switch (type) {
      case 'agent':
        return { type: 'SphereGeometry', radius: 2, widthSegments: 32, heightSegments: 16 };
      case 'tool':
        return { type: 'BoxGeometry', width: 3, height: 3, depth: 3 };
      case 'memory':
        return { type: 'CylinderGeometry', radiusTop: 1.5, radiusBottom: 1.5, height: 3 };
      case 'task':
        return { type: 'ConeGeometry', radius: 2, height: 4, radialSegments: 4 };
      case 'resource':
        return { type: 'OctahedronGeometry', radius: 2 };
      default:
        return { type: 'SphereGeometry', radius: 1.5 };
    }
  }

  /**
   * Get WebXR primitive name based on node type.
   */
  private getXRPrimitive(type: string): string {
    switch (type) {
      case 'agent': return 'sphere';
      case 'tool': return 'box';
      case 'memory': return 'cylinder';
      case 'task': return 'cone';
      case 'resource': return 'octahedron';
      default: return 'sphere';
    }
  }

  /**
   * Convert position and scale to a 4x4 transformation matrix (column-major).
   */
  private positionToMatrix(position: Vec3, scale: Vec3): number[] {
    return [
      scale.x, 0, 0, 0,
      0, scale.y, 0, 0,
      0, 0, scale.z, 0,
      position.x, position.y, position.z, 1,
    ];
  }

  /**
   * Scale positions for room-scale XR (divide by 10 to convert to meters).
   */
  private scaleForXR(pos: Vec3): Vec3 {
    return {
      x: pos.x * 0.01,
      y: pos.y * 0.01 + 1.5, // Raise to eye level
      z: pos.z * 0.01 - 2.0, // Place in front of user
    };
  }

  /**
   * Convert a CSS color string to hex number.
   */
  private colorToHex(color: string): number {
    if (color.startsWith('#')) {
      return parseInt(color.slice(1), 16);
    }
    // Named color fallback
    return 0xCCCCCC;
  }

  /**
   * Get SVG node radius based on type.
   */
  private getNodeRadius(type: string): number {
    switch (type) {
      case 'agent': return 12;
      case 'tool': return 10;
      case 'memory': return 9;
      case 'task': return 11;
      case 'resource': return 8;
      default: return 8;
    }
  }

  /**
   * Get SVG shape element for a node.
   */
  private getSVGShape(node: SceneNode, cx: number, cy: number, r: number): string {
    switch (node.type) {
      case 'agent':
        return `  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${node.color}" stroke="#fff" stroke-width="1.5" />`;
      case 'tool':
        return `  <rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="${node.color}" stroke="#fff" stroke-width="1.5" rx="2" />`;
      case 'memory':
        return `  <ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.7).toFixed(1)}" fill="${node.color}" stroke="#fff" stroke-width="1.5" />`;
      case 'task': {
        const pts = [
          `${cx},${cy - r}`,
          `${cx + r},${cy + r * 0.6}`,
          `${cx - r},${cy + r * 0.6}`,
        ].join(' ');
        return `  <polygon points="${pts}" fill="${node.color}" stroke="#fff" stroke-width="1.5" />`;
      }
      case 'resource': {
        const pts = [
          `${cx},${cy - r}`,
          `${cx + r * 0.7},${cy - r * 0.3}`,
          `${cx + r * 0.7},${cy + r * 0.3}`,
          `${cx},${cy + r}`,
          `${cx - r * 0.7},${cy + r * 0.3}`,
          `${cx - r * 0.7},${cy - r * 0.3}`,
        ].join(' ');
        return `  <polygon points="${pts}" fill="${node.color}" stroke="#fff" stroke-width="1.5" />`;
      }
      default:
        return `  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${node.color}" stroke="#fff" stroke-width="1.5" />`;
    }
  }

  /**
   * Escape XML special characters.
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
