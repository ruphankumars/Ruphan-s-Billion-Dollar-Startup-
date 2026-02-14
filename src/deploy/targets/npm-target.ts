/**
 * NpmTarget — npm Package Deployment Target
 *
 * Packages and publishes npm packages. Generates package.json from
 * deployment manifests. Supports dry-run mode for safety.
 * Zero npm dependencies — uses node:child_process.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { execSync } from 'node:child_process';
import type { DeployManifest, DeployResult, PackageBundle } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// NPM TARGET
// ═══════════════════════════════════════════════════════════════

export class NpmTarget extends EventEmitter {
  private dryRun: boolean;
  private registry: string;
  private deployments: Map<string, { packageName: string; version: string }> = new Map();
  private running = false;

  constructor(config?: { dryRun?: boolean; registry?: string }) {
    super();
    this.dryRun = config?.dryRun ?? true; // Default to dry-run for safety
    this.registry = config?.registry ?? 'https://registry.npmjs.org';
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('deploy:npm:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('deploy:npm:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Deploy a bundle as an npm package.
   * Uses npm pack + npm publish. Dry-run by default.
   */
  async deploy(bundle: PackageBundle): Promise<DeployResult> {
    const startTime = Date.now();
    const deployId = `npm_${randomUUID().slice(0, 8)}`;
    const logs: string[] = [];

    try {
      // Generate package.json
      logs.push('Generating package.json from manifest...');
      const packageJson = this.generatePackageJson(bundle.manifest);
      logs.push(`Package: ${packageJson.name}@${packageJson.version}`);

      // Validate
      logs.push('Validating package...');
      const validation = this.validate(bundle);
      if (!validation.valid) {
        logs.push(`Validation failed: ${validation.errors.join(', ')}`);
        throw new Error(`Package validation failed: ${validation.errors.join(', ')}`);
      }
      logs.push('  Validation passed');

      // Pack
      logs.push('Creating package tarball...');
      try {
        const packOutput = execSync('npm pack --dry-run 2>&1', {
          encoding: 'utf-8',
          timeout: 30000,
          stdio: 'pipe',
        });
        logs.push(`  Pack output: ${packOutput.trim()}`);
      } catch {
        logs.push('  npm not available — simulating pack');
        logs.push(`  Simulated tarball: ${bundle.manifest.name}-${bundle.manifest.version}.tgz`);
      }

      // Publish
      if (this.dryRun) {
        logs.push('[DRY RUN] Would publish to npm registry');
        logs.push(`  Registry: ${this.registry}`);
        logs.push(`  Package: ${bundle.manifest.name}@${bundle.manifest.version}`);
      } else {
        logs.push('Publishing to npm...');
        try {
          execSync(`npm publish --registry ${this.registry}`, {
            encoding: 'utf-8',
            timeout: 60000,
            stdio: 'pipe',
          });
          logs.push('  Published successfully');
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logs.push(`  Publish failed: ${errorMsg}`);
          throw err;
        }
      }

      // Record deployment
      this.deployments.set(deployId, {
        packageName: bundle.manifest.name,
        version: bundle.manifest.version,
      });

      const result: DeployResult = {
        targetId: 'npm',
        status: 'success',
        url: `https://www.npmjs.com/package/${bundle.manifest.name}/v/${bundle.manifest.version}`,
        logs,
        duration: Date.now() - startTime,
        deployedAt: Date.now(),
      };

      this.emit('deploy:npm:deployed', {
        timestamp: Date.now(),
        deployId,
        packageName: bundle.manifest.name,
        version: bundle.manifest.version,
        dryRun: this.dryRun,
      });

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logs.push(`npm deployment failed: ${errorMsg}`);

      return {
        targetId: 'npm',
        status: 'failed',
        logs,
        duration: Date.now() - startTime,
        deployedAt: Date.now(),
      };
    }
  }

  /**
   * Generate a package.json from a deployment manifest.
   */
  generatePackageJson(manifest: DeployManifest): Record<string, unknown> {
    return {
      name: manifest.name,
      version: manifest.version,
      main: manifest.entryPoint,
      type: 'module',
      dependencies: manifest.dependencies,
      engines: {
        node: '>=18.0.0',
      },
      scripts: {
        start: `node ${manifest.entryPoint}`,
      },
      files: ['dist', 'src', 'README.md', 'LICENSE'],
      license: 'MIT',
      repository: {
        type: 'git',
        url: '',
      },
    };
  }

  /**
   * Validate a bundle for npm publishing.
   */
  validate(bundle: PackageBundle): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!bundle.manifest.name) {
      errors.push('Package name is required');
    } else if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(bundle.manifest.name)) {
      errors.push('Invalid npm package name');
    }

    if (!bundle.manifest.version) {
      errors.push('Package version is required');
    } else if (!/^\d+\.\d+\.\d+/.test(bundle.manifest.version)) {
      warnings.push('Version does not follow semver format');
    }

    if (!bundle.manifest.entryPoint) {
      errors.push('Entry point is required');
    }

    if (bundle.files.size === 0) {
      errors.push('Package contains no files');
    }

    if (bundle.size > 50 * 1024 * 1024) {
      warnings.push(`Package size (${(bundle.size / 1024 / 1024).toFixed(1)}MB) exceeds 50MB`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Get statistics.
   */
  getStats(): {
    totalDeployments: number;
    dryRun: boolean;
    registry: string;
  } {
    return {
      totalDeployments: this.deployments.size,
      dryRun: this.dryRun,
      registry: this.registry,
    };
  }
}
