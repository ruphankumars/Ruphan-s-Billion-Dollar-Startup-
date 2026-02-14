import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DecisionRecorder } from '../../../src/time-travel/recorder.js';
import type { DecisionRecord } from '../../../src/time-travel/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeDecision(
  sessionId: string,
  overrides: Partial<DecisionRecord> = {},
): Partial<DecisionRecord> & Pick<DecisionRecord, 'sessionId' | 'stage' | 'decision'> {
  return {
    sessionId,
    stage: overrides.stage ?? 'plan',
    decision: overrides.decision ?? 'use tool A',
    alternatives: overrides.alternatives ?? ['use tool B'],
    context: overrides.context ?? {
      prompt: 'test prompt',
      availableTools: ['tool_a', 'tool_b'],
      memoryState: {},
      agentState: {},
      environmentSnapshot: { cwd: '/test' },
    },
    outcome: overrides.outcome,
    parentId: overrides.parentId,
    id: overrides.id,
    timestamp: overrides.timestamp,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('DecisionRecorder', () => {
  let recorder: DecisionRecorder;

  beforeEach(() => {
    recorder = new DecisionRecorder();
  });

  // ─── Session Lifecycle ────────────────────────────────────────

  describe('startSession', () => {
    it('should create a session with generated id', () => {
      const id = recorder.startSession();
      expect(id).toBeTruthy();
      expect(id).toContain('session_');
    });

    it('should create a session with custom id', () => {
      const id = recorder.startSession('my_session');
      expect(id).toBe('my_session');
    });

    it('should be a no-op if session already exists', () => {
      const id1 = recorder.startSession('s1');
      const id2 = recorder.startSession('s1');
      expect(id1).toBe(id2);
    });

    it('should appear in listSessions', () => {
      recorder.startSession('s1');
      recorder.startSession('s2');

      const sessions = recorder.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.sessionId)).toContain('s1');
      expect(sessions.map((s) => s.sessionId)).toContain('s2');
    });
  });

  describe('endSession', () => {
    it('should mark a session as ended', () => {
      recorder.startSession('s1');
      recorder.endSession('s1', {
        success: true,
        result: 'done',
        filesChanged: [],
        tokensUsed: 100,
        duration: 5000,
      });

      const sessions = recorder.listSessions();
      const session = sessions.find((s) => s.sessionId === 's1');
      expect(session).toBeDefined();
      expect(session!.endedAt).toBeGreaterThan(0);
      expect(session!.outcome?.success).toBe(true);
    });

    it('should handle ending a non-existent session gracefully', () => {
      // Should not throw
      expect(() => recorder.endSession('nonexistent')).not.toThrow();
    });
  });

  describe('listSessions', () => {
    it('should list sessions sorted most recent first', () => {
      recorder.startSession('s1');
      recorder.startSession('s2');
      recorder.startSession('s3');

      const sessions = recorder.listSessions();
      expect(sessions).toHaveLength(3);
      // Most recent first
      for (let i = 1; i < sessions.length; i++) {
        expect(sessions[i - 1].startedAt).toBeGreaterThanOrEqual(sessions[i].startedAt);
      }
    });

    it('should respect limit parameter', () => {
      recorder.startSession('s1');
      recorder.startSession('s2');
      recorder.startSession('s3');

      const sessions = recorder.listSessions(2);
      expect(sessions).toHaveLength(2);
    });
  });

  // ─── Recording ────────────────────────────────────────────────

  describe('record', () => {
    it('should record a decision and return the full record', () => {
      recorder.startSession('s1');

      const record = recorder.record(makeDecision('s1'));

      expect(record.id).toBeTruthy();
      expect(record.sessionId).toBe('s1');
      expect(record.stage).toBe('plan');
      expect(record.decision).toBe('use tool A');
      expect(record.alternatives).toEqual(['use tool B']);
      expect(record.timestamp).toBeGreaterThan(0);
    });

    it('should use provided id when given', () => {
      recorder.startSession('s1');
      const record = recorder.record(makeDecision('s1', { id: 'custom_dec' }));
      expect(record.id).toBe('custom_dec');
    });

    it('should auto-create session if not started', () => {
      const record = recorder.record(makeDecision('auto_session'));
      expect(record.sessionId).toBe('auto_session');

      const sessions = recorder.listSessions();
      expect(sessions.map((s) => s.sessionId)).toContain('auto_session');
    });

    it('should emit timetravel:recorded event', () => {
      recorder.startSession('s1');
      const handler = vi.fn();
      recorder.on('timetravel:recorded', handler);

      recorder.record(makeDecision('s1'));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].sessionId).toBe('s1');
    });

    it('should not store when disabled', () => {
      const disabled = new DecisionRecorder({ enabled: false });
      disabled.startSession('s1');

      const record = disabled.record(makeDecision('s1'));

      expect(record.sessionId).toBe('s1');
      // But it should not be in storage
      expect(disabled.getSession('s1')).toHaveLength(0);
    });

    it('should strip environment snapshot when recordEnvironment is false', () => {
      const noEnv = new DecisionRecorder({ recordEnvironment: false });
      noEnv.startSession('s1');

      const record = noEnv.record(makeDecision('s1'));
      expect(record.context.environmentSnapshot).toEqual({});
    });
  });

  // ─── Queries ──────────────────────────────────────────────────

  describe('getSession', () => {
    it('should return empty array for unknown session', () => {
      expect(recorder.getSession('unknown')).toEqual([]);
    });

    it('should return decisions sorted by timestamp', () => {
      recorder.startSession('s1');
      recorder.record(makeDecision('s1', { id: 'd1', timestamp: 200 }));
      recorder.record(makeDecision('s1', { id: 'd2', timestamp: 100 }));
      recorder.record(makeDecision('s1', { id: 'd3', timestamp: 300 }));

      const decisions = recorder.getSession('s1');
      expect(decisions).toHaveLength(3);
      expect(decisions[0].id).toBe('d2');
      expect(decisions[1].id).toBe('d1');
      expect(decisions[2].id).toBe('d3');
    });
  });

  describe('getDecision', () => {
    it('should return a specific decision by id', () => {
      recorder.startSession('s1');
      recorder.record(makeDecision('s1', { id: 'target' }));

      const decision = recorder.getDecision('target');
      expect(decision).not.toBeNull();
      expect(decision!.id).toBe('target');
    });

    it('should return null for unknown id', () => {
      expect(recorder.getDecision('nonexistent')).toBeNull();
    });
  });

  describe('getDecisionTree', () => {
    it('should organize decisions by parent', () => {
      recorder.startSession('s1');
      recorder.record(makeDecision('s1', { id: 'root1' }));
      recorder.record(makeDecision('s1', { id: 'child1', parentId: 'root1' }));
      recorder.record(makeDecision('s1', { id: 'child2', parentId: 'root1' }));

      const tree = recorder.getDecisionTree('s1');

      expect(tree.get('__root__')).toHaveLength(1);
      expect(tree.get('root1')).toHaveLength(2);
    });

    it('should put top-level decisions under __root__', () => {
      recorder.startSession('s1');
      recorder.record(makeDecision('s1', { id: 'd1' }));
      recorder.record(makeDecision('s1', { id: 'd2' }));

      const tree = recorder.getDecisionTree('s1');
      expect(tree.get('__root__')).toHaveLength(2);
    });
  });

  // ─── Maintenance ──────────────────────────────────────────────

  describe('pruneOldSessions', () => {
    it('should remove sessions older than maxAge', () => {
      recorder.startSession('old');
      recorder.record(makeDecision('old'));
      // Force the session to have started a long time ago
      const sessions = recorder.listSessions();
      const oldSession = sessions.find((s) => s.sessionId === 'old');
      if (oldSession) {
        (oldSession as any).startedAt = Date.now() - 100_000;
      }

      recorder.startSession('new');
      recorder.record(makeDecision('new'));

      const removed = recorder.pruneOldSessions(50_000);
      expect(removed).toBe(1);
      expect(recorder.getSession('old')).toHaveLength(0);
      expect(recorder.getSession('new')).toHaveLength(1);
    });

    it('should return 0 when no sessions are old enough', () => {
      recorder.startSession('recent');
      recorder.record(makeDecision('recent'));

      const removed = recorder.pruneOldSessions(100_000);
      expect(removed).toBe(0);
    });
  });

  // ─── Stats ────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return zeros initially', () => {
      const stats = recorder.getStats();
      expect(stats.totalRecordings).toBe(0);
      expect(stats.totalReplays).toBe(0);
      expect(stats.totalDivergences).toBe(0);
      expect(stats.sessionsRecorded).toBe(0);
      expect(stats.avgDecisionsPerSession).toBe(0);
    });

    it('should track recordings and sessions', () => {
      recorder.startSession('s1');
      recorder.record(makeDecision('s1'));
      recorder.record(makeDecision('s1'));

      recorder.startSession('s2');
      recorder.record(makeDecision('s2'));

      const stats = recorder.getStats();
      expect(stats.totalRecordings).toBe(3);
      expect(stats.sessionsRecorded).toBe(2);
      expect(stats.avgDecisionsPerSession).toBe(1.5);
    });

    it('should track replay count via incrementReplayCount', () => {
      recorder.incrementReplayCount();
      recorder.incrementReplayCount();

      const stats = recorder.getStats();
      expect(stats.totalReplays).toBe(2);
    });
  });

  // ─── Max recordings ───────────────────────────────────────────

  describe('maxRecordings enforcement', () => {
    it('should prune oldest session when max recordings reached', () => {
      const limited = new DecisionRecorder({ maxRecordings: 5 });

      limited.startSession('s1');
      for (let i = 0; i < 3; i++) {
        limited.record(makeDecision('s1', { id: `s1_d${i}` }));
      }

      limited.startSession('s2');
      for (let i = 0; i < 3; i++) {
        limited.record(makeDecision('s2', { id: `s2_d${i}` }));
      }

      // s1 should have been pruned to make room
      const stats = limited.getStats();
      expect(stats.totalRecordings).toBeLessThanOrEqual(5);
    });
  });
});
