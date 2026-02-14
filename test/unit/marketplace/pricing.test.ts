import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingEngine } from '../../../src/marketplace/pricing.js';
import type { AgentListing, PricingNegotiation } from '../../../src/marketplace/types.js';

describe('PricingEngine', () => {
  let engine: PricingEngine;

  const makeAgent = (overrides: Partial<AgentListing> = {}): AgentListing => ({
    id: 'agent-1',
    name: 'TestAgent',
    description: 'A test agent',
    version: '1.0.0',
    author: { id: 'author-1', name: 'Test Author', verified: true },
    capabilities: ['code-generation'],
    tags: ['typescript'],
    pricing: { model: 'per-call', baseCost: 0.01, currency: 'USD' },
    quality: {
      rating: 4.5,
      totalCalls: 100,
      successRate: 0.95,
      avgLatencyMs: 200,
      avgCostPerCall: 0.01,
    },
    endpoints: { a2aUrl: 'http://localhost:3200' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
    ...overrides,
  });

  beforeEach(() => {
    engine = new PricingEngine({ maxBudget: 10.0, commissionRate: 0.15 });
  });

  // ─────────────────────────────────────────────────────────────
  // CONSTRUCTOR
  // ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates with default options', () => {
      const defaultEngine = new PricingEngine();
      expect(defaultEngine).toBeDefined();
      expect(defaultEngine.getBudgetRemaining()).toBe(10.0);
    });

    it('accepts custom maxBudget', () => {
      const custom = new PricingEngine({ maxBudget: 50.0 });
      expect(custom.getBudgetRemaining()).toBe(50.0);
    });

    it('accepts custom commissionRate', () => {
      const custom = new PricingEngine({ commissionRate: 0.10 });
      const agent = makeAgent({ pricing: { model: 'per-call', baseCost: 1.0, currency: 'USD' } });
      const cost = custom.calculateCost(agent, {});
      // 1.0 * (1 + 0.10) = 1.10
      expect(cost).toBeCloseTo(1.10, 4);
    });

    it('accepts both options together', () => {
      const custom = new PricingEngine({ maxBudget: 100.0, commissionRate: 0.05 });
      expect(custom.getBudgetRemaining()).toBe(100.0);
      const agent = makeAgent({ pricing: { model: 'per-call', baseCost: 1.0, currency: 'USD' } });
      expect(custom.calculateCost(agent, {})).toBeCloseTo(1.05, 4);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // COST CALCULATION — calculateCost()
  // ─────────────────────────────────────────────────────────────

  describe('calculateCost()', () => {
    it('returns 0 for free agents', () => {
      const agent = makeAgent({ pricing: { model: 'free', currency: 'USD' } });
      const cost = engine.calculateCost(agent, {});
      expect(cost).toBe(0);
    });

    it('returns 0 for free agents regardless of callCount or tokensUsed', () => {
      const agent = makeAgent({ pricing: { model: 'free', currency: 'USD' } });
      expect(engine.calculateCost(agent, { callCount: 1000 })).toBe(0);
      expect(engine.calculateCost(agent, { tokensUsed: 100000 })).toBe(0);
    });

    it('calculates per-call cost with baseCost', () => {
      const agent = makeAgent({ pricing: { model: 'per-call', baseCost: 0.10, currency: 'USD' } });
      const cost = engine.calculateCost(agent, { callCount: 1 });
      // 0.10 * 1 * (1 + 0.15) = 0.115
      expect(cost).toBeCloseTo(0.115, 4);
    });

    it('scales per-call cost by callCount', () => {
      const agent = makeAgent({ pricing: { model: 'per-call', baseCost: 0.10, currency: 'USD' } });
      const cost = engine.calculateCost(agent, { callCount: 5 });
      // 0.10 * 5 * (1 + 0.15) = 0.575
      expect(cost).toBeCloseTo(0.575, 4);
    });

    it('defaults callCount to 1', () => {
      const agent = makeAgent({ pricing: { model: 'per-call', baseCost: 0.10, currency: 'USD' } });
      const cost = engine.calculateCost(agent, {});
      // 0.10 * 1 * (1.15) = 0.115
      expect(cost).toBeCloseTo(0.115, 4);
    });

    it('calculates per-token cost', () => {
      const agent = makeAgent({ pricing: { model: 'per-token', tokenRate: 0.003, currency: 'USD' } });
      const cost = engine.calculateCost(agent, { tokensUsed: 2000 });
      // 0.003 * (2000 / 1000) * (1 + 0.15) = 0.003 * 2 * 1.15 = 0.0069
      expect(cost).toBeCloseTo(0.0069, 4);
    });

    it('returns 0 for per-token when no tokens used', () => {
      const agent = makeAgent({ pricing: { model: 'per-token', tokenRate: 0.003, currency: 'USD' } });
      const cost = engine.calculateCost(agent, { tokensUsed: 0 });
      expect(cost).toBe(0);
    });

    it('defaults tokensUsed to 0', () => {
      const agent = makeAgent({ pricing: { model: 'per-token', tokenRate: 0.003, currency: 'USD' } });
      const cost = engine.calculateCost(agent, {});
      expect(cost).toBe(0);
    });

    it('calculates subscription cost (flat fee)', () => {
      const agent = makeAgent({ pricing: { model: 'subscription', baseCost: 9.99, currency: 'USD' } });
      const cost = engine.calculateCost(agent, {});
      // 9.99 * 1.15 = 11.4885
      expect(cost).toBeCloseTo(11.4885, 4);
    });

    it('calculates negotiated cost using baseCost if set', () => {
      const agent = makeAgent({ pricing: { model: 'negotiated', baseCost: 0.50, currency: 'USD' } });
      const cost = engine.calculateCost(agent, {});
      // 0.50 * 1.15 = 0.575
      expect(cost).toBeCloseTo(0.575, 4);
    });

    it('returns 0 for negotiated pricing without baseCost', () => {
      const agent = makeAgent({ pricing: { model: 'negotiated', currency: 'USD' } });
      const cost = engine.calculateCost(agent, {});
      expect(cost).toBe(0);
    });

    it('applies per-call bulk discounts', () => {
      const agent = makeAgent({
        pricing: {
          model: 'per-call',
          baseCost: 0.10,
          currency: 'USD',
          bulkDiscount: [
            { threshold: 100, discount: 0.2 },
            { threshold: 50, discount: 0.1 },
          ],
        },
      });

      // 100 calls: 0.10 * 100 = 10.0, discount 20% => 8.0, commission => 8.0 * 1.15 = 9.2
      const cost = engine.calculateCost(agent, { callCount: 100 });
      expect(cost).toBeCloseTo(9.2, 4);
    });

    it('does not apply bulk discounts for per-token model', () => {
      const agent = makeAgent({
        pricing: {
          model: 'per-token',
          tokenRate: 0.003,
          currency: 'USD',
          bulkDiscount: [{ threshold: 1, discount: 0.5 }],
        },
      });
      const cost = engine.calculateCost(agent, { tokensUsed: 1000 });
      // No discount for per-token: 0.003 * 1 * 1.15 = 0.00345
      expect(cost).toBeCloseTo(0.00345, 5);
    });

    it('handles unknown pricing model gracefully', () => {
      const agent = makeAgent({ pricing: { model: 'unknown' as any, baseCost: 1.0, currency: 'USD' } });
      const cost = engine.calculateCost(agent, {});
      // Falls through to default: baseCost * (1 + commission)
      expect(cost).toBeCloseTo(1.15, 4);
    });

    it('handles per-call with no baseCost', () => {
      const agent = makeAgent({ pricing: { model: 'per-call', currency: 'USD' } });
      const cost = engine.calculateCost(agent, { callCount: 5 });
      // 0 * 5 * 1.15 = 0
      expect(cost).toBe(0);
    });

    it('rounds to 6 decimal places', () => {
      const agent = makeAgent({ pricing: { model: 'per-token', tokenRate: 0.0033, currency: 'USD' } });
      const cost = engine.calculateCost(agent, { tokensUsed: 1234 });
      const decimalPart = cost.toString().split('.')[1] || '';
      expect(decimalPart.length).toBeLessThanOrEqual(6);
    });

    it('handles subscription pricing ignoring callCount', () => {
      const agent = makeAgent({ pricing: { model: 'subscription', baseCost: 5.0, currency: 'USD' } });
      const cost1 = engine.calculateCost(agent, { callCount: 1 });
      const cost100 = engine.calculateCost(agent, { callCount: 100 });
      expect(cost1).toBe(cost100); // Subscription is flat
    });
  });

  // ─────────────────────────────────────────────────────────────
  // BULK DISCOUNTS — applyBulkDiscount()
  // ─────────────────────────────────────────────────────────────

  describe('applyBulkDiscount()', () => {
    it('returns baseCost when no discounts provided', () => {
      expect(engine.applyBulkDiscount(100, 50)).toBe(100);
    });

    it('returns baseCost when discounts array is empty', () => {
      expect(engine.applyBulkDiscount(100, 50, [])).toBe(100);
    });

    it('returns baseCost when discounts is undefined', () => {
      expect(engine.applyBulkDiscount(100, 50, undefined)).toBe(100);
    });

    it('applies the highest matching tier', () => {
      const discounts = [
        { threshold: 10, discount: 0.05 },
        { threshold: 50, discount: 0.10 },
        { threshold: 100, discount: 0.20 },
      ];

      // 75 calls: matches threshold 50 (discount 10%)
      const result = engine.applyBulkDiscount(100, 75, discounts);
      expect(result).toBe(90); // 100 * 0.90
    });

    it('applies the highest tier when multiple match', () => {
      const discounts = [
        { threshold: 10, discount: 0.05 },
        { threshold: 50, discount: 0.10 },
        { threshold: 100, discount: 0.20 },
      ];

      // 200 calls: matches threshold 100 (discount 20%)
      const result = engine.applyBulkDiscount(100, 200, discounts);
      expect(result).toBe(80); // 100 * 0.80
    });

    it('returns baseCost when callCount is below all thresholds', () => {
      const discounts = [{ threshold: 100, discount: 0.20 }];
      const result = engine.applyBulkDiscount(50, 5, discounts);
      expect(result).toBe(50);
    });

    it('clamps discount to maximum 1 (100%)', () => {
      const discounts = [{ threshold: 1, discount: 1.5 }]; // Over 100%
      const result = engine.applyBulkDiscount(100, 10, discounts);
      expect(result).toBe(0); // Clamped to 100% discount => 0
    });

    it('clamps discount to minimum 0 (0%)', () => {
      const discounts = [{ threshold: 1, discount: -0.5 }]; // Negative
      const result = engine.applyBulkDiscount(100, 10, discounts);
      expect(result).toBe(100); // Clamped to 0% discount => full price
    });

    it('handles exact threshold match', () => {
      const discounts = [
        { threshold: 10, discount: 0.10 },
        { threshold: 50, discount: 0.20 },
      ];

      const result = engine.applyBulkDiscount(100, 10, discounts);
      expect(result).toBe(90); // 100 * (1 - 0.10)
    });

    it('handles unsorted discount tiers', () => {
      const discounts = [
        { threshold: 100, discount: 0.30 },
        { threshold: 10, discount: 0.05 },
        { threshold: 50, discount: 0.15 },
      ];

      const result = engine.applyBulkDiscount(100, 60, discounts);
      // Should pick threshold 50 (discount 15%) since 60 >= 50 but 60 < 100
      expect(result).toBe(85);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // NEGOTIATION — negotiate(), counterOffer(), accept, reject
  // ─────────────────────────────────────────────────────────────

  describe('negotiate()', () => {
    it('creates a pending negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);

      expect(neg).toBeDefined();
      expect(neg.id).toBeDefined();
      expect(typeof neg.id).toBe('string');
      expect(neg.buyerAgentId).toBe('buyer-1');
      expect(neg.sellerAgentId).toBe(agent.id);
      expect(neg.proposedPrice).toBe(0.05);
      expect(neg.status).toBe('pending');
      expect(neg.expiresAt).toBeGreaterThan(Date.now());
    });

    it('emits marketplace:negotiation:started event', () => {
      const spy = vi.fn();
      engine.on('marketplace:negotiation:started', spy);

      const agent = makeAgent();
      engine.negotiate('buyer-1', agent, 0.05);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('creates multiple negotiations simultaneously', () => {
      const agent = makeAgent();
      const neg1 = engine.negotiate('buyer-1', agent, 0.05);
      const neg2 = engine.negotiate('buyer-2', agent, 0.10);

      expect(neg1.id).not.toBe(neg2.id);
      expect(engine.getActiveNegotiations()).toHaveLength(2);
    });

    it('sets expiry in the future (approximately 5 minutes)', () => {
      const agent = makeAgent();
      const before = Date.now();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      const fiveMinutesMs = 5 * 60 * 1000;

      expect(neg.expiresAt).toBeGreaterThanOrEqual(before + fiveMinutesMs - 100);
      expect(neg.expiresAt).toBeLessThanOrEqual(before + fiveMinutesMs + 1000);
    });
  });

  describe('counterOffer()', () => {
    it('updates negotiation with counter price', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);

      const updated = engine.counterOffer(neg.id, 0.08);
      expect(updated.counterPrice).toBe(0.08);
      expect(updated.status).toBe('countered');
    });

    it('extends expiry on counter-offer', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      const originalExpiry = neg.expiresAt;

      const updated = engine.counterOffer(neg.id, 0.08);
      expect(updated.expiresAt).toBeGreaterThanOrEqual(originalExpiry);
    });

    it('throws for non-existent negotiation', () => {
      expect(() => engine.counterOffer('nonexistent', 0.05)).toThrow('Negotiation not found');
    });

    it('throws for already accepted negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.acceptNegotiation(neg.id);

      expect(() => engine.counterOffer(neg.id, 0.08)).toThrow('cannot be modified');
    });

    it('throws for already rejected negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.rejectNegotiation(neg.id);

      expect(() => engine.counterOffer(neg.id, 0.08)).toThrow('cannot be modified');
    });

    it('allows counter-offer on a countered negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.counterOffer(neg.id, 0.07);
      const updated = engine.counterOffer(neg.id, 0.06);
      expect(updated.counterPrice).toBe(0.06);
      expect(updated.status).toBe('countered');
    });
  });

  describe('acceptNegotiation()', () => {
    it('marks negotiation as accepted', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      const result = engine.acceptNegotiation(neg.id);

      expect(result.status).toBe('accepted');
    });

    it('emits marketplace:negotiation:completed event', () => {
      const spy = vi.fn();
      engine.on('marketplace:negotiation:completed', spy);

      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.acceptNegotiation(neg.id);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('throws for non-existent negotiation', () => {
      expect(() => engine.acceptNegotiation('nonexistent')).toThrow('Negotiation not found');
    });

    it('can accept a countered negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.counterOffer(neg.id, 0.07);
      const result = engine.acceptNegotiation(neg.id);

      expect(result.status).toBe('accepted');
    });

    it('cannot accept an already accepted negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.acceptNegotiation(neg.id);

      expect(() => engine.acceptNegotiation(neg.id)).toThrow('cannot be modified');
    });
  });

  describe('rejectNegotiation()', () => {
    it('marks negotiation as rejected', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      const result = engine.rejectNegotiation(neg.id);

      expect(result.status).toBe('rejected');
    });

    it('emits marketplace:negotiation:completed event', () => {
      const spy = vi.fn();
      engine.on('marketplace:negotiation:completed', spy);

      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.rejectNegotiation(neg.id);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('cannot reject an already accepted negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.acceptNegotiation(neg.id);

      expect(() => engine.rejectNegotiation(neg.id)).toThrow('cannot be modified');
    });

    it('cannot reject an already rejected negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.rejectNegotiation(neg.id);

      expect(() => engine.rejectNegotiation(neg.id)).toThrow('cannot be modified');
    });

    it('throws for non-existent negotiation', () => {
      expect(() => engine.rejectNegotiation('nonexistent')).toThrow('Negotiation not found');
    });
  });

  describe('expired negotiations', () => {
    it('marks negotiation as expired when checked after expiry', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);

      // Manually set expiresAt to the past
      (neg as any).expiresAt = Date.now() - 1000;

      const fetched = engine.getNegotiation(neg.id);
      expect(fetched!.status).toBe('expired');
    });

    it('throws when trying to accept an expired negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      (neg as any).expiresAt = Date.now() - 1000;

      expect(() => engine.acceptNegotiation(neg.id)).toThrow('expired');
    });

    it('throws when trying to counter-offer an expired negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      (neg as any).expiresAt = Date.now() - 1000;

      expect(() => engine.counterOffer(neg.id, 0.08)).toThrow('expired');
    });

    it('filters out expired negotiations from active list', () => {
      const agent = makeAgent();
      const neg1 = engine.negotiate('buyer-1', agent, 0.05);
      const neg2 = engine.negotiate('buyer-2', agent, 0.10);

      // Expire neg1
      (neg1 as any).expiresAt = Date.now() - 1000;

      const active = engine.getActiveNegotiations();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(neg2.id);
    });

    it('throws when trying to reject an expired negotiation', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      (neg as any).expiresAt = Date.now() - 1000;

      expect(() => engine.rejectNegotiation(neg.id)).toThrow('expired');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // NEGOTIATION QUERIES
  // ─────────────────────────────────────────────────────────────

  describe('getNegotiation()', () => {
    it('returns negotiation by ID', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      const fetched = engine.getNegotiation(neg.id);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(neg.id);
    });

    it('returns undefined for unknown ID', () => {
      const result = engine.getNegotiation('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getActiveNegotiations()', () => {
    it('returns only pending and countered negotiations', () => {
      const agent = makeAgent();
      engine.negotiate('buyer-1', agent, 0.05);                // pending
      const countered = engine.negotiate('buyer-2', agent, 0.10);
      engine.counterOffer(countered.id, 0.08);                 // countered

      const accepted = engine.negotiate('buyer-3', agent, 0.15);
      engine.acceptNegotiation(accepted.id);                    // accepted

      const rejected = engine.negotiate('buyer-4', agent, 0.20);
      engine.rejectNegotiation(rejected.id);                    // rejected

      const active = engine.getActiveNegotiations();
      expect(active).toHaveLength(2);
      const statuses = active.map(n => n.status);
      expect(statuses).toContain('pending');
      expect(statuses).toContain('countered');
    });

    it('returns empty when no active negotiations', () => {
      expect(engine.getActiveNegotiations()).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // BUDGET MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  describe('canAfford()', () => {
    it('returns true when within budget', () => {
      expect(engine.canAfford(5.0)).toBe(true);
    });

    it('returns true for exact remaining amount', () => {
      expect(engine.canAfford(10.0)).toBe(true);
    });

    it('returns false when over budget', () => {
      expect(engine.canAfford(10.01)).toBe(false);
    });

    it('tracks affordability after spending', () => {
      engine.recordSpend(8.0);
      expect(engine.canAfford(2.0)).toBe(true);
      expect(engine.canAfford(2.01)).toBe(false);
    });

    it('returns true for zero cost', () => {
      expect(engine.canAfford(0)).toBe(true);
    });
  });

  describe('recordSpend()', () => {
    it('records spend correctly', () => {
      engine.recordSpend(3.0);
      expect(engine.getBudgetUsed()).toBe(3.0);
      expect(engine.getBudgetRemaining()).toBe(7.0);
    });

    it('allows spending up to exact budget', () => {
      engine.recordSpend(10.0);
      expect(engine.getBudgetRemaining()).toBe(0);
    });

    it('throws when exceeding budget', () => {
      expect(() => engine.recordSpend(10.01)).toThrow('Budget exceeded');
    });

    it('throws with informative message including amounts', () => {
      engine.recordSpend(8.0);
      expect(() => engine.recordSpend(3.0)).toThrow(/Budget exceeded/);
      expect(() => engine.recordSpend(3.0)).toThrow(/remaining/);
    });

    it('accumulates multiple spends', () => {
      engine.recordSpend(2.0);
      engine.recordSpend(3.0);
      engine.recordSpend(1.5);
      expect(engine.getBudgetUsed()).toBe(6.5);
      expect(engine.getBudgetRemaining()).toBe(3.5);
    });
  });

  describe('getBudgetRemaining()', () => {
    it('returns full budget initially', () => {
      expect(engine.getBudgetRemaining()).toBe(10.0);
    });

    it('never returns negative', () => {
      const smallBudget = new PricingEngine({ maxBudget: 1.0 });
      smallBudget.recordSpend(1.0);
      expect(smallBudget.getBudgetRemaining()).toBe(0);
    });
  });

  describe('getBudgetUsed()', () => {
    it('starts at zero', () => {
      expect(engine.getBudgetUsed()).toBe(0);
    });

    it('reflects spending', () => {
      engine.recordSpend(3.5);
      expect(engine.getBudgetUsed()).toBe(3.5);
    });
  });

  describe('resetBudget()', () => {
    it('resets spent amount to zero', () => {
      engine.recordSpend(5.0);
      engine.resetBudget();

      expect(engine.getBudgetUsed()).toBe(0);
      expect(engine.getBudgetRemaining()).toBe(10.0);
    });

    it('allows spending again after reset', () => {
      engine.recordSpend(10.0);
      engine.resetBudget();
      engine.recordSpend(5.0);

      expect(engine.getBudgetUsed()).toBe(5.0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // STATS — getStats()
  // ─────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns initial stats', () => {
      const stats = engine.getStats();
      expect(stats.totalNegotiations).toBe(0);
      expect(stats.acceptedRate).toBe(0);
      expect(stats.budgetUsed).toBe(0);
      expect(stats.budgetRemaining).toBe(10.0);
    });

    it('tracks negotiation stats', () => {
      const agent = makeAgent();
      engine.negotiate('buyer-1', agent, 0.05);
      engine.negotiate('buyer-2', agent, 0.10);
      const neg3 = engine.negotiate('buyer-3', agent, 0.15);
      engine.acceptNegotiation(neg3.id);

      const stats = engine.getStats();
      expect(stats.totalNegotiations).toBe(3);
      expect(stats.acceptedRate).toBeCloseTo(1 / 3, 4);
    });

    it('tracks budget stats', () => {
      engine.recordSpend(4.5);

      const stats = engine.getStats();
      expect(stats.budgetUsed).toBe(4.5);
      expect(stats.budgetRemaining).toBe(5.5);
    });

    it('handles 100% accepted rate', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.acceptNegotiation(neg.id);

      expect(engine.getStats().acceptedRate).toBe(1);
    });

    it('handles 0% accepted rate with negotiations', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      engine.rejectNegotiation(neg.id);

      expect(engine.getStats().acceptedRate).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // EDGE CASES
  // ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles zero-cost per-call agent', () => {
      const agent = makeAgent({ pricing: { model: 'per-call', baseCost: 0, currency: 'USD' } });
      expect(engine.calculateCost(agent, { callCount: 100 })).toBe(0);
    });

    it('handles very large call counts', () => {
      const agent = makeAgent({ pricing: { model: 'per-call', baseCost: 0.001, currency: 'USD' } });
      const cost = engine.calculateCost(agent, { callCount: 1_000_000 });
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeCloseTo(0.001 * 1_000_000 * 1.15, 1);
    });

    it('handles very small token rates', () => {
      const agent = makeAgent({ pricing: { model: 'per-token', tokenRate: 0.0000001, currency: 'USD' } });
      const cost = engine.calculateCost(agent, { tokensUsed: 1000 });
      expect(cost).toBeGreaterThanOrEqual(0);
    });

    it('handles zero budget engine', () => {
      const zeroBudget = new PricingEngine({ maxBudget: 0 });
      expect(zeroBudget.canAfford(0)).toBe(true);
      expect(zeroBudget.canAfford(0.01)).toBe(false);
    });

    it('handles zero commission rate', () => {
      const noCommission = new PricingEngine({ commissionRate: 0 });
      const agent = makeAgent({ pricing: { model: 'per-call', baseCost: 1.0, currency: 'USD' } });
      const cost = noCommission.calculateCost(agent, {});
      expect(cost).toBe(1.0);
    });

    it('handles 100% commission rate', () => {
      const fullCommission = new PricingEngine({ commissionRate: 1.0 });
      const agent = makeAgent({ pricing: { model: 'per-call', baseCost: 1.0, currency: 'USD' } });
      const cost = fullCommission.calculateCost(agent, {});
      expect(cost).toBe(2.0); // 1.0 * (1 + 1.0)
    });
  });

  // ─────────────────────────────────────────────────────────────
  // STRESS TESTS
  // ─────────────────────────────────────────────────────────────

  describe('stress tests', () => {
    it('handles rapid cost calculations', () => {
      const agent = makeAgent();
      for (let i = 0; i < 1000; i++) {
        const cost = engine.calculateCost(agent, { callCount: i, tokensUsed: i * 100 });
        expect(cost).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles many concurrent negotiations', () => {
      const agent = makeAgent();
      const negotiations: PricingNegotiation[] = [];

      for (let i = 0; i < 100; i++) {
        negotiations.push(engine.negotiate(`buyer-${i}`, agent, 0.01 * i));
      }

      expect(negotiations).toHaveLength(100);
      expect(engine.getStats().totalNegotiations).toBe(100);

      // Accept half
      for (let i = 0; i < 50; i++) {
        engine.acceptNegotiation(negotiations[i].id);
      }

      // Reject some
      for (let i = 50; i < 75; i++) {
        engine.rejectNegotiation(negotiations[i].id);
      }

      const active = engine.getActiveNegotiations();
      expect(active).toHaveLength(25);
    });

    it('handles rapid spend/reset cycles', () => {
      for (let i = 0; i < 100; i++) {
        engine.recordSpend(5.0);
        engine.resetBudget();
      }

      expect(engine.getBudgetUsed()).toBe(0);
      expect(engine.getBudgetRemaining()).toBe(10.0);
    });

    it('handles many small spends without floating point issues', () => {
      const smallEngine = new PricingEngine({ maxBudget: 1.0 });

      for (let i = 0; i < 99; i++) {
        smallEngine.recordSpend(0.01);
      }

      expect(smallEngine.getBudgetRemaining()).toBeGreaterThan(0);
    });

    it('handles bulk discount with many tiers', () => {
      const tiers = [];
      for (let i = 1; i <= 50; i++) {
        tiers.push({ threshold: i * 10, discount: Math.min(0.5, i * 0.01) });
      }

      const result = engine.applyBulkDiscount(100, 250, tiers);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(100);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // REAL-WORLD SCENARIOS
  // ─────────────────────────────────────────────────────────────

  describe('real-world scenarios', () => {
    it('full negotiation lifecycle: create -> counter -> accept', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      expect(neg.status).toBe('pending');

      const countered = engine.counterOffer(neg.id, 0.08);
      expect(countered.status).toBe('countered');
      expect(countered.counterPrice).toBe(0.08);

      const accepted = engine.acceptNegotiation(neg.id);
      expect(accepted.status).toBe('accepted');
    });

    it('full negotiation lifecycle: create -> reject', () => {
      const agent = makeAgent();
      const neg = engine.negotiate('buyer-1', agent, 0.05);
      const rejected = engine.rejectNegotiation(neg.id);
      expect(rejected.status).toBe('rejected');
    });

    it('budget-constrained hiring scenario', () => {
      const budgetEngine = new PricingEngine({ maxBudget: 1.0, commissionRate: 0.15 });
      const agent = makeAgent({ pricing: { model: 'per-call', baseCost: 0.10, currency: 'USD' } });

      let callsMade = 0;
      while (true) {
        const cost = budgetEngine.calculateCost(agent, { callCount: 1 });
        if (!budgetEngine.canAfford(cost)) break;
        budgetEngine.recordSpend(cost);
        callsMade++;
      }

      expect(callsMade).toBe(8); // 8 * 0.115 = 0.92, 9th would be 1.035
      expect(budgetEngine.getBudgetRemaining()).toBeLessThan(0.115);
    });

    it('volume discount scenario', () => {
      const agent = makeAgent({
        pricing: {
          model: 'per-call',
          baseCost: 0.10,
          currency: 'USD',
          bulkDiscount: [
            { threshold: 10, discount: 0.05 },
            { threshold: 50, discount: 0.15 },
            { threshold: 100, discount: 0.25 },
          ],
        },
      });

      const cost5 = engine.calculateCost(agent, { callCount: 5 });
      const cost10 = engine.calculateCost(agent, { callCount: 10 });
      const cost50 = engine.calculateCost(agent, { callCount: 50 });
      const cost100 = engine.calculateCost(agent, { callCount: 100 });

      // Per-unit cost should decrease with volume
      expect(cost10 / 10).toBeLessThan(cost5 / 5);
      expect(cost50 / 50).toBeLessThan(cost10 / 10);
      expect(cost100 / 100).toBeLessThan(cost50 / 50);
    });

    it('mixed negotiation states yield correct stats', () => {
      const agent = makeAgent();

      // Create 10 negotiations
      const negs = [];
      for (let i = 0; i < 10; i++) {
        negs.push(engine.negotiate(`buyer-${i}`, agent, i * 0.01));
      }

      // Accept 3, reject 2, counter 2, leave 3 pending
      engine.acceptNegotiation(negs[0].id);
      engine.acceptNegotiation(negs[1].id);
      engine.acceptNegotiation(negs[2].id);
      engine.rejectNegotiation(negs[3].id);
      engine.rejectNegotiation(negs[4].id);
      engine.counterOffer(negs[5].id, 0.05);
      engine.counterOffer(negs[6].id, 0.06);

      const stats = engine.getStats();
      expect(stats.totalNegotiations).toBe(10);
      expect(stats.acceptedRate).toBeCloseTo(0.3, 4); // 3 out of 10

      const active = engine.getActiveNegotiations();
      expect(active).toHaveLength(5); // 3 pending + 2 countered
    });
  });
});
