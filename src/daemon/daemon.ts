/**
 * CortexDaemon — The Ambient Engine
 *
 * Main daemon that ties together file watching, critic agents, confidence
 * scoring, and sleep report generation into a cohesive background engine.
 *
 * Lifecycle:
 * 1. start() — creates components, begins watching, schedules sleep reports
 * 2. On file change: if critics enabled and rule matches, queues a critic review
 * 3. Critic reviews are debounced (5s window to batch rapid changes)
 * 4. Sleep reports generated periodically (default: every 24 hours)
 * 5. stop() — gracefully shuts down all watchers and timers
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import type {
  DaemonConfig,
  DaemonState,
  FileEvent,
  CriticReport,
  SleepReport,
  ConfidenceScore,
} from './types.js';
import { FileWatcher } from './file-watcher.js';
import { CriticAgent } from './critic-agent.js';
import { ConfidenceScorer } from './confidence-scorer.js';
import { SleepReportGenerator } from './sleep-report.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Debounce window for batching file changes before critic review */
const CRITIC_DEBOUNCE_MS = 5000;

/** Default sleep report interval: 24 hours */
const DEFAULT_REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Max history sizes */
const MAX_CRITIC_REPORTS = 100;
const MAX_SLEEP_REPORTS = 30;
const MAX_FILE_EVENTS = 1000;

// ═══════════════════════════════════════════════════════════════
// CORTEX DAEMON
// ═══════════════════════════════════════════════════════════════

export class CortexDaemon extends EventEmitter {
  private config: DaemonConfig;
  private state: DaemonState = 'idle';

  // Components
  private fileWatcher: FileWatcher;
  private criticAgent: CriticAgent;
  private confidenceScorer: ConfidenceScorer;
  private sleepReportGenerator: SleepReportGenerator;

  // Timers
  private sleepReportTimer: ReturnType<typeof setInterval> | null = null;
  private criticDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // State tracking
  private startTime = 0;
  private lastReportTime = 0;

  // History
  private criticReportHistory: CriticReport[] = [];
  private sleepReportHistory: SleepReport[] = [];
  private fileEventHistory: FileEvent[] = [];

  // Critic batching
  private pendingCriticFiles: Map<string, { path: string; content: string }> = new Map();

  constructor(config: DaemonConfig) {
    super();

    // Apply defaults
    this.config = {
      enabled: config.enabled,
      watchDirs: config.watchDirs,
      pollIntervalMs: config.pollIntervalMs ?? 30000,
      criticsEnabled: config.criticsEnabled ?? false,
      confidenceThreshold: config.confidenceThreshold ?? 0.7,
      sleepReportCron: config.sleepReportCron ?? '0 6 * * *',
      maxWatchFiles: config.maxWatchFiles ?? 5000,
    };

    // Initialize components
    this.fileWatcher = new FileWatcher({
      pollIntervalMs: this.config.pollIntervalMs,
      maxFiles: this.config.maxWatchFiles,
    });

    this.criticAgent = new CriticAgent();
    this.confidenceScorer = new ConfidenceScorer();
    this.sleepReportGenerator = new SleepReportGenerator({ templateStyle: 'detailed' });

    // Wire up file watcher events
    this.setupFileWatcherListeners();
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  /**
   * Start the daemon: begin file watching and schedule sleep reports.
   */
  async start(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'error') {
      return; // Already running
    }

    this.setState('watching');
    this.startTime = Date.now();
    this.lastReportTime = Date.now();

    // Start watching configured directories
    for (const dir of this.config.watchDirs) {
      try {
        this.fileWatcher.watch(dir);
      } catch (err) {
        this.emit('daemon:error', {
          type: 'daemon:error' as const,
          timestamp: Date.now(),
          error: `Failed to watch directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Schedule periodic sleep reports
    this.scheduleSleepReports();

    this.emit('daemon:started', {
      type: 'daemon:started' as const,
      timestamp: Date.now(),
    });
  }

  /**
   * Gracefully stop the daemon: stop watching, cancel timers, flush state.
   */
  async stop(): Promise<void> {
    // Stop file watcher
    this.fileWatcher.unwatchAll();

    // Cancel sleep report timer
    if (this.sleepReportTimer) {
      clearInterval(this.sleepReportTimer);
      this.sleepReportTimer = null;
    }

    // Cancel critic debounce timer
    if (this.criticDebounceTimer) {
      clearTimeout(this.criticDebounceTimer);
      this.criticDebounceTimer = null;
    }

    // Clear pending critic batch
    this.pendingCriticFiles.clear();

    this.setState('idle');

    this.emit('daemon:stopped', {
      type: 'daemon:stopped' as const,
      timestamp: Date.now(),
    });
  }

  /**
   * Get the current daemon state.
   */
  getState(): DaemonState {
    return this.state;
  }

  // ─────────────────────────────────────────────────────────
  // COMPONENT ACCESS
  // ─────────────────────────────────────────────────────────

  getFileWatcher(): FileWatcher {
    return this.fileWatcher;
  }

  getCritic(): CriticAgent {
    return this.criticAgent;
  }

  getConfidenceScorer(): ConfidenceScorer {
    return this.confidenceScorer;
  }

  getSleepReportGenerator(): SleepReportGenerator {
    return this.sleepReportGenerator;
  }

  // ─────────────────────────────────────────────────────────
  // MANUAL TRIGGERS
  // ─────────────────────────────────────────────────────────

  /**
   * Manually run the critic agent on a set of files.
   */
  async runCritic(files: Array<{ path: string; content: string }>): Promise<CriticReport> {
    const previousState = this.state;
    this.setState('analyzing');

    try {
      const report = await this.criticAgent.review({ files });
      this.addCriticReport(report);

      this.emit('daemon:critic:complete', {
        type: 'daemon:critic:complete' as const,
        timestamp: Date.now(),
        report,
      });

      return report;
    } finally {
      this.setState(previousState === 'idle' ? 'idle' : 'watching');
    }
  }

  /**
   * Manually trigger a sleep report.
   */
  async generateSleepReport(): Promise<SleepReport> {
    const previousState = this.state;
    this.setState('reporting');

    try {
      const now = Date.now();
      const report = this.sleepReportGenerator.generate({
        period: { start: this.lastReportTime, end: now },
        fileEvents: this.getFileEvents(this.lastReportTime),
        criticReports: this.criticReportHistory.filter(
          (r) => r.timestamp >= this.lastReportTime,
        ),
      });

      this.addSleepReport(report);
      this.lastReportTime = now;

      this.emit('daemon:report:generated', {
        type: 'daemon:report:generated' as const,
        timestamp: Date.now(),
        report,
      });

      return report;
    } finally {
      this.setState(previousState === 'idle' ? 'idle' : 'watching');
    }
  }

  /**
   * Score confidence for a given execution context.
   */
  async scoreConfidence(
    context: Parameters<ConfidenceScorer['score']>[0],
  ): Promise<ConfidenceScore> {
    return this.confidenceScorer.score(context);
  }

  // ─────────────────────────────────────────────────────────
  // HISTORY
  // ─────────────────────────────────────────────────────────

  /**
   * Get recent critic reports, newest first.
   */
  getRecentCriticReports(limit = 10): CriticReport[] {
    return this.criticReportHistory
      .slice(-limit)
      .reverse();
  }

  /**
   * Get recent sleep reports, newest first.
   */
  getRecentSleepReports(limit = 5): SleepReport[] {
    return this.sleepReportHistory
      .slice(-limit)
      .reverse();
  }

  /**
   * Get file events since a given timestamp.
   */
  getFileEvents(since?: number): FileEvent[] {
    if (since === undefined) {
      return [...this.fileEventHistory];
    }
    return this.fileEventHistory.filter((e) => e.timestamp >= since);
  }

  // ─────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────

  /**
   * Get daemon operational statistics.
   */
  getStats(): {
    uptime: number;
    filesWatched: number;
    criticsRun: number;
    reportsGenerated: number;
    state: DaemonState;
  } {
    return {
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      filesWatched: this.fileWatcher.getWatchedDirs().length,
      criticsRun: this.criticAgent.getReviewCount(),
      reportsGenerated: this.sleepReportHistory.length,
      state: this.state,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Event wiring
  // ─────────────────────────────────────────────────────────

  private setupFileWatcherListeners(): void {
    const handleFileEvent = (event: FileEvent) => {
      this.addFileEvent(event);

      this.emit('daemon:file:changed', {
        type: 'daemon:file:changed' as const,
        timestamp: Date.now(),
        event,
      });

      // Queue for critic review if enabled
      if (this.config.criticsEnabled) {
        this.queueForCritic(event);
      }
    };

    this.fileWatcher.on('file:changed', handleFileEvent);
    this.fileWatcher.on('file:created', handleFileEvent);
    this.fileWatcher.on('file:deleted', (event: FileEvent) => {
      this.addFileEvent(event);
      this.emit('daemon:file:changed', {
        type: 'daemon:file:changed' as const,
        timestamp: Date.now(),
        event,
      });
    });

    this.fileWatcher.on('watcher:error', (errorData: { dir?: string; file?: string; error: unknown }) => {
      const errorMsg = errorData.error instanceof Error
        ? errorData.error.message
        : String(errorData.error);
      this.emit('daemon:error', {
        type: 'daemon:error' as const,
        timestamp: Date.now(),
        error: `Watcher error${errorData.dir ? ` in ${errorData.dir}` : ''}${errorData.file ? ` for ${errorData.file}` : ''}: ${errorMsg}`,
      });
    });
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Critic batching with debounce
  // ─────────────────────────────────────────────────────────

  private queueForCritic(event: FileEvent): void {
    // Only queue create/modify events for review
    if (event.type !== 'create' && event.type !== 'modify') {
      return;
    }

    // Read file content asynchronously
    fs.promises.readFile(event.path, 'utf-8')
      .then((content) => {
        this.pendingCriticFiles.set(event.path, { path: event.path, content });
        this.debounceCriticReview();
      })
      .catch(() => {
        // File may have been deleted between event and read
      });
  }

  private debounceCriticReview(): void {
    // Reset the debounce timer
    if (this.criticDebounceTimer) {
      clearTimeout(this.criticDebounceTimer);
    }

    this.criticDebounceTimer = setTimeout(() => {
      this.criticDebounceTimer = null;
      this.runBatchedCriticReview().catch((err) => {
        this.emit('daemon:error', {
          type: 'daemon:error' as const,
          timestamp: Date.now(),
          error: `Critic review failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    }, CRITIC_DEBOUNCE_MS);
  }

  private async runBatchedCriticReview(): Promise<void> {
    if (this.pendingCriticFiles.size === 0) return;

    // Grab the batch and clear pending
    const files = [...this.pendingCriticFiles.values()];
    this.pendingCriticFiles.clear();

    const previousState = this.state;
    this.setState('analyzing');

    try {
      const report = await this.criticAgent.review({ files });
      this.addCriticReport(report);

      this.emit('daemon:critic:complete', {
        type: 'daemon:critic:complete' as const,
        timestamp: Date.now(),
        report,
      });
    } finally {
      this.setState(previousState === 'idle' ? 'idle' : 'watching');
    }
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Sleep report scheduling
  // ─────────────────────────────────────────────────────────

  private scheduleSleepReports(): void {
    // Simple interval-based scheduling (the cron expression is stored for
    // future integration with the automation module's CronScheduler)
    this.sleepReportTimer = setInterval(() => {
      this.generateSleepReport().catch((err) => {
        this.emit('daemon:error', {
          type: 'daemon:error' as const,
          timestamp: Date.now(),
          error: `Sleep report generation failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    }, DEFAULT_REPORT_INTERVAL_MS);
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — State management
  // ─────────────────────────────────────────────────────────

  private setState(newState: DaemonState): void {
    if (this.state === newState) return;

    const from = this.state;
    this.state = newState;

    this.emit('daemon:state:changed', {
      type: 'daemon:state:changed' as const,
      timestamp: Date.now(),
      from,
      to: newState,
    });
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — History management (bounded)
  // ─────────────────────────────────────────────────────────

  private addFileEvent(event: FileEvent): void {
    this.fileEventHistory.push(event);
    if (this.fileEventHistory.length > MAX_FILE_EVENTS) {
      this.fileEventHistory.splice(0, this.fileEventHistory.length - MAX_FILE_EVENTS);
    }
  }

  private addCriticReport(report: CriticReport): void {
    this.criticReportHistory.push(report);
    if (this.criticReportHistory.length > MAX_CRITIC_REPORTS) {
      this.criticReportHistory.splice(0, this.criticReportHistory.length - MAX_CRITIC_REPORTS);
    }
  }

  private addSleepReport(report: SleepReport): void {
    this.sleepReportHistory.push(report);
    if (this.sleepReportHistory.length > MAX_SLEEP_REPORTS) {
      this.sleepReportHistory.splice(0, this.sleepReportHistory.length - MAX_SLEEP_REPORTS);
    }
  }
}
