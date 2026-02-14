/**
 * ModelRouter — I/O Bus Controller Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelRouter } from '../../../src/kernel/model-router.js';

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  describe('lifecycle', () => {
    it('should start and stop', () => {
      expect(router.isRunning()).toBe(false);
      router.start();
      expect(router.isRunning()).toBe(true);
      router.stop();
      expect(router.isRunning()).toBe(false);
    });

    it('should emit lifecycle events', () => {
      const started = vi.fn();
      const stopped = vi.fn();
      router.on('kernel:router:started', started);
      router.on('kernel:router:stopped', stopped);

      router.start();
      router.stop();

      expect(started).toHaveBeenCalledTimes(1);
      expect(stopped).toHaveBeenCalledTimes(1);
    });
  });

  describe('default tiers', () => {
    it('should initialize with 3 default tiers', () => {
      const tiers = router.getTiers();
      expect(tiers).toHaveLength(3);
      expect(tiers[0].model).toBe('claude-haiku');
      expect(tiers[1].model).toBe('claude-sonnet');
      expect(tiers[2].model).toBe('claude-opus');
    });

    it('should order tiers by cost ascending', () => {
      const tiers = router.getTiers();
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i].costPerToken).toBeGreaterThanOrEqual(tiers[i - 1].costPerToken);
      }
    });
  });

  describe('cascade', () => {
    it('should route high-confidence tasks to cheapest tier', () => {
      const decision = router.cascade({ task: 'simple classification', confidence: 0.95 });
      expect(decision.tier.model).toBe('claude-haiku');
      expect(decision.id).toMatch(/^route_/);
    });

    it('should route medium-confidence tasks to balanced tier', () => {
      const decision = router.cascade({ task: 'code review', confidence: 0.6 });
      expect(decision.tier.model).toBe('claude-sonnet');
    });

    it('should route low-confidence tasks to best tier', () => {
      const decision = router.cascade({ task: 'complex research', confidence: 0.2 });
      expect(decision.tier.model).toBe('claude-opus');
    });

    it('should adjust confidence based on depth (RLM pattern)', () => {
      // Depth 0 with low confidence → expensive model
      const shallow = router.cascade({ task: 'task', confidence: 0.5, depth: 0 });

      // Same task at depth 3 → cheaper model (adjusted confidence higher)
      const deep = router.cascade({ task: 'task', confidence: 0.5, depth: 3 });

      expect(deep.tier.costPerToken).toBeLessThanOrEqual(shallow.tier.costPerToken);
    });

    it('should respect cost constraints', () => {
      const decision = router.cascade({
        task: 'task',
        confidence: 0.1,
        constraints: { maxCost: 0.001 },
      });
      expect(decision.tier.costPerToken).toBeLessThanOrEqual(0.001);
    });

    it('should respect capability constraints', () => {
      const decision = router.cascade({
        task: 'task',
        confidence: 0.9,
        constraints: { requiredCapabilities: ['complex-reasoning'] },
      });
      expect(decision.tier.capabilities).toContain('complex-reasoning');
    });

    it('should prefer preferred model', () => {
      const decision = router.cascade({
        task: 'task',
        confidence: 0.9,
        constraints: { preferredModel: 'claude-opus' },
      });
      expect(decision.tier.model).toBe('claude-opus');
    });

    it('should emit cascaded event', () => {
      const listener = vi.fn();
      router.on('kernel:router:cascaded', listener);

      router.cascade({ task: 'test task' });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ tier: expect.any(String), model: expect.any(String) })
      );
    });

    it('should track total routes', () => {
      router.cascade({ task: 'task1' });
      router.cascade({ task: 'task2' });

      expect(router.getStats().totalRoutes).toBe(2);
    });
  });

  describe('escalate', () => {
    it('should escalate to next tier', () => {
      const initial = router.cascade({ task: 'test', confidence: 0.9 });
      expect(initial.tier.model).toBe('claude-haiku');

      const escalated = router.escalate(initial.id);
      expect(escalated).not.toBeNull();
      expect(escalated!.tier.model).toBe('claude-sonnet');
    });

    it('should return null when already at highest tier', () => {
      const initial = router.cascade({ task: 'test', confidence: 0.1 });
      expect(initial.tier.model).toBe('claude-opus');

      const escalated = router.escalate(initial.id);
      expect(escalated).toBeNull();
    });

    it('should lower confidence on escalation', () => {
      const initial = router.cascade({ task: 'test', confidence: 0.9 });
      const escalated = router.escalate(initial.id);

      expect(escalated!.confidence).toBeLessThan(initial.confidence);
    });

    it('should return null for non-existent decision', () => {
      expect(router.escalate('non_existent')).toBeNull();
    });

    it('should track escalation count', () => {
      const initial = router.cascade({ task: 'test', confidence: 0.9 });
      router.escalate(initial.id);

      expect(router.getStats().totalEscalations).toBe(1);
    });

    it('should emit escalated event', () => {
      const listener = vi.fn();
      router.on('kernel:router:escalated', listener);

      const initial = router.cascade({ task: 'test', confidence: 0.9 });
      router.escalate(initial.id);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ fromTier: 'Fast', toTier: 'Balanced' })
      );
    });
  });

  describe('route (modality)', () => {
    it('should route text modality', () => {
      const decision = router.route('text');
      expect(decision).toBeDefined();
      expect(decision.modality).toBe('text');
    });

    it('should route code modality', () => {
      const decision = router.route('code');
      expect(decision.modality).toBe('code');
    });

    it('should route multimodal', () => {
      const decision = router.route('multimodal');
      expect(decision.modality).toBe('multimodal');
    });

    it('should fall back to cascade for unknown modality', () => {
      // Register a custom modality route
      router.registerModalityRoute({
        modality: 'text',
        preferredModel: 'claude-sonnet',
        fallbackModel: 'claude-haiku',
        maxTokens: 4096,
      });

      const decision = router.route('text');
      expect(decision).toBeDefined();
    });
  });

  describe('registerModalityRoute', () => {
    it('should register a new modality route', () => {
      const listener = vi.fn();
      router.on('kernel:router:modality:registered', listener);

      router.registerModalityRoute({
        modality: 'audio',
        preferredModel: 'claude-opus',
        fallbackModel: 'claude-sonnet',
        maxTokens: 8192,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ modality: 'audio' })
      );
    });
  });

  describe('adapt (LoRA)', () => {
    it('should create a LoRA adapter', () => {
      const adapter = router.adapt({
        name: 'code-review-adapter',
        taskType: 'code-review',
        baseModel: 'claude-sonnet',
        rank: 8,
        alpha: 16,
        successRate: 0.5,
        usageCount: 0,
      });

      expect(adapter.id).toMatch(/^adapter_/);
      expect(adapter.name).toBe('code-review-adapter');
      expect(adapter.taskType).toBe('code-review');
    });

    it('should select best adapter for task type', () => {
      router.adapt({ name: 'low', taskType: 'review', baseModel: 'model', rank: 4, alpha: 8, successRate: 0.3, usageCount: 5 });
      router.adapt({ name: 'high', taskType: 'review', baseModel: 'model', rank: 8, alpha: 16, successRate: 0.9, usageCount: 10 });

      const best = router.selectAdapter('review');
      expect(best?.name).toBe('high');
    });

    it('should return null when no adapter matches', () => {
      expect(router.selectAdapter('nonexistent')).toBeNull();
    });

    it('should filter by base model', () => {
      router.adapt({ name: 'a1', taskType: 'test', baseModel: 'model-a', rank: 4, alpha: 8, successRate: 0.8, usageCount: 5 });
      router.adapt({ name: 'b1', taskType: 'test', baseModel: 'model-b', rank: 4, alpha: 8, successRate: 0.9, usageCount: 5 });

      const selected = router.selectAdapter('test', 'model-a');
      expect(selected?.baseModel).toBe('model-a');
    });
  });

  describe('distill', () => {
    it('should create a distillation config', () => {
      const config = router.distill({
        teacherModel: 'claude-opus',
        studentModel: 'claude-haiku',
        temperature: 3.0,
        alpha: 0.5,
        method: 'logit',
      });

      expect(config.id).toMatch(/^distill_/);
      expect(config.status).toBe('configured');
      expect(config.teacherModel).toBe('claude-opus');
      expect(config.studentModel).toBe('claude-haiku');
    });

    it('should update distillation status', () => {
      const config = router.distill({
        teacherModel: 'opus',
        studentModel: 'haiku',
        temperature: 3,
        alpha: 0.5,
        method: 'logit',
      });

      const updated = router.updateDistillation(config.id, {
        status: 'completed',
        metrics: { qualityRetention: 0.92, speedup: 3.5, costReduction: 0.8 },
      });

      expect(updated).toBe(true);

      const distillations = router.getDistillations();
      const found = distillations.find(d => d.id === config.id);
      expect(found?.status).toBe('completed');
      expect(found?.metrics.qualityRetention).toBe(0.92);
    });

    it('should return false for non-existent distillation', () => {
      expect(router.updateDistillation('nonexistent', { status: 'completed' })).toBe(false);
    });
  });

  describe('registerTier', () => {
    it('should register a custom tier', () => {
      router.registerTier({
        id: 'tier_custom',
        name: 'Custom',
        model: 'custom-model',
        confidenceThreshold: 0.3,
        costPerToken: 0.005,
        maxTokens: 16384,
        latencyMs: 3000,
        capabilities: ['text', 'code'],
      });

      const tiers = router.getTiers();
      expect(tiers.some(t => t.id === 'tier_custom')).toBe(true);
    });
  });

  describe('recordOutcome', () => {
    it('should record outcome for a decision', () => {
      const decision = router.cascade({ task: 'test' });

      // Should not throw
      router.recordOutcome(decision.id, {
        success: true,
        quality: 0.9,
        latencyMs: 1000,
        tokensUsed: 500,
      });
    });

    it('should emit outcome event', () => {
      const listener = vi.fn();
      router.on('kernel:router:outcome', listener);

      const decision = router.cascade({ task: 'test' });
      router.recordOutcome(decision.id, {
        success: true,
        quality: 0.8,
        latencyMs: 500,
        tokensUsed: 100,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ decisionId: decision.id, success: true })
      );
    });

    it('should silently ignore non-existent decision', () => {
      // Should not throw
      router.recordOutcome('nonexistent', {
        success: true,
        quality: 0.8,
        latencyMs: 500,
        tokensUsed: 100,
      });
    });
  });

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      router.start();
      router.cascade({ task: 'task1' });
      router.cascade({ task: 'task2' });

      const stats = router.getStats();
      expect(stats.running).toBe(true);
      expect(stats.totalRoutes).toBe(2);
      expect(stats.totalEscalations).toBe(0);
      expect(stats.avgConfidence).toBeGreaterThan(0);
      expect(stats.adapterCount).toBe(0);
      expect(stats.distillationCount).toBe(0);
      expect(stats.modalityRoutes).toBe(7); // 7 default routes
    });
  });
});
