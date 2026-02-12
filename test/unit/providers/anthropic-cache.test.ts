import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello back!' }],
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 50,
          output_tokens: 20,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        },
        stop_reason: 'end_turn',
      }),
    };
  }
  return { default: MockAnthropic };
});

import { AnthropicProvider } from '../../../src/providers/anthropic.js';

describe('Anthropic Prompt Caching', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('should be able to instantiate with API key', () => {
    expect(provider).toBeDefined();
    expect(provider.name).toBe('anthropic');
  });

  it('should include anthropic in models list', () => {
    expect(provider.models.length).toBeGreaterThan(0);
  });

  it('should have a default model set', () => {
    expect(provider.defaultModel).toBeDefined();
  });

  it('should be available when configured', async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it('should count tokens', () => {
    expect(provider.countTokens('hello world')).toBeGreaterThan(0);
  });

  it('should complete requests and return cacheStats', async () => {
    const result = await provider.complete({
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ],
    });

    expect(result.content).toBe('Hello back!');
    expect(result.cacheStats).toBeDefined();
    expect(result.cacheStats?.cacheCreationInputTokens).toBe(100);
    expect(result.cacheStats?.cacheReadInputTokens).toBe(50);
  });

  it('should include usage information in response', async () => {
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Quick question' }],
    });

    // Usage should be populated from the mock
    expect(result.usage).toBeDefined();
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });
});
