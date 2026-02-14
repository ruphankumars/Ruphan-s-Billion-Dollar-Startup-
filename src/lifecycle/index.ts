/**
 * Agent Lifecycle Management — CortexOS
 *
 * Barrel exports for the agent lifecycle management subsystem.
 */

export { AgentLifecycleManager } from './agent-lifecycle-manager.js';
export type {
  AgentPhase,
  AgentManifest,
  DeployEnvironment,
  AgentDeployment,
  ResourceAllocation,
  HealthCheck,
  AgentPerformanceMetrics,
  SLADefinition,
  LifecycleConfig,
  LifecycleStats,
} from './types.js';
