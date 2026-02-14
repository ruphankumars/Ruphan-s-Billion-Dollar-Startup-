/**
 * GPUManager — Unit Tests
 *
 * Tests GPU resource management: lifecycle, device registration/removal,
 * best-fit memory allocation, release, inference request submission,
 * batch processing, and statistics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GPUManager } from '../../../src/gpu/gpu-manager.js';

describe('GPUManager', () => {
  let gpu: GPUManager;

  beforeEach(() => {
    gpu = new GPUManager();
  });

  afterEach(() => {
    gpu.stop();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('creates manager with default config', () => {
      expect(gpu.isRunning()).toBe(false);
      expect(gpu.getStats().totalDevices).toBe(0);
    });

    it('merges partial config', () => {
      const custom = new GPUManager({ maxDevices: 4, batchSize: 4 });
      expect(custom.getStats().totalDevices).toBe(0);
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('start / stop lifecycle', () => {
    it('starts and emits event', () => {
      const handler = vi.fn();
      gpu.on('gpu:started', handler);
      gpu.start();
      expect(gpu.isRunning()).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('stops and emits event', () => {
      const handler = vi.fn();
      gpu.on('gpu:stopped', handler);
      gpu.start();
      gpu.stop();
      expect(gpu.isRunning()).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('double start is idempotent', () => {
      const handler = vi.fn();
      gpu.on('gpu:started', handler);
      gpu.start();
      gpu.start();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Device Management ──────────────────────────────────────

  describe('registerDevice / removeDevice', () => {
    it('registers a device with generated id and default metrics', () => {
      const device = gpu.registerDevice({
        name: 'RTX 4090',
        vendor: 'NVIDIA',
        memoryMb: 24576,
        computeUnits: 128,
        available: true,
      });

      expect(device.id).toMatch(/^gpu-/);
      expect(device.name).toBe('RTX 4090');
      expect(device.utilization).toBe(0);
      expect(device.temperature).toBe(35);
      expect(device.allocations).toHaveLength(0);
      expect(gpu.listDevices()).toHaveLength(1);
    });

    it('throws when max device limit is reached', () => {
      const limited = new GPUManager({ maxDevices: 1 });
      limited.registerDevice({
        name: 'G1',
        vendor: 'V',
        memoryMb: 1024,
        computeUnits: 8,
        available: true,
      });

      expect(() =>
        limited.registerDevice({
          name: 'G2',
          vendor: 'V',
          memoryMb: 1024,
          computeUnits: 8,
          available: true,
        }),
      ).toThrow(/Maximum device limit/);
    });

    it('removes a device and releases its allocations', () => {
      const device = gpu.registerDevice({
        name: 'G',
        vendor: 'V',
        memoryMb: 8192,
        computeUnits: 32,
        available: true,
      });

      gpu.allocate('agent-1', 512, 10);

      expect(gpu.removeDevice(device.id)).toBe(true);
      expect(gpu.listDevices()).toHaveLength(0);
      expect(gpu.getAllocations()).toHaveLength(0);
    });

    it('returns false for non-existent device removal', () => {
      expect(gpu.removeDevice('ghost')).toBe(false);
    });

    it('retrieves device by id', () => {
      const device = gpu.registerDevice({
        name: 'G',
        vendor: 'V',
        memoryMb: 4096,
        computeUnits: 16,
        available: true,
      });

      expect(gpu.getDevice(device.id)).toBeDefined();
      expect(gpu.getDevice(device.id)!.name).toBe('G');
    });
  });

  // ── Allocation ─────────────────────────────────────────────

  describe('allocate / release', () => {
    beforeEach(() => {
      gpu.registerDevice({
        name: 'RTX',
        vendor: 'NVIDIA',
        memoryMb: 8192,
        computeUnits: 64,
        available: true,
      });
    });

    it('allocates memory and compute to an agent', () => {
      const alloc = gpu.allocate('agent-1', 1024, 25);

      expect(alloc.id).toMatch(/^alloc-/);
      expect(alloc.agentId).toBe('agent-1');
      expect(alloc.memoryMb).toBe(1024);
      expect(alloc.computePercent).toBe(25);
      expect(alloc.expiresAt).toBeGreaterThan(alloc.startedAt);
    });

    it('updates device utilization and temperature after allocation', () => {
      gpu.allocate('agent-1', 4096, 50);

      const devices = gpu.listDevices();
      expect(devices[0].utilization).toBeGreaterThan(0);
      expect(devices[0].temperature).toBeGreaterThan(35);
    });

    it('throws when no device has enough resources', () => {
      expect(() => gpu.allocate('agent-x', 100000, 200)).toThrow(/No available GPU device/);
    });

    it('uses best-fit selection among multiple devices', () => {
      // Add a second smaller device
      gpu.registerDevice({
        name: 'Small',
        vendor: 'AMD',
        memoryMb: 2048,
        computeUnits: 16,
        available: true,
      });

      // Requesting 1024MB should go to the smaller device (best-fit minimizes waste)
      const alloc = gpu.allocate('agent-fit', 1024, 10);
      const device = gpu.getDevice(alloc.deviceId);
      expect(device!.name).toBe('Small');
    });

    it('releases an allocation and recalculates metrics', () => {
      const alloc = gpu.allocate('agent-1', 2048, 30);
      const deviceId = alloc.deviceId;

      expect(gpu.release(alloc.id)).toBe(true);
      expect(gpu.getAllocations()).toHaveLength(0);

      const device = gpu.getDevice(deviceId)!;
      expect(device.utilization).toBe(0);
      expect(device.temperature).toBe(35);
    });

    it('returns false for non-existent allocation release', () => {
      expect(gpu.release('ghost')).toBe(false);
    });

    it('filters allocations by agentId', () => {
      gpu.allocate('a1', 512, 10);
      gpu.allocate('a2', 512, 10);
      gpu.allocate('a1', 256, 5);

      expect(gpu.getAllocations('a1')).toHaveLength(2);
      expect(gpu.getAllocations('a2')).toHaveLength(1);
    });

    it('skips unavailable devices during allocation', () => {
      // Register an unavailable device with more memory
      gpu.registerDevice({
        name: 'Offline',
        vendor: 'V',
        memoryMb: 32768,
        computeUnits: 128,
        available: false,
      });

      // Should allocate to the available device
      const alloc = gpu.allocate('agent-1', 512, 5);
      const device = gpu.getDevice(alloc.deviceId)!;
      expect(device.available).toBe(true);
    });
  });

  // ── Inference Requests ─────────────────────────────────────

  describe('submitInferenceRequest', () => {
    it('submits request and returns it with generated id', () => {
      gpu.registerDevice({
        name: 'G',
        vendor: 'V',
        memoryMb: 4096,
        computeUnits: 16,
        available: true,
      });

      const req = gpu.submitInferenceRequest('agent-1', 'gpt-4', 'Hello');

      expect(req.id).toMatch(/^req-/);
      expect(req.agentId).toBe('agent-1');
      expect(req.model).toBe('gpt-4');
      expect(req.input).toBe('Hello');
      expect(req.priority).toBe(5); // default
      expect(req.maxTokens).toBe(2048); // default
    });

    it('throws when no devices available', () => {
      expect(() =>
        gpu.submitInferenceRequest('agent-1', 'gpt-4', 'Hello'),
      ).toThrow(/No available GPU devices/);
    });

    it('emits request:submitted event', () => {
      gpu.registerDevice({
        name: 'G',
        vendor: 'V',
        memoryMb: 4096,
        computeUnits: 16,
        available: true,
      });

      const handler = vi.fn();
      gpu.on('gpu:request:submitted', handler);

      gpu.submitInferenceRequest('a', 'model', 'input');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Batch Processing ───────────────────────────────────────

  describe('processBatch', () => {
    it('processes pending requests as a batch', () => {
      const device = gpu.registerDevice({
        name: 'G',
        vendor: 'V',
        memoryMb: 4096,
        computeUnits: 16,
        available: true,
      });

      gpu.submitInferenceRequest('a1', 'model', 'input1');
      gpu.submitInferenceRequest('a2', 'model', 'input2');

      const batch = gpu.processBatch(device.id);

      expect(batch.id).toMatch(/^batch-/);
      expect(batch.requests).toHaveLength(2);
      expect(batch.status).toBe('completed');
      expect(batch.completedAt).toBeDefined();
    });

    it('returns empty completed batch when no pending requests', () => {
      const device = gpu.registerDevice({
        name: 'G',
        vendor: 'V',
        memoryMb: 4096,
        computeUnits: 16,
        available: true,
      });

      const batch = gpu.processBatch(device.id);

      expect(batch.requests).toHaveLength(0);
      expect(batch.status).toBe('completed');
    });

    it('respects batch size limit', () => {
      const small = new GPUManager({ batchSize: 2 });
      const device = small.registerDevice({
        name: 'G',
        vendor: 'V',
        memoryMb: 4096,
        computeUnits: 16,
        available: true,
      });

      for (let i = 0; i < 5; i++) {
        small.submitInferenceRequest(`a${i}`, 'model', `input${i}`);
      }

      const batch = small.processBatch(device.id);
      expect(batch.requests).toHaveLength(2);
    });

    it('throws for non-existent device', () => {
      expect(() => gpu.processBatch('ghost')).toThrow(/not found/);
    });

    it('increments batch stats after processing', () => {
      const device = gpu.registerDevice({
        name: 'G',
        vendor: 'V',
        memoryMb: 4096,
        computeUnits: 16,
        available: true,
      });

      gpu.submitInferenceRequest('a', 'model', 'input');
      gpu.processBatch(device.id);

      const stats = gpu.getStats();
      expect(stats.totalBatches).toBe(1);
      expect(stats.avgBatchLatency).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zeroed stats initially', () => {
      const stats = gpu.getStats();
      expect(stats.totalDevices).toBe(0);
      expect(stats.totalAllocations).toBe(0);
      expect(stats.totalMemoryMb).toBe(0);
      expect(stats.usedMemoryMb).toBe(0);
      expect(stats.avgUtilization).toBe(0);
      expect(stats.totalBatches).toBe(0);
      expect(stats.avgBatchLatency).toBe(0);
    });

    it('tracks device memory and allocations', () => {
      gpu.registerDevice({
        name: 'G',
        vendor: 'V',
        memoryMb: 8192,
        computeUnits: 32,
        available: true,
      });

      gpu.allocate('a1', 2048, 20);

      const stats = gpu.getStats();
      expect(stats.totalDevices).toBe(1);
      expect(stats.totalAllocations).toBe(1);
      expect(stats.totalMemoryMb).toBe(8192);
      expect(stats.usedMemoryMb).toBe(2048);
      expect(stats.avgUtilization).toBeGreaterThan(0);
    });

    it('tracks batch metrics', () => {
      const device = gpu.registerDevice({
        name: 'G',
        vendor: 'V',
        memoryMb: 4096,
        computeUnits: 16,
        available: true,
      });

      gpu.submitInferenceRequest('a', 'model', 'hello');
      gpu.processBatch(device.id);
      gpu.submitInferenceRequest('b', 'model', 'world');
      gpu.processBatch(device.id);

      const stats = gpu.getStats();
      expect(stats.totalBatches).toBe(2);
    });
  });
});
