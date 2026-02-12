import { describe, it, expect, vi } from 'vitest';
import { MiddlewareProvider } from '../../../src/providers/middleware.js';
import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamChunk } from '../../../src/providers/types.js';

function createMockProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  const mockResponse: LLMResponse = {
    content: 'Hello, world!',
    toolCalls: [],
    model: 'test-model',
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    finishReason: 'stop',
  };

  return {
    name: 'mock',
    models: ['test-model'],
    defaultModel: 'test-model',
    complete: vi.fn().mockResolvedValue(mockResponse),
    stream: vi.fn().mockReturnValue((async function* () {
      yield { type: 'text', content: 'Hello' } as LLMStreamChunk;
      yield { type: 'done', usage: mockResponse.usage } as LLMStreamChunk;
    })()),
    isAvailable: vi.fn().mockResolvedValue(true),
    countTokens: vi.fn().mockReturnValue(10),
    ...overrides,
  };
}

function createRequest(): LLMRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    model: 'test-model',
  };
}

describe('MiddlewareProvider', () => {
  it('should delegate name/models/defaultModel from inner provider', () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner);

    expect(mw.name).toBe('mock');
    expect(mw.models).toEqual(['test-model']);
    expect(mw.defaultModel).toBe('test-model');
  });

  it('should delegate complete to inner provider', async () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner);

    const response = await mw.complete(createRequest());
    expect(response.content).toBe('Hello, world!');
    expect(inner.complete).toHaveBeenCalledOnce();
  });

  it('should delegate stream to inner provider', async () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner);

    const chunks: LLMStreamChunk[] = [];
    for await (const chunk of mw.stream(createRequest())) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(2);
    expect(chunks[0].type).toBe('text');
    expect(chunks[1].type).toBe('done');
  });

  it('should delegate isAvailable to inner provider', async () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner);

    expect(await mw.isAvailable()).toBe(true);
    expect(inner.isAvailable).toHaveBeenCalledOnce();
  });

  it('should delegate countTokens to inner provider', () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner);

    expect(mw.countTokens('test')).toBe(10);
    expect(inner.countTokens).toHaveBeenCalledWith('test');
  });

  // Caching tests
  it('should cache responses when enabled', async () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner, { cacheEnabled: true });

    const req = createRequest();
    await mw.complete(req);
    await mw.complete(req);

    // Only one actual call to inner
    expect(inner.complete).toHaveBeenCalledOnce();
  });

  it('should not cache when disabled (default)', async () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner);

    const req = createRequest();
    await mw.complete(req);
    await mw.complete(req);

    expect(inner.complete).toHaveBeenCalledTimes(2);
  });

  it('should not cache tool call responses', async () => {
    const toolResponse: LLMResponse = {
      content: '',
      toolCalls: [{ id: 'tc1', name: 'read_file', arguments: '{"path":"x"}' }],
      model: 'test-model',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      finishReason: 'tool_calls',
    };
    const inner = createMockProvider({ complete: vi.fn().mockResolvedValue(toolResponse) });
    const mw = new MiddlewareProvider(inner, { cacheEnabled: true });

    const req = createRequest();
    await mw.complete(req);
    await mw.complete(req);

    expect(inner.complete).toHaveBeenCalledTimes(2);
  });

  it('should expire cache entries after TTL', async () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner, { cacheEnabled: true, cacheTTL: 50 });

    const req = createRequest();
    await mw.complete(req);

    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 60));

    await mw.complete(req);
    expect(inner.complete).toHaveBeenCalledTimes(2);
  });

  it('should evict oldest entry when cache is full', async () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner, { cacheEnabled: true, maxCacheSize: 2 });

    // Fill cache
    await mw.complete({ messages: [{ role: 'user', content: 'A' }] });
    await mw.complete({ messages: [{ role: 'user', content: 'B' }] });
    await mw.complete({ messages: [{ role: 'user', content: 'C' }] });

    const stats = mw.getCacheStats();
    expect(stats.size).toBeLessThanOrEqual(2);
  });

  // Hook tests
  it('should call onRequest hook', async () => {
    const onRequest = vi.fn();
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner, { onRequest });

    const req = createRequest();
    await mw.complete(req);

    expect(onRequest).toHaveBeenCalledWith(req);
  });

  it('should call onResponse hook', async () => {
    const onResponse = vi.fn();
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner, { onResponse });

    const req = createRequest();
    await mw.complete(req);

    expect(onResponse).toHaveBeenCalledWith(req, expect.objectContaining({ content: 'Hello, world!' }));
  });

  it('should call onError hook on failure', async () => {
    const onError = vi.fn();
    const error = new Error('Provider failed');
    const inner = createMockProvider({ complete: vi.fn().mockRejectedValue(error) });
    const mw = new MiddlewareProvider(inner, { onError });

    const req = createRequest();
    await expect(mw.complete(req)).rejects.toThrow('Provider failed');
    expect(onError).toHaveBeenCalledWith(req, error);
  });

  it('should report cache stats', () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner, { cacheEnabled: true, maxCacheSize: 50 });

    const stats = mw.getCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.maxSize).toBe(50);
    expect(stats.hitRatio).toBe(0);
  });

  it('should clear cache', async () => {
    const inner = createMockProvider();
    const mw = new MiddlewareProvider(inner, { cacheEnabled: true });

    await mw.complete(createRequest());
    expect(mw.getCacheStats().size).toBe(1);

    mw.clearCache();
    expect(mw.getCacheStats().size).toBe(0);
  });
});
