/**
 * Agent Tracer — Execution tracing and span tracking.
 * Records a timeline of events across the pipeline for debugging,
 * performance analysis, and visualization.
 */

import { nanoid } from 'nanoid';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

export type SpanStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface Span {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  children: Span[];
}

export type SpanKind =
  | 'pipeline'     // Full pipeline execution
  | 'stage'        // Pipeline stage (RECALL, ANALYZE, etc.)
  | 'wave'         // Execution wave
  | 'agent'        // Individual agent execution
  | 'tool'         // Tool call
  | 'llm'          // LLM call
  | 'memory'       // Memory operation
  | 'quality'      // Quality gate
  | 'custom';      // User-defined

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface TraceExport {
  traceId: string;
  rootSpan: Span;
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  spanCount: number;
  errorCount: number;
}

/**
 * Tracer manages execution traces with nested spans.
 */
export class Tracer {
  private traces = new Map<string, Span>();
  private spans = new Map<string, Span>();
  private activeTraceId: string | null = null;

  /**
   * Start a new trace (top-level execution)
   */
  startTrace(name: string, attributes: Record<string, string | number | boolean> = {}): Span {
    const traceId = nanoid(12);
    const span = this.createSpan(traceId, name, 'pipeline', undefined, attributes);
    this.traces.set(traceId, span);
    this.activeTraceId = traceId;

    logger.debug({ traceId, name }, 'Trace started');
    return span;
  }

  /**
   * Start a child span within the current trace
   */
  startSpan(
    name: string,
    kind: SpanKind,
    parentId?: string,
    attributes: Record<string, string | number | boolean> = {},
  ): Span {
    const traceId = this.activeTraceId || nanoid(12);
    const span = this.createSpan(traceId, name, kind, parentId, attributes);

    // Attach to parent
    if (parentId) {
      const parent = this.spans.get(parentId);
      if (parent) {
        parent.children.push(span);
      }
    }

    return span;
  }

  /**
   * End a span with optional status
   */
  endSpan(spanId: string, status: SpanStatus = 'success', attributes?: Record<string, string | number | boolean>): void {
    const span = this.spans.get(spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;

    if (attributes) {
      Object.assign(span.attributes, attributes);
    }

    // If this is the root span, end the trace
    if (this.traces.has(span.traceId) && this.traces.get(span.traceId)?.id === spanId) {
      logger.debug({ traceId: span.traceId, duration: span.duration }, 'Trace completed');
    }
  }

  /**
   * Add an event to a span
   */
  addEvent(spanId: string, name: string, attributes?: Record<string, string | number | boolean>): void {
    const span = this.spans.get(spanId);
    if (!span) return;

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * Set attributes on a span
   */
  setAttributes(spanId: string, attributes: Record<string, string | number | boolean>): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    Object.assign(span.attributes, attributes);
  }

  /**
   * Get a specific span
   */
  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }

  /**
   * Get the active trace
   */
  getActiveTrace(): Span | undefined {
    if (!this.activeTraceId) return undefined;
    return this.traces.get(this.activeTraceId);
  }

  /**
   * Export a trace for visualization/storage
   */
  exportTrace(traceId?: string): TraceExport | undefined {
    const id = traceId || this.activeTraceId;
    if (!id) return undefined;

    const rootSpan = this.traces.get(id);
    if (!rootSpan) return undefined;

    let errorCount = 0;
    let spanCount = 0;

    const countSpans = (span: Span) => {
      spanCount++;
      if (span.status === 'error') errorCount++;
      for (const child of span.children) {
        countSpans(child);
      }
    };
    countSpans(rootSpan);

    return {
      traceId: id,
      rootSpan,
      startTime: rootSpan.startTime,
      endTime: rootSpan.endTime,
      totalDuration: rootSpan.duration,
      spanCount,
      errorCount,
    };
  }

  /**
   * Build a flat timeline from a trace
   */
  getTimeline(traceId?: string): Array<{
    spanId: string;
    name: string;
    kind: SpanKind;
    status: SpanStatus;
    depth: number;
    start: number;
    end: number;
    duration: number;
  }> {
    const id = traceId || this.activeTraceId;
    if (!id) return [];

    const rootSpan = this.traces.get(id);
    if (!rootSpan) return [];

    const timeline: Array<{
      spanId: string;
      name: string;
      kind: SpanKind;
      status: SpanStatus;
      depth: number;
      start: number;
      end: number;
      duration: number;
    }> = [];

    const baseTime = rootSpan.startTime;

    const walk = (span: Span, depth: number) => {
      timeline.push({
        spanId: span.id,
        name: span.name,
        kind: span.kind,
        status: span.status,
        depth,
        start: span.startTime - baseTime,
        end: (span.endTime || Date.now()) - baseTime,
        duration: span.duration || (Date.now() - span.startTime),
      });
      for (const child of span.children) {
        walk(child, depth + 1);
      }
    };

    walk(rootSpan, 0);
    return timeline;
  }

  /**
   * Get all completed traces
   */
  getAllTraces(): TraceExport[] {
    const exports: TraceExport[] = [];
    for (const traceId of this.traces.keys()) {
      const exp = this.exportTrace(traceId);
      if (exp) exports.push(exp);
    }
    return exports;
  }

  /**
   * Clear all traces
   */
  clear(): void {
    this.traces.clear();
    this.spans.clear();
    this.activeTraceId = null;
  }

  private createSpan(
    traceId: string,
    name: string,
    kind: SpanKind,
    parentId?: string,
    attributes: Record<string, string | number | boolean> = {},
  ): Span {
    const span: Span = {
      id: nanoid(8),
      traceId,
      parentId,
      name,
      kind,
      status: 'running',
      startTime: Date.now(),
      attributes,
      events: [],
      children: [],
    };

    this.spans.set(span.id, span);
    return span;
  }
}
