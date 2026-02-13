/**
 * Skill Registry — Reusable Automation Units
 *
 * A Skill wraps a WorkflowDefinition with metadata, default inputs,
 * and tags for discoverability. Skills are the CortexOS equivalent
 * of Oz "Skills" — reusable, launchable automation units.
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkflowBuilder, PRESET_WORKFLOWS, type WorkflowDefinition } from '../core/workflow-dsl.js';
import type { Skill } from './types.js';

// ═══════════════════════════════════════════════════════════════
// SKILL REGISTRY
// ═══════════════════════════════════════════════════════════════

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  constructor() {
    // Register preset skills
    for (const skill of Object.values(PRESET_SKILLS)) {
      this.skills.set(skill.id, skill);
    }
  }

  /** Register a skill */
  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  /** Get a skill by ID */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /** Get a skill by name (case-insensitive) */
  getByName(name: string): Skill | undefined {
    const lower = name.toLowerCase();
    for (const skill of this.skills.values()) {
      if (skill.name.toLowerCase() === lower || skill.id.toLowerCase() === lower) {
        return skill;
      }
    }
    return undefined;
  }

  /** List all skills */
  list(filter?: { tags?: string[] }): Skill[] {
    let skills = Array.from(this.skills.values());

    if (filter?.tags?.length) {
      skills = skills.filter(s =>
        filter.tags!.some(tag => s.tags?.includes(tag))
      );
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Remove a skill */
  remove(id: string): boolean {
    return this.skills.delete(id);
  }

  /** Create a new skill from a workflow definition */
  create(name: string, description: string, workflow: WorkflowDefinition, options?: {
    defaultInputs?: Record<string, unknown>;
    tags?: string[];
  }): Skill {
    const now = Date.now();
    const skill: Skill = {
      id: `skill_${randomUUID().slice(0, 8)}`,
      name,
      description,
      workflow,
      defaultInputs: options?.defaultInputs,
      tags: options?.tags,
      version: '1.0.0',
      createdAt: now,
      updatedAt: now,
    };

    this.skills.set(skill.id, skill);
    return skill;
  }

  /** Load skills from a directory of JSON files */
  loadFromDir(dir: string): number {
    if (!existsSync(dir)) return 0;

    let loaded = 0;
    const files = readdirSync(dir).filter(f => extname(f) === '.json');

    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), 'utf-8');
        const data = JSON.parse(raw);
        if (data.id && data.name && data.workflow) {
          this.skills.set(data.id, data as Skill);
          loaded++;
        }
      } catch {
        // Skip invalid files
      }
    }

    return loaded;
  }

  /** Save a skill to a directory */
  saveToDir(skillId: string, dir: string): void {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill "${skillId}" not found`);

    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${skill.id}.json`);
    writeFileSync(filePath, JSON.stringify(skill, null, 2), 'utf-8');
  }
}

// ═══════════════════════════════════════════════════════════════
// PRESET SKILLS
// ═══════════════════════════════════════════════════════════════

function createPresetSkill(
  id: string,
  name: string,
  description: string,
  workflow: WorkflowDefinition,
  tags: string[] = []
): Skill {
  const now = Date.now();
  return { id, name, description, workflow, tags, version: '1.0.0', createdAt: now, updatedAt: now };
}

export const PRESET_SKILLS: Record<string, Skill> = {
  'code-review': createPresetSkill(
    'code-review',
    'Code Review',
    'Automated code review with quality verification',
    PRESET_WORKFLOWS.codeGen(),
    ['quality', 'review']
  ),

  'bug-fix': createPresetSkill(
    'bug-fix',
    'Bug Fix',
    'Investigate and fix bugs with regression testing',
    PRESET_WORKFLOWS.bugFix(),
    ['fix', 'debug']
  ),

  'full-stack': createPresetSkill(
    'full-stack',
    'Full-Stack Feature',
    'Build a full-stack feature with architecture review',
    PRESET_WORKFLOWS.fullStack(),
    ['feature', 'fullstack']
  ),

  'dependency-audit': createPresetSkill(
    'dependency-audit',
    'Dependency Audit',
    'Audit project dependencies for vulnerabilities and license issues',
    new WorkflowBuilder('dependency-audit', '1.0.0')
      .description('Audit dependencies for security and license compliance')
      .input('projectDir', 'string', { required: false })
      .agent('scan', { role: 'researcher', prompt: 'Scan and audit all project dependencies for vulnerabilities, outdated packages, and license compliance issues' })
      .agent('report', { role: 'developer', prompt: 'Generate a detailed audit report with remediation steps', dependsOn: ['scan'] })
      .build(),
    ['security', 'audit', 'dependencies']
  ),

  'security-scan': createPresetSkill(
    'security-scan',
    'Security Scan',
    'Run comprehensive security analysis on the codebase',
    new WorkflowBuilder('security-scan', '1.0.0')
      .description('Comprehensive security scanning')
      .input('scope', 'string', { required: false })
      .agent('analyze', { role: 'researcher', prompt: 'Perform a comprehensive security analysis including OWASP Top 10, injection vulnerabilities, auth issues, and data exposure risks' })
      .gate('verify', { gates: ['security'], failAction: 'continue', dependsOn: ['analyze'] })
      .agent('remediate', { role: 'developer', prompt: 'Propose fixes for identified security issues', dependsOn: ['verify'] })
      .build(),
    ['security', 'scan']
  ),
};
