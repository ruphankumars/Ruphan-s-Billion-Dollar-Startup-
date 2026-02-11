import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProviderRegistry } from '../../../src/providers/registry.js';
import type { CortexConfig } from '../../../src/core/types.js';

function makeConfig(overrides: Partial<CortexConfig['providers']> = {}): CortexConfig {
  return {
    providers: {
      default: 'anthropic',
      anthropicApiKey: '',
      openaiApiKey: '',
      ...overrides,
    },
  } as CortexConfig;
}

describe('ProviderRegistry', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create with empty config when no API keys', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const registry = await ProviderRegistry.create(makeConfig());

    expect(registry.listAvailable().length).toBe(0);
  });

  it('should detect Anthropic provider from API key', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const registry = await ProviderRegistry.create(makeConfig());
    const providers = registry.listAvailable();

    expect(providers).toContain('anthropic');
  });

  it('should detect OpenAI provider from API key', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const registry = await ProviderRegistry.create(makeConfig());
    const providers = registry.listAvailable();

    expect(providers).toContain('openai');
  });

  it('should throw when getting non-existent provider', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const registry = await ProviderRegistry.create(makeConfig());

    expect(() => registry.get('nonexistent')).toThrow();
  });
});
