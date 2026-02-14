/**
 * EdgeTarget — Edge/Serverless Deployment Target
 *
 * Generates deployment configurations for Cloudflare Workers,
 * AWS Lambda, and Deno Deploy. Handles platform-specific manifests.
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { DeployManifest, DeployResult, PackageBundle } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

type EdgePlatform = 'cloudflare' | 'lambda' | 'deno';

// ═══════════════════════════════════════════════════════════════
// EDGE TARGET
// ═══════════════════════════════════════════════════════════════

export class EdgeTarget extends EventEmitter {
  private deployments: Map<string, { platform: EdgePlatform; url: string }> = new Map();
  private running = false;

  constructor() {
    super();
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('deploy:edge:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('deploy:edge:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Deploy a bundle to an edge platform.
   */
  async deploy(bundle: PackageBundle, platform: EdgePlatform = 'cloudflare'): Promise<DeployResult> {
    const startTime = Date.now();
    const deployId = `edge_${randomUUID().slice(0, 8)}`;
    const logs: string[] = [];

    try {
      logs.push(`Deploying to ${platform}...`);

      let config: string;
      let url: string;

      switch (platform) {
        case 'cloudflare': {
          config = this.generateWranglerConfig(bundle.manifest);
          url = `https://${bundle.manifest.name}.workers.dev`;
          logs.push('Generated wrangler.toml configuration');
          logs.push(`Worker name: ${bundle.manifest.name}`);
          logs.push(`URL: ${url}`);
          break;
        }
        case 'lambda': {
          config = this.generateLambdaConfig(bundle.manifest);
          url = `arn:aws:lambda:us-east-1:000000000000:function:${bundle.manifest.name}`;
          logs.push('Generated Lambda configuration');
          logs.push(`Function name: ${bundle.manifest.name}`);
          logs.push(`ARN: ${url}`);
          break;
        }
        case 'deno': {
          config = this.generateDenoConfig(bundle.manifest);
          url = `https://${bundle.manifest.name}.deno.dev`;
          logs.push('Generated Deno Deploy configuration');
          logs.push(`Project: ${bundle.manifest.name}`);
          logs.push(`URL: ${url}`);
          break;
        }
      }

      logs.push(`Configuration size: ${config.length} bytes`);
      logs.push(`Bundle: ${bundle.files.size} files, ${(bundle.size / 1024).toFixed(1)}KB`);
      logs.push('Deployment simulated successfully');

      // Record deployment
      this.deployments.set(deployId, { platform, url });

      const result: DeployResult = {
        targetId: `edge-${platform}`,
        status: 'success',
        url,
        logs,
        duration: Date.now() - startTime,
        deployedAt: Date.now(),
      };

      this.emit('deploy:edge:deployed', {
        timestamp: Date.now(),
        deployId,
        platform,
        url,
      });

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logs.push(`Edge deployment failed: ${errorMsg}`);

      return {
        targetId: `edge-${platform}`,
        status: 'failed',
        logs,
        duration: Date.now() - startTime,
        deployedAt: Date.now(),
      };
    }
  }

  /**
   * Generate wrangler.toml for Cloudflare Workers.
   */
  generateWranglerConfig(manifest: DeployManifest): string {
    const envVars = Object.entries(manifest.environment)
      .map(([key, value]) => `${key} = "${value}"`)
      .join('\n');

    return [
      `# Auto-generated wrangler.toml for ${manifest.name}`,
      `name = "${manifest.name}"`,
      `main = "${manifest.entryPoint}"`,
      `compatibility_date = "${new Date().toISOString().split('T')[0]}"`,
      '',
      '[vars]',
      envVars || '# No environment variables',
      '',
      '# Workers Limits',
      '# CPU time: 10ms (free) / 50ms (paid)',
      '# Memory: 128MB',
      '',
      '[triggers]',
      'crons = []',
      '',
      '# Routes (configure as needed)',
      '# [[routes]]',
      '# pattern = "example.com/*"',
      '# zone_name = "example.com"',
      '',
    ].join('\n');
  }

  /**
   * Generate AWS Lambda configuration (SAM template).
   */
  generateLambdaConfig(manifest: DeployManifest): string {
    const envVars = Object.entries(manifest.environment)
      .map(([key, value]) => `          ${key}: "${value}"`)
      .join('\n');

    return [
      `# Auto-generated SAM template for ${manifest.name}`,
      'AWSTemplateFormatVersion: "2010-09-09"',
      'Transform: AWS::Serverless-2016-10-31',
      '',
      `Description: ${manifest.name} v${manifest.version}`,
      '',
      'Globals:',
      '  Function:',
      `    Timeout: ${manifest.healthCheck.timeout}`,
      `    MemorySize: ${this.parseMemory(manifest.resources.memory ?? '256Mi')}`,
      '    Runtime: nodejs20.x',
      '',
      'Resources:',
      `  ${this.toPascalCase(manifest.name)}Function:`,
      '    Type: AWS::Serverless::Function',
      '    Properties:',
      `      Handler: ${manifest.entryPoint.replace(/\.(ts|js)$/, '')}.handler`,
      '      Architectures:',
      '        - x86_64',
      '      Events:',
      '        Api:',
      '          Type: Api',
      '          Properties:',
      '            Path: /{proxy+}',
      '            Method: ANY',
      '      Environment:',
      '        Variables:',
      envVars || '          NODE_ENV: "production"',
      '',
      'Outputs:',
      `  ${this.toPascalCase(manifest.name)}Api:`,
      '    Description: API Gateway endpoint URL',
      '    Value: !Sub "https://${ServerlessRestApi}.execute-api.${AWS::Region}.amazonaws.com/Prod/"',
      '',
    ].join('\n');
  }

  /**
   * Generate Deno Deploy configuration (deno.json).
   */
  generateDenoConfig(manifest: DeployManifest): string {
    return JSON.stringify(
      {
        $schema: 'https://deno.land/x/deno/cli/schemas/config-file.v1.json',
        name: manifest.name,
        version: manifest.version,
        tasks: {
          start: `deno run --allow-net --allow-read --allow-env ${manifest.entryPoint}`,
          dev: `deno run --watch --allow-net --allow-read --allow-env ${manifest.entryPoint}`,
        },
        compilerOptions: {
          lib: ['deno.window'],
          strict: true,
        },
        deploy: {
          project: manifest.name,
          entrypoint: manifest.entryPoint,
          include: ['src/**/*.ts', 'static/**/*'],
          exclude: ['node_modules', '.git', 'test'],
        },
        imports: {},
      },
      null,
      2,
    );
  }

  /**
   * Get statistics.
   */
  getStats(): {
    totalDeployments: number;
    byPlatform: Record<string, number>;
  } {
    const byPlatform: Record<string, number> = {};
    for (const { platform } of this.deployments.values()) {
      byPlatform[platform] = (byPlatform[platform] ?? 0) + 1;
    }

    return {
      totalDeployments: this.deployments.size,
      byPlatform,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────────────

  /**
   * Parse memory string (e.g. "256Mi") to megabytes number.
   */
  private parseMemory(memory: string): number {
    const match = memory.match(/^(\d+)(Mi|Gi|MB|GB)?$/i);
    if (!match) return 256;

    const value = parseInt(match[1], 10);
    const unit = (match[2] ?? 'Mi').toLowerCase();

    switch (unit) {
      case 'gi':
      case 'gb':
        return value * 1024;
      case 'mi':
      case 'mb':
      default:
        return value;
    }
  }

  /**
   * Convert a name to PascalCase for CloudFormation resource names.
   */
  private toPascalCase(name: string): string {
    return name
      .replace(/[-_@/]/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
}
