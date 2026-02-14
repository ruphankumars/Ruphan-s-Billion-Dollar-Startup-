import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvariantMonitor } from '../../../src/verification/invariant-monitor.js';
import type { Condition } from '../../../src/verification/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeCondition(overrides: Partial<Condition> = {}): Condition {
  return {
    id: overrides.id ?? 'cond_1',
    expression: overrides.expression ?? 'true',
    description: overrides.description ?? 'test invariant',
    severity: overrides.severity ?? 'error',
    enabled: overrides.enabled ?? true,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('InvariantMonitor', () => {
  let monitor: InvariantMonitor;

  beforeEach(() => {
    monitor = new InvariantMonitor();
  });

  // ─── Registration ─────────────────────────────────────────────

  describe('registerInvariant', () => {
    it('should register an invariant and return its id', () => {
      const id = monitor.registerInvariant('contract_1', makeCondition({ id: 'inv_1' }));
      expect(id).toBe('inv_1');
    });

    it('should generate an id when condition has no id', () => {
      const condition = makeCondition();
      condition.id = '';
      const id = monitor.registerInvariant('contract_1', condition);
      expect(id).toBeTruthy();
      expect(id).toContain('inv_');
    });

    it('should appear in getActiveInvariants', () => {
      monitor.registerInvariant('contract_1', makeCondition({ id: 'inv_a' }));
      monitor.registerInvariant('contract_2', makeCondition({ id: 'inv_b' }));

      const active = monitor.getActiveInvariants();
      expect(active).toHaveLength(2);
      expect(active[0].id).toBe('inv_a');
      expect(active[0].contractId).toBe('contract_1');
      expect(active[1].id).toBe('inv_b');
      expect(active[1].contractId).toBe('contract_2');
    });
  });

  describe('removeInvariant', () => {
    it('should remove a registered invariant', () => {
      const id = monitor.registerInvariant('c1', makeCondition({ id: 'inv_1' }));
      expect(monitor.removeInvariant(id)).toBe(true);
      expect(monitor.getActiveInvariants()).toHaveLength(0);
    });

    it('should return false for non-existent invariant', () => {
      expect(monitor.removeInvariant('nonexistent')).toBe(false);
    });
  });

  // ─── Checking ─────────────────────────────────────────────────

  describe('check', () => {
    it('should return passed results for all truthy invariants', () => {
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'x > 0' }));
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_2', expression: 'x < 100' }));

      const results = monitor.check({ x: 50 });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it('should detect violations when invariants fail', () => {
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'x >= 0' }));

      const results = monitor.check({ x: -5 });

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
    });

    it('should record violations for failed invariants', () => {
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'x >= 0' }));
      monitor.check({ x: -1 });

      const violations = monitor.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].invariantId).toBe('inv_1');
      expect(violations[0].contractId).toBe('c1');
      expect(violations[0].expression).toBe('x >= 0');
      expect(violations[0].timestamp).toBeGreaterThan(0);
    });

    it('should not record violations when invariants pass', () => {
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'x > 0' }));
      monitor.check({ x: 10 });

      expect(monitor.getViolations()).toHaveLength(0);
    });

    it('should skip disabled invariants', () => {
      monitor.registerInvariant(
        'c1',
        makeCondition({ id: 'inv_1', expression: 'false', enabled: false }),
      );

      const results = monitor.check({});
      expect(results[0].passed).toBe(true);
      expect(monitor.getViolations()).toHaveLength(0);
    });

    it('should handle evaluation errors as failures', () => {
      monitor.registerInvariant(
        'c1',
        makeCondition({ id: 'inv_1', expression: 'undeclaredVar.foo' }),
      );

      const results = monitor.check({});
      expect(results[0].passed).toBe(false);
      expect(results[0].error).toContain('Evaluation error');
    });

    it('should emit verify:invariant:broken on violation', () => {
      const handler = vi.fn();
      monitor.on('verify:invariant:broken', handler);

      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'x > 0' }));
      monitor.check({ x: -1 });

      expect(handler).toHaveBeenCalledTimes(1);
      const violation = handler.mock.calls[0][0];
      expect(violation.invariantId).toBe('inv_1');
      expect(violation.contractId).toBe('c1');
    });

    it('should not emit events when all invariants pass', () => {
      const handler = vi.fn();
      monitor.on('verify:invariant:broken', handler);

      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'true' }));
      monitor.check({});

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ─── Violation Handlers ───────────────────────────────────────

  describe('onViolation', () => {
    it('should call registered handlers on violation', () => {
      const handler = vi.fn();
      monitor.onViolation(handler);

      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'false' }));
      monitor.check({});

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].invariantId).toBe('inv_1');
    });

    it('should call multiple handlers', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      monitor.onViolation(h1);
      monitor.onViolation(h2);

      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'false' }));
      monitor.check({});

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('should swallow errors thrown by handlers', () => {
      monitor.onViolation(() => {
        throw new Error('handler crash');
      });

      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'false' }));

      // Should not throw
      expect(() => monitor.check({})).not.toThrow();
      expect(monitor.getViolations()).toHaveLength(1);
    });
  });

  // ─── Violations ───────────────────────────────────────────────

  describe('getViolations', () => {
    it('should return an empty array initially', () => {
      expect(monitor.getViolations()).toEqual([]);
    });

    it('should return a copy of the violations array', () => {
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'false' }));
      monitor.check({});

      const v1 = monitor.getViolations();
      const v2 = monitor.getViolations();
      expect(v1).toEqual(v2);
      expect(v1).not.toBe(v2);
    });

    it('should accumulate violations across multiple checks', () => {
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'false' }));
      monitor.check({});
      monitor.check({});
      monitor.check({});

      expect(monitor.getViolations()).toHaveLength(3);
    });

    it('should cap violations at maxViolations', () => {
      const limited = new InvariantMonitor({ maxViolations: 3 });
      limited.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'false' }));

      for (let i = 0; i < 5; i++) {
        limited.check({});
      }

      expect(limited.getViolations()).toHaveLength(3);
    });
  });

  // ─── Continuous Monitoring ────────────────────────────────────

  describe('startMonitoring / stopMonitoring', () => {
    it('should periodically check invariants', async () => {
      vi.useFakeTimers();

      const contextProvider = vi.fn(() => ({ x: -1 }));
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'x > 0' }));

      monitor.startMonitoring(100, contextProvider);

      vi.advanceTimersByTime(350);

      expect(contextProvider).toHaveBeenCalledTimes(3);
      expect(monitor.getViolations().length).toBe(3);

      monitor.stopMonitoring();
      vi.useRealTimers();
    });

    it('should stop monitoring when stopMonitoring is called', () => {
      vi.useFakeTimers();

      const contextProvider = vi.fn(() => ({ x: 1 }));
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'x > 0' }));

      monitor.startMonitoring(100, contextProvider);
      vi.advanceTimersByTime(150);
      monitor.stopMonitoring();
      vi.advanceTimersByTime(500);

      // Should have only been called once (at 100ms), not at 200+ ms
      expect(contextProvider).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should stop previous monitoring when starting new one', () => {
      vi.useFakeTimers();

      const provider1 = vi.fn(() => ({ x: 1 }));
      const provider2 = vi.fn(() => ({ x: 2 }));

      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'true' }));

      monitor.startMonitoring(100, provider1);
      monitor.startMonitoring(100, provider2);

      vi.advanceTimersByTime(150);

      // provider1 should not have been called (it was stopped)
      expect(provider1).toHaveBeenCalledTimes(0);
      expect(provider2).toHaveBeenCalledTimes(1);

      monitor.stopMonitoring();
      vi.useRealTimers();
    });
  });

  // ─── Lifecycle ────────────────────────────────────────────────

  describe('destroy', () => {
    it('should clear all state', () => {
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'false' }));
      monitor.check({});

      expect(monitor.getActiveInvariants()).toHaveLength(1);
      expect(monitor.getViolations()).toHaveLength(1);

      monitor.destroy();

      expect(monitor.getActiveInvariants()).toHaveLength(0);
      expect(monitor.getViolations()).toHaveLength(0);
    });

    it('should stop monitoring', () => {
      vi.useFakeTimers();

      const provider = vi.fn(() => ({}));
      monitor.registerInvariant('c1', makeCondition({ id: 'inv_1', expression: 'true' }));
      monitor.startMonitoring(100, provider);
      monitor.destroy();

      vi.advanceTimersByTime(500);
      expect(provider).toHaveBeenCalledTimes(0);

      vi.useRealTimers();
    });
  });
});
