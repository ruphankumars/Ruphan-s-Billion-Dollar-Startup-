/**
 * GPU Types — CortexOS GPU Resource Manager
 *
 * Type definitions for GPU device management, memory/compute allocation,
 * inference request batching, and resource utilization tracking.
 */

// ═══════════════════════════════════════════════════════════════
// DEVICES
// ═══════════════════════════════════════════════════════════════

export interface GPUDevice {
  id: string;
  name: string;
  vendor: string;
  memoryMb: number;
  computeUnits: number;
  utilization: number;
  temperature: number;
  available: boolean;
  allocations: GPUAllocation[];
}

// ═══════════════════════════════════════════════════════════════
// ALLOCATIONS
// ═══════════════════════════════════════════════════════════════

export interface GPUAllocation {
  id: string;
  deviceId: string;
  agentId: string;
  memoryMb: number;
  computePercent: number;
  startedAt: number;
  expiresAt: number;
}

// ═══════════════════════════════════════════════════════════════
// INFERENCE
// ═══════════════════════════════════════════════════════════════

export interface InferenceBatch {
  id: string;
  deviceId: string;
  requests: InferenceRequest[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}

export interface InferenceRequest {
  id: string;
  agentId: string;
  model: string;
  input: string;
  priority: number;
  maxTokens: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface GPUConfig {
  enabled: boolean;
  maxDevices: number;
  maxAllocationsPerDevice: number;
  overcommitRatio: number;
  batchSize: number;
  batchTimeoutMs: number;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface GPUStats {
  totalDevices: number;
  totalAllocations: number;
  totalMemoryMb: number;
  usedMemoryMb: number;
  avgUtilization: number;
  totalBatches: number;
  avgBatchLatency: number;
}
