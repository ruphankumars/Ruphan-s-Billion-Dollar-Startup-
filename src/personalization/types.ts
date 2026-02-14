/**
 * Personalization Types — CortexOS User Behavior Model
 *
 * Type definitions for user preference tracking, behavior event recording,
 * profile management, and personalization rule evaluation.
 */

// ═══════════════════════════════════════════════════════════════
// USER PREFERENCES
// ═══════════════════════════════════════════════════════════════

export interface UserPreference {
  id: string;
  key: string;
  value: unknown;
  confidence: number;
  source: 'explicit' | 'inferred' | 'default';
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// BEHAVIOR EVENTS
// ═══════════════════════════════════════════════════════════════

export interface BehaviorEvent {
  id: string;
  userId: string;
  action: string;
  context: Record<string, unknown>;
  timestamp: number;
  sessionId: string;
}

// ═══════════════════════════════════════════════════════════════
// USER PROFILES
// ═══════════════════════════════════════════════════════════════

export interface UserProfile {
  userId: string;
  preferences: UserPreference[];
  behaviorHistory: string[];
  segments: string[];
  lastActive: number;
  totalSessions: number;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// PERSONALIZATION RULES
// ═══════════════════════════════════════════════════════════════

export interface PersonalizationRule {
  id: string;
  segment: string;
  preference: string;
  value: unknown;
  priority: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface PersonalizationConfig {
  enabled: boolean;
  maxEvents: number;
  maxPreferences: number;
  inferenceThreshold: number;
  sessionTimeoutMs: number;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface PersonalizationStats {
  totalUsers: number;
  totalEvents: number;
  totalPreferences: number;
  avgPreferencesPerUser: number;
  totalSegments: number;
}
