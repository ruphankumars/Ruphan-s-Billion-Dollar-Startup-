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

  it('should detect Google provider from API key', async () => {
    process.env.GOOGLE_API_KEY = 'test-key';

    const registry = await ProviderRegistry.create(makeConfig());
    const providers = registry.listAvailable();

    expect(providers).toContain('google');
  });

  it('should detect Groq provider from API key', async () => {
    process.env.GROQ_API_KEY = 'test-key';

    const registry = await ProviderRegistry.create(makeConfig());
    const providers = registry.listAvailable();

    expect(providers).toContain('groq');
  });

  it('should detect Mistral provider from API key', async () => {
    process.env.MISTRAL_API_KEY = 'test-key';

    const registry = await ProviderRegistry.create(makeConfig());
    const providers = registry.listAvailable();

    expect(providers).toContain('mistral');
  });

  it('should detect DeepSeek provider from API key', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';

    const registry = await ProviderRegistry.create(makeConfig());
    const providers = registry.listAvailable();

    expect(providers).toContain('deepseek');
  });

  it('should detect multiple providers simultaneously', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.GROQ_API_KEY = 'test-key';

    const registry = await ProviderRegistry.create(makeConfig());
    const providers = registry.listAvailable();

    expect(providers).toContain('anthropic');
    expect(providers).toContain('openai');
    expect(providers).toContain('groq');
    expect(providers.length).toBeGreaterThanOrEqual(3);
  });

  it('should have has() method working for registered providers', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const registry = await ProviderRegistry.create(makeConfig());

    expect(registry.has('anthropic')).toBe(true);
    expect(registry.has('nonexistent')).toBe(false);
  });
});
