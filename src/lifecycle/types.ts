/**
 * Agent Lifecycle Management Types — CortexOS
 *
 * Type definitions for the full agent lifecycle: publish, version,
 * deploy, monitor, retire. Based on AIOS's 4-machine model.
 */

// ═══════════════════════════════════════════════════════════════
// AGENT DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export type AgentPhase = 'draft' | 'published' | 'deployed' | 'running' | 'paused' | 'retiring' | 'retired';

export interface AgentManifest {
  /** Unique agent identifier */
  id: string;
  /** Agent name */
  name: string;
  /** Semantic version (e.g. "1.2.3") */
  version: string;
  /** Agent description */
  description: string;
  /** Author identifier */
  author: string;
  /** Capabilities this agent provides */
  capabilities: string[];
  /** Required tools */
  requiredTools: string[];
  /** Required providers (e.g. ['anthropic', 'openai']) */
  requiredProviders: string[];
  /** Configuration schema as JSON Schema object */
  configSchema: Record<string, unknown>;
  /** Current lifecycle phase */
  phase: AgentPhase;
  /** Unix timestamp (ms) of creation */
  createdAt: number;
  /** Unix timestamp (ms) of last update */
  updatedAt: number;
  /** Previous version IDs for rollback */
  previousVersions: string[];
  /** Tags for search and discovery */
  tags: string[];
}

// ═══════════════════════════════════════════════════════════════
// DEPLOYMENT
// ═══════════════════════════════════════════════════════════════

export type DeployEnvironment = 'development' | 'staging' | 'production';

export interface AgentDeployment {
  /** Unique deployment ID */
  id: string;
  /** Agent manifest ID being deployed */
  agentId: string;
  /** Agent version */
  agentVersion: string;
  /** Target environment */
  environment: DeployEnvironment;
  /** Deployment status */
  status: 'pending' | 'deploying' | 'active' | 'failed' | 'rolled-back';
  /** Resource configuration */
  resources: ResourceAllocation;
  /** Unix timestamp (ms) of deployment */
  deployedAt: number;
  /** Health check results */
  healthChecks: HealthCheck[];
  /** Rollback target deployment ID (if applicable) */
  rollbackFrom?: string;
}

export interface ResourceAllocation {
  /** Maximum memory in MB */
  maxMemoryMb: number;
  /** Maximum CPU percentage (0-100) */
  maxCpuPercent: number;
  /** Maximum concurrent tasks */
  maxConcurrentTasks: number;
  /** Token budget per execution */
  tokenBudget: number;
}

// ═══════════════════════════════════════════════════════════════
// MONITORING
// ═══════════════════════════════════════════════════════════════

export interface HealthCheck {
  /** Check name */
  name: string;
  /** Whether the check passed */
  passed: boolean;
  /** Additional details */
  details: string;
  /** Latency of the check in ms */
  latencyMs: number;
  /** Unix timestamp (ms) */
  checkedAt: number;
}

export interface AgentPerformanceMetrics {
  /** Agent manifest ID */
  agentId: string;
  /** Total tasks completed */
  tasksCompleted: number;
  /** Total tasks failed */
  tasksFailed: number;
  /** Average task duration in ms */
  avgDurationMs: number;
  /** Average quality score (0-1) */
  avgQuality: number;
  /** Total tokens consumed */
  totalTokens: number;
  /** Total cost incurred */
  totalCost: number;
  /** Uptime percentage */
  uptimePercent: number;
  /** SLA compliance percentage */
  slaCompliance: number;
  /** Unix timestamp (ms) of measurement period start */
  periodStart: number;
  /** Unix timestamp (ms) of measurement period end */
  periodEnd: number;
}

export interface SLADefinition {
  /** Maximum response time in ms */
  maxResponseTimeMs: number;
  /** Minimum quality score (0-1) */
  minQuality: number;
  /** Maximum failure rate (0-1) */
  maxFailureRate: number;
  /** Minimum uptime percentage */
  minUptimePercent: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface LifecycleConfig {
  /** Whether lifecycle management is enabled */
  enabled: boolean;
  /** Default SLA for all agents */
  defaultSla: SLADefinition;
  /** Health check interval in ms */
  healthCheckIntervalMs: number;
  /** Metrics retention period in ms */
  metricsRetentionMs: number;
  /** Maximum agents in registry */
  maxAgents: number;
  /** Auto-retire agents after this many consecutive failures */
  autoRetireThreshold: number;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface LifecycleStats {
  /** Total agents registered */
  totalAgents: number;
  /** Agents by phase */
  byPhase: Record<AgentPhase, number>;
  /** Total deployments */
  totalDeployments: number;
  /** Active deployments */
  activeDeployments: number;
  /** Total rollbacks performed */
  totalRollbacks: number;
  /** Average SLA compliance across all agents */
  avgSlaCompliance: number;
}
