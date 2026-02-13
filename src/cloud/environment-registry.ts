/**
 * Environment Registry — Manages Docker Execution Environments
 *
 * Loads environment definitions from YAML files and provides
 * preset environments for common development stacks.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Environment, ResourceLimits } from './types.js';

// ═══════════════════════════════════════════════════════════════
// PRESET ENVIRONMENTS
// ═══════════════════════════════════════════════════════════════

export const PRESET_ENVIRONMENTS: Environment[] = [
  {
    id: 'node20',
    name: 'Node.js 20',
    description: 'Node.js 20 LTS with npm and common build tools',
    image: 'node:20-slim',
    defaultCmd: ['node'],
    env: { NODE_ENV: 'development' },
    resourceLimits: { cpus: 2, memoryMb: 2048, timeoutMs: 300_000 },
    tags: ['javascript', 'typescript', 'node'],
  },
  {
    id: 'python3',
    name: 'Python 3.12',
    description: 'Python 3.12 with pip and common data science packages',
    image: 'python:3.12-slim',
    defaultCmd: ['python3'],
    env: { PYTHONUNBUFFERED: '1' },
    resourceLimits: { cpus: 2, memoryMb: 4096, timeoutMs: 600_000 },
    tags: ['python', 'data-science', 'ml'],
  },
  {
    id: 'full-stack',
    name: 'Full Stack',
    description: 'Node.js + Python + Git + common CLI tools',
    image: 'node:20',
    defaultCmd: ['bash'],
    env: { NODE_ENV: 'development', PYTHONUNBUFFERED: '1' },
    packages: ['python3', 'python3-pip', 'git', 'curl'],
    resourceLimits: { cpus: 4, memoryMb: 8192, timeoutMs: 600_000 },
    tags: ['fullstack', 'node', 'python'],
  },
  {
    id: 'go',
    name: 'Go 1.22',
    description: 'Go 1.22 for building and testing Go projects',
    image: 'golang:1.22-alpine',
    defaultCmd: ['sh'],
    resourceLimits: { cpus: 2, memoryMb: 2048, timeoutMs: 300_000 },
    tags: ['go', 'golang'],
  },
  {
    id: 'rust',
    name: 'Rust Stable',
    description: 'Rust stable toolchain with cargo',
    image: 'rust:slim',
    defaultCmd: ['bash'],
    resourceLimits: { cpus: 4, memoryMb: 4096, timeoutMs: 600_000 },
    tags: ['rust'],
  },
  {
    id: 'minimal',
    name: 'Minimal Alpine',
    description: 'Minimal Alpine Linux with basic tools',
    image: 'alpine:3.19',
    defaultCmd: ['sh'],
    resourceLimits: { cpus: 1, memoryMb: 512, timeoutMs: 120_000 },
    tags: ['minimal', 'alpine'],
  },
];

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT REGISTRY
// ═══════════════════════════════════════════════════════════════

export class EnvironmentRegistry {
  private environments: Map<string, Environment> = new Map();

  constructor(options?: { loadPresets?: boolean }) {
    if (options?.loadPresets !== false) {
      for (const env of PRESET_ENVIRONMENTS) {
        this.environments.set(env.id, { ...env });
      }
    }
  }

  /** Register an environment */
  register(env: Environment): void {
    this.environments.set(env.id, env);
  }

  /** Get an environment by ID */
  get(id: string): Environment | undefined {
    return this.environments.get(id);
  }

  /** Get an environment by name (case-insensitive) */
  getByName(name: string): Environment | undefined {
    const lower = name.toLowerCase();
    for (const env of this.environments.values()) {
      if (env.name.toLowerCase() === lower) return env;
    }
    return undefined;
  }

  /** List all environments */
  list(filter?: { tags?: string[] }): Environment[] {
    let envs = [...this.environments.values()];
    if (filter?.tags?.length) {
      envs = envs.filter((e) =>
        filter.tags!.some((t) => e.tags?.includes(t)),
      );
    }
    return envs;
  }

  /** Remove an environment */
  remove(id: string): boolean {
    return this.environments.delete(id);
  }

  /** Load environments from a directory of YAML files */
  loadFromDir(dir: string): number {
    if (!existsSync(dir)) return 0;
    let count = 0;

    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.env.yaml') || f.endsWith('.env.yml'),
    );

    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), 'utf-8');
        const env = this.parseYamlEnvironment(content, file);
        if (env) {
          this.environments.set(env.id, env);
          count++;
        }
      } catch {
        // Skip invalid files
      }
    }

    return count;
  }

  /** Save an environment to a directory as YAML */
  saveToDir(dir: string, env: Environment): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const yaml = this.serializeToYaml(env);
    writeFileSync(join(dir, `${env.id}.env.yaml`), yaml, 'utf-8');
  }

  /** Create a custom environment */
  create(options: {
    id: string;
    name: string;
    image: string;
    description?: string;
    env?: Record<string, string>;
    packages?: string[];
    resourceLimits?: ResourceLimits;
    tags?: string[];
  }): Environment {
    const env: Environment = {
      id: options.id,
      name: options.name,
      description: options.description ?? `Custom environment: ${options.name}`,
      image: options.image,
      env: options.env,
      packages: options.packages,
      resourceLimits: options.resourceLimits,
      tags: options.tags ?? ['custom'],
    };
    this.environments.set(env.id, env);
    return env;
  }

  /** Get the count of registered environments */
  get size(): number {
    return this.environments.size;
  }

  // ─── Internal ─────────────────────────────────────────────

  private parseYamlEnvironment(content: string, filename: string): Environment | null {
    // Simple YAML parser for environment files (avoids yaml dependency)
    const lines = content.split('\n');
    const env: Partial<Environment> = {};
    const envVars: Record<string, string> = {};
    const tags: string[] = [];
    const limits: Partial<ResourceLimits> = {};
    let section = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (!line.startsWith(' ') && !line.startsWith('\t')) {
        const [key, ...valParts] = trimmed.split(':');
        const val = valParts.join(':').trim();
        section = key.trim();

        if (section === 'id') env.id = val;
        else if (section === 'name') env.name = val;
        else if (section === 'description') env.description = val;
        else if (section === 'image') env.image = val;
      } else {
        const [key, ...valParts] = trimmed.replace(/^-\s*/, '').split(':');
        const val = valParts.join(':').trim();

        if (section === 'env') envVars[key.trim()] = val;
        else if (section === 'tags') tags.push(trimmed.replace(/^-\s*/, ''));
        else if (section === 'resourceLimits' || section === 'resources') {
          const k = key.trim();
          if (k === 'cpus') limits.cpus = parseFloat(val);
          else if (k === 'memoryMb') limits.memoryMb = parseInt(val, 10);
          else if (k === 'diskMb') limits.diskMb = parseInt(val, 10);
          else if (k === 'timeoutMs') limits.timeoutMs = parseInt(val, 10);
          else if (k === 'networkEnabled') limits.networkEnabled = val === 'true';
        }
      }
    }

    if (!env.id) env.id = basename(filename).replace(/\.env\.ya?ml$/, '');
    if (!env.image) return null;

    env.env = Object.keys(envVars).length > 0 ? envVars : undefined;
    env.tags = tags.length > 0 ? tags : undefined;
    env.resourceLimits = Object.keys(limits).length > 0 ? limits as ResourceLimits : undefined;

    return env as Environment;
  }

  private serializeToYaml(env: Environment): string {
    const lines: string[] = [];
    lines.push(`id: ${env.id}`);
    lines.push(`name: ${env.name}`);
    lines.push(`description: ${env.description}`);
    lines.push(`image: ${env.image}`);

    if (env.env && Object.keys(env.env).length > 0) {
      lines.push('env:');
      for (const [k, v] of Object.entries(env.env)) {
        lines.push(`  ${k}: ${v}`);
      }
    }

    if (env.resourceLimits) {
      lines.push('resourceLimits:');
      const rl = env.resourceLimits;
      if (rl.cpus != null) lines.push(`  cpus: ${rl.cpus}`);
      if (rl.memoryMb != null) lines.push(`  memoryMb: ${rl.memoryMb}`);
      if (rl.diskMb != null) lines.push(`  diskMb: ${rl.diskMb}`);
      if (rl.timeoutMs != null) lines.push(`  timeoutMs: ${rl.timeoutMs}`);
      if (rl.networkEnabled != null) lines.push(`  networkEnabled: ${rl.networkEnabled}`);
    }

    if (env.tags?.length) {
      lines.push('tags:');
      for (const t of env.tags) {
        lines.push(`  - ${t}`);
      }
    }

    return lines.join('\n') + '\n';
  }
}
