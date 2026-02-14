/**
 * DiagramParser — Diagram Recognition and Code Generation
 *
 * Parses diagram images or text descriptions to produce structured
 * representations. Can convert detected diagrams to Mermaid or PlantUML
 * syntax for reproducible rendering.
 *
 * Part of CortexOS Multi-Modal Input Module
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import type {
  DiagramAnalysis,
  DiagramNode,
  DiagramConnection,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// DIAGRAM TYPE KEYWORDS
// ═══════════════════════════════════════════════════════════════

const TYPE_KEYWORDS: Record<DiagramAnalysis['type'], string[]> = {
  flowchart: ['start', 'end', 'decision', 'process', 'flow', 'step', 'yes', 'no', 'if', 'then', 'else'],
  sequence: ['actor', 'participant', 'message', 'request', 'response', 'call', 'return', 'activate', 'deactivate'],
  class: ['class', 'interface', 'extends', 'implements', 'abstract', 'method', 'property', 'field', 'attribute', 'inheritance'],
  er: ['entity', 'relationship', 'attribute', 'primary key', 'foreign key', 'one-to-many', 'many-to-many', 'table'],
  architecture: ['service', 'database', 'api', 'gateway', 'queue', 'cache', 'load balancer', 'cdn', 'microservice', 'server', 'client'],
  unknown: [],
};

// ═══════════════════════════════════════════════════════════════
// DIAGRAM PARSER
// ═══════════════════════════════════════════════════════════════

export class DiagramParser extends EventEmitter {
  private parseCount = 0;

  constructor() {
    super();
  }

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse a diagram from an image file.
   * Currently creates a skeleton analysis from the image metadata.
   * Full parsing requires a vision provider (placeholder hook).
   */
  async parse(imagePath: string): Promise<DiagramAnalysis> {
    // Verify file exists
    await fs.access(imagePath);

    const analysis: DiagramAnalysis = {
      id: `diagram_${randomUUID().slice(0, 8)}`,
      type: 'unknown',
      nodes: [],
      connections: [],
      labels: [],
    };

    // In a production system, this would send the image to a vision API
    // and parse the structured response. For now, we return the skeleton.

    this.parseCount++;
    this.emit('multimodal:diagram:parsed', analysis);
    return analysis;
  }

  /**
   * Parse a text description of a diagram into a structured analysis.
   *
   * Accepts descriptions in a simple format:
   * ```
   * [NodeA] -> [NodeB]: label
   * [NodeB] --> [NodeC]
   * [NodeC] <-> [NodeD]: bidirectional
   * ```
   *
   * Nodes are detected from square-bracket references.
   * Connections are detected from arrow operators.
   */
  parseFromDescription(description: string): DiagramAnalysis {
    const lines = description.split('\n').map((l) => l.trim()).filter(Boolean);

    const nodeMap = new Map<string, DiagramNode>();
    const connections: DiagramConnection[] = [];
    const labels: string[] = [];

    let nextX = 50;
    let nextY = 50;

    for (const line of lines) {
      // Try to match connection pattern:  [A] -> [B]: label
      const connMatch = line.match(
        /\[([^\]]+)\]\s*(-->|->|<->|--)\s*\[([^\]]+)\](?:\s*:\s*(.+))?/,
      );

      if (connMatch) {
        const [, fromLabel, arrow, toLabel, connLabel] = connMatch;

        // Register nodes if not already known
        if (!nodeMap.has(fromLabel)) {
          const node = this.createNode(fromLabel, nextX, nextY);
          nodeMap.set(fromLabel, node);
          nextX += 180;
        }
        if (!nodeMap.has(toLabel)) {
          const node = this.createNode(toLabel, nextX, nextY);
          nodeMap.set(toLabel, node);
          nextX += 180;
        }

        // Wrap to next row
        if (nextX > 900) {
          nextX = 50;
          nextY += 120;
        }

        const connectionType = this.arrowToType(arrow);

        connections.push({
          from: nodeMap.get(fromLabel)!.id,
          to: nodeMap.get(toLabel)!.id,
          label: connLabel?.trim(),
          type: connectionType,
        });

        if (connLabel) {
          labels.push(connLabel.trim());
        }

        continue;
      }

      // Try to match standalone node: [NodeName]
      const nodeMatch = line.match(/\[([^\]]+)\]/);
      if (nodeMatch) {
        const nodeLabel = nodeMatch[1];
        if (!nodeMap.has(nodeLabel)) {
          const node = this.createNode(nodeLabel, nextX, nextY);
          nodeMap.set(nodeLabel, node);
          nextX += 180;
          if (nextX > 900) {
            nextX = 50;
            nextY += 120;
          }
        }
        continue;
      }

      // Treat other lines as labels
      if (line.length > 0) {
        labels.push(line);
      }
    }

    const nodes = Array.from(nodeMap.values());
    const type = this.detectDiagramTypeFromData(nodes, connections, labels);

    const analysis: DiagramAnalysis = {
      id: `diagram_${randomUUID().slice(0, 8)}`,
      type,
      nodes,
      connections,
      labels,
      suggestedMermaid: this.toMermaid({
        id: '',
        type,
        nodes,
        connections,
        labels,
      }),
    };

    this.parseCount++;
    this.emit('multimodal:diagram:parsed', analysis);
    return analysis;
  }

  // ---------------------------------------------------------------------------
  // Conversion: Mermaid
  // ---------------------------------------------------------------------------

  /** Convert a diagram analysis to Mermaid syntax. */
  toMermaid(analysis: DiagramAnalysis): string {
    const lines: string[] = [];

    switch (analysis.type) {
      case 'sequence': {
        lines.push('sequenceDiagram');
        for (const conn of analysis.connections) {
          const from = this.findNodeLabel(analysis.nodes, conn.from);
          const to = this.findNodeLabel(analysis.nodes, conn.to);
          const arrow = conn.type === 'dashed' ? '-->>' : '->>';
          const label = conn.label ? `: ${conn.label}` : '';
          lines.push(`    ${from}${arrow}${to}${label}`);
        }
        break;
      }

      case 'class': {
        lines.push('classDiagram');
        for (const node of analysis.nodes) {
          lines.push(`    class ${this.sanitizeMermaidId(node.label)}`);
        }
        for (const conn of analysis.connections) {
          const from = this.sanitizeMermaidId(this.findNodeLabel(analysis.nodes, conn.from));
          const to = this.sanitizeMermaidId(this.findNodeLabel(analysis.nodes, conn.to));
          const arrow = conn.type === 'bidirectional' ? '<|--|>' : '<|--';
          const label = conn.label ? ` : ${conn.label}` : '';
          lines.push(`    ${from} ${arrow} ${to}${label}`);
        }
        break;
      }

      case 'er': {
        lines.push('erDiagram');
        for (const conn of analysis.connections) {
          const from = this.sanitizeMermaidId(this.findNodeLabel(analysis.nodes, conn.from));
          const to = this.sanitizeMermaidId(this.findNodeLabel(analysis.nodes, conn.to));
          const label = conn.label ? ` : "${conn.label}"` : ' : ""';
          lines.push(`    ${from} ||--o{ ${to}${label}`);
        }
        break;
      }

      default: {
        // Default to flowchart
        lines.push('flowchart TD');
        for (const node of analysis.nodes) {
          const id = this.sanitizeMermaidId(node.label);
          lines.push(`    ${id}[${node.label}]`);
        }
        for (const conn of analysis.connections) {
          const from = this.sanitizeMermaidId(this.findNodeLabel(analysis.nodes, conn.from));
          const to = this.sanitizeMermaidId(this.findNodeLabel(analysis.nodes, conn.to));
          const arrow = conn.type === 'dashed' ? '-.->' : '-->';
          const label = conn.label ? `|${conn.label}|` : '';
          lines.push(`    ${from} ${arrow}${label} ${to}`);
        }
      }
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Conversion: PlantUML
  // ---------------------------------------------------------------------------

  /** Convert a diagram analysis to PlantUML syntax. */
  toPlantUML(analysis: DiagramAnalysis): string {
    const lines: string[] = ['@startuml'];

    switch (analysis.type) {
      case 'sequence': {
        for (const node of analysis.nodes) {
          lines.push(`participant "${node.label}" as ${this.sanitizePlantId(node.label)}`);
        }
        for (const conn of analysis.connections) {
          const from = this.sanitizePlantId(this.findNodeLabel(analysis.nodes, conn.from));
          const to = this.sanitizePlantId(this.findNodeLabel(analysis.nodes, conn.to));
          const arrow = conn.type === 'dashed' ? '-->' : '->';
          const label = conn.label ? ` : ${conn.label}` : '';
          lines.push(`${from} ${arrow} ${to}${label}`);
        }
        break;
      }

      case 'class': {
        for (const node of analysis.nodes) {
          lines.push(`class ${this.sanitizePlantId(node.label)} {`);
          lines.push(`}`);
        }
        for (const conn of analysis.connections) {
          const from = this.sanitizePlantId(this.findNodeLabel(analysis.nodes, conn.from));
          const to = this.sanitizePlantId(this.findNodeLabel(analysis.nodes, conn.to));
          const arrow = conn.type === 'bidirectional' ? '<|--|>' : '<|--';
          lines.push(`${from} ${arrow} ${to}`);
        }
        break;
      }

      default: {
        // Activity / flowchart style
        for (const node of analysis.nodes) {
          lines.push(`rectangle "${node.label}" as ${this.sanitizePlantId(node.label)}`);
        }
        for (const conn of analysis.connections) {
          const from = this.sanitizePlantId(this.findNodeLabel(analysis.nodes, conn.from));
          const to = this.sanitizePlantId(this.findNodeLabel(analysis.nodes, conn.to));
          const arrow = conn.type === 'dashed' ? '..>' : '-->';
          const label = conn.label ? ` : ${conn.label}` : '';
          lines.push(`${from} ${arrow} ${to}${label}`);
        }
      }
    }

    lines.push('@enduml');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Diagram type detection
  // ---------------------------------------------------------------------------

  /** Detect diagram type from an existing analysis. */
  detectDiagramType(analysis: DiagramAnalysis): DiagramAnalysis['type'] {
    return this.detectDiagramTypeFromData(
      analysis.nodes,
      analysis.connections,
      analysis.labels,
    );
  }

  // ---------------------------------------------------------------------------
  // Architecture extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract a software architecture description from a diagram analysis.
   * Returns a structured object describing services and their relationships.
   */
  extractArchitecture(analysis: DiagramAnalysis): {
    services: Array<{ name: string; type: string }>;
    connections: Array<{ from: string; to: string; protocol?: string }>;
  } {
    const services = analysis.nodes.map((n) => ({
      name: n.label,
      type: this.inferServiceType(n.label),
    }));

    const connections = analysis.connections.map((c) => ({
      from: this.findNodeLabel(analysis.nodes, c.from),
      to: this.findNodeLabel(analysis.nodes, c.to),
      protocol: c.label,
    }));

    return { services, connections };
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats(): { diagramsParsed: number } {
    return { diagramsParsed: this.parseCount };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createNode(label: string, x: number, y: number): DiagramNode {
    return {
      id: `node_${randomUUID().slice(0, 8)}`,
      label,
      type: 'default',
      bounds: { x, y, width: 150, height: 60 },
    };
  }

  private arrowToType(arrow: string): DiagramConnection['type'] {
    switch (arrow) {
      case '-->': return 'dashed';
      case '<->': return 'bidirectional';
      case '--': return 'line';
      case '->':
      default: return 'arrow';
    }
  }

  private findNodeLabel(nodes: DiagramNode[], id: string): string {
    const node = nodes.find((n) => n.id === id);
    return node?.label ?? id;
  }

  private sanitizeMermaidId(label: string): string {
    return label.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private sanitizePlantId(label: string): string {
    return label.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private detectDiagramTypeFromData(
    nodes: DiagramNode[],
    connections: DiagramConnection[],
    labels: string[],
  ): DiagramAnalysis['type'] {
    const allText = [
      ...nodes.map((n) => n.label.toLowerCase()),
      ...connections.filter((c) => c.label).map((c) => c.label!.toLowerCase()),
      ...labels.map((l) => l.toLowerCase()),
    ].join(' ');

    let bestType: DiagramAnalysis['type'] = 'unknown';
    let bestScore = 0;

    for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
      if (type === 'unknown') continue;
      let score = 0;
      for (const kw of keywords) {
        if (allText.includes(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestType = type as DiagramAnalysis['type'];
      }
    }

    return bestScore >= 2 ? bestType : 'unknown';
  }

  private inferServiceType(label: string): string {
    const lower = label.toLowerCase();
    if (lower.includes('database') || lower.includes('db') || lower.includes('postgres') || lower.includes('mysql') || lower.includes('mongo')) return 'database';
    if (lower.includes('api') || lower.includes('gateway')) return 'api-gateway';
    if (lower.includes('queue') || lower.includes('kafka') || lower.includes('rabbit') || lower.includes('sqs')) return 'message-queue';
    if (lower.includes('cache') || lower.includes('redis') || lower.includes('memcached')) return 'cache';
    if (lower.includes('cdn') || lower.includes('cloudfront')) return 'cdn';
    if (lower.includes('lb') || lower.includes('load balancer') || lower.includes('nginx')) return 'load-balancer';
    if (lower.includes('client') || lower.includes('frontend') || lower.includes('ui') || lower.includes('web')) return 'frontend';
    return 'service';
  }
}
