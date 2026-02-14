/**
 * Workforce Module — CortexOS Agent Workforce Planner
 *
 * Plans and optimizes human-agent workforce allocation with availability-aware
 * scheduling, skill gap analysis, capacity forecasting, and greedy optimization.
 *
 * @example
 * ```typescript
 * import { WorkforcePlanner } from 'cortexos/workforce';
 *
 * const planner = new WorkforcePlanner({ utilizationTarget: 0.8 });
 * planner.start();
 *
 * const dev = planner.addEntity({
 *   type: 'agent',
 *   name: 'CodeBot-1',
 *   skills: ['typescript', 'python'],
 *   capacity: 40,
 *   costPerHour: 0.50,
 *   availability: [{ dayOfWeek: 1, startHour: 0, endHour: 24 }],
 * });
 *
 * const plan = planner.createPlan('Sprint 1', { start: Date.now(), end: Date.now() + 14 * 86400000 });
 * planner.assignTask(plan.id, 'task-001', dev.id, 8, 7);
 * ```
 */

export { WorkforcePlanner } from './workforce-planner.js';
export type {
  WorkforceEntity,
  AvailabilityWindow,
  WorkforcePlan,
  TaskAssignment,
  SkillGap,
  CapacityForecast,
  WorkforceConfig,
  WorkforceStats,
} from './types.js';
