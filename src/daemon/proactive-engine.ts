/**
 * ProactiveEngine — Proactive Agent Daemon
 *
 * Continuously monitors context patterns, learns from repeated sequences,
 * and proactively predicts what the user or system might need next.
 * Uses frequency analysis on recorded context events to detect repeating
 * patterns and generates predictions with confidence scores.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ContextPattern {
  id: string;
  pattern: string;
  triggerCount: number;
  lastTriggered: number;
  confidence: number;
  action: string;
}

export interface PredictedNeed {
  id: string;
  description: string;
  confidence: number;
  suggestedAction: string;
  context: Record<string, unknown>;
  predictedAt: number;
}

export interface ProactiveRule {
  id: string;
  name: string;
  condition: string;
  action: string;
  priority: number;
  enabled: boolean;
  triggerCount: number;
}

export interface ProactiveConfig {
  enabled: boolean;
  analysisIntervalMs: number;
  minConfidence: number;
  maxPredictions: number;
  learningEnabled: boolean;
}

export interface ProactiveStats {
  totalPatterns: number;
  totalPredictions: number;
  totalActionsTriggered: number;
  avgConfidence: number;
  activeRules: number;
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL TYPES
// ═══════════════════════════════════════════════════════════════

/** A single recorded context snapshot for pattern learning */
interface ContextRecord {
  keys: string[];
  values: Record<string, unknown>;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: true,
  analysisIntervalMs: 30000,
  minConfidence: 0.5,
  maxPredictions: 20,
  learningEnabled: true,
};

/** Maximum context records to retain for analysis */
const MAX_CONTEXT_RECORDS = 1000;

/** Minimum occurrences before a sequence is considered a pattern */
const MIN_PATTERN_OCCURRENCES = 2;

// ═══════════════════════════════════════════════════════════════
// PROACTIVE ENGINE
// ═══════════════════════════════════════════════════════════════

export class ProactiveEngine extends EventEmitter {
  private config: ProactiveConfig;
  private running = false;
  private analysisTimer: ReturnType<typeof setInterval> | null = null;

  /** Recorded context snapshots for pattern detection */
  private contextHistory: ContextRecord[] = [];

  /** Detected patterns keyed by ID */
  private patterns: Map<string, ContextPattern> = new Map();

  /** Current predictions keyed by ID */
  private predictions: Map<string, PredictedNeed> = new Map();

  /** User-defined proactive rules keyed by ID */
  private rules: Map<string, ProactiveRule> = new Map();

  /** Tracks how many actions have been triggered */
  private actionsTriggeredCount = 0;

  /** Bigram frequency table: "keyA->keyB" => count */
  private bigramCounts: Map<string, number> = new Map();

  /** Total bigram observations (for confidence normalization) */
  private totalBigramObservations = 0;

  constructor(config?: Partial<ProactiveConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  /**
   * Start the proactive engine. Begins periodic pattern analysis.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    if (this.config.learningEnabled) {
      this.analysisTimer = setInterval(() => {
        this.analyzePatterns();
        this.predictNeeds();
      }, this.config.analysisIntervalMs);
    }

    this.emit('proactive:started', { timestamp: Date.now() });
  }

  /**
   * Stop the proactive engine. Clears the analysis timer.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }

    this.emit('proactive:stopped', { timestamp: Date.now() });
  }

  /**
   * Whether the engine is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // RULES
  // ─────────────────────────────────────────────────────────

  /**
   * Add a proactive rule that maps a condition to an action.
   */
  addRule(rule: Omit<ProactiveRule, 'id' | 'triggerCount'>): ProactiveRule {
    const newRule: ProactiveRule = {
      ...rule,
      id: `rule-${randomUUID().slice(0, 8)}`,
      triggerCount: 0,
    };

    this.rules.set(newRule.id, newRule);
    this.emit('proactive:rule:added', { rule: newRule, timestamp: Date.now() });
    return newRule;
  }

  /**
   * Remove a proactive rule by ID.
   */
  removeRule(id: string): boolean {
    const existed = this.rules.delete(id);
    if (existed) {
      this.emit('proactive:rule:removed', { id, timestamp: Date.now() });
    }
    return existed;
  }

  /**
   * Get all registered rules.
   */
  getRules(): ProactiveRule[] {
    return [...this.rules.values()];
  }

  // ─────────────────────────────────────────────────────────
  // CONTEXT RECORDING
  // ─────────────────────────────────────────────────────────

  /**
   * Record a context snapshot for pattern learning.
   * Context is a key-value map describing the current state or action
   * (e.g., { action: 'file-edit', file: 'main.ts' }).
   */
  recordContext(context: Record<string, unknown>): void {
    const keys = Object.keys(context).sort();
    const record: ContextRecord = {
      keys,
      values: { ...context },
      timestamp: Date.now(),
    };

    this.contextHistory.push(record);

    // Enforce bounded history
    if (this.contextHistory.length > MAX_CONTEXT_RECORDS) {
      this.contextHistory.splice(0, this.contextHistory.length - MAX_CONTEXT_RECORDS);
    }

    // Update bigram counts using the "action" key as the primary signal
    if (this.config.learningEnabled && this.contextHistory.length >= 2) {
      const prev = this.contextHistory[this.contextHistory.length - 2];
      const prevAction = this.extractActionKey(prev);
      const currAction = this.extractActionKey(record);

      if (prevAction && currAction) {
        const bigram = `${prevAction}->${currAction}`;
        this.bigramCounts.set(bigram, (this.bigramCounts.get(bigram) ?? 0) + 1);
        this.totalBigramObservations++;
      }
    }

    // Evaluate rules against the new context
    this.evaluateRules(context);

    this.emit('proactive:context:recorded', { context, timestamp: Date.now() });
  }

  // ─────────────────────────────────────────────────────────
  // PATTERN ANALYSIS
  // ─────────────────────────────────────────────────────────

  /**
   * Analyze recorded contexts for repeating patterns using bigram frequency.
   * Returns detected patterns sorted by confidence descending.
   */
  analyzePatterns(): ContextPattern[] {
    const now = Date.now();
    const detectedPatterns: ContextPattern[] = [];

    // Convert bigram frequency table into patterns
    for (const [bigram, count] of this.bigramCounts.entries()) {
      if (count < MIN_PATTERN_OCCURRENCES) continue;

      const confidence = Math.min(count / Math.max(this.totalBigramObservations, 1), 1.0);
      if (confidence < this.config.minConfidence) continue;

      const [trigger, action] = bigram.split('->');
      const existingPattern = this.findPatternBySequence(bigram);

      if (existingPattern) {
        // Update existing pattern
        existingPattern.triggerCount = count;
        existingPattern.confidence = confidence;
        existingPattern.lastTriggered = now;
        detectedPatterns.push(existingPattern);
      } else {
        // Create new pattern
        const pattern: ContextPattern = {
          id: `pat-${randomUUID().slice(0, 8)}`,
          pattern: bigram,
          triggerCount: count,
          lastTriggered: now,
          confidence,
          action,
        };
        this.patterns.set(pattern.id, pattern);
        detectedPatterns.push(pattern);
      }
    }

    // Also analyze key co-occurrence patterns
    const keyComboCounts = new Map<string, number>();
    for (const record of this.contextHistory) {
      if (record.keys.length >= 2) {
        const comboKey = record.keys.join('+');
        keyComboCounts.set(comboKey, (keyComboCounts.get(comboKey) ?? 0) + 1);
      }
    }

    for (const [combo, count] of keyComboCounts.entries()) {
      if (count < MIN_PATTERN_OCCURRENCES) continue;
      const confidence = Math.min(count / Math.max(this.contextHistory.length, 1), 1.0);
      if (confidence < this.config.minConfidence) continue;

      const patternKey = `combo:${combo}`;
      if (!this.findPatternBySequence(patternKey)) {
        const pattern: ContextPattern = {
          id: `pat-${randomUUID().slice(0, 8)}`,
          pattern: patternKey,
          triggerCount: count,
          lastTriggered: now,
          confidence,
          action: `handle-${combo.split('+')[0]}`,
        };
        this.patterns.set(pattern.id, pattern);
        detectedPatterns.push(pattern);
      }
    }

    // Sort by confidence descending
    detectedPatterns.sort((a, b) => b.confidence - a.confidence);

    this.emit('proactive:patterns:analyzed', {
      count: detectedPatterns.length,
      timestamp: now,
    });

    return detectedPatterns;
  }

  // ─────────────────────────────────────────────────────────
  // PREDICTION
  // ─────────────────────────────────────────────────────────

  /**
   * Based on detected patterns, predict what the user/system might need next.
   * Looks at the most recent context and finds patterns where the current
   * action is the trigger in a known bigram.
   */
  predictNeeds(): PredictedNeed[] {
    const now = Date.now();
    const newPredictions: PredictedNeed[] = [];

    if (this.contextHistory.length === 0) return newPredictions;

    const latestRecord = this.contextHistory[this.contextHistory.length - 1];
    const currentAction = this.extractActionKey(latestRecord);

    if (!currentAction) return newPredictions;

    // Find all bigrams where the current action is the trigger
    for (const [bigram, count] of this.bigramCounts.entries()) {
      if (count < MIN_PATTERN_OCCURRENCES) continue;

      const [trigger, predictedAction] = bigram.split('->');
      if (trigger !== currentAction) continue;

      const confidence = Math.min(count / Math.max(this.totalBigramObservations, 1), 1.0);
      if (confidence < this.config.minConfidence) continue;

      // Don't duplicate existing active predictions with the same action
      const alreadyPredicted = [...this.predictions.values()].some(
        (p) => p.suggestedAction === predictedAction && now - p.predictedAt < this.config.analysisIntervalMs * 2,
      );
      if (alreadyPredicted) continue;

      const prediction: PredictedNeed = {
        id: `pred-${randomUUID().slice(0, 8)}`,
        description: `After "${trigger}", "${predictedAction}" typically follows (observed ${count} times)`,
        confidence,
        suggestedAction: predictedAction,
        context: { ...latestRecord.values },
        predictedAt: now,
      };

      this.predictions.set(prediction.id, prediction);
      newPredictions.push(prediction);
    }

    // Enforce max predictions by removing lowest confidence entries
    if (this.predictions.size > this.config.maxPredictions) {
      const sorted = [...this.predictions.entries()].sort(
        (a, b) => a[1].confidence - b[1].confidence,
      );
      const excess = this.predictions.size - this.config.maxPredictions;
      for (let i = 0; i < excess; i++) {
        this.predictions.delete(sorted[i][0]);
      }
    }

    if (newPredictions.length > 0) {
      this.emit('proactive:predictions:generated', {
        count: newPredictions.length,
        timestamp: now,
      });
    }

    return newPredictions;
  }

  // ─────────────────────────────────────────────────────────
  // ACTION TRIGGERING
  // ─────────────────────────────────────────────────────────

  /**
   * Trigger the suggested action for a prediction.
   * Returns true if the prediction was found and the action was triggered.
   */
  triggerAction(predictionId: string): boolean {
    const prediction = this.predictions.get(predictionId);
    if (!prediction) return false;

    this.actionsTriggeredCount++;

    this.emit('proactive:action:triggered', {
      prediction,
      timestamp: Date.now(),
    });

    // Remove the prediction after triggering
    this.predictions.delete(predictionId);

    return true;
  }

  // ─────────────────────────────────────────────────────────
  // ACCESSORS
  // ─────────────────────────────────────────────────────────

  /**
   * Get all detected patterns.
   */
  getPatterns(): ContextPattern[] {
    return [...this.patterns.values()];
  }

  /**
   * Get all current predictions.
   */
  getPredictions(): PredictedNeed[] {
    return [...this.predictions.values()];
  }

  /**
   * Get operational statistics.
   */
  getStats(): ProactiveStats {
    const allPatterns = [...this.patterns.values()];
    const avgConfidence =
      allPatterns.length > 0
        ? allPatterns.reduce((sum, p) => sum + p.confidence, 0) / allPatterns.length
        : 0;

    const activeRules = [...this.rules.values()].filter((r) => r.enabled).length;

    return {
      totalPatterns: this.patterns.size,
      totalPredictions: this.predictions.size,
      totalActionsTriggered: this.actionsTriggeredCount,
      avgConfidence: Math.round(avgConfidence * 1000) / 1000,
      activeRules,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Helpers
  // ─────────────────────────────────────────────────────────

  /**
   * Extract a canonical action key from a context record.
   * Uses the "action" field if present, otherwise joins all string values.
   */
  private extractActionKey(record: ContextRecord): string | null {
    if (typeof record.values['action'] === 'string') {
      return record.values['action'] as string;
    }
    // Fallback: join all string values as a composite key
    const stringVals = Object.values(record.values)
      .filter((v): v is string => typeof v === 'string')
      .sort();
    return stringVals.length > 0 ? stringVals.join(':') : null;
  }

  /**
   * Find an existing pattern by its sequence string.
   */
  private findPatternBySequence(sequence: string): ContextPattern | undefined {
    for (const pattern of this.patterns.values()) {
      if (pattern.pattern === sequence) return pattern;
    }
    return undefined;
  }

  /**
   * Evaluate proactive rules against a newly recorded context.
   * Checks if the rule's condition (a key substring match) is satisfied.
   */
  private evaluateRules(context: Record<string, unknown>): void {
    const contextStr = JSON.stringify(context).toLowerCase();

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Rule condition is matched as a substring of the serialized context
      if (contextStr.includes(rule.condition.toLowerCase())) {
        rule.triggerCount++;

        this.emit('proactive:rule:triggered', {
          rule,
          context,
          timestamp: Date.now(),
        });
      }
    }
  }
}
