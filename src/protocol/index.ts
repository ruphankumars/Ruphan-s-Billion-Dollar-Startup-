/**
 * CortexOS Agent Internet — Protocol Layer
 *
 * CADP (CortexOS Agent Discovery Protocol): DNS + BGP for AI agents.
 * Provides agent discovery, federation, and intelligent routing.
 *
 * @example
 * ```typescript
 * import { AgentDNS, FederationManager, AgentRouter } from 'cortexos';
 *
 * const dns = new AgentDNS({ defaultTTL: 3600 });
 * dns.register({
 *   agentId: 'cortexos:agent:code-reviewer',
 *   domain: 'agents.example.com',
 *   endpoints: [{ protocol: 'a2a', url: 'https://agents.example.com/code-reviewer', healthy: true }],
 *   capabilities: ['code-review', 'typescript'],
 *   ttl: 3600,
 *   priority: 10,
 *   weight: 100,
 * });
 *
 * const federation = new FederationManager(dns, { enabled: true });
 * await federation.addPeer('https://peer.example.com', { trustLevel: 'full' });
 *
 * const router = new AgentRouter(dns, { algorithm: 'least-latency' });
 * const endpoint = router.route({ capability: 'code-review' });
 * ```
 */

export { AgentDNS } from './agent-dns.js';
export type { AgentDNSOptions } from './agent-dns.js';
export { FederationManager } from './federation.js';
export { AgentRouter } from './routing.js';
export {
  CADPSpecification,
  PROTOCOL_VERSION,
  MESSAGE_TYPES,
  WIRE_FORMAT,
  DISCOVERY_PROTOCOL,
  SECURITY,
  MESSAGE_SCHEMAS,
} from './cadp-spec.js';
export {
  TrustChain,
} from './trust-chain.js';
export type {
  TrustKeyPair,
  TrustCertificate,
  TrustedPeer,
} from './trust-chain.js';
export type {
  AgentIdentity,
  AgentDNSRecord,
  AgentEndpoint,
  FederationPeer,
  FederationConfig,
  RouteEntry,
  RouteCondition,
  RouteMetrics,
  CADPMessage,
  CADPMessageType,
  CADPConfig,
  CADPEventType,
} from './types.js';
