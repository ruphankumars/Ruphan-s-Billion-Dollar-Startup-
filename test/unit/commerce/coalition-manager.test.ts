import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CoalitionManager } from '../../../src/commerce/coalition-manager.js';

describe('CoalitionManager', () => {
  let manager: CoalitionManager;

  beforeEach(() => {
    manager = new CoalitionManager();
  });

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts and stops', () => {
      expect(manager.isRunning()).toBe(false);
      manager.start();
      expect(manager.isRunning()).toBe(true);
      manager.stop();
      expect(manager.isRunning()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // formCoalition() (createCoalition)
  // ─────────────────────────────────────────────────────────

  describe('formCoalition()', () => {
    it('creates a coalition with the lead agent as first member', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'divide-and-conquer');

      expect(coalition.id).toMatch(/^coal_/);
      expect(coalition.leadAgentId).toBe('agent-lead');
      expect(coalition.memberAgentIds).toEqual(['agent-lead']);
      expect(coalition.taskId).toBe('task-1');
      expect(coalition.strategy).toBe('divide-and-conquer');
      expect(coalition.status).toBe('forming');
      expect(coalition.sharedBudget).toBe(0);
      expect(coalition.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('accepts a shared budget', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy', 5000);

      expect(coalition.sharedBudget).toBe(5000);
    });

    it('emits commerce:coalition:formed event', () => {
      const listener = vi.fn();
      manager.on('commerce:coalition:formed', listener);

      manager.formCoalition('agent-lead', 'task-1', 'strategy');

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────
  // joinCoalition() (join)
  // ─────────────────────────────────────────────────────────

  describe('joinCoalition()', () => {
    it('adds a member to a forming coalition', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');

      const updated = manager.joinCoalition(coalition.id, 'agent-2');

      expect(updated.memberAgentIds).toContain('agent-2');
      expect(updated.memberAgentIds).toHaveLength(2);
    });

    it('emits commerce:coalition:joined event', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');

      const listener = vi.fn();
      manager.on('commerce:coalition:joined', listener);

      manager.joinCoalition(coalition.id, 'agent-2');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          coalitionId: coalition.id,
          agentId: 'agent-2',
          memberCount: 2,
        }),
      );
    });

    it('throws for non-existent coalition', () => {
      expect(() => manager.joinCoalition('nonexistent', 'agent-2'))
        .toThrow('Coalition not found');
    });

    it('throws when coalition is not in forming state', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');
      manager.activateCoalition(coalition.id);

      expect(() => manager.joinCoalition(coalition.id, 'agent-3'))
        .toThrow('cannot join');
    });

    it('throws when agent is already a member', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');

      expect(() => manager.joinCoalition(coalition.id, 'agent-lead'))
        .toThrow('already a member');
    });
  });

  // ─────────────────────────────────────────────────────────
  // leaveCoalition()
  // ─────────────────────────────────────────────────────────

  describe('leaveCoalition()', () => {
    it('removes a non-lead member from the coalition', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');

      const updated = manager.leaveCoalition(coalition.id, 'agent-2');

      expect(updated.memberAgentIds).not.toContain('agent-2');
      expect(updated.memberAgentIds).toHaveLength(1);
    });

    it('throws when lead agent tries to leave', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');

      expect(() => manager.leaveCoalition(coalition.id, 'agent-lead'))
        .toThrow('Lead agent cannot leave');
    });

    it('throws for non-existent coalition', () => {
      expect(() => manager.leaveCoalition('nonexistent', 'agent-2'))
        .toThrow('Coalition not found');
    });

    it('throws when agent is not a member', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');

      expect(() => manager.leaveCoalition(coalition.id, 'non-member'))
        .toThrow('is not a member');
    });

    it('throws when coalition is completed or dissolved', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');
      manager.activateCoalition(coalition.id);
      manager.completeCoalition(coalition.id);

      expect(() => manager.leaveCoalition(coalition.id, 'agent-2'))
        .toThrow('cannot leave');
    });
  });

  // ─────────────────────────────────────────────────────────
  // activateCoalition() — requires min 2 members
  // ─────────────────────────────────────────────────────────

  describe('activateCoalition()', () => {
    it('activates a coalition with 2 or more members', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');

      const activated = manager.activateCoalition(coalition.id);

      expect(activated.status).toBe('active');
    });

    it('throws when coalition has fewer than 2 members', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');

      expect(() => manager.activateCoalition(coalition.id))
        .toThrow('at least 2 members');
    });

    it('throws for non-existent coalition', () => {
      expect(() => manager.activateCoalition('nonexistent'))
        .toThrow('Coalition not found');
    });

    it('throws when coalition is not in forming state', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');
      manager.activateCoalition(coalition.id);

      expect(() => manager.activateCoalition(coalition.id))
        .toThrow('can only activate');
    });

    it('emits commerce:coalition:activated event', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');

      const listener = vi.fn();
      manager.on('commerce:coalition:activated', listener);

      manager.activateCoalition(coalition.id);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          coalitionId: coalition.id,
          memberCount: 2,
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // completeCoalition() / dissolveCoalition() — lifecycle
  // ─────────────────────────────────────────────────────────

  describe('completeCoalition()', () => {
    it('marks an active coalition as completed', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');
      manager.activateCoalition(coalition.id);

      const completed = manager.completeCoalition(coalition.id);

      expect(completed.status).toBe('completed');
    });

    it('throws when coalition is not active', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');

      expect(() => manager.completeCoalition(coalition.id))
        .toThrow('can only complete');
    });

    it('throws for non-existent coalition', () => {
      expect(() => manager.completeCoalition('nonexistent'))
        .toThrow('Coalition not found');
    });

    it('emits commerce:coalition:completed event', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');
      manager.activateCoalition(coalition.id);

      const listener = vi.fn();
      manager.on('commerce:coalition:completed', listener);

      manager.completeCoalition(coalition.id);

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('dissolveCoalition()', () => {
    it('dissolves a forming coalition', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');

      const dissolved = manager.dissolveCoalition(coalition.id);

      expect(dissolved.status).toBe('dissolved');
    });

    it('dissolves an active coalition', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');
      manager.activateCoalition(coalition.id);

      const dissolved = manager.dissolveCoalition(coalition.id);

      expect(dissolved.status).toBe('dissolved');
    });

    it('throws when coalition is already completed', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');
      manager.activateCoalition(coalition.id);
      manager.completeCoalition(coalition.id);

      expect(() => manager.dissolveCoalition(coalition.id))
        .toThrow('already completed');
    });

    it('throws when coalition is already dissolved', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.dissolveCoalition(coalition.id);

      expect(() => manager.dissolveCoalition(coalition.id))
        .toThrow('already dissolved');
    });

    it('throws for non-existent coalition', () => {
      expect(() => manager.dissolveCoalition('nonexistent'))
        .toThrow('Coalition not found');
    });

    it('emits commerce:coalition:dissolved event', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');

      const listener = vi.fn();
      manager.on('commerce:coalition:dissolved', listener);

      manager.dissolveCoalition(coalition.id);

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────
  // Full lifecycle test
  // ─────────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('forming -> join -> activate -> complete', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy', 1000);
      expect(coalition.status).toBe('forming');

      manager.joinCoalition(coalition.id, 'agent-2');
      manager.joinCoalition(coalition.id, 'agent-3');

      const activated = manager.activateCoalition(coalition.id);
      expect(activated.status).toBe('active');
      expect(activated.memberAgentIds).toHaveLength(3);

      const completed = manager.completeCoalition(coalition.id);
      expect(completed.status).toBe('completed');
    });

    it('forming -> join -> activate -> dissolve', () => {
      const coalition = manager.formCoalition('agent-lead', 'task-1', 'strategy');
      manager.joinCoalition(coalition.id, 'agent-2');
      manager.activateCoalition(coalition.id);

      const dissolved = manager.dissolveCoalition(coalition.id);
      expect(dissolved.status).toBe('dissolved');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Listing
  // ─────────────────────────────────────────────────────────

  describe('listCoalitions()', () => {
    it('lists all coalitions', () => {
      manager.formCoalition('agent-1', 'task-1', 'strategy-1');
      manager.formCoalition('agent-2', 'task-2', 'strategy-2');

      const all = manager.listCoalitions();
      expect(all).toHaveLength(2);
    });

    it('filters by status', () => {
      const c1 = manager.formCoalition('agent-1', 'task-1', 'strategy-1');
      manager.formCoalition('agent-2', 'task-2', 'strategy-2');
      manager.dissolveCoalition(c1.id);

      const forming = manager.listCoalitions('forming');
      expect(forming).toHaveLength(1);

      const dissolved = manager.listCoalitions('dissolved');
      expect(dissolved).toHaveLength(1);
    });
  });

  describe('getCoalition()', () => {
    it('returns a coalition by ID', () => {
      const coalition = manager.formCoalition('agent-1', 'task-1', 'strategy');

      const found = manager.getCoalition(coalition.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(coalition.id);
    });

    it('returns undefined for unknown ID', () => {
      expect(manager.getCoalition('nonexistent')).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────
  // getStats()
  // ─────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns zero counts initially', () => {
      const stats = manager.getStats();
      expect(stats.total).toBe(0);
      expect(stats.forming).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.dissolved).toBe(0);
      expect(stats.avgMemberCount).toBe(0);
      expect(stats.totalBudget).toBe(0);
    });

    it('tracks coalition statistics', () => {
      const c1 = manager.formCoalition('agent-1', 'task-1', 'strategy', 500);
      manager.joinCoalition(c1.id, 'agent-2');
      manager.activateCoalition(c1.id);

      const c2 = manager.formCoalition('agent-3', 'task-2', 'strategy', 1000);

      const stats = manager.getStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(1);
      expect(stats.forming).toBe(1);
      expect(stats.totalBudget).toBe(1500);
      expect(stats.avgMemberCount).toBe(1.5); // (2 + 1) / 2
    });
  });
});
