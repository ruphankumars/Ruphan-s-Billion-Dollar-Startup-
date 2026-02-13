import { describe, it, expect, beforeEach } from 'vitest';
import {
  SkillRegistry,
  PRESET_SKILLS,
} from '../../../src/automation/skill-registry.js';

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it('loads preset skills', () => {
    const skills = registry.list();
    expect(skills.length).toBeGreaterThan(0);
  });

  it('PRESET_SKILLS has 5 entries (as a Record)', () => {
    // PRESET_SKILLS is a Record<string, Skill>, not an array
    expect(Object.keys(PRESET_SKILLS)).toHaveLength(5);
  });

  it('get returns skill by ID', () => {
    const firstPresetKey = Object.keys(PRESET_SKILLS)[0];
    const firstPreset = PRESET_SKILLS[firstPresetKey];
    const skill = registry.get(firstPreset.id);
    expect(skill).toBeDefined();
    expect(skill!.id).toBe(firstPreset.id);
  });

  it('getByName returns skill by name (case insensitive)', () => {
    const firstPresetKey = Object.keys(PRESET_SKILLS)[0];
    const firstPreset = PRESET_SKILLS[firstPresetKey];
    const skill = registry.getByName(firstPreset.name.toUpperCase());
    expect(skill).toBeDefined();
    expect(skill!.name).toBe(firstPreset.name);
  });

  it('register adds a custom skill', () => {
    const customSkill = {
      id: 'custom-test-skill',
      name: 'Custom Test Skill',
      description: 'A skill for testing',
      tags: ['test'],
      workflow: { id: 'test-wf', version: '1.0.0', steps: [] } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    registry.register(customSkill);
    const retrieved = registry.get('custom-test-skill');
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('Custom Test Skill');
  });

  it('remove deletes a skill', () => {
    const customSkill = {
      id: 'to-remove',
      name: 'To Remove',
      description: 'Will be removed',
      tags: [] as string[],
      workflow: { id: 'test-wf', version: '1.0.0', steps: [] } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    registry.register(customSkill);
    expect(registry.get('to-remove')).toBeDefined();

    registry.remove('to-remove');
    expect(registry.get('to-remove')).toBeUndefined();
  });

  it('list returns all skills', () => {
    const skills = registry.list();
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBe(Object.keys(PRESET_SKILLS).length);
  });

  it('list with tag filter returns matching', () => {
    const customSkill = {
      id: 'tagged-skill',
      name: 'Tagged Skill',
      description: 'A tagged skill',
      tags: ['deploy', 'ci'],
      workflow: { id: 'test-wf', version: '1.0.0', steps: [] } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    registry.register(customSkill);
    // list() filter uses { tags: string[] }, not { tag: string }
    const filtered = registry.list({ tags: ['deploy'] });
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered.some((s: any) => s.id === 'tagged-skill')).toBe(true);
  });

  it('create makes a new skill with workflow', () => {
    // create(name, description, workflow, options?)
    const workflow = { id: 'dynamic-wf', version: '1.0.0', steps: [] } as any;
    const skill = registry.create('Created Skill', 'Dynamically created', workflow, {
      tags: ['dynamic'],
    });

    expect(skill).toBeDefined();
    expect(skill.id).toBeDefined();
    expect(skill.name).toBe('Created Skill');

    const retrieved = registry.get(skill.id);
    expect(retrieved).toBeDefined();
  });

  it('register overwrites duplicate skill ID (no throw)', () => {
    const skill = {
      id: 'duplicate-id',
      name: 'First Skill',
      description: 'First',
      tags: [] as string[],
      workflow: { id: 'wf', version: '1.0.0', steps: [] } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    registry.register(skill);

    const duplicate = {
      id: 'duplicate-id',
      name: 'Second Skill',
      description: 'Second',
      tags: [] as string[],
      workflow: { id: 'wf', version: '1.0.0', steps: [] } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // register simply sets on the Map — it does NOT throw
    registry.register(duplicate);
    const retrieved = registry.get('duplicate-id');
    expect(retrieved!.name).toBe('Second Skill');
  });
});
