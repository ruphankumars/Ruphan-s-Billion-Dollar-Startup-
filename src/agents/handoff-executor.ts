/**
 * Handoff Executor — Asynchronous task handoff dispatch.
 * Watches the HandoffManager for pending handoffs and dispatches
 * them to the appropriate agent role via the coordinator.
 */

import type { AgentRoleName, AgentTask } from './types.js';
import type { AgentResult } from '../core/types.js';
import type { LLMProvider } from '../providers/types.js';
import type { Tool, ToolContext } from '../tools/types.js';
import { Agent } from './agent.js';
import { getRole } from './roles/index.js';
import { HandoffManager, type HandoffRequest } from './handoff.js';
import { MessageBus, type AgentMessage } from './message-bus.js';
import { getLogger } from '../core/logger.js';
import { nanoid } from 'nanoid';

const logger = getLogger();

export interface HandoffExecutorOptions {
  provider: LLMProvider;
  tools: Tool[];
  toolContext: ToolContext;
  messageBus: MessageBus;
  handoffManager: HandoffManager;
  maxConcurrentHandoffs?: number;
  maxIterations?: number;
}

interface ActiveHandoff {
  id: string;
  request: HandoffRequest;
  startedAt: number;
  promise: Promise<AgentResult>;
}

/**
 * HandoffExecutor processes queued handoffs asynchronously.
 * It listens for handoff messages on the bus and spawns new agents
 * to handle the delegated work.
 */
export class HandoffExecutor {
  private provider: LLMProvider;
  private tools: Tool[];
  private toolContext: ToolContext;
  private messageBus: MessageBus;
  private handoffManager: HandoffManager;
  private maxConcurrent: number;
  private maxIterations: number;
  private active = new Map<string, ActiveHandoff>();
  private completed: Array<{ id: string; result: AgentResult; duration: number }> = [];
  private unsubscribe: (() => void) | null = null;
  private running = false;

  constructor(options: HandoffExecutorOptions) {
    this.provider = options.provider;
    this.tools = options.tools;
    this.toolContext = options.toolContext;
    this.messageBus = options.messageBus;
    this.handoffManager = options.handoffManager;
    this.maxConcurrent = options.maxConcurrentHandoffs ?? 3;
    this.maxIterations = options.maxIterations ?? 15;
  }

  /**
   * Start listening for handoff messages
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.unsubscribe = this.messageBus.subscribeAll(async (message: AgentMessage) => {
      if (message.type === 'handoff') {
        await this.processHandoff(message);
      }
    });

    logger.info('HandoffExecutor started');
  }

  /**
   * Stop listening and wait for active handoffs to complete
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    // Wait for all active handoffs
    const promises = Array.from(this.active.values()).map(h => h.promise);
    if (promises.length > 0) {
      logger.info({ count: promises.length }, 'Waiting for active handoffs to complete');
      await Promise.allSettled(promises);
    }

    logger.info('HandoffExecutor stopped');
  }

  /**
   * Process a handoff message
   */
  private async processHandoff(message: AgentMessage): Promise<void> {
    const payload = message.payload as {
      handoffId: string;
      toRole: AgentRoleName;
      task: AgentTask;
      reason: string;
      context: string;
    };

    if (this.active.size >= this.maxConcurrent) {
      logger.warn({ handoffId: payload.handoffId }, 'Handoff queue full, deferring');
      return;
    }

    const handoffId = payload.handoffId;

    logger.info(
      { handoffId, toRole: payload.toRole, from: message.from },
      'Dispatching handoff',
    );

    const promise = this.executeHandoff(handoffId, payload);

    this.active.set(handoffId, {
      id: handoffId,
      request: {
        fromAgent: message.from,
        fromRole: 'developer', // Default; real implementation tracks sender role
        toRole: payload.toRole,
        task: payload.task,
        reason: payload.reason,
        context: payload.context,
      },
      startedAt: Date.now(),
      promise,
    });

    // Await and clean up
    try {
      const result = await promise;
      const duration = Date.now() - (this.active.get(handoffId)?.startedAt || Date.now());
      this.completed.push({ id: handoffId, result, duration });
      this.handoffManager.completeHandoff(handoffId, result);

      // Notify the original agent
      this.messageBus.send({
        from: `handoff-${handoffId}`,
        to: message.from,
        type: 'result',
        payload: { handoffId, result },
      });
    } catch (err) {
      logger.error({ handoffId, error: err }, 'Handoff execution failed');
      this.messageBus.send({
        from: `handoff-${handoffId}`,
        to: message.from,
        type: 'error',
        payload: { handoffId, error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      this.active.delete(handoffId);
    }
  }

  /**
   * Execute a handoff by creating a new agent for the target role
   */
  private async executeHandoff(
    handoffId: string,
    payload: { toRole: AgentRoleName; task: AgentTask; context: string },
  ): Promise<AgentResult> {
    let role;
    try {
      role = getRole(payload.toRole);
    } catch {
      role = getRole('developer');
    }

    const toolNames = role.defaultTools ?? [];
    const tools = toolNames
      .map(name => this.tools.find(t => t.name === name))
      .filter((t): t is Tool => !!t);

    const agent = new Agent({
      role: payload.toRole,
      provider: this.provider,
      tools,
      toolContext: this.toolContext,
      maxIterations: this.maxIterations,
      systemPrompt: `You are handling a delegated task (handoff). Context: ${payload.context}`,
    });

    return agent.execute(payload.task);
  }

  /**
   * Get current executor stats
   */
  getStats(): {
    activeHandoffs: number;
    completedHandoffs: number;
    maxConcurrent: number;
    avgDuration: number;
  } {
    const avgDuration = this.completed.length > 0
      ? this.completed.reduce((sum, h) => sum + h.duration, 0) / this.completed.length
      : 0;

    return {
      activeHandoffs: this.active.size,
      completedHandoffs: this.completed.length,
      maxConcurrent: this.maxConcurrent,
      avgDuration: Math.round(avgDuration),
    };
  }

  /**
   * Get completed handoff results
   */
  getCompleted(): Array<{ id: string; result: AgentResult; duration: number }> {
    return [...this.completed];
  }
}
