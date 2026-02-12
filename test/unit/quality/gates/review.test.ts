import { describe, it, expect, vi } from 'vitest';
import { ReviewGate } from '../../../../src/quality/gates/review.js';

describe('ReviewGate', () => {
  it('should skip when no provider is given', async () => {
    const gate = new ReviewGate(undefined);

    const result = await gate.run({
      workingDir: '/tmp',
      filesChanged: ['test.ts'],
      executionId: 'test',
    });

    expect(result.passed).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it('should run review with a mock provider', async () => {
    const mockProvider = {
      name: 'mock',
      models: ['mock-model'],
      defaultModel: 'mock-model',
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          issues: [],
          summary: 'Code looks good',
          score: 95,
        }),
        model: 'mock-model',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        finishReason: 'stop' as const,
      }),
      stream: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
      countTokens: vi.fn().mockReturnValue(10),
    };

    const gate = new ReviewGate(mockProvider as any);

    const result = await gate.run({
      workingDir: '/tmp',
      filesChanged: ['test.ts'],
      executionId: 'test',
    });

    // Gate should pass with no issues
    expect(result.passed).toBe(true);
  });

  it('should have the correct gate name', () => {
    const gate = new ReviewGate(undefined);
    expect(gate.name).toBe('review');
  });

  it('should handle provider errors gracefully', async () => {
    const failingProvider = {
      name: 'mock',
      models: ['mock-model'],
      defaultModel: 'mock-model',
      complete: vi.fn().mockRejectedValue(new Error('API error')),
      stream: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
      countTokens: vi.fn().mockReturnValue(10),
    };

    const gate = new ReviewGate(failingProvider as any);

    const result = await gate.run({
      workingDir: '/tmp',
      filesChanged: ['test.ts'],
      executionId: 'test',
    });

    // Should not crash, passes with warning
    expect(result).toBeDefined();
    expect(result.gate).toBe('review');
  });
});
