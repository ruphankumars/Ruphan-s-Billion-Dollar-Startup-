/**
 * Scheduler Types — CortexOS Semantic Scheduler
 *
 * Type definitions for semantic task classification, resource-aware scheduling,
 * queue management, and resource profile mapping.
 */

// ═══════════════════════════════════════════════════════════════
// SEMANTIC TYPES
// ═══════════════════════════════════════════════════════════════

export type TaskSemanticType =
  | 'code-review'
  | 'code-generation'
  | 'creative-writing'
  | 'data-analysis'
  | 'research'
  | 'debugging'
  | 'testing'
  | 'documentation'
  | 'translation'
  | 'summarization'
  | 'conversation'
  | 'custom';

// ═══════════════════════════════════════════════════════════════
// RESOURCE SLOTS
// ═══════════════════════════════════════════════════════════════

export interface ResourceSlot {
  cpuWeight: number;
  memoryMb: number;
  gpuShare: number;
  modelTier: 'economy' | 'standard' | 'premium';
  maxTokens: number;
  maxDuration: number;
}

// ═══════════════════════════════════════════════════════════════
// RESOURCE PROFILES
// ═══════════════════════════════════════════════════════════════

export type ResourceProfile = Record<TaskSemanticType, ResourceSlot>;

// ═══════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════

export interface SemanticTask {
  id: string;
  description: string;
  semanticType: TaskSemanticType;
  priority: number;
  estimatedTokens: number;
  estimatedDuration: number;
  requiredCapabilities: string[];
  assignedResources?: ResourceSlot;
  status: 'queued' | 'scheduled' | 'running' | 'completed' | 'failed';
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// QUEUE
// ═══════════════════════════════════════════════════════════════

export interface SchedulerQueue {
  tasks: SemanticTask[];
  totalEstimatedCost: number;
  totalEstimatedDuration: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface SchedulerConfig {
  enabled: boolean;
  maxQueueSize: number;
  defaultModelTier: string;
  preemptionEnabled: boolean;
  fairShareEnabled: boolean;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface SchedulerStats {
  totalScheduled: number;
  totalCompleted: number;
  totalFailed: number;
  avgWaitTime: number;
  avgExecutionTime: number;
  resourceUtilization: number;
  queueDepth: number;
}
