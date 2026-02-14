/**
 * DecisionReplayer — Session Replay Engine
 *
 * Replays a previously recorded session's decisions, optionally from a
 * specific decision point and with overrides. Compares original outcomes
 * with replayed outcomes to detect divergences.
 *
 * Part of CortexOS Time-Travel Debugging Module
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  ReplayConfig,
  ReplayResult,
  DecisionRecord,
  DecisionOutcome,
  Divergence,
} from './types.js';
import type { DecisionRecorder } from './recorder.js';
import { DivergenceAnalyzer } from './diff-analyzer.js';

// ═══════════════════════════════════════════════════════════════
// DECISION REPLAYER
// ═══════════════════════════════════════════════════════════════

export class DecisionReplayer extends EventEmitter {
  private recorder: DecisionRecorder;
  private analyzer: DivergenceAnalyzer;
  private replayHistory: ReplayResult[] = [];

  constructor(recorder: DecisionRecorder) {
    super();
    this.recorder = recorder;
    this.analyzer = new DivergenceAnalyzer();
  }

  // ---------------------------------------------------------------------------
  // Replay
  // ---------------------------------------------------------------------------

  /**
   * Replay a session according to the given config.
   *
   * In a full production system this would re-execute agent logic. Here we
   * simulate replay by walking the recorded decision sequence, applying any
   * `overrides`, and marking divergence points where an override changes the
   * original decision.
   */
  replay(config: ReplayConfig): ReplayResult {
    const originalDecisions = this.recorder.getSession(config.sessionId);
    if (originalDecisions.length === 0) {
      throw new Error(
        `DecisionReplayer: session "${config.sessionId}" not found or has no decisions`,
      );
    }

    const start = performance.now();
    const replaySessionId = `replay_${randomUUID().slice(0, 8)}`;

    // Determine the slice of decisions to replay
    const slice = this.sliceDecisions(
      originalDecisions,
      config.fromDecisionId,
      config.toDecisionId,
    );

    const maxDecisions = config.maxDecisions ?? slice.length;
    const decisionsToReplay = slice.slice(0, maxDecisions);

    // Walk through decisions, applying overrides
    const replayedDecisions: DecisionRecord[] = [];
    const outcomes: DecisionOutcome[] = [];
    const divergences: Divergence[] = [];

    for (const original of decisionsToReplay) {
      const overrideKey = original.id;
      const overrideValue = config.overrides?.[overrideKey];

      let replayedDecision: string;
      if (typeof overrideValue === 'string') {
        replayedDecision = overrideValue;
      } else {
        replayedDecision = original.decision;
      }

      // Build the replayed record
      const replayed: DecisionRecord = {
        ...original,
        id: `rdec_${randomUUID().slice(0, 8)}`,
        sessionId: replaySessionId,
        timestamp: Date.now(),
        decision: replayedDecision,
      };

      // Detect divergence
      if (replayedDecision !== original.decision) {
        const divergence: Divergence = {
          decisionId: original.id,
          stage: original.stage,
          originalDecision: original.decision,
          replayedDecision,
          reason: overrideValue
            ? 'user override'
            : 'context change',
          impact: this.analyzer.classifyDivergence(original, replayed),
        };
        divergences.push(divergence);
        this.emit('timetravel:diverged', divergence);
      }

      // In dry-run mode we don't record, but we still simulate the outcome
      if (!config.dryRun) {
        this.recorder.record(replayed);
      }

      replayedDecisions.push(replayed);

      // Simulate outcome — use original outcome if decision didn't change,
      // otherwise synthesize a placeholder outcome.
      const outcome: DecisionOutcome = replayedDecision === original.decision
        ? original.outcome ?? {
            success: true,
            result: 'replayed (no original outcome)',
            filesChanged: [],
            tokensUsed: 0,
            duration: 0,
          }
        : {
            success: true,
            result: `replayed with override: ${replayedDecision}`,
            filesChanged: original.outcome?.filesChanged ?? [],
            tokensUsed: original.outcome?.tokensUsed ?? 0,
            duration: original.outcome?.duration ?? 0,
          };

      outcomes.push(outcome);
    }

    const duration = performance.now() - start;

    // Increment replay counter on the recorder
    this.recorder.incrementReplayCount();

    const result: ReplayResult = {
      sessionId: replaySessionId,
      originalSessionId: config.sessionId,
      decisionsReplayed: decisionsToReplay.length,
      divergences,
      outcomes,
      duration,
    };

    this.replayHistory.push(result);
    // Cap history
    if (this.replayHistory.length > 500) {
      this.replayHistory.splice(0, this.replayHistory.length - 500);
    }

    this.emit('timetravel:replayed', result);
    return result;
  }

  /**
   * Convenience: replay a session from a specific decision point with optional
   * overrides.
   */
  replayFrom(
    sessionId: string,
    decisionId: string,
    overrides?: Record<string, unknown>,
  ): ReplayResult {
    return this.replay({
      sessionId,
      fromDecisionId: decisionId,
      overrides,
      dryRun: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Comparison
  // ---------------------------------------------------------------------------

  /**
   * Compare outcomes between the original session and a replay session.
   * Returns an array of `Divergence` objects.
   */
  compareOutcomes(
    originalSessionId: string,
    replaySessionId: string,
  ): Divergence[] {
    const originals = this.recorder.getSession(originalSessionId);
    const replays = this.recorder.getSession(replaySessionId);
    return this.analyzer.analyze(originals, replays);
  }

  /** Extract divergences from a replay result. */
  getDivergences(replayResult: ReplayResult): Divergence[] {
    return replayResult.divergences;
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /** List past replay results. */
  getReplayHistory(): ReplayResult[] {
    return [...this.replayHistory];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Slice the decision array between `fromId` and `toId` (inclusive).
   * If `fromId` is not found, starts from the beginning.
   * If `toId` is not found, includes up to the end.
   */
  private sliceDecisions(
    decisions: DecisionRecord[],
    fromId?: string,
    toId?: string,
  ): DecisionRecord[] {
    let startIdx = 0;
    let endIdx = decisions.length;

    if (fromId) {
      const idx = decisions.findIndex((d) => d.id === fromId);
      if (idx !== -1) startIdx = idx;
    }
    if (toId) {
      const idx = decisions.findIndex((d) => d.id === toId);
      if (idx !== -1) endIdx = idx + 1;
    }

    return decisions.slice(startIdx, endIdx);
  }
}
