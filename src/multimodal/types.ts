/**
 * Multi-Modal Input Types
 *
 * Primitives for image analysis, diagram parsing, whiteboard extraction,
 * and UI element detection. Provides structured representations of
 * visual inputs for agent consumption.
 *
 * Part of CortexOS Multi-Modal Input Module
 */

// ---------------------------------------------------------------------------
// Image analysis
// ---------------------------------------------------------------------------

export interface ImageAnalysis {
  id: string;
  source: string;
  width: number;
  height: number;
  format: string;
  description: string;
  elements: UIElement[];
  codeBlocks: ExtractedCode[];
  timestamp: number;
}

export interface UIElement {
  type: 'button' | 'input' | 'text' | 'image' | 'container' | 'navigation' | 'table' | 'form' | 'other';
  label?: string;
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
  properties?: Record<string, unknown>;
}

export interface ExtractedCode {
  language: string;
  code: string;
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
}

// ---------------------------------------------------------------------------
// Diagram analysis
// ---------------------------------------------------------------------------

export interface DiagramAnalysis {
  id: string;
  type: 'flowchart' | 'sequence' | 'class' | 'er' | 'architecture' | 'unknown';
  nodes: DiagramNode[];
  connections: DiagramConnection[];
  labels: string[];
  suggestedMermaid?: string;
}

export interface DiagramNode {
  id: string;
  label: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface DiagramConnection {
  from: string;
  to: string;
  label?: string;
  type: 'arrow' | 'line' | 'dashed' | 'bidirectional';
}

// ---------------------------------------------------------------------------
// Whiteboard
// ---------------------------------------------------------------------------

export interface WhiteboardTask {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  assignee?: string;
  dependencies: string[];
  extractedFrom: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MultiModalConfig {
  enabled: boolean;
  visionProvider: 'anthropic' | 'openai' | 'local';
  maxImageSize: number;
  supportedFormats: string[];
  ocrEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface MultiModalStats {
  imagesAnalyzed: number;
  diagramsParsed: number;
  whiteboardsProcessed: number;
  codeBlocksExtracted: number;
  tasksExtracted: number;
}
