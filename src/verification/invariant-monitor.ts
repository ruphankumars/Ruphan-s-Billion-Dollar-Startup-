/**
 * InvariantMonitor — Runtime Invariant Checker
 *
 * Registers invariant conditions and periodically checks them against the
 * current system state provided by a context-provider callback. When an
 * invariant is violated, the monitor emits events and records violations
 * for later analysis.
 *
 * Part of CortexOS Formal Verification Module
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  Condition,
  ConditionResult,
  InvariantViolation,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface RegisteredInvariant {
  contractId: string;
  condition: Condition;
}

type ViolationHandler = (violation: InvariantViolation) => void;

// ═══════════════════════════════════════════════════════════════
// INVARIANT MONITOR
// ═══════════════════════════════════════════════════════════════

export class InvariantMonitor extends EventEmitter {
  private invariants: Map<string, RegisteredInvariant> = new Map();
  private violations: InvariantViolation[] = [];
  private violationHandlers: ViolationHandler[] = [];

  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private maxViolations: number;

  constructor(options?: { maxViolations?: number }) {
    super();
    this.maxViolations = options?.maxViolations ?? 10_000;
  }

  // ---------------------------------------------------------------------------
  // Invariant registration
  // ---------------------------------------------------------------------------

  /**
   * Register a runtime invariant.
   * Returns the condition ID (generated if not present on the condition).
   */
  registerInvariant(contractId: string, condition: Condition): string {
    const id = condition.id || `inv_${randomUUID().slice(0, 8)}`;
    const normalised: Condition = { ...condition, id };

    this.invariants.set(id, { contractId, condition: normalised });
    return id;
  }

  /** Remove an invariant by its condition ID. */
  removeInvariant(id: string): boolean {
    return this.invariants.delete(id);
  }

  /** List all active (registered) invariants. */
  getActiveInvariants(): Array<{ id: string; contractId: string; condition: Condition }> {
    const result: Array<{ id: string; contractId: string; condition: Condition }> = [];
    for (const [id, entry] of this.invariants) {
      result.push({ id, contractId: entry.contractId, condition: entry.condition });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Checking
  // ---------------------------------------------------------------------------

  /**
   * Check all registered invariants against the provided context.
   * Returns an array of `ConditionResult`s.
   * Any failures are recorded as violations and trigger handlers / events.
   */
  check(context: Record<string, unknown>): ConditionResult[] {
    const results: ConditionResult[] = [];

    for (const [id, entry] of this.invariants) {
      const result = this.evaluateCondition(entry.condition, context);
      results.push(result);

      if (!result.passed) {
        this.handleViolation(id, entry, result, context);
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Periodic monitoring
  // ---------------------------------------------------------------------------

  /**
   * Start periodic invariant checking.
   * The `contextProvider` function is called on each interval to obtain the
   * current system state that invariants are checked against.
   */
  startMonitoring(
    intervalMs: number,
    contextProvider: () => Record<string, unknown>,
  ): void {
    if (this.monitorInterval) {
      this.stopMonitoring();
    }

    this.monitorInterval = setInterval(() => {
      const context = contextProvider();
      this.check(context);
    }, intervalMs);

    // Allow process to exit even if interval is running
    if (
      this.monitorInterval &&
      typeof this.monitorInterval === 'object' &&
      'unref' in this.monitorInterval
    ) {
      this.monitorInterval.unref();
    }
  }

  /** Stop periodic invariant checking. */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Violations
  // ---------------------------------------------------------------------------

  /** Get all recorded violations. */
  getViolations(): InvariantViolation[] {
    return [...this.violations];
  }

  /** Register a handler that is called on every violation. */
  onViolation(handler: ViolationHandler): void {
    this.violationHandlers.push(handler);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Stop monitoring and clear all state. */
  destroy(): void {
    this.stopMonitoring();
    this.invariants.clear();
    this.violations = [];
    this.violationHandlers = [];
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Evaluate a single condition expression against a context. */
  private evaluateCondition(
    condition: Condition,
    context: Record<string, unknown>,
  ): ConditionResult {
    if (!condition.enabled) {
      return {
        conditionId: condition.id,
        passed: true,
        expression: condition.expression,
        error: 'skipped (disabled)',
      };
    }

    const keys = Object.keys(context);
    const values = Object.values(context);

    try {
      const evaluator = new Function(
        ...keys,
        `"use strict"; return (${condition.expression});`,
      );
      const actualValue = evaluator(...values);
      return {
        conditionId: condition.id,
        passed: Boolean(actualValue),
        expression: condition.expression,
        actualValue,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        conditionId: condition.id,
        passed: false,
        expression: condition.expression,
        error: `Evaluation error: ${errorMessage}`,
      };
    }
  }

  /** Handle a failed invariant check. */
  private handleViolation(
    invariantId: string,
    entry: RegisteredInvariant,
    result: ConditionResult,
    context: Record<string, unknown>,
  ): void {
    // Cap violation history
    if (this.violations.length >= this.maxViolations) {
      this.violations.shift();
    }

    const violation: InvariantViolation = {
      id: `violation_${randomUUID().slice(0, 8)}`,
      invariantId,
      contractId: entry.contractId,
      expression: entry.condition.expression,
      actualValue: result.actualValue,
      context: { ...context },
      timestamp: Date.now(),
      stackTrace: new Error().stack,
    };

    this.violations.push(violation);

    // Notify handlers
    for (const handler of this.violationHandlers) {
      try {
        handler(violation);
      } catch {
        // Handlers should not throw, but swallow if they do
      }
    }

    // Emit event
    this.emit('verify:invariant:broken', violation);
  }
}
