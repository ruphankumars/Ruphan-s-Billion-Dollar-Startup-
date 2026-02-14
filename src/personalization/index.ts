/**
 * Personalization Module — CortexOS User Behavior Model
 *
 * Tracks user behavior, manages preferences, segments users, and provides
 * context-aware recommendations for personalized agent experiences.
 *
 * @example
 * ```typescript
 * import { UserBehaviorModel } from 'cortexos/personalization';
 *
 * const model = new UserBehaviorModel({ enabled: true });
 * model.start();
 *
 * model.trackEvent('user-1', 'file-edit', { file: 'main.ts' });
 * model.setPreference('user-1', 'theme', 'dark');
 * const recommendation = model.getRecommendation('user-1', {});
 * ```
 */

export { UserBehaviorModel } from './user-behavior-model.js';
export type {
  UserPreference,
  BehaviorEvent,
  UserProfile,
  PersonalizationRule,
  PersonalizationConfig,
  PersonalizationStats,
} from './types.js';
