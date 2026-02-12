import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleProvider } from '../../../src/providers/google.js';

describe('GoogleProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('properties', () => {
    it('should have name "google"', () => {
      const provider = new GoogleProvider();
      expect(provider.name).toBe('google');
    });

    it('should have gemini models', () => {
      const provider = new GoogleProvider();
      expect(provider.models).toContain('gemini-2.0-flash');
      expect(provider.models).toContain('gemini-2.0-pro');
    });

    it('should default to gemini-2.0-flash', () => {
      const provider = new GoogleProvider();
      expect(provider.defaultModel).toBe('gemini-2.0-flash');
    });
  });

  describe('isAvailable', () => {
    it('should return false when no API key is set', async () => {
      delete process.env.GOOGLE_API_KEY;
      const provider = new GoogleProvider();
      expect(await provider.isAvailable()).toBe(false);
    });

    it('should return true when env var is set', async () => {
      process.env.GOOGLE_API_KEY = 'test-key';
      const provider = new GoogleProvider();
      expect(await provider.isAvailable()).toBe(true);
    });

    it('should return true when config API key is provided', async () => {
      delete process.env.GOOGLE_API_KEY;
      const provider = new GoogleProvider({ apiKey: 'direct-key' });
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('countTokens', () => {
    it('should estimate token count', () => {
      const provider = new GoogleProvider();
      const tokens = provider.countTokens('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
      // ~4 chars per token heuristic
      expect(tokens).toBeLessThan(100);
    });
  });

  describe('constructor', () => {
    it('should accept empty config', () => {
      const provider = new GoogleProvider();
      expect(provider).toBeDefined();
    });

    it('should accept config with API key', () => {
      const provider = new GoogleProvider({ apiKey: 'test-key' });
      expect(provider).toBeDefined();
    });
  });
});
