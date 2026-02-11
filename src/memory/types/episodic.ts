/**
 * Episodic Memory — Events and interactions
 * Remembers what happened: tasks executed, outcomes, errors encountered.
 * Used for learning from experience and avoiding repeated mistakes.
 */

import type { EpisodicMemoryEntry, MemoryMetadata } from '../types.js';
import { nanoid } from 'nanoid';

export interface EpisodicEvent {
  event: string;
  details: string;
  outcome: 'success' | 'failure' | 'partial';
  duration?: number;
  cost?: number;
  tags?: string[];
  entities?: string[];
  project?: string;
}

export class EpisodicMemoryBuilder {
  /**
   * Create an episodic memory entry from an event
   */
  static fromEvent(event: EpisodicEvent): EpisodicMemoryEntry {
    const now = new Date();

    const metadata: MemoryMetadata = {
      source: 'execution',
      project: event.project,
      tags: event.tags ?? [],
      entities: event.entities ?? [],
      relations: [],
      confidence: event.outcome === 'success' ? 0.9 : 0.7,
    };

    // Build descriptive content
    const content = this.buildContent(event);

    // Calculate importance based on outcome and duration
    const importance = this.calculateImportance(event);

    return {
      id: nanoid(),
      type: 'episodic',
      content,
      metadata,
      createdAt: now,
      updatedAt: now,
      accessedAt: now,
      accessCount: 0,
      importance,
      decayFactor: 1.0,
      event: event.event,
      outcome: event.outcome,
      duration: event.duration,
      cost: event.cost,
    };
  }

  /**
   * Build descriptive content for the memory
   */
  private static buildContent(event: EpisodicEvent): string {
    const parts: string[] = [];

    parts.push(`Event: ${event.event}`);
    parts.push(`Outcome: ${event.outcome}`);
    parts.push(`Details: ${event.details}`);

    if (event.duration) {
      parts.push(`Duration: ${(event.duration / 1000).toFixed(1)}s`);
    }

    if (event.cost) {
      parts.push(`Cost: $${event.cost.toFixed(4)}`);
    }

    return parts.join('\n');
  }

  /**
   * Calculate importance score for an episodic memory
   * Failures and expensive operations are more important to remember
   */
  private static calculateImportance(event: EpisodicEvent): number {
    let importance = 0.5;

    // Failures are more important (learn from mistakes)
    if (event.outcome === 'failure') importance += 0.3;
    if (event.outcome === 'partial') importance += 0.15;

    // Expensive operations are important to remember
    if (event.cost && event.cost > 0.1) importance += 0.1;
    if (event.cost && event.cost > 1.0) importance += 0.1;

    // Long-running operations
    if (event.duration && event.duration > 30000) importance += 0.05;

    return Math.min(1.0, importance);
  }

  /**
   * Summarize multiple related episodic memories
   */
  static summarize(entries: EpisodicMemoryEntry[]): string {
    const successCount = entries.filter(e => e.outcome === 'success').length;
    const failCount = entries.filter(e => e.outcome === 'failure').length;
    const totalCost = entries.reduce((sum, e) => sum + (e.cost ?? 0), 0);

    return [
      `${entries.length} events recorded`,
      `Success: ${successCount}, Failure: ${failCount}`,
      `Total cost: $${totalCost.toFixed(4)}`,
    ].join(' | ');
  }
}
