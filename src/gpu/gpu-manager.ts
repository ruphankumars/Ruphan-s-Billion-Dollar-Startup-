/**
 * GPUManager — GPU Resource Management Engine
 *
 * Manages simulated GPU devices with memory and compute allocation,
 * best-fit device selection to minimize fragmentation, inference request
 * batching, and automatic expiration cleanup. Designed for orchestrating
 * AI agent workloads across heterogeneous GPU resources.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  GPUDevice,
  GPUAllocation,
  InferenceBatch,
  InferenceRequest,
  GPUConfig,
  GPUStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: GPUConfig = {
  enabled: true,
  maxDevices: 16,
  maxAllocationsPerDevice: 32,
  overcommitRatio: 1.2,
  batchSize: 8,
  batchTimeoutMs: 5000,
};

/** Default allocation duration: 1 hour */
const DEFAULT_ALLOCATION_DURATION_MS = 60 * 60 * 1000;

/** Simulated base temperature for GPU devices */
const BASE_TEMPERATURE = 35;

/** Temperature increase per utilization percentage point */
const TEMP_PER_UTIL_POINT = 0.5;

// ═══════════════════════════════════════════════════════════════
// GPU MANAGER
// ═══════════════════════════════════════════════════════════════

export class GPUManager extends EventEmitter {
  private config: GPUConfig;
  private running = false;

  /** Registered GPU devices keyed by device ID */
  private devices: Map<string, GPUDevice> = new Map();

  /** Active allocations keyed by allocation ID */
  private allocations: Map<string, GPUAllocation> = new Map();

  /** Inference batches keyed by batch ID */
  private batches: Map<string, InferenceBatch> = new Map();

  /** Pending inference requests (not yet batched), keyed by device ID */
  private pendingRequests: Map<string, InferenceRequest[]> = new Map();

  /** Tracking: total completed batches and cumulative latency */
  private totalCompletedBatches = 0;
  private cumulativeBatchLatency = 0;

  constructor(config?: Partial<GPUConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit('gpu:started', { timestamp: Date.now() });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.emit('gpu:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // DEVICE MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Register a new GPU device.
   */
  registerDevice(
    device: Omit<GPUDevice, 'id' | 'allocations' | 'utilization' | 'temperature'>,
  ): GPUDevice {
    if (this.devices.size >= this.config.maxDevices) {
      throw new Error(`Maximum device limit reached (${this.config.maxDevices})`);
    }

    const newDevice: GPUDevice = {
      ...device,
      id: `gpu-${randomUUID().slice(0, 8)}`,
      allocations: [],
      utilization: 0,
      temperature: BASE_TEMPERATURE,
    };

    this.devices.set(newDevice.id, newDevice);
    this.pendingRequests.set(newDevice.id, []);

    this.emit('gpu:device:registered', { device: newDevice, timestamp: Date.now() });
    return newDevice;
  }

  /**
   * Remove a GPU device. Releases all active allocations on it first.
   */
  removeDevice(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    // Release all allocations on this device
    for (const allocation of [...device.allocations]) {
      this.release(allocation.id);
    }

    this.devices.delete(deviceId);
    this.pendingRequests.delete(deviceId);

    this.emit('gpu:device:removed', { deviceId, timestamp: Date.now() });
    return true;
  }

  /**
   * Get a device by ID.
   */
  getDevice(id: string): GPUDevice | undefined {
    return this.devices.get(id);
  }

  /**
   * List all registered devices.
   */
  listDevices(): GPUDevice[] {
    return [...this.devices.values()];
  }

  // ─────────────────────────────────────────────────────────
  // ALLOCATION
  // ─────────────────────────────────────────────────────────

  /**
   * Allocate GPU resources (memory + compute) for an agent.
   * Uses best-fit device selection to minimize fragmentation.
   */
  allocate(
    agentId: string,
    memoryMb: number,
    computePercent: number,
    durationMs?: number,
  ): GPUAllocation {
    // Clean up expired allocations first
    this.cleanupExpired();

    const device = this.findBestDevice(memoryMb, computePercent);
    if (!device) {
      throw new Error(
        `No available GPU device with ${memoryMb}MB memory and ${computePercent}% compute`,
      );
    }

    // Check allocation limit per device
    if (device.allocations.length >= this.config.maxAllocationsPerDevice) {
      throw new Error(
        `Device "${device.id}" has reached max allocations (${this.config.maxAllocationsPerDevice})`,
      );
    }

    const now = Date.now();
    const allocation: GPUAllocation = {
      id: `alloc-${randomUUID().slice(0, 8)}`,
      deviceId: device.id,
      agentId,
      memoryMb,
      computePercent,
      startedAt: now,
      expiresAt: now + (durationMs ?? DEFAULT_ALLOCATION_DURATION_MS),
    };

    device.allocations.push(allocation);
    this.allocations.set(allocation.id, allocation);

    // Recalculate device utilization and temperature
    this.recalculateDeviceMetrics(device);

    this.emit('gpu:allocated', { allocation, timestamp: now });
    return allocation;
  }

  /**
   * Release a GPU allocation, freeing the resources.
   */
  release(allocationId: string): boolean {
    const allocation = this.allocations.get(allocationId);
    if (!allocation) return false;

    const device = this.devices.get(allocation.deviceId);
    if (device) {
      device.allocations = device.allocations.filter((a) => a.id !== allocationId);
      this.recalculateDeviceMetrics(device);
    }

    this.allocations.delete(allocationId);

    this.emit('gpu:released', { allocationId, timestamp: Date.now() });
    return true;
  }

  /**
   * Get allocations, optionally filtered by agent ID.
   */
  getAllocations(agentId?: string): GPUAllocation[] {
    const all = [...this.allocations.values()];
    if (agentId) {
      return all.filter((a) => a.agentId === agentId);
    }
    return all;
  }

  // ─────────────────────────────────────────────────────────
  // INFERENCE BATCHING
  // ─────────────────────────────────────────────────────────

  /**
   * Submit an inference request to the batch queue.
   * Requests are queued per-device (assigned to the device with
   * lowest utilization) and processed when the batch is full or
   * processBatch() is called explicitly.
   */
  submitInferenceRequest(
    agentId: string,
    model: string,
    input: string,
    priority?: number,
    maxTokens?: number,
  ): InferenceRequest {
    const request: InferenceRequest = {
      id: `req-${randomUUID().slice(0, 8)}`,
      agentId,
      model,
      input,
      priority: priority ?? 5,
      maxTokens: maxTokens ?? 2048,
    };

    // Find device with lowest utilization for the request
    const targetDevice = this.findLowestUtilizationDevice();
    if (!targetDevice) {
      throw new Error('No available GPU devices for inference');
    }

    const queue = this.pendingRequests.get(targetDevice.id);
    if (queue) {
      queue.push(request);
      // Sort by priority (higher first)
      queue.sort((a, b) => b.priority - a.priority);
    }

    this.emit('gpu:request:submitted', {
      request,
      deviceId: targetDevice.id,
      timestamp: Date.now(),
    });

    return request;
  }

  /**
   * Process queued inference requests on a device as a batch.
   * Takes up to batchSize requests from the queue and creates
   * a simulated batch execution.
   */
  processBatch(deviceId: string): InferenceBatch {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device "${deviceId}" not found`);
    }

    const queue = this.pendingRequests.get(deviceId) ?? [];
    const batchRequests = queue.splice(0, this.config.batchSize);

    if (batchRequests.length === 0) {
      // Return an empty completed batch
      const emptyBatch: InferenceBatch = {
        id: `batch-${randomUUID().slice(0, 8)}`,
        deviceId,
        requests: [],
        status: 'completed',
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      this.batches.set(emptyBatch.id, emptyBatch);
      return emptyBatch;
    }

    const now = Date.now();
    const batch: InferenceBatch = {
      id: `batch-${randomUUID().slice(0, 8)}`,
      deviceId,
      requests: batchRequests,
      status: 'processing',
      createdAt: now,
    };

    this.batches.set(batch.id, batch);

    // Simulate batch processing (synchronous for simplicity)
    // In a real system, this would be async with actual GPU calls
    const processingTime = batchRequests.reduce(
      (sum, r) => sum + Math.min(r.maxTokens * 0.1, 500),
      0,
    );

    batch.status = 'completed';
    batch.completedAt = now + Math.round(processingTime);

    // Track batch metrics
    this.totalCompletedBatches++;
    this.cumulativeBatchLatency += Math.round(processingTime);

    // Update device utilization spike
    device.utilization = Math.min(
      device.utilization + batchRequests.length * 5,
      100,
    );
    this.recalculateDeviceMetrics(device);

    this.emit('gpu:batch:completed', { batch, timestamp: now });
    return batch;
  }

  // ─────────────────────────────────────────────────────────
  // STATISTICS
  // ─────────────────────────────────────────────────────────

  /**
   * Get GPU resource management statistics.
   */
  getStats(): GPUStats {
    const allDevices = [...this.devices.values()];
    const totalMemoryMb = allDevices.reduce((sum, d) => sum + d.memoryMb, 0);
    const usedMemoryMb = [...this.allocations.values()].reduce(
      (sum, a) => sum + a.memoryMb,
      0,
    );
    const avgUtilization =
      allDevices.length > 0
        ? allDevices.reduce((sum, d) => sum + d.utilization, 0) / allDevices.length
        : 0;

    return {
      totalDevices: this.devices.size,
      totalAllocations: this.allocations.size,
      totalMemoryMb,
      usedMemoryMb,
      avgUtilization: Math.round(avgUtilization * 100) / 100,
      totalBatches: this.totalCompletedBatches,
      avgBatchLatency:
        this.totalCompletedBatches > 0
          ? Math.round(this.cumulativeBatchLatency / this.totalCompletedBatches)
          : 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — Device Selection
  // ─────────────────────────────────────────────────────────

  /**
   * Find the best-fit device for a given memory and compute requirement.
   * Best-fit minimizes wasted resources (smallest remaining capacity
   * after allocation) to reduce fragmentation.
   */
  private findBestDevice(
    memoryMb: number,
    computePercent: number,
  ): GPUDevice | null {
    let bestDevice: GPUDevice | null = null;
    let bestFitScore = Infinity;

    for (const device of this.devices.values()) {
      if (!device.available) continue;

      // Calculate used resources on this device
      const usedMemory = device.allocations.reduce((sum, a) => sum + a.memoryMb, 0);
      const usedCompute = device.allocations.reduce(
        (sum, a) => sum + a.computePercent,
        0,
      );

      // Available resources (with overcommit ratio)
      const availableMemory =
        device.memoryMb * this.config.overcommitRatio - usedMemory;
      const availableCompute =
        100 * this.config.overcommitRatio - usedCompute;

      // Check if the device can accommodate the request
      if (availableMemory < memoryMb || availableCompute < computePercent) {
        continue;
      }

      // Best-fit score: remaining capacity after allocation (lower = better fit)
      const remainingMemory = availableMemory - memoryMb;
      const remainingCompute = availableCompute - computePercent;
      const fitScore = remainingMemory + remainingCompute * 10; // Weight compute more

      if (fitScore < bestFitScore) {
        bestFitScore = fitScore;
        bestDevice = device;
      }
    }

    return bestDevice;
  }

  /**
   * Find the device with the lowest current utilization (for inference routing).
   */
  private findLowestUtilizationDevice(): GPUDevice | null {
    let bestDevice: GPUDevice | null = null;
    let lowestUtil = Infinity;

    for (const device of this.devices.values()) {
      if (!device.available) continue;
      if (device.utilization < lowestUtil) {
        lowestUtil = device.utilization;
        bestDevice = device;
      }
    }

    return bestDevice;
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — Metrics and Cleanup
  // ─────────────────────────────────────────────────────────

  /**
   * Recalculate a device's utilization and temperature based on
   * its current allocations.
   */
  private recalculateDeviceMetrics(device: GPUDevice): void {
    const usedMemory = device.allocations.reduce((sum, a) => sum + a.memoryMb, 0);
    const usedCompute = device.allocations.reduce(
      (sum, a) => sum + a.computePercent,
      0,
    );

    // Utilization is the max of memory and compute utilization percentages
    const memoryUtil = device.memoryMb > 0 ? (usedMemory / device.memoryMb) * 100 : 0;
    const computeUtil = usedCompute;
    device.utilization = Math.min(Math.max(memoryUtil, computeUtil), 100);

    // Temperature model: base + util-proportional heat
    device.temperature = Math.round(
      (BASE_TEMPERATURE + device.utilization * TEMP_PER_UTIL_POINT) * 10,
    ) / 10;
  }

  /**
   * Clean up expired allocations across all devices.
   */
  private cleanupExpired(): void {
    const now = Date.now();

    for (const [allocationId, allocation] of this.allocations.entries()) {
      if (allocation.expiresAt <= now) {
        const device = this.devices.get(allocation.deviceId);
        if (device) {
          device.allocations = device.allocations.filter((a) => a.id !== allocationId);
          this.recalculateDeviceMetrics(device);
        }
        this.allocations.delete(allocationId);

        this.emit('gpu:allocation:expired', {
          allocationId,
          timestamp: now,
        });
      }
    }
  }
}
