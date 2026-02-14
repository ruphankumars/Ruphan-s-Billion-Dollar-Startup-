/**
 * ProactiveEngine — Unit Tests
 *
 * Tests proactive agent daemon: lifecycle, rules, context recording,
 * pattern analysis via bigram frequency, prediction generation, and action triggering.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProactiveEngine } from '../../../src/daemon/proactive-engine.js';

describe('ProactiveEngine', () => {
  let engine: ProactiveEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new ProactiveEngine({ minConfidence: 0.1, analysisIntervalMs: 1000 });
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('creates engine with default config when no config provided', () => {
      const defaultEngine = new ProactiveEngine();
      expect(defaultEngine.isRunning()).toBe(false);
      expect(defaultEngine.getStats().totalPatterns).toBe(0);
    });

    it('merges partial config with defaults', () => {
      const custom = new ProactiveEngine({ minConfidence: 0.8 });
      expect(custom.isRunning()).toBe(false);
      expect(custom.getStats().activeRules).toBe(0);
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('start / stop lifecycle', () => {
    it('starts the engine and emits started event', () => {
      const handler = vi.fn();
      engine.on('proactive:started', handler);

      engine.start();

      expect(engine.isRunning()).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('stops the engine and emits stopped event', () => {
      const handler = vi.fn();
      engine.on('proactive:stopped', handler);

      engine.start();
      engine.stop();

      expect(engine.isRunning()).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('calling start() twice does not double-start', () => {
      const handler = vi.fn();
      engine.on('proactive:started', handler);

      engine.start();
      engine.start();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('calling stop() when not running is a no-op', () => {
      const handler = vi.fn();
      engine.on('proactive:stopped', handler);

      engine.stop();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Rules ──────────────────────────────────────────────────

  describe('addRule / removeRule', () => {
    it('adds a rule and returns it with generated id and triggerCount 0', () => {
      const rule = engine.addRule({
        name: 'auto-save',
        condition: 'file-edit',
        action: 'save-file',
        priority: 10,
        enabled: true,
      });

      expect(rule.id).toMatch(/^rule-/);
      expect(rule.triggerCount).toBe(0);
      expect(rule.name).toBe('auto-save');
      expect(engine.getRules()).toHaveLength(1);
    });

    it('emits rule:added event', () => {
      const handler = vi.fn();
      engine.on('proactive:rule:added', handler);

      engine.addRule({
        name: 'test',
        condition: 'x',
        action: 'y',
        priority: 1,
        enabled: true,
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('removes a rule by id and returns true', () => {
      const rule = engine.addRule({
        name: 'temp',
        condition: 'c',
        action: 'a',
        priority: 1,
        enabled: true,
      });

      expect(engine.removeRule(rule.id)).toBe(true);
      expect(engine.getRules()).toHaveLength(0);
    });

    it('returns false when removing a non-existent rule', () => {
      expect(engine.removeRule('non-existent')).toBe(false);
    });
  });

  // ── Context Recording ─────────────────────────────────────

  describe('recordContext', () => {
    it('records context and emits event', () => {
      const handler = vi.fn();
      engine.on('proactive:context:recorded', handler);

      engine.recordContext({ action: 'file-edit', file: 'main.ts' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('evaluates rules against new context and increments triggerCount', () => {
      engine.addRule({
        name: 'detect-edit',
        condition: 'file-edit',
        action: 'auto-save',
        priority: 5,
        enabled: true,
      });

      engine.recordContext({ action: 'file-edit', file: 'index.ts' });

      const rules = engine.getRules();
      expect(rules[0].triggerCount).toBe(1);
    });

    it('does not trigger disabled rules', () => {
      engine.addRule({
        name: 'disabled-rule',
        condition: 'file-edit',
        action: 'auto-save',
        priority: 5,
        enabled: false,
      });

      engine.recordContext({ action: 'file-edit' });

      const rules = engine.getRules();
      expect(rules[0].triggerCount).toBe(0);
    });

    it('builds bigram counts from consecutive contexts', () => {
      engine.recordContext({ action: 'open' });
      engine.recordContext({ action: 'edit' });
      engine.recordContext({ action: 'open' });
      engine.recordContext({ action: 'edit' });

      // The bigram "open->edit" should appear twice, enough for pattern detection
      const patterns = engine.analyzePatterns();
      const openToEdit = patterns.find((p) => p.pattern === 'open->edit');
      expect(openToEdit).toBeDefined();
      expect(openToEdit!.triggerCount).toBe(2);
    });
  });

  // ── Pattern Analysis ──────────────────────────────────────

  describe('analyzePatterns', () => {
    it('returns empty array when no context recorded', () => {
      expect(engine.analyzePatterns()).toHaveLength(0);
    });

    it('detects bigram patterns above minConfidence', () => {
      // Record a repeated sequence so bigrams appear at least 2 times
      for (let i = 0; i < 4; i++) {
        engine.recordContext({ action: 'read' });
        engine.recordContext({ action: 'write' });
      }

      const patterns = engine.analyzePatterns();
      expect(patterns.length).toBeGreaterThan(0);
      const readToWrite = patterns.find((p) => p.pattern === 'read->write');
      expect(readToWrite).toBeDefined();
      expect(readToWrite!.confidence).toBeGreaterThan(0);
    });

    it('returns patterns sorted by confidence descending', () => {
      for (let i = 0; i < 5; i++) {
        engine.recordContext({ action: 'A' });
        engine.recordContext({ action: 'B' });
      }
      engine.recordContext({ action: 'C' });
      engine.recordContext({ action: 'D' });
      engine.recordContext({ action: 'C' });
      engine.recordContext({ action: 'D' });

      const patterns = engine.analyzePatterns();
      for (let i = 1; i < patterns.length; i++) {
        expect(patterns[i - 1].confidence).toBeGreaterThanOrEqual(patterns[i].confidence);
      }
    });

    it('detects key co-occurrence patterns when keys repeat', () => {
      for (let i = 0; i < 4; i++) {
        engine.recordContext({ action: 'edit', file: 'main.ts' });
      }

      const patterns = engine.analyzePatterns();
      const comboPattern = patterns.find((p) => p.pattern.startsWith('combo:'));
      expect(comboPattern).toBeDefined();
    });
  });

  // ── Prediction ─────────────────────────────────────────────

  describe('predictNeeds', () => {
    it('returns empty array with no context history', () => {
      expect(engine.predictNeeds()).toHaveLength(0);
    });

    it('generates predictions based on known bigrams', () => {
      // Build pattern: open -> edit repeats
      for (let i = 0; i < 4; i++) {
        engine.recordContext({ action: 'open' });
        engine.recordContext({ action: 'edit' });
      }

      engine.analyzePatterns();

      // Record "open" as the latest context, so prediction should suggest "edit"
      engine.recordContext({ action: 'open' });
      const predictions = engine.predictNeeds();
      expect(predictions.length).toBeGreaterThan(0);
      expect(predictions.some((p) => p.suggestedAction === 'edit')).toBe(true);
    });

    it('includes confidence score in predictions', () => {
      for (let i = 0; i < 3; i++) {
        engine.recordContext({ action: 'save' });
        engine.recordContext({ action: 'deploy' });
      }
      engine.analyzePatterns();
      engine.recordContext({ action: 'save' });

      const predictions = engine.predictNeeds();
      expect(predictions.length).toBeGreaterThan(0);
      for (const pred of predictions) {
        expect(pred.confidence).toBeGreaterThan(0);
        expect(pred.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  // ── Action Triggering ──────────────────────────────────────

  describe('triggerAction', () => {
    it('returns false for non-existent prediction', () => {
      expect(engine.triggerAction('non-existent')).toBe(false);
    });

    it('triggers action, emits event, and removes prediction', () => {
      for (let i = 0; i < 4; i++) {
        engine.recordContext({ action: 'save' });
        engine.recordContext({ action: 'deploy' });
      }
      engine.analyzePatterns();
      engine.recordContext({ action: 'save' });
      const predictions = engine.predictNeeds();
      expect(predictions.length).toBeGreaterThan(0);

      const handler = vi.fn();
      engine.on('proactive:action:triggered', handler);

      const predId = predictions[0].id;
      const result = engine.triggerAction(predId);

      expect(result).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
      // Prediction should be removed after triggering
      expect(engine.getPredictions().find((p) => p.id === predId)).toBeUndefined();
    });

    it('increments actionsTriggered stat', () => {
      for (let i = 0; i < 4; i++) {
        engine.recordContext({ action: 'X' });
        engine.recordContext({ action: 'Y' });
      }
      engine.analyzePatterns();
      engine.recordContext({ action: 'X' });
      const predictions = engine.predictNeeds();

      const before = engine.getStats().totalActionsTriggered;
      engine.triggerAction(predictions[0].id);
      expect(engine.getStats().totalActionsTriggered).toBe(before + 1);
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zeroed stats when engine is fresh', () => {
      const stats = engine.getStats();
      expect(stats.totalPatterns).toBe(0);
      expect(stats.totalPredictions).toBe(0);
      expect(stats.totalActionsTriggered).toBe(0);
      expect(stats.avgConfidence).toBe(0);
      expect(stats.activeRules).toBe(0);
    });

    it('counts active (enabled) rules only', () => {
      engine.addRule({ name: 'a', condition: 'x', action: 'y', priority: 1, enabled: true });
      engine.addRule({ name: 'b', condition: 'x', action: 'y', priority: 1, enabled: false });

      expect(engine.getStats().activeRules).toBe(1);
    });

    it('computes avgConfidence across detected patterns', () => {
      for (let i = 0; i < 4; i++) {
        engine.recordContext({ action: 'A' });
        engine.recordContext({ action: 'B' });
      }
      engine.analyzePatterns();

      const stats = engine.getStats();
      expect(stats.totalPatterns).toBeGreaterThan(0);
      expect(stats.avgConfidence).toBeGreaterThan(0);
    });
  });
});
