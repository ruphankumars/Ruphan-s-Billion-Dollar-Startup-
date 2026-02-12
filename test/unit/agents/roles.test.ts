import { describe, it, expect } from 'vitest';
import { getRole, getAllRoles } from '../../../src/agents/roles/index.js';
import type { AgentRole } from '../../../src/agents/types.js';

describe('Agent Roles', () => {
  describe('getAllRoles', () => {
    it('should return 7 roles', () => {
      const roles = getAllRoles();
      expect(roles).toHaveLength(7);
    });
  });

  describe('getRole', () => {
    it('should return DeveloperRole with correct properties', () => {
      const role = getRole('developer');
      expect(role.name).toBe('developer');
      expect(role.displayName).toBe('Developer');
      expect(role.description).toBeTruthy();
      expect(role.defaultModel).toBe('powerful');
    });

    it('should return OrchestratorRole', () => {
      const role = getRole('orchestrator');
      expect(role).toBeDefined();
      expect(role.name).toBe('orchestrator');
    });

    it('should throw error for unknown role', () => {
      expect(() => getRole('unknown' as any)).toThrow('Unknown agent role');
    });
  });

  describe('role properties', () => {
    const roles = getAllRoles();

    it('all roles should have required properties', () => {
      for (const role of roles) {
        expect(role.name).toBeTruthy();
        expect(role.displayName).toBeTruthy();
        expect(role.description).toBeTruthy();
        expect(role.systemPrompt).toBeTruthy();
        expect(role.defaultTools).toBeDefined();
        expect(Array.isArray(role.defaultTools)).toBe(true);
        expect(typeof role.temperature).toBe('number');
      }
    });

    it('developer should have file_read, file_write, shell, and git tools', () => {
      const developer = getRole('developer');
      expect(developer.defaultTools).toContain('file_read');
      expect(developer.defaultTools).toContain('file_write');
      expect(developer.defaultTools).toContain('shell');
      expect(developer.defaultTools).toContain('git');
    });

    it('all roles should have non-empty systemPrompt', () => {
      for (const role of roles) {
        expect(role.systemPrompt.length).toBeGreaterThan(0);
      }
    });

    it('all roles should have temperature between 0 and 1', () => {
      for (const role of roles) {
        expect(role.temperature).toBeGreaterThanOrEqual(0);
        expect(role.temperature).toBeLessThanOrEqual(1);
      }
    });

    it('each role should have a unique name', () => {
      const names = roles.map(r => r.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should include all 7 expected role names', () => {
      const names = roles.map(r => r.name);
      expect(names).toContain('orchestrator');
      expect(names).toContain('researcher');
      expect(names).toContain('developer');
      expect(names).toContain('architect');
      expect(names).toContain('tester');
      expect(names).toContain('validator');
      expect(names).toContain('ux-agent');
    });
  });
});
