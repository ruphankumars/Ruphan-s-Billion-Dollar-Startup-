/**
 * Pricing Engine — Handles Pricing, Negotiation, and Budget Management
 *
 * Calculates agent call costs based on pricing model, manages pricing
 * negotiations between buyer/seller agents, enforces budget limits,
 * and applies bulk discounts.
 * Uses Node.js built-in modules — zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AgentListing,
  AgentPricing,
  PricingNegotiation,
  MarketplaceEventType,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// PRICING ENGINE
// ═══════════════════════════════════════════════════════════════

/** Default negotiation expiry: 5 minutes */
const DEFAULT_NEGOTIATION_TTL_MS = 5 * 60 * 1000;

export class PricingEngine extends EventEmitter {
  private negotiations: Map<string, PricingNegotiation> = new Map();
  private budgetUsed: number = 0;
  private readonly maxBudget: number;
  private readonly commissionRate: number;

  constructor(options?: { maxBudget?: number; commissionRate?: number }) {
    super();
    this.maxBudget = options?.maxBudget ?? 10.0;       // $10 default session budget
    this.commissionRate = options?.commissionRate ?? 0.15; // 15% platform commission
  }

  // ─────────────────────────────────────────────────────────────
  // COST CALCULATION
  // ─────────────────────────────────────────────────────────────

  /**
   * Calculate the cost for a call to an agent based on its pricing model.
   *
   * Pricing models:
   * - free: always 0
   * - per-call: baseCost * callCount, with optional bulk discounts
   * - per-token: tokenRate * (tokensUsed / 1000)
   * - subscription: baseCost (flat fee regardless of usage)
   * - negotiated: baseCost if set, otherwise 0 (requires negotiation)
   *
   * Commission is added on top of the base cost.
   */
  calculateCost(
    agent: AgentListing,
    params: { tokensUsed?: number; callCount?: number },
  ): number {
    const pricing = agent.pricing;
    const callCount = params.callCount ?? 1;
    const tokensUsed = params.tokensUsed ?? 0;
    let cost = 0;

    switch (pricing.model) {
      case 'free':
        return 0;

      case 'per-call': {
        const baseCost = pricing.baseCost ?? 0;
        cost = baseCost * callCount;
        // Apply bulk discounts if available
        if (pricing.bulkDiscount && pricing.bulkDiscount.length > 0) {
          cost = this.applyBulkDiscount(cost, callCount, pricing.bulkDiscount);
        }
        break;
      }

      case 'per-token': {
        const tokenRate = pricing.tokenRate ?? 0;
        cost = tokenRate * (tokensUsed / 1000);
        break;
      }

      case 'subscription': {
        cost = pricing.baseCost ?? 0;
        break;
      }

      case 'negotiated': {
        cost = pricing.baseCost ?? 0;
        break;
      }

      default:
        cost = pricing.baseCost ?? 0;
    }

    // Add platform commission
    cost = cost * (1 + this.commissionRate);

    return Math.round(cost * 1_000_000) / 1_000_000; // Round to 6 decimal places
  }

  // ─────────────────────────────────────────────────────────────
  // NEGOTIATION
  // ─────────────────────────────────────────────────────────────

  /**
   * Start a pricing negotiation with a seller agent.
   * Creates a pending negotiation that expires after DEFAULT_NEGOTIATION_TTL_MS.
   */
  negotiate(
    buyerAgentId: string,
    sellerAgent: AgentListing,
    proposedPrice: number,
  ): PricingNegotiation {
    // Clean up expired negotiations first
    this.cleanExpiredNegotiations();

    const negotiation: PricingNegotiation = {
      id: randomUUID(),
      buyerAgentId,
      sellerAgentId: sellerAgent.id,
      proposedPrice,
      status: 'pending',
      expiresAt: Date.now() + DEFAULT_NEGOTIATION_TTL_MS,
    };

    this.negotiations.set(negotiation.id, negotiation);
    this.emit('marketplace:negotiation:started' satisfies MarketplaceEventType, negotiation);
    return negotiation;
  }

  /**
   * Submit a counter-offer to an existing negotiation.
   * Only valid for negotiations in 'pending' or 'countered' status.
   */
  counterOffer(negotiationId: string, counterPrice: number): PricingNegotiation {
    const negotiation = this.getNegotiationOrThrow(negotiationId);
    this.assertNegotiationActive(negotiation);

    negotiation.counterPrice = counterPrice;
    negotiation.status = 'countered';
    // Extend expiry on counter-offer
    negotiation.expiresAt = Date.now() + DEFAULT_NEGOTIATION_TTL_MS;

    return negotiation;
  }

  /**
   * Accept a negotiation. Sets the final agreed price.
   */
  acceptNegotiation(negotiationId: string): PricingNegotiation {
    const negotiation = this.getNegotiationOrThrow(negotiationId);
    this.assertNegotiationActive(negotiation);

    negotiation.status = 'accepted';
    this.emit('marketplace:negotiation:completed' satisfies MarketplaceEventType, negotiation);
    return negotiation;
  }

  /**
   * Reject a negotiation.
   */
  rejectNegotiation(negotiationId: string): PricingNegotiation {
    const negotiation = this.getNegotiationOrThrow(negotiationId);
    this.assertNegotiationActive(negotiation);

    negotiation.status = 'rejected';
    this.emit('marketplace:negotiation:completed' satisfies MarketplaceEventType, negotiation);
    return negotiation;
  }

  // ─────────────────────────────────────────────────────────────
  // BUDGET MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if the remaining budget can afford a given cost.
   */
  canAfford(cost: number): boolean {
    return (this.budgetUsed + cost) <= this.maxBudget;
  }

  /**
   * Record a spend against the session budget.
   * Throws if the spend would exceed the budget.
   */
  recordSpend(amount: number): void {
    if (!this.canAfford(amount)) {
      throw new Error(
        `Budget exceeded: cannot spend $${amount.toFixed(4)}, ` +
        `only $${this.getBudgetRemaining().toFixed(4)} remaining of $${this.maxBudget.toFixed(2)} budget`,
      );
    }
    this.budgetUsed += amount;
  }

  /**
   * Get the remaining budget for this session.
   */
  getBudgetRemaining(): number {
    return Math.max(0, this.maxBudget - this.budgetUsed);
  }

  /**
   * Get the total amount spent so far in this session.
   */
  getBudgetUsed(): number {
    return this.budgetUsed;
  }

  /**
   * Reset the session budget to zero spent.
   */
  resetBudget(): void {
    this.budgetUsed = 0;
  }

  // ─────────────────────────────────────────────────────────────
  // NEGOTIATION QUERIES
  // ─────────────────────────────────────────────────────────────

  /**
   * Get a negotiation by ID.
   */
  getNegotiation(id: string): PricingNegotiation | undefined {
    const negotiation = this.negotiations.get(id);
    if (negotiation && this.isExpired(negotiation)) {
      negotiation.status = 'expired';
    }
    return negotiation;
  }

  /**
   * Get all active (non-expired, non-terminal) negotiations.
   */
  getActiveNegotiations(): PricingNegotiation[] {
    this.cleanExpiredNegotiations();
    return Array.from(this.negotiations.values()).filter(
      n => n.status === 'pending' || n.status === 'countered',
    );
  }

  // ─────────────────────────────────────────────────────────────
  // BULK DISCOUNTS
  // ─────────────────────────────────────────────────────────────

  /**
   * Apply bulk discount tiers to a base cost.
   * Discounts are sorted by threshold descending and the first matching tier is applied.
   * Each discount tier specifies a call count threshold and a discount percentage (0-1).
   */
  applyBulkDiscount(
    baseCost: number,
    callCount: number,
    discounts?: AgentPricing['bulkDiscount'],
  ): number {
    if (!discounts || discounts.length === 0) {
      return baseCost;
    }

    // Sort discounts by threshold descending (highest first)
    const sorted = [...discounts].sort((a, b) => b.threshold - a.threshold);

    // Find the first tier where callCount meets the threshold
    for (const tier of sorted) {
      if (callCount >= tier.threshold) {
        const discountMultiplier = 1 - Math.min(Math.max(tier.discount, 0), 1);
        return baseCost * discountMultiplier;
      }
    }

    return baseCost;
  }

  // ─────────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get pricing engine statistics.
   */
  getStats(): {
    totalNegotiations: number;
    acceptedRate: number;
    budgetUsed: number;
    budgetRemaining: number;
  } {
    const allNegotiations = Array.from(this.negotiations.values());
    const total = allNegotiations.length;
    const accepted = allNegotiations.filter(n => n.status === 'accepted').length;

    return {
      totalNegotiations: total,
      acceptedRate: total > 0 ? accepted / total : 0,
      budgetUsed: this.budgetUsed,
      budgetRemaining: this.getBudgetRemaining(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get a negotiation or throw if not found.
   */
  private getNegotiationOrThrow(id: string): PricingNegotiation {
    const negotiation = this.negotiations.get(id);
    if (!negotiation) {
      throw new Error(`Negotiation not found: ${id}`);
    }
    return negotiation;
  }

  /**
   * Assert that a negotiation is still actionable (pending or countered and not expired).
   */
  private assertNegotiationActive(negotiation: PricingNegotiation): void {
    if (this.isExpired(negotiation)) {
      negotiation.status = 'expired';
      throw new Error(`Negotiation ${negotiation.id} has expired`);
    }
    if (negotiation.status !== 'pending' && negotiation.status !== 'countered') {
      throw new Error(
        `Negotiation ${negotiation.id} is ${negotiation.status} and cannot be modified`,
      );
    }
  }

  /**
   * Check if a negotiation has passed its expiry time.
   */
  private isExpired(negotiation: PricingNegotiation): boolean {
    return Date.now() > negotiation.expiresAt;
  }

  /**
   * Clean up expired negotiations by marking them as expired.
   */
  private cleanExpiredNegotiations(): void {
    const negotiations = Array.from(this.negotiations.values());
    for (const negotiation of negotiations) {
      if (this.isExpired(negotiation) && negotiation.status !== 'expired') {
        negotiation.status = 'expired';
      }
    }
  }
}
