/**
 * Configuration Migration — Schema evolution with version tracking,
 * automatic migration, config diffing, and validation diagnostics.
 *
 * Supports forward-only migrations from older config schemas to current.
 */

import type { CortexConfig } from './types.js';
import { getLogger } from './logger.js';

const logger = getLogger();

export interface ConfigVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface MigrationStep {
  from: string; // e.g. "0.1.0"
  to: string;   // e.g. "1.0.0"
  description: string;
  migrate: (config: Record<string, unknown>) => Record<string, unknown>;
}

export interface ConfigDiff {
  added: string[];
  removed: string[];
  changed: Array<{ path: string; oldValue: unknown; newValue: unknown }>;
  unchanged: string[];
}

export interface ValidationDiagnostic {
  path: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

/**
 * ConfigMigrator handles schema evolution across CortexOS versions.
 */
export class ConfigMigrator {
  private migrations: MigrationStep[] = [];

  constructor() {
    this.registerBuiltinMigrations();
  }

  private registerBuiltinMigrations(): void {
    // Migration: 0.1.0 → 1.0.0-beta.1
    this.register({
      from: '0.1.0',
      to: '1.0.0',
      description: 'Migrate pre-release config to v1 format',
      migrate: (config) => {
        const result = { ...config };

        // Rename old provider keys
        if (result.provider && !result.providers) {
          result.providers = { default: result.provider };
          delete result.provider;
        }

        // Migrate flat budget keys to nested cost object
        if (result.maxBudget && !result.cost) {
          result.cost = {
            budgetPerRun: result.maxBudget,
            budgetPerDay: (result.maxBudget as number) * 10,
          };
          delete result.maxBudget;
        }

        // Migrate old memory format
        if (result.memoryEnabled !== undefined) {
          result.memory = { enabled: result.memoryEnabled };
          delete result.memoryEnabled;
        }

        // Add quality defaults if missing
        if (!result.quality) {
          result.quality = {
            gates: ['syntax', 'lint'],
            autoFix: true,
            maxRetries: 3,
          };
        }

        // Add reasoning defaults
        if (!result.reasoning) {
          result.reasoning = { enabled: false };
        }

        // Add embeddings defaults
        if (!result.embeddings) {
          result.embeddings = { provider: 'local' };
        }

        // Add dashboard defaults
        if (!result.dashboard) {
          result.dashboard = { port: 3100 };
        }

        return result;
      },
    });
  }

  /**
   * Register a migration step
   */
  register(step: MigrationStep): void {
    this.migrations.push(step);
    // Sort by from version
    this.migrations.sort((a, b) => this.compareVersions(a.from, b.from));
  }

  /**
   * Migrate a config from a given version to the latest
   */
  migrate(
    config: Record<string, unknown>,
    fromVersion: string,
  ): { config: Record<string, unknown>; applied: string[] } {
    let current = { ...config };
    const applied: string[] = [];

    for (const step of this.migrations) {
      if (this.compareVersions(step.from, fromVersion) >= 0) {
        try {
          current = step.migrate(current);
          applied.push(`${step.from} → ${step.to}: ${step.description}`);
          logger.info({ from: step.from, to: step.to }, `Applied config migration: ${step.description}`);
        } catch (err) {
          logger.error({ from: step.from, to: step.to, error: err }, 'Config migration failed');
          throw new Error(`Migration ${step.from} → ${step.to} failed: ${(err as Error).message}`);
        }
      }
    }

    return { config: current, applied };
  }

  /**
   * Get the list of registered migration steps
   */
  getMigrations(): MigrationStep[] {
    return [...this.migrations];
  }

  private compareVersions(a: string, b: string): number {
    const parseSemver = (v: string) => {
      const parts = v.replace(/-.+$/, '').split('.').map(Number);
      return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
    };

    const va = parseSemver(a);
    const vb = parseSemver(b);

    if (va.major !== vb.major) return va.major - vb.major;
    if (va.minor !== vb.minor) return va.minor - vb.minor;
    return va.patch - vb.patch;
  }
}

/**
 * Compute the diff between two configuration objects.
 */
export function diffConfigs(
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>,
): ConfigDiff {
  const diff: ConfigDiff = {
    added: [],
    removed: [],
    changed: [],
    unchanged: [],
  };

  const allKeys = new Set([
    ...flattenKeys(oldConfig),
    ...flattenKeys(newConfig),
  ]);

  for (const key of allKeys) {
    const oldVal = getNestedValue(oldConfig, key);
    const newVal = getNestedValue(newConfig, key);

    if (oldVal === undefined && newVal !== undefined) {
      diff.added.push(key);
    } else if (oldVal !== undefined && newVal === undefined) {
      diff.removed.push(key);
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff.changed.push({ path: key, oldValue: oldVal, newValue: newVal });
    } else {
      diff.unchanged.push(key);
    }
  }

  return diff;
}

/**
 * Validate a config and return structured diagnostics.
 */
export function validateConfig(config: Record<string, unknown>): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  // Check for deprecated keys
  const deprecatedKeys: Record<string, string> = {
    provider: 'Use "providers.default" instead',
    maxBudget: 'Use "cost.budgetPerRun" instead',
    memoryEnabled: 'Use "memory.enabled" instead',
    apiKey: 'Use "providers.anthropicApiKey" instead',
  };

  for (const [key, suggestion] of Object.entries(deprecatedKeys)) {
    if (config[key] !== undefined) {
      diagnostics.push({
        path: key,
        severity: 'warning',
        message: `Deprecated configuration key "${key}"`,
        suggestion,
      });
    }
  }

  // Check for missing API keys when providers are configured
  const providers = config.providers as Record<string, unknown> | undefined;
  if (providers) {
    const defaultProvider = providers.default as string;
    if (defaultProvider && defaultProvider !== 'ollama') {
      const keyMap: Record<string, string> = {
        anthropic: 'anthropicApiKey',
        openai: 'openaiApiKey',
        google: 'googleApiKey',
        groq: 'groqApiKey',
        mistral: 'mistralApiKey',
        together: 'togetherApiKey',
        deepseek: 'deepseekApiKey',
        fireworks: 'fireworksApiKey',
        cohere: 'cohereApiKey',
      };

      const expectedKey = keyMap[defaultProvider];
      if (expectedKey && !providers[expectedKey]) {
        diagnostics.push({
          path: `providers.${expectedKey}`,
          severity: 'warning',
          message: `Default provider "${defaultProvider}" configured but API key not set`,
          suggestion: `Set providers.${expectedKey} or ANTHROPIC_API_KEY / OPENAI_API_KEY environment variable`,
        });
      }
    }
  }

  // Check budget sanity
  const cost = config.cost as Record<string, unknown> | undefined;
  if (cost) {
    const perRun = cost.budgetPerRun as number | undefined;
    const perDay = cost.budgetPerDay as number | undefined;
    if (perRun && perDay && perRun > perDay) {
      diagnostics.push({
        path: 'cost.budgetPerRun',
        severity: 'error',
        message: 'Per-run budget exceeds per-day budget',
        suggestion: 'Set budgetPerRun to a value less than budgetPerDay',
      });
    }
  }

  // Check agent config sanity
  const agents = config.agents as Record<string, unknown> | undefined;
  if (agents) {
    const maxParallel = agents.maxParallel as number | undefined;
    if (maxParallel && maxParallel > 8) {
      diagnostics.push({
        path: 'agents.maxParallel',
        severity: 'warning',
        message: `High parallelism (${maxParallel}) may cause rate limiting`,
        suggestion: 'Consider reducing to 4-8 for most use cases',
      });
    }
  }

  // Check reasoning config
  const reasoning = config.reasoning as Record<string, unknown> | undefined;
  if (reasoning?.enabled) {
    const strategies = reasoning.strategies as Record<string, unknown> | undefined;
    if (strategies?.debate) {
      const debate = strategies.debate as Record<string, unknown>;
      if (debate.enabled && !providers) {
        diagnostics.push({
          path: 'reasoning.strategies.debate',
          severity: 'warning',
          message: 'Debate strategy enabled but no providers configured',
          suggestion: 'Debate requires LLM providers to function',
        });
      }
    }
  }

  return diagnostics;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
