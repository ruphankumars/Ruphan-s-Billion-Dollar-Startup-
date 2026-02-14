/**
 * WorkforcePlanner — Unit Tests
 *
 * Tests agent workforce planning: lifecycle, entity management,
 * plan creation, task assignment with capacity checks, skill gap analysis,
 * capacity forecasting, greedy optimization, and statistics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkforcePlanner } from '../../../src/workforce/workforce-planner.js';

describe('WorkforcePlanner', () => {
  let planner: WorkforcePlanner;

  beforeEach(() => {
    planner = new WorkforcePlanner();
  });

  afterEach(() => {
    planner.stop();
  });

  /** Helper to create a standard entity */
  function addEntity(
    overrides?: Partial<{
      type: 'human' | 'agent';
      name: string;
      skills: string[];
      capacity: number;
      costPerHour: number;
    }>,
  ) {
    return planner.addEntity({
      type: overrides?.type ?? 'agent',
      name: overrides?.name ?? 'Worker',
      skills: overrides?.skills ?? ['coding', 'review'],
      capacity: overrides?.capacity ?? 40,
      costPerHour: overrides?.costPerHour ?? 50,
      availability: [
        { dayOfWeek: 1, startHour: 9, endHour: 17 },
        { dayOfWeek: 2, startHour: 9, endHour: 17 },
        { dayOfWeek: 3, startHour: 9, endHour: 17 },
        { dayOfWeek: 4, startHour: 9, endHour: 17 },
        { dayOfWeek: 5, startHour: 9, endHour: 17 },
      ],
    });
  }

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('creates planner with default config', () => {
      expect(planner.isRunning()).toBe(false);
      expect(planner.getStats().totalEntities).toBe(0);
    });

    it('merges partial config', () => {
      const custom = new WorkforcePlanner({ maxEntities: 10 });
      expect(custom.getStats().totalEntities).toBe(0);
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('start / stop lifecycle', () => {
    it('starts and emits started event', () => {
      const handler = vi.fn();
      planner.on('workforce:started', handler);
      planner.start();
      expect(planner.isRunning()).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('stops and emits stopped event', () => {
      const handler = vi.fn();
      planner.on('workforce:stopped', handler);
      planner.start();
      planner.stop();
      expect(planner.isRunning()).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('double start is idempotent', () => {
      const handler = vi.fn();
      planner.on('workforce:started', handler);
      planner.start();
      planner.start();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Entity Management ──────────────────────────────────────

  describe('addEntity / removeEntity', () => {
    it('adds entity with generated id and default load/performance', () => {
      const entity = addEntity({ name: 'Alice', type: 'human' });

      expect(entity.id).toMatch(/^ent-/);
      expect(entity.name).toBe('Alice');
      expect(entity.type).toBe('human');
      expect(entity.currentLoad).toBe(0);
      expect(entity.performance).toBe(1.0);
    });

    it('throws when max entities reached', () => {
      const limited = new WorkforcePlanner({ maxEntities: 1 });
      limited.addEntity({
        type: 'agent',
        name: 'A',
        skills: [],
        capacity: 10,
        costPerHour: 10,
        availability: [],
      });

      expect(() =>
        limited.addEntity({
          type: 'agent',
          name: 'B',
          skills: [],
          capacity: 10,
          costPerHour: 10,
          availability: [],
        }),
      ).toThrow(/Maximum entity limit/);
    });

    it('removes entity and returns true', () => {
      const entity = addEntity();
      expect(planner.removeEntity(entity.id)).toBe(true);
      expect(planner.getEntity(entity.id)).toBeUndefined();
    });

    it('returns false for non-existent entity removal', () => {
      expect(planner.removeEntity('ghost')).toBe(false);
    });

    it('throws when removing entity with active assignments', () => {
      const entity = addEntity();
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 7 * 24 * 60 * 60 * 1000,
      });
      planner.assignTask(plan.id, 'task-1', entity.id, 5);

      expect(() => planner.removeEntity(entity.id)).toThrow(/active assignment/);
    });

    it('retrieves entity by id', () => {
      const entity = addEntity({ name: 'Bob' });
      expect(planner.getEntity(entity.id)!.name).toBe('Bob');
    });

    it('lists entities filtered by type', () => {
      addEntity({ type: 'human', name: 'H1' });
      addEntity({ type: 'agent', name: 'A1' });
      addEntity({ type: 'human', name: 'H2' });

      expect(planner.listEntities('human')).toHaveLength(2);
      expect(planner.listEntities('agent')).toHaveLength(1);
      expect(planner.listEntities()).toHaveLength(3);
    });

    it('updates entity properties', () => {
      const entity = addEntity({ name: 'Original' });
      const updated = planner.updateEntity(entity.id, {
        name: 'Updated',
        capacity: 80,
      });

      expect(updated.name).toBe('Updated');
      expect(updated.capacity).toBe(80);
    });
  });

  // ── Plan Management ────────────────────────────────────────

  describe('createPlan / getPlan', () => {
    it('creates plan with calculated capacity', () => {
      addEntity();
      const now = Date.now();
      const plan = planner.createPlan('Sprint 1', {
        start: now,
        end: now + 7 * 24 * 60 * 60 * 1000,
      });

      expect(plan.id).toMatch(/^plan-/);
      expect(plan.name).toBe('Sprint 1');
      expect(plan.totalCapacity).toBeGreaterThan(0);
      expect(plan.totalCost).toBe(0);
      expect(plan.utilizationRate).toBe(0);
      expect(plan.assignments).toHaveLength(0);
    });

    it('retrieves plan by id', () => {
      const now = Date.now();
      const plan = planner.createPlan('P', { start: now, end: now + 86400000 });
      expect(planner.getPlan(plan.id)).toBeDefined();
      expect(planner.getPlan(plan.id)!.name).toBe('P');
    });

    it('returns undefined for unknown plan', () => {
      expect(planner.getPlan('ghost')).toBeUndefined();
    });

    it('lists all plans', () => {
      const now = Date.now();
      planner.createPlan('A', { start: now, end: now + 86400000 });
      planner.createPlan('B', { start: now, end: now + 86400000 });
      expect(planner.listPlans()).toHaveLength(2);
    });
  });

  // ── Task Assignment ────────────────────────────────────────

  describe('assignTask', () => {
    it('assigns task to entity and updates load', () => {
      const entity = addEntity({ capacity: 40, costPerHour: 100 });
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 7 * 24 * 60 * 60 * 1000,
      });

      const assignment = planner.assignTask(plan.id, 'task-1', entity.id, 8);

      expect(assignment.id).toMatch(/^assign-/);
      expect(assignment.taskId).toBe('task-1');
      expect(assignment.entityId).toBe(entity.id);
      expect(assignment.estimatedHours).toBe(8);
      expect(assignment.estimatedCost).toBe(800); // 8 * 100
      expect(assignment.status).toBe('planned');

      expect(planner.getEntity(entity.id)!.currentLoad).toBe(8);
    });

    it('throws for non-existent plan', () => {
      const entity = addEntity();
      expect(() => planner.assignTask('ghost', 'task', entity.id, 5)).toThrow(/not found/);
    });

    it('throws for non-existent entity', () => {
      const now = Date.now();
      const plan = planner.createPlan('P', { start: now, end: now + 86400000 });
      expect(() => planner.assignTask(plan.id, 'task', 'ghost', 5)).toThrow(/not found/);
    });

    it('throws when entity has insufficient capacity', () => {
      const entity = addEntity({ capacity: 10 });
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 86400000,
      });

      expect(() => planner.assignTask(plan.id, 'task', entity.id, 20)).toThrow(
        /insufficient capacity/,
      );
    });

    it('updates plan cost and utilization after assignment', () => {
      const entity = addEntity({ costPerHour: 50 });
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 7 * 24 * 60 * 60 * 1000,
      });

      planner.assignTask(plan.id, 'task-1', entity.id, 10);

      const updated = planner.getPlan(plan.id)!;
      expect(updated.totalCost).toBe(500);
      expect(updated.utilizationRate).toBeGreaterThan(0);
    });

    it('completes assignment and frees capacity', () => {
      const entity = addEntity({ capacity: 40 });
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 86400000,
      });

      const assignment = planner.assignTask(plan.id, 'task', entity.id, 10);

      expect(planner.getEntity(entity.id)!.currentLoad).toBe(10);

      planner.completeAssignment(assignment.id);

      expect(planner.getEntity(entity.id)!.currentLoad).toBe(0);
      expect(assignment.status).toBe('completed');
    });
  });

  // ── Skill Gap Analysis ─────────────────────────────────────

  describe('analyzeSkillGaps', () => {
    it('identifies skills not covered by any entity', () => {
      addEntity({ skills: ['coding'] });

      const gaps = planner.analyzeSkillGaps(['coding', 'design', 'security']);
      const designGap = gaps.find((g) => g.skill === 'design');

      expect(designGap).toBeDefined();
      expect(designGap!.available).toBe(0);
      expect(designGap!.gap).toBeGreaterThan(0);
      expect(designGap!.recommendation).toContain('Critical gap');
    });

    it('shows no gap for adequately covered skills', () => {
      addEntity({ skills: ['coding'] });

      const gaps = planner.analyzeSkillGaps(['coding']);
      const codingGap = gaps.find((g) => g.skill === 'coding');

      expect(codingGap!.gap).toBe(0);
      expect(codingGap!.recommendation).toContain('adequately covered');
    });

    it('sorts gaps by gap size descending', () => {
      addEntity({ skills: ['a'] });

      const gaps = planner.analyzeSkillGaps(['a', 'b', 'c']);
      // "a" is covered, "b" and "c" are not
      for (let i = 1; i < gaps.length; i++) {
        expect(gaps[i - 1].gap).toBeGreaterThanOrEqual(gaps[i].gap);
      }
    });

    it('emits skillgaps:analyzed event', () => {
      const handler = vi.fn();
      planner.on('workforce:skillgaps:analyzed', handler);

      planner.analyzeSkillGaps(['unknown']);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Capacity Forecasting ───────────────────────────────────

  describe('forecastCapacity', () => {
    it('calculates total capacity and demand for a period', () => {
      addEntity({ capacity: 40 });
      const forecast = planner.forecastCapacity(7);

      expect(forecast.period).toBe('7 days');
      expect(forecast.totalCapacity).toBeGreaterThan(0);
      expect(forecast.totalDemand).toBe(0);
      expect(forecast.surplus).toBeGreaterThan(0);
    });

    it('accounts for active assignment demand', () => {
      const entity = addEntity({ capacity: 40 });
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 7 * 24 * 60 * 60 * 1000,
      });

      planner.assignTask(plan.id, 'task', entity.id, 20);

      const forecast = planner.forecastCapacity(7);
      expect(forecast.totalDemand).toBe(20);
      expect(forecast.surplus).toBeLessThan(forecast.totalCapacity);
    });

    it('detects bottlenecks for overloaded entities', () => {
      const entity = addEntity({ capacity: 10, name: 'Overloaded' });
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 86400000,
      });

      // Load entity to above 80% utilization target
      planner.assignTask(plan.id, 'task', entity.id, 9);

      const forecast = planner.forecastCapacity(7);
      expect(forecast.bottlenecks.length).toBeGreaterThan(0);
      expect(forecast.bottlenecks[0]).toContain('Overloaded');
    });

    it('uses default weekly hours when availability is empty', () => {
      planner.addEntity({
        type: 'agent',
        name: 'NoSchedule',
        skills: [],
        capacity: 40,
        costPerHour: 10,
        availability: [],
      });

      const forecast = planner.forecastCapacity(7);
      // With default 5*8=40 weekly hours, 7 days should yield 40 capacity hours * perf
      expect(forecast.totalCapacity).toBeGreaterThan(0);
    });
  });

  // ── Optimization ───────────────────────────────────────────

  describe('optimizeAssignments', () => {
    it('reassigns tasks from overloaded to underloaded entities', () => {
      const overloaded = addEntity({ name: 'Heavy', capacity: 10, skills: ['coding'] });
      const underloaded = addEntity({ name: 'Light', capacity: 40, skills: ['coding'] });

      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 7 * 24 * 60 * 60 * 1000,
      });

      // Load "Heavy" above utilization target (80% of 10 = 8)
      planner.assignTask(plan.id, 'task-1', overloaded.id, 9, 10);

      const reassigned = planner.optimizeAssignments(plan.id);
      expect(reassigned.length).toBeGreaterThan(0);
      expect(reassigned[0].entityId).toBe(underloaded.id);
    });

    it('does nothing when all entities are under target', () => {
      const e = addEntity({ capacity: 100 });
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 86400000,
      });

      planner.assignTask(plan.id, 'task-1', e.id, 5);

      const reassigned = planner.optimizeAssignments(plan.id);
      expect(reassigned).toHaveLength(0);
    });

    it('throws for non-existent plan', () => {
      expect(() => planner.optimizeAssignments('ghost')).toThrow(/not found/);
    });

    it('emits optimization event only when reassignments occur', () => {
      const handler = vi.fn();
      planner.on('workforce:assignments:optimized', handler);

      const e = addEntity({ capacity: 100 });
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 86400000,
      });
      planner.assignTask(plan.id, 'task', e.id, 5);

      planner.optimizeAssignments(plan.id);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zeroed stats initially', () => {
      const stats = planner.getStats();
      expect(stats.totalEntities).toBe(0);
      expect(stats.totalHumans).toBe(0);
      expect(stats.totalAgents).toBe(0);
      expect(stats.totalAssignments).toBe(0);
      expect(stats.avgUtilization).toBe(0);
      expect(stats.totalCost).toBe(0);
    });

    it('tracks entities by type', () => {
      addEntity({ type: 'human' });
      addEntity({ type: 'agent' });
      addEntity({ type: 'agent' });

      const stats = planner.getStats();
      expect(stats.totalEntities).toBe(3);
      expect(stats.totalHumans).toBe(1);
      expect(stats.totalAgents).toBe(2);
    });

    it('tracks assignments and cost', () => {
      const entity = addEntity({ costPerHour: 75 });
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 86400000,
      });

      planner.assignTask(plan.id, 'task', entity.id, 10);

      const stats = planner.getStats();
      expect(stats.totalAssignments).toBe(1);
      expect(stats.totalCost).toBe(750);
    });

    it('tracks average utilization', () => {
      const entity = addEntity({ capacity: 40 });
      const now = Date.now();
      const plan = planner.createPlan('P', {
        start: now,
        end: now + 86400000,
      });

      planner.assignTask(plan.id, 'task', entity.id, 20);

      const stats = planner.getStats();
      expect(stats.avgUtilization).toBe(0.5); // 20/40
    });
  });
});
