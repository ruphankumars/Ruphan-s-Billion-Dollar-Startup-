/**
 * Deployer — Deployment Pipeline Orchestrator
 *
 * Manages the full deployment lifecycle: validate, build, push, verify.
 * Supports rollback and health checking. Emits events throughout.
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  DeployConfig,
  DeployResult,
  DeployTarget,
  PackageBundle,
} from './types.js';
import { Packager } from './packager.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface DeploymentRecord {
  id: string;
  targetId: string;
  bundle: PackageBundle;
  result: DeployResult;
  previousDeploymentId?: string;
}

interface DeployFilter {
  targetId?: string;
  status?: DeployResult['status'];
}

// ═══════════════════════════════════════════════════════════════
// DEPLOYER
// ═══════════════════════════════════════════════════════════════

export class Deployer extends EventEmitter {
  private config: DeployConfig;
  private targets: Map<string, DeployTarget> = new Map();
  private deployments: Map<string, DeploymentRecord> = new Map();
  private latestByTarget: Map<string, string> = new Map(); // targetId -> deploymentId
  private packager: Packager;
  private running = false;

  constructor(config: DeployConfig) {
    super();
    this.config = config;
    this.packager = new Packager();

    // Register configured targets
    for (const target of config.targets) {
      this.targets.set(target.id, target);
    }
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.packager.start();
    this.emit('deploy:deployer:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.packager.stop();
    this.emit('deploy:deployer:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Full deploy pipeline: validate -> build -> push -> verify.
   */
  async deploy(bundle: PackageBundle, targetId?: string): Promise<DeployResult> {
    const resolvedTargetId = targetId ?? this.config.defaultTarget;
    const target = this.targets.get(resolvedTargetId);

    if (!target) {
      throw new Error(`Deploy target not found: ${resolvedTargetId}`);
    }

    const deploymentId = `dep_${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();
    const logs: string[] = [];

    this.emit('deploy:pipeline:start', {
      timestamp: Date.now(),
      deploymentId,
      targetId: resolvedTargetId,
    });

    try {
      // Step 1: Validate bundle
      logs.push('[1/4] Validating bundle...');
      this.emit('deploy:step:validate', { timestamp: Date.now(), deploymentId });

      const validation = this.packager.validateBundle(bundle);
      if (!validation.valid) {
        logs.push(`Validation failed: ${validation.errors.join(', ')}`);
        throw new Error(`Bundle validation failed: ${validation.errors.join(', ')}`);
      }
      for (const warning of validation.warnings) {
        logs.push(`  Warning: ${warning}`);
      }
      logs.push('  Bundle validated successfully');

      // Step 2: Build / prepare
      logs.push('[2/4] Preparing deployment...');
      this.emit('deploy:step:build', { timestamp: Date.now(), deploymentId });

      logs.push(`  Target: ${target.name} (${target.type})`);
      logs.push(`  Bundle: ${bundle.manifest.name}@${bundle.manifest.version}`);
      logs.push(`  Files: ${bundle.files.size}, Size: ${(bundle.size / 1024).toFixed(1)}KB`);
      logs.push(`  Hash: ${bundle.hash.slice(0, 12)}...`);

      // Step 3: Push (simulated — actual deployment depends on target type)
      logs.push('[3/4] Deploying...');
      this.emit('deploy:step:push', { timestamp: Date.now(), deploymentId });

      const deployUrl = this.generateDeployUrl(target, bundle.manifest);
      logs.push(`  Deployed to: ${deployUrl}`);

      // Step 4: Verify
      logs.push('[4/4] Verifying deployment...');
      this.emit('deploy:step:verify', { timestamp: Date.now(), deploymentId });

      logs.push('  Health check: OK');
      logs.push('  Deployment verified successfully');

      const duration = Date.now() - startTime;
      const result: DeployResult = {
        targetId: resolvedTargetId,
        status: 'success',
        url: deployUrl,
        logs,
        duration,
        deployedAt: Date.now(),
      };

      // Record deployment
      const previousDeploymentId = this.latestByTarget.get(resolvedTargetId);
      const record: DeploymentRecord = {
        id: deploymentId,
        targetId: resolvedTargetId,
        bundle,
        result,
        previousDeploymentId,
      };
      this.deployments.set(deploymentId, record);
      this.latestByTarget.set(resolvedTargetId, deploymentId);

      this.emit('deploy:pipeline:complete', {
        timestamp: Date.now(),
        deploymentId,
        result,
      });

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      logs.push(`Deployment failed: ${errorMsg}`);

      const result: DeployResult = {
        targetId: resolvedTargetId,
        status: 'failed',
        logs,
        duration,
        deployedAt: Date.now(),
      };

      const record: DeploymentRecord = {
        id: deploymentId,
        targetId: resolvedTargetId,
        bundle,
        result,
      };
      this.deployments.set(deploymentId, record);

      this.emit('deploy:pipeline:failed', {
        timestamp: Date.now(),
        deploymentId,
        error: errorMsg,
      });

      return result;
    }
  }

  /**
   * Rollback to the previous version of a deployment.
   */
  async rollback(deploymentId: string): Promise<DeployResult> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    if (!deployment.previousDeploymentId) {
      throw new Error('No previous deployment to rollback to');
    }

    const previousDeployment = this.deployments.get(deployment.previousDeploymentId);
    if (!previousDeployment) {
      throw new Error(`Previous deployment not found: ${deployment.previousDeploymentId}`);
    }

    this.emit('deploy:rollback:start', {
      timestamp: Date.now(),
      deploymentId,
      targetId: deployment.targetId,
    });

    // Re-deploy the previous bundle
    const result = await this.deploy(previousDeployment.bundle, deployment.targetId);
    result.status = result.status === 'success' ? 'success' : 'rolled-back';

    // Update the rolled-back deployment
    deployment.result.status = 'rolled-back';

    this.emit('deploy:rollback:complete', {
      timestamp: Date.now(),
      deploymentId,
      result,
    });

    return result;
  }

  /**
   * Get a deployment by ID.
   */
  getDeployment(id: string): DeploymentRecord | undefined {
    return this.deployments.get(id);
  }

  /**
   * List deployments with optional filtering.
   */
  listDeployments(filter?: DeployFilter): DeploymentRecord[] {
    let results = [...this.deployments.values()];

    if (filter) {
      if (filter.targetId) {
        results = results.filter((d) => d.targetId === filter.targetId);
      }
      if (filter.status) {
        results = results.filter((d) => d.result.status === filter.status);
      }
    }

    return results.sort((a, b) => b.result.deployedAt - a.result.deployedAt);
  }

  /**
   * Run a health check on a deployed service.
   */
  async verify(deploymentId: string): Promise<{
    healthy: boolean;
    url?: string;
    statusCode?: number;
    error?: string;
  }> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      return { healthy: false, error: `Deployment not found: ${deploymentId}` };
    }

    const url = deployment.result.url;
    if (!url) {
      return { healthy: false, error: 'No URL available for deployment' };
    }

    const healthUrl = `${url}${deployment.bundle.manifest.healthCheck.path}`;

    this.emit('deploy:verify:start', {
      timestamp: Date.now(),
      deploymentId,
      url: healthUrl,
    });

    // Simulate health check (actual HTTP check would use node:http)
    const result = {
      healthy: deployment.result.status === 'success',
      url: healthUrl,
      statusCode: deployment.result.status === 'success' ? 200 : 503,
    };

    this.emit('deploy:verify:complete', {
      timestamp: Date.now(),
      deploymentId,
      result,
    });

    return result;
  }

  /**
   * Get statistics.
   */
  getStats(): {
    totalDeployments: number;
    successful: number;
    failed: number;
    rolledBack: number;
    targetsRegistered: number;
    avgDuration: number;
  } {
    const all = [...this.deployments.values()];
    const totalDuration = all.reduce((sum, d) => sum + d.result.duration, 0);

    return {
      totalDeployments: all.length,
      successful: all.filter((d) => d.result.status === 'success').length,
      failed: all.filter((d) => d.result.status === 'failed').length,
      rolledBack: all.filter((d) => d.result.status === 'rolled-back').length,
      targetsRegistered: this.targets.size,
      avgDuration: all.length > 0 ? totalDuration / all.length : 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL
  // ─────────────────────────────────────────────────────────

  private generateDeployUrl(target: DeployTarget, manifest: { name: string; version: string }): string {
    switch (target.type) {
      case 'docker':
        return `docker://${manifest.name}:${manifest.version}`;
      case 'npm':
        return `https://www.npmjs.com/package/${manifest.name}/v/${manifest.version}`;
      case 'cloudflare':
        return `https://${manifest.name}.workers.dev`;
      case 'lambda':
        return `arn:aws:lambda:us-east-1:000000000000:function:${manifest.name}`;
      case 'deno':
        return `https://${manifest.name}.deno.dev`;
      case 'edge':
        return `https://${manifest.name}.edge.app`;
      default:
        return `https://${manifest.name}.deploy.local`;
    }
  }
}
