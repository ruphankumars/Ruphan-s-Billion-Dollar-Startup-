/**
 * Agent-to-Agent Commerce Types — CortexOS
 *
 * Type definitions for the commerce subsystem: auctions, negotiations,
 * coalitions, and agent-to-agent economic transactions.
 */

// ═══════════════════════════════════════════════════════════════
// BIDS
// ═══════════════════════════════════════════════════════════════

export interface Bid {
  /** Unique bid identifier */
  id: string;
  /** Agent ID that submitted the bid */
  agentId: string;
  /** Task ID this bid is for */
  taskId: string;
  /** Bid price */
  price: number;
  /** Currency code */
  currency: string;
  /** Estimated duration in milliseconds */
  estimatedDuration: number;
  /** Confidence in ability to complete (0-1) */
  confidence: number;
  /** Capabilities the agent brings */
  capabilities: string[];
  /** Unix timestamp (ms) when the bid was created */
  createdAt: number;
  /** Unix timestamp (ms) when the bid expires */
  expiresAt: number;
}

// ═══════════════════════════════════════════════════════════════
// AUCTIONS
// ═══════════════════════════════════════════════════════════════

export type AuctionStatus = 'open' | 'closed' | 'awarded' | 'cancelled';

export interface Auction {
  /** Unique auction identifier */
  id: string;
  /** Task ID being auctioned */
  taskId: string;
  /** Description of the task */
  description: string;
  /** Requirements for bidders */
  requirements: string[];
  /** Maximum budget for the task */
  maxBudget: number;
  /** Submitted bids */
  bids: Bid[];
  /** Current auction status */
  status: AuctionStatus;
  /** Winner agent ID (set when awarded) */
  winnerId?: string;
  /** Unix timestamp (ms) when the auction was created */
  createdAt: number;
  /** Unix timestamp (ms) deadline for bids */
  deadline: number;
}

// ═══════════════════════════════════════════════════════════════
// NEGOTIATIONS
// ═══════════════════════════════════════════════════════════════

export interface NegotiationRound {
  /** Round number (1-based) */
  round: number;
  /** Buyer's bid price for this round */
  bidPrice: number;
  /** Seller's ask price for this round */
  askPrice: number;
  /** Additional notes or terms */
  notes: string;
}

export type NegotiationStatus = 'active' | 'agreed' | 'failed' | 'timeout';

export interface Negotiation {
  /** Unique negotiation identifier */
  id: string;
  /** Buyer agent ID */
  buyerAgentId: string;
  /** Seller agent ID */
  sellerAgentId: string;
  /** Task ID being negotiated */
  taskId: string;
  /** History of negotiation rounds */
  rounds: NegotiationRound[];
  /** Current negotiation status */
  status: NegotiationStatus;
  /** Agreed-upon price (set when status is 'agreed') */
  agreedPrice?: number;
  /** Maximum number of negotiation rounds before timeout */
  maxRounds: number;
  /** Unix timestamp (ms) when the negotiation started */
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// COALITIONS
// ═══════════════════════════════════════════════════════════════

export type CoalitionStatus = 'forming' | 'active' | 'completed' | 'dissolved';

export interface Coalition {
  /** Unique coalition identifier */
  id: string;
  /** Lead agent ID */
  leadAgentId: string;
  /** Member agent IDs (includes lead) */
  memberAgentIds: string[];
  /** Task ID the coalition is working on */
  taskId: string;
  /** Strategy for task decomposition and coordination */
  strategy: string;
  /** Current coalition status */
  status: CoalitionStatus;
  /** Shared budget for the coalition */
  sharedBudget: number;
  /** Unix timestamp (ms) when the coalition was formed */
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface CommerceConfig {
  /** Whether commerce features are enabled */
  enabled: boolean;
  /** Maximum duration for an auction in milliseconds */
  maxAuctionDuration: number;
  /** Maximum number of negotiation rounds */
  maxNegotiationRounds: number;
  /** Default currency for transactions */
  defaultCurrency: string;
  /** Commission rate on transactions (e.g. 0.05 = 5%) */
  commissionRate: number;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface CommerceStats {
  /** Total number of auctions created */
  totalAuctions: number;
  /** Total number of negotiations started */
  totalNegotiations: number;
  /** Total number of coalitions formed */
  totalCoalitions: number;
  /** Total amount transacted */
  totalTransacted: number;
  /** Average transaction price */
  avgPrice: number;
}
