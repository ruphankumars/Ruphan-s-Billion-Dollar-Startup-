/**
 * AuctionSystem — Agent Task Auctions
 *
 * Manages task auctions where agents bid to complete work.
 * Awards tasks to the best bid (lowest price with highest confidence).
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  Auction,
  AuctionStatus,
  Bid,
  CommerceConfig,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface AuctionFilter {
  status?: AuctionStatus;
  taskId?: string;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_AUCTION_DURATION_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_CURRENCY = 'credits';

// ═══════════════════════════════════════════════════════════════
// AUCTION SYSTEM
// ═══════════════════════════════════════════════════════════════

export class AuctionSystem extends EventEmitter {
  private auctions: Map<string, Auction> = new Map();
  private config: Partial<CommerceConfig>;
  private running = false;
  private totalAwarded = 0;
  private totalAwardedValue = 0;

  constructor(config?: Partial<CommerceConfig>) {
    super();
    this.config = config ?? {};
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('commerce:auction:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('commerce:auction:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Create a new auction for a task.
   */
  createAuction(
    taskId: string,
    description: string,
    requirements: string[],
    maxBudget: number,
    deadline?: number,
  ): Auction {
    const id = `auc_${randomUUID().slice(0, 8)}`;
    const now = Date.now();
    const maxDuration = this.config.maxAuctionDuration ?? DEFAULT_AUCTION_DURATION_MS;

    const auction: Auction = {
      id,
      taskId,
      description,
      requirements,
      maxBudget,
      bids: [],
      status: 'open',
      createdAt: now,
      deadline: deadline ?? now + maxDuration,
    };

    this.auctions.set(id, auction);

    this.emit('commerce:auction:created', {
      timestamp: now,
      auction,
    });

    return auction;
  }

  /**
   * Submit a bid to an auction.
   */
  submitBid(auctionId: string, bid: Omit<Bid, 'id' | 'createdAt'>): Bid {
    const auction = this.auctions.get(auctionId);
    if (!auction) {
      throw new Error(`Auction not found: ${auctionId}`);
    }
    if (auction.status !== 'open') {
      throw new Error(`Auction ${auctionId} is ${auction.status}, cannot accept bids`);
    }
    if (Date.now() > auction.deadline) {
      auction.status = 'closed';
      throw new Error(`Auction ${auctionId} has passed its deadline`);
    }
    if (bid.price > auction.maxBudget) {
      throw new Error(`Bid price ${bid.price} exceeds max budget ${auction.maxBudget}`);
    }

    const fullBid: Bid = {
      id: `bid_${randomUUID().slice(0, 8)}`,
      createdAt: Date.now(),
      ...bid,
    };

    auction.bids.push(fullBid);

    this.emit('commerce:auction:bid', {
      timestamp: Date.now(),
      auctionId,
      bid: fullBid,
    });

    return fullBid;
  }

  /**
   * Close an auction and award to the best bid.
   * Best bid = lowest price with highest confidence.
   * Score = (1 - normalized_price) * 0.4 + confidence * 0.6
   */
  closeAuction(auctionId: string): Auction {
    const auction = this.auctions.get(auctionId);
    if (!auction) {
      throw new Error(`Auction not found: ${auctionId}`);
    }
    if (auction.status !== 'open') {
      throw new Error(`Auction ${auctionId} is already ${auction.status}`);
    }

    if (auction.bids.length === 0) {
      auction.status = 'cancelled';
      this.emit('commerce:auction:cancelled', {
        timestamp: Date.now(),
        auctionId,
        reason: 'No bids received',
      });
      return auction;
    }

    // Score each bid: lower price and higher confidence = better
    const maxPrice = Math.max(...auction.bids.map((b) => b.price));
    const minPrice = Math.min(...auction.bids.map((b) => b.price));
    const priceRange = maxPrice - minPrice || 1;

    let bestBid: Bid | null = null;
    let bestScore = -1;

    for (const bid of auction.bids) {
      // Filter out expired bids
      if (bid.expiresAt && bid.expiresAt < Date.now()) continue;

      // Normalize price (lower is better, so invert)
      const normalizedPrice = (maxPrice - bid.price) / priceRange;
      const score = normalizedPrice * 0.4 + bid.confidence * 0.6;

      if (score > bestScore) {
        bestScore = score;
        bestBid = bid;
      }
    }

    if (bestBid) {
      auction.winnerId = bestBid.agentId;
      auction.status = 'awarded';
      this.totalAwarded++;
      this.totalAwardedValue += bestBid.price;

      this.emit('commerce:auction:awarded', {
        timestamp: Date.now(),
        auctionId,
        winnerId: bestBid.agentId,
        winningBid: bestBid,
      });
    } else {
      auction.status = 'cancelled';
      this.emit('commerce:auction:cancelled', {
        timestamp: Date.now(),
        auctionId,
        reason: 'All bids expired',
      });
    }

    return auction;
  }

  /**
   * Cancel an auction.
   */
  cancelAuction(auctionId: string): Auction {
    const auction = this.auctions.get(auctionId);
    if (!auction) {
      throw new Error(`Auction not found: ${auctionId}`);
    }
    if (auction.status !== 'open') {
      throw new Error(`Auction ${auctionId} is already ${auction.status}`);
    }

    auction.status = 'cancelled';

    this.emit('commerce:auction:cancelled', {
      timestamp: Date.now(),
      auctionId,
      reason: 'Manually cancelled',
    });

    return auction;
  }

  /**
   * Get an auction by ID.
   */
  getAuction(id: string): Auction | undefined {
    return this.auctions.get(id);
  }

  /**
   * List auctions, optionally filtered.
   */
  listAuctions(filter?: AuctionFilter): Auction[] {
    let results = [...this.auctions.values()];

    if (filter) {
      if (filter.status) {
        results = results.filter((a) => a.status === filter.status);
      }
      if (filter.taskId) {
        results = results.filter((a) => a.taskId === filter.taskId);
      }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get all bids for a specific auction.
   */
  getBidsForAuction(auctionId: string): Bid[] {
    const auction = this.auctions.get(auctionId);
    if (!auction) return [];
    return [...auction.bids].sort((a, b) => a.price - b.price);
  }

  /**
   * Get statistics.
   */
  getStats(): {
    total: number;
    open: number;
    awarded: number;
    cancelled: number;
    closed: number;
    totalBids: number;
    avgBidsPerAuction: number;
    totalAwardedValue: number;
  } {
    const all = [...this.auctions.values()];
    const totalBids = all.reduce((sum, a) => sum + a.bids.length, 0);

    return {
      total: all.length,
      open: all.filter((a) => a.status === 'open').length,
      awarded: all.filter((a) => a.status === 'awarded').length,
      cancelled: all.filter((a) => a.status === 'cancelled').length,
      closed: all.filter((a) => a.status === 'closed').length,
      totalBids,
      avgBidsPerAuction: all.length > 0 ? totalBids / all.length : 0,
      totalAwardedValue: this.totalAwardedValue,
    };
  }
}
