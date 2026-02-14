/**
 * DecisionRecorder — Agent Decision Point Recorder
 *
 * Records every decision point that an agent makes during a session,
 * including the context (prompt, tools, state) and eventual outcome.
 * Recorded sessions can later be replayed or analysed for divergences.
 *
 * Part of CortexOS Time-Travel Debugging Module
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  DecisionRecord,
  DecisionOutcome,
  TimeTravelConfig,
  TimeTravelStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: TimeTravelConfig = {
  enabled: true,
  maxRecordings: 100_000,
  recordContext: true,
  recordEnvironment: true,
  snapshotInterval: 0,
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface SessionMeta {
  sessionId: string;
  startedAt: number;
  endedAt?: number;
  outcome?: DecisionOutcome;
}

// ═══════════════════════════════════════════════════════════════
// DECISION RECORDER
// ═══════════════════════════════════════════════════════════════

export class DecisionRecorder extends EventEmitter {
  private config: TimeTravelConfig;

  /** All decisions keyed by decision ID */
  private decisions: Map<string, DecisionRecord> = new Map();

  /** Decision IDs grouped by session */
  private sessions: Map<string, string[]> = new Map();

  /** Session metadata */
  private sessionMeta: Map<string, SessionMeta> = new Map();

  /** Replay count (for stats) */
  private replayCount = 0;

  constructor(config?: Partial<TimeTravelConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start recording decisions for a new session.
   * If `sessionId` is already active this is a no-op and returns the existing ID.
   */
  startSession(sessionId?: string): string {
    const id = sessionId ?? `session_${randomUUID().slice(0, 8)}`;

    if (!this.sessions.has(id)) {
      this.sessions.set(id, []);
      this.sessionMeta.set(id, { sessionId: id, startedAt: Date.now() });
    }

    return id;
  }

  /**
   * End recording for a session.
   * Optionally attach an overall outcome to the session.
   */
  endSession(sessionId: string, outcome?: DecisionOutcome): void {
    const meta = this.sessionMeta.get(sessionId);
    if (meta) {
      meta.endedAt = Date.now();
      meta.outcome = outcome;
    }
  }

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  /**
   * Record a decision point.
   * Automatically generates an `id` and `timestamp` if not present.
   * Returns the stored `DecisionRecord`.
   */
  record(
    decision: Partial<DecisionRecord> &
      Pick<DecisionRecord, 'sessionId' | 'stage' | 'decision'>,
  ): DecisionRecord {
    if (!this.config.enabled) {
      // Return a minimal record without storing
      return {
        id: decision.id ?? `dec_${randomUUID().slice(0, 8)}`,
        sessionId: decision.sessionId,
        timestamp: Date.now(),
        stage: decision.stage,
        decision: decision.decision,
        alternatives: decision.alternatives ?? [],
        context: decision.context ?? {
          prompt: '',
          availableTools: [],
          memoryState: {},
          agentState: {},
          environmentSnapshot: {},
        },
        outcome: decision.outcome,
        parentId: decision.parentId,
      };
    }

    // Enforce max recordings
    if (this.decisions.size >= this.config.maxRecordings) {
      this.pruneOldestSession();
    }

    const full: DecisionRecord = {
      id: decision.id ?? `dec_${randomUUID().slice(0, 8)}`,
      sessionId: decision.sessionId,
      timestamp: decision.timestamp ?? Date.now(),
      stage: decision.stage,
      decision: decision.decision,
      alternatives: decision.alternatives ?? [],
      context: this.config.recordContext
        ? decision.context ?? {
            prompt: '',
            availableTools: [],
            memoryState: {},
            agentState: {},
            environmentSnapshot: {},
          }
        : {
            prompt: '',
            availableTools: [],
            memoryState: {},
            agentState: {},
            environmentSnapshot: {},
          },
      outcome: decision.outcome,
      parentId: decision.parentId,
    };

    // Strip environment snapshot if not configured
    if (!this.config.recordEnvironment) {
      full.context.environmentSnapshot = {};
    }

    this.decisions.set(full.id, full);

    // Register under session
    if (!this.sessions.has(full.sessionId)) {
      this.startSession(full.sessionId);
    }
    this.sessions.get(full.sessionId)!.push(full.id);

    this.emit('timetravel:recorded', full);
    return full;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Get all decisions for a given session, sorted by timestamp. */
  getSession(sessionId: string): DecisionRecord[] {
    const ids = this.sessions.get(sessionId);
    if (!ids) return [];

    const records: DecisionRecord[] = [];
    for (const id of ids) {
      const rec = this.decisions.get(id);
      if (rec) records.push(rec);
    }
    return records.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** List recorded sessions, most recent first. */
  listSessions(limit?: number): SessionMeta[] {
    const all = Array.from(this.sessionMeta.values()).sort(
      (a, b) => b.startedAt - a.startedAt,
    );
    return limit ? all.slice(0, limit) : all;
  }

  /** Get a single decision by ID. */
  getDecision(id: string): DecisionRecord | null {
    return this.decisions.get(id) ?? null;
  }

  /**
   * Get the decision tree for a session.
   * Returns a map from parent ID (or "__root__" for top-level decisions)
   * to an array of child decisions.
   */
  getDecisionTree(
    sessionId: string,
  ): Map<string, DecisionRecord[]> {
    const decisions = this.getSession(sessionId);
    const tree = new Map<string, DecisionRecord[]>();

    for (const dec of decisions) {
      const parentKey = dec.parentId ?? '__root__';
      if (!tree.has(parentKey)) {
        tree.set(parentKey, []);
      }
      tree.get(parentKey)!.push(dec);
    }

    return tree;
  }

  // ---------------------------------------------------------------------------
  // Maintenance
  // ---------------------------------------------------------------------------

  /**
   * Prune sessions older than `maxAge` milliseconds.
   * Returns the number of sessions removed.
   */
  pruneOldSessions(maxAge: number): number {
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    for (const [sessionId, meta] of this.sessionMeta) {
      if (meta.startedAt < cutoff) {
        this.removeSession(sessionId);
        removed++;
      }
    }

    return removed;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  /** Get recording statistics. */
  getStats(): TimeTravelStats {
    const sessionCount = this.sessions.size;
    const totalDecisions = this.decisions.size;

    return {
      totalRecordings: totalDecisions,
      totalReplays: this.replayCount,
      totalDivergences: 0, // Divergences are tracked by the Replayer
      sessionsRecorded: sessionCount,
      avgDecisionsPerSession:
        sessionCount > 0 ? totalDecisions / sessionCount : 0,
    };
  }

  /** Increment replay counter (called by DecisionReplayer). */
  incrementReplayCount(): void {
    this.replayCount++;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Remove a session and all its decisions. */
  private removeSession(sessionId: string): void {
    const ids = this.sessions.get(sessionId);
    if (ids) {
      for (const id of ids) {
        this.decisions.delete(id);
      }
    }
    this.sessions.delete(sessionId);
    this.sessionMeta.delete(sessionId);
  }

  /** Remove the oldest session to make room for new recordings. */
  private pruneOldestSession(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [sessionId, meta] of this.sessionMeta) {
      if (meta.startedAt < oldestTime) {
        oldestTime = meta.startedAt;
        oldest = sessionId;
      }
    }

    if (oldest) {
      this.removeSession(oldest);
    }
  }
}
