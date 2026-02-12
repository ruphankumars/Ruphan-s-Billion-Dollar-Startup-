/**
 * IPC Message Bus — Cross-process messaging for agent coordination.
 * Extends the in-memory MessageBus with IPC transport via child_process.
 * Used when agents run in separate processes via AgentPool fork mode.
 */

import type { ChildProcess } from 'child_process';
import type { AgentMessage, MessageType, MessageHandler } from './message-bus.js';
import { MessageBus } from './message-bus.js';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

/** Wire protocol for IPC messages */
export interface IPCEnvelope {
  type: 'agent_message' | 'ack' | 'ping' | 'pong';
  payload: AgentMessage | Record<string, unknown>;
  senderId: string;
  timestamp: number;
  seq: number;
}

export interface IPCBusOptions {
  /** Maximum in-flight messages before backpressure */
  maxInFlight?: number;
  /** Message timeout in ms */
  messageTimeout?: number;
  /** Max history entries */
  maxHistory?: number;
}

/**
 * IPCMessageBus extends the base MessageBus with cross-process transport.
 * Each forked agent registers its ChildProcess handle. Messages to that
 * agent are serialized over the IPC channel; messages from that agent
 * are deserialized and re-emitted on the local bus.
 */
export class IPCMessageBus extends MessageBus {
  private processes = new Map<string, ChildProcess>();
  private processCleanup = new Map<string, () => void>();
  private seqCounter = 0;
  private options: Required<IPCBusOptions>;
  private inFlightCount = 0;
  private pendingAcks = new Map<number, { resolve: () => void; timer: NodeJS.Timeout }>();

  constructor(options: IPCBusOptions = {}) {
    super(options.maxHistory ?? 1000);
    this.options = {
      maxInFlight: options.maxInFlight ?? 100,
      messageTimeout: options.messageTimeout ?? 10000,
      maxHistory: options.maxHistory ?? 1000,
    };
  }

  /**
   * Register a child process as a remote agent endpoint.
   * Messages sent to this agentId will be forwarded over IPC.
   */
  registerProcess(agentId: string, proc: ChildProcess): void {
    if (this.processes.has(agentId)) {
      this.deregisterProcess(agentId);
    }

    this.processes.set(agentId, proc);

    // Listen for messages FROM this process
    const onMessage = (raw: unknown) => {
      try {
        const envelope = raw as IPCEnvelope;
        if (envelope.type === 'agent_message') {
          const msg = envelope.payload as AgentMessage;
          // Re-emit on the local bus so local subscribers see it
          super.send({
            from: msg.from,
            to: msg.to,
            type: msg.type,
            payload: msg.payload,
          });
        } else if (envelope.type === 'ack') {
          const pending = this.pendingAcks.get(envelope.seq);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingAcks.delete(envelope.seq);
            this.inFlightCount--;
            pending.resolve();
          }
        } else if (envelope.type === 'ping') {
          // Respond with pong
          proc.send?.({ type: 'pong', payload: {}, senderId: 'coordinator', timestamp: Date.now(), seq: envelope.seq });
        }
      } catch (err) {
        logger.warn({ agentId, error: err }, 'Failed to parse IPC message');
      }
    };

    const onExit = () => {
      logger.debug({ agentId }, 'Agent process exited, cleaning up IPC');
      this.deregisterProcess(agentId);
    };

    proc.on('message', onMessage);
    proc.once('exit', onExit);

    this.processCleanup.set(agentId, () => {
      proc.off('message', onMessage);
      proc.off('exit', onExit);
    });

    logger.debug({ agentId, pid: proc.pid }, 'Registered IPC process');
  }

  /**
   * Deregister a child process
   */
  deregisterProcess(agentId: string): void {
    const cleanup = this.processCleanup.get(agentId);
    if (cleanup) {
      cleanup();
      this.processCleanup.delete(agentId);
    }
    this.processes.delete(agentId);
  }

  /**
   * Override send to route messages through IPC when target is a registered process
   */
  send(message: Omit<AgentMessage, 'timestamp'>): void {
    // Always emit locally (for local subscribers + history)
    super.send(message);

    // If target is a remote process, forward via IPC
    if (message.to !== '*') {
      const proc = this.processes.get(message.to);
      if (proc && proc.connected) {
        this.sendIPC(proc, message);
      }
    } else {
      // Broadcast: forward to ALL remote processes
      for (const [agentId, proc] of this.processes) {
        if (proc.connected && agentId !== message.from) {
          this.sendIPC(proc, message);
        }
      }
    }
  }

  /**
   * Send message over IPC channel with optional ack tracking
   */
  private sendIPC(proc: ChildProcess, message: Omit<AgentMessage, 'timestamp'>): void {
    if (this.inFlightCount >= this.options.maxInFlight) {
      logger.warn('IPC backpressure: too many in-flight messages');
      return;
    }

    const seq = ++this.seqCounter;
    const envelope: IPCEnvelope = {
      type: 'agent_message',
      payload: { ...message, timestamp: new Date() } as AgentMessage,
      senderId: 'coordinator',
      timestamp: Date.now(),
      seq,
    };

    try {
      proc.send?.(envelope);
      this.inFlightCount++;

      // Set timeout for ack
      const timer = setTimeout(() => {
        this.pendingAcks.delete(seq);
        this.inFlightCount--;
        logger.warn({ seq }, 'IPC message ack timeout');
      }, this.options.messageTimeout);

      this.pendingAcks.set(seq, {
        resolve: () => {},
        timer,
      });
    } catch (err) {
      logger.warn({ error: err }, 'Failed to send IPC message');
    }
  }

  /**
   * Get list of registered remote agents
   */
  getRegisteredAgents(): string[] {
    return Array.from(this.processes.keys());
  }

  /**
   * Check if an agent is registered and connected
   */
  isConnected(agentId: string): boolean {
    const proc = this.processes.get(agentId);
    return !!proc && proc.connected;
  }

  /**
   * Get stats about the IPC bus
   */
  getIPCStats(): {
    registeredProcesses: number;
    connectedProcesses: number;
    inFlightMessages: number;
    totalSequence: number;
  } {
    let connected = 0;
    for (const proc of this.processes.values()) {
      if (proc.connected) connected++;
    }

    return {
      registeredProcesses: this.processes.size,
      connectedProcesses: connected,
      inFlightMessages: this.inFlightCount,
      totalSequence: this.seqCounter,
    };
  }

  /**
   * Destroy the IPC bus and clean up all processes
   */
  override destroy(): void {
    // Clear all pending acks
    for (const [, pending] of this.pendingAcks) {
      clearTimeout(pending.timer);
    }
    this.pendingAcks.clear();

    // Deregister all processes
    for (const agentId of [...this.processes.keys()]) {
      this.deregisterProcess(agentId);
    }

    super.destroy();
  }
}
