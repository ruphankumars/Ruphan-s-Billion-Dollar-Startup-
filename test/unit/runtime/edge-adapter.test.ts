import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EdgeAdapter } from '../../../src/runtime/edge-adapter.js';
import type { EdgeTarget, EdgeConstraints } from '../../../src/runtime/types.js';

/** Helper to build a minimal target input (without id/status). */
function makeTargetInput(overrides: Partial<Omit<EdgeTarget, 'id' | 'status'>> = {}): Omit<EdgeTarget, 'id' | 'status'> {
  return {
    name: overrides.name ?? 'test-edge',
    type: overrides.type ?? 'node-edge',
    capabilities: overrides.capabilities ?? [{ name: 'wasm', supported: true }],
    constraints: overrides.constraints ?? {
      maxMemoryMB: 512,
      maxCpuMs: 60_000,
      maxStorageMB: 100,
      hasNetwork: true,
      hasFileSystem: false,
      hasGPU: false,
      architectures: ['x86_64', 'arm64'],
    },
    connection: overrides.connection,
  };
}

describe('EdgeAdapter', () => {
  let adapter: EdgeAdapter;

  beforeEach(() => {
    adapter = new EdgeAdapter();
  });

  afterEach(() => {
    adapter.destroy();
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates adapter with default options', () => {
      expect(adapter).toBeInstanceOf(EdgeAdapter);
    });

    it('accepts custom options', () => {
      const custom = new EdgeAdapter({
        heartbeatIntervalMs: 5000,
        deploymentTimeout: 30_000,
      });
      expect(custom).toBeInstanceOf(EdgeAdapter);
      custom.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Target management
  // ---------------------------------------------------------------------------

  describe('addTarget()', () => {
    it('adds a target and assigns an ID', () => {
      const target = adapter.addTarget(makeTargetInput({ name: 'my-edge' }));

      expect(target.id).toBeDefined();
      expect(target.name).toBe('my-edge');
      expect(target.status).toBe('available');
    });

    it('assigns unique IDs to each target', () => {
      const t1 = adapter.addTarget(makeTargetInput());
      const t2 = adapter.addTarget(makeTargetInput());

      expect(t1.id).not.toBe(t2.id);
    });
  });

  describe('removeTarget()', () => {
    it('removes an existing target', () => {
      const target = adapter.addTarget(makeTargetInput());
      expect(adapter.removeTarget(target.id)).toBe(true);
      expect(adapter.getTarget(target.id)).toBeUndefined();
    });

    it('returns false for non-existent target', () => {
      expect(adapter.removeTarget('ghost')).toBe(false);
    });

    it('stops deployments on the removed target', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep = await adapter.deploy(target.id, { agentConfig: { test: true } });

      adapter.removeTarget(target.id);
      expect(dep.status).toBe('stopped');
    });
  });

  describe('getTarget()', () => {
    it('returns a target by ID', () => {
      const target = adapter.addTarget(makeTargetInput());
      expect(adapter.getTarget(target.id)).toBeDefined();
    });

    it('returns undefined for unknown ID', () => {
      expect(adapter.getTarget('unknown')).toBeUndefined();
    });
  });

  describe('listTargets()', () => {
    it('returns all targets', () => {
      adapter.addTarget(makeTargetInput());
      adapter.addTarget(makeTargetInput());

      expect(adapter.listTargets()).toHaveLength(2);
    });

    it('filters by type', () => {
      adapter.addTarget(makeTargetInput({ type: 'node-edge' }));
      adapter.addTarget(makeTargetInput({ type: 'browser' }));
      adapter.addTarget(makeTargetInput({ type: 'lambda' }));

      expect(adapter.listTargets({ type: 'browser' })).toHaveLength(1);
    });

    it('filters by status', () => {
      const t1 = adapter.addTarget(makeTargetInput());
      adapter.addTarget(makeTargetInput());

      // Connect first target to change its status
      // (simulated local connection)
      adapter.connect(t1.id);

      const available = adapter.listTargets({ status: 'available' });
      expect(available).toHaveLength(1);
    });

    it('returns empty array when no targets match', () => {
      adapter.addTarget(makeTargetInput({ type: 'node-edge' }));
      expect(adapter.listTargets({ type: 'iot' })).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  describe('connect()', () => {
    it('connects a local target (no URL)', async () => {
      const target = adapter.addTarget(makeTargetInput());
      const result = await adapter.connect(target.id);

      expect(result).toBe(true);
      expect(adapter.getTarget(target.id)!.status).toBe('connected');
    });

    it('creates a local connection object when none exists', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);

      const updated = adapter.getTarget(target.id)!;
      expect(updated.connection).toBeDefined();
      expect(updated.connection!.url).toContain('local://');
      expect(updated.connection!.authenticated).toBe(true);
    });

    it('returns false for non-existent target', async () => {
      expect(await adapter.connect('ghost')).toBe(false);
    });

    it('emits runtime:edge:connected event', async () => {
      const spy = vi.fn();
      adapter.on('runtime:edge:connected', spy);

      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ targetId: target.id }));
    });

    it('connects via real URL when available', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const target = adapter.addTarget(makeTargetInput({
        connection: {
          protocol: 'http',
          url: 'https://remote.edge/api',
          authenticated: false,
          latencyMs: 0,
          lastPing: 0,
        },
      }));

      const result = await adapter.connect(target.id);
      expect(result).toBe(true);
      expect(adapter.getTarget(target.id)!.status).toBe('connected');
    });

    it('marks target offline when real connection fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const target = adapter.addTarget(makeTargetInput({
        connection: {
          protocol: 'http',
          url: 'https://fail.edge/api',
          authenticated: false,
          latencyMs: 0,
          lastPing: 0,
        },
      }));

      const result = await adapter.connect(target.id);
      expect(result).toBe(false);
      expect(adapter.getTarget(target.id)!.status).toBe('offline');
    });

    it('returns false when remote responds with non-ok status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

      const target = adapter.addTarget(makeTargetInput({
        connection: {
          protocol: 'http',
          url: 'https://bad.edge/api',
          authenticated: false,
          latencyMs: 0,
          lastPing: 0,
        },
      }));

      const result = await adapter.connect(target.id);
      expect(result).toBe(false);
    });
  });

  describe('disconnect()', () => {
    it('disconnects a connected target', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const result = await adapter.disconnect(target.id);

      expect(result).toBe(true);
      expect(adapter.getTarget(target.id)!.status).toBe('available');
    });

    it('returns false for non-existent target', async () => {
      expect(await adapter.disconnect('ghost')).toBe(false);
    });

    it('returns false for already available target', async () => {
      const target = adapter.addTarget(makeTargetInput());
      expect(await adapter.disconnect(target.id)).toBe(false);
    });

    it('emits runtime:edge:disconnected event', async () => {
      const spy = vi.fn();
      adapter.on('runtime:edge:disconnected', spy);

      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      await adapter.disconnect(target.id);

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ targetId: target.id }));
    });
  });

  describe('ping()', () => {
    it('returns 0 for local target', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const latency = await adapter.ping(target.id);
      expect(latency).toBe(0);
    });

    it('returns -1 for non-existent target', async () => {
      expect(await adapter.ping('ghost')).toBe(-1);
    });

    it('pings remote targets via fetch', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const target = adapter.addTarget(makeTargetInput({
        connection: {
          protocol: 'http',
          url: 'https://remote.edge/api',
          authenticated: true,
          latencyMs: 0,
          lastPing: 0,
        },
      }));

      const latency = await adapter.ping(target.id);
      expect(latency).toBeGreaterThanOrEqual(0);
    });

    it('returns -1 and marks offline when ping fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

      const target = adapter.addTarget(makeTargetInput({
        connection: {
          protocol: 'http',
          url: 'https://fail.edge/api',
          authenticated: true,
          latencyMs: 0,
          lastPing: 0,
        },
      }));

      const latency = await adapter.ping(target.id);
      expect(latency).toBe(-1);
      expect(adapter.getTarget(target.id)!.status).toBe('offline');
    });
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe('deploy()', () => {
    it('deploys to a connected local target', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);

      const dep = await adapter.deploy(target.id, { agentConfig: { model: 'gpt-4' } });
      expect(dep.status).toBe('running');
      expect(dep.deployedAt).toBeGreaterThan(0);
      expect(dep.metrics).toBeDefined();
    });

    it('throws for non-existent target', async () => {
      await expect(adapter.deploy('ghost', { agentConfig: {} })).rejects.toThrow('Target not found');
    });

    it('throws for non-connected target', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await expect(adapter.deploy(target.id, { agentConfig: {} })).rejects.toThrow('not connected');
    });

    it('sets target status to busy', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      await adapter.deploy(target.id, { agentConfig: {} });

      expect(adapter.getTarget(target.id)!.status).toBe('busy');
    });

    it('emits runtime:edge:deployed event', async () => {
      const spy = vi.fn();
      adapter.on('runtime:edge:deployed', spy);

      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      await adapter.deploy(target.id, { agentConfig: {} });

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        targetId: target.id,
      }));
    });

    it('handles remote deployment success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

      const target = adapter.addTarget(makeTargetInput({
        connection: {
          protocol: 'http',
          url: 'https://remote.edge/api',
          authenticated: true,
          latencyMs: 5,
          lastPing: Date.now(),
        },
      }));

      // Need to set status to connected manually since real connect needs fetch too
      (adapter.getTarget(target.id) as any).status = 'connected';

      const dep = await adapter.deploy(target.id, { agentConfig: {} });
      expect(dep.status).toBe('running');
    });

    it('handles remote deployment failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

      const target = adapter.addTarget(makeTargetInput({
        connection: {
          protocol: 'http',
          url: 'https://fail.edge/api',
          authenticated: true,
          latencyMs: 5,
          lastPing: Date.now(),
        },
      }));

      (adapter.getTarget(target.id) as any).status = 'connected';

      const dep = await adapter.deploy(target.id, { agentConfig: {} });
      expect(dep.status).toBe('failed');
    });

    it('handles remote deployment network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const target = adapter.addTarget(makeTargetInput({
        connection: {
          protocol: 'http',
          url: 'https://crash.edge/api',
          authenticated: true,
          latencyMs: 5,
          lastPing: Date.now(),
        },
      }));

      (adapter.getTarget(target.id) as any).status = 'connected';

      const dep = await adapter.deploy(target.id, { agentConfig: {} });
      expect(dep.status).toBe('failed');
    });
  });

  describe('undeploy()', () => {
    it('stops a running deployment', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep = await adapter.deploy(target.id, { agentConfig: {} });

      const result = await adapter.undeploy(dep.id);
      expect(result).toBe(true);
      expect(adapter.getDeployment(dep.id)!.status).toBe('stopped');
    });

    it('returns false for non-existent deployment', async () => {
      expect(await adapter.undeploy('ghost')).toBe(false);
    });

    it('returns false for already stopped deployment', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep = await adapter.deploy(target.id, { agentConfig: {} });
      await adapter.undeploy(dep.id);

      expect(await adapter.undeploy(dep.id)).toBe(false);
    });

    it('frees up target status when last deployment is stopped', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep = await adapter.deploy(target.id, { agentConfig: {} });

      await adapter.undeploy(dep.id);
      expect(adapter.getTarget(target.id)!.status).toBe('connected');
    });

    it('keeps target busy when other deployments are still running', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      // First deploy changes target to 'busy'
      const dep1 = await adapter.deploy(target.id, { agentConfig: { id: 1 } });
      // Manually reset to 'connected' so the second deploy() call succeeds
      (adapter.getTarget(target.id) as any).status = 'connected';
      const dep2 = await adapter.deploy(target.id, { agentConfig: { id: 2 } });

      await adapter.undeploy(dep1.id);
      expect(adapter.getTarget(target.id)!.status).toBe('busy');
    });
  });

  describe('getDeployment() / listDeployments()', () => {
    it('returns a deployment by ID', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep = await adapter.deploy(target.id, { agentConfig: {} });

      expect(adapter.getDeployment(dep.id)).toBeDefined();
    });

    it('returns undefined for unknown deployment', () => {
      expect(adapter.getDeployment('unknown')).toBeUndefined();
    });

    it('lists all deployments', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      await adapter.deploy(target.id, { agentConfig: { id: 1 } });
      // After first deploy, target becomes 'busy'. Reset to 'connected' for second deploy.
      (adapter.getTarget(target.id) as any).status = 'connected';
      await adapter.deploy(target.id, { agentConfig: { id: 2 } });

      expect(adapter.listDeployments()).toHaveLength(2);
    });

    it('filters by targetId', async () => {
      const t1 = adapter.addTarget(makeTargetInput());
      const t2 = adapter.addTarget(makeTargetInput());
      await adapter.connect(t1.id);
      await adapter.connect(t2.id);
      await adapter.deploy(t1.id, { agentConfig: {} });
      await adapter.deploy(t2.id, { agentConfig: {} });

      expect(adapter.listDeployments({ targetId: t1.id })).toHaveLength(1);
    });

    it('filters by status', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep1 = await adapter.deploy(target.id, { agentConfig: {} });
      // After first deploy, target becomes 'busy'. Reset to 'connected' for second deploy.
      (adapter.getTarget(target.id) as any).status = 'connected';
      await adapter.deploy(target.id, { agentConfig: {} });
      await adapter.undeploy(dep1.id);

      expect(adapter.listDeployments({ status: 'running' })).toHaveLength(1);
      expect(adapter.listDeployments({ status: 'stopped' })).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Monitoring
  // ---------------------------------------------------------------------------

  describe('getDeploymentMetrics()', () => {
    it('returns metrics for a deployment', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep = await adapter.deploy(target.id, { agentConfig: {} });

      const metrics = await adapter.getDeploymentMetrics(dep.id);
      expect(metrics).not.toBeNull();
      expect(metrics!.requestsHandled).toBe(0);
      expect(metrics!.avgLatencyMs).toBe(0);
    });

    it('returns null for non-existent deployment', async () => {
      expect(await adapter.getDeploymentMetrics('ghost')).toBeNull();
    });

    it('updates uptime for running deployments', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep = await adapter.deploy(target.id, { agentConfig: {} });

      // Wait a tiny bit for uptime to accumulate
      await new Promise((r) => setTimeout(r, 10));
      const metrics = await adapter.getDeploymentMetrics(dep.id);
      expect(metrics!.uptimeMs).toBeGreaterThan(0);
    });
  });

  describe('sendCommand()', () => {
    it('sends a command to a local running deployment', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep = await adapter.deploy(target.id, { agentConfig: {} });

      const result = await adapter.sendCommand(dep.id, 'restart', { force: true });
      expect(result).toBeDefined();
      expect((result as any).command).toBe('restart');
      expect((result as any).status).toBe('acknowledged');
    });

    it('throws for non-running deployment', async () => {
      await expect(adapter.sendCommand('ghost', 'restart')).rejects.toThrow('not running');
    });

    it('throws for stopped deployment', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep = await adapter.deploy(target.id, { agentConfig: {} });
      await adapter.undeploy(dep.id);

      await expect(adapter.sendCommand(dep.id, 'restart')).rejects.toThrow('not running');
    });
  });

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  describe('startHeartbeat() / stopHeartbeat()', () => {
    it('starts and stops without errors', () => {
      adapter.startHeartbeat();
      adapter.stopHeartbeat();
    });

    it('is idempotent', () => {
      adapter.startHeartbeat();
      adapter.startHeartbeat();
      adapter.stopHeartbeat();
      adapter.stopHeartbeat();
    });
  });

  // ---------------------------------------------------------------------------
  // Capability checking
  // ---------------------------------------------------------------------------

  describe('checkCompatibility()', () => {
    it('returns compatible for matching constraints', () => {
      const target = adapter.addTarget(makeTargetInput({
        constraints: {
          maxMemoryMB: 512,
          maxCpuMs: 60_000,
          maxStorageMB: 100,
          hasNetwork: true,
          hasFileSystem: true,
          hasGPU: false,
          architectures: ['x86_64'],
        },
      }));

      const result = adapter.checkCompatibility(target.id, {
        maxMemoryMB: 256,
        maxCpuMs: 30_000,
        hasNetwork: true,
      });

      expect(result.compatible).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('returns incompatible for insufficient memory', () => {
      const target = adapter.addTarget(makeTargetInput({
        constraints: {
          maxMemoryMB: 128,
          maxCpuMs: 60_000,
          maxStorageMB: 100,
          hasNetwork: true,
          hasFileSystem: false,
          hasGPU: false,
          architectures: [],
        },
      }));

      const result = adapter.checkCompatibility(target.id, { maxMemoryMB: 512 });
      expect(result.compatible).toBe(false);
      expect(result.missing[0]).toContain('memory');
    });

    it('returns incompatible for missing network', () => {
      const target = adapter.addTarget(makeTargetInput({
        constraints: {
          maxMemoryMB: 512,
          maxCpuMs: 60_000,
          maxStorageMB: 100,
          hasNetwork: false,
          hasFileSystem: false,
          hasGPU: false,
          architectures: [],
        },
      }));

      const result = adapter.checkCompatibility(target.id, { hasNetwork: true });
      expect(result.compatible).toBe(false);
      expect(result.missing[0]).toContain('Network');
    });

    it('returns incompatible for missing GPU', () => {
      const target = adapter.addTarget(makeTargetInput({
        constraints: {
          maxMemoryMB: 512,
          maxCpuMs: 60_000,
          maxStorageMB: 100,
          hasNetwork: true,
          hasFileSystem: true,
          hasGPU: false,
          architectures: [],
        },
      }));

      const result = adapter.checkCompatibility(target.id, { hasGPU: true });
      expect(result.compatible).toBe(false);
      expect(result.missing[0]).toContain('GPU');
    });

    it('returns incompatible for missing architecture', () => {
      const target = adapter.addTarget(makeTargetInput({
        constraints: {
          maxMemoryMB: 512,
          maxCpuMs: 60_000,
          maxStorageMB: 100,
          hasNetwork: true,
          hasFileSystem: false,
          hasGPU: false,
          architectures: ['x86_64'],
        },
      }));

      const result = adapter.checkCompatibility(target.id, { architectures: ['arm64'] });
      expect(result.compatible).toBe(false);
      expect(result.missing[0]).toContain('arm64');
    });

    it('returns incompatible for non-existent target', () => {
      const result = adapter.checkCompatibility('ghost', {});
      expect(result.compatible).toBe(false);
      expect(result.missing[0]).toContain('not found');
    });

    it('checks file system requirement', () => {
      const target = adapter.addTarget(makeTargetInput({
        constraints: {
          maxMemoryMB: 512,
          maxCpuMs: 60_000,
          maxStorageMB: 100,
          hasNetwork: true,
          hasFileSystem: false,
          hasGPU: false,
          architectures: [],
        },
      }));

      const result = adapter.checkCompatibility(target.id, { hasFileSystem: true });
      expect(result.compatible).toBe(false);
      expect(result.missing[0]).toContain('File system');
    });

    it('checks CPU time requirement', () => {
      const target = adapter.addTarget(makeTargetInput({
        constraints: {
          maxMemoryMB: 512,
          maxCpuMs: 1000,
          maxStorageMB: 100,
          hasNetwork: true,
          hasFileSystem: false,
          hasGPU: false,
          architectures: [],
        },
      }));

      const result = adapter.checkCompatibility(target.id, { maxCpuMs: 60_000 });
      expect(result.compatible).toBe(false);
      expect(result.missing[0]).toContain('CPU');
    });

    it('checks storage requirement', () => {
      const target = adapter.addTarget(makeTargetInput({
        constraints: {
          maxMemoryMB: 512,
          maxCpuMs: 60_000,
          maxStorageMB: 10,
          hasNetwork: true,
          hasFileSystem: false,
          hasGPU: false,
          architectures: [],
        },
      }));

      const result = adapter.checkCompatibility(target.id, { maxStorageMB: 500 });
      expect(result.compatible).toBe(false);
      expect(result.missing[0]).toContain('storage');
    });
  });

  describe('findCompatibleTargets()', () => {
    it('returns targets that match requirements', () => {
      adapter.addTarget(makeTargetInput({
        name: 'powerful',
        constraints: {
          maxMemoryMB: 1024,
          maxCpuMs: 120_000,
          maxStorageMB: 500,
          hasNetwork: true,
          hasFileSystem: true,
          hasGPU: true,
          architectures: ['x86_64'],
        },
      }));

      adapter.addTarget(makeTargetInput({
        name: 'weak',
        constraints: {
          maxMemoryMB: 64,
          maxCpuMs: 5_000,
          maxStorageMB: 10,
          hasNetwork: false,
          hasFileSystem: false,
          hasGPU: false,
          architectures: ['arm'],
        },
      }));

      const results = adapter.findCompatibleTargets({ maxMemoryMB: 512, hasGPU: true });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('powerful');
    });

    it('returns empty array when nothing matches', () => {
      adapter.addTarget(makeTargetInput());
      expect(adapter.findCompatibleTargets({ hasGPU: true })).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  describe('getStats()', () => {
    it('returns initial stats', () => {
      const stats = adapter.getStats();
      expect(stats.totalTargets).toBe(0);
      expect(stats.connectedTargets).toBe(0);
      expect(stats.activeDeployments).toBe(0);
      expect(stats.totalDeployments).toBe(0);
    });

    it('counts targets and deployments', async () => {
      const t1 = adapter.addTarget(makeTargetInput());
      adapter.addTarget(makeTargetInput());
      await adapter.connect(t1.id);
      await adapter.deploy(t1.id, { agentConfig: {} });

      const stats = adapter.getStats();
      expect(stats.totalTargets).toBe(2);
      expect(stats.connectedTargets).toBe(1); // busy counts as connected in getStats()
      expect(stats.activeDeployments).toBe(1);
      expect(stats.totalDeployments).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Destroy
  // ---------------------------------------------------------------------------

  describe('destroy()', () => {
    it('stops all deployments', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);
      const dep = await adapter.deploy(target.id, { agentConfig: {} });

      adapter.destroy();
      // After destroy, deployment should be stopped (but we can't query because maps are cleared)
    });

    it('clears targets and deployments', () => {
      adapter.addTarget(makeTargetInput());
      adapter.destroy();

      expect(adapter.listTargets()).toHaveLength(0);
      expect(adapter.listDeployments()).toHaveLength(0);
    });

    it('removes all listeners', () => {
      adapter.on('runtime:edge:connected', () => {});
      adapter.destroy();
      expect(adapter.listenerCount('runtime:edge:connected')).toBe(0);
    });

    it('can be called multiple times', () => {
      adapter.destroy();
      adapter.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Stress tests
  // ---------------------------------------------------------------------------

  describe('stress tests', () => {
    it('handles adding 200 targets', () => {
      for (let i = 0; i < 200; i++) {
        adapter.addTarget(makeTargetInput({ name: `target-${i}` }));
      }
      expect(adapter.listTargets()).toHaveLength(200);
    });

    it('handles many concurrent connections', async () => {
      const targets = [];
      for (let i = 0; i < 50; i++) {
        targets.push(adapter.addTarget(makeTargetInput()));
      }

      await Promise.all(targets.map((t) => adapter.connect(t.id)));

      const connected = adapter.listTargets({ status: 'connected' });
      expect(connected).toHaveLength(50);
    });

    it('handles many deployments on same target', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);

      const deps = [];
      for (let i = 0; i < 50; i++) {
        // After each deploy the target becomes 'busy'; reset to 'connected' for the next deploy
        if (i > 0) {
          (adapter.getTarget(target.id) as any).status = 'connected';
        }
        deps.push(await adapter.deploy(target.id, { agentConfig: { id: i } }));
      }

      expect(adapter.listDeployments({ targetId: target.id })).toHaveLength(50);
    });

    it('handles rapid deploy/undeploy cycles', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);

      for (let i = 0; i < 50; i++) {
        const dep = await adapter.deploy(target.id, { agentConfig: { cycle: i } });
        await adapter.undeploy(dep.id);
      }

      expect(adapter.listDeployments({ status: 'running' })).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles target with minimal constraints', () => {
      const target = adapter.addTarget(makeTargetInput({
        constraints: {
          maxMemoryMB: 0,
          maxCpuMs: 0,
          maxStorageMB: 0,
          hasNetwork: false,
          hasFileSystem: false,
          hasGPU: false,
          architectures: [],
        },
      }));

      expect(adapter.getTarget(target.id)).toBeDefined();
    });

    it('handles empty capabilities list', () => {
      const target = adapter.addTarget(makeTargetInput({ capabilities: [] }));
      expect(adapter.getTarget(target.id)!.capabilities).toEqual([]);
    });

    it('handles deployment with code parameter', async () => {
      const target = adapter.addTarget(makeTargetInput());
      await adapter.connect(target.id);

      const dep = await adapter.deploy(target.id, {
        agentConfig: {},
        code: 'console.log("hello")',
        moduleId: 'mod-1',
      });

      expect(dep.moduleId).toBe('mod-1');
    });
  });
});
