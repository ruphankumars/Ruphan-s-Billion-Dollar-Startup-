import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DistributedTracer } from '../../../src/observability/distributed-tracer.js';

describe('DistributedTracer', () => {
  let tracer: DistributedTracer;

  beforeEach(() => {
    tracer = new DistributedTracer();
    tracer.start();
  });

  afterEach(() => {
    tracer.stop();
    tracer.removeAllListeners();
  });

  // ── Constructor & Lifecycle ─────────────────────────────────────

  describe('constructor and lifecycle', () => {
    it('should create a tracer with default config', () => {
      const t = new DistributedTracer();
      expect(t.isRunning()).toBe(false);
      const stats = t.getStats();
      expect(stats.totalTraces).toBe(0);
      expect(stats.totalSpans).toBe(0);
      expect(stats.activeSpans).toBe(0);
    });

    it('should accept custom config overrides', () => {
      const t = new DistributedTracer({ maxSpans: 500, costTrackingEnabled: false });
      expect(t.isRunning()).toBe(false);
    });

    it('should transition through start and stop', () => {
      const t = new DistributedTracer();
      expect(t.isRunning()).toBe(false);
      t.start();
      expect(t.isRunning()).toBe(true);
      t.stop();
      expect(t.isRunning()).toBe(false);
    });

    it('should emit started and stopped events', () => {
      const t = new DistributedTracer();
      const startedHandler = vi.fn();
      const stoppedHandler = vi.fn();
      t.on('observe:tracer:started', startedHandler);
      t.on('observe:tracer:stopped', stoppedHandler);

      t.start();
      expect(startedHandler).toHaveBeenCalledOnce();

      t.stop();
      expect(stoppedHandler).toHaveBeenCalledOnce();
    });
  });

  // ── startTrace ──────────────────────────────────────────────────

  describe('startTrace', () => {
    it('should create a trace with a root span', () => {
      const ctx = tracer.startTrace('root-operation');
      expect(ctx.traceId).toMatch(/^trc-/);
      expect(ctx.spanId).toMatch(/^spn-/);
      expect(ctx.traceFlags).toBe(1);
      expect(ctx.parentSpanId).toBeUndefined();
    });

    it('should store the root span as active', () => {
      const ctx = tracer.startTrace('root-operation');
      const activeSpans = tracer.getActiveSpans();
      expect(activeSpans).toHaveLength(1);
      expect(activeSpans[0].name).toBe('root-operation');
      expect(activeSpans[0].context.spanId).toBe(ctx.spanId);
    });

    it('should assign attributes to root span', () => {
      const ctx = tracer.startTrace('root-op', { env: 'test', version: '1.0' });
      const span = tracer.getSpan(ctx.spanId);
      expect(span?.attributes).toEqual({ env: 'test', version: '1.0' });
    });

    it('should emit trace:started event', () => {
      const handler = vi.fn();
      tracer.on('observe:trace:started', handler);
      const ctx = tracer.startTrace('my-trace');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ traceId: ctx.traceId, name: 'my-trace' }),
      );
    });
  });

  // ── startSpan ───────────────────────────────────────────────────

  describe('startSpan', () => {
    it('should create a child span within an existing trace', () => {
      const root = tracer.startTrace('root');
      const child = tracer.startSpan('child-op', root);
      expect(child.traceId).toBe(root.traceId);
      expect(child.parentSpanId).toBe(root.spanId);
      expect(child.spanId).toMatch(/^spn-/);
    });

    it('should register the child in the parent children array', () => {
      const root = tracer.startTrace('root');
      const child = tracer.startSpan('child-op', root);
      const rootSpan = tracer.getSpan(root.spanId);
      expect(rootSpan?.children).toContain(child.spanId);
    });

    it('should accept kind and attributes', () => {
      const root = tracer.startTrace('root');
      const child = tracer.startSpan('llm-call', root, 'client', { model: 'gpt-4' });
      const span = tracer.getSpan(child.spanId);
      expect(span?.kind).toBe('client');
      expect(span?.attributes).toEqual({ model: 'gpt-4' });
    });

    it('should create an independent trace when no parent is provided', () => {
      const ctx = tracer.startSpan('orphan-span');
      expect(ctx.traceId).toMatch(/^trc-/);
      expect(ctx.parentSpanId).toBeUndefined();
    });

    it('should emit span:started event', () => {
      const handler = vi.fn();
      tracer.on('observe:span:started', handler);
      const root = tracer.startTrace('root');
      tracer.startSpan('child', root, 'server');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'child', kind: 'server' }),
      );
    });
  });

  // ── endSpan ─────────────────────────────────────────────────────

  describe('endSpan', () => {
    it('should end a span and set endTime', () => {
      const root = tracer.startTrace('root');
      const ended = tracer.endSpan(root.spanId);
      expect(ended).toBeDefined();
      expect(ended!.endTime).toBeDefined();
      expect(ended!.endTime! - ended!.startTime).toBeGreaterThanOrEqual(0);
    });

    it('should default to ok status when no status given', () => {
      const root = tracer.startTrace('root');
      const ended = tracer.endSpan(root.spanId);
      expect(ended!.status).toEqual({ code: 'ok' });
    });

    it('should accept a custom status and additional attributes', () => {
      const root = tracer.startTrace('root');
      const ended = tracer.endSpan(
        root.spanId,
        { code: 'error', message: 'timeout' },
        { retries: 3 },
      );
      expect(ended!.status).toEqual({ code: 'error', message: 'timeout' });
      expect(ended!.attributes.retries).toBe(3);
    });

    it('should remove the span from active spans after ending', () => {
      const root = tracer.startTrace('root');
      expect(tracer.getActiveSpans()).toHaveLength(1);
      tracer.endSpan(root.spanId);
      expect(tracer.getActiveSpans()).toHaveLength(0);
    });

    it('should return undefined for a non-existent span ID', () => {
      const result = tracer.endSpan('spn-nonexistent');
      expect(result).toBeUndefined();
    });

    it('should emit span:ended event with duration', () => {
      const handler = vi.fn();
      tracer.on('observe:span:ended', handler);
      const root = tracer.startTrace('root');
      tracer.endSpan(root.spanId);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          spanId: root.spanId,
          name: 'root',
          duration: expect.any(Number),
          status: { code: 'ok' },
        }),
      );
    });
  });

  // ── addSpanEvent ────────────────────────────────────────────────

  describe('addSpanEvent', () => {
    it('should add an event to an active span', () => {
      const root = tracer.startTrace('root');
      tracer.addSpanEvent(root.spanId, 'cache_hit', { key: 'data' });
      const span = tracer.getSpan(root.spanId);
      expect(span?.events).toHaveLength(1);
      expect(span?.events[0].name).toBe('cache_hit');
      expect(span?.events[0].attributes).toEqual({ key: 'data' });
      expect(span?.events[0].timestamp).toBeGreaterThan(0);
    });

    it('should add events to a completed (non-active) span', () => {
      const root = tracer.startTrace('root');
      tracer.endSpan(root.spanId);
      tracer.addSpanEvent(root.spanId, 'post-processing');
      const span = tracer.getSpan(root.spanId);
      expect(span?.events).toHaveLength(1);
    });

    it('should silently ignore non-existent span', () => {
      // Should not throw
      tracer.addSpanEvent('spn-does-not-exist', 'some-event');
    });
  });

  // ── addCostAttribution ──────────────────────────────────────────

  describe('addCostAttribution', () => {
    it('should track cost for a span', () => {
      const root = tracer.startTrace('root');
      tracer.addCostAttribution(root.spanId, {
        agentId: 'agent-1',
        model: 'gpt-4',
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0.045,
        duration: 1200,
      });

      const costInfo = tracer.getCostByTrace(root.traceId);
      expect(costInfo.total).toBe(0.045);
      expect(costInfo.byAgent['agent-1']).toBe(0.045);
      expect(costInfo.byModel['gpt-4']).toBe(0.045);
    });

    it('should aggregate multiple cost attributions', () => {
      const root = tracer.startTrace('root');
      tracer.addCostAttribution(root.spanId, {
        agentId: 'agent-1',
        model: 'gpt-4',
        inputTokens: 500,
        outputTokens: 250,
        cost: 0.02,
        duration: 500,
      });
      const child = tracer.startSpan('child', root);
      tracer.addCostAttribution(child.spanId, {
        agentId: 'agent-2',
        model: 'claude-3-opus',
        inputTokens: 800,
        outputTokens: 400,
        cost: 0.05,
        duration: 700,
      });

      const costInfo = tracer.getCostByTrace(root.traceId);
      expect(costInfo.total).toBeCloseTo(0.07);
      expect(costInfo.byAgent['agent-1']).toBeCloseTo(0.02);
      expect(costInfo.byAgent['agent-2']).toBeCloseTo(0.05);
    });

    it('should not track costs when costTrackingEnabled is false', () => {
      const t = new DistributedTracer({ costTrackingEnabled: false });
      t.start();
      const root = t.startTrace('root');
      t.addCostAttribution(root.spanId, {
        agentId: 'a1',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.01,
        duration: 100,
      });
      const costInfo = t.getCostByTrace(root.traceId);
      expect(costInfo.total).toBe(0);
    });
  });

  // ── getTrace ────────────────────────────────────────────────────

  describe('getTrace', () => {
    it('should return undefined for a non-existent trace', () => {
      expect(tracer.getTrace('trc-nonexistent')).toBeUndefined();
    });

    it('should build a trace tree with root span, spans, and totals', () => {
      const root = tracer.startTrace('root');
      const child = tracer.startSpan('child', root);
      tracer.endSpan(child.spanId);
      tracer.endSpan(root.spanId);

      tracer.addCostAttribution(child.spanId, {
        agentId: 'a1',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.01,
        duration: 200,
      });

      const tree = tracer.getTrace(root.traceId);
      expect(tree).toBeDefined();
      expect(tree!.rootSpan.name).toBe('root');
      expect(tree!.spans).toHaveLength(2);
      expect(tree!.totalDuration).toBeGreaterThanOrEqual(0);
      expect(tree!.totalCost).toBe(0.01);
      expect(tree!.totalTokens).toBe(150);
    });
  });

  // ── getCostByAgent ──────────────────────────────────────────────

  describe('getCostByAgent', () => {
    it('should sum costs for an agent across all traces', () => {
      const t1 = tracer.startTrace('trace1');
      tracer.addCostAttribution(t1.spanId, {
        agentId: 'agent-x',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.02,
        duration: 100,
      });

      const t2 = tracer.startTrace('trace2');
      tracer.addCostAttribution(t2.spanId, {
        agentId: 'agent-x',
        model: 'claude-3-opus',
        inputTokens: 200,
        outputTokens: 100,
        cost: 0.03,
        duration: 200,
      });

      expect(tracer.getCostByAgent('agent-x')).toBeCloseTo(0.05);
      expect(tracer.getCostByAgent('agent-unknown')).toBe(0);
    });
  });

  // ── listTraces ──────────────────────────────────────────────────

  describe('listTraces', () => {
    it('should list traces sorted by start time descending', () => {
      tracer.startTrace('first');
      tracer.startTrace('second');
      tracer.startTrace('third');

      const traces = tracer.listTraces();
      expect(traces).toHaveLength(3);
      expect(traces[0].rootSpan.startTime).toBeGreaterThanOrEqual(
        traces[1].rootSpan.startTime,
      );
    });

    it('should respect the limit parameter', () => {
      tracer.startTrace('a');
      tracer.startTrace('b');
      tracer.startTrace('c');

      const traces = tracer.listTraces(2);
      expect(traces).toHaveLength(2);
    });
  });

  // ── getStats ────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const root = tracer.startTrace('root');
      const child = tracer.startSpan('child', root);
      tracer.endSpan(child.spanId);
      tracer.addCostAttribution(child.spanId, {
        agentId: 'a1',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        cost: 0.01,
        duration: 300,
      });

      const stats = tracer.getStats();
      expect(stats.totalTraces).toBe(1);
      expect(stats.totalSpans).toBe(2);
      expect(stats.activeSpans).toBe(1); // root still active
      expect(stats.avgDuration).toBeGreaterThanOrEqual(0);
      expect(stats.totalCost).toBe(0.01);
    });

    it('should report zero avgDuration when no spans are completed', () => {
      tracer.startTrace('root');
      const stats = tracer.getStats();
      expect(stats.avgDuration).toBe(0);
    });
  });
});
