/**
 * CapabilityExpander — Capability Gap Analysis
 *
 * Records task failures, analyzes patterns in failure reasons,
 * and suggests new capabilities to address recurring gaps.
 * Groups failures by similarity and ranks suggestions by frequency.
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { CapabilityGap } from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface ExpanderConfig {
  /** Maximum gaps to retain */
  maxGaps: number;
  /** Minimum occurrences before a suggestion is surfaced */
  minOccurrences: number;
  /** Similarity threshold for grouping failure reasons (0-1) */
  similarityThreshold: number;
}

interface CapabilitySuggestion {
  /** The suggested capability name */
  capability: string;
  /** How many failures would be addressed */
  frequency: number;
  /** Average confidence across related gaps */
  avgConfidence: number;
  /** Representative failure reasons */
  reasons: string[];
  /** IDs of related gaps */
  gapIds: string[];
}

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: ExpanderConfig = {
  maxGaps: 500,
  minOccurrences: 2,
  similarityThreshold: 0.4,
};

// ═══════════════════════════════════════════════════════════════
// CAPABILITY EXPANDER
// ═══════════════════════════════════════════════════════════════

export class CapabilityExpander extends EventEmitter {
  private config: ExpanderConfig;
  private gaps: Map<string, CapabilityGap> = new Map();
  private running = false;

  constructor(config?: Partial<ExpanderConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('self-improve:expander:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('self-improve:expander:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Record a task failure as a capability gap.
   * Automatically generates a suggested capability based on the failure reason.
   */
  recordFailure(taskDescription: string, failureReason: string): CapabilityGap {
    const gap: CapabilityGap = {
      id: `gap_${randomUUID().slice(0, 8)}`,
      taskDescription,
      failureReason,
      suggestedCapability: this.inferCapability(failureReason),
      confidence: this.estimateConfidence(failureReason),
      detectedAt: Date.now(),
    };

    this.gaps.set(gap.id, gap);

    // Enforce max gaps
    if (this.gaps.size > this.config.maxGaps) {
      const oldest = [...this.gaps.entries()]
        .sort(([, a], [, b]) => a.detectedAt - b.detectedAt);
      const toRemove = oldest.slice(0, this.gaps.size - this.config.maxGaps);
      for (const [id] of toRemove) {
        this.gaps.delete(id);
      }
    }

    this.emit('self-improve:gap:recorded', {
      timestamp: Date.now(),
      gap,
    });

    return gap;
  }

  /**
   * Analyze all recorded gaps and group them by failure reason similarity.
   * Returns groups of similar gaps.
   */
  analyzeGaps(): Map<string, CapabilityGap[]> {
    const groups = new Map<string, CapabilityGap[]>();
    const assigned = new Set<string>();
    const gapList = [...this.gaps.values()];

    for (const gap of gapList) {
      if (assigned.has(gap.id)) continue;

      // Find a matching group or create a new one
      let foundGroup = false;
      for (const [groupKey, members] of groups) {
        // Compare against the first member's failure reason
        const similarity = this.computeSimilarity(
          gap.failureReason,
          members[0].failureReason,
        );
        if (similarity >= this.config.similarityThreshold) {
          members.push(gap);
          assigned.add(gap.id);
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        const groupKey = gap.suggestedCapability;
        groups.set(groupKey, [gap]);
        assigned.add(gap.id);
      }
    }

    return groups;
  }

  /**
   * Get capability expansion suggestions sorted by frequency (descending).
   * Only includes suggestions that meet the minimum occurrence threshold.
   */
  getSuggestions(): CapabilitySuggestion[] {
    const groupedGaps = this.analyzeGaps();
    const suggestions: CapabilitySuggestion[] = [];

    for (const [capability, gaps] of groupedGaps) {
      if (gaps.length < this.config.minOccurrences) continue;

      const avgConfidence = gaps.reduce((sum, g) => sum + g.confidence, 0) / gaps.length;
      const uniqueReasons = [...new Set(gaps.map((g) => g.failureReason))];

      suggestions.push({
        capability,
        frequency: gaps.length,
        avgConfidence,
        reasons: uniqueReasons.slice(0, 5), // Top 5 unique reasons
        gapIds: gaps.map((g) => g.id),
      });
    }

    // Sort by frequency descending, then by confidence descending
    suggestions.sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return b.avgConfidence - a.avgConfidence;
    });

    return suggestions;
  }

  /**
   * Get all recorded capability gaps, newest first.
   */
  getGaps(): CapabilityGap[] {
    return [...this.gaps.values()]
      .sort((a, b) => b.detectedAt - a.detectedAt);
  }

  /**
   * Remove a gap record by ID.
   */
  clearGap(id: string): boolean {
    const deleted = this.gaps.delete(id);
    if (deleted) {
      this.emit('self-improve:gap:cleared', {
        timestamp: Date.now(),
        gapId: id,
      });
    }
    return deleted;
  }

  /**
   * Get statistics.
   */
  getStats(): {
    totalGaps: number;
    uniqueCapabilities: number;
    suggestions: number;
  } {
    const suggestions = this.getSuggestions();
    const uniqueCapabilities = new Set(
      [...this.gaps.values()].map((g) => g.suggestedCapability),
    );

    return {
      totalGaps: this.gaps.size,
      uniqueCapabilities: uniqueCapabilities.size,
      suggestions: suggestions.length,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Capability inference
  // ─────────────────────────────────────────────────────────

  /**
   * Infer a suggested capability from the failure reason.
   * Uses keyword-based heuristics to map failure patterns to capabilities.
   */
  private inferCapability(failureReason: string): string {
    const lower = failureReason.toLowerCase();

    // Map common failure patterns to capabilities
    const patterns: Array<{ keywords: string[]; capability: string }> = [
      { keywords: ['timeout', 'timed out', 'deadline'], capability: 'async-execution' },
      { keywords: ['permission', 'access denied', 'unauthorized', 'forbidden'], capability: 'auth-handling' },
      { keywords: ['parse', 'syntax', 'invalid format', 'malformed'], capability: 'format-parsing' },
      { keywords: ['network', 'connection', 'socket', 'dns'], capability: 'network-resilience' },
      { keywords: ['memory', 'heap', 'out of memory', 'oom'], capability: 'memory-management' },
      { keywords: ['file', 'filesystem', 'directory', 'path'], capability: 'file-operations' },
      { keywords: ['database', 'query', 'sql', 'transaction'], capability: 'database-operations' },
      { keywords: ['api', 'endpoint', 'rest', 'graphql'], capability: 'api-integration' },
      { keywords: ['type', 'typescript', 'type error', 'interface'], capability: 'type-safety' },
      { keywords: ['test', 'assert', 'expect', 'spec'], capability: 'test-generation' },
      { keywords: ['deploy', 'build', 'compile', 'bundle'], capability: 'build-pipeline' },
      { keywords: ['concurrency', 'race condition', 'deadlock', 'mutex'], capability: 'concurrency-handling' },
      { keywords: ['encoding', 'charset', 'unicode', 'utf'], capability: 'encoding-handling' },
      { keywords: ['cache', 'stale', 'invalidat'], capability: 'cache-management' },
      { keywords: ['rate limit', 'throttl', 'too many requests'], capability: 'rate-limiting' },
    ];

    for (const { keywords, capability } of patterns) {
      if (keywords.some((kw) => lower.includes(kw))) {
        return capability;
      }
    }

    // Fallback: extract key noun phrases
    const words = failureReason.split(/\s+/).filter((w) => w.length > 3);
    if (words.length > 0) {
      return `handle-${words[0].toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    }

    return 'unknown-capability';
  }

  /**
   * Estimate confidence in the capability suggestion based on
   * how specific the failure reason is.
   */
  private estimateConfidence(failureReason: string): number {
    const lower = failureReason.toLowerCase();
    let confidence = 0.3; // Base confidence

    // More specific failure reasons get higher confidence
    if (failureReason.length > 50) confidence += 0.1;
    if (failureReason.length > 100) confidence += 0.1;

    // Error codes and specific terms increase confidence
    if (/\b(error|exception|failed|unable)\b/i.test(lower)) confidence += 0.1;
    if (/\b[A-Z_]{3,}\b/.test(failureReason)) confidence += 0.1; // Error codes
    if (/\b\d{3}\b/.test(failureReason)) confidence += 0.05; // HTTP status codes

    return Math.min(1, confidence);
  }

  /**
   * Compute similarity between two strings using word overlap (Jaccard index).
   */
  private computeSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 2));

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }

    const union = new Set([...wordsA, ...wordsB]).size;
    return intersection / union;
  }
}
