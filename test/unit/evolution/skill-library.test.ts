import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SkillLibrary } from '../../../src/evolution/skill-library.js';
import type { Skill, SkillCategory } from '../../../src/evolution/types.js';

describe('SkillLibrary', () => {
  let library: SkillLibrary;

  beforeEach(() => {
    library = new SkillLibrary();
  });

  // ─── Constructor and Defaults ───────────────────────────────────────────────

  describe('constructor', () => {
    it('should create with default configuration', () => {
      const stats = library.getStats();
      expect(stats.config.maxSkills).toBe(500);
      expect(stats.config.minUsageForRetention).toBe(1);
      expect(stats.config.expiryMs).toBe(0);
      expect(stats.config.enableComposition).toBe(true);
    });

    it('should accept partial configuration overrides', () => {
      const custom = new SkillLibrary({ maxSkills: 100, expiryMs: 60000 });
      const stats = custom.getStats();
      expect(stats.config.maxSkills).toBe(100);
      expect(stats.config.expiryMs).toBe(60000);
      expect(stats.config.enableComposition).toBe(true); // default preserved
    });

    it('should start in stopped state', () => {
      expect(library.isRunning()).toBe(false);
    });

    it('should start with no skills', () => {
      expect(library.getStats().skillCount).toBe(0);
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  describe('start/stop/isRunning', () => {
    it('should transition to running on start()', () => {
      library.start();
      expect(library.isRunning()).toBe(true);
    });

    it('should transition to stopped on stop()', () => {
      library.start();
      library.stop();
      expect(library.isRunning()).toBe(false);
    });

    it('should handle multiple start/stop cycles', () => {
      library.start();
      library.stop();
      library.start();
      expect(library.isRunning()).toBe(true);
    });
  });

  // ─── addSkill ───────────────────────────────────────────────────────────────

  describe('addSkill', () => {
    it('should add a skill and return it with generated id', () => {
      const skill = library.addSkill({
        name: 'test-skill',
        description: 'A test skill',
        category: 'testing',
      });
      expect(skill.id).toMatch(/^skill_/);
      expect(skill.name).toBe('test-skill');
      expect(skill.category).toBe('testing');
    });

    it('should set default values for optional fields', () => {
      const skill = library.addSkill({
        name: 'minimal',
        description: 'minimal skill',
        category: 'custom',
      });
      expect(skill.code).toBe('');
      expect(skill.promptTemplate).toBe('');
      expect(skill.toolConfig).toEqual({});
      expect(skill.tags).toEqual([]);
      expect(skill.dependencies).toEqual([]);
      expect(skill.usageCount).toBe(0);
      expect(skill.successRate).toBe(1.0); // optimistic start
      expect(skill.avgQuality).toBe(0.5);
    });

    it('should set provided optional fields', () => {
      const skill = library.addSkill({
        name: 'full',
        description: 'full skill',
        category: 'code-generation',
        code: 'console.log("hello")',
        promptTemplate: 'Generate {{code}}',
        toolConfig: { timeout: 5000 },
        tags: ['js', 'web'],
        dependencies: ['dep-1'],
      });
      expect(skill.code).toBe('console.log("hello")');
      expect(skill.promptTemplate).toBe('Generate {{code}}');
      expect(skill.tags).toEqual(['js', 'web']);
      expect(skill.dependencies).toEqual(['dep-1']);
    });

    it('should increment totalSkillsCreated', () => {
      expect(library.getStats().totalSkillsCreated).toBe(0);
      library.addSkill({ name: 'a', description: 'a', category: 'custom' });
      library.addSkill({ name: 'b', description: 'b', category: 'custom' });
      expect(library.getStats().totalSkillsCreated).toBe(2);
    });

    it('should emit evolution:skill:created event', () => {
      const handler = vi.fn();
      library.on('evolution:skill:created', handler);
      library.addSkill({ name: 'emitter', description: 'test', category: 'testing' });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'emitter',
          category: 'testing',
        })
      );
    });

    it('should update tag index', () => {
      library.addSkill({
        name: 'tagged',
        description: 'tagged skill',
        category: 'custom',
        tags: ['alpha', 'beta'],
      });
      const results = library.findByTags(['alpha']);
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('tagged');
    });

    it('should update category index', () => {
      library.addSkill({
        name: 'coded',
        description: 'code gen skill',
        category: 'code-generation',
      });
      const results = library.findByCategory('code-generation');
      expect(results.length).toBe(1);
    });

    it('should prune when at capacity', () => {
      const small = new SkillLibrary({ maxSkills: 3 });
      small.addSkill({ name: 'a', description: 'a', category: 'custom' });
      small.addSkill({ name: 'b', description: 'b', category: 'custom' });
      small.addSkill({ name: 'c', description: 'c', category: 'custom' });
      // This should trigger pruning
      small.addSkill({ name: 'd', description: 'd', category: 'custom' });
      expect(small.getStats().skillCount).toBeLessThanOrEqual(3);
    });
  });

  // ─── recordUsage ────────────────────────────────────────────────────────────

  describe('recordUsage', () => {
    it('should increment usage count', () => {
      const skill = library.addSkill({ name: 'used', description: 'used', category: 'custom' });
      library.recordUsage(skill.id, { success: true, quality: 0.8 });
      const updated = library.getSkill(skill.id)!;
      expect(updated.usageCount).toBe(1);
    });

    it('should update successRate via EMA', () => {
      const skill = library.addSkill({ name: 'tracked', description: 'tracked', category: 'custom' });
      const initialRate = skill.successRate;
      library.recordUsage(skill.id, { success: false, quality: 0.3 });
      const updated = library.getSkill(skill.id)!;
      expect(updated.successRate).toBeLessThan(initialRate);
    });

    it('should update avgQuality via EMA', () => {
      const skill = library.addSkill({ name: 'quality', description: 'quality', category: 'custom' });
      library.recordUsage(skill.id, { success: true, quality: 0.95 });
      const updated = library.getSkill(skill.id)!;
      // EMA: (1-0.2) * 0.5 + 0.2 * 0.95 = 0.4 + 0.19 = 0.59
      expect(updated.avgQuality).toBeCloseTo(0.59, 1);
    });

    it('should increment totalSkillsUsed', () => {
      const skill = library.addSkill({ name: 'counted', description: 'counted', category: 'custom' });
      library.recordUsage(skill.id, { success: true, quality: 0.8 });
      expect(library.getStats().totalSkillsUsed).toBe(1);
    });

    it('should emit evolution:skill:used event', () => {
      const handler = vi.fn();
      library.on('evolution:skill:used', handler);
      const skill = library.addSkill({ name: 'emitted', description: 'emitted', category: 'custom' });
      library.recordUsage(skill.id, { success: true, quality: 0.8 });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: skill.id,
          name: 'emitted',
          usageCount: 1,
        })
      );
    });

    it('should do nothing for unknown skillId', () => {
      library.recordUsage('nonexistent', { success: true, quality: 0.8 });
      // Should not throw
    });

    it('should update lastUsedAt', () => {
      const skill = library.addSkill({ name: 'timed', description: 'timed', category: 'custom' });
      const before = skill.lastUsedAt;
      // Small delay to ensure timestamp difference
      library.recordUsage(skill.id, { success: true, quality: 0.8 });
      const updated = library.getSkill(skill.id)!;
      expect(updated.lastUsedAt).toBeGreaterThanOrEqual(before);
    });
  });

  // ─── findByTags ─────────────────────────────────────────────────────────────

  describe('findByTags', () => {
    it('should return empty array for unmatched tags', () => {
      library.addSkill({ name: 'a', description: 'a', category: 'custom', tags: ['alpha'] });
      expect(library.findByTags(['nonexistent'])).toEqual([]);
    });

    it('should return skills matching any of the provided tags (OR)', () => {
      library.addSkill({ name: 'a', description: 'a', category: 'custom', tags: ['alpha'] });
      library.addSkill({ name: 'b', description: 'b', category: 'custom', tags: ['beta'] });
      library.addSkill({ name: 'c', description: 'c', category: 'custom', tags: ['gamma'] });
      const results = library.findByTags(['alpha', 'beta']);
      expect(results.length).toBe(2);
    });

    it('should sort results by skill score', () => {
      const s1 = library.addSkill({ name: 'low', description: 'low', category: 'custom', tags: ['tag'] });
      const s2 = library.addSkill({ name: 'high', description: 'high', category: 'custom', tags: ['tag'] });
      // Boost s2 usage to improve its score
      library.recordUsage(s2.id, { success: true, quality: 0.95 });
      library.recordUsage(s2.id, { success: true, quality: 0.95 });
      const results = library.findByTags(['tag']);
      expect(results[0].id).toBe(s2.id);
    });
  });

  // ─── findByCategory ─────────────────────────────────────────────────────────

  describe('findByCategory', () => {
    it('should return empty array for unused category', () => {
      expect(library.findByCategory('security')).toEqual([]);
    });

    it('should return skills in the given category', () => {
      library.addSkill({ name: 'gen-1', description: 'gen', category: 'code-generation' });
      library.addSkill({ name: 'gen-2', description: 'gen', category: 'code-generation' });
      library.addSkill({ name: 'test-1', description: 'test', category: 'testing' });
      expect(library.findByCategory('code-generation').length).toBe(2);
      expect(library.findByCategory('testing').length).toBe(1);
    });
  });

  // ─── search ─────────────────────────────────────────────────────────────────

  describe('search', () => {
    it('should return empty array when nothing matches', () => {
      library.addSkill({ name: 'alpha', description: 'first skill', category: 'custom' });
      expect(library.search('zzzzzzz')).toEqual([]);
    });

    it('should match by name', () => {
      library.addSkill({ name: 'code-formatter', description: 'formats code', category: 'custom' });
      const results = library.search('formatter');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('code-formatter');
    });

    it('should match by description', () => {
      library.addSkill({ name: 'helper', description: 'generates unit tests', category: 'testing' });
      const results = library.search('unit tests');
      expect(results.length).toBe(1);
    });

    it('should match by tags', () => {
      library.addSkill({
        name: 'util',
        description: 'utility',
        category: 'custom',
        tags: ['typescript', 'node'],
      });
      const results = library.search('typescript');
      expect(results.length).toBe(1);
    });

    it('should rank results by match count then score', () => {
      // Search matches against "name description tags" text. Each query word is checked
      // for inclusion anywhere in the concatenated text.
      library.addSkill({ name: 'alpha', description: 'one match for widget', category: 'custom' });
      library.addSkill({ name: 'widget', description: 'widget builder', category: 'custom', tags: ['widget'] });
      const results = library.search('widget builder');
      // Second skill matches both 'widget' and 'builder', first only matches 'widget'
      expect(results[0].name).toBe('widget');
    });
  });

  // ─── getBestSkill ───────────────────────────────────────────────────────────

  describe('getBestSkill', () => {
    it('should return null when no skills match', () => {
      expect(library.getBestSkill('something')).toBeNull();
    });

    it('should return best skill by search', () => {
      library.addSkill({ name: 'code-gen', description: 'generates code', category: 'code-generation' });
      const best = library.getBestSkill('generates code');
      expect(best).not.toBeNull();
      expect(best!.name).toBe('code-gen');
    });

    it('should filter by category when provided', () => {
      library.addSkill({ name: 'gen', description: 'generates', category: 'code-generation' });
      library.addSkill({ name: 'test', description: 'tests', category: 'testing' });
      const best = library.getBestSkill('anything', 'testing');
      expect(best).not.toBeNull();
      expect(best!.category).toBe('testing');
    });
  });

  // ─── composeSkills ──────────────────────────────────────────────────────────

  describe('composeSkills', () => {
    it('should return null if composition is disabled', () => {
      const noCompose = new SkillLibrary({ enableComposition: false });
      const s1 = noCompose.addSkill({ name: 'a', description: 'a', category: 'custom' });
      const s2 = noCompose.addSkill({ name: 'b', description: 'b', category: 'custom' });
      expect(noCompose.composeSkills([s1.id, s2.id], 'composed', 'composed skill')).toBeNull();
    });

    it('should return null if fewer than 2 valid skills', () => {
      const s1 = library.addSkill({ name: 'a', description: 'a', category: 'custom' });
      expect(library.composeSkills([s1.id], 'composed', 'composed skill')).toBeNull();
    });

    it('should compose multiple skills into one', () => {
      const s1 = library.addSkill({
        name: 'step-1',
        description: 'first step',
        category: 'code-generation',
        code: 'const a = 1;',
        promptTemplate: 'Do step 1',
        tags: ['step', 'one'],
      });
      const s2 = library.addSkill({
        name: 'step-2',
        description: 'second step',
        category: 'code-generation',
        code: 'const b = 2;',
        promptTemplate: 'Do step 2',
        tags: ['step', 'two'],
      });

      const composed = library.composeSkills([s1.id, s2.id], 'combined', 'combined steps');
      expect(composed).not.toBeNull();
      expect(composed!.code).toContain('const a = 1;');
      expect(composed!.code).toContain('const b = 2;');
      expect(composed!.tags).toContain('composed');
      expect(composed!.tags).toContain('step');
      expect(composed!.dependencies).toContain(s1.id);
      expect(composed!.dependencies).toContain(s2.id);
    });
  });

  // ─── removeSkill ────────────────────────────────────────────────────────────

  describe('removeSkill', () => {
    it('should return false for unknown skillId', () => {
      expect(library.removeSkill('nonexistent')).toBe(false);
    });

    it('should remove skill and return true', () => {
      const skill = library.addSkill({ name: 'removable', description: 'removable', category: 'custom' });
      expect(library.removeSkill(skill.id)).toBe(true);
      expect(library.getSkill(skill.id)).toBeUndefined();
    });

    it('should remove from tag index', () => {
      const skill = library.addSkill({
        name: 'tagged',
        description: 'tagged',
        category: 'custom',
        tags: ['mytag'],
      });
      library.removeSkill(skill.id);
      expect(library.findByTags(['mytag'])).toEqual([]);
    });

    it('should remove from category index', () => {
      const skill = library.addSkill({ name: 'cat', description: 'cat', category: 'testing' });
      library.removeSkill(skill.id);
      expect(library.findByCategory('testing')).toEqual([]);
    });
  });

  // ─── getCategoryCounts ──────────────────────────────────────────────────────

  describe('getCategoryCounts', () => {
    it('should return counts per category', () => {
      library.addSkill({ name: 'a', description: 'a', category: 'testing' });
      library.addSkill({ name: 'b', description: 'b', category: 'testing' });
      library.addSkill({ name: 'c', description: 'c', category: 'debugging' });
      const counts = library.getCategoryCounts();
      expect(counts['testing']).toBe(2);
      expect(counts['debugging']).toBe(1);
    });
  });

  // ─── exportSkills / importSkills ────────────────────────────────────────────

  describe('exportSkills/importSkills', () => {
    it('should export all skills', () => {
      library.addSkill({ name: 'a', description: 'a', category: 'custom' });
      library.addSkill({ name: 'b', description: 'b', category: 'custom' });
      const exported = library.exportSkills();
      expect(exported.length).toBe(2);
    });

    it('should import skills and update indices', () => {
      const sourceLib = new SkillLibrary();
      const s1 = sourceLib.addSkill({
        name: 'imported',
        description: 'imported skill',
        category: 'testing',
        tags: ['import-tag'],
      });
      const exported = sourceLib.exportSkills();

      const count = library.importSkills(exported);
      expect(count).toBe(1);
      expect(library.getSkill(s1.id)).toBeDefined();
      expect(library.findByTags(['import-tag']).length).toBe(1);
      expect(library.findByCategory('testing').length).toBe(1);
    });

    it('should not duplicate already-existing skills on import', () => {
      const skill = library.addSkill({ name: 'existing', description: 'existing', category: 'custom' });
      const count = library.importSkills([skill]);
      expect(count).toBe(0);
    });
  });

  // ─── getStats ───────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return comprehensive stats object', () => {
      const stats = library.getStats();
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('skillCount');
      expect(stats).toHaveProperty('totalSkillsCreated');
      expect(stats).toHaveProperty('totalSkillsUsed');
      expect(stats).toHaveProperty('categoryCounts');
      expect(stats).toHaveProperty('avgSuccessRate');
      expect(stats).toHaveProperty('avgQuality');
      expect(stats).toHaveProperty('config');
    });

    it('should return 0 for avgSuccessRate and avgQuality when no skills', () => {
      expect(library.getStats().avgSuccessRate).toBe(0);
      expect(library.getStats().avgQuality).toBe(0);
    });

    it('should compute averages when skills exist', () => {
      library.addSkill({ name: 'a', description: 'a', category: 'custom' });
      library.addSkill({ name: 'b', description: 'b', category: 'custom' });
      const stats = library.getStats();
      expect(stats.avgSuccessRate).toBe(1.0); // optimistic starts at 1.0
      expect(stats.avgQuality).toBe(0.5); // default start at 0.5
    });

    it('should reflect running state', () => {
      expect(library.getStats().running).toBe(false);
      library.start();
      expect(library.getStats().running).toBe(true);
    });
  });
});
