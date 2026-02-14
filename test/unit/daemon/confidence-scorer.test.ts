import { describe, it, expect, beforeEach } from 'vitest';
import { ConfidenceScorer } from '../../../src/daemon/confidence-scorer.js';
import type { CriticReport } from '../../../src/daemon/types.js';

describe('ConfidenceScorer', () => {
  let scorer: ConfidenceScorer;

  beforeEach(() => {
    scorer = new ConfidenceScorer();
  });

  describe('score()', () => {
    it('returns a ConfidenceScore', () => {
      const result = scorer.score({
        testsPassed: true,
        testsRun: 10,
        lintPassed: true,
        typeCheckPassed: true,
      });

      expect(result).toBeDefined();
      expect(typeof result.overall).toBe('number');
      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(1);
      expect(result.breakdown).toBeDefined();
      expect(result.factors).toBeDefined();
      expect(Array.isArray(result.factors)).toBe(true);
    });

    it('returns 0 overall when no context is provided', () => {
      const result = scorer.score({});
      expect(result.overall).toBe(0);
      expect(result.factors).toHaveLength(0);
    });

    it('includes all available factors', () => {
      const result = scorer.score({
        testsPassed: true,
        testsRun: 5,
        lintPassed: true,
        typeCheckPassed: true,
        iterationsUsed: 2,
        maxIterations: 10,
        filesChanged: [
          { path: 'a.ts', content: 'code', linesAdded: 10, linesRemoved: 5 },
        ],
        prompt: 'Fix the bug',
        response: 'I have fixed the bug by updating the handler.',
      });

      expect(result.factors.length).toBeGreaterThanOrEqual(5);
      const names = result.factors.map((f) => f.name);
      expect(names).toContain('tests');
      expect(names).toContain('lint');
      expect(names).toContain('typeCheck');
      expect(names).toContain('efficiency');
      expect(names).toContain('changeSize');
    });
  });

  describe('scoreTestCoverage()', () => {
    it('returns high score for passed tests', () => {
      const factor = scorer.scoreTestCoverage(true, 10);
      expect(factor.name).toBe('tests');
      expect(factor.score).toBeGreaterThan(0.7);
      expect(factor.reason).toContain('passed');
    });

    it('returns low score for failed tests', () => {
      const factor = scorer.scoreTestCoverage(false, 10);
      expect(factor.name).toBe('tests');
      expect(factor.score).toBe(0.1);
      expect(factor.reason).toContain('failed');
    });

    it('returns moderate score when no tests run', () => {
      const factor = scorer.scoreTestCoverage(false, 0);
      expect(factor.name).toBe('tests');
      expect(factor.score).toBe(0.3);
      expect(factor.reason).toContain('No tests');
    });

    it('score increases with number of tests', () => {
      const few = scorer.scoreTestCoverage(true, 2);
      const many = scorer.scoreTestCoverage(true, 50);
      expect(many.score).toBeGreaterThanOrEqual(few.score);
    });
  });

  describe('scoreLintCompliance()', () => {
    it('returns high score when lint passes', () => {
      const factor = scorer.scoreLintCompliance(true);
      expect(factor.name).toBe('lint');
      expect(factor.score).toBe(1.0);
      expect(factor.reason).toContain('passed');
    });

    it('returns low score when lint fails', () => {
      const factor = scorer.scoreLintCompliance(false);
      expect(factor.name).toBe('lint');
      expect(factor.score).toBe(0.2);
      expect(factor.reason).toContain('failed');
    });
  });

  describe('scoreTypeCheck()', () => {
    it('returns high score when type check passes', () => {
      const factor = scorer.scoreTypeCheck(true);
      expect(factor.name).toBe('typeCheck');
      expect(factor.score).toBe(1.0);
      expect(factor.reason).toContain('passed');
    });

    it('returns low score when type check fails', () => {
      const factor = scorer.scoreTypeCheck(false);
      expect(factor.name).toBe('typeCheck');
      expect(factor.score).toBe(0.1);
      expect(factor.reason).toContain('failed');
    });
  });

  describe('scoreEfficiency()', () => {
    it('returns high score for low iteration usage (<= 25%)', () => {
      const factor = scorer.scoreEfficiency(2, 10);
      expect(factor.name).toBe('efficiency');
      expect(factor.score).toBe(1.0);
      expect(factor.reason).toContain('efficiently');
    });

    it('returns moderate score for 25-50% usage', () => {
      const factor = scorer.scoreEfficiency(4, 10);
      expect(factor.name).toBe('efficiency');
      expect(factor.score).toBe(0.85);
    });

    it('returns lower score for 50-75% usage', () => {
      const factor = scorer.scoreEfficiency(6, 10);
      expect(factor.name).toBe('efficiency');
      expect(factor.score).toBe(0.6);
    });

    it('returns low score for 75-100% usage', () => {
      const factor = scorer.scoreEfficiency(9, 10);
      expect(factor.name).toBe('efficiency');
      expect(factor.score).toBe(0.35);
    });

    it('returns very low score when budget exhausted', () => {
      const factor = scorer.scoreEfficiency(10, 10);
      expect(factor.name).toBe('efficiency');
      expect(factor.score).toBe(0.1);
      expect(factor.reason).toContain('Exhausted');
    });

    it('handles zero max iterations', () => {
      const factor = scorer.scoreEfficiency(0, 0);
      expect(factor.score).toBe(0.5);
      expect(factor.reason).toContain('Invalid');
    });
  });

  describe('scoreChangeSize()', () => {
    it('returns high score for small changes', () => {
      const factor = scorer.scoreChangeSize(2, 30, 10);
      expect(factor.name).toBe('changeSize');
      expect(factor.score).toBe(1.0);
      expect(factor.reason).toContain('Small');
    });

    it('returns moderate score for medium changes', () => {
      const factor = scorer.scoreChangeSize(5, 200, 100);
      expect(factor.name).toBe('changeSize');
      expect(factor.score).toBe(0.8);
      expect(factor.reason).toContain('Moderate');
    });

    it('returns low score for very large changes', () => {
      const factor = scorer.scoreChangeSize(20, 1000, 800);
      expect(factor.name).toBe('changeSize');
      expect(factor.score).toBe(0.3);
      expect(factor.reason).toContain('Very large');
    });

    it('returns low score when no files changed', () => {
      const factor = scorer.scoreChangeSize(0, 0, 0);
      expect(factor.score).toBe(0.3);
      expect(factor.reason).toContain('No files');
    });
  });

  describe('getDefaultWeights()', () => {
    it('returns expected weights', () => {
      const weights = scorer.getDefaultWeights();
      expect(weights).toBeDefined();
      expect(weights.tests).toBe(0.25);
      expect(weights.lint).toBe(0.15);
      expect(weights.typeCheck).toBe(0.15);
      expect(weights.critic).toBe(0.20);
      expect(weights.efficiency).toBe(0.10);
      expect(weights.changeSize).toBe(0.05);
      expect(weights.responseQuality).toBe(0.10);

      // Should sum to 1.0
      const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(1.0, 5);
    });
  });
});
