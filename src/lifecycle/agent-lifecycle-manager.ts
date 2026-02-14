/**
 * AgentLifecycleManager — Full Agent Lifecycle Management
 *
 * Manages the complete agent lifecycle: draft, publish, deploy, run,
 * pause, retire. Supports versioning with rollback, health checks,
 * performance metrics, and SLA compliance monitoring.
 *
 * Based on AIOS's 4-machine model. Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AgentManifest,
  AgentPhase,
  AgentDeployment,
  DeployEnvironment,
  ResourceAllocation,
  HealthCheck,
  AgentPerformanceMetrics,
  LifecycleConfig,
  LifecycleStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface AgentFilter {
  /** Filter by lifecycle phase */
  phase?: AgentPhase;
  /** Filter by capability (agent must have this capability) */
  capability?: string;
  /** Filter by tag (agent must have this tag) */
  tag?: string;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: LifecycleConfig = {
  enabled: true,
  defaultSla: {
    maxResponseTimeMs: 30_000,
    minQuality: 0.7,
    maxFailureRate: 0.1,
    minUptimePercent: 99,
  },
  healthCheckIntervalMs: 60_000,
  metricsRetentionMs: 7 * 24 * 60 * 60 * 1_000, // 7 days
  maxAgents: 10_000,
  autoRetireThreshold: 10,
};

const DEFAULT_RESOURCES: ResourceAllocation = {
  maxMemoryMb: 512,
  maxCpuPercent: 50,
  maxConcurrentTasks: 5,
  tokenBudget: 100_000,
};

// ═══════════════════════════════════════════════════════════════
// AGENT LIFECYCLE MANAGER
// ═══════════════════════════════════════════════════════════════

export class AgentLifecycleManager extends EventEmitter {
  private config: LifecycleConfig;
  private running = false;

  /** Agent manifests keyed by agent ID */
  private agents: Map<string, AgentManifest> = new Map();

  /** Deployments keyed by deployment ID */
  private deployments: Map<string, AgentDeployment> = new Map();

  /** Performance metrics keyed by agent ID */
  private metrics: Map<string, AgentPerformanceMetrics[]> = new Map();

  /** Consecutive failure counts keyed by agent ID (for auto-retire) */
  private failureCounts: Map<string, number> = new Map();

  /** Health check timer reference */
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  /** Total rollbacks performed (for stats) */
  private totalRollbacks = 0;

  constructor(config?: Partial<LifecycleConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  /** Start the lifecycle manager and begin periodic health checks. */
  start(): void {
    this.running = true;

    if (this.config.healthCheckIntervalMs > 0) {
      this.healthTimer = setInterval(
        () => this.runAllHealthChecks(),
        this.config.healthCheckIntervalMs,
      );
    }

    this.emit('lifecycle:manager:started', { timestamp: Date.now() });
  }

  /** Stop the lifecycle manager and clear the health check timer. */
  stop(): void {
    this.running = false;

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    this.emit('lifecycle:manager:stopped', { timestamp: Date.now() });
  }

  /** Whether the lifecycle manager is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────────
  // AGENT REGISTRATION
  // ─────────────────────────────────────────────────────────────

  /**
   * Register a new agent in the lifecycle system.
   *
   * The agent starts in `draft` phase. The `id`, `phase`, `createdAt`,
   * `updatedAt`, and `previousVersions` fields are generated automatically.
   *
   * Throws if the maximum agent limit has been reached.
   */
  registerAgent(
    manifest: Omit<AgentManifest, 'id' | 'phase' | 'createdAt' | 'updatedAt' | 'previousVersions'>,
  ): AgentManifest {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(`Maximum agent limit reached: ${this.config.maxAgents}`);
    }

    const now = Date.now();
    const agent: AgentManifest = {
      ...manifest,
      id: `agent_${randomUUID().slice(0, 8)}`,
      phase: 'draft',
      createdAt: now,
      updatedAt: now,
      previousVersions: [],
    };

    this.agents.set(agent.id, agent);
    this.metrics.set(agent.id, []);
    this.failureCounts.set(agent.id, 0);

    this.emit('lifecycle:agent:registered', { agent, timestamp: now });

    return agent;
  }

  // ─────────────────────────────────────────────────────────────
  // PHASE TRANSITIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Publish an agent, making it available for deployment.
   *
   * Transitions the agent from `draft` to `published`.
   * Throws if the agent is not found or not in `draft` phase.
   */
  publishAgent(agentId: string): AgentManifest {
    const agent = this.requireAgent(agentId);

    if (agent.phase !== 'draft') {
      throw new Error(
        `Cannot publish agent ${agentId}: expected phase 'draft', got '${agent.phase}'`,
      );
    }

    agent.phase = 'published';
    agent.updatedAt = Date.now();

    this.emit('lifecycle:agent:published', { agent, timestamp: Date.now() });

    return agent;
  }

  /**
   * Deploy an agent to a target environment.
   *
   * Creates a deployment record and transitions the agent to `deployed` phase.
   * Throws if the agent is not found or not in `published` or `paused` phase.
   */
  deployAgent(
    agentId: string,
    environment: DeployEnvironment,
    resources?: Partial<ResourceAllocation>,
  ): AgentDeployment {
    const agent = this.requireAgent(agentId);

    if (agent.phase !== 'published' && agent.phase !== 'paused') {
      throw new Error(
        `Cannot deploy agent ${agentId}: expected phase 'published' or 'paused', got '${agent.phase}'`,
      );
    }

    const now = Date.now();
    const deployment: AgentDeployment = {
      id: `deploy_${randomUUID().slice(0, 8)}`,
      agentId,
      agentVersion: agent.version,
      environment,
      status: 'deploying',
      resources: { ...DEFAULT_RESOURCES, ...resources },
      deployedAt: now,
      healthChecks: [],
    };

    this.deployments.set(deployment.id, deployment);

    agent.phase = 'deployed';
    agent.updatedAt = now;

    this.emit('lifecycle:agent:deployed', {
      agent,
      deployment,
      timestamp: now,
    });

    return deployment;
  }

  /**
   * Start a deployed agent, making it actively process tasks.
   *
   * Sets the deployment status to `active` and the agent phase to `running`.
   * Throws if the deployment is not found or not in `deploying` status.
   */
  startAgent(deploymentId: string): AgentDeployment {
    const deployment = this.requireDeployment(deploymentId);

    if (deployment.status !== 'deploying') {
      throw new Error(
        `Cannot start deployment ${deploymentId}: expected status 'deploying', got '${deployment.status}'`,
      );
    }

    const agent = this.requireAgent(deployment.agentId);

    deployment.status = 'active';
    agent.phase = 'running';
    agent.updatedAt = Date.now();

    this.emit('lifecycle:agent:started', {
      agent,
      deployment,
      timestamp: Date.now(),
    });

    return deployment;
  }

  /**
   * Pause a running agent.
   *
   * Transitions the agent from `running` to `paused`.
   * Throws if the agent is not found or not in `running` phase.
   */
  pauseAgent(agentId: string): AgentManifest {
    const agent = this.requireAgent(agentId);

    if (agent.phase !== 'running') {
      throw new Error(
        `Cannot pause agent ${agentId}: expected phase 'running', got '${agent.phase}'`,
      );
    }

    agent.phase = 'paused';
    agent.updatedAt = Date.now();

    this.emit('lifecycle:agent:paused', { agent, timestamp: Date.now() });

    return agent;
  }

  /**
   * Retire an agent, permanently removing it from active duty.
   *
   * Transitions through `retiring` to `retired`. Any active deployments
   * for this agent are marked as `failed`.
   * Throws if the agent is not found or already retired.
   */
  retireAgent(agentId: string): AgentManifest {
    const agent = this.requireAgent(agentId);

    if (agent.phase === 'retired') {
      throw new Error(`Agent ${agentId} is already retired`);
    }

    agent.phase = 'retiring';
    agent.updatedAt = Date.now();

    // Mark all active deployments for this agent as failed
    for (const deployment of this.deployments.values()) {
      if (
        deployment.agentId === agentId &&
        (deployment.status === 'active' || deployment.status === 'deploying')
      ) {
        deployment.status = 'failed';
      }
    }

    agent.phase = 'retired';
    agent.updatedAt = Date.now();

    this.emit('lifecycle:agent:retired', { agent, timestamp: Date.now() });

    return agent;
  }

  // ─────────────────────────────────────────────────────────────
  // ROLLBACK & VERSIONING
  // ─────────────────────────────────────────────────────────────

  /**
   * Roll back an agent to its previous version.
   *
   * Creates a new deployment with the previous version and marks the
   * current active deployment as `rolled-back`.
   * Throws if the agent has no previous versions.
   */
  rollbackAgent(agentId: string): AgentDeployment {
    const agent = this.requireAgent(agentId);

    if (agent.previousVersions.length === 0) {
      throw new Error(`Agent ${agentId} has no previous versions to roll back to`);
    }

    const previousVersion = agent.previousVersions[agent.previousVersions.length - 1];

    // Find the current active deployment for this agent
    let currentDeployment: AgentDeployment | undefined;
    for (const d of this.deployments.values()) {
      if (d.agentId === agentId && d.status === 'active') {
        currentDeployment = d;
        break;
      }
    }

    // Mark the current deployment as rolled-back
    if (currentDeployment) {
      currentDeployment.status = 'rolled-back';
    }

    // Restore the previous version
    agent.version = previousVersion;
    agent.previousVersions.pop();
    agent.updatedAt = Date.now();

    // Create a new deployment with the rolled-back version
    const now = Date.now();
    const deployment: AgentDeployment = {
      id: `deploy_${randomUUID().slice(0, 8)}`,
      agentId,
      agentVersion: previousVersion,
      environment: currentDeployment?.environment ?? 'development',
      status: 'active',
      resources: currentDeployment?.resources ?? { ...DEFAULT_RESOURCES },
      deployedAt: now,
      healthChecks: [],
      rollbackFrom: currentDeployment?.id,
    };

    this.deployments.set(deployment.id, deployment);
    agent.phase = 'running';
    this.totalRollbacks++;

    this.emit('lifecycle:agent:rolledback', {
      agent,
      deployment,
      previousDeploymentId: currentDeployment?.id,
      timestamp: now,
    });

    return deployment;
  }

  /**
   * Update an agent's version.
   *
   * Stores the current version in `previousVersions` for rollback
   * and sets the new version string.
   */
  updateVersion(agentId: string, newVersion: string, changes?: string): AgentManifest {
    const agent = this.requireAgent(agentId);

    agent.previousVersions.push(agent.version);
    agent.version = newVersion;
    agent.updatedAt = Date.now();

    this.emit('lifecycle:agent:versioned', {
      agent,
      previousVersion: agent.previousVersions[agent.previousVersions.length - 1],
      newVersion,
      changes: changes ?? '',
      timestamp: Date.now(),
    });

    return agent;
  }

  // ─────────────────────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────────────────────

  /** Get an agent manifest by ID (or undefined). */
  getAgent(id: string): AgentManifest | undefined {
    return this.agents.get(id);
  }

  /**
   * List agent manifests, optionally filtered by phase, capability, or tag.
   *
   * Results are sorted by creation time (newest first).
   */
  listAgents(filter?: AgentFilter): AgentManifest[] {
    let results = [...this.agents.values()];

    if (filter) {
      if (filter.phase) {
        results = results.filter((a) => a.phase === filter.phase);
      }
      if (filter.capability) {
        results = results.filter((a) => a.capabilities.includes(filter.capability!));
      }
      if (filter.tag) {
        results = results.filter((a) => a.tags.includes(filter.tag!));
      }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Get a deployment by ID (or undefined). */
  getDeployment(id: string): AgentDeployment | undefined {
    return this.deployments.get(id);
  }

  /**
   * List deployments, optionally filtered by agent ID.
   *
   * Results are sorted by deployment time (newest first).
   */
  listDeployments(agentId?: string): AgentDeployment[] {
    let results = [...this.deployments.values()];

    if (agentId) {
      results = results.filter((d) => d.agentId === agentId);
    }

    return results.sort((a, b) => b.deployedAt - a.deployedAt);
  }

  // ─────────────────────────────────────────────────────────────
  // HEALTH CHECKS
  // ─────────────────────────────────────────────────────────────

  /**
   * Run a health check for a specific deployment.
   *
   * Performs a basic responsiveness check and appends the result to the
   * deployment's health check history. Emits `lifecycle:health:checked`.
   *
   * If an agent exceeds the auto-retire failure threshold, it is
   * automatically retired.
   */
  runHealthCheck(deploymentId: string): HealthCheck {
    const deployment = this.requireDeployment(deploymentId);
    const agent = this.agents.get(deployment.agentId);

    const start = Date.now();

    // Simulate health check — in a real system this would probe the agent
    const isActive = deployment.status === 'active';
    const isAgentRunning = agent?.phase === 'running';
    const passed = isActive && isAgentRunning;

    const check: HealthCheck = {
      name: 'basic-liveness',
      passed,
      details: passed
        ? 'Agent is active and responsive'
        : `Agent status: ${deployment.status}, phase: ${agent?.phase ?? 'unknown'}`,
      latencyMs: Date.now() - start,
      checkedAt: Date.now(),
    };

    deployment.healthChecks.push(check);

    // Track consecutive failures for auto-retire
    if (!passed && agent) {
      const count = (this.failureCounts.get(agent.id) ?? 0) + 1;
      this.failureCounts.set(agent.id, count);

      if (count >= this.config.autoRetireThreshold && agent.phase !== 'retired') {
        this.retireAgent(agent.id);
        this.emit('lifecycle:agent:auto-retired', {
          agent,
          consecutiveFailures: count,
          timestamp: Date.now(),
        });
      }
    } else if (passed && agent) {
      // Reset failure counter on success
      this.failureCounts.set(agent.id, 0);
    }

    this.emit('lifecycle:health:checked', {
      deploymentId,
      check,
      timestamp: Date.now(),
    });

    return check;
  }

  // ─────────────────────────────────────────────────────────────
  // METRICS
  // ─────────────────────────────────────────────────────────────

  /**
   * Record performance metrics for an agent.
   *
   * Metrics are stored in a time-ordered list per agent and automatically
   * pruned beyond the configured retention period.
   */
  recordMetrics(agentId: string, metricsData: AgentPerformanceMetrics): void {
    this.requireAgent(agentId);

    const agentMetrics = this.metrics.get(agentId) ?? [];
    agentMetrics.push(metricsData);

    // Prune old metrics beyond retention period
    const cutoff = Date.now() - this.config.metricsRetentionMs;
    const pruned = agentMetrics.filter((m) => m.periodEnd >= cutoff);

    this.metrics.set(agentId, pruned);

    this.emit('lifecycle:metrics:recorded', {
      agentId,
      metrics: metricsData,
      timestamp: Date.now(),
    });
  }

  /**
   * Get all performance metrics for an agent.
   *
   * Returns metrics sorted by period start (oldest first).
   */
  getMetrics(agentId: string): AgentPerformanceMetrics[] {
    return (this.metrics.get(agentId) ?? []).sort(
      (a, b) => a.periodStart - b.periodStart,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────────

  /** Get lifecycle management statistics. */
  getStats(): LifecycleStats {
    const agents = [...this.agents.values()];
    const deployments = [...this.deployments.values()];

    // Count agents by phase
    const byPhase: Record<AgentPhase, number> = {
      draft: 0,
      published: 0,
      deployed: 0,
      running: 0,
      paused: 0,
      retiring: 0,
      retired: 0,
    };
    for (const agent of agents) {
      byPhase[agent.phase]++;
    }

    // Calculate average SLA compliance
    let totalCompliance = 0;
    let complianceCount = 0;
    for (const agentMetrics of this.metrics.values()) {
      for (const m of agentMetrics) {
        totalCompliance += m.slaCompliance;
        complianceCount++;
      }
    }

    return {
      totalAgents: agents.length,
      byPhase,
      totalDeployments: deployments.length,
      activeDeployments: deployments.filter((d) => d.status === 'active').length,
      totalRollbacks: this.totalRollbacks,
      avgSlaCompliance: complianceCount > 0
        ? totalCompliance / complianceCount
        : 0,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get an agent by ID or throw if not found.
   */
  private requireAgent(agentId: string): AgentManifest {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return agent;
  }

  /**
   * Get a deployment by ID or throw if not found.
   */
  private requireDeployment(deploymentId: string): AgentDeployment {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }
    return deployment;
  }

  /**
   * Run health checks on all active deployments.
   *
   * Called periodically by the health check timer.
   */
  private runAllHealthChecks(): void {
    for (const deployment of this.deployments.values()) {
      if (deployment.status === 'active') {
        try {
          this.runHealthCheck(deployment.id);
        } catch {
          // Individual check failures should not stop the sweep
        }
      }
    }
  }
}
