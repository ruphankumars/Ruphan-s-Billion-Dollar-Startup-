/**
 * KernelRegistry — The Syscall Table of CortexOS
 *
 * Manages registration, dispatch, and lifecycle of all 19 kernel primitives.
 * Enforces the 6-layer dependency hierarchy and provides budget tracking,
 * call history, and layer-level statistics.
 *
 * Analogous to the Linux syscall table — every AI operation in CortexOS
 * must go through a registered kernel primitive.
 *
 * Zero external dependencies. Node.js built-ins only.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { CircularBuffer } from '../utils/circular-buffer.js';
import type {
  KernelPrimitiveId,
  KernelLayer,
  KernelConfig,
  KernelBudget,
  KernelRegistryStats,
  KernelCallRecord,
  KernelDependencyValidation,
  KernelLayerStats,
  PrimitiveHandler,
} from './types.js';
import {
  KERNEL_LAYER_MAP,
  KERNEL_PRIMITIVE_DEPENDENCIES,
} from './types.js';

const DEFAULT_CONFIG: KernelConfig = {
  autoStart: true,
  tracing: true,
  maxConcurrency: 10,
  callTimeoutMs: 30000,
};

interface RegisteredPrimitive {
  id: KernelPrimitiveId;
  handler: PrimitiveHandler;
  enabled: boolean;
  registeredAt: number;
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
}

export class KernelRegistry extends EventEmitter {
  private config: KernelConfig;
  private running = false;
  private primitives: Map<KernelPrimitiveId, RegisteredPrimitive> = new Map();
  private callHistory = new CircularBuffer<KernelCallRecord>(1000);
  private activeCalls = 0;
  private budget: KernelBudget = {
    totalCalls: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    callsByPrimitive: {},
  };

  constructor(config?: Partial<KernelConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.running = true;
    this.emit('kernel:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('kernel:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Register a kernel primitive handler.
   * Handlers are typed functions that implement the primitive's logic.
   */
  register(primitiveId: KernelPrimitiveId, handler: PrimitiveHandler): void {
    if (this.primitives.has(primitiveId)) {
      throw new Error(`Kernel primitive '${primitiveId}' is already registered`);
    }

    const registered: RegisteredPrimitive = {
      id: primitiveId,
      handler,
      enabled: this.config.autoStart,
      registeredAt: Date.now(),
      callCount: 0,
      errorCount: 0,
      totalDurationMs: 0,
    };

    this.primitives.set(primitiveId, registered);

    this.emit('kernel:primitive:registered', {
      primitiveId,
      layer: KERNEL_LAYER_MAP[primitiveId],
      timestamp: Date.now(),
    });
  }

  /**
   * Unregister a kernel primitive.
   */
  unregister(primitiveId: KernelPrimitiveId): boolean {
    const existed = this.primitives.delete(primitiveId);

    if (existed) {
      this.emit('kernel:primitive:unregistered', {
        primitiveId,
        timestamp: Date.now(),
      });
    }

    return existed;
  }

  /**
   * Call a kernel primitive — the primary syscall dispatch.
   * Enforces that the primitive is registered and enabled,
   * tracks call metrics, and records history.
   */
  async call<TInput = unknown, TOutput = unknown>(
    primitiveId: KernelPrimitiveId,
    input: TInput
  ): Promise<TOutput> {
    const primitive = this.primitives.get(primitiveId);

    if (!primitive) {
      throw new Error(`Kernel primitive '${primitiveId}' is not registered`);
    }

    if (!primitive.enabled) {
      throw new Error(`Kernel primitive '${primitiveId}' is disabled`);
    }

    if (this.activeCalls >= this.config.maxConcurrency) {
      throw new Error(
        `Kernel concurrency limit reached (${this.config.maxConcurrency}). ` +
        `Cannot call '${primitiveId}'`
      );
    }

    const callId = `call_${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    this.activeCalls++;

    this.emit('kernel:primitive:called', {
      primitiveId,
      callId,
      timestamp: startTime,
    });

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Execute with timeout — store timer ref to prevent leak
      const result = await Promise.race([
        primitive.handler(input),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(
            () => reject(new Error(`Kernel call '${primitiveId}' timed out after ${this.config.callTimeoutMs}ms`)),
            this.config.callTimeoutMs
          );
        }),
      ]);

      clearTimeout(timeoutTimer);

      const durationMs = Date.now() - startTime;

      // Update metrics
      primitive.callCount++;
      primitive.totalDurationMs += durationMs;

      // Update budget
      this.budget.totalCalls++;
      this.budget.callsByPrimitive[primitiveId] =
        (this.budget.callsByPrimitive[primitiveId] ?? 0) + 1;

      // Record history
      this.recordCall({
        primitiveId,
        callId,
        timestamp: startTime,
        durationMs,
        success: true,
      });

      this.emit('kernel:primitive:completed', {
        primitiveId,
        callId,
        durationMs,
        timestamp: Date.now(),
      });

      return result as TOutput;
    } catch (error) {
      clearTimeout(timeoutTimer);
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      primitive.callCount++;
      primitive.errorCount++;
      primitive.totalDurationMs += durationMs;

      this.budget.totalCalls++;
      this.budget.callsByPrimitive[primitiveId] =
        (this.budget.callsByPrimitive[primitiveId] ?? 0) + 1;

      // Record history
      this.recordCall({
        primitiveId,
        callId,
        timestamp: startTime,
        durationMs,
        success: false,
        error: errorMessage,
      });

      this.emit('kernel:primitive:error', {
        primitiveId,
        callId,
        error: errorMessage,
        timestamp: Date.now(),
      });

      throw error;
    } finally {
      this.activeCalls--;
    }
  }

  /**
   * Check if a primitive is registered.
   */
  has(primitiveId: KernelPrimitiveId): boolean {
    return this.primitives.has(primitiveId);
  }

  /**
   * Enable or disable a primitive.
   */
  setEnabled(primitiveId: KernelPrimitiveId, enabled: boolean): void {
    const primitive = this.primitives.get(primitiveId);
    if (!primitive) {
      throw new Error(`Kernel primitive '${primitiveId}' is not registered`);
    }

    primitive.enabled = enabled;

    this.emit(enabled ? 'kernel:primitive:enabled' : 'kernel:primitive:disabled', {
      primitiveId,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if a primitive is enabled.
   */
  isEnabled(primitiveId: KernelPrimitiveId): boolean {
    const primitive = this.primitives.get(primitiveId);
    return primitive?.enabled ?? false;
  }

  /**
   * Validate that all registered primitives have their dependencies met.
   * Returns a validation report with missing and circular dependency info.
   */
  validateDependencies(): KernelDependencyValidation {
    const missingDependencies: Array<{
      primitive: KernelPrimitiveId;
      missing: KernelPrimitiveId[];
    }> = [];

    for (const [primitiveId] of this.primitives) {
      const deps = KERNEL_PRIMITIVE_DEPENDENCIES[primitiveId] ?? [];
      const missing = deps.filter(dep => !this.primitives.has(dep));

      if (missing.length > 0) {
        missingDependencies.push({ primitive: primitiveId, missing });
      }
    }

    // Simple circular dependency detection via DFS
    const circularDependencies = this.detectCircularDeps();

    const validation: KernelDependencyValidation = {
      valid: missingDependencies.length === 0 && circularDependencies.length === 0,
      missingDependencies,
      circularDependencies,
    };

    this.emit('kernel:dependency:validated', {
      valid: validation.valid,
      timestamp: Date.now(),
    });

    return validation;
  }

  /**
   * Get the initialization order — topological sort based on dependencies.
   * Primitives with no dependencies come first.
   */
  getInitializationOrder(): KernelPrimitiveId[] {
    const registered = [...this.primitives.keys()];
    const visited = new Set<KernelPrimitiveId>();
    const order: KernelPrimitiveId[] = [];

    const visit = (id: KernelPrimitiveId) => {
      if (visited.has(id)) return;
      visited.add(id);

      const deps = KERNEL_PRIMITIVE_DEPENDENCIES[id] ?? [];
      for (const dep of deps) {
        if (registered.includes(dep)) {
          visit(dep);
        }
      }

      order.push(id);
    };

    // Sort by layer first, then alphabetically within layers
    const sorted = [...registered].sort((a, b) => {
      const layerDiff = KERNEL_LAYER_MAP[a] - KERNEL_LAYER_MAP[b];
      if (layerDiff !== 0) return layerDiff;
      return a.localeCompare(b);
    });

    for (const id of sorted) {
      visit(id);
    }

    return order;
  }

  /**
   * Get per-layer statistics.
   */
  getLayerStats(): Record<number, KernelLayerStats> {
    const stats: Record<number, KernelLayerStats> = {};

    for (let layer = 0; layer <= 5; layer++) {
      const layerPrimitives = [...this.primitives.values()].filter(
        p => KERNEL_LAYER_MAP[p.id] === layer
      );

      const totalCalls = layerPrimitives.reduce((sum, p) => sum + p.callCount, 0);
      const totalErrors = layerPrimitives.reduce((sum, p) => sum + p.errorCount, 0);
      const totalDuration = layerPrimitives.reduce((sum, p) => sum + p.totalDurationMs, 0);

      stats[layer] = {
        layer: layer as KernelLayer,
        registeredCount: layerPrimitives.length,
        enabledCount: layerPrimitives.filter(p => p.enabled).length,
        totalCalls,
        avgDurationMs: totalCalls > 0 ? totalDuration / totalCalls : 0,
        errorRate: totalCalls > 0 ? totalErrors / totalCalls : 0,
      };
    }

    return stats;
  }

  /**
   * Get the current budget state.
   */
  getBudget(): KernelBudget {
    return { ...this.budget };
  }

  /**
   * Get a registered primitive's info.
   */
  getPrimitiveInfo(primitiveId: KernelPrimitiveId): {
    id: KernelPrimitiveId;
    layer: KernelLayer;
    enabled: boolean;
    callCount: number;
    errorCount: number;
    avgDurationMs: number;
  } | undefined {
    const p = this.primitives.get(primitiveId);
    if (!p) return undefined;

    return {
      id: p.id,
      layer: KERNEL_LAYER_MAP[p.id],
      enabled: p.enabled,
      callCount: p.callCount,
      errorCount: p.errorCount,
      avgDurationMs: p.callCount > 0 ? p.totalDurationMs / p.callCount : 0,
    };
  }

  /**
   * Get all registered primitive IDs.
   */
  getRegisteredPrimitives(): KernelPrimitiveId[] {
    return [...this.primitives.keys()];
  }

  /**
   * Get overall kernel statistics.
   */
  getStats(): KernelRegistryStats {
    const allPrimitives = [...this.primitives.values()];
    const totalCalls = allPrimitives.reduce((sum, p) => sum + p.callCount, 0);
    const totalErrors = allPrimitives.reduce((sum, p) => sum + p.errorCount, 0);
    const totalDuration = allPrimitives.reduce((sum, p) => sum + p.totalDurationMs, 0);

    return {
      running: this.running,
      registeredPrimitives: this.primitives.size,
      enabledPrimitives: allPrimitives.filter(p => p.enabled).length,
      totalCalls,
      totalErrors,
      errorRate: totalCalls > 0 ? totalErrors / totalCalls : 0,
      avgCallDurationMs: totalCalls > 0 ? totalDuration / totalCalls : 0,
      layerStats: this.getLayerStats(),
      callHistory: this.callHistory.toArray(),
      config: { ...this.config },
    };
  }

  // ─── Static Helpers ────────────────────────────────────────────────────

  /** Get all 19 kernel primitive IDs */
  static getAllPrimitiveIds(): KernelPrimitiveId[] {
    return Object.keys(KERNEL_LAYER_MAP) as KernelPrimitiveId[];
  }

  /** Get the layer for a primitive */
  static getLayer(primitiveId: KernelPrimitiveId): KernelLayer {
    return KERNEL_LAYER_MAP[primitiveId];
  }

  /** Get dependencies for a primitive */
  static getDependencies(primitiveId: KernelPrimitiveId): KernelPrimitiveId[] {
    return KERNEL_PRIMITIVE_DEPENDENCIES[primitiveId] ?? [];
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private recordCall(record: KernelCallRecord): void {
    if (!this.config.tracing) return;

    this.callHistory.push(record);
  }

  private detectCircularDeps(): KernelPrimitiveId[][] {
    const cycles: KernelPrimitiveId[][] = [];
    const visited = new Set<KernelPrimitiveId>();
    const inStack = new Set<KernelPrimitiveId>();
    const path: KernelPrimitiveId[] = [];

    const dfs = (node: KernelPrimitiveId) => {
      if (inStack.has(node)) {
        // Found a cycle — extract it from path
        const cycleStart = path.indexOf(node);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), node]);
        }
        return;
      }

      if (visited.has(node)) return;

      visited.add(node);
      inStack.add(node);
      path.push(node);

      const deps = KERNEL_PRIMITIVE_DEPENDENCIES[node] ?? [];
      for (const dep of deps) {
        if (this.primitives.has(dep)) {
          dfs(dep);
        }
      }

      path.pop();
      inStack.delete(node);
    };

    for (const id of this.primitives.keys()) {
      visited.clear();
      inStack.clear();
      path.length = 0;
      dfs(id);
    }

    return cycles;
  }
}
