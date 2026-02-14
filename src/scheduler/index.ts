/**
 * Scheduler Module — CortexOS Semantic Scheduler
 *
 * Classifies tasks by semantic type, assigns resource profiles, and
 * manages a priority queue with fair-share scheduling.
 *
 * @example
 * ```typescript
 * import { SemanticScheduler } from 'cortexos/scheduler';
 *
 * const scheduler = new SemanticScheduler({ maxQueueSize: 500 });
 * scheduler.start();
 *
 * const task = scheduler.schedule({
 *   description: 'Review the authentication module for security issues',
 *   semanticType: 'code-review',
 *   priority: 8,
 *   estimatedTokens: 3000,
 *   estimatedDuration: 45000,
 *   requiredCapabilities: ['typescript'],
 * });
 *
 * const next = scheduler.dequeue();
 * ```
 */

export { SemanticScheduler } from './semantic-scheduler.js';
export type {
  SemanticTask,
  TaskSemanticType,
  ResourceSlot,
  ResourceProfile,
  SchedulerQueue,
  SchedulerConfig,
  SchedulerStats,
} from './types.js';
