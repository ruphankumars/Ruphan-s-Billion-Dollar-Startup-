import { describe, it, expect } from 'vitest';
import { Tracer } from '../../../src/observability/tracer.js';

describe('Tracer', () => {
  it('should create a trace with root span', () => {
    const tracer = new Tracer();
    const span = tracer.startTrace('test-execution');

    expect(span.id).toBeTruthy();
    expect(span.traceId).toBeTruthy();
    expect(span.name).toBe('test-execution');
    expect(span.kind).toBe('pipeline');
    expect(span.status).toBe('running');
    expect(span.startTime).toBeGreaterThan(0);
  });

  it('should create child spans', () => {
    const tracer = new Tracer();
    const root = tracer.startTrace('execution');
    const child = tracer.startSpan('recall', 'stage', root.id);

    expect(child.parentId).toBe(root.id);
    expect(child.traceId).toBe(root.traceId);
    expect(child.kind).toBe('stage');
    expect(root.children).toContainEqual(expect.objectContaining({ id: child.id }));
  });

  it('should end spans with duration', () => {
    const tracer = new Tracer();
    const root = tracer.startTrace('execution');
    const child = tracer.startSpan('analyze', 'stage', root.id);

    tracer.endSpan(child.id, 'success', { items: 5 });

    const span = tracer.getSpan(child.id);
    expect(span?.status).toBe('success');
    expect(span?.duration).toBeGreaterThanOrEqual(0);
    expect(span?.endTime).toBeDefined();
    expect(span?.attributes.items).toBe(5);
  });

  it('should add events to spans', () => {
    const tracer = new Tracer();
    const root = tracer.startTrace('execution');

    tracer.addEvent(root.id, 'cache_hit', { key: 'test' });
    tracer.addEvent(root.id, 'memory_recalled');

    const span = tracer.getSpan(root.id);
    expect(span?.events.length).toBe(2);
    expect(span?.events[0].name).toBe('cache_hit');
    expect(span?.events[1].name).toBe('memory_recalled');
  });

  it('should set attributes on spans', () => {
    const tracer = new Tracer();
    const root = tracer.startTrace('execution');

    tracer.setAttributes(root.id, { model: 'claude-3', tokens: 1500 });

    const span = tracer.getSpan(root.id);
    expect(span?.attributes.model).toBe('claude-3');
    expect(span?.attributes.tokens).toBe(1500);
  });

  it('should export a trace', () => {
    const tracer = new Tracer();
    const root = tracer.startTrace('execution');
    const child1 = tracer.startSpan('stage-1', 'stage', root.id);
    const child2 = tracer.startSpan('stage-2', 'stage', root.id);

    tracer.endSpan(child1.id, 'success');
    tracer.endSpan(child2.id, 'error');
    tracer.endSpan(root.id, 'error');

    const exported = tracer.exportTrace();
    expect(exported).toBeDefined();
    expect(exported!.traceId).toBe(root.traceId);
    expect(exported!.spanCount).toBe(3);
    expect(exported!.errorCount).toBe(2);
  });

  it('should get timeline view', () => {
    const tracer = new Tracer();
    const root = tracer.startTrace('execution');
    const child = tracer.startSpan('recall', 'stage', root.id);

    tracer.endSpan(child.id, 'success');
    tracer.endSpan(root.id, 'success');

    const timeline = tracer.getTimeline();
    expect(timeline.length).toBe(2);
    expect(timeline[0].depth).toBe(0);
    expect(timeline[0].name).toBe('execution');
    expect(timeline[1].depth).toBe(1);
    expect(timeline[1].name).toBe('recall');
  });

  it('should get active trace', () => {
    const tracer = new Tracer();
    expect(tracer.getActiveTrace()).toBeUndefined();

    const root = tracer.startTrace('test');
    expect(tracer.getActiveTrace()).toBeDefined();
    expect(tracer.getActiveTrace()?.id).toBe(root.id);
  });

  it('should support deeply nested spans', () => {
    const tracer = new Tracer();
    const root = tracer.startTrace('pipeline');
    const wave = tracer.startSpan('wave-1', 'wave', root.id);
    const agent = tracer.startSpan('agent-dev', 'agent', wave.id);
    const tool = tracer.startSpan('file_write', 'tool', agent.id);
    const llm = tracer.startSpan('claude-call', 'llm', agent.id);

    tracer.endSpan(tool.id, 'success');
    tracer.endSpan(llm.id, 'success');
    tracer.endSpan(agent.id, 'success');
    tracer.endSpan(wave.id, 'success');
    tracer.endSpan(root.id, 'success');

    const exported = tracer.exportTrace();
    expect(exported!.spanCount).toBe(5);
    expect(exported!.errorCount).toBe(0);

    const timeline = tracer.getTimeline();
    expect(timeline.length).toBe(5);
    expect(timeline.map(t => t.depth)).toEqual([0, 1, 2, 3, 3]);
  });

  it('should clear all traces', () => {
    const tracer = new Tracer();
    tracer.startTrace('test');

    tracer.clear();

    expect(tracer.getActiveTrace()).toBeUndefined();
    expect(tracer.getAllTraces().length).toBe(0);
  });

  it('should handle missing spans gracefully', () => {
    const tracer = new Tracer();

    // These should not throw
    tracer.endSpan('nonexistent');
    tracer.addEvent('nonexistent', 'test');
    tracer.setAttributes('nonexistent', { x: 1 });
    expect(tracer.getSpan('nonexistent')).toBeUndefined();
  });
});
