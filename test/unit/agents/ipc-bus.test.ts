import { describe, it, expect, vi } from 'vitest';
import { IPCMessageBus } from '../../../src/agents/ipc-bus.js';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

function createMockProcess(): ChildProcess {
  const emitter = new EventEmitter();
  return {
    connected: true,
    send: vi.fn(),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    pid: Math.floor(Math.random() * 10000),
  } as unknown as ChildProcess;
}

describe('IPCMessageBus', () => {
  it('should extend MessageBus with IPC capabilities', () => {
    const bus = new IPCMessageBus();

    // Should have base MessageBus methods
    expect(bus.send).toBeDefined();
    expect(bus.subscribe).toBeDefined();
    expect(bus.subscribeAll).toBeDefined();
    expect(bus.getHistory).toBeDefined();

    // Should have IPC-specific methods
    expect(bus.registerProcess).toBeDefined();
    expect(bus.deregisterProcess).toBeDefined();
    expect(bus.getRegisteredAgents).toBeDefined();
    expect(bus.isConnected).toBeDefined();

    bus.destroy();
  });

  it('should register and deregister processes', () => {
    const bus = new IPCMessageBus();
    const proc = createMockProcess();

    bus.registerProcess('agent-1', proc);
    expect(bus.getRegisteredAgents()).toContain('agent-1');
    expect(bus.isConnected('agent-1')).toBe(true);

    bus.deregisterProcess('agent-1');
    expect(bus.getRegisteredAgents()).not.toContain('agent-1');
    expect(bus.isConnected('agent-1')).toBe(false);

    bus.destroy();
  });

  it('should forward messages to remote processes', () => {
    const bus = new IPCMessageBus();
    const proc = createMockProcess();

    bus.registerProcess('agent-1', proc);

    bus.send({
      from: 'coordinator',
      to: 'agent-1',
      type: 'request',
      payload: { action: 'start' },
    });

    expect(proc.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent_message',
        payload: expect.objectContaining({ to: 'agent-1' }),
      }),
    );

    bus.destroy();
  });

  it('should broadcast to all remote processes', () => {
    const bus = new IPCMessageBus();
    const proc1 = createMockProcess();
    const proc2 = createMockProcess();

    bus.registerProcess('agent-1', proc1);
    bus.registerProcess('agent-2', proc2);

    bus.send({
      from: 'coordinator',
      to: '*',
      type: 'status',
      payload: { phase: 'executing' },
    });

    expect(proc1.send).toHaveBeenCalled();
    expect(proc2.send).toHaveBeenCalled();

    bus.destroy();
  });

  it('should not forward to sender during broadcast', () => {
    const bus = new IPCMessageBus();
    const proc1 = createMockProcess();
    const proc2 = createMockProcess();

    bus.registerProcess('agent-1', proc1);
    bus.registerProcess('agent-2', proc2);

    bus.send({
      from: 'agent-1',
      to: '*',
      type: 'status',
      payload: {},
    });

    expect(proc1.send).not.toHaveBeenCalled(); // Don't send to self
    expect(proc2.send).toHaveBeenCalled();

    bus.destroy();
  });

  it('should receive messages from child process', () => {
    const bus = new IPCMessageBus();
    const proc = createMockProcess();
    const received: any[] = [];

    bus.subscribe('coordinator', (msg) => received.push(msg));
    bus.registerProcess('agent-1', proc);

    // Simulate message FROM child process
    proc.emit('message', {
      type: 'agent_message',
      payload: {
        from: 'agent-1',
        to: 'coordinator',
        type: 'result',
        payload: { data: 'test result' },
        timestamp: new Date(),
      },
      senderId: 'agent-1',
      timestamp: Date.now(),
      seq: 1,
    });

    expect(received.length).toBe(1);
    expect(received[0].from).toBe('agent-1');

    bus.destroy();
  });

  it('should report IPC stats', () => {
    const bus = new IPCMessageBus();
    const proc = createMockProcess();

    bus.registerProcess('agent-1', proc);

    const stats = bus.getIPCStats();
    expect(stats.registeredProcesses).toBe(1);
    expect(stats.connectedProcesses).toBe(1);
    expect(stats.inFlightMessages).toBe(0);

    bus.destroy();
  });

  it('should handle process exit cleanup', () => {
    const bus = new IPCMessageBus();
    const proc = createMockProcess();

    bus.registerProcess('agent-1', proc);
    expect(bus.isConnected('agent-1')).toBe(true);

    // Simulate process exit
    proc.emit('exit');

    expect(bus.getRegisteredAgents()).not.toContain('agent-1');

    bus.destroy();
  });

  it('should clean up all on destroy', () => {
    const bus = new IPCMessageBus();
    const proc1 = createMockProcess();
    const proc2 = createMockProcess();

    bus.registerProcess('agent-1', proc1);
    bus.registerProcess('agent-2', proc2);

    bus.destroy();

    expect(bus.getRegisteredAgents().length).toBe(0);
  });

  it('should apply backpressure when too many in-flight', () => {
    const bus = new IPCMessageBus({ maxInFlight: 2 });
    const proc = createMockProcess();

    bus.registerProcess('agent-1', proc);

    // Send 3 messages — 3rd should be dropped due to backpressure
    for (let i = 0; i < 3; i++) {
      bus.send({
        from: 'coordinator',
        to: 'agent-1',
        type: 'request',
        payload: { i },
      });
    }

    // First 2 should have been sent, 3rd dropped
    expect(proc.send).toHaveBeenCalledTimes(2);

    bus.destroy();
  });
});
