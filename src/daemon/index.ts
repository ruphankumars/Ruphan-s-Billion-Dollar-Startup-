/**
 * Ambient Engine — CortexOS Phase II
 *
 * The daemon subsystem provides continuous background monitoring, automated
 * code review, confidence scoring, and periodic reporting.
 *
 * @example
 * ```typescript
 * import { CortexDaemon } from 'cortexos/daemon';
 *
 * const daemon = new CortexDaemon({
 *   enabled: true,
 *   watchDirs: ['/path/to/project/src'],
 *   pollIntervalMs: 30000,
 *   criticsEnabled: true,
 *   confidenceThreshold: 0.7,
 *   sleepReportCron: '0 6 * * *',
 *   maxWatchFiles: 5000,
 * });
 *
 * await daemon.start();
 * ```
 */

export { CortexDaemon } from './daemon.js';
export { FileWatcher } from './file-watcher.js';
export { CriticAgent } from './critic-agent.js';
export { ConfidenceScorer } from './confidence-scorer.js';
export { SleepReportGenerator } from './sleep-report.js';
export type {
  DaemonConfig,
  DaemonState,
  FileEvent,
  WatchRule,
  CriticReport,
  CriticIssue,
  ConfidenceScore,
  ConfidenceFactor,
  SleepReport,
  SleepReportSection,
  DaemonEvent,
} from './types.js';
