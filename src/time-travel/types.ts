/**
 * Time-Travel Debugging Types
 *
 * Primitives for recording agent decision points, replaying sessions
 * from arbitrary decision boundaries, and analyzing divergences between
 * original and replayed executions.
 *
 * Part of CortexOS Time-Travel Debugging Module
 */

// ---------------------------------------------------------------------------
// Decision records
// ---------------------------------------------------------------------------

export interface DecisionRecord {
  id: string;
  sessionId: string;
  timestamp: number;
  stage: string;
  decision: string;
  alternatives: string[];
  context: DecisionContext;
  outcome?: DecisionOutcome;
  parentId?: string;
}

export interface DecisionContext {
  prompt: string;
  availableTools: string[];
  memoryState: Record<string, unknown>;
  agentState: Record<string, unknown>;
  environmentSnapshot: Record<string, unknown>;
}

export interface DecisionOutcome {
  success: boolean;
  result: string;
  filesChanged: string[];
  tokensUsed: number;
  duration: number;
  quality?: number;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayConfig {
  sessionId: string;
  fromDecisionId?: string;
  toDecisionId?: string;
  overrides?: Record<string, unknown>;
  dryRun: boolean;
  maxDecisions?: number;
}

export interface ReplayResult {
  sessionId: string;
  originalSessionId: string;
  decisionsReplayed: number;
  divergences: Divergence[];
  outcomes: DecisionOutcome[];
  duration: number;
}

// ---------------------------------------------------------------------------
// Divergences
// ---------------------------------------------------------------------------

export interface Divergence {
  decisionId: string;
  stage: string;
  originalDecision: string;
  replayedDecision: string;
  reason: string;
  impact: 'none' | 'minor' | 'major' | 'critical';
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TimeTravelConfig {
  enabled: boolean;
  maxRecordings: number;
  recordContext: boolean;
  recordEnvironment: boolean;
  snapshotInterval: number;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface TimeTravelStats {
  totalRecordings: number;
  totalReplays: number;
  totalDivergences: number;
  sessionsRecorded: number;
  avgDecisionsPerSession: number;
}
