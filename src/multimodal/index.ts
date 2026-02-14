/**
 * CortexOS Multi-Modal Input Module
 *
 * Image analysis, diagram parsing, and whiteboard-to-task extraction.
 * Enables agents to consume visual inputs — screenshots, architecture
 * diagrams, whiteboard photos — and convert them into structured data.
 *
 * @example
 * ```typescript
 * import { ImageAnalyzer, DiagramParser, WhiteboardBridge } from 'cortexos';
 *
 * // Analyse a screenshot
 * const analyzer = new ImageAnalyzer();
 * const analysis = await analyzer.analyze('/path/to/screenshot.png');
 * console.log(analysis.width, analysis.height, analysis.format);
 *
 * // Parse a diagram from a text description
 * const parser = new DiagramParser();
 * const diagram = parser.parseFromDescription(`
 *   [Client] -> [API Gateway]: HTTP
 *   [API Gateway] -> [Auth Service]: validate
 *   [API Gateway] -> [Data Service]: query
 *   [Data Service] -> [Database]: SQL
 * `);
 * console.log(parser.toMermaid(diagram));
 *
 * // Extract tasks from a whiteboard
 * const bridge = new WhiteboardBridge();
 * const tasks = bridge.processText(`
 *   - Implement auth flow @alice
 *   - Set up CI/CD pipeline @bob
 *     - Configure staging env
 *     - Add deployment scripts
 *   - Write API docs (nice to have)
 * `);
 * console.log(bridge.toMarkdown(tasks));
 * ```
 */

export { ImageAnalyzer } from './image-analyzer.js';
export { DiagramParser } from './diagram-parser.js';
export { WhiteboardBridge } from './whiteboard-bridge.js';
export type {
  ImageAnalysis,
  UIElement,
  ExtractedCode,
  DiagramAnalysis,
  DiagramNode,
  DiagramConnection,
  WhiteboardTask,
  MultiModalConfig,
  MultiModalStats,
} from './types.js';
