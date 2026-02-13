/**
 * Cloud Infrastructure — Types
 *
 * Docker-based agent execution: environments, containers, resource limits.
 * Matches Oz's cloud execution model as an embeddable SDK component.
 */

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENTS
// ═══════════════════════════════════════════════════════════════

export interface Environment {
  id: string;
  name: string;
  description: string;
  image: string;               // Docker image (e.g. 'node:20-slim')
  defaultCmd?: string[];       // Default container command
  env?: Record<string, string>;// Environment variables
  packages?: string[];         // Packages to install at build time
  resourceLimits?: ResourceLimits;
  tags?: string[];
}

export interface ResourceLimits {
  cpus?: number;               // CPU core limit (e.g. 2.0)
  memoryMb?: number;           // Memory limit in MB
  diskMb?: number;             // Disk limit in MB
  timeoutMs?: number;          // Max execution time
  networkEnabled?: boolean;    // Allow network access (default: true)
}

// ═══════════════════════════════════════════════════════════════
// CONTAINERS
// ═══════════════════════════════════════════════════════════════

export type ContainerStatus =
  | 'creating'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'timeout';

export interface ContainerInfo {
  id: string;
  containerId: string;         // Docker container ID
  environmentId: string;
  status: ContainerStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  resourceUsage?: ResourceUsage;
}

export interface ResourceUsage {
  cpuPercent?: number;
  memoryMb?: number;
  diskMb?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
}

// ═══════════════════════════════════════════════════════════════
// CLOUD TASKS
// ═══════════════════════════════════════════════════════════════

export type CloudTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface CloudTask {
  id: string;
  prompt: string;
  environmentId: string;
  status: CloudTaskStatus;
  containerId?: string;
  inputs?: Record<string, unknown>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: CloudTaskResult;
  error?: string;
}

export interface CloudTaskResult {
  success: boolean;
  output: string;
  exitCode: number;
  filesChanged?: Array<{ path: string; action: string }>;
  logs: string[];
  duration: number;
  resourceUsage?: ResourceUsage;
}

// ═══════════════════════════════════════════════════════════════
// REPO MOUNTS
// ═══════════════════════════════════════════════════════════════

export interface RepoMount {
  hostPath: string;            // Absolute path on host
  containerPath: string;       // Path inside container
  readonly?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

export type ContainerEventType =
  | 'container:created'
  | 'container:started'
  | 'container:log'
  | 'container:completed'
  | 'container:failed'
  | 'container:timeout';

export interface ContainerEvent {
  type: ContainerEventType;
  containerId: string;
  taskId?: string;
  timestamp: number;
  data?: unknown;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

export interface CloudConfig {
  enabled: boolean;
  defaultEnvironment: string;
  maxContainers: number;
  containerTimeout: number;    // Default timeout in ms
  registryUrl?: string;        // Custom Docker registry
  environmentsDir?: string;    // Directory for .env.yaml files
  resourceDefaults?: ResourceLimits;
}
