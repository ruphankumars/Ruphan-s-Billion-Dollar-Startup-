import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NegotiationEngine } from '../../../src/commerce/negotiation-engine.js';

describe('NegotiationEngine', () => {
  let engine: NegotiationEngine;

  beforeEach(() => {
    engine = new NegotiationEngine();
  });

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts and stops', () => {
      expect(engine.isRunning()).toBe(false);
      engine.start();
      expect(engine.isRunning()).toBe(true);
      engine.stop();
      expect(engine.isRunning()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // startNegotiation()
  // ─────────────────────────────────────────────────────────

  describe('startNegotiation()', () => {
    it('creates a negotiation with correct fields', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      expect(neg.id).toMatch(/^neg_/);
      expect(neg.buyerAgentId).toBe('buyer-1');
      expect(neg.sellerAgentId).toBe('seller-1');
      expect(neg.taskId).toBe('task-1');
      expect(neg.status).toBe('active');
      expect(neg.rounds).toEqual([]);
      expect(neg.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('creates initial round when bid and ask are provided', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1', {
        initialBid: 100,
        initialAsk: 200,
      });

      expect(neg.rounds).toHaveLength(1);
      expect(neg.rounds[0].round).toBe(1);
      expect(neg.rounds[0].bidPrice).toBe(100);
      expect(neg.rounds[0].askPrice).toBe(200);
    });

    it('emits commerce:negotiation:created event', () => {
      const listener = vi.fn();
      engine.on('commerce:negotiation:created', listener);

      engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      expect(listener).toHaveBeenCalledOnce();
    });

    it('uses custom maxRounds from options', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1', {
        maxRounds: 3,
      });

      expect(neg.maxRounds).toBe(3);
    });

    it('uses config maxNegotiationRounds as default', () => {
      const customEngine = new NegotiationEngine({ maxNegotiationRounds: 5 });
      const neg = customEngine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      expect(neg.maxRounds).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────
  // submitBid() / submitAsk()
  // ─────────────────────────────────────────────────────────

  describe('submitBid()', () => {
    it('creates a new round with a bid', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      const round = engine.submitBid(neg.id, 150, 'Opening bid');

      expect(round.bidPrice).toBe(150);
      expect(round.round).toBe(1);
    });

    it('throws for non-existent negotiation', () => {
      expect(() => engine.submitBid('nonexistent', 100)).toThrow('Negotiation not found');
    });

    it('throws when negotiation is not active', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.rejectDeal(neg.id);

      expect(() => engine.submitBid(neg.id, 100)).toThrow('cannot submit bid');
    });

    it('emits commerce:negotiation:bid event', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      const listener = vi.fn();
      engine.on('commerce:negotiation:bid', listener);

      engine.submitBid(neg.id, 150);

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('submitAsk()', () => {
    it('creates a new round with an ask', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      const round = engine.submitAsk(neg.id, 200, 'Opening ask');

      expect(round.askPrice).toBe(200);
      expect(round.round).toBe(1);
    });

    it('throws for non-existent negotiation', () => {
      expect(() => engine.submitAsk('nonexistent', 200)).toThrow('Negotiation not found');
    });

    it('throws when negotiation is not active', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.rejectDeal(neg.id);

      expect(() => engine.submitAsk(neg.id, 200)).toThrow('cannot submit ask');
    });

    it('emits commerce:negotiation:ask event', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      const listener = vi.fn();
      engine.on('commerce:negotiation:ask', listener);

      engine.submitAsk(neg.id, 200);

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────
  // Rounds progression
  // ─────────────────────────────────────────────────────────

  describe('rounds progression', () => {
    it('advances rounds correctly with alternating bids and asks', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      engine.submitBid(neg.id, 100);
      engine.submitAsk(neg.id, 200);

      // Both bid and ask are now on round 1, so next bid starts round 2
      engine.submitBid(neg.id, 150);
      engine.submitAsk(neg.id, 180);

      const updated = engine.getNegotiation(neg.id)!;
      expect(updated.rounds).toHaveLength(2);
      expect(updated.rounds[0].bidPrice).toBe(100);
      expect(updated.rounds[0].askPrice).toBe(200);
      expect(updated.rounds[1].bidPrice).toBe(150);
      expect(updated.rounds[1].askPrice).toBe(180);
    });

    it('appends notes to existing round', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      engine.submitBid(neg.id, 100, 'First note');
      engine.submitAsk(neg.id, 200, 'Second note');

      const updated = engine.getNegotiation(neg.id)!;
      expect(updated.rounds[0].notes).toContain('First note');
      expect(updated.rounds[0].notes).toContain('Second note');
    });
  });

  // ─────────────────────────────────────────────────────────
  // Agreement / timeout / failure resolution
  // ─────────────────────────────────────────────────────────

  describe('acceptDeal()', () => {
    it('sets agreed status and computes midpoint price', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      engine.submitBid(neg.id, 100);
      engine.submitAsk(neg.id, 200);

      const result = engine.acceptDeal(neg.id);

      expect(result.status).toBe('agreed');
      expect(result.agreedPrice).toBe(150); // midpoint of 100 and 200
    });

    it('emits commerce:negotiation:agreed event', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.submitBid(neg.id, 100);
      engine.submitAsk(neg.id, 200);

      const listener = vi.fn();
      engine.on('commerce:negotiation:agreed', listener);

      engine.acceptDeal(neg.id);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ agreedPrice: 150 }),
      );
    });

    it('throws for non-existent negotiation', () => {
      expect(() => engine.acceptDeal('nonexistent')).toThrow('Negotiation not found');
    });

    it('throws when no rounds exist', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      expect(() => engine.acceptDeal(neg.id)).toThrow('No rounds');
    });

    it('throws when negotiation is not active', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.submitBid(neg.id, 100);
      engine.rejectDeal(neg.id);

      expect(() => engine.acceptDeal(neg.id)).toThrow('cannot accept');
    });
  });

  describe('rejectDeal()', () => {
    it('sets status to failed', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      const result = engine.rejectDeal(neg.id);

      expect(result.status).toBe('failed');
    });

    it('emits commerce:negotiation:failed event', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');

      const listener = vi.fn();
      engine.on('commerce:negotiation:failed', listener);

      engine.rejectDeal(neg.id);

      expect(listener).toHaveBeenCalledOnce();
    });

    it('throws for non-existent negotiation', () => {
      expect(() => engine.rejectDeal('nonexistent')).toThrow('Negotiation not found');
    });
  });

  describe('timeout', () => {
    it('times out when max rounds is reached via bid', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1', {
        maxRounds: 2,
      });

      const timeoutListener = vi.fn();
      engine.on('commerce:negotiation:timeout', timeoutListener);

      // Round 1: bid + ask
      engine.submitBid(neg.id, 100);
      engine.submitAsk(neg.id, 200);

      // Round 2: bid triggers timeout since rounds.length reaches maxRounds
      engine.submitBid(neg.id, 150);

      const final = engine.getNegotiation(neg.id)!;
      expect(final.status).toBe('timeout');
      expect(timeoutListener).toHaveBeenCalled();
    });

    it('prevents further bids/asks after timeout', () => {
      const neg = engine.startNegotiation('buyer-1', 'seller-1', 'task-1', {
        maxRounds: 1,
      });

      // This bid creates round 1 and rounds.length (1) >= maxRounds (1), triggering timeout
      engine.submitBid(neg.id, 100);

      expect(engine.getNegotiation(neg.id)!.status).toBe('timeout');
      expect(() => engine.submitAsk(neg.id, 200)).toThrow('cannot submit ask');
    });
  });

  // ─────────────────────────────────────────────────────────
  // getActive() / getCompleted() listing
  // ─────────────────────────────────────────────────────────

  describe('listNegotiations()', () => {
    it('lists all negotiations', () => {
      engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.startNegotiation('buyer-2', 'seller-2', 'task-2');

      const all = engine.listNegotiations();
      expect(all).toHaveLength(2);
    });

    it('filters by status', () => {
      const neg1 = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.startNegotiation('buyer-2', 'seller-2', 'task-2');
      engine.rejectDeal(neg1.id);

      const active = engine.listNegotiations({ status: 'active' });
      expect(active).toHaveLength(1);

      const failed = engine.listNegotiations({ status: 'failed' });
      expect(failed).toHaveLength(1);
    });

    it('filters by buyerAgentId', () => {
      engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.startNegotiation('buyer-2', 'seller-2', 'task-2');

      const results = engine.listNegotiations({ buyerAgentId: 'buyer-1' });
      expect(results).toHaveLength(1);
      expect(results[0].buyerAgentId).toBe('buyer-1');
    });

    it('filters by sellerAgentId', () => {
      engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.startNegotiation('buyer-2', 'seller-2', 'task-2');

      const results = engine.listNegotiations({ sellerAgentId: 'seller-2' });
      expect(results).toHaveLength(1);
      expect(results[0].sellerAgentId).toBe('seller-2');
    });

    it('filters by taskId', () => {
      engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.startNegotiation('buyer-2', 'seller-2', 'task-2');

      const results = engine.listNegotiations({ taskId: 'task-1' });
      expect(results).toHaveLength(1);
    });

    it('returns results sorted by createdAt descending', () => {
      engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.startNegotiation('buyer-2', 'seller-2', 'task-2');

      const all = engine.listNegotiations();
      expect(all[0].createdAt).toBeGreaterThanOrEqual(all[1].createdAt);
    });
  });

  // ─────────────────────────────────────────────────────────
  // getStats()
  // ─────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns zero counts initially', () => {
      const stats = engine.getStats();
      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.agreed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.timeout).toBe(0);
      expect(stats.totalTransacted).toBe(0);
      expect(stats.avgAgreedPrice).toBe(0);
    });

    it('tracks agreed negotiations and total transacted value', () => {
      const neg1 = engine.startNegotiation('buyer-1', 'seller-1', 'task-1');
      engine.submitBid(neg1.id, 100);
      engine.submitAsk(neg1.id, 200);
      engine.acceptDeal(neg1.id);

      const neg2 = engine.startNegotiation('buyer-2', 'seller-2', 'task-2');
      engine.submitBid(neg2.id, 200);
      engine.submitAsk(neg2.id, 400);
      engine.acceptDeal(neg2.id);

      const stats = engine.getStats();
      expect(stats.total).toBe(2);
      expect(stats.agreed).toBe(2);
      expect(stats.totalTransacted).toBe(450); // 150 + 300
      expect(stats.avgAgreedPrice).toBe(225); // 450 / 2
    });
  });
});
