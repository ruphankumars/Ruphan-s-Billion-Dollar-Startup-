/**
 * Packager — Unit Tests
 *
 * Tests bundle creation, manifest generation, SHA256 hash calculation,
 * bundle validation, and statistics.
 * Mocks node:fs and node:crypto as needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Packager } from '../../../src/deploy/packager.js';
import type { DeployManifest, PackageBundle } from '../../../src/deploy/types.js';

// ── Mock node:fs ──────────────────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('{"name":"test-app","version":"1.0.0","main":"dist/index.js","dependencies":{}}'),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ size: 100 }),
}));

import * as fs from 'node:fs';

// ── Helpers ───────────────────────────────────────────────────

function createManifest(overrides?: Partial<DeployManifest>): DeployManifest {
  return {
    name: 'test-app',
    version: '1.0.0',
    entryPoint: 'dist/index.js',
    dependencies: {},
    environment: {},
    resources: { memory: '256Mi', cpu: '0.5', disk: '1Gi' },
    healthCheck: { path: '/health', interval: 30, timeout: 5 },
    ...overrides,
  };
}

function createBundle(overrides?: Partial<PackageBundle>): PackageBundle {
  const manifest = overrides?.manifest ?? createManifest();
  const files = overrides?.files ?? new Map<string, string>([
    ['src/index.ts', 'console.log("hello")'],
    ['package.json', '{"name":"test-app"}'],
  ]);
  const packager = new Packager();
  const hash = overrides?.hash ?? packager.calculateHash({ manifest, files });
  const size = overrides?.size ?? 100;

  return { manifest, files, size, hash };
}

// ── Test suite ────────────────────────────────────────────────

describe('Packager', () => {
  let packager: Packager;

  beforeEach(() => {
    vi.clearAllMocks();
    packager = new Packager();
  });

  // ── Lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() sets running and emits event', () => {
      const spy = vi.fn();
      packager.on('deploy:packager:started', spy);
      packager.start();
      expect(packager.isRunning()).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('stop() clears running and emits event', () => {
      packager.start();
      const spy = vi.fn();
      packager.on('deploy:packager:stopped', spy);
      packager.stop();
      expect(packager.isRunning()).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── generateManifest ──────────────────────────────────────

  describe('generateManifest', () => {
    it('generates manifest from package.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          name: 'my-app',
          version: '2.0.0',
          main: 'src/main.ts',
          dependencies: { express: '^4.0.0' },
        }),
      );

      const manifest = packager.generateManifest('/project');
      expect(manifest.name).toBe('my-app');
      expect(manifest.version).toBe('2.0.0');
      expect(manifest.entryPoint).toBe('src/main.ts');
      expect(manifest.dependencies).toEqual({ express: '^4.0.0' });
    });

    it('falls back to defaults when package.json is missing', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const manifest = packager.generateManifest('/project');
      expect(manifest.version).toBe('0.0.0');
      expect(manifest.entryPoint).toBe('index.js');
    });

    it('detects dist/index.js entry point when main is not set', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).endsWith('package.json')) return true;
        if (String(p).endsWith('dist/index.js')) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'app', version: '1.0.0' }));

      const manifest = packager.generateManifest('/project');
      expect(manifest.entryPoint).toBe('dist/index.js');
    });

    it('emits deploy:manifest:generated event', () => {
      const spy = vi.fn();
      packager.on('deploy:manifest:generated', spy);
      packager.generateManifest('/project');
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── calculateHash ─────────────────────────────────────────

  describe('calculateHash', () => {
    it('returns a hex string SHA256 hash', () => {
      const files = new Map<string, string>([['a.ts', 'content']]);
      const manifest = createManifest();
      const hash = packager.calculateHash({ manifest, files });
      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces deterministic hashes for the same input', () => {
      const files = new Map<string, string>([['a.ts', 'content']]);
      const manifest = createManifest();
      const hash1 = packager.calculateHash({ manifest, files });
      const hash2 = packager.calculateHash({ manifest, files });
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different content', () => {
      const manifest = createManifest();
      const hash1 = packager.calculateHash({
        manifest,
        files: new Map([['a.ts', 'content1']]),
      });
      const hash2 = packager.calculateHash({
        manifest,
        files: new Map([['a.ts', 'content2']]),
      });
      expect(hash1).not.toBe(hash2);
    });
  });

  // ── validateBundle ────────────────────────────────────────

  describe('validateBundle', () => {
    it('validates a well-formed bundle as valid', () => {
      const bundle = createBundle();
      const result = packager.validateBundle(bundle);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('detects missing manifest name', () => {
      const bundle = createBundle({ manifest: createManifest({ name: '' }) });
      // Recalculate hash with empty name
      bundle.hash = packager.calculateHash(bundle);
      const result = packager.validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Manifest missing "name" field');
    });

    it('detects missing manifest version', () => {
      const bundle = createBundle({ manifest: createManifest({ version: '' }) });
      bundle.hash = packager.calculateHash(bundle);
      const result = packager.validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Manifest missing "version" field');
    });

    it('detects missing manifest entryPoint', () => {
      const bundle = createBundle({ manifest: createManifest({ entryPoint: '' }) });
      bundle.hash = packager.calculateHash(bundle);
      const result = packager.validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Manifest missing "entryPoint" field');
    });

    it('detects empty bundle with no files', () => {
      const bundle = createBundle({ files: new Map() });
      bundle.hash = packager.calculateHash(bundle);
      const result = packager.validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Bundle contains no files');
    });

    it('warns when entry point is not in bundle files', () => {
      const bundle = createBundle({
        manifest: createManifest({ entryPoint: 'missing.js' }),
      });
      bundle.hash = packager.calculateHash(bundle);
      const result = packager.validateBundle(bundle);
      expect(result.warnings.some((w) => w.includes('Entry point'))).toBe(true);
    });

    it('detects hash mismatch', () => {
      const bundle = createBundle();
      bundle.hash = 'tampered_hash_value_that_is_incorrect';
      const result = packager.validateBundle(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('hash mismatch'))).toBe(true);
    });

    it('warns on oversized bundles (> 100MB)', () => {
      const bundle = createBundle({ size: 200 * 1024 * 1024 });
      const result = packager.validateBundle(bundle);
      expect(result.warnings.some((w) => w.includes('exceeds 100MB'))).toBe(true);
    });
  });

  // ── getBundleStats ────────────────────────────────────────

  describe('getBundleStats', () => {
    it('returns file count, total size, hash, and extension breakdown', () => {
      const files = new Map<string, string>([
        ['src/index.ts', 'code'],
        ['src/utils.ts', 'more code'],
        ['package.json', '{}'],
      ]);
      const bundle = createBundle({ files, size: 500 });

      const stats = packager.getBundleStats(bundle);
      expect(stats.fileCount).toBe(3);
      expect(stats.totalSize).toBe(500);
      expect(stats.hash).toBe(bundle.hash);
      expect(stats.extensions['.ts']).toBe(2);
      expect(stats.extensions['.json']).toBe(1);
    });

    it('lists largest files in descending order', () => {
      const files = new Map<string, string>([
        ['small.ts', 'x'],
        ['large.ts', 'x'.repeat(1000)],
      ]);
      const bundle = createBundle({ files });

      const stats = packager.getBundleStats(bundle);
      expect(stats.largestFiles[0].path).toBe('large.ts');
    });
  });

  // ── createBundle ──────────────────────────────────────────

  describe('createBundle', () => {
    it('emits deploy:bundle:start and deploy:bundle:complete events', () => {
      const startSpy = vi.fn();
      const completeSpy = vi.fn();
      packager.on('deploy:bundle:start', startSpy);
      packager.on('deploy:bundle:complete', completeSpy);

      // readdirSync returns no entries so bundle will have 0 files from disk
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const manifest = createManifest();
      packager.createBundle('/project', manifest);

      expect(startSpy).toHaveBeenCalledOnce();
      expect(completeSpy).toHaveBeenCalledOnce();
    });

    it('returns a bundle with hash and size', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      const manifest = createManifest();
      const bundle = packager.createBundle('/project', manifest);

      expect(bundle.manifest).toBe(manifest);
      expect(bundle.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof bundle.size).toBe('number');
    });
  });
});
