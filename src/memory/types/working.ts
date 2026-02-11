/**
 * Working Memory — Current session state
 * Short-term memory that persists only during execution.
 * Tracks goals, context, recent actions, and scratchpad data.
 */

import type { WorkingMemoryState } from '../types.js';
import { nanoid } from 'nanoid';

export class WorkingMemory {
  private state: WorkingMemoryState;
  private readonly maxContextItems: number;
  private readonly maxRecentActions: number;

  constructor(
    goal: string,
    options: { maxContextItems?: number; maxRecentActions?: number } = {},
  ) {
    this.maxContextItems = options.maxContextItems ?? 50;
    this.maxRecentActions = options.maxRecentActions ?? 100;
    this.state = {
      sessionId: nanoid(),
      goal,
      context: [],
      recentActions: [],
      activeEntities: [],
      scratchpad: {},
    };
  }

  get sessionId(): string {
    return this.state.sessionId;
  }

  get goal(): string {
    return this.state.goal;
  }

  /**
   * Add context information to working memory
   */
  addContext(context: string): void {
    this.state.context.push(context);
    // Keep only the most recent items
    if (this.state.context.length > this.maxContextItems) {
      this.state.context = this.state.context.slice(-this.maxContextItems);
    }
  }

  /**
   * Record an action taken during this session
   */
  recordAction(action: string): void {
    this.state.recentActions.push(action);
    if (this.state.recentActions.length > this.maxRecentActions) {
      this.state.recentActions = this.state.recentActions.slice(-this.maxRecentActions);
    }
  }

  /**
   * Track active entities being referenced
   */
  trackEntity(entity: string): void {
    if (!this.state.activeEntities.includes(entity)) {
      this.state.activeEntities.push(entity);
    }
  }

  /**
   * Remove entity from active tracking
   */
  untrackEntity(entity: string): void {
    this.state.activeEntities = this.state.activeEntities.filter(e => e !== entity);
  }

  /**
   * Store arbitrary data in scratchpad
   */
  setScratchpad(key: string, value: unknown): void {
    this.state.scratchpad[key] = value;
  }

  /**
   * Get data from scratchpad
   */
  getScratchpad<T = unknown>(key: string): T | undefined {
    return this.state.scratchpad[key] as T | undefined;
  }

  /**
   * Get full working memory state for injection into prompts
   */
  getState(): WorkingMemoryState {
    return { ...this.state };
  }

  /**
   * Serialize working memory to string for prompt injection
   */
  serialize(): string {
    const parts: string[] = [];

    parts.push(`## Current Goal\n${this.state.goal}`);

    if (this.state.context.length > 0) {
      parts.push(`## Context\n${this.state.context.slice(-10).join('\n')}`);
    }

    if (this.state.recentActions.length > 0) {
      parts.push(`## Recent Actions\n${this.state.recentActions.slice(-5).join('\n')}`);
    }

    if (this.state.activeEntities.length > 0) {
      parts.push(`## Active Entities\n${this.state.activeEntities.join(', ')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Clear working memory
   */
  clear(): void {
    this.state.context = [];
    this.state.recentActions = [];
    this.state.activeEntities = [];
    this.state.scratchpad = {};
  }
}
