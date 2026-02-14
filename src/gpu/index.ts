/**
 * GPU Module — CortexOS GPU Resource Manager
 *
 * Manages GPU device registration, memory/compute allocation with best-fit
 * selection, inference request batching, and utilization tracking.
 *
 * @example
 * ```typescript
 * import { GPUManager } from 'cortexos/gpu';
 *
 * const gpu = new GPUManager({ maxDevices: 8, batchSize: 16 });
 * gpu.start();
 *
 * const device = gpu.registerDevice({
 *   name: 'A100-80GB',
 *   vendor: 'nvidia',
 *   memoryMb: 81920,
 *   computeUnits: 108,
 *   available: true,
 * });
 *
 * const alloc = gpu.allocate('agent-1', 4096, 25);
 * ```
 */

export { GPUManager } from './gpu-manager.js';
export type {
  GPUDevice,
  GPUAllocation,
  InferenceBatch,
  InferenceRequest,
  GPUConfig,
  GPUStats,
} from './types.js';
