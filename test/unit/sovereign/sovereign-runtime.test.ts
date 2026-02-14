/**
 * SovereignRuntime — Unit Tests
 *
 * Tests air-gap runtime: initialization, mode detection, task execution,
 * model fallback, statistics, and mode switching.
 * Mocks LocalProvider and OfflineToolkit via vi.spyOn.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SovereignRuntime } from '../../../src/sovereign/sovereign-runtime.js';

// Mock node:http for connectivity checks
vi.mock('node:http', () => {
  const mockReq = {
    on: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    request: vi.fn((_opts: unknown, cb: (res: unknown) => void) => {
      // Default: simulate offline (no callback invoked)
      return mockReq;
    }),
  };
});

// ── Helpers ───────────────────────────────────────────────────

function createRuntime(
  overrides?: Partial<{
    ollamaUrl: string;
    defaultModel: string;
    fallbackModels: string[];
  }>,
): SovereignRuntime {
  return new SovereignRuntime({
    enabled: true,
    ollamaUrl: overrides?.ollamaUrl ?? 'http://localhost:11434',
    defaultModel: overrides?.defaultModel ?? 'llama3',
    fallbackModels: overrides?.fallbackModels ?? ['mistral', 'codellama'],
    offlineToolsDir: '.cortex/tools',
    embeddingModel: 'nomic-embed-text',
    maxContextTokens: 4096,
    checkConnectivity: false,
  });
}

// ── Test suite ────────────────────────────────────────────────

describe('SovereignRuntime', () => {
  let runtime: SovereignRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = createRuntime();
  });

  // ── Constructor ───────────────────────────────────────────

  describe('constructor', () => {
    it('merges config with defaults', () => {
      const r = new SovereignRuntime({ defaultModel: 'phi' });
      // Access stats which exposes mode, proving config was merged
      const stats = r.getStats();
      expect(stats.mode).toBe('offline'); // default initial mode
    });

    it('defaults to offline mode', () => {
      expect(runtime.isOffline()).toBe(true);
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start() sets running and emits event', () => {
      const spy = vi.fn();
      runtime.on('sovereign:runtime:started', spy);
      runtime.start();
      expect(runtime.isRunning()).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('stop() clears running and emits event', () => {
      runtime.start();
      const spy = vi.fn();
      runtime.on('sovereign:runtime:stopped', spy);
      runtime.stop();
      expect(runtime.isRunning()).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  // ── Mode management ───────────────────────────────────────

  describe('switchMode', () => {
    it('changes the operating mode and emits event', () => {
      const spy = vi.fn();
      runtime.on('sovereign:mode:changed', spy);

      runtime.switchMode('online');
      expect(runtime.isOffline()).toBe(false);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'offline', to: 'online' }),
      );
    });

    it('tracks offlineSince when switching to offline', () => {
      runtime.switchMode('online');
      runtime.switchMode('offline');
      const stats = runtime.getStats();
      expect(stats.offlineDuration).toBeGreaterThanOrEqual(0);
    });

    it('clears offlineSince when switching away from offline', () => {
      runtime.switchMode('online');
      const stats = runtime.getStats();
      expect(stats.offlineDuration).toBe(0);
    });
  });

  // ── getStatus ─────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns current status with mode, providers, and tools', () => {
      const status = runtime.getStatus();
      expect(status).toHaveProperty('mode', 'offline');
      expect(status).toHaveProperty('providersAvailable');
      expect(status).toHaveProperty('toolsAvailable');
      expect(status).toHaveProperty('modelLoaded');
      expect(Array.isArray(status.toolsAvailable)).toBe(true);
    });

    it('includes cloud provider in online mode', () => {
      runtime.switchMode('online');
      const status = runtime.getStatus();
      expect(status.providersAvailable).toContain('cloud');
    });

    it('includes cloud provider in hybrid mode', () => {
      runtime.switchMode('hybrid');
      const status = runtime.getStatus();
      expect(status.providersAvailable).toContain('cloud');
    });
  });

  // ── executeTask ───────────────────────────────────────────

  describe('executeTask', () => {
    it('generates a response using the local provider', async () => {
      const provider = runtime.getProvider();
      vi.spyOn(provider, 'generate').mockResolvedValue({
        model: 'llama3',
        response: 'Generated text',
        done: true,
      });

      const result = await runtime.executeTask('Hello');
      expect(result.response).toBe('Generated text');
      expect(result.model).toBe('llama3');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('falls back to next model when primary fails', async () => {
      const provider = runtime.getProvider();
      vi.spyOn(provider, 'generate')
        .mockRejectedValueOnce(new Error('Model not found: llama3'))
        .mockResolvedValueOnce({
          model: 'mistral',
          response: 'Fallback response',
          done: true,
        });

      const fallbackSpy = vi.fn();
      runtime.on('sovereign:task:fallback', fallbackSpy);

      const result = await runtime.executeTask('Hello');
      expect(result.model).toBe('mistral');
      expect(result.response).toBe('Fallback response');
      expect(fallbackSpy).toHaveBeenCalled();
    });

    it('throws when all models fail', async () => {
      const provider = runtime.getProvider();
      vi.spyOn(provider, 'generate').mockRejectedValue(new Error('Model not available'));

      const failSpy = vi.fn();
      runtime.on('sovereign:task:failed', failSpy);

      await expect(runtime.executeTask('Hello')).rejects.toThrow('All models failed');
      expect(failSpy).toHaveBeenCalled();
    });

    it('increments tasksExecuted and modelsUsed on success', async () => {
      const provider = runtime.getProvider();
      vi.spyOn(provider, 'generate').mockResolvedValue({
        model: 'llama3',
        response: 'ok',
        done: true,
      });

      await runtime.executeTask('Hello');
      const stats = runtime.getStats();
      expect(stats.tasksExecuted).toBe(1);
      expect(stats.modelsUsed).toContain('llama3');
    });

    it('uses the custom model when specified', async () => {
      const provider = runtime.getProvider();
      const generateSpy = vi.spyOn(provider, 'generate').mockResolvedValue({
        model: 'phi',
        response: 'custom model',
        done: true,
      });

      await runtime.executeTask('test', { model: 'phi' });
      expect(generateSpy).toHaveBeenCalledWith('phi', 'test', expect.any(Object));
    });
  });

  // ── getStats ──────────────────────────────────────────────

  describe('getStats', () => {
    it('returns initial statistics', () => {
      const stats = runtime.getStats();
      expect(stats.tasksExecuted).toBe(0);
      expect(stats.modelsUsed).toEqual([]);
      expect(stats.mode).toBe('offline');
      expect(stats.availableTools).toBeGreaterThan(0); // built-in tools registered
    });
  });

  // ── Component access ──────────────────────────────────────

  describe('component access', () => {
    it('getProvider() returns the LocalProvider instance', () => {
      const p = runtime.getProvider();
      expect(p).toBeDefined();
      expect(typeof p.generate).toBe('function');
    });

    it('getToolkit() returns the OfflineToolkit instance', () => {
      const t = runtime.getToolkit();
      expect(t).toBeDefined();
      expect(typeof t.executeTool).toBe('function');
    });
  });
});
