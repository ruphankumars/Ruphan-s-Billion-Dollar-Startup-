/**
 * Deploy Pipeline Types — CortexOS
 *
 * Type definitions for the deployment subsystem: packaging, deploying,
 * target management, and health verification.
 */

// ═══════════════════════════════════════════════════════════════
// DEPLOY TARGETS
// ═══════════════════════════════════════════════════════════════

export type DeployTargetType = 'docker' | 'npm' | 'cloudflare' | 'lambda' | 'deno' | 'edge';

export interface DeployTarget {
  /** Unique target identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Target platform type */
  type: DeployTargetType;
  /** Platform-specific configuration */
  config: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface DeployConfig {
  /** Available deploy targets */
  targets: DeployTarget[];
  /** Default target ID */
  defaultTarget: string;
  /** Commands to run before building */
  prebuildSteps: string[];
  /** Commands to run after deployment */
  postDeploySteps: string[];
}

// ═══════════════════════════════════════════════════════════════
// MANIFEST
// ═══════════════════════════════════════════════════════════════

export interface DeployManifest {
  /** Application name */
  name: string;
  /** Application version */
  version: string;
  /** Entry point file */
  entryPoint: string;
  /** Runtime dependencies */
  dependencies: Record<string, string>;
  /** Environment variables */
  environment: Record<string, string>;
  /** Resource requirements */
  resources: {
    memory?: string;
    cpu?: string;
    disk?: string;
  };
  /** Health check configuration */
  healthCheck: {
    path: string;
    interval: number;
    timeout: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════

export type DeployStatus = 'success' | 'failed' | 'rolled-back';

export interface DeployResult {
  /** Target ID that was deployed to */
  targetId: string;
  /** Deployment status */
  status: DeployStatus;
  /** Public URL of the deployment (if applicable) */
  url?: string;
  /** Deployment log lines */
  logs: string[];
  /** Deployment duration in milliseconds */
  duration: number;
  /** Unix timestamp (ms) when deployed */
  deployedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// PACKAGE BUNDLE
// ═══════════════════════════════════════════════════════════════

export interface PackageBundle {
  /** Deployment manifest */
  manifest: DeployManifest;
  /** File contents mapped by relative path */
  files: Map<string, string>;
  /** Total bundle size in bytes */
  size: number;
  /** SHA256 hash of the bundle contents */
  hash: string;
}
