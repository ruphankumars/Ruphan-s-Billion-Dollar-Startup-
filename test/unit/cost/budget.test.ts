import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/core/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { BudgetManager } from '../../../src/cost/budget.js';
import { BudgetExceededError } from '../../../src/core/errors.js';

describe('BudgetManager', () => {
  let manager: BudgetManager;
  const budget = { perRun: 10.0, perDay: 50.0 };

  beforeEach(() => {
    manager = new BudgetManager(budget);
  });

  it('initial state: remaining = perRun, usedPercent = 0, totalSpent = 0, isExceeded = false', () => {
    expect(manager.remaining).toBe(10.0);
    expect(manager.usedPercent).toBe(0);
    expect(manager.totalSpent).toBe(0);
    expect(manager.isExceeded).toBe(false);
  });

  it('spend() updates totalSpent and remaining', () => {
    manager.spend(3.0);

    expect(manager.totalSpent).toBe(3.0);
    expect(manager.remaining).toBe(7.0);
  });

  it('spend() throws BudgetExceededError when exceeding budget', () => {
    manager.spend(5.0);

    expect(() => manager.spend(6.0)).toThrow(BudgetExceededError);
  });

  it('checkEstimate() throws when estimate + spent > perRun', () => {
    manager.spend(8.0);

    expect(() => manager.checkEstimate(3.0)).toThrow(BudgetExceededError);
  });

  it('checkEstimate() does not throw when within budget', () => {
    manager.spend(3.0);

    expect(() => manager.checkEstimate(5.0)).not.toThrow();
  });

  it('canSpend() returns true when within budget', () => {
    manager.spend(5.0);

    expect(manager.canSpend(5.0)).toBe(true);
  });

  it('canSpend() returns false when would exceed', () => {
    manager.spend(5.0);

    expect(manager.canSpend(5.01)).toBe(false);
  });

  it('usedPercent at 50% after spending half', () => {
    manager.spend(5.0);

    expect(manager.usedPercent).toBeCloseTo(50.0, 5);
  });

  it('reset() resets totalSpent to 0', () => {
    manager.spend(7.0);
    expect(manager.totalSpent).toBe(7.0);

    manager.reset();

    expect(manager.totalSpent).toBe(0);
    expect(manager.remaining).toBe(10.0);
    expect(manager.usedPercent).toBe(0);
    expect(manager.isExceeded).toBe(false);
  });

  it('isExceeded true at or over budget', () => {
    // Spend exactly the budget (spend checks >)
    manager.spend(10.0);

    expect(manager.isExceeded).toBe(true);
  });
});
