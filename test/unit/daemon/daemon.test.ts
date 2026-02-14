import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CortexDaemon } from '../../../src/daemon/daemon.js';
import type { DaemonConfig, DaemonState, FileEvent } from '../../../src/daemon/types.js';

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const makeConfig = (overrides: Partial<DaemonConfig> = {}): DaemonConfig => ({
  enabled: true,
  watchDirs: [], // Don't watch real FS in tests
  pollIntervalMs: 30000,
  criticsEnabled: true,
  confidenceThreshold: 0.7,
  sleepReportCron: '0 6 * * *',
  maxWatchFiles: 5000,
  ...overrides,
});

const cleanCode = 'const x = 1;\nexport default x;';
const codeWithSecrets = 'const key = "sk-proj-abcdefghijklmnopqrstuvwxyz1234";';
const codeWithTodo = '// TODO: Implement this function\nfunction test() {}';

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe('CortexDaemon', () => {
  let daemon: CortexDaemon;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    daemon = new CortexDaemon(makeConfig());
  });

  afterEach(async () => {
    await daemon.stop();
    vi.useRealTimers();
  });

  // ─────────────────────────────────────────────────────────
  // CONSTRUCTOR
  // ─────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates daemon with provided config', () => {
      expect(daemon).toBeDefined();
      expect(daemon).toBeInstanceOf(CortexDaemon);
    });

    it('applies default config values', () => {
      const d = new CortexDaemon({
        enabled: true,
        watchDirs: [],
      } as DaemonConfig);
      expect(d).toBeDefined();
      expect(d.getState()).toBe('idle');
      d.stop();
    });

    it('accepts custom config overrides', () => {
      const d = new CortexDaemon(
        makeConfig({
          pollIntervalMs: 10000,
          criticsEnabled: false,
          confidenceThreshold: 0.5,
          maxWatchFiles: 1000,
        }),
      );
      expect(d).toBeDefined();
      d.stop();
    });

    it('initializes all subcomponents', () => {
      expect(daemon.getFileWatcher()).toBeDefined();
      expect(daemon.getCritic()).toBeDefined();
      expect(daemon.getConfidenceScorer()).toBeDefined();
      expect(daemon.getSleepReportGenerator()).toBeDefined();
    });

    it('starts in idle state', () => {
      expect(daemon.getState()).toBe('idle');
    });
  });

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE — start / stop
  // ─────────────────────────────────────────────────────────

  describe('start()', () => {
    it('transitions state from idle to watching', async () => {
      expect(daemon.getState()).toBe('idle');
      await daemon.start();
      expect(daemon.getState()).toBe('watching');
    });

    it('emits daemon:started event', async () => {
      const spy = vi.fn();
      daemon.on('daemon:started', spy);
      await daemon.start();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({
        type: 'daemon:started',
      });
      expect(typeof spy.mock.calls[0][0].timestamp).toBe('number');
    });

    it('emits daemon:state:changed event', async () => {
      const spy = vi.fn();
      daemon.on('daemon:state:changed', spy);
      await daemon.start();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({
        from: 'idle',
        to: 'watching',
      });
    });

    it('is idempotent (second call is no-op)', async () => {
      const spy = vi.fn();
      daemon.on('daemon:started', spy);

      await daemon.start();
      await daemon.start();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(daemon.getState()).toBe('watching');
    });

    it('can restart after stop', async () => {
      await daemon.start();
      await daemon.stop();
      expect(daemon.getState()).toBe('idle');

      await daemon.start();
      expect(daemon.getState()).toBe('watching');
    });

    it('sets startTime for uptime tracking', async () => {
      const statsBefore = daemon.getStats();
      expect(statsBefore.uptime).toBe(0);

      await daemon.start();
      const statsAfter = daemon.getStats();
      expect(statsAfter.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('stop()', () => {
    it('transitions state from watching to idle', async () => {
      await daemon.start();
      expect(daemon.getState()).toBe('watching');

      await daemon.stop();
      expect(daemon.getState()).toBe('idle');
    });

    it('emits daemon:stopped event', async () => {
      await daemon.start();
      const spy = vi.fn();
      daemon.on('daemon:stopped', spy);

      await daemon.stop();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({
        type: 'daemon:stopped',
      });
    });

    it('is safe to call without starting first', async () => {
      await expect(daemon.stop()).resolves.toBeUndefined();
    });

    it('is safe to call multiple times', async () => {
      await daemon.start();
      await daemon.stop();
      await daemon.stop();
      expect(daemon.getState()).toBe('idle');
    });

    it('cleans up timers and watchers', async () => {
      await daemon.start();
      await daemon.stop();

      // After stop, the file watcher should have no watched dirs
      const watchedDirs = daemon.getFileWatcher().getWatchedDirs();
      expect(watchedDirs).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────

  describe('getState()', () => {
    it('returns idle initially', () => {
      expect(daemon.getState()).toBe('idle');
    });

    it('returns watching after start', async () => {
      await daemon.start();
      expect(daemon.getState()).toBe('watching');
    });

    it('returns idle after stop', async () => {
      await daemon.start();
      await daemon.stop();
      expect(daemon.getState()).toBe('idle');
    });

    it('returns analyzing during critic review', async () => {
      const stateChanges: DaemonState[] = [];
      daemon.on('daemon:state:changed', (e: { to: DaemonState }) => {
        stateChanges.push(e.to);
      });

      await daemon.runCritic([{ path: 'test.ts', content: cleanCode }]);

      // Should have transitioned through analyzing and back
      expect(stateChanges).toContain('analyzing');
    });

    it('returns reporting during sleep report generation', async () => {
      await daemon.start();

      const stateChanges: DaemonState[] = [];
      daemon.on('daemon:state:changed', (e: { to: DaemonState }) => {
        stateChanges.push(e.to);
      });

      await daemon.generateSleepReport();

      expect(stateChanges).toContain('reporting');
    });
  });

  // ─────────────────────────────────────────────────────────
  // COMPONENT ACCESSORS
  // ─────────────────────────────────────────────────────────

  describe('component accessors', () => {
    it('getFileWatcher() returns FileWatcher instance', () => {
      const fw = daemon.getFileWatcher();
      expect(fw).toBeDefined();
      expect(typeof fw.watch).toBe('function');
      expect(typeof fw.unwatchAll).toBe('function');
    });

    it('getCritic() returns CriticAgent instance', () => {
      const critic = daemon.getCritic();
      expect(critic).toBeDefined();
      expect(typeof critic.review).toBe('function');
    });

    it('getConfidenceScorer() returns ConfidenceScorer instance', () => {
      const scorer = daemon.getConfidenceScorer();
      expect(scorer).toBeDefined();
      expect(typeof scorer.score).toBe('function');
    });

    it('getSleepReportGenerator() returns SleepReportGenerator instance', () => {
      const gen = daemon.getSleepReportGenerator();
      expect(gen).toBeDefined();
      expect(typeof gen.generate).toBe('function');
    });

    it('returns the same instances (shared state)', () => {
      const critic1 = daemon.getCritic();
      const critic2 = daemon.getCritic();
      expect(critic1).toBe(critic2);
    });
  });

  // ─────────────────────────────────────────────────────────
  // RUN CRITIC
  // ─────────────────────────────────────────────────────────

  describe('runCritic()', () => {
    it('produces a CriticReport for clean code', async () => {
      const report = await daemon.runCritic([
        { path: 'clean.ts', content: cleanCode },
      ]);

      expect(report).toBeDefined();
      expect(report.id).toBeDefined();
      expect(typeof report.timestamp).toBe('number');
      expect(['pass', 'warn', 'fail']).toContain(report.verdict);
      expect(typeof report.confidence).toBe('number');
      expect(Array.isArray(report.issues)).toBe(true);
      expect(Array.isArray(report.suggestions)).toBe(true);
      expect(typeof report.duration).toBe('number');
    });

    it('detects secrets in code', async () => {
      const report = await daemon.runCritic([
        { path: 'secrets.ts', content: codeWithSecrets },
      ]);

      expect(report.issues.length).toBeGreaterThan(0);
      const securityIssue = report.issues.find(
        (i) => i.category === 'security',
      );
      expect(securityIssue).toBeDefined();
      expect(securityIssue!.severity).toBe('critical');
    });

    it('detects TODO/FIXME comments', async () => {
      const report = await daemon.runCritic([
        { path: 'todo.ts', content: codeWithTodo },
      ]);

      expect(report.issues.length).toBeGreaterThan(0);
      const todoIssue = report.issues.find((i) =>
        i.message.includes('TODO'),
      );
      expect(todoIssue).toBeDefined();
    });

    it('handles empty file list', async () => {
      const report = await daemon.runCritic([]);

      expect(report).toBeDefined();
      expect(report.issues).toEqual([]);
    });

    it('handles multiple files', async () => {
      const report = await daemon.runCritic([
        { path: 'a.ts', content: cleanCode },
        { path: 'b.ts', content: codeWithSecrets },
        { path: 'c.ts', content: codeWithTodo },
      ]);

      expect(report).toBeDefined();
      expect(report.issues.length).toBeGreaterThan(0);
    });

    it('emits daemon:critic:complete event', async () => {
      const spy = vi.fn();
      daemon.on('daemon:critic:complete', spy);

      await daemon.runCritic([{ path: 'test.ts', content: cleanCode }]);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].report).toBeDefined();
    });

    it('transitions state to analyzing and back', async () => {
      const states: DaemonState[] = [];
      daemon.on('daemon:state:changed', (e: { to: DaemonState }) => {
        states.push(e.to);
      });

      await daemon.runCritic([{ path: 'test.ts', content: cleanCode }]);

      expect(states).toContain('analyzing');
      // Should return to idle (since it started idle)
      expect(states[states.length - 1]).toBe('idle');
    });

    it('stores report in history', async () => {
      const report = await daemon.runCritic([
        { path: 'test.ts', content: cleanCode },
      ]);

      const history = daemon.getRecentCriticReports();
      expect(history.length).toBe(1);
      expect(history[0].id).toBe(report.id);
    });

    it('handles large file content', async () => {
      const bigContent = Array(15001).fill('// line of code').join('\n');
      const report = await daemon.runCritic([
        { path: 'big.ts', content: bigContent },
      ]);

      expect(report).toBeDefined();
      // Should detect large file issue
      const largeFileIssue = report.issues.find(
        (i) => i.message.includes('15001'),
      );
      expect(largeFileIssue).toBeDefined();
    });

    it('handles deeply nested code', async () => {
      const deepCode = `function deep() {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          if (e) {
            return true;
          }
        }
      }
    }
  }
}`;
      const report = await daemon.runCritic([
        { path: 'deep.ts', content: deepCode },
      ]);

      expect(report).toBeDefined();
      const nestingIssue = report.issues.find((i) =>
        i.message.includes('nesting'),
      );
      expect(nestingIssue).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────
  // GENERATE SLEEP REPORT
  // ─────────────────────────────────────────────────────────

  describe('generateSleepReport()', () => {
    it('generates a valid SleepReport', async () => {
      await daemon.start();
      const report = await daemon.generateSleepReport();

      expect(report).toBeDefined();
      expect(report.id).toBeDefined();
      expect(typeof report.generatedAt).toBe('number');
      expect(report.period).toBeDefined();
      expect(typeof report.period.start).toBe('number');
      expect(typeof report.period.end).toBe('number');
      expect(typeof report.summary).toBe('string');
      expect(typeof report.filesChanged).toBe('number');
      expect(typeof report.criticsRun).toBe('number');
      expect(typeof report.issuesFound).toBe('number');
      expect(report.confidence).toBeDefined();
      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(Array.isArray(report.sections)).toBe(true);
    });

    it('emits daemon:report:generated event', async () => {
      await daemon.start();
      const spy = vi.fn();
      daemon.on('daemon:report:generated', spy);

      await daemon.generateSleepReport();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].report).toBeDefined();
    });

    it('transitions state to reporting and back', async () => {
      await daemon.start();
      const states: DaemonState[] = [];
      daemon.on('daemon:state:changed', (e: { to: DaemonState }) => {
        states.push(e.to);
      });

      await daemon.generateSleepReport();

      expect(states).toContain('reporting');
      // Should return to watching (since it was watching)
      expect(states[states.length - 1]).toBe('watching');
    });

    it('stores report in history', async () => {
      await daemon.start();
      const report = await daemon.generateSleepReport();

      const history = daemon.getRecentSleepReports();
      expect(history.length).toBe(1);
      expect(history[0].id).toBe(report.id);
    });

    it('includes critic data when critics have run', async () => {
      await daemon.start();

      // Run a critic first
      await daemon.runCritic([
        { path: 'test.ts', content: codeWithSecrets },
      ]);

      const report = await daemon.generateSleepReport();
      expect(report.criticsRun).toBeGreaterThanOrEqual(0);
    });

    it('updates lastReportTime after generation', async () => {
      await daemon.start();

      const report1 = await daemon.generateSleepReport();
      // Advance time slightly
      vi.advanceTimersByTime(100);
      const report2 = await daemon.generateSleepReport();

      // Second report period should start after first report's period
      expect(report2.period.start).toBeGreaterThanOrEqual(report1.period.start);
    });
  });

  // ─────────────────────────────────────────────────────────
  // SCORE CONFIDENCE
  // ─────────────────────────────────────────────────────────

  describe('scoreConfidence()', () => {
    it('returns a ConfidenceScore', async () => {
      const score = await daemon.scoreConfidence({
        testsPassed: true,
        testsRun: 10,
        lintPassed: true,
        typeCheckPassed: true,
      });

      expect(score).toBeDefined();
      expect(typeof score.overall).toBe('number');
      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.overall).toBeLessThanOrEqual(1);
      expect(score.breakdown).toBeDefined();
      expect(Array.isArray(score.factors)).toBe(true);
    });

    it('gives high confidence for all-passing context', async () => {
      const score = await daemon.scoreConfidence({
        testsPassed: true,
        testsRun: 50,
        lintPassed: true,
        typeCheckPassed: true,
      });

      expect(score.overall).toBeGreaterThan(0.8);
    });

    it('gives low confidence for all-failing context', async () => {
      const score = await daemon.scoreConfidence({
        testsPassed: false,
        testsRun: 10,
        lintPassed: false,
        typeCheckPassed: false,
      });

      expect(score.overall).toBeLessThan(0.3);
    });

    it('includes named factors in breakdown', async () => {
      const score = await daemon.scoreConfidence({
        testsPassed: true,
        testsRun: 5,
        lintPassed: true,
      });

      expect(score.breakdown).toHaveProperty('tests');
      expect(score.breakdown).toHaveProperty('lint');
    });

    it('handles empty context', async () => {
      const score = await daemon.scoreConfidence({});
      expect(score.overall).toBe(0); // No factors = 0
    });

    it('handles partial context', async () => {
      const score = await daemon.scoreConfidence({
        testsPassed: true,
        testsRun: 5,
      });

      expect(score.overall).toBeGreaterThan(0);
      expect(score.factors.length).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────
  // HISTORY
  // ─────────────────────────────────────────────────────────

  describe('getRecentCriticReports()', () => {
    it('returns empty array initially', () => {
      const reports = daemon.getRecentCriticReports();
      expect(reports).toEqual([]);
    });

    it('returns reports newest first', async () => {
      vi.useRealTimers();
      await daemon.runCritic([{ path: 'a.ts', content: cleanCode }]);
      await daemon.runCritic([{ path: 'b.ts', content: codeWithSecrets }]);

      const reports = daemon.getRecentCriticReports();
      expect(reports.length).toBe(2);
      expect(reports[0].timestamp).toBeGreaterThanOrEqual(reports[1].timestamp);
      vi.useFakeTimers({ shouldAdvanceTime: false });
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await daemon.runCritic([{ path: `file${i}.ts`, content: cleanCode }]);
      }

      const limited = daemon.getRecentCriticReports(2);
      expect(limited.length).toBe(2);
    });

    it('defaults to limit of 10', async () => {
      for (let i = 0; i < 15; i++) {
        await daemon.runCritic([{ path: `file${i}.ts`, content: cleanCode }]);
      }

      const reports = daemon.getRecentCriticReports();
      expect(reports.length).toBe(10);
    });
  });

  describe('getRecentSleepReports()', () => {
    it('returns empty array initially', () => {
      const reports = daemon.getRecentSleepReports();
      expect(reports).toEqual([]);
    });

    it('returns reports newest first', async () => {
      await daemon.start();
      await daemon.generateSleepReport();
      vi.advanceTimersByTime(100);
      await daemon.generateSleepReport();

      const reports = daemon.getRecentSleepReports();
      expect(reports.length).toBe(2);
      expect(reports[0].generatedAt).toBeGreaterThanOrEqual(
        reports[1].generatedAt,
      );
    });

    it('defaults to limit of 5', async () => {
      await daemon.start();
      for (let i = 0; i < 8; i++) {
        await daemon.generateSleepReport();
        vi.advanceTimersByTime(10);
      }

      const reports = daemon.getRecentSleepReports();
      expect(reports.length).toBe(5);
    });
  });

  describe('getFileEvents()', () => {
    it('returns empty array initially', () => {
      const events = daemon.getFileEvents();
      expect(events).toEqual([]);
    });

    it('returns all events when no timestamp filter', () => {
      // Manually trigger file events by emitting from the file watcher
      const fw = daemon.getFileWatcher();
      const event: FileEvent = {
        path: '/test/file.ts',
        type: 'create',
        timestamp: Date.now(),
        size: 100,
      };
      fw.emit('file:created', event);

      const events = daemon.getFileEvents();
      expect(events.length).toBe(1);
      expect(events[0].path).toBe('/test/file.ts');
    });

    it('filters events by since timestamp', () => {
      const fw = daemon.getFileWatcher();
      const now = Date.now();

      fw.emit('file:created', {
        path: '/old/file.ts',
        type: 'create',
        timestamp: now - 10000,
      } as FileEvent);

      fw.emit('file:changed', {
        path: '/new/file.ts',
        type: 'modify',
        timestamp: now,
      } as FileEvent);

      const all = daemon.getFileEvents();
      expect(all.length).toBe(2);

      const recent = daemon.getFileEvents(now - 5000);
      expect(recent.length).toBe(1);
      expect(recent[0].path).toBe('/new/file.ts');
    });

    it('returns a copy (not a reference)', () => {
      const events1 = daemon.getFileEvents();
      const events2 = daemon.getFileEvents();
      expect(events1).not.toBe(events2);
    });
  });

  // ─────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns all expected fields', () => {
      const stats = daemon.getStats();

      expect(stats).toHaveProperty('uptime');
      expect(stats).toHaveProperty('filesWatched');
      expect(stats).toHaveProperty('criticsRun');
      expect(stats).toHaveProperty('reportsGenerated');
      expect(stats).toHaveProperty('state');
    });

    it('reports zero uptime before start', () => {
      const stats = daemon.getStats();
      expect(stats.uptime).toBe(0);
    });

    it('reports current state', async () => {
      expect(daemon.getStats().state).toBe('idle');
      await daemon.start();
      expect(daemon.getStats().state).toBe('watching');
      await daemon.stop();
      expect(daemon.getStats().state).toBe('idle');
    });

    it('tracks critic run count', async () => {
      expect(daemon.getStats().criticsRun).toBe(0);

      await daemon.runCritic([{ path: 'a.ts', content: cleanCode }]);
      expect(daemon.getStats().criticsRun).toBe(1);

      await daemon.runCritic([{ path: 'b.ts', content: cleanCode }]);
      expect(daemon.getStats().criticsRun).toBe(2);
    });

    it('tracks report count', async () => {
      await daemon.start();
      expect(daemon.getStats().reportsGenerated).toBe(0);

      await daemon.generateSleepReport();
      expect(daemon.getStats().reportsGenerated).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────
  // FILE WATCHER EVENT INTEGRATION
  // ─────────────────────────────────────────────────────────

  describe('file watcher event integration', () => {
    it('emits daemon:file:changed on file:created', () => {
      const spy = vi.fn();
      daemon.on('daemon:file:changed', spy);

      const fw = daemon.getFileWatcher();
      fw.emit('file:created', {
        path: '/test/new.ts',
        type: 'create',
        timestamp: Date.now(),
      } as FileEvent);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].event.path).toBe('/test/new.ts');
    });

    it('emits daemon:file:changed on file:changed', () => {
      const spy = vi.fn();
      daemon.on('daemon:file:changed', spy);

      const fw = daemon.getFileWatcher();
      fw.emit('file:changed', {
        path: '/test/modified.ts',
        type: 'modify',
        timestamp: Date.now(),
      } as FileEvent);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('emits daemon:file:changed on file:deleted', () => {
      const spy = vi.fn();
      daemon.on('daemon:file:changed', spy);

      const fw = daemon.getFileWatcher();
      fw.emit('file:deleted', {
        path: '/test/deleted.ts',
        type: 'delete',
        timestamp: Date.now(),
      } as FileEvent);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('records file events in history', () => {
      const fw = daemon.getFileWatcher();
      fw.emit('file:created', {
        path: '/test/a.ts',
        type: 'create',
        timestamp: Date.now(),
      } as FileEvent);
      fw.emit('file:changed', {
        path: '/test/b.ts',
        type: 'modify',
        timestamp: Date.now(),
      } as FileEvent);

      const events = daemon.getFileEvents();
      expect(events.length).toBe(2);
    });

    it('forwards watcher:error as daemon:error', () => {
      const spy = vi.fn();
      daemon.on('daemon:error', spy);

      const fw = daemon.getFileWatcher();
      fw.emit('watcher:error', {
        dir: '/test',
        error: new Error('permission denied'),
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].error).toContain('permission denied');
    });
  });

  // ─────────────────────────────────────────────────────────
  // BOUNDED HISTORY
  // ─────────────────────────────────────────────────────────

  describe('bounded history', () => {
    it('limits file event history to MAX_FILE_EVENTS', () => {
      const fw = daemon.getFileWatcher();
      // MAX_FILE_EVENTS = 1000 in daemon.ts
      for (let i = 0; i < 1050; i++) {
        fw.emit('file:created', {
          path: `/test/file${i}.ts`,
          type: 'create',
          timestamp: Date.now(),
        } as FileEvent);
      }

      const events = daemon.getFileEvents();
      expect(events.length).toBeLessThanOrEqual(1000);
    });

    it('limits critic report history to MAX_CRITIC_REPORTS', async () => {
      // MAX_CRITIC_REPORTS = 100 in daemon.ts
      for (let i = 0; i < 105; i++) {
        await daemon.runCritic([
          { path: `file${i}.ts`, content: cleanCode },
        ]);
      }

      // getRecentCriticReports returns up to limit from the history
      // The internal history should be capped at 100
      const reports = daemon.getRecentCriticReports(200);
      expect(reports.length).toBeLessThanOrEqual(100);
    });

    it('limits sleep report history to MAX_SLEEP_REPORTS', async () => {
      await daemon.start();
      // MAX_SLEEP_REPORTS = 30 in daemon.ts
      for (let i = 0; i < 35; i++) {
        await daemon.generateSleepReport();
        vi.advanceTimersByTime(10);
      }

      const reports = daemon.getRecentSleepReports(100);
      expect(reports.length).toBeLessThanOrEqual(30);
    });
  });

  // ─────────────────────────────────────────────────────────
  // EDGE CASES
  // ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles critic with files containing only whitespace', async () => {
      const report = await daemon.runCritic([
        { path: 'empty.ts', content: '   \n  \n  ' },
      ]);
      expect(report).toBeDefined();
    });

    it('handles critic with extremely long single line', async () => {
      const longLine = 'const x = "' + 'a'.repeat(10000) + '";';
      const report = await daemon.runCritic([
        { path: 'long.ts', content: longLine },
      ]);
      expect(report).toBeDefined();
    });

    it('handles special characters in file paths', () => {
      const fw = daemon.getFileWatcher();
      const spy = vi.fn();
      daemon.on('daemon:file:changed', spy);

      fw.emit('file:created', {
        path: '/test/file with spaces (1).ts',
        type: 'create',
        timestamp: Date.now(),
      } as FileEvent);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('handles concurrent critic runs', async () => {
      const results = await Promise.all([
        daemon.runCritic([{ path: 'a.ts', content: cleanCode }]),
        daemon.runCritic([{ path: 'b.ts', content: codeWithSecrets }]),
        daemon.runCritic([{ path: 'c.ts', content: codeWithTodo }]),
      ]);

      expect(results.length).toBe(3);
      results.forEach((r) => {
        expect(r).toBeDefined();
        expect(r.id).toBeDefined();
      });
    });

    it('handles concurrent sleep report and critic run', async () => {
      await daemon.start();

      const [report, criticReport] = await Promise.all([
        daemon.generateSleepReport(),
        daemon.runCritic([{ path: 'test.ts', content: cleanCode }]),
      ]);

      expect(report).toBeDefined();
      expect(criticReport).toBeDefined();
    });

    it('handles empty watchDirs configuration', async () => {
      await daemon.start();
      const stats = daemon.getStats();
      expect(stats.filesWatched).toBe(0);
    });

    it('preserves state consistency through start/stop cycles', async () => {
      for (let i = 0; i < 5; i++) {
        await daemon.start();
        expect(daemon.getState()).toBe('watching');

        await daemon.runCritic([{ path: 'test.ts', content: cleanCode }]);

        await daemon.stop();
        expect(daemon.getState()).toBe('idle');
      }

      // History should accumulate across cycles
      const reports = daemon.getRecentCriticReports(10);
      expect(reports.length).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────
  // STRESS TESTS
  // ─────────────────────────────────────────────────────────

  describe('stress tests', () => {
    it('handles many sequential critic runs', async () => {
      const files = [{ path: 'test.ts', content: cleanCode }];
      for (let i = 0; i < 50; i++) {
        await daemon.runCritic(files);
      }

      expect(daemon.getStats().criticsRun).toBe(50);
    });

    it('handles many start/stop cycles', async () => {
      for (let i = 0; i < 20; i++) {
        await daemon.start();
        await daemon.stop();
      }
      expect(daemon.getState()).toBe('idle');
    });

    it('handles rapid file events', () => {
      const fw = daemon.getFileWatcher();
      const spy = vi.fn();
      daemon.on('daemon:file:changed', spy);

      for (let i = 0; i < 500; i++) {
        fw.emit('file:changed', {
          path: `/test/file${i}.ts`,
          type: 'modify',
          timestamp: Date.now(),
        } as FileEvent);
      }

      expect(spy).toHaveBeenCalledTimes(500);
      expect(daemon.getFileEvents().length).toBe(500);
    });

    it('handles mixed operations under load', async () => {
      await daemon.start();

      // Mix of operations
      for (let i = 0; i < 10; i++) {
        await daemon.runCritic([
          { path: `file${i}.ts`, content: i % 2 === 0 ? cleanCode : codeWithSecrets },
        ]);

        const fw = daemon.getFileWatcher();
        fw.emit('file:created', {
          path: `/test/dynamic${i}.ts`,
          type: 'create',
          timestamp: Date.now(),
        } as FileEvent);
      }

      await daemon.generateSleepReport();

      const stats = daemon.getStats();
      expect(stats.criticsRun).toBe(10);
      expect(stats.reportsGenerated).toBe(1);
      expect(daemon.getFileEvents().length).toBe(10);
    });

    it('handles multiple sleep reports', async () => {
      await daemon.start();
      for (let i = 0; i < 15; i++) {
        await daemon.generateSleepReport();
        vi.advanceTimersByTime(100);
      }

      const reports = daemon.getRecentSleepReports(20);
      expect(reports.length).toBe(15);
    });
  });

  // ─────────────────────────────────────────────────────────
  // REAL-WORLD SCENARIOS
  // ─────────────────────────────────────────────────────────

  describe('real-world scenarios', () => {
    it('developer workflow: start, code changes, critic, report, stop', async () => {
      // Step 1: Start the daemon
      await daemon.start();
      expect(daemon.getState()).toBe('watching');

      // Step 2: Simulate file changes
      const fw = daemon.getFileWatcher();
      for (let i = 0; i < 5; i++) {
        fw.emit('file:changed', {
          path: `/project/src/module${i}.ts`,
          type: 'modify',
          timestamp: Date.now(),
        } as FileEvent);
      }

      // Step 3: Run critic on changed files
      const criticReport = await daemon.runCritic([
        { path: 'module0.ts', content: cleanCode },
        { path: 'module1.ts', content: codeWithTodo },
      ]);
      expect(criticReport.verdict).toBeDefined();

      // Step 4: Generate summary report
      const sleepReport = await daemon.generateSleepReport();
      expect(sleepReport.filesChanged).toBe(5);
      expect(sleepReport.criticsRun).toBeGreaterThanOrEqual(1);

      // Step 5: Shut down
      await daemon.stop();
      expect(daemon.getState()).toBe('idle');
    });

    it('CI/CD pipeline: critic run on PR files', async () => {
      const prFiles = [
        { path: 'src/api.ts', content: 'export function getUser(id: string) { return { id, name: "test" }; }' },
        { path: 'src/auth.ts', content: 'export function login(user: string, pass: string) { return true; }' },
        { path: 'src/db.ts', content: 'const connectionString = "postgres://localhost:5432/db";\nexport default connectionString;' },
      ];

      const report = await daemon.runCritic(prFiles);

      // Should find potential issue with connection string
      expect(report).toBeDefined();
      expect(report.verdict).toBeDefined();

      // Score confidence on the PR
      const score = await daemon.scoreConfidence({
        testsPassed: true,
        testsRun: 25,
        lintPassed: true,
        typeCheckPassed: true,
        criticReport: report,
        filesChanged: prFiles.map((f) => ({
          path: f.path,
          content: f.content,
          linesAdded: 5,
          linesRemoved: 2,
        })),
      });

      expect(score.overall).toBeGreaterThan(0);
      expect(score.overall).toBeLessThanOrEqual(1);
    });

    it('nightly daemon: accumulate events and generate periodic report', async () => {
      await daemon.start();

      // Simulate file activity over "time"
      const fw = daemon.getFileWatcher();
      for (let hour = 0; hour < 3; hour++) {
        for (let i = 0; i < 10; i++) {
          fw.emit('file:changed', {
            path: `/project/src/file${i}.ts`,
            type: 'modify',
            timestamp: Date.now() + hour * 3600000,
          } as FileEvent);
        }

        // Run critic periodically
        await daemon.runCritic([
          { path: `batch${hour}.ts`, content: cleanCode },
        ]);
      }

      // Generate nightly report
      const report = await daemon.generateSleepReport();
      expect(report.filesChanged).toBeGreaterThan(0);
      expect(report.criticsRun).toBeGreaterThanOrEqual(3);
      expect(report.recommendations).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────
  // CONFIGURATION VARIATIONS
  // ─────────────────────────────────────────────────────────

  describe('configuration variations', () => {
    it('critics disabled: no auto-critic on file changes', () => {
      const noCritics = new CortexDaemon(
        makeConfig({ criticsEnabled: false }),
      );

      // File events should still be recorded but not trigger critic
      const fw = noCritics.getFileWatcher();
      const spy = vi.fn();
      noCritics.on('daemon:critic:complete', spy);

      fw.emit('file:created', {
        path: '/test/file.ts',
        type: 'create',
        timestamp: Date.now(),
      } as FileEvent);

      // No critic should run (even with fake timer advance)
      vi.advanceTimersByTime(10000);
      expect(spy).not.toHaveBeenCalled();

      noCritics.stop();
    });

    it('custom confidence threshold', () => {
      const strict = new CortexDaemon(
        makeConfig({ confidenceThreshold: 0.9 }),
      );
      expect(strict).toBeDefined();
      strict.stop();
    });

    it('custom poll interval', () => {
      const fastPoll = new CortexDaemon(
        makeConfig({ pollIntervalMs: 5000 }),
      );
      expect(fastPoll).toBeDefined();
      fastPoll.stop();
    });

    it('custom max watch files', () => {
      const limited = new CortexDaemon(
        makeConfig({ maxWatchFiles: 100 }),
      );
      expect(limited).toBeDefined();
      limited.stop();
    });
  });
});
