/**
 * Docker Manager — Container Lifecycle via CLI
 *
 * Uses child_process.execFile('docker', ...) — zero npm dependencies.
 * Manages building, running, and stopping Docker containers for agent execution.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  ContainerInfo,
  ContainerStatus,
  Environment,
  RepoMount,
  ResourceLimits,
  ResourceUsage,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// DOCKER MANAGER
// ═══════════════════════════════════════════════════════════════

export class DockerManager {
  private containers: Map<string, ContainerInfo> = new Map();
  private logStreams: Map<string, Array<(line: string) => void>> = new Map();

  /** Check if Docker is available */
  async isAvailable(): Promise<boolean> {
    try {
      await this.exec(['version', '--format', '{{.Server.Version}}']);
      return true;
    } catch {
      return false;
    }
  }

  /** Get Docker version info */
  async getVersion(): Promise<string> {
    const output = await this.exec(['version', '--format', '{{.Server.Version}}']);
    return output.trim();
  }

  /** Pull a Docker image */
  async pullImage(image: string): Promise<void> {
    await this.exec(['pull', image], 120_000);
  }

  /** Check if an image exists locally */
  async imageExists(image: string): Promise<boolean> {
    try {
      await this.exec(['image', 'inspect', image]);
      return true;
    } catch {
      return false;
    }
  }

  /** Build a Docker image from a Dockerfile */
  async buildImage(
    tag: string,
    context: string,
    dockerfile?: string,
  ): Promise<void> {
    const args = ['build', '-t', tag];
    if (dockerfile) args.push('-f', dockerfile);
    args.push(context);
    await this.exec(args, 300_000);
  }

  /** Create and start a container */
  async createContainer(options: {
    environment: Environment;
    command?: string[];
    mounts?: RepoMount[];
    env?: Record<string, string>;
    workdir?: string;
    name?: string;
  }): Promise<ContainerInfo> {
    const { environment, command, mounts, env, workdir, name } = options;
    const id = `ctx_${randomUUID().slice(0, 8)}`;
    const containerName = name ?? `cortexos-${id}`;

    const args = ['create', '--name', containerName];

    // Resource limits
    const limits = environment.resourceLimits;
    if (limits?.cpus) args.push('--cpus', String(limits.cpus));
    if (limits?.memoryMb) args.push('--memory', `${limits.memoryMb}m`);
    if (limits?.networkEnabled === false) args.push('--network', 'none');

    // Environment variables
    const allEnv = { ...environment.env, ...env };
    for (const [k, v] of Object.entries(allEnv)) {
      args.push('-e', `${k}=${v}`);
    }

    // Mounts
    if (mounts) {
      for (const mount of mounts) {
        const ro = mount.readonly ? ':ro' : '';
        args.push('-v', `${mount.hostPath}:${mount.containerPath}${ro}`);
      }
    }

    // Working directory
    if (workdir) args.push('-w', workdir);

    // Image and command
    args.push(environment.image);
    if (command) args.push(...command);
    else if (environment.defaultCmd) args.push(...environment.defaultCmd);

    const output = await this.exec(args);
    const containerId = output.trim().slice(0, 12);

    const info: ContainerInfo = {
      id,
      containerId,
      environmentId: environment.id,
      status: 'creating',
      createdAt: Date.now(),
    };

    this.containers.set(id, info);
    return info;
  }

  /** Start a container */
  async startContainer(id: string): Promise<void> {
    const info = this.containers.get(id);
    if (!info) throw new Error(`Container "${id}" not found`);

    await this.exec(['start', info.containerId]);
    info.status = 'running';
    info.startedAt = Date.now();
  }

  /** Stop a container */
  async stopContainer(id: string, timeout = 10): Promise<void> {
    const info = this.containers.get(id);
    if (!info) throw new Error(`Container "${id}" not found`);

    try {
      await this.exec(['stop', '-t', String(timeout), info.containerId]);
    } catch {
      // Container may already be stopped
    }
    info.status = 'stopped';
  }

  /** Remove a container */
  async removeContainer(id: string, force = false): Promise<void> {
    const info = this.containers.get(id);
    if (!info) throw new Error(`Container "${id}" not found`);

    const args = ['rm'];
    if (force) args.push('-f');
    args.push(info.containerId);

    try {
      await this.exec(args);
    } catch {
      // Container may already be removed
    }
    this.containers.delete(id);
  }

  /** Execute a command inside a running container */
  async execInContainer(
    id: string,
    command: string[],
    options?: { workdir?: string; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const info = this.containers.get(id);
    if (!info) throw new Error(`Container "${id}" not found`);

    const args = ['exec'];
    if (options?.workdir) args.push('-w', options.workdir);
    if (options?.env) {
      for (const [k, v] of Object.entries(options.env)) {
        args.push('-e', `${k}=${v}`);
      }
    }
    args.push(info.containerId, ...command);

    try {
      const stdout = await this.exec(args);
      return { stdout, stderr: '', exitCode: 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { stdout: '', stderr: message, exitCode: 1 };
    }
  }

  /** Get container logs */
  async getContainerLogs(
    id: string,
    options?: { tail?: number; since?: string },
  ): Promise<string> {
    const info = this.containers.get(id);
    if (!info) throw new Error(`Container "${id}" not found`);

    const args = ['logs'];
    if (options?.tail) args.push('--tail', String(options.tail));
    if (options?.since) args.push('--since', options.since);
    args.push(info.containerId);

    return this.exec(args);
  }

  /** Wait for a container to finish */
  async waitForContainer(
    id: string,
    timeoutMs?: number,
  ): Promise<{ exitCode: number; status: ContainerStatus }> {
    const info = this.containers.get(id);
    if (!info) throw new Error(`Container "${id}" not found`);

    const waitPromise = this.exec(['wait', info.containerId]).then((output) => {
      const exitCode = parseInt(output.trim(), 10) || 0;
      info.exitCode = exitCode;
      info.completedAt = Date.now();
      info.status = exitCode === 0 ? 'completed' : 'failed';
      return { exitCode, status: info.status };
    });

    if (timeoutMs) {
      const timeoutPromise = new Promise<{ exitCode: number; status: ContainerStatus }>(
        (_, reject) => {
          setTimeout(() => {
            info.status = 'timeout';
            info.completedAt = Date.now();
            reject(new Error(`Container "${id}" timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        },
      );
      return Promise.race([waitPromise, timeoutPromise]);
    }

    return waitPromise;
  }

  /** Get resource usage stats for a running container */
  async getResourceUsage(id: string): Promise<ResourceUsage> {
    const info = this.containers.get(id);
    if (!info) throw new Error(`Container "${id}" not found`);

    try {
      const output = await this.exec([
        'stats', '--no-stream', '--format',
        '{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}',
        info.containerId,
      ]);

      const parts = output.trim().split('|');
      return {
        cpuPercent: parseFloat(parts[0]) || 0,
        memoryMb: parseMemory(parts[1] || '0'),
        networkRxBytes: parseNetworkBytes(parts[2] || '0', 'rx'),
        networkTxBytes: parseNetworkBytes(parts[2] || '0', 'tx'),
      };
    } catch {
      return {};
    }
  }

  /** List all managed containers */
  getContainers(): ContainerInfo[] {
    return [...this.containers.values()];
  }

  /** Get a specific container */
  getContainer(id: string): ContainerInfo | undefined {
    return this.containers.get(id);
  }

  /** Clean up all containers */
  async cleanup(force = true): Promise<void> {
    for (const [id] of this.containers) {
      try {
        await this.removeContainer(id, force);
      } catch {
        // Best effort
      }
    }
  }

  // ─── Internal ─────────────────────────────────────────────

  private exec(args: string[], timeout = 30_000): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('docker', args, { timeout }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`docker ${args[0]} failed: ${stderr || err.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function parseMemory(memStr: string): number {
  const match = memStr.match(/([\d.]+)\s*(MiB|GiB|KiB|MB|GB|KB)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('g')) return val * 1024;
  if (unit.startsWith('k')) return val / 1024;
  return val;
}

function parseNetworkBytes(netStr: string, direction: 'rx' | 'tx'): number {
  const parts = netStr.split('/');
  const str = direction === 'rx' ? parts[0] : parts[1] || '0';
  const match = str?.trim().match(/([\d.]+)\s*(kB|MB|GB|B)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'gb') return val * 1_073_741_824;
  if (unit === 'mb') return val * 1_048_576;
  if (unit === 'kb') return val * 1024;
  return val;
}
