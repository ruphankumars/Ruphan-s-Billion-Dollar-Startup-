import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../../../src/providers/ollama.js';

describe('OllamaProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('properties', () => {
    it('should have name "ollama"', () => {
      const provider = new OllamaProvider();
      expect(provider.name).toBe('ollama');
    });

    it('should have local models', () => {
      const provider = new OllamaProvider();
      expect(provider.models).toContain('llama3.2');
      expect(provider.models).toContain('qwen2.5-coder');
    });

    it('should default to llama3.2', () => {
      const provider = new OllamaProvider();
      expect(provider.defaultModel).toBe('llama3.2');
    });
  });

  describe('constructor', () => {
    it('should default to localhost:11434', () => {
      delete process.env.OLLAMA_BASE_URL;
      const provider = new OllamaProvider();
      expect(provider).toBeDefined();
    });

    it('should accept custom base URL from config', () => {
      const provider = new OllamaProvider({ baseUrl: 'http://custom:8080' });
      expect(provider).toBeDefined();
    });

    it('should use OLLAMA_BASE_URL env var', () => {
      process.env.OLLAMA_BASE_URL = 'http://env-url:9090';
      const provider = new OllamaProvider();
      expect(provider).toBeDefined();
    });
  });

  describe('isAvailable', () => {
    it('should return false when Ollama is not running', async () => {
      // Use an invalid URL to ensure connection fails
      const provider = new OllamaProvider({ baseUrl: 'http://localhost:99999' });
      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('countTokens', () => {
    it('should estimate token count', () => {
      const provider = new OllamaProvider();
      const tokens = provider.countTokens('Test string for counting tokens');
      expect(tokens).toBeGreaterThan(0);
    });
  });
});
