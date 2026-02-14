/**
 * Production Observability Platform — Type Definitions
 *
 * Comprehensive type system for distributed tracing, alerting,
 * cost attribution, and telemetry export in CortexOS.
 */

// ── Span Types ──────────────────────────────────────────────────────

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: number;
}

export interface SpanStatusDetail {
  code: 'ok' | 'error' | 'unset';
  message?: string;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, unknown>;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes: Record<string, unknown>;
}

export interface DetailedSpan {
  context: SpanContext;
  name: string;
  kind: SpanKind;
  status: SpanStatusDetail;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  links: SpanLink[];
  resource: string;
  children: string[];
}

// ── Trace Types ─────────────────────────────────────────────────────

export interface TraceTree {
  rootSpan: DetailedSpan;
  spans: DetailedSpan[];
  totalDuration: number;
  totalCost: number;
  totalTokens: number;
}

// ── Alert Types ─────────────────────────────────────────────────────

export type AlertCondition = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'anomaly';

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  condition: AlertCondition;
  threshold: number;
  windowMs: number;
  severity: 'critical' | 'warning' | 'info';
  enabled: boolean;
  cooldownMs: number;
  lastTriggered?: number;
}

export interface Alert {
  id: string;
  ruleId: string;
  metric: string;
  value: number;
  threshold: number;
  severity: string;
  message: string;
  timestamp: number;
  acknowledged: boolean;
}

// ── Cost Attribution ────────────────────────────────────────────────

export interface CostAttribution {
  spanId: string;
  traceId: string;
  agentId?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
}

// ── Export Types ─────────────────────────────────────────────────────

export type ExportFormat = 'otlp-json' | 'otlp-proto' | 'langfuse' | 'datadog' | 'csv';

export interface ExportConfig {
  format: ExportFormat;
  endpoint?: string;
  headers?: Record<string, string>;
  batchSize: number;
  flushIntervalMs: number;
}

// ── Configuration ───────────────────────────────────────────────────

export interface ObservabilityConfig {
  enabled: boolean;
  maxSpans: number;
  maxAlerts: number;
  traceRetentionMs: number;
  costTrackingEnabled: boolean;
  alertsEnabled: boolean;
  exportConfigs: ExportConfig[];
}

// ── Stats ───────────────────────────────────────────────────────────

export interface ObservabilityStats {
  totalTraces: number;
  totalSpans: number;
  activeSpans: number;
  totalAlerts: number;
  unresolvedAlerts: number;
  totalCostTracked: number;
  avgSpanDuration: number;
  exportedCount: number;
}
