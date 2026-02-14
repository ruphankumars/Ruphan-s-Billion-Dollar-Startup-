/**
 * ImageAnalyzer — Visual Input Analysis
 *
 * Analyses images to detect UI elements, extract code blocks from
 * screenshots, and generate code from detected UI layouts. Uses file
 * header metadata to determine image dimensions and format.
 *
 * Includes placeholder hooks for vision LLM integration (Anthropic, OpenAI).
 * When no external provider is configured, the analyzer uses heuristic
 * metadata-only analysis.
 *
 * Part of CortexOS Multi-Modal Input Module
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import type {
  ImageAnalysis,
  UIElement,
  ExtractedCode,
  MultiModalConfig,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: MultiModalConfig = {
  enabled: true,
  visionProvider: 'local',
  maxImageSize: 20 * 1024 * 1024, // 20 MB
  supportedFormats: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
  ocrEnabled: false,
};

// ═══════════════════════════════════════════════════════════════
// IMAGE FORMAT SIGNATURES
// ═══════════════════════════════════════════════════════════════

/** Magic byte signatures for common image formats. */
const FORMAT_SIGNATURES: Array<{ format: string; bytes: number[]; offset?: number }> = [
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { format: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { format: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { format: 'bmp', bytes: [0x42, 0x4d] },
  { format: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" prefix; "WEBP" at offset 8
];

// ═══════════════════════════════════════════════════════════════
// IMAGE ANALYZER
// ═══════════════════════════════════════════════════════════════

export class ImageAnalyzer extends EventEmitter {
  private config: MultiModalConfig;
  private analysisCount = 0;
  private codeBlockCount = 0;

  constructor(config?: Partial<MultiModalConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  /**
   * Analyse an image from a file path.
   * Reads the file, determines format and dimensions from header bytes,
   * and runs element detection.
   */
  async analyze(imagePath: string): Promise<ImageAnalysis> {
    const buffer = await fs.readFile(imagePath);
    const stat = await fs.stat(imagePath);

    if (stat.size > this.config.maxImageSize) {
      throw new Error(
        `ImageAnalyzer: image "${imagePath}" exceeds max size ` +
        `(${stat.size} > ${this.config.maxImageSize})`,
      );
    }

    const format = this.detectFormat(buffer);
    if (!this.config.supportedFormats.includes(format)) {
      throw new Error(`ImageAnalyzer: unsupported format "${format}"`);
    }

    const { width, height } = this.readDimensions(buffer, format);

    const analysis: ImageAnalysis = {
      id: `img_${randomUUID().slice(0, 8)}`,
      source: imagePath,
      width,
      height,
      format,
      description: `${format.toUpperCase()} image, ${width}x${height}`,
      elements: [],
      codeBlocks: [],
      timestamp: Date.now(),
    };

    // Attempt vision-provider analysis if not local
    if (this.config.visionProvider !== 'local') {
      const enriched = await this.callVisionProvider(buffer, format, analysis);
      if (enriched) {
        analysis.elements = enriched.elements;
        analysis.codeBlocks = enriched.codeBlocks;
        analysis.description = enriched.description;
      }
    }

    this.analysisCount++;
    this.codeBlockCount += analysis.codeBlocks.length;

    this.emit('multimodal:image:analyzed', analysis);
    return analysis;
  }

  /**
   * Analyse an image from a raw Buffer.
   * `format` should be a file extension string (e.g., "png").
   */
  async analyzeBuffer(buffer: Buffer, format: string): Promise<ImageAnalysis> {
    if (buffer.length > this.config.maxImageSize) {
      throw new Error(
        `ImageAnalyzer: buffer exceeds max size (${buffer.length} > ${this.config.maxImageSize})`,
      );
    }

    const detectedFormat = this.detectFormat(buffer) || format;
    const { width, height } = this.readDimensions(buffer, detectedFormat);

    const analysis: ImageAnalysis = {
      id: `img_${randomUUID().slice(0, 8)}`,
      source: `buffer:${detectedFormat}`,
      width,
      height,
      format: detectedFormat,
      description: `${detectedFormat.toUpperCase()} image, ${width}x${height}`,
      elements: [],
      codeBlocks: [],
      timestamp: Date.now(),
    };

    if (this.config.visionProvider !== 'local') {
      const enriched = await this.callVisionProvider(buffer, detectedFormat, analysis);
      if (enriched) {
        analysis.elements = enriched.elements;
        analysis.codeBlocks = enriched.codeBlocks;
        analysis.description = enriched.description;
      }
    }

    this.analysisCount++;
    this.codeBlockCount += analysis.codeBlocks.length;

    this.emit('multimodal:image:analyzed', analysis);
    return analysis;
  }

  // ---------------------------------------------------------------------------
  // Code extraction
  // ---------------------------------------------------------------------------

  /** Extract code blocks from a completed analysis. */
  extractCodeBlocks(analysis: ImageAnalysis): ExtractedCode[] {
    return analysis.codeBlocks;
  }

  // ---------------------------------------------------------------------------
  // UI element detection
  // ---------------------------------------------------------------------------

  /** Extract detected UI elements from a completed analysis. */
  detectUIElements(analysis: ImageAnalysis): UIElement[] {
    return analysis.elements;
  }

  // ---------------------------------------------------------------------------
  // Code generation from UI
  // ---------------------------------------------------------------------------

  /**
   * Generate HTML/CSS from detected UI elements.
   * Creates a basic skeleton layout based on element positions and types.
   */
  generateCodeFromUI(elements: UIElement[]): string {
    if (elements.length === 0) {
      return '<!-- No UI elements detected -->\n<div></div>';
    }

    const lines: string[] = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>Generated UI</title>',
      '  <style>',
      '    * { box-sizing: border-box; margin: 0; padding: 0; }',
      '    body { font-family: system-ui, -apple-system, sans-serif; }',
      '    .container { position: relative; width: 100%; max-width: 1200px; margin: 0 auto; padding: 20px; }',
    ];

    // Generate CSS for each element
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const className = `el-${el.type}-${i}`;
      lines.push(`    .${className} {`);
      lines.push(`      position: absolute;`);
      lines.push(`      left: ${el.bounds.x}px;`);
      lines.push(`      top: ${el.bounds.y}px;`);
      lines.push(`      width: ${el.bounds.width}px;`);
      lines.push(`      height: ${el.bounds.height}px;`);

      switch (el.type) {
        case 'button':
          lines.push(`      background: #2563eb; color: white; border: none; border-radius: 6px;`);
          lines.push(`      cursor: pointer; display: flex; align-items: center; justify-content: center;`);
          lines.push(`      font-size: 14px; font-weight: 500;`);
          break;
        case 'input':
          lines.push(`      border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 12px;`);
          lines.push(`      font-size: 14px; outline: none;`);
          break;
        case 'text':
          lines.push(`      font-size: 14px; color: #111827;`);
          break;
        case 'navigation':
          lines.push(`      background: #f9fafb; border-bottom: 1px solid #e5e7eb;`);
          lines.push(`      display: flex; align-items: center; padding: 0 16px;`);
          break;
        case 'container':
          lines.push(`      background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;`);
          lines.push(`      padding: 16px;`);
          break;
        case 'table':
          lines.push(`      border: 1px solid #e5e7eb; border-collapse: collapse;`);
          break;
        case 'form':
          lines.push(`      background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;`);
          lines.push(`      padding: 24px;`);
          break;
        case 'image':
          lines.push(`      background: #e5e7eb; border-radius: 4px;`);
          lines.push(`      display: flex; align-items: center; justify-content: center;`);
          break;
        default:
          lines.push(`      background: #f3f4f6; border: 1px dashed #d1d5db;`);
      }

      lines.push(`    }`);
    }

    lines.push('  </style>');
    lines.push('</head>');
    lines.push('<body>');
    lines.push('  <div class="container">');

    // Generate HTML elements
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const className = `el-${el.type}-${i}`;
      const label = el.label ?? el.type;

      switch (el.type) {
        case 'button':
          lines.push(`    <button class="${className}">${this.escapeHtml(label)}</button>`);
          break;
        case 'input':
          lines.push(`    <input class="${className}" type="text" placeholder="${this.escapeHtml(label)}" />`);
          break;
        case 'text':
          lines.push(`    <p class="${className}">${this.escapeHtml(label)}</p>`);
          break;
        case 'image':
          lines.push(`    <div class="${className}"><span>Image: ${this.escapeHtml(label)}</span></div>`);
          break;
        case 'table':
          lines.push(`    <table class="${className}"><tr><td>${this.escapeHtml(label)}</td></tr></table>`);
          break;
        case 'form':
          lines.push(`    <form class="${className}"><p>${this.escapeHtml(label)}</p></form>`);
          break;
        default:
          lines.push(`    <div class="${className}">${this.escapeHtml(label)}</div>`);
      }
    }

    lines.push('  </div>');
    lines.push('</body>');
    lines.push('</html>');

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats(): { imagesAnalyzed: number; codeBlocksExtracted: number } {
    return {
      imagesAnalyzed: this.analysisCount,
      codeBlocksExtracted: this.codeBlockCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: format detection
  // ---------------------------------------------------------------------------

  /** Detect image format from magic bytes in the buffer header. */
  private detectFormat(buffer: Buffer): string {
    for (const sig of FORMAT_SIGNATURES) {
      const offset = sig.offset ?? 0;
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[offset + i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        // For WEBP, verify "WEBP" at offset 8
        if (sig.format === 'webp') {
          if (
            buffer[8] === 0x57 &&
            buffer[9] === 0x45 &&
            buffer[10] === 0x42 &&
            buffer[11] === 0x50
          ) {
            return 'webp';
          }
          continue;
        }
        return sig.format;
      }
    }

    // Check for SVG (text-based)
    const head = buffer.subarray(0, 256).toString('utf-8').trim();
    if (head.startsWith('<?xml') || head.startsWith('<svg')) {
      return 'svg';
    }

    return 'unknown';
  }

  // ---------------------------------------------------------------------------
  // Private: dimension reading
  // ---------------------------------------------------------------------------

  /** Read image dimensions from file header bytes. */
  private readDimensions(
    buffer: Buffer,
    format: string,
  ): { width: number; height: number } {
    switch (format) {
      case 'png':
        return this.readPngDimensions(buffer);
      case 'jpg':
      case 'jpeg':
        return this.readJpgDimensions(buffer);
      case 'gif':
        return this.readGifDimensions(buffer);
      case 'bmp':
        return this.readBmpDimensions(buffer);
      case 'webp':
        return this.readWebpDimensions(buffer);
      default:
        return { width: 0, height: 0 };
    }
  }

  /** PNG: width at bytes 16-19, height at 20-23 in IHDR chunk. */
  private readPngDimensions(buffer: Buffer): { width: number; height: number } {
    if (buffer.length < 24) return { width: 0, height: 0 };
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }

  /** JPEG: scan for SOF0/SOF2 marker to find dimensions. */
  private readJpgDimensions(buffer: Buffer): { width: number; height: number } {
    let offset = 2; // Skip SOI marker
    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF0 (0xC0) or SOF2 (0xC2) — baseline or progressive
      if (marker === 0xc0 || marker === 0xc2) {
        if (offset + 9 <= buffer.length) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
      }
      // Skip to next marker
      if (offset + 3 < buffer.length) {
        const segLen = buffer.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      } else {
        break;
      }
    }
    return { width: 0, height: 0 };
  }

  /** GIF: width at bytes 6-7, height at 8-9 (little-endian). */
  private readGifDimensions(buffer: Buffer): { width: number; height: number } {
    if (buffer.length < 10) return { width: 0, height: 0 };
    const width = buffer.readUInt16LE(6);
    const height = buffer.readUInt16LE(8);
    return { width, height };
  }

  /** BMP: width at bytes 18-21, height at 22-25 (little-endian, signed). */
  private readBmpDimensions(buffer: Buffer): { width: number; height: number } {
    if (buffer.length < 26) return { width: 0, height: 0 };
    const width = buffer.readInt32LE(18);
    const height = Math.abs(buffer.readInt32LE(22)); // height can be negative
    return { width, height };
  }

  /** WebP: basic VP8 dimensions at bytes 26-29, or VP8L at 21-24. */
  private readWebpDimensions(buffer: Buffer): { width: number; height: number } {
    if (buffer.length < 30) return { width: 0, height: 0 };

    // Check for VP8 (lossy)
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }

    // Check for VP8L (lossless)
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4c) {
      if (buffer.length < 25) return { width: 0, height: 0 };
      const bits = buffer.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height };
    }

    return { width: 0, height: 0 };
  }

  // ---------------------------------------------------------------------------
  // Private: vision provider hooks
  // ---------------------------------------------------------------------------

  /**
   * Call an external vision provider (Anthropic or OpenAI) to enrich the
   * analysis with detected elements and descriptions.
   *
   * This is a placeholder — in production this would send the image to the
   * provider's multimodal API and parse the structured response.
   */
  private async callVisionProvider(
    _buffer: Buffer,
    _format: string,
    analysis: ImageAnalysis,
  ): Promise<{
    elements: UIElement[];
    codeBlocks: ExtractedCode[];
    description: string;
  } | null> {
    // Placeholder: real implementation would call the vision API.
    // Return null to indicate no enrichment was performed.
    // Consumers should check config.visionProvider and ensure
    // the corresponding API key is set before relying on this.
    void analysis;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private: HTML escaping
  // ---------------------------------------------------------------------------

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
