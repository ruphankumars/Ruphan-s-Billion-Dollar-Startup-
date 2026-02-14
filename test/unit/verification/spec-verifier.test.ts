import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpecVerifier } from '../../../src/verification/spec-verifier.js';
import type { Condition, SpecContract } from '../../../src/verification/types.js';

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

// ─── Tests ──────────────────────────────────────────────────────

describe('SpecVerifier', () => {
  let verifier: SpecVerifier;

  beforeEach(() => {
    verifier = new SpecVerifier();
  });

  // ─── Contract Management ──────────────────────────────────────

  describe('registerContract', () => {
    it('should register a contract and return it with generated id', () => {
      const contract = verifier.registerContract({ name: 'TestContract' });

      expect(contract.id).toBeTruthy();
      expect(contract.name).toBe('TestContract');
      expect(contract.description).toBe('');
      expect(contract.preconditions).toEqual([]);
      expect(contract.postconditions).toEqual([]);
      expect(contract.invariants).toEqual([]);
      expect(contract.createdAt).toBeGreaterThan(0);
    });

    it('should use provided id when given', () => {
      const contract = verifier.registerContract({ id: 'custom_id', name: 'Custom' });
      expect(contract.id).toBe('custom_id');
    });

    it('should register a contract with preconditions, postconditions, and invariants', () => {
      const pre = makeCondition({ id: 'pre_1', expression: 'x > 0' });
      const post = makeCondition({ id: 'post_1', expression: 'result > 0' });
      const inv = makeCondition({ id: 'inv_1', expression: 'x !== null' });

      const contract = verifier.registerContract({
        name: 'FullContract',
        preconditions: [pre],
        postconditions: [post],
        invariants: [inv],
      });

      expect(contract.preconditions).toHaveLength(1);
      expect(contract.postconditions).toHaveLength(1);
      expect(contract.invariants).toHaveLength(1);
    });

    it('should be retrievable after registration', () => {
      const contract = verifier.registerContract({ name: 'Retrievable' });
      const found = verifier.getContract(contract.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Retrievable');
    });

    it('should appear in listContracts', () => {
      verifier.registerContract({ name: 'A' });
      verifier.registerContract({ name: 'B' });
      const list = verifier.listContracts();
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.name)).toContain('A');
      expect(list.map((c) => c.name)).toContain('B');
    });
  });

  describe('removeContract', () => {
    it('should remove a registered contract', () => {
      const contract = verifier.registerContract({ name: 'ToRemove' });
      const removed = verifier.removeContract(contract.id);

      expect(removed).toBe(true);
      expect(verifier.getContract(contract.id)).toBeNull();
    });

    it('should return false when removing a non-existent contract', () => {
      expect(verifier.removeContract('nonexistent')).toBe(false);
    });
  });

  describe('getContract', () => {
    it('should return null for unknown id', () => {
      expect(verifier.getContract('unknown')).toBeNull();
    });
  });

  // ─── Verification ─────────────────────────────────────────────

  describe('verify', () => {
    it('should throw if contract not found', () => {
      expect(() => verifier.verify('nonexistent', {})).toThrow('not found');
    });

    it('should pass when all conditions evaluate to true', () => {
      const contract = verifier.registerContract({
        name: 'AllPass',
        preconditions: [makeCondition({ id: 'pre', expression: 'x > 0' })],
        postconditions: [makeCondition({ id: 'post', expression: 'x < 100' })],
        invariants: [makeCondition({ id: 'inv', expression: 'x !== null' })],
      });

      const result = verifier.verify(contract.id, { x: 10 });

      expect(result.passed).toBe(true);
      expect(result.contractId).toBe(contract.id);
      expect(result.preconditionResults).toHaveLength(1);
      expect(result.preconditionResults[0].passed).toBe(true);
      expect(result.postconditionResults).toHaveLength(1);
      expect(result.postconditionResults[0].passed).toBe(true);
      expect(result.invariantResults).toHaveLength(1);
      expect(result.invariantResults[0].passed).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should fail when a precondition evaluates to false', () => {
      const contract = verifier.registerContract({
        name: 'PreFail',
        preconditions: [makeCondition({ id: 'pre', expression: 'x > 100' })],
      });

      const result = verifier.verify(contract.id, { x: 5 });

      expect(result.passed).toBe(false);
      expect(result.preconditionResults[0].passed).toBe(false);
    });

    it('should fail when a postcondition evaluates to false', () => {
      const contract = verifier.registerContract({
        name: 'PostFail',
        postconditions: [makeCondition({ id: 'post', expression: 'result === true' })],
      });

      const result = verifier.verify(contract.id, { result: false });

      expect(result.passed).toBe(false);
      expect(result.postconditionResults[0].passed).toBe(false);
    });

    it('should fail when an invariant evaluates to false', () => {
      const contract = verifier.registerContract({
        name: 'InvFail',
        invariants: [makeCondition({ id: 'inv', expression: 'count >= 0' })],
      });

      const result = verifier.verify(contract.id, { count: -1 });

      expect(result.passed).toBe(false);
      expect(result.invariantResults[0].passed).toBe(false);
    });

    it('should return a skipped result when verifier is disabled', () => {
      const disabled = new SpecVerifier({ enabled: false });
      const contract = disabled.registerContract({
        name: 'Disabled',
        preconditions: [makeCondition({ expression: 'false' })],
      });

      const result = disabled.verify(contract.id, {});

      expect(result.passed).toBe(true);
      expect(result.preconditionResults).toHaveLength(0);
      expect(result.duration).toBe(0);
    });

    it('should emit verify:spec:checked event on every verification', () => {
      const handler = vi.fn();
      verifier.on('verify:spec:checked', handler);

      const contract = verifier.registerContract({ name: 'Emitter' });
      verifier.verify(contract.id, {});

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].contractId).toBe(contract.id);
    });

    it('should emit verify:contract:violated event on failure', () => {
      const handler = vi.fn();
      verifier.on('verify:contract:violated', handler);

      const contract = verifier.registerContract({
        name: 'FailEmitter',
        preconditions: [makeCondition({ expression: 'false' })],
      });

      verifier.verify(contract.id, {});

      expect(handler).toHaveBeenCalledTimes(1);
      const payload = handler.mock.calls[0][0];
      expect(payload.contractId).toBe(contract.id);
      expect(payload.contractName).toBe('FailEmitter');
      expect(payload.failures).toHaveLength(1);
    });

    it('should not emit verify:contract:violated event on success', () => {
      const handler = vi.fn();
      verifier.on('verify:contract:violated', handler);

      const contract = verifier.registerContract({
        name: 'PassNoViolation',
        preconditions: [makeCondition({ expression: 'true' })],
      });

      verifier.verify(contract.id, {});
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('verifyAll', () => {
    it('should verify all registered contracts', () => {
      verifier.registerContract({
        name: 'A',
        preconditions: [makeCondition({ id: 'a_pre', expression: 'x > 0' })],
      });
      verifier.registerContract({
        name: 'B',
        preconditions: [makeCondition({ id: 'b_pre', expression: 'x < 100' })],
      });

      const results = verifier.verifyAll({ x: 50 });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
    });
  });

  // ─── Condition Evaluation ─────────────────────────────────────

  describe('evaluateCondition', () => {
    it('should evaluate a truthy expression as passed', () => {
      const condition = makeCondition({ expression: '1 + 1 === 2' });
      const result = verifier.evaluateCondition(condition, {});
      expect(result.passed).toBe(true);
      expect(result.actualValue).toBe(true);
    });

    it('should evaluate a falsy expression as failed', () => {
      const condition = makeCondition({ expression: '1 + 1 === 3' });
      const result = verifier.evaluateCondition(condition, {});
      expect(result.passed).toBe(false);
      expect(result.actualValue).toBe(false);
    });

    it('should provide context variables to the expression', () => {
      const condition = makeCondition({ expression: 'a + b === 10' });
      const result = verifier.evaluateCondition(condition, { a: 3, b: 7 });
      expect(result.passed).toBe(true);
    });

    it('should skip disabled conditions', () => {
      const condition = makeCondition({ enabled: false, expression: 'false' });
      const result = verifier.evaluateCondition(condition, {});
      expect(result.passed).toBe(true);
      expect(result.error).toContain('skipped');
    });

    it('should handle evaluation errors gracefully in non-strict mode', () => {
      const condition = makeCondition({ expression: 'undeclaredVar.foo' });
      const result = verifier.evaluateCondition(condition, {});
      // Non-strict mode: errors pass
      expect(result.passed).toBe(true);
      expect(result.error).toContain('Evaluation error');
    });

    it('should fail on evaluation errors in strict mode', () => {
      const strict = new SpecVerifier({ strictMode: true });
      const condition = makeCondition({ expression: 'undeclaredVar.foo' });
      const result = strict.evaluateCondition(condition, {});
      expect(result.passed).toBe(false);
      expect(result.error).toContain('Evaluation error');
    });
  });

  // ─── Results / Stats ──────────────────────────────────────────

  describe('getResults', () => {
    it('should return empty array for unknown contract', () => {
      expect(verifier.getResults('unknown')).toEqual([]);
    });

    it('should return results for a specific contract', () => {
      const contract = verifier.registerContract({ name: 'ResultsTest' });
      verifier.verify(contract.id, {});
      verifier.verify(contract.id, {});

      const results = verifier.getResults(contract.id);
      expect(results).toHaveLength(2);
    });

    it('should return all results when no contractId given', () => {
      const c1 = verifier.registerContract({ name: 'C1' });
      const c2 = verifier.registerContract({ name: 'C2' });
      verifier.verify(c1.id, {});
      verifier.verify(c2.id, {});

      const all = verifier.getResults();
      expect(all).toHaveLength(2);
    });

    it('should return results sorted by timestamp when no contractId given', () => {
      const c1 = verifier.registerContract({ name: 'C1' });
      const c2 = verifier.registerContract({ name: 'C2' });
      verifier.verify(c1.id, {});
      verifier.verify(c2.id, {});

      const all = verifier.getResults();
      for (let i = 1; i < all.length; i++) {
        expect(all[i].timestamp).toBeGreaterThanOrEqual(all[i - 1].timestamp);
      }
    });
  });

  describe('getStats', () => {
    it('should return zeros when no verifications have been run', () => {
      const stats = verifier.getStats();
      expect(stats.contractsRegistered).toBe(0);
      expect(stats.verificationsRun).toBe(0);
      expect(stats.passed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.violationsDetected).toBe(0);
      expect(stats.avgDuration).toBe(0);
    });

    it('should track pass/fail counts correctly', () => {
      const passing = verifier.registerContract({
        name: 'Pass',
        preconditions: [makeCondition({ id: 'p1', expression: 'true' })],
      });
      const failing = verifier.registerContract({
        name: 'Fail',
        preconditions: [makeCondition({ id: 'p2', expression: 'false' })],
      });

      verifier.verify(passing.id, {});
      verifier.verify(failing.id, {});

      const stats = verifier.getStats();
      expect(stats.contractsRegistered).toBe(2);
      expect(stats.verificationsRun).toBe(2);
      expect(stats.passed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.violationsDetected).toBe(1);
      expect(stats.avgDuration).toBeGreaterThanOrEqual(0);
    });
  });
});
