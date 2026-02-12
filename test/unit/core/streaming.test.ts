import { describe, it, expect, vi } from 'vitest';
import {
  StreamController,
  StreamBridge,
  formatSSE,
  createStreamPipeline,
} from '../../../src/core/streaming.js';
import { EventBus } from '../../../src/core/events.js';

describe('StreamController', () => {
  it('should emit events to subscribers', () => {
    const stream = new StreamController();
    const received: any[] = [];
    stream.subscribe(event => received.push(event));

    stream.emit('pipeline:start', { prompt: 'test' });
    expect(received.length).toBe(1);
    expect(received[0].type).toBe('pipeline:start');
    expect(received[0].data).toEqual({ prompt: 'test' });
    expect(received[0].sequence).toBe(0);
    expect(received[0].timestamp).toBeGreaterThan(0);
  });

  it('should assign incrementing sequence numbers', () => {
    const stream = new StreamController();
    const received: any[] = [];
    stream.subscribe(event => received.push(event));

    stream.emit('stage:enter', { stage: 'recall' });
    stream.emit('stage:exit', { stage: 'recall' });
    stream.emit('stage:enter', { stage: 'analyze' });

    expect(received[0].sequence).toBe(0);
    expect(received[1].sequence).toBe(1);
    expect(received[2].sequence).toBe(2);
  });

  it('should support unsubscribe', () => {
    const stream = new StreamController();
    const received: any[] = [];
    const unsub = stream.subscribe(event => received.push(event));

    stream.emit('stage:enter', {});
    unsub();
    stream.emit('stage:exit', {});

    expect(received.length).toBe(1);
  });

  it('should include stage in events', () => {
    const stream = new StreamController();
    const received: any[] = [];
    stream.subscribe(event => received.push(event));

    stream.emit('stage:enter', {}, 'recall');
    expect(received[0].stage).toBe('recall');
  });

  it('should not emit after close', () => {
    const stream = new StreamController();
    const received: any[] = [];
    stream.subscribe(event => received.push(event));

    stream.emit('stage:enter', {});
    stream.close();
    stream.emit('stage:exit', {});

    expect(received.length).toBe(1);
    expect(stream.isClosed).toBe(true);
  });

  it('should report event count', () => {
    const stream = new StreamController();
    stream.emit('heartbeat', {});
    stream.emit('heartbeat', {});
    expect(stream.eventCount).toBe(2);
  });

  it('should support async iteration', async () => {
    const stream = new StreamController();
    const events: any[] = [];

    // Emit events and close
    stream.emit('pipeline:start', { prompt: 'test' });
    stream.emit('stage:enter', { stage: 'recall' });
    stream.close();

    for await (const event of stream) {
      events.push(event);
    }

    expect(events.length).toBe(2);
    expect(events[0].type).toBe('pipeline:start');
    expect(events[1].type).toBe('stage:enter');
  });

  it('should handle multiple subscribers', () => {
    const stream = new StreamController();
    const sub1: any[] = [];
    const sub2: any[] = [];

    stream.subscribe(e => sub1.push(e));
    stream.subscribe(e => sub2.push(e));

    stream.emit('heartbeat', {});
    expect(sub1.length).toBe(1);
    expect(sub2.length).toBe(1);
  });
});

describe('StreamBridge', () => {
  it('should bridge engine events to stream', () => {
    const eventBus = new EventBus();
    const stream = new StreamController();
    const bridge = new StreamBridge(eventBus, stream);
    bridge.connect();

    const received: any[] = [];
    stream.subscribe(e => received.push(e));

    eventBus.emit('engine:start', { prompt: 'test' });
    expect(received.length).toBe(1);
    expect(received[0].type).toBe('pipeline:start');

    bridge.disconnect();
  });

  it('should map stage events', () => {
    const eventBus = new EventBus();
    const stream = new StreamController();
    const bridge = new StreamBridge(eventBus, stream);
    bridge.connect();

    const received: any[] = [];
    stream.subscribe(e => received.push(e));

    eventBus.emit('stage:start', { stage: 'recall' });
    eventBus.emit('stage:complete', { stage: 'recall' });

    expect(received.length).toBe(2);
    expect(received[0].type).toBe('stage:enter');
    expect(received[1].type).toBe('stage:exit');

    bridge.disconnect();
  });

  it('should stop bridging after disconnect', () => {
    const eventBus = new EventBus();
    const stream = new StreamController();
    const bridge = new StreamBridge(eventBus, stream);
    bridge.connect();

    const received: any[] = [];
    stream.subscribe(e => received.push(e));

    eventBus.emit('engine:start', {});
    bridge.disconnect();
    eventBus.emit('engine:complete', {});

    expect(received.length).toBe(1);
  });
});

describe('formatSSE', () => {
  it('should format event as SSE text', () => {
    const sse = formatSSE({
      type: 'pipeline:start',
      stage: 'recall',
      data: { prompt: 'test' },
      timestamp: 1000,
      sequence: 0,
    });

    expect(sse).toContain('event: pipeline:start');
    expect(sse).toContain('id: 0');
    expect(sse).toContain('"prompt":"test"');
    expect(sse.endsWith('\n\n')).toBe(true);
  });
});

describe('createStreamPipeline', () => {
  it('should create wired stream + bridge', () => {
    const eventBus = new EventBus();
    const { stream, bridge } = createStreamPipeline(eventBus);

    const received: any[] = [];
    stream.subscribe(e => received.push(e));

    eventBus.emit('engine:start', { prompt: 'hello' });
    expect(received.length).toBe(1);

    bridge.disconnect();
    stream.close();
  });
});
