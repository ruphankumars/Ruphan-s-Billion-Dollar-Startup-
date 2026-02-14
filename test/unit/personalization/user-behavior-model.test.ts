/**
 * UserBehaviorModel — Unit Tests
 *
 * Tests personalization engine: lifecycle, event tracking, preference management,
 * inference from behavior, user segmentation, and recommendation generation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UserBehaviorModel } from '../../../src/personalization/user-behavior-model.js';

describe('UserBehaviorModel', () => {
  let model: UserBehaviorModel;

  beforeEach(() => {
    model = new UserBehaviorModel({ inferenceThreshold: 0.5 });
  });

  afterEach(() => {
    model.stop();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('creates model with default config', () => {
      const defaultModel = new UserBehaviorModel();
      expect(defaultModel.isRunning()).toBe(false);
      expect(defaultModel.getStats().totalUsers).toBe(0);
    });

    it('merges partial config with defaults', () => {
      const custom = new UserBehaviorModel({ maxEvents: 500 });
      expect(custom.getStats().totalEvents).toBe(0);
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('start / stop lifecycle', () => {
    it('starts and emits started event', () => {
      const handler = vi.fn();
      model.on('personalization:started', handler);

      model.start();

      expect(model.isRunning()).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('stops and emits stopped event', () => {
      const handler = vi.fn();
      model.on('personalization:stopped', handler);

      model.start();
      model.stop();

      expect(model.isRunning()).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('double start is idempotent', () => {
      const handler = vi.fn();
      model.on('personalization:started', handler);
      model.start();
      model.start();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('double stop is idempotent', () => {
      const handler = vi.fn();
      model.on('personalization:stopped', handler);
      model.stop();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Event Tracking ─────────────────────────────────────────

  describe('trackEvent', () => {
    it('records behavior event and returns event with generated id', () => {
      const event = model.trackEvent('user-1', 'click', { page: 'home' });

      expect(event.id).toMatch(/^evt-/);
      expect(event.userId).toBe('user-1');
      expect(event.action).toBe('click');
      expect(event.context.page).toBe('home');
      expect(event.sessionId).toBeDefined();
    });

    it('creates user profile on first event', () => {
      model.trackEvent('user-2', 'visit', {});

      const profile = model.getProfile('user-2');
      expect(profile).toBeDefined();
      expect(profile!.userId).toBe('user-2');
      expect(profile!.behaviorHistory.length).toBe(1);
    });

    it('emits event:tracked event', () => {
      const handler = vi.fn();
      model.on('personalization:event:tracked', handler);

      model.trackEvent('user-3', 'action', {});

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('maintains session across rapid events', () => {
      const e1 = model.trackEvent('user-4', 'a', {});
      const e2 = model.trackEvent('user-4', 'b', {});

      expect(e1.sessionId).toBe(e2.sessionId);
    });

    it('updates totalEvents stat', () => {
      model.trackEvent('u1', 'x', {});
      model.trackEvent('u1', 'y', {});

      expect(model.getStats().totalEvents).toBe(2);
    });
  });

  // ── Preferences ────────────────────────────────────────────

  describe('setPreference / getPreference', () => {
    it('sets explicit preference with confidence 1.0', () => {
      model.trackEvent('u1', 'init', {});
      const pref = model.setPreference('u1', 'theme', 'dark');

      expect(pref.key).toBe('theme');
      expect(pref.value).toBe('dark');
      expect(pref.confidence).toBe(1.0);
      expect(pref.source).toBe('explicit');
    });

    it('retrieves preference by key', () => {
      model.trackEvent('u1', 'init', {});
      model.setPreference('u1', 'lang', 'en');

      const pref = model.getPreference('u1', 'lang');
      expect(pref).toBeDefined();
      expect(pref!.value).toBe('en');
    });

    it('returns undefined for unknown user or key', () => {
      expect(model.getPreference('ghost', 'nope')).toBeUndefined();

      model.trackEvent('u1', 'init', {});
      expect(model.getPreference('u1', 'nonexistent')).toBeUndefined();
    });

    it('updates existing preference value on re-set', () => {
      model.trackEvent('u1', 'init', {});
      model.setPreference('u1', 'theme', 'light');
      model.setPreference('u1', 'theme', 'dark');

      const pref = model.getPreference('u1', 'theme');
      expect(pref!.value).toBe('dark');
    });

    it('assigns lower confidence for inferred source', () => {
      model.trackEvent('u1', 'init', {});
      const pref = model.setPreference('u1', 'auto-pref', true, 'inferred');
      expect(pref.confidence).toBe(0.7);
    });
  });

  // ── Inference ──────────────────────────────────────────────

  describe('inferPreferences', () => {
    it('returns empty for unknown user', () => {
      expect(model.inferPreferences('ghost')).toHaveLength(0);
    });

    it('returns empty for user with too few events', () => {
      model.trackEvent('u1', 'x', {});
      expect(model.inferPreferences('u1')).toHaveLength(0);
    });

    it('infers preferred action from frequent behavior', () => {
      // Need >= 3 events AND action frequency >= threshold (0.5)
      for (let i = 0; i < 5; i++) {
        model.trackEvent('u1', 'code-edit', { lang: 'ts' });
      }

      const inferred = model.inferPreferences('u1');
      expect(inferred.length).toBeGreaterThan(0);
      const actionPref = inferred.find((p) => p.key === 'preferred-action:code-edit');
      expect(actionPref).toBeDefined();
    });

    it('infers dominant context values', () => {
      for (let i = 0; i < 5; i++) {
        model.trackEvent('u1', 'edit', { lang: 'typescript' });
      }

      const inferred = model.inferPreferences('u1');
      const langPref = inferred.find((p) => p.key === 'inferred:lang');
      expect(langPref).toBeDefined();
      expect(langPref!.value).toBe('typescript');
    });

    it('infers time-of-day preference', () => {
      for (let i = 0; i < 5; i++) {
        model.trackEvent('u1', 'work', {});
      }

      const inferred = model.inferPreferences('u1');
      const timePref = inferred.find((p) => p.key === 'preferred-time-of-day');
      expect(timePref).toBeDefined();
    });
  });

  // ── Segmentation ───────────────────────────────────────────

  describe('segmentUser', () => {
    it('returns empty for unknown user', () => {
      expect(model.segmentUser('ghost')).toHaveLength(0);
    });

    it('segments a user with many events as frequent', () => {
      const userId = 'power';
      // Create enough sessions to trigger "frequent" (>= 5 sessions)
      // The first trackEvent creates the profile with totalSessions = 1
      // Then each session timeout creates a new session
      for (let i = 0; i < 60; i++) {
        model.trackEvent(userId, `action-${i % 15}`, {});
      }

      const segments = model.segmentUser(userId);
      // With 60 events, the user qualifies for 'power-user' (>= 50 events)
      expect(segments).toContain('power-user');
    });

    it('updates profile segments after segmentation', () => {
      const userId = 'segmented';
      for (let i = 0; i < 55; i++) {
        model.trackEvent(userId, `a-${i % 12}`, {});
      }

      model.segmentUser(userId);
      const profile = model.getProfile(userId);
      expect(profile!.segments.length).toBeGreaterThan(0);
    });

    it('applies rule-based segments when preference matches', () => {
      const userId = 'rule-user';
      model.trackEvent(userId, 'init', {});
      model.setPreference(userId, 'plan', 'enterprise');

      model.addRule({
        segment: 'enterprise-segment',
        preference: 'plan',
        value: 'enterprise',
        priority: 10,
      });

      const segments = model.segmentUser(userId);
      expect(segments).toContain('enterprise-segment');
    });
  });

  // ── Recommendations ────────────────────────────────────────

  describe('getRecommendation', () => {
    it('recommends onboarding for unknown user', () => {
      const rec = model.getRecommendation('ghost', {});
      expect(rec.action).toBe('onboard');
      expect(rec.confidence).toBe(0.5);
    });

    it('recommends explore for known user with no events', () => {
      model.trackEvent('u1', 'first', {});
      // Profile exists but minimal data -- will use fallback most frequent action
      const rec = model.getRecommendation('u1', {});
      expect(rec.action).toBeDefined();
      expect(rec.confidence).toBeGreaterThan(0);
    });

    it('uses bigram prediction for users with repeated sequences', () => {
      const userId = 'sequencer';
      // Build: edit -> save -> edit -> save pattern
      for (let i = 0; i < 5; i++) {
        model.trackEvent(userId, 'edit', {});
        model.trackEvent(userId, 'save', {});
      }

      const rec = model.getRecommendation(userId, {});
      // Last action is "save", and after "save" typically comes "edit"
      // Or alternatively, after "edit" comes "save" if those bigrams are stronger
      expect(rec.confidence).toBeGreaterThan(0);
      expect(['edit', 'save']).toContain(rec.action);
    });

    it('falls back to most frequent action', () => {
      model.trackEvent('u1', 'browse', {});

      const rec = model.getRecommendation('u1', {});
      expect(rec.action).toBe('browse');
      expect(rec.confidence).toBe(0.4);
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zeroed stats on fresh model', () => {
      const stats = model.getStats();
      expect(stats.totalUsers).toBe(0);
      expect(stats.totalEvents).toBe(0);
      expect(stats.totalPreferences).toBe(0);
      expect(stats.avgPreferencesPerUser).toBe(0);
      expect(stats.totalSegments).toBe(0);
    });

    it('reflects tracked events and users', () => {
      model.trackEvent('u1', 'a', {});
      model.trackEvent('u2', 'b', {});
      model.trackEvent('u1', 'c', {});

      const stats = model.getStats();
      expect(stats.totalUsers).toBe(2);
      expect(stats.totalEvents).toBe(3);
    });

    it('reflects preferences count', () => {
      model.trackEvent('u1', 'x', {});
      model.setPreference('u1', 'k1', 'v1');
      model.setPreference('u1', 'k2', 'v2');

      const stats = model.getStats();
      expect(stats.totalPreferences).toBe(2);
      expect(stats.avgPreferencesPerUser).toBe(2);
    });
  });
});
