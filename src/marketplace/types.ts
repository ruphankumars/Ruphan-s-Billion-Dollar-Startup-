/**
 * Marketplace Types — Agent Economy Data Models
 *
 * Type definitions for the CortexOS Agent Marketplace: agent listings,
 * discovery queries, pricing negotiations, transactions, and configuration.
 * Part of Phase III: the Agent Economy.
 */

// ═══════════════════════════════════════════════════════════════
// AGENT LISTING
// ═══════════════════════════════════════════════════════════════

/** Agent listing in the marketplace */
export interface AgentListing {
  id: string;
  name: string;
  description: string;
  version: string;
  author: AgentAuthor;
  capabilities: string[];
  tags: string[];
  pricing: AgentPricing;
  quality: AgentQualityMetrics;
  endpoints: AgentEndpoints;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'inactive' | 'deprecated' | 'review';
}

export interface AgentAuthor {
  id: string;
  name: string;
  email?: string;
  url?: string;
  verified: boolean;
}

export interface AgentPricing {
  model: 'free' | 'per-call' | 'per-token' | 'subscription' | 'negotiated';
  baseCost?: number;         // Cost per call in USD
  tokenRate?: number;        // Cost per 1K tokens
  currency: string;          // Default 'USD'
  freeQuota?: number;        // Free calls per day
  bulkDiscount?: Array<{ threshold: number; discount: number }>;
}

export interface AgentQualityMetrics {
  rating: number;            // 0-5 stars
  totalCalls: number;
  successRate: number;       // 0-1
  avgLatencyMs: number;
  avgCostPerCall: number;
  lastVerified?: number;
  swebenchScore?: number;    // If applicable
}

export interface AgentEndpoints {
  a2aUrl?: string;           // A2A protocol endpoint
  mcpCommand?: string;       // MCP stdio command
  mcpUrl?: string;           // MCP HTTP endpoint
  restUrl?: string;          // Plain REST API
}

// ═══════════════════════════════════════════════════════════════
// DISCOVERY
// ═══════════════════════════════════════════════════════════════

export interface DiscoveryQuery {
  text?: string;             // Free-text search
  capabilities?: string[];   // Required capabilities
  tags?: string[];           // Filter by tags
  maxCost?: number;          // Max cost per call
  minRating?: number;        // Min quality rating
  minSuccessRate?: number;   // Min success rate
  limit?: number;            // Max results
  offset?: number;           // Pagination
  sortBy?: 'rating' | 'cost' | 'latency' | 'popularity';
  sortOrder?: 'asc' | 'desc';
}

export interface DiscoveryResult {
  agents: AgentListing[];
  total: number;
  query: DiscoveryQuery;
  executionTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════
// PRICING NEGOTIATION
// ═══════════════════════════════════════════════════════════════

export interface PricingNegotiation {
  id: string;
  buyerAgentId: string;
  sellerAgentId: string;
  proposedPrice: number;
  counterPrice?: number;
  status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'expired';
  expiresAt: number;
  terms?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// TRANSACTION
// ═══════════════════════════════════════════════════════════════

export interface AgentTransaction {
  id: string;
  buyerAgentId: string;
  sellerAgentId: string;
  taskId: string;
  cost: number;
  tokensUsed: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  startedAt: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// MARKETPLACE CONFIG
// ═══════════════════════════════════════════════════════════════

export interface MarketplaceConfig {
  enabled: boolean;
  registryUrl?: string;      // Remote registry URL
  localCachePath?: string;   // Local cache directory
  autoDiscover: boolean;
  maxConcurrentNegotiations: number;
  defaultBudget: number;     // Max spend per session in USD
  commissionRate: number;    // Platform commission (default 0.15 = 15%)
}

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

export type MarketplaceEventType =
  | 'marketplace:agent:registered'
  | 'marketplace:agent:updated'
  | 'marketplace:agent:removed'
  | 'marketplace:discovery:search'
  | 'marketplace:negotiation:started'
  | 'marketplace:negotiation:completed'
  | 'marketplace:transaction:started'
  | 'marketplace:transaction:completed'
  | 'marketplace:transaction:failed';
