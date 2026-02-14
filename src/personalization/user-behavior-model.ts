/**
 * UserBehaviorModel — Personalization Engine
 *
 * Tracks user behavior events, manages preferences (explicit and inferred),
 * segments users based on activity patterns, and provides context-aware
 * recommendations. Uses frequency analysis on behavior history to infer
 * preferences and a rule-based system for segment-specific defaults.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  UserPreference,
  BehaviorEvent,
  UserProfile,
  PersonalizationRule,
  PersonalizationConfig,
  PersonalizationStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: PersonalizationConfig = {
  enabled: true,
  maxEvents: 10000,
  maxPreferences: 500,
  inferenceThreshold: 0.6,
  sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
};

/** Minimum action occurrences to infer a preference */
const MIN_INFER_OCCURRENCES = 3;

/** Segment definitions: segment name -> condition checker */
const SEGMENT_DEFINITIONS: Record<string, (profile: UserProfile, events: BehaviorEvent[]) => boolean> = {
  'power-user': (profile, events) => {
    const userEvents = events.filter((e) => e.userId === profile.userId);
    return userEvents.length >= 50 || profile.totalSessions >= 10;
  },
  'new-user': (profile) => {
    const ageMs = Date.now() - profile.createdAt;
    return ageMs < 7 * 24 * 60 * 60 * 1000 && profile.totalSessions <= 3;
  },
  'inactive': (profile) => {
    const inactiveMs = Date.now() - profile.lastActive;
    return inactiveMs > 7 * 24 * 60 * 60 * 1000;
  },
  'frequent': (profile) => {
    return profile.totalSessions >= 5;
  },
  'explorer': (_profile, events) => {
    const uniqueActions = new Set(events.filter((e) => e.userId === _profile.userId).map((e) => e.action));
    return uniqueActions.size >= 10;
  },
};

// ═══════════════════════════════════════════════════════════════
// USER BEHAVIOR MODEL
// ═══════════════════════════════════════════════════════════════

export class UserBehaviorModel extends EventEmitter {
  private config: PersonalizationConfig;
  private running = false;

  /** User profiles keyed by userId */
  private profiles: Map<string, UserProfile> = new Map();

  /** All recorded behavior events */
  private events: BehaviorEvent[] = [];

  /** Personalization rules */
  private rules: PersonalizationRule[] = [];

  /** Session tracking: userId -> last event timestamp */
  private sessionTracker: Map<string, { sessionId: string; lastEvent: number }> = new Map();

  constructor(config?: Partial<PersonalizationConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit('personalization:started', { timestamp: Date.now() });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.emit('personalization:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // EVENT TRACKING
  // ─────────────────────────────────────────────────────────

  /**
   * Track a user behavior event. Automatically manages sessions and
   * creates user profiles on first interaction.
   */
  trackEvent(
    userId: string,
    action: string,
    context: Record<string, unknown>,
    sessionId?: string,
  ): BehaviorEvent {
    const now = Date.now();

    // Resolve session: use provided, continue existing, or start new
    const resolvedSessionId = sessionId ?? this.resolveSession(userId, now);

    const event: BehaviorEvent = {
      id: `evt-${randomUUID().slice(0, 8)}`,
      userId,
      action,
      context: { ...context },
      timestamp: now,
      sessionId: resolvedSessionId,
    };

    this.events.push(event);

    // Enforce bounded event history
    if (this.events.length > this.config.maxEvents) {
      this.events.splice(0, this.events.length - this.config.maxEvents);
    }

    // Ensure user profile exists and update it
    const profile = this.ensureProfile(userId, now);
    profile.lastActive = now;
    profile.behaviorHistory.push(event.id);

    // Update session tracker
    this.sessionTracker.set(userId, { sessionId: resolvedSessionId, lastEvent: now });

    this.emit('personalization:event:tracked', { event, timestamp: now });
    return event;
  }

  // ─────────────────────────────────────────────────────────
  // PREFERENCES
  // ─────────────────────────────────────────────────────────

  /**
   * Explicitly set a user preference.
   */
  setPreference(
    userId: string,
    key: string,
    value: unknown,
    source: UserPreference['source'] = 'explicit',
  ): UserPreference {
    const now = Date.now();
    const profile = this.ensureProfile(userId, now);

    // Update existing preference or create new one
    const existing = profile.preferences.find((p) => p.key === key);
    if (existing) {
      existing.value = value;
      existing.confidence = source === 'explicit' ? 1.0 : existing.confidence;
      existing.source = source;
      existing.updatedAt = now;

      this.emit('personalization:preference:set', { preference: existing, timestamp: now });
      return existing;
    }

    const preference: UserPreference = {
      id: `pref-${randomUUID().slice(0, 8)}`,
      key,
      value,
      confidence: source === 'explicit' ? 1.0 : source === 'inferred' ? 0.7 : 0.5,
      source,
      updatedAt: now,
    };

    profile.preferences.push(preference);

    // Enforce max preferences per user
    if (profile.preferences.length > this.config.maxPreferences) {
      // Remove lowest-confidence non-explicit preferences first
      profile.preferences.sort((a, b) => {
        if (a.source === 'explicit' && b.source !== 'explicit') return -1;
        if (a.source !== 'explicit' && b.source === 'explicit') return 1;
        return b.confidence - a.confidence;
      });
      profile.preferences = profile.preferences.slice(0, this.config.maxPreferences);
    }

    this.emit('personalization:preference:set', { preference, timestamp: now });
    return preference;
  }

  /**
   * Get a specific preference for a user.
   */
  getPreference(userId: string, key: string): UserPreference | undefined {
    const profile = this.profiles.get(userId);
    if (!profile) return undefined;
    return profile.preferences.find((p) => p.key === key);
  }

  /**
   * Infer preferences from a user's behavior history.
   * Uses frequency analysis on actions and context values to detect
   * consistent patterns that suggest implicit preferences.
   */
  inferPreferences(userId: string): UserPreference[] {
    const profile = this.profiles.get(userId);
    if (!profile) return [];

    const userEvents = this.events.filter((e) => e.userId === userId);
    if (userEvents.length < MIN_INFER_OCCURRENCES) return [];

    const inferred: UserPreference[] = [];

    // 1. Analyze action frequency to infer preferred workflows
    const actionCounts = new Map<string, number>();
    for (const event of userEvents) {
      actionCounts.set(event.action, (actionCounts.get(event.action) ?? 0) + 1);
    }

    for (const [action, count] of actionCounts.entries()) {
      const frequency = count / userEvents.length;
      if (frequency >= this.config.inferenceThreshold) {
        const pref = this.setPreference(
          userId,
          `preferred-action:${action}`,
          true,
          'inferred',
        );
        pref.confidence = Math.min(frequency, 0.95);
        inferred.push(pref);
      }
    }

    // 2. Analyze context values for consistent choices
    const contextValueCounts = new Map<string, Map<string, number>>();
    for (const event of userEvents) {
      for (const [key, value] of Object.entries(event.context)) {
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          continue;
        }
        const valStr = String(value);
        if (!contextValueCounts.has(key)) {
          contextValueCounts.set(key, new Map());
        }
        const valueCounts = contextValueCounts.get(key)!;
        valueCounts.set(valStr, (valueCounts.get(valStr) ?? 0) + 1);
      }
    }

    for (const [key, valueCounts] of contextValueCounts.entries()) {
      // Find the dominant value for each context key
      let maxCount = 0;
      let dominantValue = '';
      for (const [value, count] of valueCounts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          dominantValue = value;
        }
      }

      const dominance = maxCount / userEvents.length;
      if (dominance >= this.config.inferenceThreshold && maxCount >= MIN_INFER_OCCURRENCES) {
        const pref = this.setPreference(
          userId,
          `inferred:${key}`,
          dominantValue,
          'inferred',
        );
        pref.confidence = Math.min(dominance, 0.95);
        inferred.push(pref);
      }
    }

    // 3. Analyze timing patterns (e.g., prefers morning vs evening)
    const hourCounts = new Map<number, number>();
    for (const event of userEvents) {
      const hour = new Date(event.timestamp).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }

    let peakHour = 0;
    let peakCount = 0;
    for (const [hour, count] of hourCounts.entries()) {
      if (count > peakCount) {
        peakCount = count;
        peakHour = hour;
      }
    }

    if (peakCount >= MIN_INFER_OCCURRENCES) {
      const timeOfDay = peakHour < 12 ? 'morning' : peakHour < 17 ? 'afternoon' : 'evening';
      const pref = this.setPreference(userId, 'preferred-time-of-day', timeOfDay, 'inferred');
      pref.confidence = Math.min(peakCount / userEvents.length, 0.9);
      inferred.push(pref);
    }

    this.emit('personalization:preferences:inferred', {
      userId,
      count: inferred.length,
      timestamp: Date.now(),
    });

    return inferred;
  }

  // ─────────────────────────────────────────────────────────
  // PROFILES
  // ─────────────────────────────────────────────────────────

  /**
   * Get a user profile by ID.
   */
  getProfile(userId: string): UserProfile | undefined {
    return this.profiles.get(userId);
  }

  // ─────────────────────────────────────────────────────────
  // SEGMENTATION
  // ─────────────────────────────────────────────────────────

  /**
   * Segment a user based on their behavior patterns and profile attributes.
   * Returns the list of segments the user belongs to.
   */
  segmentUser(userId: string): string[] {
    const profile = this.profiles.get(userId);
    if (!profile) return [];

    const segments: string[] = [];

    for (const [segmentName, checker] of Object.entries(SEGMENT_DEFINITIONS)) {
      try {
        if (checker(profile, this.events)) {
          segments.push(segmentName);
        }
      } catch {
        // Skip failing segment checks silently
      }
    }

    // Apply rule-based segments
    for (const rule of this.rules) {
      const hasPref = profile.preferences.find(
        (p) => p.key === rule.preference && p.value === rule.value,
      );
      if (hasPref && !segments.includes(rule.segment)) {
        segments.push(rule.segment);
      }
    }

    // Update profile segments
    profile.segments = segments;

    this.emit('personalization:user:segmented', {
      userId,
      segments,
      timestamp: Date.now(),
    });

    return segments;
  }

  // ─────────────────────────────────────────────────────────
  // RECOMMENDATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Recommend the next action for a user based on their profile,
   * behavior history, and current context.
   */
  getRecommendation(
    userId: string,
    context: Record<string, unknown>,
  ): { action: string; confidence: number; reasoning: string } {
    const profile = this.profiles.get(userId);
    if (!profile) {
      return {
        action: 'onboard',
        confidence: 0.5,
        reasoning: 'Unknown user — recommend onboarding flow',
      };
    }

    const userEvents = this.events.filter((e) => e.userId === userId);

    // Strategy 1: Look for action sequences (bigram prediction)
    if (userEvents.length >= 2) {
      const lastAction = userEvents[userEvents.length - 1].action;
      const bigramCounts = new Map<string, number>();

      for (let i = 0; i < userEvents.length - 1; i++) {
        if (userEvents[i].action === lastAction) {
          const nextAction = userEvents[i + 1].action;
          bigramCounts.set(nextAction, (bigramCounts.get(nextAction) ?? 0) + 1);
        }
      }

      let bestAction = '';
      let bestCount = 0;
      for (const [action, count] of bigramCounts.entries()) {
        if (count > bestCount) {
          bestCount = count;
          bestAction = action;
        }
      }

      if (bestAction && bestCount >= 2) {
        const confidence = Math.min(bestCount / userEvents.length, 0.9);
        return {
          action: bestAction,
          confidence,
          reasoning: `User typically performs "${bestAction}" after "${lastAction}" (observed ${bestCount} times)`,
        };
      }
    }

    // Strategy 2: Recommend based on preferred actions
    const preferredAction = profile.preferences.find((p) =>
      p.key.startsWith('preferred-action:') && p.confidence >= this.config.inferenceThreshold,
    );
    if (preferredAction) {
      const actionName = preferredAction.key.replace('preferred-action:', '');
      return {
        action: actionName,
        confidence: preferredAction.confidence * 0.8,
        reasoning: `User frequently performs "${actionName}" (confidence: ${preferredAction.confidence.toFixed(2)})`,
      };
    }

    // Strategy 3: Context-based matching using rules
    for (const rule of this.rules.sort((a, b) => b.priority - a.priority)) {
      if (profile.segments.includes(rule.segment)) {
        return {
          action: String(rule.value),
          confidence: 0.6,
          reasoning: `Rule-based recommendation for segment "${rule.segment}"`,
        };
      }
    }

    // Strategy 4: Most common action as fallback
    if (userEvents.length > 0) {
      const actionCounts = new Map<string, number>();
      for (const event of userEvents) {
        actionCounts.set(event.action, (actionCounts.get(event.action) ?? 0) + 1);
      }
      let topAction = '';
      let topCount = 0;
      for (const [action, count] of actionCounts.entries()) {
        if (count > topCount) {
          topCount = count;
          topAction = action;
        }
      }
      return {
        action: topAction,
        confidence: 0.4,
        reasoning: `Fallback: most frequent action "${topAction}" (${topCount} occurrences)`,
      };
    }

    return {
      action: 'explore',
      confidence: 0.3,
      reasoning: 'No behavior data available — suggest exploration',
    };
  }

  // ─────────────────────────────────────────────────────────
  // RULES
  // ─────────────────────────────────────────────────────────

  /**
   * Add a personalization rule that associates a segment with a preference.
   */
  addRule(rule: Omit<PersonalizationRule, 'id'>): PersonalizationRule {
    const newRule: PersonalizationRule = {
      ...rule,
      id: `prule-${randomUUID().slice(0, 8)}`,
    };
    this.rules.push(newRule);

    this.emit('personalization:rule:added', { rule: newRule, timestamp: Date.now() });
    return newRule;
  }

  // ─────────────────────────────────────────────────────────
  // STATISTICS
  // ─────────────────────────────────────────────────────────

  /**
   * Get personalization system statistics.
   */
  getStats(): PersonalizationStats {
    const allProfiles = [...this.profiles.values()];
    const totalPreferences = allProfiles.reduce((sum, p) => sum + p.preferences.length, 0);
    const allSegments = new Set<string>();
    for (const profile of allProfiles) {
      for (const segment of profile.segments) {
        allSegments.add(segment);
      }
    }

    return {
      totalUsers: this.profiles.size,
      totalEvents: this.events.length,
      totalPreferences,
      avgPreferencesPerUser:
        allProfiles.length > 0
          ? Math.round((totalPreferences / allProfiles.length) * 100) / 100
          : 0,
      totalSegments: allSegments.size,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Helpers
  // ─────────────────────────────────────────────────────────

  /**
   * Ensure a user profile exists, creating one if needed.
   */
  private ensureProfile(userId: string, now: number): UserProfile {
    let profile = this.profiles.get(userId);
    if (!profile) {
      profile = {
        userId,
        preferences: [],
        behaviorHistory: [],
        segments: [],
        lastActive: now,
        totalSessions: 1,
        createdAt: now,
      };
      this.profiles.set(userId, profile);
    }
    return profile;
  }

  /**
   * Resolve the session ID for a user. If the user has an active session
   * (last event within sessionTimeoutMs), continue it. Otherwise start a new one.
   */
  private resolveSession(userId: string, now: number): string {
    const tracker = this.sessionTracker.get(userId);
    if (tracker && now - tracker.lastEvent < this.config.sessionTimeoutMs) {
      return tracker.sessionId;
    }

    // New session
    const newSessionId = `sess-${randomUUID().slice(0, 8)}`;
    const profile = this.profiles.get(userId);
    if (profile) {
      profile.totalSessions++;
    }
    return newSessionId;
  }
}
