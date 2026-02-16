/**
 * SkillLibrary — Persistent Capability Accumulation
 *
 * Stores and retrieves reusable capabilities (code, prompts, tool configs)
 * that grow with each agent execution. Voyager-inspired open-ended skill
 * accumulation.
 *
 * From: Self-Evolving Agents survey — Voyager skill library pattern
 * From: Godel Agent — persistent improvement repository
 *
 * Zero external dependencies.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { SkillLibraryConfig, Skill, SkillCategory } from './types.js';

const DEFAULT_CONFIG: Required<SkillLibraryConfig> = {
  maxSkills: 500,
  minUsageForRetention: 1,
  expiryMs: 0, // Never expire by default
  enableComposition: true,
  persistPath: '', // Empty = no persistence by default
};

export class SkillLibrary extends EventEmitter {
  private config: Required<SkillLibraryConfig>;
  private running = false;
  private skills: Map<string, Skill> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();
  private categoryIndex: Map<SkillCategory, Set<string>> = new Map();
  private totalSkillsCreated = 0;
  private totalSkillsUsed = 0;

  constructor(config?: Partial<SkillLibraryConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(): Promise<void> {
    // Load persisted skills if a persistPath is configured (Issues 76-78)
    if (this.config.persistPath) {
      try {
        const data = await readFile(this.config.persistPath, 'utf-8');
        const skills: Skill[] = JSON.parse(data);
        this.importSkills(skills);
      } catch {
        // File does not exist or is invalid — start fresh (not an error)
      }
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    // Persist skills to disk if a persistPath is configured (Issues 76-78)
    if (this.config.persistPath) {
      try {
        const skills = this.exportSkills();
        await writeFile(this.config.persistPath, JSON.stringify(skills, null, 2), 'utf-8');
      } catch {
        // Best-effort persistence — do not throw on failure
      }
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Add a new skill to the library.
   */
  addSkill(input: {
    name: string;
    description: string;
    category: SkillCategory;
    code?: string;
    promptTemplate?: string;
    toolConfig?: Record<string, unknown>;
    tags?: string[];
    dependencies?: string[];
  }): Skill {
    // Prune if at capacity
    if (this.skills.size >= this.config.maxSkills) {
      this.pruneSkills();
    }

    const skill: Skill = {
      id: `skill_${randomUUID().slice(0, 8)}`,
      name: input.name,
      description: input.description,
      category: input.category,
      code: input.code ?? '',
      promptTemplate: input.promptTemplate ?? '',
      toolConfig: input.toolConfig ?? {},
      usageCount: 0,
      successRate: 1.0, // Optimistic start
      avgQuality: 0.5,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      tags: input.tags ?? [],
      dependencies: input.dependencies ?? [],
    };

    this.skills.set(skill.id, skill);
    this.totalSkillsCreated++;

    // Update indices
    for (const tag of skill.tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(skill.id);
    }

    if (!this.categoryIndex.has(skill.category)) {
      this.categoryIndex.set(skill.category, new Set());
    }
    this.categoryIndex.get(skill.category)!.add(skill.id);

    this.emit('evolution:skill:created', {
      skillId: skill.id,
      name: skill.name,
      category: skill.category,
    });

    return skill;
  }

  /**
   * Record usage of a skill and update its metrics.
   */
  recordUsage(skillId: string, outcome: { success: boolean; quality: number }): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    skill.usageCount++;
    skill.lastUsedAt = Date.now();
    this.totalSkillsUsed++;

    // EMA update
    const lr = 0.2;
    skill.successRate = (1 - lr) * skill.successRate + lr * (outcome.success ? 1 : 0);
    skill.avgQuality = (1 - lr) * skill.avgQuality + lr * outcome.quality;

    this.emit('evolution:skill:used', {
      skillId: skill.id,
      name: skill.name,
      usageCount: skill.usageCount,
      successRate: skill.successRate,
    });
  }

  /**
   * Find skills by tags (OR matching).
   */
  findByTags(tags: string[]): Skill[] {
    const matchingIds = new Set<string>();

    for (const tag of tags) {
      const ids = this.tagIndex.get(tag);
      if (ids) {
        for (const id of ids) matchingIds.add(id);
      }
    }

    return [...matchingIds]
      .map(id => this.skills.get(id)!)
      .filter(Boolean)
      .sort((a, b) => this.skillScore(b) - this.skillScore(a));
  }

  /**
   * Find skills by category.
   */
  findByCategory(category: SkillCategory): Skill[] {
    const ids = this.categoryIndex.get(category);
    if (!ids) return [];

    return [...ids]
      .map(id => this.skills.get(id)!)
      .filter(Boolean)
      .sort((a, b) => this.skillScore(b) - this.skillScore(a));
  }

  /**
   * Search skills by name and description.
   */
  search(query: string): Skill[] {
    const queryWords = query.toLowerCase().split(/\s+/);

    return [...this.skills.values()]
      .map(skill => {
        const text = `${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase();
        const matchCount = queryWords.filter(w => text.includes(w)).length;
        return { skill, matchCount };
      })
      .filter(x => x.matchCount > 0)
      .sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        return this.skillScore(b.skill) - this.skillScore(a.skill);
      })
      .map(x => x.skill);
  }

  /**
   * Get the best skill for a specific task description.
   */
  getBestSkill(taskDescription: string, category?: SkillCategory): Skill | null {
    let candidates: Skill[];

    if (category) {
      candidates = this.findByCategory(category);
    } else {
      candidates = this.search(taskDescription);
    }

    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * Get a specific skill by ID.
   */
  getSkill(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Compose multiple skills into a new composite skill.
   */
  composeSkills(skillIds: string[], name: string, description: string): Skill | null {
    if (!this.config.enableComposition) return null;

    const skills = skillIds.map(id => this.skills.get(id)).filter(Boolean) as Skill[];
    if (skills.length < 2) return null;

    const composedCode = skills.map(s => s.code).filter(Boolean).join('\n\n');
    const composedPrompt = skills.map(s => s.promptTemplate).filter(Boolean).join('\n---\n');
    const composedTags = [...new Set(skills.flatMap(s => s.tags))];
    const composedDeps = [...new Set([...skills.flatMap(s => s.dependencies), ...skillIds])];

    return this.addSkill({
      name,
      description,
      category: skills[0].category,
      code: composedCode,
      promptTemplate: composedPrompt,
      tags: [...composedTags, 'composed'],
      dependencies: composedDeps,
    });
  }

  /**
   * Remove a skill from the library.
   */
  removeSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    // Remove from indices
    for (const tag of skill.tags) {
      this.tagIndex.get(tag)?.delete(skillId);
    }
    this.categoryIndex.get(skill.category)?.delete(skillId);

    this.skills.delete(skillId);
    return true;
  }

  /**
   * Compute a composite score for a skill.
   */
  private skillScore(skill: Skill): number {
    const recency = 1 / (1 + (Date.now() - skill.lastUsedAt) / (24 * 3600 * 1000)); // Decay over days
    const usage = Math.log2(skill.usageCount + 1) / 10; // Logarithmic usage bonus
    const quality = skill.avgQuality * skill.successRate;

    return quality * 0.5 + usage * 0.3 + recency * 0.2;
  }

  /**
   * Prune low-quality and unused skills.
   */
  private pruneSkills(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, skill] of this.skills) {
      // Remove expired skills
      if (this.config.expiryMs > 0 && now - skill.lastUsedAt > this.config.expiryMs) {
        toRemove.push(id);
        continue;
      }

      // Remove underperforming skills (low success rate with enough samples)
      if (skill.usageCount >= 5 && skill.successRate < 0.2) {
        toRemove.push(id);
        continue;
      }
    }

    // If still over capacity, remove by score
    if (toRemove.length === 0 && this.skills.size >= this.config.maxSkills) {
      const sorted = [...this.skills.entries()]
        .sort(([, a], [, b]) => this.skillScore(a) - this.skillScore(b));

      // Remove bottom 10%
      const removeCount = Math.ceil(sorted.length * 0.1);
      for (let i = 0; i < removeCount; i++) {
        toRemove.push(sorted[i][0]);
      }
    }

    for (const id of toRemove) {
      this.removeSkill(id);
    }
  }

  /**
   * Get all skill categories with counts.
   */
  getCategoryCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [category, ids] of this.categoryIndex) {
      counts[category] = ids.size;
    }
    return counts;
  }

  /**
   * Export all skills as a portable format.
   */
  exportSkills(): Skill[] {
    return [...this.skills.values()];
  }

  /**
   * Import skills from a portable format.
   */
  importSkills(skills: Skill[]): number {
    let imported = 0;
    for (const skill of skills) {
      if (!this.skills.has(skill.id)) {
        this.skills.set(skill.id, { ...skill });

        // Update indices
        for (const tag of skill.tags) {
          if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
          this.tagIndex.get(tag)!.add(skill.id);
        }
        if (!this.categoryIndex.has(skill.category)) {
          this.categoryIndex.set(skill.category, new Set());
        }
        this.categoryIndex.get(skill.category)!.add(skill.id);

        imported++;
      }
    }
    return imported;
  }

  getStats() {
    return {
      running: this.running,
      skillCount: this.skills.size,
      totalSkillsCreated: this.totalSkillsCreated,
      totalSkillsUsed: this.totalSkillsUsed,
      categoryCounts: this.getCategoryCounts(),
      avgSuccessRate: this.skills.size > 0
        ? [...this.skills.values()].reduce((sum, s) => sum + s.successRate, 0) / this.skills.size
        : 0,
      avgQuality: this.skills.size > 0
        ? [...this.skills.values()].reduce((sum, s) => sum + s.avgQuality, 0) / this.skills.size
        : 0,
      config: { ...this.config },
    };
  }
}
