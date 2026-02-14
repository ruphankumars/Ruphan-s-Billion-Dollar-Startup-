/**
 * Ambient Engine Types — CortexOS Phase II
 *
 * Type definitions for the daemon subsystem: file watching, critic agents,
 * confidence scoring, and sleep reports.
 */

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface DaemonConfig {
  /** Whether the daemon is enabled */
  enabled: boolean;
  /** Directories to watch for file changes */
  watchDirs: string[];
  /** Polling interval in milliseconds for file stat checks (default: 30000) */
  pollIntervalMs: number;
  /** Whether critic agents are enabled for automated review */
  criticsEnabled: boolean;
  /** Minimum confidence threshold to accept results (default: 0.7) */
  confidenceThreshold: number;
  /** Cron expression for sleep report generation */
  sleepReportCron: string;
  /** Maximum number of files to watch (default: 5000) */
  maxWatchFiles: number;
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

export type DaemonState = 'idle' | 'watching' | 'analyzing' | 'reporting' | 'error';

// ═══════════════════════════════════════════════════════════════
// FILE EVENTS
// ═══════════════════════════════════════════════════════════════

export interface FileEvent {
  /** Absolute path to the file */
  path: string;
  /** Type of change */
  type: 'create' | 'modify' | 'delete' | 'rename';
  /** Unix timestamp (ms) when the event occurred */
  timestamp: number;
  /** File size in bytes (if available) */
  size?: number;
  /** MD5 hash of file content (if available) */
  hash?: string;
}

// ═══════════════════════════════════════════════════════════════
// WATCH RULES
// ═══════════════════════════════════════════════════════════════

export interface WatchRule {
  /** Glob pattern to match files (e.g. '**\/*.ts', 'src/**') */
  pattern: string;
  /** Action to take when a matching file changes */
  action: 'analyze' | 'critic' | 'ignore';
  /** Priority level (1-10, higher = more important) */
  priority: number;
}

// ═══════════════════════════════════════════════════════════════
// CRITIC REPORTS
// ═══════════════════════════════════════════════════════════════

export interface CriticIssue {
  /** Severity level */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Category of the issue */
  category: 'security' | 'quality' | 'performance' | 'correctness' | 'style';
  /** Human-readable description of the issue */
  message: string;
  /** File path where the issue was found */
  file?: string;
  /** Line number (1-based) */
  line?: number;
  /** Suggested fix or remediation */
  suggestedFix?: string;
}

export interface CriticReport {
  /** Unique report identifier */
  id: string;
  /** Associated task ID (if triggered by a task) */
  taskId?: string;
  /** Unix timestamp (ms) when the report was generated */
  timestamp: number;
  /** Overall verdict */
  verdict: 'pass' | 'warn' | 'fail';
  /** Confidence in the verdict (0-1) */
  confidence: number;
  /** List of issues found */
  issues: CriticIssue[];
  /** Actionable suggestions */
  suggestions: string[];
  /** Time taken for the review in milliseconds */
  duration: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE SCORING
// ═══════════════════════════════════════════════════════════════

export interface ConfidenceFactor {
  /** Name of the factor (e.g. 'tests', 'lint', 'critic') */
  name: string;
  /** Weight of this factor in the overall score (0-1) */
  weight: number;
  /** Score for this individual factor (0-1) */
  score: number;
  /** Human-readable explanation of the score */
  reason: string;
}

export interface ConfidenceScore {
  /** Overall weighted confidence (0-1) */
  overall: number;
  /** Named score breakdown (factor name -> score) */
  breakdown: Record<string, number>;
  /** Detailed factors that contributed to the score */
  factors: ConfidenceFactor[];
}

// ═══════════════════════════════════════════════════════════════
// SLEEP REPORTS
// ═══════════════════════════════════════════════════════════════

export interface SleepReportSection {
  /** Section title */
  title: string;
  /** Section content (markdown-friendly) */
  content: string;
  /** Optional severity indicator */
  severity?: 'info' | 'warning' | 'critical';
}

export interface SleepReport {
  /** Unique report identifier */
  id: string;
  /** Unix timestamp (ms) when the report was generated */
  generatedAt: number;
  /** Time period covered */
  period: { start: number; end: number };
  /** Brief summary of the report */
  summary: string;
  /** Total number of files changed in the period */
  filesChanged: number;
  /** Number of critic reviews run */
  criticsRun: number;
  /** Total issues found across all critics */
  issuesFound: number;
  /** Overall confidence score for the period */
  confidence: ConfidenceScore;
  /** High-level recommendations */
  recommendations: string[];
  /** Detailed report sections */
  sections: SleepReportSection[];
}

// ═══════════════════════════════════════════════════════════════
// DAEMON EVENTS
// ═══════════════════════════════════════════════════════════════

export type DaemonEvent =
  | { type: 'daemon:started'; timestamp: number }
  | { type: 'daemon:stopped'; timestamp: number }
  | { type: 'daemon:error'; timestamp: number; error: string }
  | { type: 'daemon:file:changed'; timestamp: number; event: FileEvent }
  | { type: 'daemon:critic:complete'; timestamp: number; report: CriticReport }
  | { type: 'daemon:report:generated'; timestamp: number; report: SleepReport }
  | { type: 'daemon:state:changed'; timestamp: number; from: DaemonState; to: DaemonState };
