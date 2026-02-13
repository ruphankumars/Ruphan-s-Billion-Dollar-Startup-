/**
 * Event Trigger Manager
 *
 * Subscribes to CortexOS EventBus events and triggers skill
 * execution when conditions are met.
 */

import { randomUUID } from 'node:crypto';
import type { EventTriggerConfig } from './types.js';

export type EventHandler = (config: EventTriggerConfig, eventData: unknown) => void | Promise<void>;

export interface EventBusLike {
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
}

export class EventTriggerManager {
  private triggers: Map<string, EventTriggerConfig> = new Map();
  private listeners: Map<string, (...args: any[]) => void> = new Map();
  private eventBus: EventBusLike | null = null;
  private handler: EventHandler | null = null;

  constructor(eventBus?: EventBusLike) {
    if (eventBus) {
      this.eventBus = eventBus;
    }
  }

  /** Set the event bus to subscribe to */
  setEventBus(bus: EventBusLike): void {
    // Remove old listeners
    this.removeAllListeners();
    this.eventBus = bus;
    // Re-register all triggers
    for (const trigger of this.triggers.values()) {
      if (trigger.enabled) {
        this.attachListener(trigger);
      }
    }
  }

  /** Set the handler called when a trigger fires */
  onTrigger(handler: EventHandler): void {
    this.handler = handler;
  }

  /** Add a new event trigger */
  addTrigger(skillId: string, eventType: string, options?: {
    condition?: string;
    inputs?: Record<string, unknown>;
    enabled?: boolean;
  }): EventTriggerConfig {
    const config: EventTriggerConfig = {
      id: `evt_${randomUUID().slice(0, 8)}`,
      skillId,
      eventType,
      condition: options?.condition,
      inputs: options?.inputs,
      enabled: options?.enabled ?? true,
      createdAt: Date.now(),
    };

    this.triggers.set(config.id, config);

    if (config.enabled && this.eventBus) {
      this.attachListener(config);
    }

    return config;
  }

  /** Remove a trigger */
  removeTrigger(id: string): boolean {
    const config = this.triggers.get(id);
    if (!config) return false;

    this.detachListener(config);
    return this.triggers.delete(id);
  }

  /** Enable/disable a trigger */
  setEnabled(id: string, enabled: boolean): void {
    const config = this.triggers.get(id);
    if (!config) throw new Error(`Trigger "${id}" not found`);

    config.enabled = enabled;

    if (enabled && this.eventBus) {
      this.attachListener(config);
    } else {
      this.detachListener(config);
    }
  }

  /** Get all triggers */
  getTriggers(): EventTriggerConfig[] {
    return Array.from(this.triggers.values());
  }

  /** Shut down — remove all listeners */
  shutdown(): void {
    this.removeAllListeners();
    this.triggers.clear();
  }

  // ─── Internal ─────────────────────────────────────────────

  private attachListener(config: EventTriggerConfig): void {
    if (!this.eventBus) return;

    const listener = (...args: any[]) => {
      this.handleEvent(config, args[0]);
    };

    this.listeners.set(config.id, listener);
    this.eventBus.on(config.eventType, listener);
  }

  private detachListener(config: EventTriggerConfig): void {
    if (!this.eventBus) return;

    const listener = this.listeners.get(config.id);
    if (listener) {
      this.eventBus.off(config.eventType, listener);
      this.listeners.delete(config.id);
    }
  }

  private removeAllListeners(): void {
    if (!this.eventBus) return;

    for (const [triggerId, listener] of this.listeners) {
      const config = this.triggers.get(triggerId);
      if (config) {
        this.eventBus.off(config.eventType, listener);
      }
    }
    this.listeners.clear();
  }

  private handleEvent(config: EventTriggerConfig, eventData: unknown): void {
    if (!config.enabled) return;

    // Evaluate condition if present
    if (config.condition) {
      try {
        const fn = new Function('event', `return ${config.condition}`);
        if (!fn(eventData)) return;
      } catch {
        return; // Condition evaluation failed — skip
      }
    }

    if (this.handler) {
      try {
        const result = this.handler(config, eventData);
        if (result instanceof Promise) {
          result.catch(() => {});
        }
      } catch {
        // Handler errors are non-fatal
      }
    }
  }
}
