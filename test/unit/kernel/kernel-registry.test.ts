/**
 * KernelRegistry — Syscall Table Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KernelRegistry } from '../../../src/kernel/kernel-registry.js';
import { KERNEL_LAYER_MAP, KERNEL_PRIMITIVE_DEPENDENCIES } from '../../../src/kernel/types.js';
import type { KernelPrimitiveId } from '../../../src/kernel/types.js';

describe('KernelRegistry', () => {
  let registry: KernelRegistry;

  beforeEach(() => {
    registry = new KernelRegistry();
  });

  describe('lifecycle', () => {
    it('should start and stop', () => {
      expect(registry.isRunning()).toBe(false);
      registry.start();
      expect(registry.isRunning()).toBe(true);
      registry.stop();
      expect(registry.isRunning()).toBe(false);
    });

    it('should emit lifecycle events', () => {
      const started = vi.fn();
      const stopped = vi.fn();
      registry.on('kernel:started', started);
      registry.on('kernel:stopped', stopped);

      registry.start();
      expect(started).toHaveBeenCalledTimes(1);

      registry.stop();
      expect(stopped).toHaveBeenCalledTimes(1);
    });
  });

  describe('register', () => {
    it('should register a primitive handler', () => {
      const handler = vi.fn().mockResolvedValue({ result: 'ok' });
      registry.register('attention', handler);
      expect(registry.has('attention')).toBe(true);
    });

    it('should reject duplicate registration', () => {
      registry.register('attention', vi.fn());
      expect(() => registry.register('attention', vi.fn())).toThrow(
        "Kernel primitive 'attention' is already registered"
      );
    });

    it('should emit registered event', () => {
      const listener = vi.fn();
      registry.on('kernel:primitive:registered', listener);

      registry.register('attention', vi.fn());

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          primitiveId: 'attention',
          layer: 0,
        })
      );
    });

    it('should register with correct layer', () => {
      registry.register('attention', vi.fn());
      const info = registry.getPrimitiveInfo('attention');
      expect(info?.layer).toBe(0);

      registry.register('reason', vi.fn());
      const reasonInfo = registry.getPrimitiveInfo('reason');
      expect(reasonInfo?.layer).toBe(1);

      registry.register('search', vi.fn());
      const searchInfo = registry.getPrimitiveInfo('search');
      expect(searchInfo?.layer).toBe(3);
    });
  });

  describe('unregister', () => {
    it('should unregister a primitive', () => {
      registry.register('attention', vi.fn());
      expect(registry.has('attention')).toBe(true);

      const result = registry.unregister('attention');
      expect(result).toBe(true);
      expect(registry.has('attention')).toBe(false);
    });

    it('should return false for non-existent primitive', () => {
      expect(registry.unregister('attention')).toBe(false);
    });

    it('should emit unregistered event', () => {
      const listener = vi.fn();
      registry.on('kernel:primitive:unregistered', listener);

      registry.register('attention', vi.fn());
      registry.unregister('attention');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ primitiveId: 'attention' })
      );
    });
  });

  describe('call', () => {
    it('should call a registered handler', async () => {
      const handler = vi.fn().mockResolvedValue({ output: [[1, 2, 3]] });
      registry.register('attention', handler);

      const result = await registry.call('attention', { query: [[1]], key: [[1]], value: [[1]] });
      expect(result).toEqual({ output: [[1, 2, 3]] });
      expect(handler).toHaveBeenCalledWith({ query: [[1]], key: [[1]], value: [[1]] });
    });

    it('should throw for unregistered primitive', async () => {
      await expect(registry.call('attention', {})).rejects.toThrow(
        "Kernel primitive 'attention' is not registered"
      );
    });

    it('should throw for disabled primitive', async () => {
      registry.register('attention', vi.fn());
      registry.setEnabled('attention', false);

      await expect(registry.call('attention', {})).rejects.toThrow(
        "Kernel primitive 'attention' is disabled"
      );
    });

    it('should track call metrics', async () => {
      const handler = vi.fn().mockResolvedValue('ok');
      registry.register('attention', handler);

      await registry.call('attention', {});
      await registry.call('attention', {});

      const info = registry.getPrimitiveInfo('attention');
      expect(info?.callCount).toBe(2);
      expect(info?.errorCount).toBe(0);
    });

    it('should track error metrics', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('test error'));
      registry.register('attention', handler);

      await expect(registry.call('attention', {})).rejects.toThrow('test error');

      const info = registry.getPrimitiveInfo('attention');
      expect(info?.callCount).toBe(1);
      expect(info?.errorCount).toBe(1);
    });

    it('should emit called/completed events', async () => {
      const called = vi.fn();
      const completed = vi.fn();
      registry.on('kernel:primitive:called', called);
      registry.on('kernel:primitive:completed', completed);

      registry.register('attention', vi.fn().mockResolvedValue('ok'));
      await registry.call('attention', {});

      expect(called).toHaveBeenCalledWith(
        expect.objectContaining({ primitiveId: 'attention' })
      );
      expect(completed).toHaveBeenCalledWith(
        expect.objectContaining({ primitiveId: 'attention' })
      );
    });

    it('should emit error event on failure', async () => {
      const errorListener = vi.fn();
      registry.on('kernel:primitive:error', errorListener);

      registry.register('attention', vi.fn().mockRejectedValue(new Error('boom')));
      await expect(registry.call('attention', {})).rejects.toThrow('boom');

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({ primitiveId: 'attention', error: 'boom' })
      );
    });

    it('should enforce concurrency limit', async () => {
      const reg = new KernelRegistry({ maxConcurrency: 1 });

      // Create a handler that doesn't resolve immediately
      let resolve1: () => void;
      const handler = vi.fn().mockImplementation(() => new Promise(r => { resolve1 = r as () => void; }));
      reg.register('attention', handler);

      // Start first call
      const call1 = reg.call('attention', {});

      // Second call should fail due to concurrency limit
      await expect(reg.call('attention', {})).rejects.toThrow('concurrency limit');

      // Resolve first call
      resolve1!();
      await call1;
    });

    it('should timeout long-running calls', async () => {
      const reg = new KernelRegistry({ callTimeoutMs: 50 });
      const handler = vi.fn().mockImplementation(() => new Promise(() => {})); // Never resolves
      reg.register('attention', handler);

      await expect(reg.call('attention', {})).rejects.toThrow('timed out');
    });

    it('should update budget on calls', async () => {
      registry.register('attention', vi.fn().mockResolvedValue('ok'));
      registry.register('reason', vi.fn().mockResolvedValue('ok'));

      await registry.call('attention', {});
      await registry.call('attention', {});
      await registry.call('reason', {});

      const budget = registry.getBudget();
      expect(budget.totalCalls).toBe(3);
      expect(budget.callsByPrimitive['attention']).toBe(2);
      expect(budget.callsByPrimitive['reason']).toBe(1);
    });

    it('should record call history', async () => {
      registry.register('attention', vi.fn().mockResolvedValue('ok'));
      await registry.call('attention', {});

      const stats = registry.getStats();
      expect(stats.callHistory.length).toBe(1);
      expect(stats.callHistory[0].primitiveId).toBe('attention');
      expect(stats.callHistory[0].success).toBe(true);
    });
  });

  describe('setEnabled', () => {
    it('should enable and disable primitives', () => {
      registry.register('attention', vi.fn());

      expect(registry.isEnabled('attention')).toBe(true); // auto-start default

      registry.setEnabled('attention', false);
      expect(registry.isEnabled('attention')).toBe(false);

      registry.setEnabled('attention', true);
      expect(registry.isEnabled('attention')).toBe(true);
    });

    it('should throw for non-existent primitive', () => {
      expect(() => registry.setEnabled('attention', false)).toThrow(
        "Kernel primitive 'attention' is not registered"
      );
    });

    it('should emit enabled/disabled events', () => {
      const enabled = vi.fn();
      const disabled = vi.fn();
      registry.on('kernel:primitive:enabled', enabled);
      registry.on('kernel:primitive:disabled', disabled);

      registry.register('attention', vi.fn());
      registry.setEnabled('attention', false);
      registry.setEnabled('attention', true);

      expect(disabled).toHaveBeenCalledTimes(1);
      expect(enabled).toHaveBeenCalledTimes(1);
    });
  });

  describe('validateDependencies', () => {
    it('should validate when all dependencies are met', () => {
      registry.register('attention', vi.fn());
      registry.register('reason', vi.fn()); // depends on attention

      const validation = registry.validateDependencies();
      expect(validation.valid).toBe(true);
      expect(validation.missingDependencies).toHaveLength(0);
    });

    it('should detect missing dependencies', () => {
      // Register reason without attention (reason depends on attention)
      registry.register('reason', vi.fn());

      const validation = registry.validateDependencies();
      expect(validation.valid).toBe(false);
      expect(validation.missingDependencies.length).toBeGreaterThan(0);
      expect(validation.missingDependencies[0].primitive).toBe('reason');
      expect(validation.missingDependencies[0].missing).toContain('attention');
    });

    it('should pass for layer 0 primitives (no deps)', () => {
      registry.register('attention', vi.fn());

      const validation = registry.validateDependencies();
      expect(validation.valid).toBe(true);
    });
  });

  describe('getInitializationOrder', () => {
    it('should return layer-sorted order', () => {
      registry.register('search', vi.fn()); // Layer 3
      registry.register('reason', vi.fn()); // Layer 1
      registry.register('attention', vi.fn()); // Layer 0
      registry.register('retrieve', vi.fn()); // Layer 2

      const order = registry.getInitializationOrder();

      const getLayer = (id: KernelPrimitiveId) => KERNEL_LAYER_MAP[id];
      for (let i = 1; i < order.length; i++) {
        expect(getLayer(order[i])).toBeGreaterThanOrEqual(getLayer(order[i - 1]));
      }
    });

    it('should put dependencies before dependents', () => {
      registry.register('reason', vi.fn()); // depends on attention
      registry.register('attention', vi.fn());

      const order = registry.getInitializationOrder();
      const attIdx = order.indexOf('attention');
      const reasonIdx = order.indexOf('reason');
      expect(attIdx).toBeLessThan(reasonIdx);
    });
  });

  describe('getLayerStats', () => {
    it('should return stats for all 6 layers', () => {
      const stats = registry.getLayerStats();
      expect(Object.keys(stats)).toHaveLength(6);
      expect(stats[0]).toBeDefined();
      expect(stats[5]).toBeDefined();
    });

    it('should track registered count per layer', () => {
      registry.register('attention', vi.fn()); // Layer 0
      registry.register('scale', vi.fn()); // Layer 1
      registry.register('reason', vi.fn()); // Layer 1

      const stats = registry.getLayerStats();
      expect(stats[0].registeredCount).toBe(1);
      expect(stats[1].registeredCount).toBe(2);
    });

    it('should track call counts per layer', async () => {
      registry.register('attention', vi.fn().mockResolvedValue('ok'));
      await registry.call('attention', {});
      await registry.call('attention', {});

      const stats = registry.getLayerStats();
      expect(stats[0].totalCalls).toBe(2);
    });
  });

  describe('static methods', () => {
    it('should return all 19 primitive IDs', () => {
      const ids = KernelRegistry.getAllPrimitiveIds();
      expect(ids).toHaveLength(19);
      expect(ids).toContain('attention');
      expect(ids).toContain('judge');
    });

    it('should return correct layer for each primitive', () => {
      expect(KernelRegistry.getLayer('attention')).toBe(0);
      expect(KernelRegistry.getLayer('reason')).toBe(1);
      expect(KernelRegistry.getLayer('retrieve')).toBe(2);
      expect(KernelRegistry.getLayer('search')).toBe(3);
      expect(KernelRegistry.getLayer('adapt')).toBe(4);
      expect(KernelRegistry.getLayer('route')).toBe(5);
    });

    it('should return dependencies for each primitive', () => {
      expect(KernelRegistry.getDependencies('attention')).toEqual([]);
      expect(KernelRegistry.getDependencies('reason')).toContain('attention');
      expect(KernelRegistry.getDependencies('search')).toContain('attention');
      expect(KernelRegistry.getDependencies('search')).toContain('reason');
    });
  });

  describe('getStats', () => {
    it('should return comprehensive stats', async () => {
      registry.start();
      registry.register('attention', vi.fn().mockResolvedValue('ok'));
      await registry.call('attention', {});

      const stats = registry.getStats();
      expect(stats.running).toBe(true);
      expect(stats.registeredPrimitives).toBe(1);
      expect(stats.enabledPrimitives).toBe(1);
      expect(stats.totalCalls).toBe(1);
      expect(stats.totalErrors).toBe(0);
      expect(stats.errorRate).toBe(0);
      expect(stats.avgCallDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('KERNEL_LAYER_MAP', () => {
    it('should have all 19 primitives mapped', () => {
      const keys = Object.keys(KERNEL_LAYER_MAP);
      expect(keys).toHaveLength(19);
    });

    it('should have valid layer values (0-5)', () => {
      for (const layer of Object.values(KERNEL_LAYER_MAP)) {
        expect(layer).toBeGreaterThanOrEqual(0);
        expect(layer).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('KERNEL_PRIMITIVE_DEPENDENCIES', () => {
    it('should have entries for all 19 primitives', () => {
      const keys = Object.keys(KERNEL_PRIMITIVE_DEPENDENCIES);
      expect(keys).toHaveLength(19);
    });

    it('should only depend on lower-layer primitives', () => {
      for (const [primitive, deps] of Object.entries(KERNEL_PRIMITIVE_DEPENDENCIES)) {
        const layer = KERNEL_LAYER_MAP[primitive as KernelPrimitiveId];
        for (const dep of deps) {
          const depLayer = KERNEL_LAYER_MAP[dep as KernelPrimitiveId];
          expect(depLayer).toBeLessThan(layer);
        }
      }
    });

    it('attention should have no dependencies', () => {
      expect(KERNEL_PRIMITIVE_DEPENDENCIES['attention']).toEqual([]);
    });
  });
});
