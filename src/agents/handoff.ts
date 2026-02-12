/**
 * Agent Handoff Manager
 * Manages task handoffs between agents when one agent needs
 * to delegate work to a different specialist.
 */

import type { AgentRoleName, AgentTask } from './types.js';
import type { AgentResult } from '../core/types.js';
import { MessageBus } from './message-bus.js';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

export interface HandoffRequest {
  fromAgent: string;
  fromRole: AgentRoleName;
  toRole: AgentRoleName;
  task: AgentTask;
  reason: string;
  context: string;
}

export interface HandoffResult {
  accepted: boolean;
  result?: AgentResult;
  reason?: string;
}

export class HandoffManager {
  private messageBus: MessageBus;
  private pendingHandoffs: Map<string, HandoffRequest> = new Map();

  constructor(messageBus: MessageBus) {
    this.messageBus = messageBus;
  }

  /**
   * Request a handoff to another agent role
   */
  async requestHandoff(request: HandoffRequest): Promise<HandoffResult> {
    logger.info(
      { from: request.fromRole, to: request.toRole, reason: request.reason },
      'Handoff requested',
    );

    const handoffId = `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.pendingHandoffs.set(handoffId, request);

    // Notify via message bus
    this.messageBus.send({
      from: request.fromAgent,
      to: '*',
      type: 'handoff',
      payload: {
        handoffId,
        toRole: request.toRole,
        task: request.task,
        reason: request.reason,
        context: request.context,
      },
    });

    // Handoff is broadcast on the bus; HandoffExecutor picks it up asynchronously
    return {
      accepted: true,
      reason: 'Handoff queued for coordinator processing',
    };
  }

  /**
   * Get pending handoffs for a specific role
   */
  getPendingForRole(role: AgentRoleName): HandoffRequest[] {
    return Array.from(this.pendingHandoffs.values())
      .filter(h => h.toRole === role);
  }

  /**
   * Complete a handoff
   */
  completeHandoff(handoffId: string, result: AgentResult): void {
    const request = this.pendingHandoffs.get(handoffId);
    if (request) {
      logger.info(
        { handoffId, from: request.fromRole, to: request.toRole, success: result.success },
        'Handoff completed',
      );
      this.pendingHandoffs.delete(handoffId);
    }
  }

  /**
   * Get all pending handoffs
   */
  getAllPending(): HandoffRequest[] {
    return Array.from(this.pendingHandoffs.values());
  }

  /**
   * Clear all pending handoffs
   */
  clear(): void {
    this.pendingHandoffs.clear();
  }
}
