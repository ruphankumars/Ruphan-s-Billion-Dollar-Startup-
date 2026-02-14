import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DecisionReplayer } from '../../../src/time-travel/replayer.js';
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
    alternatives: overrides.alternatives ?? [],
    context: overrides.context ?? {
      prompt: 'test prompt',
      availableTools: ['tool_a'],
      memoryState: {},
      agentState: {},
      environmentSnapshot: {},
    },
    outcome: overrides.outcome ?? {
      success: true,
      result: 'ok',
      filesChanged: [],
      tokensUsed: 10,
      duration: 100,
    },
    parentId: overrides.parentId,
    id: overrides.id,
    timestamp: overrides.timestamp,
  };
}

function seedSession(
  recorder: DecisionRecorder,
  sessionId: string,
  decisions: Array<{ id: string; decision: string; stage?: string }>,
): void {
  recorder.startSession(sessionId);
  for (const d of decisions) {
    recorder.record(
      makeDecision(sessionId, {
        id: d.id,
        decision: d.decision,
        stage: d.stage ?? 'plan',
      }),
    );
  }
}

// ─── Tests ──────────────────────────────────────────────────────

describe('DecisionReplayer', () => {
  let recorder: DecisionRecorder;
  let replayer: DecisionReplayer;

  beforeEach(() => {
    recorder = new DecisionRecorder();
    replayer = new DecisionReplayer(recorder);
  });

  // ─── Replay ───────────────────────────────────────────────────

  describe('replay', () => {
    it('should throw for a session with no decisions', () => {
      recorder.startSession('empty');
      expect(() =>
        replayer.replay({ sessionId: 'empty', dryRun: false }),
      ).toThrow('not found or has no decisions');
    });

    it('should throw for a non-existent session', () => {
      expect(() =>
        replayer.replay({ sessionId: 'nonexistent', dryRun: false }),
      ).toThrow('not found or has no decisions');
    });

    it('should replay all decisions in a session', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'action A' },
        { id: 'd2', decision: 'action B' },
        { id: 'd3', decision: 'action C' },
      ]);

      const result = replayer.replay({ sessionId: 's1', dryRun: false });

      expect(result.originalSessionId).toBe('s1');
      expect(result.decisionsReplayed).toBe(3);
      expect(result.divergences).toHaveLength(0);
      expect(result.outcomes).toHaveLength(3);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should detect divergence when overrides change a decision', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'action A' },
        { id: 'd2', decision: 'action B' },
      ]);

      const result = replayer.replay({
        sessionId: 's1',
        dryRun: false,
        overrides: { d1: 'action X' },
      });

      expect(result.divergences).toHaveLength(1);
      expect(result.divergences[0].decisionId).toBe('d1');
      expect(result.divergences[0].originalDecision).toBe('action A');
      expect(result.divergences[0].replayedDecision).toBe('action X');
      expect(result.divergences[0].reason).toBe('user override');
    });

    it('should not record replayed decisions in dry-run mode', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'action A' },
      ]);

      const result = replayer.replay({ sessionId: 's1', dryRun: true });
      expect(result.decisionsReplayed).toBe(1);

      // The replay session should not exist in the recorder
      const replaySessions = recorder.getSession(result.sessionId);
      expect(replaySessions).toHaveLength(0);
    });

    it('should record replayed decisions when not dry-run', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'action A' },
      ]);

      const result = replayer.replay({ sessionId: 's1', dryRun: false });

      const replaySessions = recorder.getSession(result.sessionId);
      expect(replaySessions).toHaveLength(1);
    });

    it('should respect maxDecisions config', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'A' },
        { id: 'd2', decision: 'B' },
        { id: 'd3', decision: 'C' },
        { id: 'd4', decision: 'D' },
      ]);

      const result = replayer.replay({
        sessionId: 's1',
        dryRun: true,
        maxDecisions: 2,
      });

      expect(result.decisionsReplayed).toBe(2);
    });

    it('should replay from a specific decision', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'A' },
        { id: 'd2', decision: 'B' },
        { id: 'd3', decision: 'C' },
      ]);

      const result = replayer.replay({
        sessionId: 's1',
        fromDecisionId: 'd2',
        dryRun: true,
      });

      expect(result.decisionsReplayed).toBe(2); // d2 and d3
    });

    it('should replay up to a specific decision', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'A' },
        { id: 'd2', decision: 'B' },
        { id: 'd3', decision: 'C' },
      ]);

      const result = replayer.replay({
        sessionId: 's1',
        toDecisionId: 'd2',
        dryRun: true,
      });

      expect(result.decisionsReplayed).toBe(2); // d1 and d2
    });

    it('should emit timetravel:replayed event', () => {
      const handler = vi.fn();
      replayer.on('timetravel:replayed', handler);

      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'A' },
      ]);

      replayer.replay({ sessionId: 's1', dryRun: true });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].originalSessionId).toBe('s1');
    });

    it('should emit timetravel:diverged event for each divergence', () => {
      const handler = vi.fn();
      replayer.on('timetravel:diverged', handler);

      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'A' },
        { id: 'd2', decision: 'B' },
      ]);

      replayer.replay({
        sessionId: 's1',
        dryRun: true,
        overrides: { d1: 'X', d2: 'Y' },
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should increment recorder replay count', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'A' },
      ]);

      replayer.replay({ sessionId: 's1', dryRun: true });
      replayer.replay({ sessionId: 's1', dryRun: true });

      expect(recorder.getStats().totalReplays).toBe(2);
    });
  });

  // ─── replayFrom ───────────────────────────────────────────────

  describe('replayFrom', () => {
    it('should replay from a decision with overrides', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'A' },
        { id: 'd2', decision: 'B' },
        { id: 'd3', decision: 'C' },
      ]);

      const result = replayer.replayFrom('s1', 'd2', { d2: 'X' });

      expect(result.decisionsReplayed).toBe(2); // d2 and d3
      expect(result.divergences).toHaveLength(1);
      expect(result.divergences[0].replayedDecision).toBe('X');
    });
  });

  // ─── Comparison ───────────────────────────────────────────────

  describe('compareOutcomes', () => {
    it('should find divergences between original and replay sessions', () => {
      seedSession(recorder, 's_orig', [
        { id: 'o1', decision: 'A' },
        { id: 'o2', decision: 'B' },
      ]);
      seedSession(recorder, 's_replay', [
        { id: 'r1', decision: 'A' },
        { id: 'r2', decision: 'C' }, // different
      ]);

      const divergences = replayer.compareOutcomes('s_orig', 's_replay');
      expect(divergences).toHaveLength(1);
      expect(divergences[0].originalDecision).toBe('B');
      expect(divergences[0].replayedDecision).toBe('C');
    });
  });

  describe('getDivergences', () => {
    it('should extract divergences from a replay result', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'A' },
      ]);

      const result = replayer.replay({
        sessionId: 's1',
        dryRun: true,
        overrides: { d1: 'Z' },
      });

      const divs = replayer.getDivergences(result);
      expect(divs).toHaveLength(1);
      expect(divs[0].replayedDecision).toBe('Z');
    });
  });

  // ─── History ──────────────────────────────────────────────────

  describe('getReplayHistory', () => {
    it('should return empty initially', () => {
      expect(replayer.getReplayHistory()).toEqual([]);
    });

    it('should accumulate replay results', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'A' },
      ]);

      replayer.replay({ sessionId: 's1', dryRun: true });
      replayer.replay({ sessionId: 's1', dryRun: true });

      expect(replayer.getReplayHistory()).toHaveLength(2);
    });

    it('should return a copy of history', () => {
      seedSession(recorder, 's1', [
        { id: 'd1', decision: 'A' },
      ]);
      replayer.replay({ sessionId: 's1', dryRun: true });

      const h1 = replayer.getReplayHistory();
      const h2 = replayer.getReplayHistory();
      expect(h1).toEqual(h2);
      expect(h1).not.toBe(h2);
    });
  });
});
