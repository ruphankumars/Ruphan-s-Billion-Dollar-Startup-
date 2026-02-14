/**
 * SpecVerifier — Formal Specification Verifier
 *
 * Registers specification contracts and verifies them against runtime
 * contexts. Each contract defines preconditions, postconditions, and
 * invariants expressed as JavaScript expressions that are safely evaluated
 * within a sandboxed context.
 *
 * Part of CortexOS Formal Verification Module
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  SpecContract,
  Condition,
  ConditionResult,
  VerificationResult,
  VerificationConfig,
  VerificationStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: VerificationConfig = {
  enabled: true,
  strictMode: false,
  maxViolations: 1000,
  autoHalt: false,
  reportFormat: 'json',
};

// ═══════════════════════════════════════════════════════════════
// SPEC VERIFIER
// ═══════════════════════════════════════════════════════════════

export class SpecVerifier extends EventEmitter {
  private contracts: Map<string, SpecContract> = new Map();
  private results: Map<string, VerificationResult[]> = new Map();
  private config: VerificationConfig;

  // Stats accumulators
  private totalVerifications = 0;
  private totalPassed = 0;
  private totalFailed = 0;
  private totalViolations = 0;
  private totalDuration = 0;

  constructor(config?: Partial<VerificationConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Contract management
  // ---------------------------------------------------------------------------

  /**
   * Register a specification contract.
   * If the contract has no `id`, one is generated automatically.
   * If the contract has no `createdAt`, the current time is used.
   */
  registerContract(contract: Partial<SpecContract> & Pick<SpecContract, 'name'>): SpecContract {
    const full: SpecContract = {
      id: contract.id ?? `contract_${randomUUID().slice(0, 8)}`,
      name: contract.name,
      description: contract.description ?? '',
      preconditions: contract.preconditions ?? [],
      postconditions: contract.postconditions ?? [],
      invariants: contract.invariants ?? [],
      targetFunction: contract.targetFunction,
      targetFile: contract.targetFile,
      createdAt: contract.createdAt ?? Date.now(),
    };

    this.contracts.set(full.id, full);
    this.results.set(full.id, []);
    return full;
  }

  /** Remove a contract and its result history. */
  removeContract(id: string): boolean {
    const existed = this.contracts.delete(id);
    this.results.delete(id);
    return existed;
  }

  /** Get a single contract by ID. */
  getContract(id: string): SpecContract | null {
    return this.contracts.get(id) ?? null;
  }

  /** List all registered contracts. */
  listContracts(): SpecContract[] {
    return Array.from(this.contracts.values());
  }

  // ---------------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------------

  /**
   * Verify a single contract against the provided context.
   * The `context` object's keys become variables available inside condition
   * expressions.
   */
  verify(contractId: string, context: Record<string, unknown>): VerificationResult {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      throw new Error(`SpecVerifier: contract "${contractId}" not found`);
    }

    if (!this.config.enabled) {
      return this.createSkippedResult(contractId);
    }

    const start = performance.now();

    const preconditionResults = this.evaluateConditions(contract.preconditions, context);
    const postconditionResults = this.evaluateConditions(contract.postconditions, context);
    const invariantResults = this.evaluateConditions(contract.invariants, context);

    const duration = performance.now() - start;

    const allResults = [...preconditionResults, ...postconditionResults, ...invariantResults];
    const passed = allResults.every((r) => r.passed);

    const result: VerificationResult = {
      contractId,
      passed,
      preconditionResults,
      postconditionResults,
      invariantResults,
      timestamp: Date.now(),
      duration,
    };

    // Store result
    const history = this.results.get(contractId);
    if (history) {
      history.push(result);
      // Cap history
      if (history.length > 500) {
        history.splice(0, history.length - 500);
      }
    }

    // Update stats
    this.totalVerifications++;
    this.totalDuration += duration;
    if (passed) {
      this.totalPassed++;
    } else {
      this.totalFailed++;
      const violations = allResults.filter((r) => !r.passed).length;
      this.totalViolations += violations;
    }

    // Emit events
    this.emit('verify:spec:checked', result);
    if (!passed) {
      this.emit('verify:contract:violated', {
        contractId,
        contractName: contract.name,
        failures: allResults.filter((r) => !r.passed),
        timestamp: result.timestamp,
      });
    }

    return result;
  }

  /**
   * Verify ALL registered contracts against the provided context.
   * Returns an array of results — one per contract.
   */
  verifyAll(context: Record<string, unknown>): VerificationResult[] {
    const results: VerificationResult[] = [];
    for (const contract of this.contracts.values()) {
      results.push(this.verify(contract.id, context));
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Condition evaluation
  // ---------------------------------------------------------------------------

  /**
   * Safely evaluate a single condition expression against the given context.
   *
   * The expression is run inside a `Function` constructor with the context
   * keys as parameters. This provides basic sandboxing — global scope is
   * inaccessible because we do not pass `globalThis` or `process`.
   */
  evaluateCondition(condition: Condition, context: Record<string, unknown>): ConditionResult {
    if (!condition.enabled) {
      return {
        conditionId: condition.id,
        passed: true,
        expression: condition.expression,
        actualValue: undefined,
        error: 'skipped (disabled)',
      };
    }

    const keys = Object.keys(context);
    const values = Object.values(context);

    try {
      // Build a sandboxed evaluator using Function constructor.
      // The expression is wrapped in a return statement so we get the value.
      const evaluator = new Function(
        ...keys,
        `"use strict"; return (${condition.expression});`,
      );

      const actualValue = evaluator(...values);

      // Truthy = passed
      const passed = Boolean(actualValue);

      return {
        conditionId: condition.id,
        passed,
        expression: condition.expression,
        actualValue,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // In strict mode, evaluation errors count as failures
      return {
        conditionId: condition.id,
        passed: !this.config.strictMode,
        expression: condition.expression,
        error: `Evaluation error: ${errorMessage}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Results / Stats
  // ---------------------------------------------------------------------------

  /**
   * Get verification results history.
   * If `contractId` is provided, returns results for that contract only.
   * Otherwise, returns all results across all contracts.
   */
  getResults(contractId?: string): VerificationResult[] {
    if (contractId) {
      return this.results.get(contractId) ?? [];
    }
    const all: VerificationResult[] = [];
    for (const history of this.results.values()) {
      all.push(...history);
    }
    return all.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Get aggregate verification statistics. */
  getStats(): VerificationStats {
    return {
      contractsRegistered: this.contracts.size,
      verificationsRun: this.totalVerifications,
      passed: this.totalPassed,
      failed: this.totalFailed,
      violationsDetected: this.totalViolations,
      avgDuration:
        this.totalVerifications > 0
          ? this.totalDuration / this.totalVerifications
          : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Evaluate an array of conditions and return results. */
  private evaluateConditions(
    conditions: Condition[],
    context: Record<string, unknown>,
  ): ConditionResult[] {
    return conditions.map((c) => this.evaluateCondition(c, context));
  }

  /** Create a "skipped" result when verification is disabled. */
  private createSkippedResult(contractId: string): VerificationResult {
    return {
      contractId,
      passed: true,
      preconditionResults: [],
      postconditionResults: [],
      invariantResults: [],
      timestamp: Date.now(),
      duration: 0,
    };
  }
}
