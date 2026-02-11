import { describe, it, expect } from 'vitest';
import { ModelRouter } from '../../../src/cost/router.js';

describe('ModelRouter', () => {
  function createRouter() {
    return new ModelRouter('anthropic');
  }

  it('should route developer role to powerful model', () => {
    const router = createRouter();
    const decision = router.route({
      role: 'developer',
      complexity: 0.7,
      estimatedTokens: 5000,
      budget: 5.0,
    });

    // Developer gets powerful model for high complexity
    expect(decision).toBeDefined();
    expect(decision.model).toBeDefined();
    expect(decision.tier).toBe('powerful');
  });

  it('should route researcher role to fast model', () => {
    const router = createRouter();
    const decision = router.route({
      role: 'researcher',
      complexity: 0.3,
      estimatedTokens: 3000,
      budget: 5.0,
    });

    expect(decision).toBeDefined();
    expect(decision.tier).toBe('fast');
  });

  it('should prefer cheap models when preferCheap is set', () => {
    const router = new ModelRouter('anthropic', true);
    const decision = router.route({ role: 'developer', complexity: 0.9, estimatedTokens: 5000, budget: 5.0 });

    // When preferCheap, even high complexity developer gets fast tier
    expect(decision.model).toBeDefined();
    expect(decision.tier).toBe('fast');
  });
});
