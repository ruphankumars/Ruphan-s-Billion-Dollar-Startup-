/**
 * Deployer — Unit Tests
 *
 * Tests deployment pipeline: deploy, rollback, verification,
 * deployment history, event emission, and statistics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Deployer } from '../../../src/deploy/deployer.js';
import type {
  DeployConfig,
  DeployManifest,
  DeployTarget,
  PackageBundle,
} from '../../../src/deploy/types.js';

// ── Mock node:crypto for randomUUID ───────────────────────────

let uuidCounter = 0;
vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => `uuid-${++uuidCounter}-1234-1234-123456789012`),
  createHash: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('a'.repeat(64)),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────

function createTarget(overrides?: Partial<DeployTarget>): DeployTarget {
  return {
    id: 'docker-prod',
    name: 'Docker Production',
    type: 'docker',
    config: {},
    ...overrides,
  };
}

function createConfig(overrides?: Partial<DeployConfig>): DeployConfig {
  return {
    targets: [createTarget()],
    defaultTarget: 'docker-prod',
    prebuildSteps: [],
    postDeploySteps: [],
    ...overrides,
  };
}

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
  return {
    manifest: createManifest(),
    files: new Map([
      ['dist/index.js', 'console.log("hello")'],
      ['package.json', '{"name":"test-app"}'],
    ]),
    size: 200,
    hash: 'a'.repeat(64),
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────

describe('Deployer', () => {
  let deployer: Deployer;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    deployer = new Deployer(createConfig());
  });

  // ── Constructor ───────────────────────────────────────────

  describe('constructor', () => {
    it('registers configured targets', () => {
      const targets = [
        createTarget({ id: 'docker-1' }),
        createTarget({ id: 'npm-1', type: 'npm', name: 'NPM' }),
      ];
      const d = new Deployer(createConfig({ targets }));
      const stats = d.getStats();
      expect(stats.targetsRegistered).toBe(2);
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() sets running and emits event', () => {
      const spy = vi.fn();
      deployer.on('deploy:deployer:started', spy);
      deployer.start();
      expect(deployer.isRunning()).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('stop() clears running and emits event', () => {
      deployer.start();
      const spy = vi.fn();
      deployer.on('deploy:deployer:stopped', spy);
      deployer.stop();
      expect(deployer.isRunning()).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── deploy ────────────────────────────────────────────────

  describe('deploy', () => {
    it('runs full pipeline and returns success result', async () => {
      const bundle = createBundle();
      const result = await deployer.deploy(bundle);

      expect(result.status).toBe('success');
      expect(result.targetId).toBe('docker-prod');
      expect(result.url).toContain('docker://');
      expect(result.logs.length).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('deploys to specified target', async () => {
      const targets = [
        createTarget({ id: 'docker-staging', name: 'Docker Staging' }),
        createTarget({ id: 'docker-prod' }),
      ];
      const d = new Deployer(createConfig({ targets }));

      const bundle = createBundle();
      const result = await d.deploy(bundle, 'docker-staging');
      expect(result.targetId).toBe('docker-staging');
    });

    it('throws when target is not found', async () => {
      const bundle = createBundle();
      await expect(deployer.deploy(bundle, 'nonexistent')).rejects.toThrow(
        'Deploy target not found: nonexistent',
      );
    });

    it('returns failed status for invalid bundles', async () => {
      const bundle = createBundle({
        manifest: createManifest({ name: '', version: '', entryPoint: '' }),
        files: new Map(),
        hash: 'a'.repeat(64),
      });
      const result = await deployer.deploy(bundle);
      expect(result.status).toBe('failed');
      expect(result.logs.some((l) => l.includes('Validation failed'))).toBe(true);
    });

    it('records deployment in history', async () => {
      const bundle = createBundle();
      await deployer.deploy(bundle);
      const deployments = deployer.listDeployments();
      expect(deployments.length).toBe(1);
    });

    it('emits pipeline events', async () => {
      const startSpy = vi.fn();
      const completeSpy = vi.fn();
      deployer.on('deploy:pipeline:start', startSpy);
      deployer.on('deploy:pipeline:complete', completeSpy);

      const bundle = createBundle();
      await deployer.deploy(bundle);

      expect(startSpy).toHaveBeenCalledOnce();
      expect(completeSpy).toHaveBeenCalledOnce();
    });

    it('generates correct URL for npm target', async () => {
      const d = new Deployer(
        createConfig({
          targets: [createTarget({ id: 'npm-1', type: 'npm', name: 'NPM' })],
          defaultTarget: 'npm-1',
        }),
      );
      const bundle = createBundle();
      const result = await d.deploy(bundle);
      expect(result.url).toContain('npmjs.com');
    });
  });

  // ── rollback ──────────────────────────────────────────────

  describe('rollback', () => {
    it('throws when deployment is not found', async () => {
      await expect(deployer.rollback('nonexistent')).rejects.toThrow(
        'Deployment not found',
      );
    });

    it('throws when no previous deployment exists', async () => {
      const bundle = createBundle();
      await deployer.deploy(bundle);

      const deployments = deployer.listDeployments();
      const depId = deployments[0].id;

      await expect(deployer.rollback(depId)).rejects.toThrow(
        'No previous deployment to rollback to',
      );
    });
  });

  // ── verify ────────────────────────────────────────────────

  describe('verify', () => {
    it('returns healthy for successful deployment', async () => {
      const bundle = createBundle();
      await deployer.deploy(bundle);

      const deployments = deployer.listDeployments();
      const depId = deployments[0].id;

      const result = await deployer.verify(depId);
      expect(result.healthy).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('returns unhealthy for unknown deployment', async () => {
      const result = await deployer.verify('nonexistent');
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('Deployment not found');
    });
  });

  // ── listDeployments ───────────────────────────────────────

  describe('listDeployments', () => {
    it('returns empty array when no deployments exist', () => {
      const list = deployer.listDeployments();
      expect(list).toEqual([]);
    });

    it('filters by targetId', async () => {
      const targets = [
        createTarget({ id: 'target-a' }),
        createTarget({ id: 'target-b' }),
      ];
      const d = new Deployer(createConfig({ targets, defaultTarget: 'target-a' }));

      const bundle = createBundle();
      await d.deploy(bundle, 'target-a');
      await d.deploy(bundle, 'target-b');

      const filtered = d.listDeployments({ targetId: 'target-a' });
      expect(filtered.length).toBe(1);
      expect(filtered[0].targetId).toBe('target-a');
    });

    it('filters by status', async () => {
      const bundle = createBundle();
      await deployer.deploy(bundle);

      const successful = deployer.listDeployments({ status: 'success' });
      expect(successful.length).toBe(1);

      const failed = deployer.listDeployments({ status: 'failed' });
      expect(failed.length).toBe(0);
    });
  });

  // ── getStats ──────────────────────────────────────────────

  describe('getStats', () => {
    it('returns initial statistics', () => {
      const stats = deployer.getStats();
      expect(stats.totalDeployments).toBe(0);
      expect(stats.successful).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.rolledBack).toBe(0);
      expect(stats.targetsRegistered).toBe(1);
      expect(stats.avgDuration).toBe(0);
    });

    it('updates statistics after deployment', async () => {
      const bundle = createBundle();
      await deployer.deploy(bundle);

      const stats = deployer.getStats();
      expect(stats.totalDeployments).toBe(1);
      expect(stats.successful).toBe(1);
    });
  });
});
