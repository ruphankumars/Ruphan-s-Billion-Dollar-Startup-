/**
 * CortexOS Agent Marketplace — Phase III: Agent Economy
 *
 * Public exports for the marketplace module. Provides agent discovery,
 * registration, pricing negotiation, transaction management, and
 * the high-level marketplace engine.
 */

export { AgentMarketplace } from './marketplace.js';
export { AgentRegistry } from './agent-registry.js';
export { AgentDiscovery } from './discovery.js';
export { PricingEngine } from './pricing.js';
export type {
  AgentListing,
  AgentAuthor,
  AgentPricing,
  AgentQualityMetrics,
  AgentEndpoints,
  DiscoveryQuery,
  DiscoveryResult,
  PricingNegotiation,
  AgentTransaction,
  MarketplaceConfig,
  MarketplaceEventType,
} from './types.js';
