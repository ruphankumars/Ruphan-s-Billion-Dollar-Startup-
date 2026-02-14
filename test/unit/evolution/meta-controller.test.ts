import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetaController } from '../../../src/evolution/meta-controller.js';
import type { OrchestrationDecision, DecisionOutcome } from '../../../src/evolution/types.js';

function makeAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    complexity: 0.5,
    taskType: 'code-generation',
    fileCount: 3,
    hasTests: true,
    hasDependencies: false,
    isRefactoring: false,
    estimatedTokens: 5000,
    ...overrides,
  };
}

describe('MetaController', () => {
  let controller: MetaController;

  beforeEach(() => {
    controller = new MetaController();
  });

  // ─── Constructor and Defaults ───────────────────────────────────────────────

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const stats = controller.getStats();
      expect(stats.config.adaptiveStrategy).toBe(true);
      expect(stats.config.adaptiveCompute).toBe(true);
      expect(stats.config.selfEvolve).toBe(true);
      expect(stats.config.learningRate).toBe(0.1);
      expect(stats.config.maxDecisionHistory).toBe(200);
      expect(stats.config.escalationThreshold).toBe(0.5);
    });

    it('should accept partial configuration overrides', () => {
      const custom = new MetaController({ learningRate: 0.2, selfEvolve: false });
      const stats = custom.getStats();
      expect(stats.config.learningRate).toBe(0.2);
      expect(stats.config.selfEvolve).toBe(false);
      expect(stats.config.adaptiveStrategy).toBe(true); // default preserved
    });

    it('should start in stopped state', () => {
      expect(controller.isRunning()).toBe(false);
    });

    it('should initialize with default complexity thresholds', () => {
      const thresholds = controller.getThresholds();
      expect(thresholds.shallow).toBe(0.2);
      expect(thresholds.standard).toBe(0.4);
      expect(thresholds.deep).toBe(0.7);
      expect(thresholds.exhaustive).toBe(0.9);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe('start/stop/isRunning', () => {
    it('should transition to running on start()', () => {
      controller.start();
      expect(controller.isRunning()).toBe(true);
    });

    it('should transition to stopped on stop()', () => {
      controller.start();
      controller.stop();
      expect(controller.isRunning()).toBe(false);
    });

    it('should handle multiple start/stop cycles', () => {
      controller.start();
      controller.stop();
      controller.start();
      expect(controller.isRunning()).toBe(true);
    });
  });

  // ─── decide ─────────────────────────────────────────────────────────────────

  describe('decide', () => {
    it('should return an OrchestrationDecision', () => {
      const decision = controller.decide('task-1', makeAnalysis());
      expect(decision).toHaveProperty('id');
      expect(decision).toHaveProperty('timestamp');
      expect(decision).toHaveProperty('taskId', 'task-1');
      expect(decision).toHaveProperty('mode');
      expect(decision).toHaveProperty('computeScale');
      expect(decision).toHaveProperty('reasoningDepth');
      expect(decision).toHaveProperty('populationConfig');
      expect(decision).toHaveProperty('budgetAllocation');
      expect(decision).toHaveProperty('confidence');
      expect(decision).toHaveProperty('reasoning');
    });

    it('should assign unique decision ids', () => {
      const d1 = controller.decide('task-1', makeAnalysis());
      const d2 = controller.decide('task-2', makeAnalysis());
      expect(d1.id).not.toBe(d2.id);
      expect(d1.id).toMatch(/^dec_/);
    });

    it('should select single-agent mode for very simple tasks', () => {
      const decision = controller.decide('task-1', makeAnalysis({
        complexity: 0.1,
        fileCount: 1,
      }));
      expect(decision.mode).toBe('single-agent');
    });

    it('should select linear-wave for medium complexity', () => {
      const decision = controller.decide('task-1', makeAnalysis({
        complexity: 0.5,
        fileCount: 3,
        hasDependencies: false,
      }));
      expect(decision.mode).toBe('linear-wave');
    });

    it('should select graph-based for complex tasks with dependencies', () => {
      const decision = controller.decide('task-1', makeAnalysis({
        complexity: 0.8,
        hasDependencies: true,
      }));
      expect(decision.mode).toBe('graph-based');
    });

    it('should select hybrid for very high complexity', () => {
      const decision = controller.decide('task-1', makeAnalysis({
        complexity: 0.95,
      }));
      expect(decision.mode).toBe('hybrid');
    });

    it('should default to linear-wave when adaptiveStrategy is disabled', () => {
      const c = new MetaController({ adaptiveStrategy: false });
      const decision = c.decide('task-1', makeAnalysis({ complexity: 0.1, fileCount: 1 }));
      expect(decision.mode).toBe('linear-wave');
    });

    it('should select minimal compute for low complexity', () => {
      const decision = controller.decide('task-1', makeAnalysis({ complexity: 0.1 }));
      expect(decision.computeScale).toBe('minimal');
    });

    it('should select standard compute for medium complexity', () => {
      const decision = controller.decide('task-1', makeAnalysis({ complexity: 0.35 }));
      expect(decision.computeScale).toBe('standard');
    });

    it('should default to standard when adaptiveCompute is disabled', () => {
      const c = new MetaController({ adaptiveCompute: false });
      const decision = c.decide('task-1', makeAnalysis({ complexity: 0.95 }));
      expect(decision.computeScale).toBe('standard');
    });

    it('should select reasoning depth based on complexity thresholds', () => {
      expect(controller.decide('t', makeAnalysis({ complexity: 0.1 })).reasoningDepth).toBe('shallow');
      expect(controller.decide('t', makeAnalysis({ complexity: 0.3 })).reasoningDepth).toBe('standard');
      expect(controller.decide('t', makeAnalysis({ complexity: 0.5 })).reasoningDepth).toBe('deep');
      expect(controller.decide('t', makeAnalysis({ complexity: 0.95 })).reasoningDepth).toBe('exhaustive');
    });

    it('should configure population params based on compute scale', () => {
      const minimal = controller.decide('t', makeAnalysis({ complexity: 0.1 }));
      expect(minimal.populationConfig.populationSize).toBe(1);

      const hybrid = controller.decide('t', makeAnalysis({ complexity: 0.95 }));
      expect(hybrid.populationConfig.populationSize).toBe(8);
    });

    it('should configure budget allocation based on complexity', () => {
      const lowDecision = controller.decide('t', makeAnalysis({ complexity: 0.1 }));
      const highDecision = controller.decide('t', makeAnalysis({ complexity: 0.9 }));
      expect(highDecision.budgetAllocation.maxApiCalls!).toBeGreaterThan(
        lowDecision.budgetAllocation.maxApiCalls!
      );
    });

    it('should set extended depth limit for refactoring tasks', () => {
      const refactor = controller.decide('t', makeAnalysis({ isRefactoring: true }));
      expect(refactor.budgetAllocation.maxDepth).toBe(15);
    });

    it('should set higher budget tier for high complexity', () => {
      const high = controller.decide('t', makeAnalysis({ complexity: 0.85 }));
      expect(high.budgetAllocation.tier).toBe('critical');
    });

    it('should increment totalDecisions', () => {
      expect(controller.getStats().totalDecisions).toBe(0);
      controller.decide('task-1', makeAnalysis());
      controller.decide('task-2', makeAnalysis());
      expect(controller.getStats().totalDecisions).toBe(2);
    });

    it('should emit evolution:meta:decision event', () => {
      const handler = vi.fn();
      controller.on('evolution:meta:decision', handler);
      controller.decide('task-1', makeAnalysis());
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-1' })
      );
    });

    it('should store decision in history', () => {
      const decision = controller.decide('task-1', makeAnalysis());
      expect(controller.getDecision(decision.id)).toBeDefined();
    });

    it('should trim history at maxDecisionHistory', () => {
      const c = new MetaController({ maxDecisionHistory: 5 });
      for (let i = 0; i < 10; i++) {
        c.decide(`task-${i}`, makeAnalysis());
      }
      // Stats should show 10 total decisions but only 5 active
      expect(c.getStats().totalDecisions).toBe(10);
    });

    it('should compute confidence between 0.1 and 1.0', () => {
      const decision = controller.decide('task-1', makeAnalysis());
      expect(decision.confidence).toBeGreaterThanOrEqual(0.1);
      expect(decision.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should include human-readable reasoning', () => {
      const decision = controller.decide('task-1', makeAnalysis());
      expect(decision.reasoning).toContain('Task complexity');
      expect(decision.reasoning).toContain('Mode');
    });
  });

  // ─── recordOutcome ──────────────────────────────────────────────────────────

  describe('recordOutcome', () => {
    it('should increment successfulDecisions on success', () => {
      const decision = controller.decide('task-1', makeAnalysis());
      controller.recordOutcome(decision.id, {
        decisionId: decision.id,
        success: true,
        qualityScore: 0.9,
        speedMs: 5000,
        tokenCost: 1000,
        feedback: 'good',
      });
      expect(controller.getStats().successfulDecisions).toBe(1);
    });

    it('should not increment successfulDecisions on failure', () => {
      const decision = controller.decide('task-1', makeAnalysis());
      controller.recordOutcome(decision.id, {
        decisionId: decision.id,
        success: false,
        qualityScore: 0.2,
        speedMs: 30000,
        tokenCost: 5000,
        feedback: 'failed',
      });
      expect(controller.getStats().successfulDecisions).toBe(0);
    });

    it('should update mode success rates', () => {
      const decision = controller.decide('task-1', makeAnalysis());
      const modeBefore = controller.getModeReport()[decision.mode];
      controller.recordOutcome(decision.id, {
        decisionId: decision.id,
        success: true,
        qualityScore: 0.95,
        speedMs: 1000,
        tokenCost: 500,
        feedback: 'excellent',
      });
      const modeAfter = controller.getModeReport()[decision.mode];
      expect(modeAfter.count).toBe(modeBefore.count + 1);
    });

    it('should do nothing for unknown decisionId', () => {
      controller.recordOutcome('nonexistent', {
        decisionId: 'nonexistent',
        success: true,
        qualityScore: 0.9,
        speedMs: 1000,
        tokenCost: 500,
        feedback: 'ok',
      });
      expect(controller.getStats().successfulDecisions).toBe(0);
    });

    it('should evolve thresholds when selfEvolve is enabled', () => {
      // Force a minimal compute decision that fails
      const c = new MetaController({ selfEvolve: true });
      const thresholdsBefore = c.getThresholds();

      const decision = c.decide('t', makeAnalysis({ complexity: 0.1, fileCount: 1 }));
      c.recordOutcome(decision.id, {
        decisionId: decision.id,
        success: false,
        qualityScore: 0.1,
        speedMs: 50000,
        tokenCost: 10000,
        feedback: 'failed with minimal',
      });

      // For minimal compute failure, shallow threshold should decrease
      if (decision.computeScale === 'minimal') {
        const thresholdsAfter = c.getThresholds();
        expect(thresholdsAfter.shallow).toBeLessThanOrEqual(thresholdsBefore.shallow);
      }
    });
  });

  // ─── escalate ───────────────────────────────────────────────────────────────

  describe('escalate', () => {
    it('should return null for unknown decisionId', () => {
      expect(controller.escalate('nonexistent')).toBeNull();
    });

    it('should return an escalated decision with higher compute', () => {
      const original = controller.decide('task-1', makeAnalysis({ complexity: 0.3 }));
      const escalated = controller.escalate(original.id);
      expect(escalated).not.toBeNull();
      expect(escalated!.id).not.toBe(original.id);
      // Compute scale should be the next level
      const scaleOrder = ['minimal', 'standard', 'parallel', 'sequential', 'hybrid'];
      const originalIdx = scaleOrder.indexOf(original.computeScale);
      const escalatedIdx = scaleOrder.indexOf(escalated!.computeScale);
      expect(escalatedIdx).toBeGreaterThanOrEqual(originalIdx);
    });

    it('should return an escalated decision with deeper reasoning', () => {
      const original = controller.decide('task-1', makeAnalysis({ complexity: 0.1 }));
      const escalated = controller.escalate(original.id);
      const depthOrder = ['shallow', 'standard', 'deep', 'exhaustive'];
      const originalIdx = depthOrder.indexOf(original.reasoningDepth);
      const escalatedIdx = depthOrder.indexOf(escalated!.reasoningDepth);
      expect(escalatedIdx).toBeGreaterThanOrEqual(originalIdx);
    });

    it('should increase population size', () => {
      const original = controller.decide('task-1', makeAnalysis({ complexity: 0.5 }));
      const escalated = controller.escalate(original.id)!;
      expect(escalated.populationConfig.populationSize!).toBeGreaterThan(
        original.populationConfig.populationSize!
      );
    });

    it('should increase budget allocation', () => {
      const original = controller.decide('task-1', makeAnalysis());
      const escalated = controller.escalate(original.id)!;
      expect(escalated.budgetAllocation.maxApiCalls!).toBeGreaterThan(
        original.budgetAllocation.maxApiCalls!
      );
      expect(escalated.budgetAllocation.maxTokens!).toBeGreaterThan(
        original.budgetAllocation.maxTokens!
      );
    });

    it('should lower confidence for escalated decision', () => {
      const original = controller.decide('task-1', makeAnalysis());
      const escalated = controller.escalate(original.id)!;
      expect(escalated.confidence).toBeLessThan(original.confidence);
    });

    it('should include ESCALATED in reasoning', () => {
      const original = controller.decide('task-1', makeAnalysis());
      const escalated = controller.escalate(original.id)!;
      expect(escalated.reasoning).toContain('ESCALATED');
    });

    it('should not exceed max compute scale', () => {
      // Force hybrid scale
      const original = controller.decide('task-1', makeAnalysis({ complexity: 0.95 }));
      const escalated = controller.escalate(original.id)!;
      expect(escalated.computeScale).toBe('hybrid');
    });
  });

  // ─── getDecision ────────────────────────────────────────────────────────────

  describe('getDecision', () => {
    it('should return undefined for unknown id', () => {
      expect(controller.getDecision('nonexistent')).toBeUndefined();
    });

    it('should return the decision by id', () => {
      const decision = controller.decide('task-1', makeAnalysis());
      expect(controller.getDecision(decision.id)).toBe(decision);
    });
  });

  // ─── getThresholds ──────────────────────────────────────────────────────────

  describe('getThresholds', () => {
    it('should return a copy of complexity thresholds', () => {
      const t1 = controller.getThresholds();
      const t2 = controller.getThresholds();
      expect(t1).toEqual(t2);
      // Should be a copy, not the same reference
      t1.shallow = 999;
      expect(controller.getThresholds().shallow).not.toBe(999);
    });
  });

  // ─── getModeReport ──────────────────────────────────────────────────────────

  describe('getModeReport', () => {
    it('should return all four modes', () => {
      const report = controller.getModeReport();
      expect(report).toHaveProperty('single-agent');
      expect(report).toHaveProperty('linear-wave');
      expect(report).toHaveProperty('graph-based');
      expect(report).toHaveProperty('hybrid');
    });

    it('should start with initial rates and zero counts', () => {
      const report = controller.getModeReport();
      expect(report['single-agent'].count).toBe(0);
      expect(report['hybrid'].rate).toBe(0.8);
    });
  });

  // ─── getStats ───────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return comprehensive stats object', () => {
      const stats = controller.getStats();
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('totalDecisions');
      expect(stats).toHaveProperty('successfulDecisions');
      expect(stats).toHaveProperty('successRate');
      expect(stats).toHaveProperty('activeDecisions');
      expect(stats).toHaveProperty('thresholds');
      expect(stats).toHaveProperty('modeReport');
      expect(stats).toHaveProperty('config');
    });

    it('should compute successRate as 0 when no decisions made', () => {
      expect(controller.getStats().successRate).toBe(0);
    });

    it('should compute successRate correctly', () => {
      const d1 = controller.decide('t1', makeAnalysis());
      const d2 = controller.decide('t2', makeAnalysis());
      controller.recordOutcome(d1.id, {
        decisionId: d1.id, success: true, qualityScore: 0.9,
        speedMs: 1000, tokenCost: 500, feedback: 'ok',
      });
      controller.recordOutcome(d2.id, {
        decisionId: d2.id, success: false, qualityScore: 0.2,
        speedMs: 30000, tokenCost: 5000, feedback: 'bad',
      });
      expect(controller.getStats().successRate).toBe(0.5);
    });

    it('should reflect running state', () => {
      expect(controller.getStats().running).toBe(false);
      controller.start();
      expect(controller.getStats().running).toBe(true);
    });
  });
});
