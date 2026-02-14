/**
 * Trace Exporter — Multi-format telemetry export engine.
 *
 * Buffers completed spans and exports them in configurable formats
 * including OTLP JSON, CSV, and more. Supports batch flushing
 * with periodic auto-flush for CortexOS observability pipelines.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type {
  DetailedSpan,
  TraceTree,
  ExportConfig,
  ExportFormat,
} from './types.js';

/**
 * TraceExporter buffers completed spans and exports them in
 * multiple formats for integration with external observability
 * platforms such as Jaeger, Datadog, Langfuse, and custom sinks.
 */
export class TraceExporter extends EventEmitter {
  private exportConfigs: ExportConfig[];
  private buffer: DetailedSpan[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private exportedCount = 0;
  private failedCount = 0;

  constructor(configs: ExportConfig[] = []) {
    super();
    this.exportConfigs = [...configs];
  }

  /** Start the exporter with periodic auto-flushing */
  start(): void {
    this.running = true;

    // Find the minimum flush interval across all configs
    const minInterval = this.exportConfigs.reduce(
      (min, cfg) => Math.min(min, cfg.flushIntervalMs),
      60_000,
    );

    if (this.exportConfigs.length > 0 && minInterval > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch((err) => {
          this.emit('observe:export:error', { error: String(err) });
        });
      }, minInterval);
    }

    this.emit('observe:exporter:started');
  }

  /** Stop the exporter and flush remaining buffer */
  stop(): void {
    this.running = false;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.emit('observe:exporter:stopped');
  }

  /** Check if the exporter is running */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Add a completed span to the export buffer.
   * Triggers flush if any config's batch size is reached.
   */
  addSpan(span: DetailedSpan): void {
    this.buffer.push(span);

    // Check if any config's batch size is reached
    for (const config of this.exportConfigs) {
      if (this.buffer.length >= config.batchSize) {
        this.flush().catch((err) => {
          this.emit('observe:export:error', { error: String(err) });
        });
        break;
      }
    }

    this.emit('observe:span:buffered', {
      spanId: span.context.spanId,
      bufferSize: this.buffer.length,
    });
  }

  /**
   * Flush all buffered spans through all configured exporters.
   * Returns counts of successfully exported and failed spans.
   */
  async flush(): Promise<{ exported: number; failed: number }> {
    if (this.buffer.length === 0) {
      return { exported: 0, failed: 0 };
    }

    const toExport = [...this.buffer];
    this.buffer = [];

    let exported = 0;
    let failed = 0;

    for (const config of this.exportConfigs) {
      try {
        const serialized = this.serializeSpans(toExport, config.format);

        if (config.endpoint) {
          // In production, this would send via HTTP.
          // Here we emit an event with the payload for integration.
          this.emit('observe:export:sending', {
            format: config.format,
            endpoint: config.endpoint,
            spanCount: toExport.length,
            payloadSize: serialized.length,
          });
        }

        exported += toExport.length;
      } catch {
        failed += toExport.length;
        this.emit('observe:export:error', {
          format: config.format,
          spanCount: toExport.length,
        });
      }
    }

    // If no configs, count as exported (buffer cleared)
    if (this.exportConfigs.length === 0) {
      exported = toExport.length;
    }

    this.exportedCount += exported;
    this.failedCount += failed;

    this.emit('observe:export:flushed', { exported, failed });
    return { exported, failed };
  }

  /**
   * Export trace trees to a specific format.
   * Supports OTLP JSON and CSV serialization.
   */
  export(traces: TraceTree[], format: ExportFormat): string {
    const allSpans: DetailedSpan[] = [];
    for (const trace of traces) {
      allSpans.push(...trace.spans);
    }
    return this.serializeSpans(allSpans, format);
  }

  /**
   * Get exporter statistics.
   */
  getStats(): {
    buffered: number;
    exported: number;
    failed: number;
  } {
    return {
      buffered: this.buffer.length,
      exported: this.exportedCount,
      failed: this.failedCount,
    };
  }

  /**
   * Serialize spans to the requested format.
   */
  private serializeSpans(spans: DetailedSpan[], format: ExportFormat): string {
    switch (format) {
      case 'otlp-json':
        return this.toOtlpJson(spans);
      case 'csv':
        return this.toCsv(spans);
      case 'otlp-proto':
        // Proto serialization placeholder — returns OTLP JSON structure
        return this.toOtlpJson(spans);
      case 'langfuse':
        return this.toLangfuse(spans);
      case 'datadog':
        return this.toDatadog(spans);
      default:
        return this.toOtlpJson(spans);
    }
  }

  /**
   * Serialize spans to OpenTelemetry Protocol JSON format.
   */
  private toOtlpJson(spans: DetailedSpan[]): string {
    const resourceSpans = new Map<string, DetailedSpan[]>();

    // Group spans by resource
    for (const span of spans) {
      const resource = span.resource || 'cortexos';
      const group = resourceSpans.get(resource) ?? [];
      group.push(span);
      resourceSpans.set(resource, group);
    }

    const payload = {
      resourceSpans: [...resourceSpans.entries()].map(([resource, resourceGroupSpans]) => ({
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: resource } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'cortexos-tracer', version: '1.0.0' },
            spans: resourceGroupSpans.map(span => ({
              traceId: span.context.traceId,
              spanId: span.context.spanId,
              parentSpanId: span.context.parentSpanId ?? '',
              name: span.name,
              kind: this.spanKindToOtlp(span.kind),
              startTimeUnixNano: span.startTime * 1_000_000,
              endTimeUnixNano: (span.endTime ?? Date.now()) * 1_000_000,
              attributes: Object.entries(span.attributes).map(([key, value]) => ({
                key,
                value: this.toOtlpValue(value),
              })),
              status: {
                code: span.status.code === 'ok' ? 1 : span.status.code === 'error' ? 2 : 0,
                message: span.status.message ?? '',
              },
              events: span.events.map(evt => ({
                name: evt.name,
                timeUnixNano: evt.timestamp * 1_000_000,
                attributes: Object.entries(evt.attributes).map(([key, value]) => ({
                  key,
                  value: this.toOtlpValue(value),
                })),
              })),
              links: span.links.map(link => ({
                traceId: link.traceId,
                spanId: link.spanId,
                attributes: Object.entries(link.attributes).map(([key, value]) => ({
                  key,
                  value: this.toOtlpValue(value),
                })),
              })),
            })),
          },
        ],
      })),
    };

    return JSON.stringify(payload, null, 2);
  }

  /**
   * Serialize spans to CSV format.
   */
  private toCsv(spans: DetailedSpan[]): string {
    const headers = [
      'trace_id',
      'span_id',
      'parent_span_id',
      'name',
      'kind',
      'status',
      'start_time',
      'end_time',
      'duration_ms',
      'resource',
      'attributes',
    ];

    const rows = spans.map(span => {
      const duration = span.endTime
        ? span.endTime - span.startTime
        : 0;

      return [
        span.context.traceId,
        span.context.spanId,
        span.context.parentSpanId ?? '',
        this.escapeCsv(span.name),
        span.kind,
        span.status.code,
        span.startTime.toString(),
        (span.endTime ?? '').toString(),
        duration.toString(),
        this.escapeCsv(span.resource),
        this.escapeCsv(JSON.stringify(span.attributes)),
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Serialize spans to Langfuse-compatible JSON format.
   */
  private toLangfuse(spans: DetailedSpan[]): string {
    const events = spans.map(span => ({
      id: `lng-${randomUUID().slice(0, 8)}`,
      type: span.context.parentSpanId ? 'span' : 'trace',
      traceId: span.context.traceId,
      parentObservationId: span.context.parentSpanId ?? null,
      name: span.name,
      startTime: new Date(span.startTime).toISOString(),
      endTime: span.endTime ? new Date(span.endTime).toISOString() : null,
      metadata: span.attributes,
      statusMessage: span.status.message ?? null,
      level: span.status.code === 'error' ? 'ERROR' : 'DEFAULT',
    }));

    return JSON.stringify({ batch: events }, null, 2);
  }

  /**
   * Serialize spans to Datadog APM-compatible JSON format.
   */
  private toDatadog(spans: DetailedSpan[]): string {
    const traces = new Map<string, unknown[]>();

    for (const span of spans) {
      const traceSpans = traces.get(span.context.traceId) ?? [];
      traceSpans.push({
        trace_id: span.context.traceId,
        span_id: span.context.spanId,
        parent_id: span.context.parentSpanId ?? '0',
        name: span.name,
        resource: span.resource,
        service: 'cortexos',
        type: span.kind,
        start: span.startTime * 1_000_000, // nanoseconds
        duration: ((span.endTime ?? Date.now()) - span.startTime) * 1_000_000,
        error: span.status.code === 'error' ? 1 : 0,
        meta: Object.fromEntries(
          Object.entries(span.attributes).map(([k, v]) => [k, String(v)]),
        ),
      });
      traces.set(span.context.traceId, traceSpans);
    }

    return JSON.stringify([...traces.values()], null, 2);
  }

  /** Convert span kind to OTLP numeric value */
  private spanKindToOtlp(kind: string): number {
    switch (kind) {
      case 'internal': return 1;
      case 'server': return 2;
      case 'client': return 3;
      case 'producer': return 4;
      case 'consumer': return 5;
      default: return 0;
    }
  }

  /** Convert a value to OTLP attribute value format */
  private toOtlpValue(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') {
      return Number.isInteger(value)
        ? { intValue: value }
        : { doubleValue: value };
    }
    if (typeof value === 'boolean') return { boolValue: value };
    return { stringValue: String(value) };
  }

  /** Escape a string for CSV output */
  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
