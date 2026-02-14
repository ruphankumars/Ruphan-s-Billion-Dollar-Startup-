/**
 * CortexOS Formal Verification Module
 *
 * Design-by-contract primitives: specification contracts, pre/post-condition
 * checking, and runtime invariant monitoring.
 *
 * @example
 * ```typescript
 * import { SpecVerifier, ContractChecker, InvariantMonitor } from 'cortexos';
 *
 * const verifier = new SpecVerifier({ strictMode: true });
 * const contract = verifier.registerContract({
 *   name: 'positive-balance',
 *   preconditions: [{
 *     id: 'pre1', expression: 'amount > 0',
 *     description: 'Amount must be positive', severity: 'error', enabled: true,
 *   }],
 *   postconditions: [{
 *     id: 'post1', expression: 'balance >= 0',
 *     description: 'Balance must not go negative', severity: 'error', enabled: true,
 *   }],
 *   invariants: [],
 * });
 *
 * const result = verifier.verify(contract.id, { amount: 100, balance: 500 });
 * console.log(result.passed); // true
 * ```
 */

export { SpecVerifier } from './spec-verifier.js';
export { ContractChecker } from './contract-checker.js';
export { InvariantMonitor } from './invariant-monitor.js';
export type {
  SpecContract,
  Condition,
  VerificationResult,
  ConditionResult,
  InvariantViolation,
  VerificationConfig,
  VerificationStats,
} from './types.js';
