import { describe, it, expect, vi } from 'vitest';
import { MessageBus } from '../../../src/agents/message-bus.js';

describe('MessageBus', () => {
  it('should send and receive messages', () => {
    const bus = new MessageBus();
    const received: any[] = [];

    bus.subscribe('agent-1', (msg) => received.push(msg));

    bus.send({
      from: 'coordinator',
      to: 'agent-1',
      type: 'request',
      payload: { action: 'start' },
    });

    expect(received.length).toBe(1);
    expect(received[0].from).toBe('coordinator');
    expect(received[0].payload).toEqual({ action: 'start' });
    expect(received[0].timestamp).toBeInstanceOf(Date);

    bus.destroy();
  });

  it('should support broadcast messages via subscribeAll', () => {
    const bus = new MessageBus();
    const allMessages: any[] = [];

    bus.subscribeAll((msg) => allMessages.push(msg));

    bus.send({ from: 'a', to: 'b', type: 'status', payload: {} });
    bus.send({ from: 'c', to: 'd', type: 'status', payload: {} });

    expect(allMessages.length).toBe(2);

    bus.destroy();
  });

  it('should not double-emit broadcast messages to subscribeAll', () => {
    const bus = new MessageBus();
    const allMessages: any[] = [];
    const broadcastDirect: any[] = [];

    bus.subscribeAll((msg) => allMessages.push(msg));
    bus.subscribe('*', (msg) => broadcastDirect.push(msg));

    // Broadcast to '*' emits once on 'agent:*' (the subscribe('*') channel)
    // but does NOT re-emit a second time to 'agent:*' (the subscribeAll channel)
    // Since both listen on 'agent:*', message is received exactly once by each
    bus.send({ from: 'a', to: '*', type: 'status', payload: {} });

    expect(broadcastDirect.length).toBe(1);
    expect(allMessages.length).toBe(1); // only once, no double-emit

    bus.destroy();
  });

  it('should support unsubscribe', () => {
    const bus = new MessageBus();
    const received: any[] = [];

    const unsub = bus.subscribe('agent-1', (msg) => received.push(msg));

    bus.send({ from: 'a', to: 'agent-1', type: 'status', payload: {} });
    expect(received.length).toBe(1);

    unsub();

    bus.send({ from: 'a', to: 'agent-1', type: 'status', payload: {} });
    expect(received.length).toBe(1); // No new message

    bus.destroy();
  });

  it('should track message history', () => {
    const bus = new MessageBus();

    bus.send({ from: 'a', to: 'b', type: 'status', payload: {} });
    bus.send({ from: 'c', to: 'd', type: 'result', payload: {} });
    bus.send({ from: 'a', to: 'b', type: 'error', payload: {} });

    const all = bus.getHistory();
    expect(all.length).toBe(3);

    const fromA = bus.getHistory({ from: 'a' });
    expect(fromA.length).toBe(2);

    const typeError = bus.getHistory({ type: 'error' });
    expect(typeError.length).toBe(1);

    bus.destroy();
  });

  it('should limit history size', () => {
    const bus = new MessageBus(5);

    for (let i = 0; i < 10; i++) {
      bus.send({ from: 'a', to: 'b', type: 'status', payload: { i } });
    }

    expect(bus.getHistory().length).toBe(5);

    bus.destroy();
  });

  it('should clear history', () => {
    const bus = new MessageBus();

    bus.send({ from: 'a', to: 'b', type: 'status', payload: {} });
    expect(bus.getHistory().length).toBe(1);

    bus.clearHistory();
    expect(bus.getHistory().length).toBe(0);

    bus.destroy();
  });

  it('should clean up on destroy', () => {
    const bus = new MessageBus();
    const received: any[] = [];

    bus.subscribe('agent-1', (msg) => received.push(msg));
    bus.send({ from: 'a', to: 'agent-1', type: 'status', payload: {} });
    expect(received.length).toBe(1);

    bus.destroy();

    bus.send({ from: 'a', to: 'agent-1', type: 'status', payload: {} });
    expect(received.length).toBe(1); // No new messages after destroy
  });
});
