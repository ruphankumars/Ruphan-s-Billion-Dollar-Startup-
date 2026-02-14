/**
 * ContractChecker — Design-by-Contract Function Wrappers
 *
 * Provides the ability to wrap arbitrary functions with pre- and post-condition
 * checks. When a wrapped function is called the checker evaluates preconditions
 * against the call arguments, runs the original function, then evaluates
 * postconditions against the result.
 *
 * Violations are recorded and can be retrieved for inspection.
 *
 * Part of CortexOS Formal Verification Module
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  SpecContract,
  Condition,
  ConditionResult,
  InvariantViolation,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// CONTRACT CHECKER
// ═══════════════════════════════════════════════════════════════

export class ContractChecker extends EventEmitter {
  private violations: InvariantViolation[] = [];
  private maxViolations: number;

  constructor(options?: { maxViolations?: number }) {
    super();
    this.maxViolations = options?.maxViolations ?? 10_000;
  }

  // ---------------------------------------------------------------------------
  // Function wrapping
  // ---------------------------------------------------------------------------

  /**
   * Wrap a function with pre- and post-condition checking.
   *
   * Preconditions receive a context object with:
   *   - `args`: the arguments array passed to the function
   *   - `arg0`, `arg1`, ...: individual positional arguments
   *
   * Postconditions receive an extended context that also includes:
   *   - `result`: the return value of the wrapped function
   *   - `args`: the original arguments
   *
   * The wrapped function preserves the original `this` binding.
   */
  wrapFunction<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn,
    contract: SpecContract,
  ): (...args: TArgs) => TReturn {
    const checker = this;

    return function wrappedWithContract(this: unknown, ...args: TArgs): TReturn {
      // --- Precondition check ---
      const preContext = checker.buildArgsContext(args);
      const preResults = checker.checkPreconditions(contract, preContext);

      const preFailures = preResults.filter((r) => !r.passed);
      if (preFailures.length > 0) {
        for (const failure of preFailures) {
          checker.recordViolation(contract.id, failure, preContext, 'precondition');
        }
      }

      // --- Execute the original function ---
      const result = fn.apply(this, args);

      // --- Postcondition check ---
      const postContext = { ...preContext, result };
      const postResults = checker.checkPostconditions(contract, postContext);

      const postFailures = postResults.filter((r) => !r.passed);
      if (postFailures.length > 0) {
        for (const failure of postFailures) {
          checker.recordViolation(contract.id, failure, postContext, 'postcondition');
        }
      }

      return result;
    };
  }

  // ---------------------------------------------------------------------------
  // Condition checking
  // ---------------------------------------------------------------------------

  /**
   * Evaluate all preconditions of a contract against the given context.
   * Returns an array of `ConditionResult`s.
   */
  checkPreconditions(
    contract: SpecContract,
    context: Record<string, unknown>,
  ): ConditionResult[] {
    return contract.preconditions.map((c) => this.evaluateCondition(c, context));
  }

  /**
   * Evaluate all postconditions of a contract against the given context.
   * The context should include both the original arguments and the `result`.
   */
  checkPostconditions(
    contract: SpecContract,
    context: Record<string, unknown>,
  ): ConditionResult[] {
    return contract.postconditions.map((c) => this.evaluateCondition(c, context));
  }

  // ---------------------------------------------------------------------------
  // Violation history
  // ---------------------------------------------------------------------------

  /** Get all recorded violations. */
  getViolations(): InvariantViolation[] {
    return [...this.violations];
  }

  /** Clear all recorded violations. */
  clearViolations(): void {
    this.violations = [];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Evaluate a single condition expression against a context.
   * Uses the Function constructor for sandboxed evaluation.
   */
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

  /**
   * Build a context object from function arguments.
   * Provides `args` (the full array) and `arg0`, `arg1`, etc.
   */
  private buildArgsContext(args: unknown[]): Record<string, unknown> {
    const context: Record<string, unknown> = { args };
    for (let i = 0; i < args.length; i++) {
      context[`arg${i}`] = args[i];
    }
    return context;
  }

  /** Record a violation from a failed condition check. */
  private recordViolation(
    contractId: string,
    failure: ConditionResult,
    context: Record<string, unknown>,
    kind: 'precondition' | 'postcondition',
  ): void {
    if (this.violations.length >= this.maxViolations) {
      // Evict oldest
      this.violations.shift();
    }

    const violation: InvariantViolation = {
      id: `violation_${randomUUID().slice(0, 8)}`,
      invariantId: failure.conditionId,
      contractId,
      expression: failure.expression,
      actualValue: failure.actualValue,
      context: { ...context, kind },
      timestamp: Date.now(),
      stackTrace: new Error().stack,
    };

    this.violations.push(violation);
    this.emit('verify:contract:violated', violation);
  }
}
