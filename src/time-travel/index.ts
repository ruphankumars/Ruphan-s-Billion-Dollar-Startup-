/**
 * CortexOS Time-Travel Debugging Module
 *
 * Record, replay, and analyse agent decision sequences. Detect
 * divergences between original executions and replays to understand
 * non-determinism, evaluate alternative strategies, and debug complex
 * multi-step agent runs.
 *
 * @example
 * ```typescript
 * import { DecisionRecorder, DecisionReplayer, DivergenceAnalyzer } from 'cortexos';
 *
 * const recorder = new DecisionRecorder();
 * const sessionId = recorder.startSession();
 *
 * recorder.record({
 *   sessionId,
 *   stage: 'plan',
 *   decision: 'use-react-agent',
 *   alternatives: ['use-tot', 'use-reflexion'],
 *   context: { prompt: 'Build auth', availableTools: ['read', 'write'], memoryState: {}, agentState: {}, environmentSnapshot: {} },
 * });
 *
 * recorder.endSession(sessionId);
 *
 * const replayer = new DecisionReplayer(recorder);
 * const result = replayer.replay({ sessionId, dryRun: true });
 * console.log(result.divergences);
 * ```
 */

export { DecisionRecorder } from './recorder.js';
export { DecisionReplayer } from './replayer.js';
export { DivergenceAnalyzer } from './diff-analyzer.js';
export type {
  DecisionRecord,
  DecisionContext,
  DecisionOutcome,
  ReplayConfig,
  ReplayResult,
  Divergence,
  TimeTravelConfig,
  TimeTravelStats,
} from './types.js';
