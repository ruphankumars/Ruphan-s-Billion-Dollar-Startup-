/**
 * RegressionDetector — Metric Regression Detection
 *
 * Monitors metrics over time using a sliding window approach.
 * Detects when a metric's recent average drops below its historical
 * average by more than a configurable threshold (default 15%).
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { RegressionAlert } from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface MetricDataPoint {
  value: number;
  timestamp: number;
}

interface DetectorConfig {
  /** Percentage degradation threshold (e.g. 0.15 = 15%) */
  regressionThreshold: number;
  /** Number of recent data points for the "current" window */
  windowSize: number;
  /** Maximum data points to retain per metric */
  maxDataPoints: number;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: DetectorConfig = {
  regressionThreshold: 0.15,
  windowSize: 20,
  maxDataPoints: 500,
};

// ═══════════════════════════════════════════════════════════════
// REGRESSION DETECTOR
// ═══════════════════════════════════════════════════════════════

export class RegressionDetector extends EventEmitter {
  private config: DetectorConfig;
  private metrics: Map<string, MetricDataPoint[]> = new Map();
  private alerts: Map<string, RegressionAlert> = new Map();
  private totalDetected = 0;
  private running = false;

  constructor(config?: Partial<DetectorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('self-improve:regression:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('self-improve:regression:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Record a metric data point.
   */
  recordMetric(name: string, value: number, timestamp?: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const dataPoints = this.metrics.get(name)!;
    dataPoints.push({
      value,
      timestamp: timestamp ?? Date.now(),
    });

    // Enforce max data points
    if (dataPoints.length > this.config.maxDataPoints) {
      dataPoints.splice(0, dataPoints.length - this.config.maxDataPoints);
    }

    this.emit('self-improve:metric:recorded', {
      timestamp: Date.now(),
      metric: name,
      value,
    });
  }

  /**
   * Scan all metrics for regressions using sliding window comparison.
   *
   * Compares the average of the most recent `windowSize` data points
   * against the average of the preceding `windowSize` data points.
   * If the current average is lower by more than `regressionThreshold`
   * percentage, a regression alert is created.
   *
   * Returns newly detected regression alerts.
   */
  detectRegressions(): RegressionAlert[] {
    const newAlerts: RegressionAlert[] = [];

    for (const [name, dataPoints] of this.metrics) {
      // Need at least 2x window size to compare
      if (dataPoints.length < this.config.windowSize * 2) {
        continue;
      }

      const total = dataPoints.length;
      const currentWindow = dataPoints.slice(total - this.config.windowSize);
      const previousWindow = dataPoints.slice(
        total - this.config.windowSize * 2,
        total - this.config.windowSize,
      );

      const currentAvg = this.average(currentWindow.map((dp) => dp.value));
      const previousAvg = this.average(previousWindow.map((dp) => dp.value));

      // Skip if previous average is 0 (avoid division by zero)
      if (previousAvg === 0) continue;

      // Calculate degradation: how much worse is the current value
      const degradation = (previousAvg - currentAvg) / previousAvg;

      if (degradation > this.config.regressionThreshold) {
        // Check if we already have an active alert for this metric
        const existingAlert = this.alerts.get(name);
        if (existingAlert) {
          // Update the existing alert with new values
          existingAlert.currentValue = currentAvg;
          existingAlert.previousValue = previousAvg;
          existingAlert.detectedAt = Date.now();
          continue;
        }

        const alert: RegressionAlert = {
          id: `reg_${randomUUID().slice(0, 8)}`,
          metric: name,
          previousValue: previousAvg,
          currentValue: currentAvg,
          threshold: this.config.regressionThreshold,
          detectedAt: Date.now(),
          windowSize: this.config.windowSize,
        };

        this.alerts.set(name, alert);
        this.totalDetected++;
        newAlerts.push(alert);

        this.emit('self-improve:regression:detected', {
          timestamp: Date.now(),
          alert,
        });
      } else {
        // If metric recovered, remove existing alert
        if (this.alerts.has(name)) {
          this.alerts.delete(name);
          this.emit('self-improve:regression:recovered', {
            timestamp: Date.now(),
            metric: name,
          });
        }
      }
    }

    return newAlerts;
  }

  /**
   * Get all active regression alerts.
   */
  getAlerts(): RegressionAlert[] {
    return [...this.alerts.values()];
  }

  /**
   * Dismiss an active regression alert by ID.
   */
  clearAlert(id: string): boolean {
    for (const [name, alert] of this.alerts) {
      if (alert.id === id) {
        this.alerts.delete(name);
        this.emit('self-improve:regression:cleared', {
          timestamp: Date.now(),
          alertId: id,
          metric: name,
        });
        return true;
      }
    }
    return false;
  }

  /**
   * Get metric history for a specific metric, newest first.
   */
  getMetricHistory(name: string, limit?: number): MetricDataPoint[] {
    const dataPoints = this.metrics.get(name);
    if (!dataPoints) return [];

    const reversed = [...dataPoints].reverse();
    return limit !== undefined ? reversed.slice(0, limit) : reversed;
  }

  /**
   * Get all tracked metric names.
   */
  getMetricNames(): string[] {
    return [...this.metrics.keys()];
  }

  /**
   * Get statistics.
   */
  getStats(): {
    metricsTracked: number;
    activeAlerts: number;
    totalDetected: number;
    totalDataPoints: number;
  } {
    let totalDataPoints = 0;
    for (const dataPoints of this.metrics.values()) {
      totalDataPoints += dataPoints.length;
    }

    return {
      metricsTracked: this.metrics.size,
      activeAlerts: this.alerts.size,
      totalDetected: this.totalDetected,
      totalDataPoints,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL
  // ─────────────────────────────────────────────────────────

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }
}
