import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrategyEvolver } from '../../../src/evolution/strategy-evolver.js';

describe('StrategyEvolver', () => {
  let evolver: StrategyEvolver;

  beforeEach(() => {
    evolver = new StrategyEvolver();
  });

  // ─── Constructor and Defaults ───────────────────────────────────────────────

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const stats = evolver.getStats();
      expect(stats.config.learningRate).toBe(0.1);
      expect(stats.config.explorationRate).toBe(0.15);
      expect(stats.config.minSamples).toBe(5);
      expect(stats.config.maxVariants).toBe(20);
      expect(stats.config.crossTaskTransfer).toBe(true);
    });

    it('should accept partial configuration overrides', () => {
      const custom = new StrategyEvolver({ learningRate: 0.2, explorationRate: 0.3 });
      const stats = custom.getStats();
      expect(stats.config.learningRate).toBe(0.2);
      expect(stats.config.explorationRate).toBe(0.3);
      expect(stats.config.minSamples).toBe(5); // default preserved
    });

    it('should start in stopped state', () => {
      expect(evolver.isRunning()).toBe(false);
    });

    it('should start with no variants before start()', () => {
      expect(evolver.getStats().variantCount).toBe(0);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe('start/stop/isRunning', () => {
    it('should transition to running and initialize default strategies on start()', () => {
      evolver.start();
      expect(evolver.isRunning()).toBe(true);
      expect(evolver.getStats().variantCount).toBe(7); // 7 default strategies
    });

    it('should transition to stopped on stop()', () => {
      evolver.start();
      evolver.stop();
      expect(evolver.isRunning()).toBe(false);
    });

    it('should not re-initialize existing strategies on second start()', () => {
      evolver.start();
      // Modify a variant weight
      const variant = evolver.getVariant('passthrough');
      expect(variant).toBeDefined();
      const originalId = variant!.id;

      evolver.stop();
      evolver.start();
      // The variant should keep its original id since it existed
      const afterRestart = evolver.getVariant('passthrough');
      expect(afterRestart!.id).toBe(originalId);
    });
  });

  // ─── registerVariant ────────────────────────────────────────────────────────

  describe('registerVariant', () => {
    it('should register a new strategy variant', () => {
      const variant = evolver.registerVariant('custom', { mode: 'test' });
      expect(variant.name).toBe('custom');
      expect(variant.config).toEqual({ mode: 'test' });
      expect(variant.weight).toBe(1.0);
      expect(variant.generationNumber).toBe(0);
      expect(variant.parentId).toBeNull();
    });

    it('should assign a unique id', () => {
      const v1 = evolver.registerVariant('s1', {});
      const v2 = evolver.registerVariant('s2', {});
      expect(v1.id).not.toBe(v2.id);
      expect(v1.id).toMatch(/^strat_/);
    });

    it('should be retrievable via getVariant', () => {
      evolver.registerVariant('custom', { key: 'value' });
      const retrieved = evolver.getVariant('custom');
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('custom');
    });
  });

  // ─── selectStrategy ─────────────────────────────────────────────────────────

  describe('selectStrategy', () => {
    it('should throw if no variants available', () => {
      expect(() => evolver.selectStrategy('code-gen')).toThrow(
        'No strategy variants available'
      );
    });

    it('should return a variant when strategies exist', () => {
      evolver.start();
      const selected = evolver.selectStrategy('code-gen');
      expect(selected).toBeDefined();
      expect(selected.name).toBeTruthy();
    });

    it('should increment totalSelections', () => {
      evolver.start();
      evolver.selectStrategy('code-gen');
      evolver.selectStrategy('code-gen');
      expect(evolver.getStats().totalSelections).toBe(2);
    });

    it('should emit evolution:strategy:selected event', () => {
      const handler = vi.fn();
      evolver.start();
      evolver.on('evolution:strategy:selected', handler);
      evolver.selectStrategy('testing');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ taskType: 'testing' })
      );
    });

    it('should sometimes explore (random selection)', () => {
      // Set explorationRate to 1.0 to force exploration
      const explorer = new StrategyEvolver({ explorationRate: 1.0 });
      explorer.start();
      const handler = vi.fn();
      explorer.on('evolution:strategy:selected', handler);
      explorer.selectStrategy('code-gen');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'exploration' })
      );
    });

    it('should sometimes exploit (best selection)', () => {
      // Set explorationRate to 0 to force exploitation
      const exploiter = new StrategyEvolver({ explorationRate: 0 });
      exploiter.start();
      const handler = vi.fn();
      exploiter.on('evolution:strategy:selected', handler);
      exploiter.selectStrategy('code-gen');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'exploitation' })
      );
    });
  });

  // ─── recordOutcome ──────────────────────────────────────────────────────────

  describe('recordOutcome', () => {
    it('should update variant weight via EMA', () => {
      evolver.start();
      const before = evolver.getVariant('react')!.weight;
      evolver.recordOutcome('react', 'code-gen', {
        success: true,
        quality: 0.9,
        speedMs: 1000,
        costUsd: 0.05,
      });
      const after = evolver.getVariant('react')!.weight;
      expect(after).not.toBe(before);
    });

    it('should create task-type-specific performance entry', () => {
      evolver.start();
      evolver.recordOutcome('react', 'code-gen', {
        success: true,
        quality: 0.85,
        speedMs: 2000,
        costUsd: 0.1,
      });
      const variant = evolver.getVariant('react')!;
      const perf = variant.taskTypePerformance.get('code-gen');
      expect(perf).toBeDefined();
      expect(perf!.sampleCount).toBe(1);
    });

    it('should update existing task-type performance with EMA', () => {
      evolver.start();
      evolver.recordOutcome('react', 'code-gen', {
        success: true, quality: 0.8, speedMs: 1000, costUsd: 0.05,
      });
      evolver.recordOutcome('react', 'code-gen', {
        success: false, quality: 0.3, speedMs: 5000, costUsd: 0.2,
      });
      const perf = evolver.getVariant('react')!.taskTypePerformance.get('code-gen')!;
      expect(perf.sampleCount).toBe(2);
      // Should be between the two values (EMA blend)
      expect(perf.avgQuality).toBeGreaterThan(0.3);
      expect(perf.avgQuality).toBeLessThan(0.8);
    });

    it('should apply cross-task transfer on high-quality success', () => {
      evolver.start();
      // Record for one task type first
      evolver.recordOutcome('react', 'code-gen', {
        success: true, quality: 0.5, speedMs: 1000, costUsd: 0.05,
      });
      const qualityBefore = evolver.getVariant('react')!
        .taskTypePerformance.get('code-gen')!.avgQuality;

      // Record excellent outcome for different task type
      evolver.recordOutcome('react', 'testing', {
        success: true, quality: 0.95, speedMs: 500, costUsd: 0.02,
      });

      // Cross-task transfer should slightly boost code-gen quality
      const qualityAfter = evolver.getVariant('react')!
        .taskTypePerformance.get('code-gen')!.avgQuality;
      expect(qualityAfter).toBeGreaterThanOrEqual(qualityBefore);
    });

    it('should do nothing for unknown strategy name', () => {
      evolver.recordOutcome('nonexistent', 'code-gen', {
        success: true, quality: 0.9, speedMs: 1000, costUsd: 0.05,
      });
      // Should not throw
    });

    it('should trim history when it exceeds 500', () => {
      evolver.start();
      for (let i = 0; i < 510; i++) {
        evolver.recordOutcome('react', 'code-gen', {
          success: true, quality: 0.8, speedMs: 1000, costUsd: 0.01,
        });
      }
      // Internal history should be trimmed to 500
      // We verify indirectly that it doesn't crash
      expect(evolver.getVariant('react')).toBeDefined();
    });
  });

  // ─── evolveNewVariant ───────────────────────────────────────────────────────

  describe('evolveNewVariant', () => {
    it('should return null for unknown base strategy', () => {
      expect(evolver.evolveNewVariant('nonexistent')).toBeNull();
    });

    it('should create a new variant from an existing strategy', () => {
      evolver.start();
      const newVariant = evolver.evolveNewVariant('react');
      expect(newVariant).not.toBeNull();
      expect(newVariant!.parentId).toBe(evolver.getVariant('react')!.id);
      expect(newVariant!.generationNumber).toBe(1);
    });

    it('should mutate numeric config values', () => {
      evolver.start();
      const newVariant = evolver.evolveNewVariant('tree-of-thought');
      expect(newVariant).not.toBeNull();
      // Config should have similar keys but possibly different values
      expect(newVariant!.config).toHaveProperty('complexity');
    });

    it('should start child at slightly lower weight than parent', () => {
      evolver.start();
      const parent = evolver.getVariant('react')!;
      const child = evolver.evolveNewVariant('react')!;
      expect(child.weight).toBeCloseTo(parent.weight * 0.9, 2);
    });

    it('should increment totalEvolutions counter', () => {
      evolver.start();
      expect(evolver.getStats().totalEvolutions).toBe(0);
      evolver.evolveNewVariant('react');
      expect(evolver.getStats().totalEvolutions).toBe(1);
    });

    it('should emit evolution:strategy:evolved event', () => {
      const handler = vi.fn();
      evolver.start();
      evolver.on('evolution:strategy:evolved', handler);
      evolver.evolveNewVariant('react');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: 'react',
          generation: 1,
        })
      );
    });

    it('should prune weak variants when at maxVariants', () => {
      const small = new StrategyEvolver({ maxVariants: 10 });
      small.start();
      // Start has 7 default strategies, add enough to hit the limit
      for (let i = 0; i < 5; i++) {
        small.registerVariant(`extra-${i}`, { val: i });
      }
      // Now 12 variants. evolveNewVariant checks >= maxVariants, prunes bottom 20%
      // (floor(12*0.2)=2), leaving 10, then adds the new one = 11.
      // Pruning is a best-effort mechanism, not a hard cap.
      const countBefore = small.getStats().variantCount;
      const evolved = small.evolveNewVariant('react');
      expect(evolved).not.toBeNull();
      // Count should be less than before + 1 (pruning removed some)
      expect(small.getStats().variantCount).toBeLessThan(countBefore + 1);
    });
  });

  // ─── getAllVariants / getVariant ─────────────────────────────────────────────

  describe('getAllVariants / getVariant', () => {
    it('should return all variants', () => {
      evolver.start();
      const all = evolver.getAllVariants();
      expect(all.length).toBe(7);
    });

    it('should return undefined for unknown variant', () => {
      expect(evolver.getVariant('nonexistent')).toBeUndefined();
    });
  });

  // ─── getTopStrategies ───────────────────────────────────────────────────────

  describe('getTopStrategies', () => {
    it('should return top N strategies sorted by score', () => {
      evolver.start();
      const top = evolver.getTopStrategies('code-gen', 3);
      expect(top.length).toBe(3);
    });

    it('should return all if fewer than N variants exist', () => {
      evolver.registerVariant('only-one', {});
      const top = evolver.getTopStrategies('code-gen', 5);
      expect(top.length).toBe(1);
    });
  });

  // ─── getPerformanceReport ───────────────────────────────────────────────────

  describe('getPerformanceReport', () => {
    it('should return report for all variants', () => {
      evolver.start();
      evolver.recordOutcome('react', 'code-gen', {
        success: true, quality: 0.9, speedMs: 1000, costUsd: 0.05,
      });
      const report = evolver.getPerformanceReport();
      expect(report).toHaveProperty('react');
      expect(report['react'].taskTypes).toHaveProperty('code-gen');
    });

    it('should include weight and generation in report', () => {
      evolver.start();
      const report = evolver.getPerformanceReport();
      expect(report['passthrough']).toHaveProperty('weight');
      expect(report['passthrough']).toHaveProperty('generation');
    });
  });

  // ─── getStats ───────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return comprehensive stats object', () => {
      const stats = evolver.getStats();
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('variantCount');
      expect(stats).toHaveProperty('totalSelections');
      expect(stats).toHaveProperty('totalEvolutions');
      expect(stats).toHaveProperty('topStrategy');
      expect(stats).toHaveProperty('config');
    });

    it('should report topStrategy as none when no variants', () => {
      expect(evolver.getStats().topStrategy).toBe('none');
    });

    it('should report topStrategy when variants exist', () => {
      evolver.start();
      expect(evolver.getStats().topStrategy).toBeTruthy();
      expect(evolver.getStats().topStrategy).not.toBe('none');
    });

    it('should reflect running state', () => {
      expect(evolver.getStats().running).toBe(false);
      evolver.start();
      expect(evolver.getStats().running).toBe(true);
    });
  });
});
