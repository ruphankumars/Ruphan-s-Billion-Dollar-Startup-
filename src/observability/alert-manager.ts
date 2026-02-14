/**
 * Alert Manager — Rule-based alerting engine for observability.
 *
 * Manages alert rules, evaluates metrics against thresholds,
 * detects anomalies via z-score analysis, and triggers alerts
 * with cooldown management for CortexOS production monitoring.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type {
  AlertRule,
  AlertCondition,
  Alert,
  ObservabilityConfig,
} from './types.js';

/** Default configuration for the alert manager */
const DEFAULT_CONFIG: Pick<ObservabilityConfig, 'maxAlerts' | 'alertsEnabled'> = {
  maxAlerts: 10_000,
  alertsEnabled: true,
};

/**
 * AlertManager provides a rule-based alerting system for monitoring
 * AI agent metrics. Supports threshold-based conditions and statistical
 * anomaly detection using z-score analysis.
 */
export class AlertManager extends EventEmitter {
  private rules: Map<string, AlertRule> = new Map();
  private alerts: Alert[] = [];
  private metricValues: Map<string, { value: number; timestamp: number }[]> = new Map();
  private config: Pick<ObservabilityConfig, 'maxAlerts' | 'alertsEnabled'>;
  private running = false;

  constructor(config?: Partial<ObservabilityConfig>) {
    super();
    this.config = {
      maxAlerts: config?.maxAlerts ?? DEFAULT_CONFIG.maxAlerts,
      alertsEnabled: config?.alertsEnabled ?? DEFAULT_CONFIG.alertsEnabled,
    };
  }

  /** Start the alert manager */
  start(): void {
    this.running = true;
    this.emit('observe:alertmanager:started');
  }

  /** Stop the alert manager */
  stop(): void {
    this.running = false;
    this.emit('observe:alertmanager:stopped');
  }

  /** Check if the alert manager is running */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Add a new alert rule. Returns the rule with a generated ID.
   */
  addRule(rule: Omit<AlertRule, 'id'>): AlertRule {
    const id = `rule-${randomUUID().slice(0, 8)}`;
    const fullRule: AlertRule = { id, ...rule };
    this.rules.set(id, fullRule);
    this.emit('observe:alert:rule-added', { ruleId: id, name: rule.name });
    return fullRule;
  }

  /**
   * Remove an alert rule by ID.
   */
  removeRule(id: string): boolean {
    const deleted = this.rules.delete(id);
    if (deleted) {
      this.emit('observe:alert:rule-removed', { ruleId: id });
    }
    return deleted;
  }

  /**
   * Update an existing alert rule with partial changes.
   */
  updateRule(id: string, updates: Partial<Omit<AlertRule, 'id'>>): AlertRule {
    const existing = this.rules.get(id);
    if (!existing) {
      throw new Error(`Alert rule not found: ${id}`);
    }

    const updated: AlertRule = { ...existing, ...updates };
    this.rules.set(id, updated);
    this.emit('observe:alert:rule-updated', { ruleId: id });
    return updated;
  }

  /**
   * Record a metric value. Automatically checks all matching rules
   * and fires alerts when conditions are met.
   */
  recordMetric(metric: string, value: number): void {
    const timestamp = Date.now();
    const values = this.metricValues.get(metric) ?? [];
    values.push({ value, timestamp });

    // Trim values older than the maximum window across all rules for this metric
    const maxWindow = this.getMaxWindowForMetric(metric);
    const cutoff = timestamp - maxWindow;
    const trimmed = values.filter(v => v.timestamp >= cutoff);
    this.metricValues.set(metric, trimmed);

    // Check rules that match this metric
    if (this.config.alertsEnabled) {
      for (const rule of this.rules.values()) {
        if (rule.metric !== metric || !rule.enabled) continue;

        // Filter values within this rule's window
        const windowCutoff = timestamp - rule.windowMs;
        const windowValues = trimmed.filter(v => v.timestamp >= windowCutoff);

        if (windowValues.length === 0) continue;

        if (this.evaluateRule(rule, windowValues)) {
          this.fireAlert(rule, value);
        }
      }
    }

    this.emit('observe:metric:recorded', { metric, value, timestamp });
  }

  /**
   * Manually evaluate all rules against current metric data.
   * Returns any newly triggered alerts.
   */
  checkRules(): Alert[] {
    const newAlerts: Alert[] = [];
    const now = Date.now();

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      const values = this.metricValues.get(rule.metric) ?? [];
      const windowCutoff = now - rule.windowMs;
      const windowValues = values.filter(v => v.timestamp >= windowCutoff);

      if (windowValues.length === 0) continue;

      if (this.evaluateRule(rule, windowValues)) {
        const latestValue = windowValues[windowValues.length - 1].value;
        const alert = this.fireAlert(rule, latestValue);
        if (alert) {
          newAlerts.push(alert);
        }
      }
    }

    return newAlerts;
  }

  /**
   * Get alerts with optional filtering by severity, acknowledgement, or time.
   */
  getAlerts(filter?: {
    severity?: string;
    acknowledged?: boolean;
    since?: number;
  }): Alert[] {
    let results = [...this.alerts];

    if (filter?.severity !== undefined) {
      results = results.filter(a => a.severity === filter.severity);
    }

    if (filter?.acknowledged !== undefined) {
      results = results.filter(a => a.acknowledged === filter.acknowledged);
    }

    if (filter?.since !== undefined) {
      results = results.filter(a => a.timestamp >= filter.since!);
    }

    return results;
  }

  /**
   * Acknowledge an alert by its ID.
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    this.emit('observe:alert:acknowledged', { alertId, ruleId: alert.ruleId });
    return true;
  }

  /** Get a specific rule by ID */
  getRule(id: string): AlertRule | undefined {
    return this.rules.get(id);
  }

  /** List all configured rules */
  listRules(): AlertRule[] {
    return [...this.rules.values()];
  }

  /**
   * Get alert manager statistics.
   */
  getStats(): {
    totalRules: number;
    totalAlerts: number;
    unresolved: number;
    bySeverity: Record<string, number>;
  } {
    const bySeverity: Record<string, number> = {};
    let unresolved = 0;

    for (const alert of this.alerts) {
      bySeverity[alert.severity] = (bySeverity[alert.severity] ?? 0) + 1;
      if (!alert.acknowledged) {
        unresolved++;
      }
    }

    return {
      totalRules: this.rules.size,
      totalAlerts: this.alerts.length,
      unresolved,
      bySeverity,
    };
  }

  /**
   * Evaluate a rule against a window of metric values.
   * Supports threshold comparisons and anomaly detection.
   */
  private evaluateRule(
    rule: AlertRule,
    values: { value: number; timestamp: number }[],
  ): boolean {
    if (values.length === 0) return false;

    if (rule.condition === 'anomaly') {
      return this.detectAnomaly(values.map(v => v.value));
    }

    // Use the latest value in the window for threshold comparison
    const latestValue = values[values.length - 1].value;

    return this.evaluateCondition(rule.condition, latestValue, rule.threshold);
  }

  /** Compare a value against a threshold using the given condition operator */
  private evaluateCondition(
    condition: AlertCondition,
    value: number,
    threshold: number,
  ): boolean {
    switch (condition) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'gte':
        return value >= threshold;
      case 'lte':
        return value <= threshold;
      case 'eq':
        return value === threshold;
      case 'anomaly':
        return false; // Handled separately
      default:
        return false;
    }
  }

  /**
   * Z-score based anomaly detection.
   * A value is considered anomalous if it deviates more than 2 standard
   * deviations from the mean of the series.
   */
  private detectAnomaly(values: number[]): boolean {
    if (values.length < 3) return false;

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return false;

    // Check the most recent value
    const latest = values[values.length - 1];
    const zScore = Math.abs((latest - mean) / stdDev);

    return zScore > 2;
  }

  /**
   * Fire an alert for a rule violation, respecting cooldown periods.
   * Returns the alert if fired, or undefined if cooldown is active.
   */
  private fireAlert(rule: AlertRule, value: number): Alert | undefined {
    const now = Date.now();

    // Check cooldown
    if (rule.lastTriggered && (now - rule.lastTriggered) < rule.cooldownMs) {
      return undefined;
    }

    // Update last triggered
    rule.lastTriggered = now;

    const alert: Alert = {
      id: `alert-${randomUUID().slice(0, 8)}`,
      ruleId: rule.id,
      metric: rule.metric,
      value,
      threshold: rule.threshold,
      severity: rule.severity,
      message: `Alert "${rule.name}": metric ${rule.metric} value ${value} ${rule.condition} threshold ${rule.threshold}`,
      timestamp: now,
      acknowledged: false,
    };

    this.alerts.push(alert);

    // Trim alerts if over capacity
    if (this.alerts.length > this.config.maxAlerts) {
      this.alerts = this.alerts.slice(-this.config.maxAlerts);
    }

    this.emit('observe:alert:fired', {
      alertId: alert.id,
      ruleId: rule.id,
      severity: rule.severity,
      metric: rule.metric,
      value,
    });

    return alert;
  }

  /**
   * Get the maximum window duration across all rules for a given metric.
   * Used to determine how long to retain metric history.
   */
  private getMaxWindowForMetric(metric: string): number {
    let maxWindow = 60_000; // 1 minute minimum
    for (const rule of this.rules.values()) {
      if (rule.metric === metric && rule.windowMs > maxWindow) {
        maxWindow = rule.windowMs;
      }
    }
    return maxWindow;
  }
}
