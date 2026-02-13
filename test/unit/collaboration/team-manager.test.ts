import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock node:child_process (used by TeamManager for git identity resolution)
const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { TeamManager } from '../../../src/collaboration/team-manager.js';

describe('TeamManager', () => {
  let manager: TeamManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // By default, mock git identity to return a test user
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (args.includes('user.name')) return 'Alice\n';
      if (args.includes('user.email')) return 'alice@example.com\n';
      throw new Error('unknown git config');
    });
    manager = new TeamManager();
  });

  describe('initTeam', () => {
    it('creates a team with name', () => {
      // initTeam(name: string) — uses resolveGitIdentity() internally
      const team = manager.initTeam('Engineering');

      expect(team).toBeDefined();
      expect(team.name).toBe('Engineering');
    });

    it('adds git identity as first admin member', () => {
      const team = manager.initTeam('Engineering');

      const members = manager.listMembers();
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('admin');
      expect(members[0].name).toBe('Alice');
      expect(members[0].email).toBe('alice@example.com');
    });

    it('creates team with no members if git identity not available', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('git not found');
      });

      const mgr = new TeamManager();
      const team = mgr.initTeam('Engineering');

      expect(team).toBeDefined();
      expect(team.name).toBe('Engineering');
      expect(team.members).toHaveLength(0);
    });
  });

  describe('getTeam', () => {
    it('returns null before init', () => {
      const team = manager.getTeam();
      expect(team).toBeNull();
    });
  });

  describe('getCurrentMember', () => {
    it('returns null when no team', () => {
      const member = manager.getCurrentMember();
      expect(member).toBeNull();
    });
  });

  describe('addMember', () => {
    beforeEach(() => {
      manager.initTeam('Engineering');
    });

    it('adds a member with operator role by default', () => {
      // addMember({name, email, role?})
      const member = manager.addMember({
        name: 'Bob',
        email: 'bob@example.com',
      });

      expect(member).toBeDefined();
      expect(member.name).toBe('Bob');
      expect(member.email).toBe('bob@example.com');
      expect(member.role).toBe('operator');
    });

    it('throws for duplicate email', () => {
      expect(() =>
        manager.addMember({
          name: 'Alice Duplicate',
          email: 'alice@example.com',
        })
      ).toThrow();
    });
  });

  describe('removeMember', () => {
    it('removes a member', () => {
      manager.initTeam('Engineering');

      const bob = manager.addMember({
        name: 'Bob',
        email: 'bob@example.com',
      });

      manager.removeMember(bob.id);

      const members = manager.listMembers();
      const bobFound = members.find((m: any) => m.id === bob.id);
      expect(bobFound).toBeUndefined();
    });
  });

  describe('setMemberRole', () => {
    it('updates role', () => {
      manager.initTeam('Engineering');

      const bob = manager.addMember({
        name: 'Bob',
        email: 'bob@example.com',
      });

      manager.setMemberRole(bob.id, 'admin');

      const updated = manager.getMember(bob.id);
      expect(updated).toBeDefined();
      expect(updated!.role).toBe('admin');
    });
  });

  describe('getMember', () => {
    it('returns member by ID', () => {
      manager.initTeam('Engineering');

      const bob = manager.addMember({
        name: 'Bob',
        email: 'bob@example.com',
      });

      const found = manager.getMember(bob.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(bob.id);
      expect(found!.name).toBe('Bob');
    });
  });

  describe('getMemberByEmail', () => {
    it('returns member by email', () => {
      manager.initTeam('Engineering');

      manager.addMember({
        name: 'Bob',
        email: 'bob@example.com',
      });

      const found = manager.getMemberByEmail('bob@example.com');
      expect(found).toBeDefined();
      expect(found!.email).toBe('bob@example.com');
      expect(found!.name).toBe('Bob');
    });
  });

  describe('listMembers', () => {
    it('lists all members', () => {
      manager.initTeam('Engineering');

      manager.addMember({ name: 'Bob', email: 'bob@example.com' });
      manager.addMember({ name: 'Charlie', email: 'charlie@example.com' });

      const members = manager.listMembers();
      // Alice (from git identity) + Bob + Charlie = 3
      expect(members).toHaveLength(3);
    });
  });

  describe('hasPermission', () => {
    let viewerId: string;
    let operatorId: string;
    let adminId: string;

    beforeEach(() => {
      manager.initTeam('Engineering');

      const adminMember = manager.listMembers()[0];
      adminId = adminMember.id;

      const operator = manager.addMember({
        name: 'Operator',
        email: 'operator@example.com',
      });
      operatorId = operator.id;

      const viewer = manager.addMember({
        name: 'Viewer',
        email: 'viewer@example.com',
      });
      manager.setMemberRole(viewer.id, 'viewer');
      viewerId = viewer.id;
    });

    it('checks viewer permissions (canView:true, canSteer:false)', () => {
      expect(manager.hasPermission(viewerId, 'canView')).toBe(true);
      expect(manager.hasPermission(viewerId, 'canSteer')).toBe(false);
    });

    it('checks operator permissions (canSteer:true)', () => {
      expect(manager.hasPermission(operatorId, 'canSteer')).toBe(true);
    });

    it('checks admin permissions (canAdmin:true)', () => {
      expect(manager.hasPermission(adminId, 'canAdmin')).toBe(true);
    });
  });

  describe('secrets', () => {
    beforeEach(() => {
      manager.initTeam('Engineering');
    });

    it('setTeamSecret and getTeamSecret encrypt/decrypt', () => {
      manager.setTeamSecret('API_KEY', 'super-secret-value');

      const value = manager.getTeamSecret('API_KEY');
      expect(value).toBe('super-secret-value');
    });

    it('setPersonalSecret and getPersonalSecret encrypt/decrypt', () => {
      const member = manager.listMembers()[0];

      manager.setPersonalSecret(member.id, 'MY_TOKEN', 'personal-secret');

      const value = manager.getPersonalSecret(member.id, 'MY_TOKEN');
      expect(value).toBe('personal-secret');
    });

    it('listSecretKeys returns key names', () => {
      manager.setTeamSecret('API_KEY', 'value1');
      manager.setTeamSecret('DB_PASSWORD', 'value2');

      // listSecretKeys returns { team: string[], personal: string[] }
      const keys = manager.listSecretKeys();
      expect(keys.team).toContain('API_KEY');
      expect(keys.team).toContain('DB_PASSWORD');
      expect(keys.team).toHaveLength(2);
    });
  });

  describe('resolveGitIdentity', () => {
    it('returns identity when git config is available', () => {
      manager.initTeam('Engineering');

      const identity = manager.resolveGitIdentity();
      expect(identity).toBeDefined();
      expect(identity).not.toBeNull();
      expect(identity).toEqual(
        expect.objectContaining({
          name: 'Alice',
          email: 'alice@example.com',
        })
      );
    });

    it('returns null when git config is not available', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('git not found');
      });

      const mgr = new TeamManager();
      const identity = mgr.resolveGitIdentity();
      expect(identity).toBeNull();
    });
  });
});
