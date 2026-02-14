import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConvergenceDetector } from '../../../src/evolution/convergence-detector.js';

describe('ConvergenceDetector', () => {
  let detector: ConvergenceDetector;

  beforeEach(() => {
    detector = new ConvergenceDetector();
  });

  // ─── Constructor and Defaults ───────────────────────────────────────────────

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const stats = detector.getStats();
      expect(stats.config.similarityThreshold).toBe(0.98);
      expect(stats.config.minIterations).toBe(2);
      expect(stats.config.stabilityWindow).toBe(3);
      expect(stats.config.method).toBe('jaccard');
    });

    it('should accept partial configuration overrides', () => {
      const custom = new ConvergenceDetector({
        similarityThreshold: 0.9,
        method: 'cosine',
      });
      const stats = custom.getStats();
      expect(stats.config.similarityThreshold).toBe(0.9);
      expect(stats.config.method).toBe('cosine');
      expect(stats.config.minIterations).toBe(2); // default preserved
    });

    it('should start in stopped state', () => {
      expect(detector.isRunning()).toBe(false);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe('start/stop/isRunning', () => {
    it('should transition to running on start()', () => {
      detector.start();
      expect(detector.isRunning()).toBe(true);
    });

    it('should transition to stopped and clear histories on stop()', () => {
      detector.start();
      detector.check('task-1', 'hello world this is a test', 'hello world this is a test', 5);
      detector.stop();
      expect(detector.isRunning()).toBe(false);
      // Histories are cleared on stop
      expect(detector.getStats().trackedTasks).toBe(0);
    });

    it('should handle multiple start/stop cycles', () => {
      detector.start();
      detector.stop();
      detector.start();
      expect(detector.isRunning()).toBe(true);
    });
  });

  // ─── check ──────────────────────────────────────────────────────────────────

  describe('check', () => {
    it('should return converged=false when similarity is below threshold', () => {
      const result = detector.check('task-1', 'hello world', 'goodbye universe', 5);
      expect(result.converged).toBe(false);
      expect(result.similarity).toBeGreaterThanOrEqual(0);
      expect(result.similarity).toBeLessThan(1);
    });

    it('should return converged=true for identical strings above minIterations with stable history', () => {
      const d = new ConvergenceDetector({
        similarityThreshold: 0.95,
        minIterations: 1,
        stabilityWindow: 2,
      });
      // Build a stable history
      d.check('task-1', 'exact same text', 'exact same text', 2);
      const result = d.check('task-1', 'exact same text', 'exact same text', 3);
      expect(result.converged).toBe(true);
      expect(result.similarity).toBe(1);
    });

    it('should not converge below minIterations even with identical content', () => {
      const d = new ConvergenceDetector({
        similarityThreshold: 0.9,
        minIterations: 10,
        stabilityWindow: 2,
      });
      // Build enough stability history
      d.check('task-1', 'same', 'same', 0);
      const result = d.check('task-1', 'same', 'same', 1);
      // iteration 1 < minIterations 10
      expect(result.converged).toBe(false);
    });

    it('should track similarity history', () => {
      detector.check('task-1', 'alpha', 'beta', 1);
      detector.check('task-1', 'gamma', 'delta', 2);
      const result = detector.check('task-1', 'epsilon', 'zeta', 3);
      expect(result.history.length).toBe(3);
    });

    it('should trim history when it exceeds 50 entries', () => {
      for (let i = 0; i < 55; i++) {
        detector.check('task-1', `text-${i}`, `text-${i + 1}`, i);
      }
      const result = detector.check('task-1', 'a', 'b', 56);
      expect(result.history.length).toBeLessThanOrEqual(51);
    });

    it('should increment checksPerformed counter', () => {
      expect(detector.getStats().checksPerformed).toBe(0);
      detector.check('task-1', 'a', 'b', 1);
      expect(detector.getStats().checksPerformed).toBe(1);
      detector.check('task-2', 'c', 'd', 1);
      expect(detector.getStats().checksPerformed).toBe(2);
    });

    it('should emit evolution:converged event on convergence', () => {
      const handler = vi.fn();
      const d = new ConvergenceDetector({
        similarityThreshold: 0.9,
        minIterations: 1,
        stabilityWindow: 2,
      });
      d.on('evolution:converged', handler);

      d.check('task-1', 'same text here now', 'same text here now', 2);
      d.check('task-1', 'same text here now', 'same text here now', 3);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-1',
          method: 'jaccard',
        })
      );
    });

    it('should track convergencesDetected counter', () => {
      const d = new ConvergenceDetector({
        similarityThreshold: 0.9,
        minIterations: 1,
        stabilityWindow: 2,
      });
      d.check('task-1', 'same content here', 'same content here', 2);
      d.check('task-1', 'same content here', 'same content here', 3);

      expect(d.getStats().convergencesDetected).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── computeSimilarity ──────────────────────────────────────────────────────

  describe('computeSimilarity', () => {
    it('should return 1 for identical strings', () => {
      expect(detector.computeSimilarity('hello world', 'hello world')).toBe(1);
    });

    it('should return 0 for empty vs non-empty string', () => {
      expect(detector.computeSimilarity('', 'hello')).toBe(0);
      expect(detector.computeSimilarity('hello', '')).toBe(0);
    });

    it('should return similarity between 0 and 1 for different strings', () => {
      // Use longer strings so word-trigram Jaccard has overlapping n-grams
      const sim = detector.computeSimilarity(
        'the quick brown fox jumps over the lazy dog near the river bank today',
        'the quick brown cat jumps over the lazy dog near the river bank today'
      );
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });

    it('should work with cosine method', () => {
      const d = new ConvergenceDetector({ method: 'cosine' });
      const sim = d.computeSimilarity('hello world foo bar', 'hello world foo bar');
      expect(sim).toBe(1);

      const diffSim = d.computeSimilarity('hello world', 'goodbye universe');
      expect(diffSim).toBeGreaterThanOrEqual(0);
    });

    it('should work with levenshtein method', () => {
      const d = new ConvergenceDetector({ method: 'levenshtein' });
      const sim = d.computeSimilarity('kitten', 'sitting');
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);

      expect(d.computeSimilarity('same', 'same')).toBe(1);
    });
  });

  // ─── checkPopulation ────────────────────────────────────────────────────────

  describe('checkPopulation', () => {
    it('should return converged=true for a single candidate', () => {
      const result = detector.checkPopulation('task-1', ['only one']);
      expect(result.converged).toBe(true);
      expect(result.similarity).toBe(1);
    });

    it('should return converged=true for identical candidates', () => {
      const result = detector.checkPopulation('task-1', [
        'same text content here',
        'same text content here',
        'same text content here',
      ]);
      expect(result.converged).toBe(true);
      expect(result.similarity).toBe(1);
    });

    it('should return converged=false for very different candidates', () => {
      const result = detector.checkPopulation('task-1', [
        'the quick brown fox jumps over the lazy dog near the river',
        'an entirely different and unrelated sentence about something else entirely new',
        'yet another completely unique phrase that shares nothing with the previous ones',
      ]);
      expect(result.converged).toBe(false);
      expect(result.similarity).toBeLessThan(0.98);
    });

    it('should track population history separately with pop_ prefix', () => {
      detector.checkPopulation('task-1', ['a', 'b']);
      detector.checkPopulation('task-1', ['c', 'd']);
      // Both the pop_ history should be tracked
      expect(detector.getStats().trackedTasks).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── hash ───────────────────────────────────────────────────────────────────

  describe('hash', () => {
    it('should return a 16-character hex string', () => {
      const h = detector.hash('hello world');
      expect(h).toHaveLength(16);
      expect(h).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should return same hash for same content', () => {
      expect(detector.hash('test')).toBe(detector.hash('test'));
    });

    it('should return different hashes for different content', () => {
      expect(detector.hash('aaa')).not.toBe(detector.hash('bbb'));
    });
  });

  // ─── clearHistory ───────────────────────────────────────────────────────────

  describe('clearHistory', () => {
    it('should clear both task and population history', () => {
      detector.check('task-1', 'a', 'b', 1);
      detector.checkPopulation('task-1', ['x', 'y']);
      const beforeClear = detector.getStats().trackedTasks;
      expect(beforeClear).toBeGreaterThanOrEqual(1);

      detector.clearHistory('task-1');
      // Both histories cleared, trackedTasks should decrease
      expect(detector.getStats().trackedTasks).toBeLessThan(beforeClear);
    });

    it('should not affect other tasks', () => {
      detector.check('task-1', 'a', 'b', 1);
      detector.check('task-2', 'c', 'd', 1);
      detector.clearHistory('task-1');
      expect(detector.getStats().trackedTasks).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── getStats ───────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return comprehensive stats object', () => {
      const stats = detector.getStats();
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('trackedTasks');
      expect(stats).toHaveProperty('checksPerformed');
      expect(stats).toHaveProperty('convergencesDetected');
      expect(stats).toHaveProperty('convergenceRate');
      expect(stats).toHaveProperty('config');
    });

    it('should compute convergenceRate as 0 when no checks performed', () => {
      expect(detector.getStats().convergenceRate).toBe(0);
    });

    it('should reflect running state', () => {
      expect(detector.getStats().running).toBe(false);
      detector.start();
      expect(detector.getStats().running).toBe(true);
    });
  });
});
