/**
 * Production Observability Platform
 *
 * Comprehensive observability for CortexOS: distributed tracing,
 * metrics collection, alerting, cost attribution, and telemetry export.
 *
 * Exports:
 * - Tracer: Basic execution tracing and span tracking
 * - MetricsCollector: Aggregated run statistics and analytics
 * - DistributedTracer: Production-grade distributed tracing with cost attribution
 * - AlertManager: Rule-based alerting with anomaly detection
 * - TraceExporter: Multi-format telemetry export (OTLP, CSV, Datadog, Langfuse)
 */

export { Tracer } from './tracer.js';
export { MetricsCollector } from './metrics.js';
export { DistributedTracer } from './distributed-tracer.js';
export { AlertManager } from './alert-manager.js';
export { TraceExporter } from './trace-exporter.js';

export type {
  SpanContext,
  DetailedSpan,
  SpanKind,
  SpanStatusDetail,
  SpanEvent,
  SpanLink,
  TraceTree,
  AlertRule,
  AlertCondition,
  Alert,
  CostAttribution,
  ExportFormat,
  ExportConfig,
  ObservabilityConfig,
  ObservabilityStats,
} from './types.js';
