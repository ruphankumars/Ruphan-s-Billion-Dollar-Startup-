import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImageAnalyzer } from '../../../src/multimodal/image-analyzer.js';
import type { ImageAnalysis, UIElement } from '../../../src/multimodal/types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Helpers ────────────────────────────────────────────────────

/** Build a minimal valid PNG buffer with the given dimensions. */
function makePngBuffer(width: number, height: number): Buffer {
  // PNG signature (8 bytes) + IHDR chunk (25 bytes)
  const buf = Buffer.alloc(33);

  // PNG signature
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) buf[i] = signature[i];

  // IHDR length (13 bytes)
  buf.writeUInt32BE(13, 8);

  // "IHDR" ascii
  buf[12] = 0x49; buf[13] = 0x48; buf[14] = 0x44; buf[15] = 0x52;

  // Width and height (big-endian)
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);

  // Bit depth, color type, compression, filter, interlace
  buf[24] = 8; // bit depth
  buf[25] = 2; // color type (truecolor)
  buf[26] = 0; // compression
  buf[27] = 0; // filter
  buf[28] = 0; // interlace

  return buf;
}

/** Build a minimal GIF89a buffer. */
function makeGifBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(13);
  // GIF89a signature
  buf[0] = 0x47; buf[1] = 0x49; buf[2] = 0x46; buf[3] = 0x38; buf[4] = 0x39; buf[5] = 0x61;
  // Width and height (little-endian)
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ImageAnalyzer', () => {
  let analyzer: ImageAnalyzer;
  let tmpDir: string;

  beforeEach(async () => {
    analyzer = new ImageAnalyzer();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-img-test-'));
  });

  // ─── analyze (file-based) ─────────────────────────────────────

  describe('analyze', () => {
    it('should analyze a PNG file and return correct metadata', async () => {
      const pngBuf = makePngBuffer(800, 600);
      const filePath = path.join(tmpDir, 'test.png');
      await fs.writeFile(filePath, pngBuf);

      const result = await analyzer.analyze(filePath);

      expect(result.id).toBeTruthy();
      expect(result.source).toBe(filePath);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.format).toBe('png');
      expect(result.description).toContain('PNG');
      expect(result.description).toContain('800x600');
      expect(result.elements).toEqual([]);
      expect(result.codeBlocks).toEqual([]);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should analyze a GIF file', async () => {
      const gifBuf = makeGifBuffer(320, 240);
      const filePath = path.join(tmpDir, 'test.gif');
      await fs.writeFile(filePath, gifBuf);

      const result = await analyzer.analyze(filePath);

      expect(result.format).toBe('gif');
      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
    });

    it('should throw for files exceeding max size', async () => {
      const small = new ImageAnalyzer({ maxImageSize: 10 });
      const pngBuf = makePngBuffer(100, 100);
      const filePath = path.join(tmpDir, 'big.png');
      await fs.writeFile(filePath, pngBuf);

      await expect(small.analyze(filePath)).rejects.toThrow('exceeds max size');
    });

    it('should throw for unsupported formats', async () => {
      const restricted = new ImageAnalyzer({ supportedFormats: ['jpg'] });
      const pngBuf = makePngBuffer(100, 100);
      const filePath = path.join(tmpDir, 'test.png');
      await fs.writeFile(filePath, pngBuf);

      await expect(restricted.analyze(filePath)).rejects.toThrow('unsupported format');
    });

    it('should emit multimodal:image:analyzed event', async () => {
      const handler = vi.fn();
      analyzer.on('multimodal:image:analyzed', handler);

      const pngBuf = makePngBuffer(100, 100);
      const filePath = path.join(tmpDir, 'test.png');
      await fs.writeFile(filePath, pngBuf);

      await analyzer.analyze(filePath);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].format).toBe('png');
    });
  });

  // ─── analyzeBuffer ────────────────────────────────────────────

  describe('analyzeBuffer', () => {
    it('should analyze a buffer and return analysis', async () => {
      const pngBuf = makePngBuffer(1024, 768);
      const result = await analyzer.analyzeBuffer(pngBuf, 'png');

      expect(result.format).toBe('png');
      expect(result.width).toBe(1024);
      expect(result.height).toBe(768);
      expect(result.source).toContain('buffer:');
    });

    it('should throw when buffer exceeds max size', async () => {
      const small = new ImageAnalyzer({ maxImageSize: 10 });
      const pngBuf = makePngBuffer(100, 100);

      await expect(small.analyzeBuffer(pngBuf, 'png')).rejects.toThrow('exceeds max size');
    });

    it('should emit multimodal:image:analyzed event', async () => {
      const handler = vi.fn();
      analyzer.on('multimodal:image:analyzed', handler);

      const pngBuf = makePngBuffer(100, 100);
      await analyzer.analyzeBuffer(pngBuf, 'png');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Code extraction ──────────────────────────────────────────

  describe('extractCodeBlocks', () => {
    it('should return code blocks from analysis', () => {
      const analysis: ImageAnalysis = {
        id: 'img_1',
        source: 'test.png',
        width: 100,
        height: 100,
        format: 'png',
        description: 'test',
        elements: [],
        codeBlocks: [
          {
            language: 'typescript',
            code: 'const x = 1;',
            bounds: { x: 0, y: 0, width: 100, height: 50 },
            confidence: 0.95,
          },
        ],
        timestamp: Date.now(),
      };

      const blocks = analyzer.extractCodeBlocks(analysis);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].language).toBe('typescript');
      expect(blocks[0].code).toBe('const x = 1;');
    });

    it('should return empty array when no code blocks', () => {
      const analysis: ImageAnalysis = {
        id: 'img_1',
        source: 'test.png',
        width: 100,
        height: 100,
        format: 'png',
        description: 'test',
        elements: [],
        codeBlocks: [],
        timestamp: Date.now(),
      };

      expect(analyzer.extractCodeBlocks(analysis)).toEqual([]);
    });
  });

  // ─── UI element detection ─────────────────────────────────────

  describe('detectUIElements', () => {
    it('should return UI elements from analysis', () => {
      const analysis: ImageAnalysis = {
        id: 'img_1',
        source: 'test.png',
        width: 100,
        height: 100,
        format: 'png',
        description: 'test',
        elements: [
          {
            type: 'button',
            label: 'Submit',
            bounds: { x: 10, y: 10, width: 80, height: 30 },
            confidence: 0.9,
          },
        ],
        codeBlocks: [],
        timestamp: Date.now(),
      };

      const elements = analyzer.detectUIElements(analysis);
      expect(elements).toHaveLength(1);
      expect(elements[0].type).toBe('button');
      expect(elements[0].label).toBe('Submit');
    });
  });

  // ─── generateCodeFromUI ───────────────────────────────────────

  describe('generateCodeFromUI', () => {
    it('should generate placeholder when no elements', () => {
      const html = analyzer.generateCodeFromUI([]);
      expect(html).toContain('No UI elements detected');
      expect(html).toContain('<div></div>');
    });

    it('should generate HTML with button elements', () => {
      const elements: UIElement[] = [
        {
          type: 'button',
          label: 'Click Me',
          bounds: { x: 10, y: 10, width: 100, height: 40 },
          confidence: 0.9,
        },
      ];

      const html = analyzer.generateCodeFromUI(elements);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<button');
      expect(html).toContain('Click Me');
      expect(html).toContain('el-button-0');
    });

    it('should generate HTML with input elements', () => {
      const elements: UIElement[] = [
        {
          type: 'input',
          label: 'Username',
          bounds: { x: 0, y: 0, width: 200, height: 30 },
          confidence: 0.9,
        },
      ];

      const html = analyzer.generateCodeFromUI(elements);
      expect(html).toContain('<input');
      expect(html).toContain('placeholder="Username"');
    });

    it('should generate HTML with text, image, table, and form elements', () => {
      const elements: UIElement[] = [
        { type: 'text', label: 'Hello', bounds: { x: 0, y: 0, width: 100, height: 20 }, confidence: 0.9 },
        { type: 'image', label: 'Logo', bounds: { x: 0, y: 30, width: 100, height: 100 }, confidence: 0.9 },
        { type: 'table', label: 'Data', bounds: { x: 0, y: 140, width: 200, height: 100 }, confidence: 0.9 },
        { type: 'form', label: 'Login', bounds: { x: 0, y: 250, width: 200, height: 150 }, confidence: 0.9 },
      ];

      const html = analyzer.generateCodeFromUI(elements);
      expect(html).toContain('<p class="el-text-0">Hello</p>');
      expect(html).toContain('Image: Logo');
      expect(html).toContain('<table');
      expect(html).toContain('<form');
    });

    it('should escape HTML in labels', () => {
      const elements: UIElement[] = [
        {
          type: 'button',
          label: '<script>alert("xss")</script>',
          bounds: { x: 0, y: 0, width: 100, height: 30 },
          confidence: 0.9,
        },
      ];

      const html = analyzer.generateCodeFromUI(elements);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  // ─── Stats ────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return zeros initially', () => {
      const stats = analyzer.getStats();
      expect(stats.imagesAnalyzed).toBe(0);
      expect(stats.codeBlocksExtracted).toBe(0);
    });

    it('should track analyzed images', async () => {
      const pngBuf = makePngBuffer(100, 100);
      const filePath = path.join(tmpDir, 'test.png');
      await fs.writeFile(filePath, pngBuf);

      await analyzer.analyze(filePath);
      await analyzer.analyze(filePath);

      const stats = analyzer.getStats();
      expect(stats.imagesAnalyzed).toBe(2);
    });
  });

  // ─── Configuration ────────────────────────────────────────────

  describe('configuration', () => {
    it('should use default config when none provided', () => {
      const defaultAnalyzer = new ImageAnalyzer();
      const stats = defaultAnalyzer.getStats();
      expect(stats.imagesAnalyzed).toBe(0);
    });

    it('should merge partial config with defaults', () => {
      const custom = new ImageAnalyzer({ maxImageSize: 1024 });
      // The analyzer should still work with other defaults
      const stats = custom.getStats();
      expect(stats.imagesAnalyzed).toBe(0);
    });
  });
});
