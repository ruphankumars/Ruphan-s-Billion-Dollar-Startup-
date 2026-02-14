/**
 * NpmTarget — Unit Tests
 *
 * Tests npm deployment target: dry-run mode, package.json generation,
 * name/version validation, deployment, and statistics.
 * Mocks node:child_process for isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock node:child_process ───────────────────────────────────

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('npm-pack-output'),
}));

// ── Mock node:crypto ──────────────────────────────────────────

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('12345678-1234-1234-1234-123456789012'),
}));

import { NpmTarget } from '../../../src/deploy/targets/npm-target.js';
import { execSync } from 'node:child_process';
import type { DeployManifest, PackageBundle } from '../../../src/deploy/types.js';

// ── Helpers ───────────────────────────────────────────────────

function createManifest(overrides?: Partial<DeployManifest>): DeployManifest {
  return {
    name: 'my-package',
    version: '1.0.0',
    entryPoint: 'dist/index.js',
    dependencies: { lodash: '^4.17.0' },
    environment: {},
    resources: { memory: '256Mi', cpu: '0.5', disk: '1Gi' },
    healthCheck: { path: '/health', interval: 30, timeout: 5 },
    ...overrides,
  };
}

function createBundle(overrides?: Partial<PackageBundle>): PackageBundle {
  return {
    manifest: createManifest(),
    files: new Map([
      ['dist/index.js', 'module.exports = {}'],
      ['package.json', '{}'],
    ]),
    size: 200,
    hash: 'abc123',
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────

describe('NpmTarget', () => {
  let target: NpmTarget;

  beforeEach(() => {
    vi.clearAllMocks();
    target = new NpmTarget({ dryRun: true });
  });

  // ── Constructor ───────────────────────────────────────────

  describe('constructor', () => {
    it('defaults to dry-run mode', () => {
      const t = new NpmTarget();
      const stats = t.getStats();
      expect(stats.dryRun).toBe(true);
    });

    it('defaults to official npm registry', () => {
      const t = new NpmTarget();
      const stats = t.getStats();
      expect(stats.registry).toBe('https://registry.npmjs.org');
    });

    it('uses custom registry when provided', () => {
      const t = new NpmTarget({ registry: 'https://custom.registry.com' });
      const stats = t.getStats();
      expect(stats.registry).toBe('https://custom.registry.com');
    });

    it('respects dryRun: false', () => {
      const t = new NpmTarget({ dryRun: false });
      const stats = t.getStats();
      expect(stats.dryRun).toBe(false);
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() sets running and emits event', () => {
      const spy = vi.fn();
      target.on('deploy:npm:started', spy);
      target.start();
      expect(target.isRunning()).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('stop() clears running and emits event', () => {
      target.start();
      const spy = vi.fn();
      target.on('deploy:npm:stopped', spy);
      target.stop();
      expect(target.isRunning()).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── generatePackageJson ───────────────────────────────────

  describe('generatePackageJson', () => {
    it('generates package.json from manifest', () => {
      const manifest = createManifest();
      const pkg = target.generatePackageJson(manifest);

      expect(pkg.name).toBe('my-package');
      expect(pkg.version).toBe('1.0.0');
      expect(pkg.main).toBe('dist/index.js');
      expect(pkg.type).toBe('module');
      expect(pkg.dependencies).toEqual({ lodash: '^4.17.0' });
    });

    it('includes engines.node >= 18', () => {
      const pkg = target.generatePackageJson(createManifest());
      expect((pkg.engines as Record<string, string>).node).toBe('>=18.0.0');
    });

    it('includes start script with entry point', () => {
      const manifest = createManifest({ entryPoint: 'src/main.js' });
      const pkg = target.generatePackageJson(manifest);
      expect((pkg.scripts as Record<string, string>).start).toBe('node src/main.js');
    });

    it('includes license, files, and repository fields', () => {
      const pkg = target.generatePackageJson(createManifest());
      expect(pkg.license).toBe('MIT');
      expect(Array.isArray(pkg.files)).toBe(true);
      expect(pkg.repository).toBeDefined();
    });
  });

  // ── validate ──────────────────────────────────────────────

  describe('validate', () => {
    it('validates a well-formed bundle', () => {
      const bundle = createBundle();
      const result = target.validate(bundle);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects missing package name', () => {
      const bundle = createBundle({ manifest: createManifest({ name: '' }) });
      const result = target.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Package name is required');
    });

    it('rejects invalid npm package name', () => {
      const bundle = createBundle({ manifest: createManifest({ name: 'INVALID NAME!' }) });
      const result = target.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid npm package name');
    });

    it('accepts scoped package names', () => {
      const bundle = createBundle({ manifest: createManifest({ name: '@scope/my-pkg' }) });
      const result = target.validate(bundle);
      expect(result.valid).toBe(true);
    });

    it('rejects missing version', () => {
      const bundle = createBundle({ manifest: createManifest({ version: '' }) });
      const result = target.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Package version is required');
    });

    it('warns on non-semver version', () => {
      const bundle = createBundle({ manifest: createManifest({ version: 'latest' }) });
      const result = target.validate(bundle);
      // Non-semver is a warning, not an error
      expect(result.warnings.some((w) => w.includes('semver'))).toBe(true);
    });

    it('accepts valid semver version', () => {
      const bundle = createBundle({ manifest: createManifest({ version: '2.3.4' }) });
      const result = target.validate(bundle);
      expect(result.valid).toBe(true);
      expect(result.warnings.filter((w) => w.includes('semver'))).toHaveLength(0);
    });

    it('rejects missing entry point', () => {
      const bundle = createBundle({ manifest: createManifest({ entryPoint: '' }) });
      const result = target.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Entry point is required');
    });

    it('rejects bundle with no files', () => {
      const bundle = createBundle({ files: new Map() });
      const result = target.validate(bundle);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Package contains no files');
    });

    it('warns on oversized package (> 50MB)', () => {
      const bundle = createBundle({ size: 100 * 1024 * 1024 });
      const result = target.validate(bundle);
      expect(result.warnings.some((w) => w.includes('exceeds 50MB'))).toBe(true);
    });
  });

  // ── deploy — dry-run ──────────────────────────────────────

  describe('deploy — dry-run', () => {
    it('returns success without publishing', async () => {
      const bundle = createBundle();
      const result = await target.deploy(bundle);

      expect(result.status).toBe('success');
      expect(result.targetId).toBe('npm');
      expect(result.url).toContain('npmjs.com');
      expect(result.logs.some((l) => l.includes('DRY RUN'))).toBe(true);
    });

    it('does not call npm publish in dry-run mode', async () => {
      const bundle = createBundle();
      await target.deploy(bundle);

      // execSync is called for npm pack --dry-run but not npm publish
      const calls = vi.mocked(execSync).mock.calls;
      const publishCalls = calls.filter((c) => String(c[0]).includes('npm publish'));
      expect(publishCalls).toHaveLength(0);
    });

    it('emits deploy:npm:deployed event', async () => {
      const spy = vi.fn();
      target.on('deploy:npm:deployed', spy);

      const bundle = createBundle();
      await target.deploy(bundle);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true }),
      );
    });
  });

  // ── deploy — live publish ─────────────────────────────────

  describe('deploy — live publish', () => {
    it('calls npm publish when dryRun is false', async () => {
      const liveTarget = new NpmTarget({ dryRun: false });
      const bundle = createBundle();
      await liveTarget.deploy(bundle);

      const calls = vi.mocked(execSync).mock.calls;
      const publishCalls = calls.filter((c) => String(c[0]).includes('npm publish'));
      expect(publishCalls.length).toBeGreaterThan(0);
    });

    it('returns failed status when npm publish throws', async () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (String(cmd).includes('npm publish')) {
          throw new Error('E403 Forbidden');
        }
        return 'ok';
      });

      const liveTarget = new NpmTarget({ dryRun: false });
      const bundle = createBundle();
      const result = await liveTarget.deploy(bundle);
      expect(result.status).toBe('failed');
    });
  });

  // ── deploy — validation failure ───────────────────────────

  describe('deploy — validation failure', () => {
    it('returns failed status for invalid bundle', async () => {
      const bundle = createBundle({
        manifest: createManifest({ name: '', version: '' }),
        files: new Map(),
      });
      const result = await target.deploy(bundle);
      expect(result.status).toBe('failed');
      expect(result.logs.some((l) => l.includes('Validation failed'))).toBe(true);
    });
  });

  // ── getStats ──────────────────────────────────────────────

  describe('getStats', () => {
    it('returns initial statistics', () => {
      const stats = target.getStats();
      expect(stats.totalDeployments).toBe(0);
      expect(stats.dryRun).toBe(true);
    });

    it('increments totalDeployments after successful deploy', async () => {
      await target.deploy(createBundle());
      const stats = target.getStats();
      expect(stats.totalDeployments).toBe(1);
    });
  });
});
