import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleProvider, type OpenAICompatibleConfig } from '../../../src/providers/openai-compatible.js';
import { PROVIDER_CONFIGS, GROQ_CONFIG, MISTRAL_CONFIG, TOGETHER_CONFIG, DEEPSEEK_CONFIG, FIREWORKS_CONFIG, COHERE_CONFIG } from '../../../src/providers/provider-configs.js';

const testConfig: OpenAICompatibleConfig = {
  name: 'test-provider',
  baseUrl: 'https://api.test.com/v1',
  apiKeyEnvVar: 'TEST_PROVIDER_API_KEY',
  models: ['test-model-large', 'test-model-small'],
  defaultModel: 'test-model-large',
};

describe('OpenAICompatibleProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should set name from config', () => {
      const provider = new OpenAICompatibleProvider(testConfig);
      expect(provider.name).toBe('test-provider');
    });

    it('should set models from config', () => {
      const provider = new OpenAICompatibleProvider(testConfig);
      expect(provider.models).toEqual(['test-model-large', 'test-model-small']);
    });

    it('should set defaultModel from config', () => {
      const provider = new OpenAICompatibleProvider(testConfig);
      expect(provider.defaultModel).toBe('test-model-large');
    });
  });

  describe('isAvailable', () => {
    it('should return false when no API key is set', async () => {
      delete process.env.TEST_PROVIDER_API_KEY;
      const provider = new OpenAICompatibleProvider(testConfig);
      expect(await provider.isAvailable()).toBe(false);
    });

    it('should return true when env var API key is set', async () => {
      process.env.TEST_PROVIDER_API_KEY = 'test-key';
      const provider = new OpenAICompatibleProvider(testConfig);
      expect(await provider.isAvailable()).toBe(true);
    });

    it('should return true when config API key is provided', async () => {
      delete process.env.TEST_PROVIDER_API_KEY;
      const provider = new OpenAICompatibleProvider(testConfig, { apiKey: 'direct-key' });
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('countTokens', () => {
    it('should provide rough token estimate', () => {
      const provider = new OpenAICompatibleProvider(testConfig);
      const tokens = provider.countTokens('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
    });
  });
});

describe('Provider Configs', () => {
  it('should have 6 provider configs', () => {
    expect(PROVIDER_CONFIGS).toHaveLength(6);
  });

  it('should include all expected providers', () => {
    const names = PROVIDER_CONFIGS.map(c => c.name);
    expect(names).toContain('groq');
    expect(names).toContain('mistral');
    expect(names).toContain('together');
    expect(names).toContain('deepseek');
    expect(names).toContain('fireworks');
    expect(names).toContain('cohere');
  });

  it('should have valid base URLs for all providers', () => {
    for (const config of PROVIDER_CONFIGS) {
      expect(config.baseUrl).toMatch(/^https:\/\//);
    }
  });

  it('should have at least 1 model per provider', () => {
    for (const config of PROVIDER_CONFIGS) {
      expect(config.models.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should have defaultModel in models list', () => {
    for (const config of PROVIDER_CONFIGS) {
      expect(config.models).toContain(config.defaultModel);
    }
  });

  it('should have unique API key env vars', () => {
    const envVars = PROVIDER_CONFIGS.map(c => c.apiKeyEnvVar);
    expect(new Set(envVars).size).toBe(envVars.length);
  });

  describe('Groq config', () => {
    it('should have correct base URL', () => {
      expect(GROQ_CONFIG.baseUrl).toBe('https://api.groq.com/openai/v1');
    });
    it('should use GROQ_API_KEY', () => {
      expect(GROQ_CONFIG.apiKeyEnvVar).toBe('GROQ_API_KEY');
    });
  });

  describe('Mistral config', () => {
    it('should have correct base URL', () => {
      expect(MISTRAL_CONFIG.baseUrl).toBe('https://api.mistral.ai/v1');
    });
  });

  describe('Together config', () => {
    it('should have correct base URL', () => {
      expect(TOGETHER_CONFIG.baseUrl).toBe('https://api.together.xyz/v1');
    });
  });

  describe('DeepSeek config', () => {
    it('should have correct base URL', () => {
      expect(DEEPSEEK_CONFIG.baseUrl).toBe('https://api.deepseek.com/v1');
    });
  });

  describe('Fireworks config', () => {
    it('should have correct base URL', () => {
      expect(FIREWORKS_CONFIG.baseUrl).toBe('https://api.fireworks.ai/inference/v1');
    });
  });

  describe('Cohere config', () => {
    it('should use COHERE_API_KEY', () => {
      expect(COHERE_CONFIG.apiKeyEnvVar).toBe('COHERE_API_KEY');
    });
  });
});

describe('OpenAICompatibleProvider with each config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  for (const config of PROVIDER_CONFIGS) {
    it(`should create ${config.name} provider with correct name`, () => {
      const provider = new OpenAICompatibleProvider(config);
      expect(provider.name).toBe(config.name);
    });

    it(`should detect ${config.name} availability from env var`, async () => {
      process.env[config.apiKeyEnvVar] = 'test-key';
      const provider = new OpenAICompatibleProvider(config);
      expect(await provider.isAvailable()).toBe(true);
    });

    it(`should report ${config.name} as unavailable without key`, async () => {
      delete process.env[config.apiKeyEnvVar];
      const provider = new OpenAICompatibleProvider(config);
      expect(await provider.isAvailable()).toBe(false);
    });
  }
});
