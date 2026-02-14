/**
 * NegotiationEngine — Multi-Round Agent Negotiation
 *
 * Implements multi-round bid/ask negotiation between buyer and seller agents.
 * Supports configurable max rounds and auto-timeout detection.
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Negotiation,
  NegotiationRound,
  NegotiationStatus,
  CommerceConfig,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface NegotiationOptions {
  /** Initial bid price from buyer */
  initialBid?: number;
  /** Initial ask price from seller */
  initialAsk?: number;
  /** Maximum rounds override */
  maxRounds?: number;
}

interface NegotiationFilter {
  status?: NegotiationStatus;
  buyerAgentId?: string;
  sellerAgentId?: string;
  taskId?: string;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_MAX_ROUNDS = 10;

// ═══════════════════════════════════════════════════════════════
// NEGOTIATION ENGINE
// ═══════════════════════════════════════════════════════════════

export class NegotiationEngine extends EventEmitter {
  private negotiations: Map<string, Negotiation> = new Map();
  private maxRounds: number;
  private running = false;
  private totalAgreed = 0;
  private totalTransacted = 0;

  constructor(config?: Partial<CommerceConfig>) {
    super();
    this.maxRounds = config?.maxNegotiationRounds ?? DEFAULT_MAX_ROUNDS;
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('commerce:negotiation:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('commerce:negotiation:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Start a new negotiation between buyer and seller agents.
   */
  startNegotiation(
    buyerId: string,
    sellerId: string,
    taskId: string,
    options?: NegotiationOptions,
  ): Negotiation {
    const id = `neg_${randomUUID().slice(0, 8)}`;

    const negotiation: Negotiation = {
      id,
      buyerAgentId: buyerId,
      sellerAgentId: sellerId,
      taskId,
      rounds: [],
      status: 'active',
      maxRounds: options?.maxRounds ?? this.maxRounds,
      createdAt: Date.now(),
    };

    // If initial bid and ask are provided, create the first round
    if (options?.initialBid !== undefined && options?.initialAsk !== undefined) {
      negotiation.rounds.push({
        round: 1,
        bidPrice: options.initialBid,
        askPrice: options.initialAsk,
        notes: 'Initial offer',
      });
    }

    this.negotiations.set(id, negotiation);

    this.emit('commerce:negotiation:created', {
      timestamp: Date.now(),
      negotiation,
    });

    return negotiation;
  }

  /**
   * Buyer submits a counter-offer (bid price).
   * Creates a new round if the current round has an ask but no bid,
   * or starts a new round.
   */
  submitBid(negotiationId: string, price: number, notes?: string): NegotiationRound {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) {
      throw new Error(`Negotiation not found: ${negotiationId}`);
    }
    if (negotiation.status !== 'active') {
      throw new Error(`Negotiation ${negotiationId} is ${negotiation.status}, cannot submit bid`);
    }

    // Check if we need a new round
    const currentRound = negotiation.rounds[negotiation.rounds.length - 1];
    let round: NegotiationRound;

    if (!currentRound || (currentRound.bidPrice > 0 && currentRound.askPrice > 0)) {
      // Start a new round
      round = {
        round: negotiation.rounds.length + 1,
        bidPrice: price,
        askPrice: 0,
        notes: notes ?? '',
      };
      negotiation.rounds.push(round);
    } else {
      // Update current round
      currentRound.bidPrice = price;
      if (notes) currentRound.notes = (currentRound.notes ? currentRound.notes + '; ' : '') + notes;
      round = currentRound;
    }

    // Check for auto-timeout
    if (negotiation.rounds.length >= negotiation.maxRounds) {
      negotiation.status = 'timeout';
      this.emit('commerce:negotiation:timeout', {
        timestamp: Date.now(),
        negotiationId,
      });
    }

    this.emit('commerce:negotiation:bid', {
      timestamp: Date.now(),
      negotiationId,
      round,
    });

    return round;
  }

  /**
   * Seller responds with an ask price.
   */
  submitAsk(negotiationId: string, price: number, notes?: string): NegotiationRound {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) {
      throw new Error(`Negotiation not found: ${negotiationId}`);
    }
    if (negotiation.status !== 'active') {
      throw new Error(`Negotiation ${negotiationId} is ${negotiation.status}, cannot submit ask`);
    }

    const currentRound = negotiation.rounds[negotiation.rounds.length - 1];
    let round: NegotiationRound;

    if (!currentRound || (currentRound.bidPrice > 0 && currentRound.askPrice > 0)) {
      // Start a new round
      round = {
        round: negotiation.rounds.length + 1,
        bidPrice: 0,
        askPrice: price,
        notes: notes ?? '',
      };
      negotiation.rounds.push(round);
    } else {
      // Update current round
      currentRound.askPrice = price;
      if (notes) currentRound.notes = (currentRound.notes ? currentRound.notes + '; ' : '') + notes;
      round = currentRound;
    }

    // Check for auto-timeout
    if (negotiation.rounds.length >= negotiation.maxRounds) {
      negotiation.status = 'timeout';
      this.emit('commerce:negotiation:timeout', {
        timestamp: Date.now(),
        negotiationId,
      });
    }

    this.emit('commerce:negotiation:ask', {
      timestamp: Date.now(),
      negotiationId,
      round,
    });

    return round;
  }

  /**
   * Accept the current terms. The agreed price is the midpoint of
   * the last bid and ask.
   */
  acceptDeal(negotiationId: string): Negotiation {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) {
      throw new Error(`Negotiation not found: ${negotiationId}`);
    }
    if (negotiation.status !== 'active') {
      throw new Error(`Negotiation ${negotiationId} is ${negotiation.status}, cannot accept`);
    }

    const lastRound = negotiation.rounds[negotiation.rounds.length - 1];
    if (!lastRound) {
      throw new Error('No rounds in negotiation, cannot accept');
    }

    // Agreed price is the midpoint of bid and ask
    const bid = lastRound.bidPrice || 0;
    const ask = lastRound.askPrice || 0;
    negotiation.agreedPrice = bid > 0 && ask > 0
      ? (bid + ask) / 2
      : bid || ask;
    negotiation.status = 'agreed';
    this.totalAgreed++;
    this.totalTransacted += negotiation.agreedPrice;

    this.emit('commerce:negotiation:agreed', {
      timestamp: Date.now(),
      negotiationId,
      agreedPrice: negotiation.agreedPrice,
    });

    return negotiation;
  }

  /**
   * Reject the deal and end the negotiation.
   */
  rejectDeal(negotiationId: string): Negotiation {
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) {
      throw new Error(`Negotiation not found: ${negotiationId}`);
    }
    if (negotiation.status !== 'active') {
      throw new Error(`Negotiation ${negotiationId} is ${negotiation.status}, cannot reject`);
    }

    negotiation.status = 'failed';

    this.emit('commerce:negotiation:failed', {
      timestamp: Date.now(),
      negotiationId,
    });

    return negotiation;
  }

  /**
   * Get a negotiation by ID.
   */
  getNegotiation(id: string): Negotiation | undefined {
    return this.negotiations.get(id);
  }

  /**
   * List negotiations, optionally filtered.
   */
  listNegotiations(filter?: NegotiationFilter): Negotiation[] {
    let results = [...this.negotiations.values()];

    if (filter) {
      if (filter.status) {
        results = results.filter((n) => n.status === filter.status);
      }
      if (filter.buyerAgentId) {
        results = results.filter((n) => n.buyerAgentId === filter.buyerAgentId);
      }
      if (filter.sellerAgentId) {
        results = results.filter((n) => n.sellerAgentId === filter.sellerAgentId);
      }
      if (filter.taskId) {
        results = results.filter((n) => n.taskId === filter.taskId);
      }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get statistics.
   */
  getStats(): {
    total: number;
    active: number;
    agreed: number;
    failed: number;
    timeout: number;
    totalTransacted: number;
    avgAgreedPrice: number;
  } {
    const all = [...this.negotiations.values()];
    return {
      total: all.length,
      active: all.filter((n) => n.status === 'active').length,
      agreed: all.filter((n) => n.status === 'agreed').length,
      failed: all.filter((n) => n.status === 'failed').length,
      timeout: all.filter((n) => n.status === 'timeout').length,
      totalTransacted: this.totalTransacted,
      avgAgreedPrice: this.totalAgreed > 0 ? this.totalTransacted / this.totalAgreed : 0,
    };
  }
}
