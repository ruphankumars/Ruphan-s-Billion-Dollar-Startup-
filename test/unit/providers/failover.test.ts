import { describe, it, expect, vi } from 'vitest';
import { FailoverProvider } from '../../../src/providers/failover.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/providers/types.js';

function mockProvider(name: string, options: { fail?: boolean; failStream?: boolean } = {}): LLMProvider {
  return {
    name,
    models: [`${name}-model`],
    defaultModel: `${name}-model`,
    async complete(request: LLMRequest): Promise<LLMResponse> {
      if (options.fail) throw new Error(`${name} failed`);
      return {
        content: `Response from ${name}`,
        model: `${name}-model`,
        usage: { inputTokens: 10, outputTokens: 20 },
      };
    },
    async *stream(request: LLMRequest) {
      if (options.failStream ?? options.fail) throw new Error(`${name} stream failed`);
      yield { content: `chunk from ${name}`, done: false };
      yield { content: '', done: true };
    },
    async isAvailable() { return !options.fail; },
    countTokens(text: string) { return text.length; },
  };
}

describe('FailoverProvider', () => {
  it('should require at least one provider', () => {
    expect(() => new FailoverProvider([])).toThrow('at least one provider');
  });

  it('should use first provider when it succeeds', async () => {
    const provider = new FailoverProvider([
      mockProvider('primary'),
      mockProvider('secondary'),
    ]);

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toBe('Response from primary');
  });

  it('should fall back to second provider when first fails', async () => {
    const provider = new FailoverProvider([
      mockProvider('primary', { fail: true }),
      mockProvider('secondary'),
    ]);

    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toBe('Response from secondary');
  });

  it('should throw when all providers fail', async () => {
    const provider = new FailoverProvider([
      mockProvider('p1', { fail: true }),
      mockProvider('p2', { fail: true }),
    ]);

    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow('All 2 providers failed');
  });

  it('should failover streaming', async () => {
    const provider = new FailoverProvider([
      mockProvider('primary', { failStream: true }),
      mockProvider('secondary'),
    ]);

    const chunks: string[] = [];
    for await (const chunk of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk.content);
    }
    expect(chunks).toContain('chunk from secondary');
  });

  it('should throw when all streaming providers fail', async () => {
    const provider = new FailoverProvider([
      mockProvider('p1', { fail: true }),
      mockProvider('p2', { fail: true }),
    ]);

    await expect(async () => {
      for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
        // consume
      }
    }).rejects.toThrow('All 2 providers failed streaming');
  });

  it('should track health per provider', async () => {
    const provider = new FailoverProvider([
      mockProvider('primary', { fail: true }),
      mockProvider('secondary'),
    ]);

    await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });

    const report = provider.getHealthReport();
    expect(report['primary'].consecutiveFailures).toBe(1);
    expect(report['primary'].successRate).toBe(0);
    expect(report['secondary'].successRate).toBe(1);
    expect(report['secondary'].totalCalls).toBe(1);
  });

  it('should respect maxAttempts option', async () => {
    const provider = new FailoverProvider([
      mockProvider('p1', { fail: true }),
      mockProvider('p2', { fail: true }),
      mockProvider('p3'),
    ], { maxAttempts: 2 });

    // Should only try p1 and p2, not p3
    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow('All 2 providers failed');
  });

  it('should aggregate models from all providers', () => {
    const provider = new FailoverProvider([
      mockProvider('primary'),
      mockProvider('secondary'),
    ]);

    expect(provider.models).toContain('primary-model');
    expect(provider.models).toContain('secondary-model');
  });

  it('should use first providers default model', () => {
    const provider = new FailoverProvider([
      mockProvider('primary'),
      mockProvider('secondary'),
    ]);

    expect(provider.defaultModel).toBe('primary-model');
  });

  it('should check availability across all providers', async () => {
    const provider = new FailoverProvider([
      mockProvider('p1', { fail: true }),
      mockProvider('p2'),
    ]);

    expect(await provider.isAvailable()).toBe(true);
  });

  it('should return false for availability when all providers are down', async () => {
    const provider = new FailoverProvider([
      mockProvider('p1', { fail: true }),
      mockProvider('p2', { fail: true }),
    ]);

    // isAvailable depends on the mock — our mock returns !fail for isAvailable
    expect(await provider.isAvailable()).toBe(false);
  });

  it('should list provider names', () => {
    const provider = new FailoverProvider([
      mockProvider('primary'),
      mockProvider('secondary'),
    ]);

    expect(provider.getProviders()).toEqual(['primary', 'secondary']);
  });
});
