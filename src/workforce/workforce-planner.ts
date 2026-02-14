/**
 * WorkforcePlanner — Agent Workforce Planning Engine
 *
 * Plans and optimizes the allocation of human and AI agent workforces
 * across tasks. Supports availability-aware scheduling, skill gap analysis,
 * capacity forecasting, and greedy assignment optimization to maximize
 * utilization while respecting individual capacity limits.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  WorkforceEntity,
  AvailabilityWindow,
  WorkforcePlan,
  TaskAssignment,
  SkillGap,
  CapacityForecast,
  WorkforceConfig,
  WorkforceStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: WorkforceConfig = {
  enabled: true,
  maxEntities: 500,
  planningHorizonDays: 30,
  utilizationTarget: 0.8,
};

/** Hours in a standard work day for capacity calculations */
const STANDARD_WORK_HOURS = 8;

// ═══════════════════════════════════════════════════════════════
// WORKFORCE PLANNER
// ═══════════════════════════════════════════════════════════════

export class WorkforcePlanner extends EventEmitter {
  private config: WorkforceConfig;
  private running = false;

  /** Workforce entities keyed by entity ID */
  private entities: Map<string, WorkforceEntity> = new Map();

  /** Workforce plans keyed by plan ID */
  private plans: Map<string, WorkforcePlan> = new Map();

  /** Task assignments keyed by assignment ID */
  private assignments: Map<string, TaskAssignment> = new Map();

  constructor(config?: Partial<WorkforceConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit('workforce:started', { timestamp: Date.now() });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.emit('workforce:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // ENTITY MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Add a workforce entity (human or agent).
   */
  addEntity(
    entity: Omit<WorkforceEntity, 'id' | 'currentLoad' | 'performance'>,
  ): WorkforceEntity {
    if (this.entities.size >= this.config.maxEntities) {
      throw new Error(`Maximum entity limit reached (${this.config.maxEntities})`);
    }

    const newEntity: WorkforceEntity = {
      ...entity,
      id: `ent-${randomUUID().slice(0, 8)}`,
      currentLoad: 0,
      performance: 1.0,
    };

    this.entities.set(newEntity.id, newEntity);

    this.emit('workforce:entity:added', { entity: newEntity, timestamp: Date.now() });
    return newEntity;
  }

  /**
   * Remove a workforce entity. Fails if entity has active assignments.
   */
  removeEntity(id: string): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;

    // Check for active assignments
    const activeAssignments = [...this.assignments.values()].filter(
      (a) => a.entityId === id && a.status !== 'completed',
    );
    if (activeAssignments.length > 0) {
      throw new Error(
        `Cannot remove entity "${id}" — has ${activeAssignments.length} active assignment(s)`,
      );
    }

    this.entities.delete(id);
    this.emit('workforce:entity:removed', { id, timestamp: Date.now() });
    return true;
  }

  /**
   * Update an existing workforce entity's properties.
   */
  updateEntity(
    id: string,
    updates: Partial<Omit<WorkforceEntity, 'id'>>,
  ): WorkforceEntity {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new Error(`Entity "${id}" not found`);
    }

    // Apply updates selectively
    if (updates.type !== undefined) entity.type = updates.type;
    if (updates.name !== undefined) entity.name = updates.name;
    if (updates.skills !== undefined) entity.skills = [...updates.skills];
    if (updates.capacity !== undefined) entity.capacity = updates.capacity;
    if (updates.currentLoad !== undefined) entity.currentLoad = updates.currentLoad;
    if (updates.costPerHour !== undefined) entity.costPerHour = updates.costPerHour;
    if (updates.availability !== undefined) entity.availability = [...updates.availability];
    if (updates.performance !== undefined) entity.performance = updates.performance;

    this.emit('workforce:entity:updated', { entity, timestamp: Date.now() });
    return entity;
  }

  /**
   * Get an entity by ID.
   */
  getEntity(id: string): WorkforceEntity | undefined {
    return this.entities.get(id);
  }

  /**
   * List entities, optionally filtered by type.
   */
  listEntities(type?: WorkforceEntity['type']): WorkforceEntity[] {
    const all = [...this.entities.values()];
    if (type) {
      return all.filter((e) => e.type === type);
    }
    return all;
  }

  // ─────────────────────────────────────────────────────────
  // PLAN MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Create a new workforce plan for a given time period.
   */
  createPlan(
    name: string,
    period: { start: number; end: number },
  ): WorkforcePlan {
    const now = Date.now();
    const entities = [...this.entities.values()];

    // Calculate total capacity for the plan period
    const periodDays = Math.max(
      1,
      Math.ceil((period.end - period.start) / (24 * 60 * 60 * 1000)),
    );
    const totalCapacity = entities.reduce((sum, e) => {
      const weeklyHours = this.calculateWeeklyHours(e.availability);
      const dailyHours = weeklyHours / 7;
      return sum + dailyHours * periodDays * e.performance;
    }, 0);

    const plan: WorkforcePlan = {
      id: `plan-${randomUUID().slice(0, 8)}`,
      name,
      period: { ...period },
      entities: entities.map((e) => ({ ...e })),
      assignments: [],
      totalCost: 0,
      totalCapacity: Math.round(totalCapacity * 100) / 100,
      utilizationRate: 0,
      createdAt: now,
    };

    this.plans.set(plan.id, plan);

    this.emit('workforce:plan:created', { plan, timestamp: now });
    return plan;
  }

  /**
   * Get a plan by ID.
   */
  getPlan(id: string): WorkforcePlan | undefined {
    return this.plans.get(id);
  }

  /**
   * List all plans.
   */
  listPlans(): WorkforcePlan[] {
    return [...this.plans.values()];
  }

  // ─────────────────────────────────────────────────────────
  // TASK ASSIGNMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Assign a task to an entity within a plan.
   * Checks that the entity has sufficient remaining capacity.
   */
  assignTask(
    planId: string,
    taskId: string,
    entityId: string,
    estimatedHours: number,
    priority?: number,
  ): TaskAssignment {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan "${planId}" not found`);
    }

    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new Error(`Entity "${entityId}" not found`);
    }

    // Check capacity
    const remainingCapacity = entity.capacity - entity.currentLoad;
    if (estimatedHours > remainingCapacity) {
      throw new Error(
        `Entity "${entityId}" has insufficient capacity: ` +
          `${remainingCapacity.toFixed(1)}h remaining, ${estimatedHours}h required`,
      );
    }

    const estimatedCost = Math.round(estimatedHours * entity.costPerHour * 100) / 100;

    const assignment: TaskAssignment = {
      id: `assign-${randomUUID().slice(0, 8)}`,
      taskId,
      entityId,
      estimatedHours,
      estimatedCost,
      priority: priority ?? 5,
      status: 'planned',
    };

    this.assignments.set(assignment.id, assignment);
    plan.assignments.push(assignment);

    // Update entity load
    entity.currentLoad += estimatedHours;

    // Update plan cost and utilization
    plan.totalCost += estimatedCost;
    const totalAssignedHours = plan.assignments.reduce(
      (sum, a) => sum + a.estimatedHours,
      0,
    );
    plan.utilizationRate =
      plan.totalCapacity > 0
        ? Math.round((totalAssignedHours / plan.totalCapacity) * 10000) / 10000
        : 0;

    this.emit('workforce:task:assigned', { assignment, timestamp: Date.now() });
    return assignment;
  }

  /**
   * Mark a task assignment as completed and free entity capacity.
   */
  completeAssignment(assignmentId: string): TaskAssignment {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) {
      throw new Error(`Assignment "${assignmentId}" not found`);
    }

    assignment.status = 'completed';

    // Free entity capacity
    const entity = this.entities.get(assignment.entityId);
    if (entity) {
      entity.currentLoad = Math.max(0, entity.currentLoad - assignment.estimatedHours);
    }

    this.emit('workforce:assignment:completed', {
      assignment,
      timestamp: Date.now(),
    });

    return assignment;
  }

  // ─────────────────────────────────────────────────────────
  // ANALYTICS — Skill Gap Analysis
  // ─────────────────────────────────────────────────────────

  /**
   * Analyze skill gaps between required skills and available workforce skills.
   * Returns a list of gaps with recommendations.
   */
  analyzeSkillGaps(requiredSkills: string[]): SkillGap[] {
    const gaps: SkillGap[] = [];
    const allEntities = [...this.entities.values()];

    // Count how many entities have each skill
    const skillCoverage = new Map<string, number>();
    for (const entity of allEntities) {
      for (const skill of entity.skills) {
        skillCoverage.set(skill, (skillCoverage.get(skill) ?? 0) + 1);
      }
    }

    // Analyze each required skill
    for (const skill of requiredSkills) {
      const available = skillCoverage.get(skill) ?? 0;
      // Required count: at least 1, or proportional to workforce size
      const required = Math.max(1, Math.ceil(allEntities.length * 0.1));
      const gap = Math.max(0, required - available);

      let recommendation: string;
      if (gap === 0) {
        recommendation = `Skill "${skill}" is adequately covered (${available} entities)`;
      } else if (available === 0) {
        recommendation = `Critical gap: No entities have "${skill}". Hire or train ${gap} resources`;
      } else {
        recommendation = `Partial gap: ${available}/${required} entities have "${skill}". Consider training ${gap} more`;
      }

      gaps.push({
        skill,
        required,
        available,
        gap,
        recommendation,
      });
    }

    // Sort by gap size (largest gaps first)
    gaps.sort((a, b) => b.gap - a.gap);

    this.emit('workforce:skillgaps:analyzed', {
      totalGaps: gaps.filter((g) => g.gap > 0).length,
      timestamp: Date.now(),
    });

    return gaps;
  }

  // ─────────────────────────────────────────────────────────
  // ANALYTICS — Capacity Forecasting
  // ─────────────────────────────────────────────────────────

  /**
   * Forecast capacity vs. demand for a given period.
   * Calculates total available hours based on entity availability
   * windows and current assignment loads.
   */
  forecastCapacity(periodDays: number): CapacityForecast {
    const allEntities = [...this.entities.values()];
    const bottlenecks: string[] = [];

    // Calculate total available capacity
    let totalCapacity = 0;
    for (const entity of allEntities) {
      const weeklyHours = this.calculateWeeklyHours(entity.availability);
      const dailyHours = weeklyHours / 7;
      const entityCapacity = dailyHours * periodDays * entity.performance;
      totalCapacity += entityCapacity;

      // Detect bottlenecks: entities above utilization target
      const utilization = entity.capacity > 0 ? entity.currentLoad / entity.capacity : 0;
      if (utilization > this.config.utilizationTarget) {
        bottlenecks.push(
          `${entity.name} (${entity.type}) at ${Math.round(utilization * 100)}% utilization`,
        );
      }
    }

    // Calculate current demand from active assignments
    const activeAssignments = [...this.assignments.values()].filter(
      (a) => a.status !== 'completed',
    );
    const totalDemand = activeAssignments.reduce(
      (sum, a) => sum + a.estimatedHours,
      0,
    );

    // Check for skill bottlenecks
    const skillDemand = new Map<string, number>();
    for (const entity of allEntities) {
      const utilization = entity.capacity > 0 ? entity.currentLoad / entity.capacity : 0;
      if (utilization > this.config.utilizationTarget) {
        for (const skill of entity.skills) {
          skillDemand.set(skill, (skillDemand.get(skill) ?? 0) + 1);
        }
      }
    }
    for (const [skill, count] of skillDemand.entries()) {
      if (count >= 2) {
        bottlenecks.push(`High demand for "${skill}" skill (${count} overloaded entities)`);
      }
    }

    const surplus = Math.round((totalCapacity - totalDemand) * 100) / 100;

    return {
      period: `${periodDays} days`,
      totalDemand: Math.round(totalDemand * 100) / 100,
      totalCapacity: Math.round(totalCapacity * 100) / 100,
      surplus,
      bottlenecks,
    };
  }

  // ─────────────────────────────────────────────────────────
  // OPTIMIZATION
  // ─────────────────────────────────────────────────────────

  /**
   * Optimize assignments within a plan using a greedy rebalancing algorithm.
   * Reassigns tasks from overloaded entities to underloaded ones with
   * matching skills, prioritizing higher-priority tasks.
   */
  optimizeAssignments(planId: string): TaskAssignment[] {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan "${planId}" not found`);
    }

    const activeAssignments = plan.assignments.filter(
      (a) => a.status === 'planned',
    );

    // Sort by priority (highest first) for greedy assignment
    activeAssignments.sort((a, b) => b.priority - a.priority);

    const reassigned: TaskAssignment[] = [];

    for (const assignment of activeAssignments) {
      const currentEntity = this.entities.get(assignment.entityId);
      if (!currentEntity) continue;

      // Check if entity is overloaded
      const utilization =
        currentEntity.capacity > 0
          ? currentEntity.currentLoad / currentEntity.capacity
          : 1;

      if (utilization <= this.config.utilizationTarget) continue;

      // Find a better candidate entity
      const betterEntity = this.findBestEntity(assignment.estimatedHours, currentEntity.skills);
      if (!betterEntity || betterEntity.id === currentEntity.id) continue;

      // Reassign
      currentEntity.currentLoad = Math.max(
        0,
        currentEntity.currentLoad - assignment.estimatedHours,
      );
      betterEntity.currentLoad += assignment.estimatedHours;

      const oldCost = assignment.estimatedCost;
      assignment.entityId = betterEntity.id;
      assignment.estimatedCost =
        Math.round(assignment.estimatedHours * betterEntity.costPerHour * 100) / 100;

      // Update plan cost
      plan.totalCost = plan.totalCost - oldCost + assignment.estimatedCost;

      reassigned.push(assignment);
    }

    // Recalculate plan utilization
    const totalAssignedHours = plan.assignments.reduce(
      (sum, a) => sum + a.estimatedHours,
      0,
    );
    plan.utilizationRate =
      plan.totalCapacity > 0
        ? Math.round((totalAssignedHours / plan.totalCapacity) * 10000) / 10000
        : 0;

    if (reassigned.length > 0) {
      this.emit('workforce:assignments:optimized', {
        planId,
        reassigned: reassigned.length,
        timestamp: Date.now(),
      });
    }

    return reassigned;
  }

  // ─────────────────────────────────────────────────────────
  // STATISTICS
  // ─────────────────────────────────────────────────────────

  /**
   * Get workforce statistics.
   */
  getStats(): WorkforceStats {
    const allEntities = [...this.entities.values()];
    const humans = allEntities.filter((e) => e.type === 'human');
    const agents = allEntities.filter((e) => e.type === 'agent');

    const avgUtilization =
      allEntities.length > 0
        ? allEntities.reduce((sum, e) => {
            const util = e.capacity > 0 ? e.currentLoad / e.capacity : 0;
            return sum + util;
          }, 0) / allEntities.length
        : 0;

    const totalCost = [...this.assignments.values()].reduce(
      (sum, a) => sum + a.estimatedCost,
      0,
    );

    return {
      totalEntities: allEntities.length,
      totalHumans: humans.length,
      totalAgents: agents.length,
      totalAssignments: this.assignments.size,
      avgUtilization: Math.round(avgUtilization * 10000) / 10000,
      totalCost: Math.round(totalCost * 100) / 100,
    };
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — Helpers
  // ─────────────────────────────────────────────────────────

  /**
   * Calculate total weekly available hours from availability windows.
   */
  private calculateWeeklyHours(availability: AvailabilityWindow[]): number {
    if (availability.length === 0) {
      // Default: 5 standard work days
      return 5 * STANDARD_WORK_HOURS;
    }

    let totalHours = 0;
    for (const window of availability) {
      const hours = Math.max(0, window.endHour - window.startHour);
      totalHours += hours;
    }
    return totalHours;
  }

  /**
   * Find the best available entity for a task of a given duration
   * that has at least one of the required skills.
   * Uses a greedy heuristic: lowest utilization entity with matching skills.
   */
  private findBestEntity(
    requiredHours: number,
    requiredSkills: string[],
  ): WorkforceEntity | null {
    let bestEntity: WorkforceEntity | null = null;
    let bestUtilization = Infinity;

    for (const entity of this.entities.values()) {
      // Check capacity
      const remainingCapacity = entity.capacity - entity.currentLoad;
      if (remainingCapacity < requiredHours) continue;

      // Check skill match (at least one required skill)
      if (requiredSkills.length > 0) {
        const hasMatchingSkill = requiredSkills.some((skill) =>
          entity.skills.includes(skill),
        );
        if (!hasMatchingSkill) continue;
      }

      // Prefer lowest utilization
      const utilization =
        entity.capacity > 0 ? entity.currentLoad / entity.capacity : 1;
      if (utilization < bestUtilization) {
        bestUtilization = utilization;
        bestEntity = entity;
      }
    }

    return bestEntity;
  }
}
