/**
 * Self-Improvement Loop — CortexOS
 *
 * Barrel exports for the self-improvement subsystem.
 */

export { FeedbackLoop } from './feedback-loop.js';
export { RegressionDetector } from './regression-detector.js';
export { CapabilityExpander } from './capability-expander.js';
export type {
  FeedbackRecord,
  FeedbackMetrics,
  RegressionAlert,
  CapabilityGap,
  SelfImproveConfig,
  SelfImproveStats,
} from './types.js';
