/**
 * CoalitionManager — Agent Coalition Formation
 *
 * Manages coalitions of agents that collaborate on shared tasks.
 * Handles formation, membership, activation, and dissolution.
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Coalition, CoalitionStatus } from './types.js';

// ═══════════════════════════════════════════════════════════════
// COALITION MANAGER
// ═══════════════════════════════════════════════════════════════

export class CoalitionManager extends EventEmitter {
  private coalitions: Map<string, Coalition> = new Map();
  private running = false;

  constructor() {
    super();
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('commerce:coalition:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('commerce:coalition:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Form a new coalition with a lead agent.
   */
  formCoalition(
    leadAgentId: string,
    taskId: string,
    strategy: string,
    sharedBudget = 0,
  ): Coalition {
    const id = `coal_${randomUUID().slice(0, 8)}`;

    const coalition: Coalition = {
      id,
      leadAgentId,
      memberAgentIds: [leadAgentId],
      taskId,
      strategy,
      status: 'forming',
      sharedBudget,
      createdAt: Date.now(),
    };

    this.coalitions.set(id, coalition);

    this.emit('commerce:coalition:formed', {
      timestamp: Date.now(),
      coalition,
    });

    return coalition;
  }

  /**
   * Add an agent to an existing coalition.
   */
  joinCoalition(coalitionId: string, agentId: string): Coalition {
    const coalition = this.coalitions.get(coalitionId);
    if (!coalition) {
      throw new Error(`Coalition not found: ${coalitionId}`);
    }
    if (coalition.status !== 'forming') {
      throw new Error(`Coalition ${coalitionId} is ${coalition.status}, cannot join`);
    }
    if (coalition.memberAgentIds.includes(agentId)) {
      throw new Error(`Agent ${agentId} is already a member of coalition ${coalitionId}`);
    }

    coalition.memberAgentIds.push(agentId);

    this.emit('commerce:coalition:joined', {
      timestamp: Date.now(),
      coalitionId,
      agentId,
      memberCount: coalition.memberAgentIds.length,
    });

    return coalition;
  }

  /**
   * Remove an agent from a coalition.
   */
  leaveCoalition(coalitionId: string, agentId: string): Coalition {
    const coalition = this.coalitions.get(coalitionId);
    if (!coalition) {
      throw new Error(`Coalition not found: ${coalitionId}`);
    }
    if (coalition.status === 'completed' || coalition.status === 'dissolved') {
      throw new Error(`Coalition ${coalitionId} is ${coalition.status}, cannot leave`);
    }
    if (agentId === coalition.leadAgentId) {
      throw new Error('Lead agent cannot leave the coalition. Use dissolveCoalition() instead.');
    }

    const index = coalition.memberAgentIds.indexOf(agentId);
    if (index === -1) {
      throw new Error(`Agent ${agentId} is not a member of coalition ${coalitionId}`);
    }

    coalition.memberAgentIds.splice(index, 1);

    this.emit('commerce:coalition:left', {
      timestamp: Date.now(),
      coalitionId,
      agentId,
      memberCount: coalition.memberAgentIds.length,
    });

    return coalition;
  }

  /**
   * Activate a coalition to begin working on the task.
   */
  activateCoalition(coalitionId: string): Coalition {
    const coalition = this.coalitions.get(coalitionId);
    if (!coalition) {
      throw new Error(`Coalition not found: ${coalitionId}`);
    }
    if (coalition.status !== 'forming') {
      throw new Error(`Coalition ${coalitionId} is ${coalition.status}, can only activate from 'forming'`);
    }
    if (coalition.memberAgentIds.length < 2) {
      throw new Error('Coalition needs at least 2 members to activate');
    }

    coalition.status = 'active';

    this.emit('commerce:coalition:activated', {
      timestamp: Date.now(),
      coalitionId,
      memberCount: coalition.memberAgentIds.length,
    });

    return coalition;
  }

  /**
   * Mark a coalition as completed.
   */
  completeCoalition(coalitionId: string): Coalition {
    const coalition = this.coalitions.get(coalitionId);
    if (!coalition) {
      throw new Error(`Coalition not found: ${coalitionId}`);
    }
    if (coalition.status !== 'active') {
      throw new Error(`Coalition ${coalitionId} is ${coalition.status}, can only complete from 'active'`);
    }

    coalition.status = 'completed';

    this.emit('commerce:coalition:completed', {
      timestamp: Date.now(),
      coalitionId,
    });

    return coalition;
  }

  /**
   * Dissolve a coalition, ending all activity.
   */
  dissolveCoalition(coalitionId: string): Coalition {
    const coalition = this.coalitions.get(coalitionId);
    if (!coalition) {
      throw new Error(`Coalition not found: ${coalitionId}`);
    }
    if (coalition.status === 'completed' || coalition.status === 'dissolved') {
      throw new Error(`Coalition ${coalitionId} is already ${coalition.status}`);
    }

    coalition.status = 'dissolved';

    this.emit('commerce:coalition:dissolved', {
      timestamp: Date.now(),
      coalitionId,
    });

    return coalition;
  }

  /**
   * Get a coalition by ID.
   */
  getCoalition(id: string): Coalition | undefined {
    return this.coalitions.get(id);
  }

  /**
   * List all coalitions, optionally filtered by status.
   */
  listCoalitions(status?: CoalitionStatus): Coalition[] {
    let results = [...this.coalitions.values()];

    if (status) {
      results = results.filter((c) => c.status === status);
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get statistics.
   */
  getStats(): {
    total: number;
    forming: number;
    active: number;
    completed: number;
    dissolved: number;
    avgMemberCount: number;
    totalBudget: number;
  } {
    const all = [...this.coalitions.values()];
    const totalMembers = all.reduce((sum, c) => sum + c.memberAgentIds.length, 0);
    const totalBudget = all.reduce((sum, c) => sum + c.sharedBudget, 0);

    return {
      total: all.length,
      forming: all.filter((c) => c.status === 'forming').length,
      active: all.filter((c) => c.status === 'active').length,
      completed: all.filter((c) => c.status === 'completed').length,
      dissolved: all.filter((c) => c.status === 'dissolved').length,
      avgMemberCount: all.length > 0 ? totalMembers / all.length : 0,
      totalBudget,
    };
  }
}
