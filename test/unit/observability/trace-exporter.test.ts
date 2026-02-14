import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TraceExporter } from '../../../src/observability/trace-exporter.js';
import type { DetailedSpan, ExportConfig, TraceTree } from '../../../src/observability/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeSpan(overrides: Partial<DetailedSpan> = {}): DetailedSpan {
  return {
    context: {
      traceId: 'trace-001',
      spanId: `span-${Math.random().toString(36).slice(2, 8)}`,
      traceFlags: 1,
      ...overrides.context,
    },
    name: overrides.name ?? 'test-span',
    kind: overrides.kind ?? 'internal',
    status: { code: 'ok', ...overrides.status },
    startTime: overrides.startTime ?? 1000,
    endTime: 'endTime' in overrides ? overrides.endTime : 2000,
    attributes: overrides.attributes ?? { model: 'gpt-4' },
    events: overrides.events ?? [],
    links: overrides.links ?? [],
    resource: overrides.resource ?? 'cortexos',
    children: overrides.children ?? [],
  };
}

function makeConfig(overrides: Partial<ExportConfig> = {}): ExportConfig {
  return {
    format: overrides.format ?? 'otlp-json',
    endpoint: overrides.endpoint ?? 'http://localhost:4318/v1/traces',
    batchSize: overrides.batchSize ?? 100,
    flushIntervalMs: overrides.flushIntervalMs ?? 5000,
    ...overrides,
  };
}

function makeTraceTree(spans: DetailedSpan[]): TraceTree {
  return {
    rootSpan: spans[0],
    spans,
    totalDuration: 1000,
    totalCost: 0.05,
    totalTokens: 500,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('TraceExporter', () => {
  let exporter: TraceExporter;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (exporter?.isRunning()) {
      exporter.stop();
    }
    vi.useRealTimers();
  });

  // ── Constructor ──────────────────────────────────────────────────

  describe('constructor', () => {
    it('initializes with default empty config', () => {
      exporter = new TraceExporter();
      const stats = exporter.getStats();
      expect(stats.buffered).toBe(0);
      expect(stats.exported).toBe(0);
      expect(stats.failed).toBe(0);
    });

    it('initializes with provided export configs', () => {
      const configs = [makeConfig({ format: 'otlp-json' }), makeConfig({ format: 'csv' })];
      exporter = new TraceExporter(configs);
      // Exporter is created but not running
      expect(exporter.isRunning()).toBe(false);
      expect(exporter.getStats().buffered).toBe(0);
    });

    it('does not mutate the original configs array', () => {
      const configs = [makeConfig()];
      exporter = new TraceExporter(configs);
      configs.push(makeConfig({ format: 'csv' }));
      // The exporter should still have only one config (defensive copy).
      // We verify indirectly: flushing with one config means export count
      // equals span count once (not twice).
      exporter.addSpan(makeSpan());
      return exporter.flush().then((result) => {
        expect(result.exported).toBe(1);
      });
    });
  });

  // ── addSpan / buffering ──────────────────────────────────────────

  describe('addSpan()', () => {
    it('buffers a span and increments buffer count', () => {
      exporter = new TraceExporter();
      exporter.addSpan(makeSpan());
      expect(exporter.getStats().buffered).toBe(1);
    });

    it('emits observe:span:buffered with spanId and bufferSize', () => {
      exporter = new TraceExporter();
      const handler = vi.fn();
      exporter.on('observe:span:buffered', handler);

      const span = makeSpan();
      exporter.addSpan(span);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({
        spanId: span.context.spanId,
        bufferSize: 1,
      });
    });

    it('buffers multiple spans in order', () => {
      exporter = new TraceExporter();
      exporter.addSpan(makeSpan({ name: 'first' }));
      exporter.addSpan(makeSpan({ name: 'second' }));
      exporter.addSpan(makeSpan({ name: 'third' }));
      expect(exporter.getStats().buffered).toBe(3);
    });
  });

  // ── Auto-flush on batch size ─────────────────────────────────────

  describe('auto-flush on batch size', () => {
    it('triggers flush when buffer reaches config batchSize', async () => {
      const config = makeConfig({ batchSize: 2 });
      exporter = new TraceExporter([config]);

      const flushHandler = vi.fn();
      exporter.on('observe:export:flushed', flushHandler);

      exporter.addSpan(makeSpan({ name: 'span-1' }));
      expect(flushHandler).not.toHaveBeenCalled();

      exporter.addSpan(makeSpan({ name: 'span-2' }));
      // The flush is async, so wait for the microtask queue
      await vi.waitFor(() => {
        expect(flushHandler).toHaveBeenCalledOnce();
      });
      expect(flushHandler).toHaveBeenCalledWith(
        expect.objectContaining({ exported: 2, failed: 0 }),
      );
    });
  });

  // ── flush() ──────────────────────────────────────────────────────

  describe('flush()', () => {
    it('returns zeroes when buffer is empty', async () => {
      exporter = new TraceExporter([makeConfig()]);
      const result = await exporter.flush();
      expect(result).toEqual({ exported: 0, failed: 0 });
    });

    it('clears the buffer after flushing', async () => {
      exporter = new TraceExporter([makeConfig()]);
      exporter.addSpan(makeSpan());
      exporter.addSpan(makeSpan());
      expect(exporter.getStats().buffered).toBe(2);

      await exporter.flush();
      expect(exporter.getStats().buffered).toBe(0);
    });

    it('counts exported spans with no configs as exported (buffer cleared)', async () => {
      exporter = new TraceExporter();
      exporter.addSpan(makeSpan());
      exporter.addSpan(makeSpan());

      const result = await exporter.flush();
      expect(result.exported).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('emits observe:export:sending for configs with endpoints', async () => {
      const config = makeConfig({ endpoint: 'http://collector:4318' });
      exporter = new TraceExporter([config]);
      const handler = vi.fn();
      exporter.on('observe:export:sending', handler);

      exporter.addSpan(makeSpan());
      await exporter.flush();

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'otlp-json',
          endpoint: 'http://collector:4318',
          spanCount: 1,
        }),
      );
    });

    it('emits observe:export:flushed with exported and failed counts', async () => {
      exporter = new TraceExporter([makeConfig()]);
      const handler = vi.fn();
      exporter.on('observe:export:flushed', handler);

      exporter.addSpan(makeSpan());
      await exporter.flush();

      expect(handler).toHaveBeenCalledWith({ exported: 1, failed: 0 });
    });

    it('accumulates exported count in getStats across multiple flushes', async () => {
      exporter = new TraceExporter([makeConfig()]);
      exporter.addSpan(makeSpan());
      await exporter.flush();
      exporter.addSpan(makeSpan());
      exporter.addSpan(makeSpan());
      await exporter.flush();

      const stats = exporter.getStats();
      expect(stats.exported).toBe(3);
      expect(stats.buffered).toBe(0);
    });
  });

  // ── export() direct format serialization ─────────────────────────

  describe('export() — OTLP JSON format', () => {
    it('produces valid OTLP-JSON with resourceSpans structure', () => {
      exporter = new TraceExporter();
      const span = makeSpan({
        name: 'llm-call',
        kind: 'client',
        resource: 'my-service',
        startTime: 1000,
        endTime: 2000,
        attributes: { model: 'claude-3', temperature: 0.7 },
        status: { code: 'ok', message: 'success' },
      });
      const tree = makeTraceTree([span]);

      const output = exporter.export([tree], 'otlp-json');
      const parsed = JSON.parse(output);

      expect(parsed.resourceSpans).toHaveLength(1);
      const rs = parsed.resourceSpans[0];
      expect(rs.resource.attributes[0]).toEqual({
        key: 'service.name',
        value: { stringValue: 'my-service' },
      });

      const otlpSpan = rs.scopeSpans[0].spans[0];
      expect(otlpSpan.name).toBe('llm-call');
      expect(otlpSpan.kind).toBe(3); // client
      expect(otlpSpan.startTimeUnixNano).toBe(1000 * 1_000_000);
      expect(otlpSpan.endTimeUnixNano).toBe(2000 * 1_000_000);
      expect(otlpSpan.status.code).toBe(1); // ok = 1
      expect(otlpSpan.status.message).toBe('success');
    });

    it('correctly maps OTLP attribute types (string, int, double, bool)', () => {
      exporter = new TraceExporter();
      const span = makeSpan({
        attributes: {
          strAttr: 'hello',
          intAttr: 42,
          floatAttr: 3.14,
          boolAttr: true,
        },
      });
      const tree = makeTraceTree([span]);
      const output = exporter.export([tree], 'otlp-json');
      const parsed = JSON.parse(output);
      const attrs = parsed.resourceSpans[0].scopeSpans[0].spans[0].attributes;

      const findAttr = (key: string) => attrs.find((a: { key: string }) => a.key === key);
      expect(findAttr('strAttr').value).toEqual({ stringValue: 'hello' });
      expect(findAttr('intAttr').value).toEqual({ intValue: 42 });
      expect(findAttr('floatAttr').value).toEqual({ doubleValue: 3.14 });
      expect(findAttr('boolAttr').value).toEqual({ boolValue: true });
    });

    it('groups spans by resource into separate resourceSpans', () => {
      exporter = new TraceExporter();
      const span1 = makeSpan({ resource: 'service-a' });
      const span2 = makeSpan({ resource: 'service-b' });
      const tree = makeTraceTree([span1, span2]);

      const output = exporter.export([tree], 'otlp-json');
      const parsed = JSON.parse(output);
      expect(parsed.resourceSpans).toHaveLength(2);

      const resources = parsed.resourceSpans.map(
        (rs: any) => rs.resource.attributes[0].value.stringValue,
      );
      expect(resources).toContain('service-a');
      expect(resources).toContain('service-b');
    });
  });

  describe('export() — CSV format', () => {
    it('produces CSV with correct headers and span data', () => {
      exporter = new TraceExporter();
      const span = makeSpan({
        name: 'embed-call',
        kind: 'server',
        startTime: 5000,
        endTime: 7500,
        resource: 'embeddings-svc',
        status: { code: 'error', message: 'timeout' },
      });
      span.context.traceId = 'trace-abc';
      span.context.spanId = 'span-xyz';
      span.context.parentSpanId = 'span-parent';

      const tree = makeTraceTree([span]);
      const output = exporter.export([tree], 'csv');
      const lines = output.split('\n');

      expect(lines[0]).toBe(
        'trace_id,span_id,parent_span_id,name,kind,status,start_time,end_time,duration_ms,resource,attributes',
      );
      expect(lines).toHaveLength(2); // header + 1 row

      const row = lines[1];
      expect(row).toContain('trace-abc');
      expect(row).toContain('span-xyz');
      expect(row).toContain('span-parent');
      expect(row).toContain('embed-call');
      expect(row).toContain('server');
      expect(row).toContain('error');
      expect(row).toContain('5000');
      expect(row).toContain('7500');
      expect(row).toContain('2500'); // duration
    });

    it('escapes CSV fields containing commas, quotes, and newlines', () => {
      exporter = new TraceExporter();
      const span = makeSpan({
        name: 'span, with "special" chars\nnewline',
        resource: 'svc',
        attributes: {},
      });
      const tree = makeTraceTree([span]);
      const output = exporter.export([tree], 'csv');
      // The name field should be wrapped in double quotes with inner quotes escaped
      expect(output).toContain('"span, with ""special"" chars\nnewline"');
    });

    it('computes duration as zero when endTime is absent', () => {
      exporter = new TraceExporter();
      const span = makeSpan({ startTime: 3000, endTime: undefined });
      const tree = makeTraceTree([span]);
      const output = exporter.export([tree], 'csv');
      const dataRow = output.split('\n')[1];
      // duration_ms column should be 0
      const cols = dataRow.split(',');
      // duration_ms is index 8 in the headers
      expect(cols[8]).toBe('0');
    });
  });

  // ── start() / stop() lifecycle ───────────────────────────────────

  describe('start() / stop() lifecycle', () => {
    it('sets running state to true on start', () => {
      exporter = new TraceExporter([makeConfig()]);
      expect(exporter.isRunning()).toBe(false);
      exporter.start();
      expect(exporter.isRunning()).toBe(true);
    });

    it('emits observe:exporter:started on start', () => {
      exporter = new TraceExporter([makeConfig()]);
      const handler = vi.fn();
      exporter.on('observe:exporter:started', handler);
      exporter.start();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('emits observe:exporter:stopped on stop', () => {
      exporter = new TraceExporter([makeConfig()]);
      const handler = vi.fn();
      exporter.on('observe:exporter:stopped', handler);
      exporter.start();
      exporter.stop();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('sets running state to false on stop', () => {
      exporter = new TraceExporter([makeConfig()]);
      exporter.start();
      exporter.stop();
      expect(exporter.isRunning()).toBe(false);
    });

    it('triggers periodic flush at the minimum configured interval', async () => {
      const config = makeConfig({ flushIntervalMs: 1000 });
      exporter = new TraceExporter([config]);

      const flushHandler = vi.fn();
      exporter.on('observe:export:flushed', flushHandler);

      exporter.start();
      exporter.addSpan(makeSpan());

      // Advance past the flush interval
      await vi.advanceTimersByTimeAsync(1000);

      expect(flushHandler).toHaveBeenCalledWith(
        expect.objectContaining({ exported: 1 }),
      );
    });

    it('stops periodic flushing when stop() is called', async () => {
      const config = makeConfig({ flushIntervalMs: 500 });
      exporter = new TraceExporter([config]);

      const flushHandler = vi.fn();
      exporter.on('observe:export:flushed', flushHandler);

      exporter.start();
      exporter.stop();

      exporter.addSpan(makeSpan());
      await vi.advanceTimersByTimeAsync(2000);

      // No flush should have fired because the timer was cleared
      expect(flushHandler).not.toHaveBeenCalled();
    });
  });

  // ── getStats() ───────────────────────────────────────────────────

  describe('getStats()', () => {
    it('reflects accurate buffered, exported, and failed counts', async () => {
      exporter = new TraceExporter([makeConfig()]);

      expect(exporter.getStats()).toEqual({
        buffered: 0,
        exported: 0,
        failed: 0,
      });

      exporter.addSpan(makeSpan());
      exporter.addSpan(makeSpan());
      expect(exporter.getStats().buffered).toBe(2);

      await exporter.flush();
      expect(exporter.getStats()).toEqual({
        buffered: 0,
        exported: 2,
        failed: 0,
      });
    });
  });

  // ── Error handling ───────────────────────────────────────────────

  describe('error handling', () => {
    it('emits observe:export:error when auto-flush from batch size fails', async () => {
      const config = makeConfig({ batchSize: 1, format: 'otlp-json' });
      exporter = new TraceExporter([config]);

      const errorHandler = vi.fn();
      exporter.on('observe:export:error', errorHandler);

      // Create a span whose attributes property throws on iteration,
      // causing serialization to fail inside the catch block.
      const badSpan = makeSpan();
      Object.defineProperty(badSpan, 'attributes', {
        get() { throw new Error('poisoned attributes'); },
        enumerable: true,
        configurable: true,
      });

      exporter.addSpan(badSpan);

      // The auto-flush is async, wait for it
      await vi.waitFor(() => {
        expect(errorHandler).toHaveBeenCalled();
      });
    });

    it('increments failed count and emits error event on serialization failure during flush', async () => {
      const config = makeConfig({ format: 'csv' });
      exporter = new TraceExporter([config]);

      const errorHandler = vi.fn();
      exporter.on('observe:export:error', errorHandler);

      const badSpan = makeSpan();
      Object.defineProperty(badSpan, 'attributes', {
        get() { throw new Error('poisoned attributes'); },
        enumerable: true,
        configurable: true,
      });
      exporter.addSpan(badSpan);

      const result = await exporter.flush();
      expect(result.failed).toBe(1);
      expect(result.exported).toBe(0);
      expect(exporter.getStats().failed).toBe(1);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'csv',
          spanCount: 1,
        }),
      );
    });
  });

  // ── Langfuse and Datadog formats ─────────────────────────────────

  describe('export() — Langfuse format', () => {
    it('produces Langfuse-compatible batch JSON with trace and span types', () => {
      exporter = new TraceExporter();
      const rootSpan = makeSpan({ name: 'root' });
      rootSpan.context.parentSpanId = undefined;
      const childSpan = makeSpan({ name: 'child' });
      childSpan.context.parentSpanId = 'span-root';

      const tree = makeTraceTree([rootSpan, childSpan]);
      const output = exporter.export([tree], 'langfuse');
      const parsed = JSON.parse(output);

      expect(parsed.batch).toHaveLength(2);
      // Root span (no parent) should have type 'trace'
      const root = parsed.batch.find((e: any) => e.name === 'root');
      expect(root.type).toBe('trace');
      expect(root.parentObservationId).toBeNull();

      // Child span (has parent) should have type 'span'
      const child = parsed.batch.find((e: any) => e.name === 'child');
      expect(child.type).toBe('span');
      expect(child.parentObservationId).toBe('span-root');
    });
  });

  describe('export() — Datadog format', () => {
    it('produces Datadog APM-compatible JSON with traces grouped by traceId', () => {
      exporter = new TraceExporter();
      const span1 = makeSpan({ name: 'op-1' });
      span1.context.traceId = 'trace-A';
      const span2 = makeSpan({ name: 'op-2' });
      span2.context.traceId = 'trace-A';
      const span3 = makeSpan({ name: 'op-3' });
      span3.context.traceId = 'trace-B';

      const tree = makeTraceTree([span1, span2, span3]);
      const output = exporter.export([tree], 'datadog');
      const parsed = JSON.parse(output);

      // Datadog format groups spans by trace into arrays
      expect(parsed).toHaveLength(2); // two trace groups
      const allSpans = parsed.flat();
      expect(allSpans).toHaveLength(3);
      expect(allSpans.every((s: any) => s.service === 'cortexos')).toBe(true);
      // Error span should have error: 0 for ok status
      expect(allSpans[0].error).toBe(0);
    });
  });
});
