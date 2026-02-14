/**
 * Distributed Tracer — Production-grade distributed tracing engine.
 *
 * Manages trace lifecycle, span hierarchies, cost attribution,
 * and trace tree reconstruction for CortexOS observability.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type {
  SpanContext,
  DetailedSpan,
  SpanKind,
  SpanStatusDetail,
  SpanEvent,
  CostAttribution,
  TraceTree,
  ObservabilityConfig,
} from './types.js';

/** Default configuration for the distributed tracer */
const DEFAULT_CONFIG: ObservabilityConfig = {
  enabled: true,
  maxSpans: 100_000,
  maxAlerts: 10_000,
  traceRetentionMs: 24 * 60 * 60 * 1000, // 24 hours
  costTrackingEnabled: true,
  alertsEnabled: true,
  exportConfigs: [],
};

/**
 * DistributedTracer provides OpenTelemetry-inspired distributed tracing
 * with cost attribution, hierarchical span management, and trace tree
 * reconstruction for AI agent orchestration pipelines.
 */
export class DistributedTracer extends EventEmitter {
  private traces: Map<string, DetailedSpan[]> = new Map();
  private activeSpans: Map<string, DetailedSpan> = new Map();
  private costAttributions: Map<string, CostAttribution[]> = new Map();
  private config: ObservabilityConfig;
  private running = false;

  constructor(config?: Partial<ObservabilityConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start the tracer */
  start(): void {
    this.running = true;
    this.emit('observe:tracer:started');
  }

  /** Stop the tracer */
  stop(): void {
    this.running = false;
    this.emit('observe:tracer:stopped');
  }

  /** Check if the tracer is running */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Start a new trace with a root span.
   * Creates both a new trace ID and a root span context.
   */
  startTrace(
    name: string,
    attributes?: Record<string, unknown>,
  ): SpanContext {
    const traceId = `trc-${randomUUID().slice(0, 8)}`;
    const spanId = `spn-${randomUUID().slice(0, 8)}`;

    const context: SpanContext = {
      traceId,
      spanId,
      traceFlags: 1,
    };

    const span: DetailedSpan = {
      context,
      name,
      kind: 'internal',
      status: { code: 'unset' },
      startTime: Date.now(),
      attributes: attributes ?? {},
      events: [],
      links: [],
      resource: 'cortexos',
      children: [],
    };

    this.traces.set(traceId, [span]);
    this.activeSpans.set(spanId, span);
    this.enforceRetention();

    this.emit('observe:trace:started', { traceId, name });
    return context;
  }

  /**
   * Start a child span within an existing trace.
   * If parentContext is provided, the span is linked to the parent.
   */
  startSpan(
    name: string,
    parentContext?: SpanContext,
    kind: SpanKind = 'internal',
    attributes?: Record<string, unknown>,
  ): SpanContext {
    const traceId = parentContext?.traceId ?? `trc-${randomUUID().slice(0, 8)}`;
    const spanId = `spn-${randomUUID().slice(0, 8)}`;

    const context: SpanContext = {
      traceId,
      spanId,
      parentSpanId: parentContext?.spanId,
      traceFlags: parentContext?.traceFlags ?? 1,
    };

    const span: DetailedSpan = {
      context,
      name,
      kind,
      status: { code: 'unset' },
      startTime: Date.now(),
      attributes: attributes ?? {},
      events: [],
      links: [],
      resource: 'cortexos',
      children: [],
    };

    // Register span in its trace
    const traceSpans = this.traces.get(traceId);
    if (traceSpans) {
      traceSpans.push(span);
    } else {
      this.traces.set(traceId, [span]);
    }

    this.activeSpans.set(spanId, span);

    // Link parent to child
    if (parentContext?.spanId) {
      const parentSpan = this.activeSpans.get(parentContext.spanId)
        ?? this.findSpanInTrace(traceId, parentContext.spanId);
      if (parentSpan) {
        parentSpan.children.push(spanId);
      }
    }

    this.emit('observe:span:started', { traceId, spanId, name, kind });
    return context;
  }

  /**
   * End a span, setting its end time and status.
   * Removes it from active spans and emits the span-ended event.
   */
  endSpan(
    spanId: string,
    status?: SpanStatusDetail,
    attributes?: Record<string, unknown>,
  ): DetailedSpan | undefined {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      return undefined;
    }

    span.endTime = Date.now();
    span.status = status ?? { code: 'ok' };

    if (attributes) {
      Object.assign(span.attributes, attributes);
    }

    this.activeSpans.delete(spanId);
    this.emit('observe:span:ended', {
      traceId: span.context.traceId,
      spanId,
      name: span.name,
      duration: span.endTime - span.startTime,
      status: span.status,
    });

    return span;
  }

  /**
   * Add an event to an active or completed span.
   */
  addSpanEvent(
    spanId: string,
    eventName: string,
    attributes?: Record<string, unknown>,
  ): void {
    const span = this.activeSpans.get(spanId)
      ?? this.findSpanById(spanId);

    if (!span) return;

    const event: SpanEvent = {
      name: eventName,
      timestamp: Date.now(),
      attributes: attributes ?? {},
    };

    span.events.push(event);
    this.emit('observe:span:event', { spanId, eventName });
  }

  /**
   * Add cost attribution data to a span for FinOps tracking.
   */
  addCostAttribution(
    spanId: string,
    cost: Omit<CostAttribution, 'spanId' | 'traceId'>,
  ): void {
    if (!this.config.costTrackingEnabled) return;

    const span = this.activeSpans.get(spanId)
      ?? this.findSpanById(spanId);

    if (!span) return;

    const attribution: CostAttribution = {
      spanId,
      traceId: span.context.traceId,
      ...cost,
    };

    const traceId = span.context.traceId;
    const existing = this.costAttributions.get(traceId) ?? [];
    existing.push(attribution);
    this.costAttributions.set(traceId, existing);

    this.emit('observe:cost:attributed', {
      spanId,
      traceId,
      cost: attribution.cost,
    });
  }

  /**
   * Build a full trace tree from a trace ID.
   * Returns the root span with all nested children resolved.
   */
  getTrace(traceId: string): TraceTree | undefined {
    const spans = this.traces.get(traceId);
    if (!spans || spans.length === 0) return undefined;

    // Find root span (no parent)
    const rootSpan = spans.find(s => !s.context.parentSpanId);
    if (!rootSpan) return undefined;

    // Calculate totals
    let totalDuration = 0;
    let totalCost = 0;
    let totalTokens = 0;

    for (const span of spans) {
      if (span.endTime) {
        totalDuration += span.endTime - span.startTime;
      }
    }

    const costs = this.costAttributions.get(traceId) ?? [];
    for (const cost of costs) {
      totalCost += cost.cost;
      totalTokens += cost.inputTokens + cost.outputTokens;
    }

    return {
      rootSpan,
      spans: [...spans],
      totalDuration,
      totalCost,
      totalTokens,
    };
  }

  /** Get all currently active (unfinished) spans */
  getActiveSpans(): DetailedSpan[] {
    return [...this.activeSpans.values()];
  }

  /** Get a specific span by ID, searching active and completed spans */
  getSpan(spanId: string): DetailedSpan | undefined {
    return this.activeSpans.get(spanId) ?? this.findSpanById(spanId);
  }

  /**
   * Get cost breakdown for a specific trace, aggregated by agent and model.
   */
  getCostByTrace(traceId: string): {
    total: number;
    byAgent: Record<string, number>;
    byModel: Record<string, number>;
  } {
    const costs = this.costAttributions.get(traceId) ?? [];
    const byAgent: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    let total = 0;

    for (const cost of costs) {
      total += cost.cost;

      if (cost.agentId) {
        byAgent[cost.agentId] = (byAgent[cost.agentId] ?? 0) + cost.cost;
      }

      if (cost.model) {
        byModel[cost.model] = (byModel[cost.model] ?? 0) + cost.cost;
      }
    }

    return { total, byAgent, byModel };
  }

  /**
   * Get total cost attributed to a specific agent across all traces.
   */
  getCostByAgent(agentId: string): number {
    let total = 0;
    for (const costs of this.costAttributions.values()) {
      for (const cost of costs) {
        if (cost.agentId === agentId) {
          total += cost.cost;
        }
      }
    }
    return total;
  }

  /**
   * List all traces, optionally filtered by limit and time range.
   */
  listTraces(limit?: number, since?: number): TraceTree[] {
    const trees: TraceTree[] = [];

    for (const traceId of this.traces.keys()) {
      const tree = this.getTrace(traceId);
      if (!tree) continue;

      if (since && tree.rootSpan.startTime < since) continue;

      trees.push(tree);
    }

    // Sort by start time descending (most recent first)
    trees.sort((a, b) => b.rootSpan.startTime - a.rootSpan.startTime);

    if (limit && limit > 0) {
      return trees.slice(0, limit);
    }

    return trees;
  }

  /**
   * Get tracer statistics.
   */
  getStats(): {
    totalTraces: number;
    totalSpans: number;
    activeSpans: number;
    avgDuration: number;
    totalCost: number;
  } {
    let totalSpans = 0;
    let totalDuration = 0;
    let completedSpans = 0;
    let totalCost = 0;

    for (const spans of this.traces.values()) {
      totalSpans += spans.length;
      for (const span of spans) {
        if (span.endTime) {
          totalDuration += span.endTime - span.startTime;
          completedSpans++;
        }
      }
    }

    for (const costs of this.costAttributions.values()) {
      for (const cost of costs) {
        totalCost += cost.cost;
      }
    }

    return {
      totalTraces: this.traces.size,
      totalSpans,
      activeSpans: this.activeSpans.size,
      avgDuration: completedSpans > 0 ? totalDuration / completedSpans : 0,
      totalCost,
    };
  }

  /** Find a span by ID across all traces (completed spans) */
  private findSpanById(spanId: string): DetailedSpan | undefined {
    for (const spans of this.traces.values()) {
      const found = spans.find(s => s.context.spanId === spanId);
      if (found) return found;
    }
    return undefined;
  }

  /** Find a span within a specific trace */
  private findSpanInTrace(traceId: string, spanId: string): DetailedSpan | undefined {
    const spans = this.traces.get(traceId);
    if (!spans) return undefined;
    return spans.find(s => s.context.spanId === spanId);
  }

  /** Remove traces older than the retention window to cap memory usage */
  private enforceRetention(): void {
    const cutoff = Date.now() - this.config.traceRetentionMs;
    const maxSpans = this.config.maxSpans;
    let totalSpanCount = 0;

    // Count total spans
    for (const spans of this.traces.values()) {
      totalSpanCount += spans.length;
    }

    // Evict old traces or if over capacity
    if (totalSpanCount > maxSpans) {
      const traceIds = [...this.traces.keys()];
      for (const traceId of traceIds) {
        const spans = this.traces.get(traceId);
        if (!spans || spans.length === 0) continue;

        const rootSpan = spans.find(s => !s.context.parentSpanId);
        if (rootSpan && rootSpan.startTime < cutoff) {
          this.traces.delete(traceId);
          this.costAttributions.delete(traceId);
          totalSpanCount -= spans.length;
        }

        if (totalSpanCount <= maxSpans) break;
      }
    }
  }
}
