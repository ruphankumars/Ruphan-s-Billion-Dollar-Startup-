/**
 * REST API Server — Types
 *
 * Request/response types for the CortexOS programmatic REST API.
 */

import type { ExecutionResult, CortexConfig } from '../core/types.js';

// ─── Task Management ────────────────────────────────────────

export interface RunTaskRequest {
  prompt: string;
  config?: Partial<CortexConfig>;
  sessionId?: string;
  async?: boolean;           // If true, return task ID immediately
}

export interface RunTaskResponse {
  taskId: string;
  status: TaskStatus;
  sessionId: string;
  createdAt: number;
  result?: ExecutionResult;
  error?: string;
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskRecord {
  id: string;
  prompt: string;
  status: TaskStatus;
  sessionId: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: ExecutionResult;
  error?: string;
}

// ─── API Server Config ──────────────────────────────────────

export interface APIServerConfig {
  port: number;
  apiKey?: string;
  corsOrigins?: string[];
  maxConcurrentTasks?: number;
}

// ─── Health & Status ────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptime: number;
  activeTasks: number;
  totalTasksRun: number;
}

// ─── API Error ──────────────────────────────────────────────

export interface APIError {
  error: string;
  code: string;
  details?: unknown;
}
