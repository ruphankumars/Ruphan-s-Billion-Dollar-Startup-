import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContractChecker } from '../../../src/verification/contract-checker.js';
import type { SpecContract, Condition } from '../../../src/verification/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeCondition(overrides: Partial<Condition> = {}): Condition {
  return {
    id: overrides.id ?? 'cond_1',
    expression: overrides.expression ?? 'true',
    description: overrides.description ?? 'test condition',
    severity: overrides.severity ?? 'error',
    enabled: overrides.enabled ?? true,
  };
}

function makeContract(overrides: Partial<SpecContract> = {}): SpecContract {
  return {
    id: overrides.id ?? 'contract_1',
    name: overrides.name ?? 'TestContract',
    description: overrides.description ?? '',
    preconditions: overrides.preconditions ?? [],
    postconditions: overrides.postconditions ?? [],
    invariants: overrides.invariants ?? [],
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ContractChecker', () => {
  let checker: ContractChecker;

  beforeEach(() => {
    checker = new ContractChecker();
  });

  // ─── checkPreconditions ───────────────────────────────────────

  describe('checkPreconditions', () => {
    it('should return passed for truthy expressions', () => {
      const contract = makeContract({
        preconditions: [makeCondition({ id: 'pre_1', expression: 'x > 0' })],
      });

      const results = checker.checkPreconditions(contract, { x: 5 });

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
      expect(results[0].conditionId).toBe('pre_1');
    });

    it('should return failed for falsy expressions', () => {
      const contract = makeContract({
        preconditions: [makeCondition({ id: 'pre_1', expression: 'x > 100' })],
      });

      const results = checker.checkPreconditions(contract, { x: 5 });

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
    });

    it('should evaluate multiple preconditions', () => {
      const contract = makeContract({
        preconditions: [
          makeCondition({ id: 'pre_1', expression: 'x > 0' }),
          makeCondition({ id: 'pre_2', expression: 'x < 100' }),
        ],
      });

      const results = checker.checkPreconditions(contract, { x: 50 });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it('should skip disabled conditions', () => {
      const contract = makeContract({
        preconditions: [
          makeCondition({ id: 'pre_1', expression: 'false', enabled: false }),
        ],
      });

      const results = checker.checkPreconditions(contract, {});
      expect(results[0].passed).toBe(true);
      expect(results[0].error).toContain('skipped');
    });

    it('should handle evaluation errors', () => {
      const contract = makeContract({
        preconditions: [
          makeCondition({ id: 'pre_1', expression: 'undeclaredVar.method()' }),
        ],
      });

      const results = checker.checkPreconditions(contract, {});
      expect(results[0].passed).toBe(false);
      expect(results[0].error).toContain('Evaluation error');
    });
  });

  // ─── checkPostconditions ──────────────────────────────────────

  describe('checkPostconditions', () => {
    it('should return passed for truthy postconditions', () => {
      const contract = makeContract({
        postconditions: [makeCondition({ id: 'post_1', expression: 'result > 0' })],
      });

      const results = checker.checkPostconditions(contract, { result: 42 });

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });

    it('should return failed for falsy postconditions', () => {
      const contract = makeContract({
        postconditions: [makeCondition({ id: 'post_1', expression: 'result > 0' })],
      });

      const results = checker.checkPostconditions(contract, { result: -1 });

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
    });

    it('should check postconditions with args and result in context', () => {
      const contract = makeContract({
        postconditions: [
          makeCondition({
            id: 'post_1',
            expression: 'result === arg0 + arg1',
          }),
        ],
      });

      const results = checker.checkPostconditions(contract, {
        args: [3, 7],
        arg0: 3,
        arg1: 7,
        result: 10,
      });

      expect(results[0].passed).toBe(true);
    });
  });

  // ─── wrapFunction ─────────────────────────────────────────────

  describe('wrapFunction', () => {
    it('should call the original function and return its result', () => {
      const add = (a: number, b: number) => a + b;
      const contract = makeContract();

      const wrapped = checker.wrapFunction(add, contract);
      const result = wrapped(3, 7);

      expect(result).toBe(10);
    });

    it('should check preconditions before calling the function', () => {
      const fn = vi.fn(() => 42);
      const contract = makeContract({
        preconditions: [makeCondition({ id: 'pre', expression: 'arg0 > 0' })],
      });

      const wrapped = checker.wrapFunction(fn, contract);
      wrapped(5);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(checker.getViolations()).toHaveLength(0);
    });

    it('should record violations when preconditions fail', () => {
      const fn = (x: number) => x * 2;
      const contract = makeContract({
        preconditions: [makeCondition({ id: 'pre', expression: 'arg0 > 10' })],
      });

      const wrapped = checker.wrapFunction(fn, contract);
      const result = wrapped(5);

      // Function still executes
      expect(result).toBe(10);
      // But a violation was recorded
      const violations = checker.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].invariantId).toBe('pre');
      expect(violations[0].contractId).toBe('contract_1');
    });

    it('should record violations when postconditions fail', () => {
      const fn = (x: number) => x * 2;
      const contract = makeContract({
        postconditions: [
          makeCondition({ id: 'post', expression: 'result > 100' }),
        ],
      });

      const wrapped = checker.wrapFunction(fn, contract);
      wrapped(5); // result = 10, but postcondition expects > 100

      const violations = checker.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].invariantId).toBe('post');
    });

    it('should record violations for both pre and postconditions', () => {
      const fn = (x: number) => x;
      const contract = makeContract({
        preconditions: [makeCondition({ id: 'pre', expression: 'arg0 > 100' })],
        postconditions: [makeCondition({ id: 'post', expression: 'result > 100' })],
      });

      const wrapped = checker.wrapFunction(fn, contract);
      wrapped(5);

      expect(checker.getViolations()).toHaveLength(2);
    });

    it('should preserve the this binding', () => {
      const obj = {
        multiplier: 3,
        compute(x: number) { return x * this.multiplier; },
      };

      const contract = makeContract();
      obj.compute = checker.wrapFunction(obj.compute, contract);

      expect(obj.compute(5)).toBe(15);
    });

    it('should emit verify:contract:violated on violation', () => {
      const handler = vi.fn();
      checker.on('verify:contract:violated', handler);

      const fn = (x: number) => x;
      const contract = makeContract({
        preconditions: [makeCondition({ id: 'pre', expression: 'arg0 > 100' })],
      });

      const wrapped = checker.wrapFunction(fn, contract);
      wrapped(1);

      expect(handler).toHaveBeenCalledTimes(1);
      const violation = handler.mock.calls[0][0];
      expect(violation.contractId).toBe('contract_1');
    });
  });

  // ─── Violation Management ─────────────────────────────────────

  describe('getViolations', () => {
    it('should return an empty array initially', () => {
      expect(checker.getViolations()).toEqual([]);
    });

    it('should return a copy of violations', () => {
      const fn = (x: number) => x;
      const contract = makeContract({
        preconditions: [makeCondition({ expression: 'false' })],
      });
      const wrapped = checker.wrapFunction(fn, contract);
      wrapped(1);

      const v1 = checker.getViolations();
      const v2 = checker.getViolations();
      expect(v1).toEqual(v2);
      expect(v1).not.toBe(v2); // different reference
    });
  });

  describe('clearViolations', () => {
    it('should clear all violations', () => {
      const fn = (x: number) => x;
      const contract = makeContract({
        preconditions: [makeCondition({ expression: 'false' })],
      });
      const wrapped = checker.wrapFunction(fn, contract);
      wrapped(1);

      expect(checker.getViolations()).toHaveLength(1);
      checker.clearViolations();
      expect(checker.getViolations()).toHaveLength(0);
    });
  });

  describe('maxViolations', () => {
    it('should evict oldest violations when max is reached', () => {
      const limited = new ContractChecker({ maxViolations: 3 });
      const fn = (x: number) => x;
      const contract = makeContract({
        preconditions: [makeCondition({ expression: 'false' })],
      });
      const wrapped = limited.wrapFunction(fn, contract);

      for (let i = 0; i < 5; i++) {
        wrapped(i);
      }

      const violations = limited.getViolations();
      expect(violations).toHaveLength(3);
    });
  });
});
