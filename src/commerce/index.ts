/**
 * Agent-to-Agent Commerce — CortexOS
 *
 * Barrel exports for the commerce subsystem.
 */

export { NegotiationEngine } from './negotiation-engine.js';
export { AuctionSystem } from './auction.js';
export { CoalitionManager } from './coalition-manager.js';
export type {
  Bid,
  Auction,
  AuctionStatus,
  NegotiationRound,
  Negotiation,
  NegotiationStatus,
  Coalition,
  CoalitionStatus,
  CommerceConfig,
  CommerceStats,
} from './types.js';
