import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuctionSystem } from '../../../src/commerce/auction.js';

describe('AuctionSystem', () => {
  let system: AuctionSystem;

  beforeEach(() => {
    system = new AuctionSystem();
  });

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts and stops', () => {
      expect(system.isRunning()).toBe(false);
      system.start();
      expect(system.isRunning()).toBe(true);
      system.stop();
      expect(system.isRunning()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // createAuction()
  // ─────────────────────────────────────────────────────────

  describe('createAuction()', () => {
    it('creates an auction with correct fields', () => {
      const auction = system.createAuction(
        'task-1',
        'Code review task',
        ['typescript', 'testing'],
        1000,
      );

      expect(auction.id).toMatch(/^auc_/);
      expect(auction.taskId).toBe('task-1');
      expect(auction.description).toBe('Code review task');
      expect(auction.requirements).toEqual(['typescript', 'testing']);
      expect(auction.maxBudget).toBe(1000);
      expect(auction.status).toBe('open');
      expect(auction.bids).toEqual([]);
      expect(auction.createdAt).toBeLessThanOrEqual(Date.now());
      expect(auction.deadline).toBeGreaterThan(Date.now());
    });

    it('uses custom deadline', () => {
      const customDeadline = Date.now() + 5000;
      const auction = system.createAuction(
        'task-1',
        'Task',
        [],
        1000,
        customDeadline,
      );

      expect(auction.deadline).toBe(customDeadline);
    });

    it('emits commerce:auction:created event', () => {
      const listener = vi.fn();
      system.on('commerce:auction:created', listener);

      system.createAuction('task-1', 'Task', [], 1000);

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────
  // submitBid() (placeBid)
  // ─────────────────────────────────────────────────────────

  describe('submitBid()', () => {
    it('adds a bid to the auction', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      const bid = system.submitBid(auction.id, {
        agentId: 'agent-1',
        taskId: 'task-1',
        price: 500,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.9,
        capabilities: ['typescript'],
        expiresAt: Date.now() + 86400000,
      });

      expect(bid.id).toMatch(/^bid_/);
      expect(bid.agentId).toBe('agent-1');
      expect(bid.price).toBe(500);
      expect(bid.confidence).toBe(0.9);
      expect(bid.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('throws for non-existent auction', () => {
      expect(() => system.submitBid('nonexistent', {
        agentId: 'agent-1',
        taskId: 'task-1',
        price: 500,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.9,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      })).toThrow('Auction not found');
    });

    it('throws when auction is not open', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);
      system.cancelAuction(auction.id);

      expect(() => system.submitBid(auction.id, {
        agentId: 'agent-1',
        taskId: 'task-1',
        price: 500,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.9,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      })).toThrow('cannot accept bids');
    });

    it('throws when bid price exceeds max budget', () => {
      const auction = system.createAuction('task-1', 'Task', [], 500);

      expect(() => system.submitBid(auction.id, {
        agentId: 'agent-1',
        taskId: 'task-1',
        price: 600,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.9,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      })).toThrow('exceeds max budget');
    });

    it('emits commerce:auction:bid event', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      const listener = vi.fn();
      system.on('commerce:auction:bid', listener);

      system.submitBid(auction.id, {
        agentId: 'agent-1',
        taskId: 'task-1',
        price: 500,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.9,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      });

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────
  // closeAuction()
  // ─────────────────────────────────────────────────────────

  describe('closeAuction()', () => {
    it('awards to the best bid (highest score)', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      // Agent A: low price, high confidence (should win)
      system.submitBid(auction.id, {
        agentId: 'agent-a',
        taskId: 'task-1',
        price: 200,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.95,
        capabilities: ['typescript'],
        expiresAt: Date.now() + 86400000,
      });

      // Agent B: high price, low confidence
      system.submitBid(auction.id, {
        agentId: 'agent-b',
        taskId: 'task-1',
        price: 900,
        currency: 'credits',
        estimatedDuration: 7200000,
        confidence: 0.3,
        capabilities: ['python'],
        expiresAt: Date.now() + 86400000,
      });

      const closed = system.closeAuction(auction.id);

      expect(closed.status).toBe('awarded');
      expect(closed.winnerId).toBe('agent-a');
    });

    it('cancels when no bids exist', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      const closed = system.closeAuction(auction.id);

      expect(closed.status).toBe('cancelled');
    });

    it('emits commerce:auction:awarded event', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      system.submitBid(auction.id, {
        agentId: 'agent-1',
        taskId: 'task-1',
        price: 500,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.9,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      });

      const listener = vi.fn();
      system.on('commerce:auction:awarded', listener);

      system.closeAuction(auction.id);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ winnerId: 'agent-1' }),
      );
    });

    it('throws for non-existent auction', () => {
      expect(() => system.closeAuction('nonexistent')).toThrow('Auction not found');
    });

    it('throws when auction is already closed', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);
      system.cancelAuction(auction.id);

      expect(() => system.closeAuction(auction.id)).toThrow('already');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Scoring formula
  // ─────────────────────────────────────────────────────────

  describe('scoring formula', () => {
    it('scores correctly: (1 - normalized_price) * 0.4 + confidence * 0.6', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      // Agent A: price=100, confidence=0.8
      system.submitBid(auction.id, {
        agentId: 'agent-a',
        taskId: 'task-1',
        price: 100,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.8,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      });

      // Agent B: price=500, confidence=1.0
      system.submitBid(auction.id, {
        agentId: 'agent-b',
        taskId: 'task-1',
        price: 500,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 1.0,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      });

      // Price range: 500-100 = 400
      // Agent A: normalizedPrice = (500-100)/400 = 1.0, score = 1.0*0.4 + 0.8*0.6 = 0.88
      // Agent B: normalizedPrice = (500-500)/400 = 0.0, score = 0.0*0.4 + 1.0*0.6 = 0.60
      // Agent A should win

      const closed = system.closeAuction(auction.id);
      expect(closed.winnerId).toBe('agent-a');
    });

    it('handles single bid correctly', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      system.submitBid(auction.id, {
        agentId: 'agent-sole',
        taskId: 'task-1',
        price: 500,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.7,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      });

      const closed = system.closeAuction(auction.id);
      expect(closed.status).toBe('awarded');
      expect(closed.winnerId).toBe('agent-sole');
    });
  });

  // ─────────────────────────────────────────────────────────
  // cancelAuction()
  // ─────────────────────────────────────────────────────────

  describe('cancelAuction()', () => {
    it('cancels an open auction', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      const cancelled = system.cancelAuction(auction.id);

      expect(cancelled.status).toBe('cancelled');
    });

    it('emits commerce:auction:cancelled event', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      const listener = vi.fn();
      system.on('commerce:auction:cancelled', listener);

      system.cancelAuction(auction.id);

      expect(listener).toHaveBeenCalledOnce();
    });

    it('throws for non-existent auction', () => {
      expect(() => system.cancelAuction('nonexistent')).toThrow('Auction not found');
    });

    it('throws when auction is already cancelled', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);
      system.cancelAuction(auction.id);

      expect(() => system.cancelAuction(auction.id)).toThrow('already');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Listing and querying
  // ─────────────────────────────────────────────────────────

  describe('listAuctions()', () => {
    it('lists all auctions', () => {
      system.createAuction('task-1', 'Task 1', [], 1000);
      system.createAuction('task-2', 'Task 2', [], 2000);

      const all = system.listAuctions();
      expect(all).toHaveLength(2);
    });

    it('filters by status', () => {
      const a1 = system.createAuction('task-1', 'Task 1', [], 1000);
      system.createAuction('task-2', 'Task 2', [], 2000);
      system.cancelAuction(a1.id);

      const open = system.listAuctions({ status: 'open' });
      expect(open).toHaveLength(1);

      const cancelled = system.listAuctions({ status: 'cancelled' });
      expect(cancelled).toHaveLength(1);
    });

    it('filters by taskId', () => {
      system.createAuction('task-1', 'Task 1', [], 1000);
      system.createAuction('task-2', 'Task 2', [], 2000);

      const results = system.listAuctions({ taskId: 'task-1' });
      expect(results).toHaveLength(1);
      expect(results[0].taskId).toBe('task-1');
    });
  });

  describe('getBidsForAuction()', () => {
    it('returns bids sorted by price ascending', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      system.submitBid(auction.id, {
        agentId: 'agent-expensive',
        taskId: 'task-1',
        price: 900,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.5,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      });

      system.submitBid(auction.id, {
        agentId: 'agent-cheap',
        taskId: 'task-1',
        price: 100,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.9,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      });

      const bids = system.getBidsForAuction(auction.id);
      expect(bids).toHaveLength(2);
      expect(bids[0].price).toBeLessThanOrEqual(bids[1].price);
    });

    it('returns empty array for non-existent auction', () => {
      expect(system.getBidsForAuction('nonexistent')).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────
  // getStats()
  // ─────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns zero counts initially', () => {
      const stats = system.getStats();
      expect(stats.total).toBe(0);
      expect(stats.open).toBe(0);
      expect(stats.awarded).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.totalBids).toBe(0);
      expect(stats.avgBidsPerAuction).toBe(0);
      expect(stats.totalAwardedValue).toBe(0);
    });

    it('tracks awarded value and bid counts', () => {
      const auction = system.createAuction('task-1', 'Task', [], 1000);

      system.submitBid(auction.id, {
        agentId: 'agent-1',
        taskId: 'task-1',
        price: 300,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.9,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      });

      system.submitBid(auction.id, {
        agentId: 'agent-2',
        taskId: 'task-1',
        price: 500,
        currency: 'credits',
        estimatedDuration: 3600000,
        confidence: 0.7,
        capabilities: [],
        expiresAt: Date.now() + 86400000,
      });

      system.closeAuction(auction.id);

      const stats = system.getStats();
      expect(stats.total).toBe(1);
      expect(stats.awarded).toBe(1);
      expect(stats.totalBids).toBe(2);
      expect(stats.avgBidsPerAuction).toBe(2);
      expect(stats.totalAwardedValue).toBeGreaterThan(0);
    });
  });
});
