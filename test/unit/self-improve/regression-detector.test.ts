import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RegressionDetector } from '../../../src/self-improve/regression-detector.js';

describe('RegressionDetector', () => {
  let detector: RegressionDetector;

  beforeEach(() => {
    detector = new RegressionDetector({ windowSize: 5, regressionThreshold: 0.15 });
  });

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts and stops', () => {
      expect(detector.isRunning()).toBe(false);
      detector.start();
      expect(detector.isRunning()).toBe(true);
      detector.stop();
      expect(detector.isRunning()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // recordMetric()
  // ─────────────────────────────────────────────────────────

  describe('recordMetric()', () => {
    it('stores a metric data point', () => {
      detector.recordMetric('quality', 0.9);

      const names = detector.getMetricNames();
      expect(names).toContain('quality');
    });

    it('emits self-improve:metric:recorded event', () => {
      const listener = vi.fn();
      detector.on('self-improve:metric:recorded', listener);

      detector.recordMetric('quality', 0.85);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ metric: 'quality', value: 0.85 }),
      );
    });

    it('enforces max data points', () => {
      const smallDetector = new RegressionDetector({
        windowSize: 3,
        maxDataPoints: 10,
      });

      for (let i = 0; i < 20; i++) {
        smallDetector.recordMetric('metric-a', i);
      }

      const history = smallDetector.getMetricHistory('metric-a');
      expect(history.length).toBeLessThanOrEqual(10);
    });

    it('uses provided timestamp or defaults to now', () => {
      const customTimestamp = 1700000000000;
      detector.recordMetric('quality', 0.9, customTimestamp);

      const history = detector.getMetricHistory('quality');
      expect(history[0].timestamp).toBe(customTimestamp);
    });
  });

  // ─────────────────────────────────────────────────────────
  // detectRegressions()
  // ─────────────────────────────────────────────────────────

  describe('detectRegressions()', () => {
    it('returns no alerts when not enough data', () => {
      // With windowSize=5, need at least 10 data points
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 0.9);
      }

      const alerts = detector.detectRegressions();
      expect(alerts).toHaveLength(0);
    });

    it('detects a regression when recent values drop significantly', () => {
      // Record 5 high values (previous window)
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 1.0);
      }
      // Record 5 low values (current window) — 50% drop > 15% threshold
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 0.5);
      }

      const alerts = detector.detectRegressions();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].metric).toBe('quality');
      expect(alerts[0].previousValue).toBe(1.0);
      expect(alerts[0].currentValue).toBe(0.5);
      expect(alerts[0].id).toMatch(/^reg_/);
    });

    it('does not alert when drop is below threshold', () => {
      // 10% drop is below the 15% threshold
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 1.0);
      }
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 0.92);
      }

      const alerts = detector.detectRegressions();
      expect(alerts).toHaveLength(0);
    });

    it('emits self-improve:regression:detected event', () => {
      const listener = vi.fn();
      detector.on('self-improve:regression:detected', listener);

      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 1.0);
      }
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 0.5);
      }

      detector.detectRegressions();

      expect(listener).toHaveBeenCalledOnce();
    });

    it('returns updated alerts for the same metric on subsequent calls', () => {
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 1.0);
      }
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 0.5);
      }

      const firstAlerts = detector.detectRegressions();
      expect(firstAlerts).toHaveLength(1);

      // Running detection again should return the updated (existing) alert
      // so callers always see current regressions, not just new ones.
      const secondAlerts = detector.detectRegressions();
      expect(secondAlerts).toHaveLength(1);
      expect(secondAlerts[0].metric).toBe('quality');
    });

    it('clears alert when metric recovers', () => {
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 1.0);
      }
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 0.5);
      }

      detector.detectRegressions();
      expect(detector.getAlerts()).toHaveLength(1);

      // Metric recovers — add high values and trigger re-detection
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 1.0);
      }

      const recoveryListener = vi.fn();
      detector.on('self-improve:regression:recovered', recoveryListener);
      detector.detectRegressions();

      expect(detector.getAlerts()).toHaveLength(0);
      expect(recoveryListener).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────
  // detectAll — multiple metrics
  // ─────────────────────────────────────────────────────────

  describe('multiple metrics detection', () => {
    it('detects regressions across multiple metrics', () => {
      // Quality regression
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 1.0);
      }
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 0.5);
      }

      // Speed regression
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('speed', 1.0);
      }
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('speed', 0.3);
      }

      const alerts = detector.detectRegressions();
      expect(alerts).toHaveLength(2);

      const metricNames = alerts.map((a) => a.metric);
      expect(metricNames).toContain('quality');
      expect(metricNames).toContain('speed');
    });
  });

  // ─────────────────────────────────────────────────────────
  // getAlerts()
  // ─────────────────────────────────────────────────────────

  describe('getAlerts()', () => {
    it('returns empty array when no regressions detected', () => {
      expect(detector.getAlerts()).toEqual([]);
    });

    it('returns active alerts after detection', () => {
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 1.0);
      }
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 0.4);
      }

      detector.detectRegressions();

      const alerts = detector.getAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].metric).toBe('quality');
      expect(alerts[0].threshold).toBe(0.15);
      expect(alerts[0].windowSize).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────
  // clearAlert()
  // ─────────────────────────────────────────────────────────

  describe('clearAlert()', () => {
    it('dismisses an alert by ID', () => {
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 1.0);
      }
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('quality', 0.4);
      }

      const [alert] = detector.detectRegressions();
      expect(detector.getAlerts()).toHaveLength(1);

      const cleared = detector.clearAlert(alert.id);
      expect(cleared).toBe(true);
      expect(detector.getAlerts()).toHaveLength(0);
    });

    it('returns false for unknown alert ID', () => {
      expect(detector.clearAlert('nonexistent')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────

  describe('configuration', () => {
    it('uses custom threshold and window size', () => {
      const custom = new RegressionDetector({
        windowSize: 3,
        regressionThreshold: 0.5, // 50% threshold
      });

      // 30% drop should NOT trigger with 50% threshold
      for (let i = 0; i < 3; i++) {
        custom.recordMetric('metric', 1.0);
      }
      for (let i = 0; i < 3; i++) {
        custom.recordMetric('metric', 0.7);
      }

      const alerts = custom.detectRegressions();
      expect(alerts).toHaveLength(0);
    });

    it('uses default configuration when none provided', () => {
      const defaultDetector = new RegressionDetector();
      const stats = defaultDetector.getStats();
      expect(stats.metricsTracked).toBe(0);
      expect(stats.activeAlerts).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────
  // getStats()
  // ─────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns correct statistics', () => {
      // Record some data
      for (let i = 0; i < 10; i++) {
        detector.recordMetric('quality', i < 5 ? 1.0 : 0.4);
      }
      for (let i = 0; i < 5; i++) {
        detector.recordMetric('speed', 0.9);
      }

      detector.detectRegressions();

      const stats = detector.getStats();
      expect(stats.metricsTracked).toBe(2);
      expect(stats.totalDataPoints).toBe(15);
      expect(stats.activeAlerts).toBe(1);
      expect(stats.totalDetected).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────
  // getMetricHistory()
  // ─────────────────────────────────────────────────────────

  describe('getMetricHistory()', () => {
    it('returns data points newest first', () => {
      detector.recordMetric('quality', 0.1, 1000);
      detector.recordMetric('quality', 0.2, 2000);
      detector.recordMetric('quality', 0.3, 3000);

      const history = detector.getMetricHistory('quality');
      expect(history).toHaveLength(3);
      expect(history[0].value).toBe(0.3);
      expect(history[2].value).toBe(0.1);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        detector.recordMetric('quality', i);
      }

      const history = detector.getMetricHistory('quality', 3);
      expect(history).toHaveLength(3);
    });

    it('returns empty array for unknown metric', () => {
      const history = detector.getMetricHistory('nonexistent');
      expect(history).toEqual([]);
    });
  });
});
