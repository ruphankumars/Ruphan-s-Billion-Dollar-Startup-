/**
 * Agent Message Bus
 * Enables inter-agent communication for handoffs and status updates.
 * Simple in-memory pub/sub. Extended by IPCMessageBus for cross-process transport.
 */

import { EventEmitter } from 'events';

export interface AgentMessage {
  from: string;      // Source agent/task ID
  to: string;        // Target agent/task ID or '*' for broadcast
  type: MessageType;
  payload: unknown;
  timestamp: Date;
}

export type MessageType =
  | 'handoff'        // Hand off task to another agent
  | 'handoff:dropped' // Handoff rejected due to capacity
  | 'status'         // Status update
  | 'result'         // Partial result
  | 'request'        // Request information
  | 'response'       // Response to request
  | 'error'          // Error notification
  | 'cancel';        // Cancel task

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

export class MessageBus {
  private emitter = new EventEmitter();
  private history: AgentMessage[] = [];
  private maxHistory: number;

  constructor(maxHistory = 1000) {
    this.maxHistory = maxHistory;
    this.emitter.setMaxListeners(50);
  }

  /**
   * Send a message to a specific agent or broadcast
   */
  send(message: Omit<AgentMessage, 'timestamp'>): void {
    const fullMessage: AgentMessage = {
      ...message,
      timestamp: new Date(),
    };

    this.history.push(fullMessage);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    // Emit to specific target
    this.emitter.emit(`agent:${message.to}`, fullMessage);

    // Emit to broadcast listeners
    if (message.to !== '*') {
      this.emitter.emit('agent:*', fullMessage);
    }
  }

  /**
   * Subscribe to messages for a specific agent
   */
  subscribe(agentId: string, handler: MessageHandler): () => void {
    this.emitter.on(`agent:${agentId}`, handler);

    // Return unsubscribe function
    return () => {
      this.emitter.off(`agent:${agentId}`, handler);
    };
  }

  /**
   * Subscribe to all messages (broadcast)
   */
  subscribeAll(handler: MessageHandler): () => void {
    this.emitter.on('agent:*', handler);
    return () => {
      this.emitter.off('agent:*', handler);
    };
  }

  /**
   * Get message history
   */
  getHistory(filter?: { from?: string; to?: string; type?: MessageType }): AgentMessage[] {
    return this.history.filter(msg => {
      if (filter?.from && msg.from !== filter.from) return false;
      if (filter?.to && msg.to !== filter.to) return false;
      if (filter?.type && msg.type !== filter.type) return false;
      return true;
    });
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Destroy the message bus
   */
  destroy(): void {
    this.emitter.removeAllListeners();
    this.history = [];
  }
}
