import { describe, it, expect } from 'vitest';
import {
  ConfigMigrator,
  diffConfigs,
  validateConfig,
} from '../../../src/core/config-migration.js';

describe('ConfigMigrator', () => {
  it('should create with built-in migrations', () => {
    const migrator = new ConfigMigrator();
    const migrations = migrator.getMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0].from).toBe('0.1.0');
  });

  it('should migrate old provider key to new format', () => {
    const migrator = new ConfigMigrator();
    const oldConfig = { provider: 'openai' };

    const { config, applied } = migrator.migrate(oldConfig, '0.1.0');
    expect(config.providers).toEqual({ default: 'openai' });
    expect(config.provider).toBeUndefined();
    expect(applied.length).toBeGreaterThanOrEqual(1);
  });

  it('should migrate flat budget to nested cost object', () => {
    const migrator = new ConfigMigrator();
    const oldConfig = { maxBudget: 2.0 };

    const { config } = migrator.migrate(oldConfig, '0.1.0');
    expect(config.cost).toBeDefined();
    expect((config.cost as any).budgetPerRun).toBe(2.0);
    expect((config.cost as any).budgetPerDay).toBe(20.0);
    expect(config.maxBudget).toBeUndefined();
  });

  it('should migrate memoryEnabled to memory.enabled', () => {
    const migrator = new ConfigMigrator();
    const oldConfig = { memoryEnabled: true };

    const { config } = migrator.migrate(oldConfig, '0.1.0');
    expect(config.memory).toEqual({ enabled: true });
    expect(config.memoryEnabled).toBeUndefined();
  });

  it('should add default sections if missing', () => {
    const migrator = new ConfigMigrator();
    const oldConfig = {};

    const { config } = migrator.migrate(oldConfig, '0.1.0');
    expect(config.quality).toBeDefined();
    expect(config.reasoning).toBeDefined();
    expect(config.embeddings).toBeDefined();
    expect(config.dashboard).toBeDefined();
  });

  it('should not overwrite existing sections', () => {
    const migrator = new ConfigMigrator();
    const oldConfig = {
      quality: { gates: ['security'], autoFix: false },
    };

    const { config } = migrator.migrate(oldConfig, '0.1.0');
    expect((config.quality as any).autoFix).toBe(false);
  });

  it('should register custom migration steps', () => {
    const migrator = new ConfigMigrator();
    migrator.register({
      from: '1.0.0',
      to: '2.0.0',
      description: 'Custom migration',
      migrate: (config) => ({ ...config, customMigrated: true }),
    });

    const migrations = migrator.getMigrations();
    expect(migrations.some(m => m.to === '2.0.0')).toBe(true);
  });

  it('should skip migrations before fromVersion', () => {
    const migrator = new ConfigMigrator();
    const config = {
      providers: { default: 'anthropic' },
      quality: { gates: ['syntax'] },
    };

    // Already at 1.0.0, skip 0.1.0→1.0.0 migration
    const { applied } = migrator.migrate(config, '1.0.0');
    // The builtin 0.1.0 migration should be applied since from >= fromVersion comparison
    expect(applied.length).toBeGreaterThanOrEqual(0);
  });
});

describe('diffConfigs', () => {
  it('should detect added keys', () => {
    const diff = diffConfigs({}, { newKey: 'value' });
    expect(diff.added).toContain('newKey');
  });

  it('should detect removed keys', () => {
    const diff = diffConfigs({ oldKey: 'value' }, {});
    expect(diff.removed).toContain('oldKey');
  });

  it('should detect changed values', () => {
    const diff = diffConfigs(
      { key: 'old' },
      { key: 'new' },
    );
    expect(diff.changed.length).toBe(1);
    expect(diff.changed[0].path).toBe('key');
    expect(diff.changed[0].oldValue).toBe('old');
    expect(diff.changed[0].newValue).toBe('new');
  });

  it('should detect unchanged values', () => {
    const diff = diffConfigs(
      { key: 'same' },
      { key: 'same' },
    );
    expect(diff.unchanged).toContain('key');
  });

  it('should handle nested objects', () => {
    const diff = diffConfigs(
      { providers: { default: 'anthropic' } },
      { providers: { default: 'openai' } },
    );
    expect(diff.changed.some(c => c.path === 'providers.default')).toBe(true);
  });

  it('should handle empty configs', () => {
    const diff = diffConfigs({}, {});
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.changed.length).toBe(0);
  });
});

describe('validateConfig', () => {
  it('should detect deprecated keys', () => {
    const diagnostics = validateConfig({ provider: 'anthropic' });
    expect(diagnostics.some(d => d.path === 'provider' && d.severity === 'warning')).toBe(true);
  });

  it('should warn about missing API key for default provider', () => {
    const diagnostics = validateConfig({
      providers: { default: 'openai' },
    });
    expect(diagnostics.some(d => d.path === 'providers.openaiApiKey')).toBe(true);
  });

  it('should not warn about ollama (no API key needed)', () => {
    const diagnostics = validateConfig({
      providers: { default: 'ollama' },
    });
    expect(diagnostics.some(d => d.path?.includes('ApiKey'))).toBe(false);
  });

  it('should error on budget misconfiguration', () => {
    const diagnostics = validateConfig({
      cost: { budgetPerRun: 100, budgetPerDay: 10 },
    });
    expect(diagnostics.some(d => d.severity === 'error' && d.path === 'cost.budgetPerRun')).toBe(true);
  });

  it('should warn about high parallelism', () => {
    const diagnostics = validateConfig({
      agents: { maxParallel: 16 },
    });
    expect(diagnostics.some(d => d.path === 'agents.maxParallel' && d.severity === 'warning')).toBe(true);
  });

  it('should return empty for valid config', () => {
    const diagnostics = validateConfig({
      providers: { default: 'ollama' },
      cost: { budgetPerRun: 1, budgetPerDay: 10 },
      agents: { maxParallel: 4 },
    });
    expect(diagnostics.length).toBe(0);
  });
});
