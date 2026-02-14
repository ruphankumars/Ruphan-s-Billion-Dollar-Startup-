/**
 * Sovereign Runtime Types
 *
 * WASM-based sandboxing, edge deployment, and neural embeddings
 * for running CortexOS agents anywhere — cloud, edge, air-gapped.
 */

// WASM sandbox

export interface WASMSandboxConfig {
  enabled: boolean;
  memoryLimitMB: number;
  cpuTimeLimitMs: number;
  allowedImports: string[];
  blockedSyscalls: string[];
  fileSystemAccess: 'none' | 'readonly' | 'readwrite';
  networkAccess: 'none' | 'localhost' | 'any';
  maxInstances: number;
}

export interface WASMModule {
  id: string;
  name: string;
  source: 'file' | 'url' | 'inline';
  path?: string;
  url?: string;
  bytecode?: Uint8Array;
  hash: string;
  size: number;
  exports: string[];
  imports: string[];
  metadata?: Record<string, unknown>;
  loadedAt: number;
}

export interface WASMInstance {
  id: string;
  moduleId: string;
  status: 'created' | 'running' | 'paused' | 'completed' | 'failed' | 'killed';
  memoryUsage: number;
  cpuTimeMs: number;
  startedAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

export interface SandboxExecResult {
  success: boolean;
  output: unknown;
  error?: string;
  memoryUsed: number;
  cpuTimeMs: number;
  duration: number;
}

// Edge deployment

export interface EdgeTarget {
  id: string;
  name: string;
  type: 'browser' | 'node-edge' | 'deno' | 'cloudflare-worker' | 'lambda' | 'iot' | 'mobile';
  capabilities: EdgeCapability[];
  constraints: EdgeConstraints;
  connection?: EdgeConnection;
  status: 'available' | 'connected' | 'busy' | 'offline';
}

export interface EdgeCapability {
  name: string;
  supported: boolean;
  version?: string;
}

export interface EdgeConstraints {
  maxMemoryMB: number;
  maxCpuMs: number;
  maxStorageMB: number;
  hasNetwork: boolean;
  hasFileSystem: boolean;
  hasGPU: boolean;
  architectures: string[];
}

export interface EdgeConnection {
  protocol: 'websocket' | 'http' | 'mqtt' | 'grpc';
  url: string;
  authenticated: boolean;
  latencyMs: number;
  lastPing: number;
}

export interface EdgeDeployment {
  id: string;
  targetId: string;
  moduleId?: string;
  agentConfig: Record<string, unknown>;
  status: 'pending' | 'deploying' | 'running' | 'stopped' | 'failed';
  deployedAt?: number;
  lastHeartbeat?: number;
  metrics?: EdgeDeploymentMetrics;
}

export interface EdgeDeploymentMetrics {
  requestsHandled: number;
  avgLatencyMs: number;
  errorRate: number;
  memoryUsageMB: number;
  uptimeMs: number;
}

// Neural embeddings

export interface EmbeddingModel {
  id: string;
  name: string;
  dimensions: number;
  maxTokens: number;
  type: 'local' | 'remote';
  provider?: string;
}

export interface EmbeddingRequest {
  text: string | string[];
  model?: string;
  normalize?: boolean;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dimensions: number;
  tokensUsed: number;
  duration: number;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
  text?: string;
}

// Runtime config

export interface RuntimeConfig {
  enabled: boolean;
  wasm: WASMSandboxConfig;
  edge: {
    enabled: boolean;
    targets: Array<Omit<EdgeTarget, 'id' | 'status'>>;
    heartbeatIntervalMs: number;
    deploymentTimeout: number;
  };
  embeddings: {
    defaultModel: string;
    models: Array<Omit<EmbeddingModel, 'id'>>;
    cachePath?: string;
    cacheMaxSizeMB: number;
  };
}

// Events

export type RuntimeEventType =
  | 'runtime:wasm:loaded'
  | 'runtime:wasm:executed'
  | 'runtime:wasm:error'
  | 'runtime:edge:connected'
  | 'runtime:edge:disconnected'
  | 'runtime:edge:deployed'
  | 'runtime:edge:failed'
  | 'runtime:embedding:computed'
  | 'runtime:embedding:cached';
