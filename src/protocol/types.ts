/**
 * CADP — CortexOS Agent Discovery Protocol
 * A lightweight protocol for agent discovery, routing, and federation.
 * Think DNS + BGP for AI agents.
 *
 * Part of CortexOS Phase IV: The Agent Internet
 */

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

export interface AgentIdentity {
  /** Globally unique agent ID (e.g., "cortexos:agent:abc123") */
  id: string;
  name: string;
  /** Domain that hosts this agent (e.g., "agents.example.com") */
  domain: string;
  /** Ed25519 public key for verification */
  publicKey?: string;
  version: string;
  registeredAt: number;
}

// ---------------------------------------------------------------------------
// Agent DNS record (analogous to DNS A/AAAA/SRV records)
// ---------------------------------------------------------------------------

export interface AgentDNSRecord {
  agentId: string;
  domain: string;
  endpoints: AgentEndpoint[];
  /** Capability tags */
  capabilities: string[];
  /** Time-to-live in seconds */
  ttl: number;
  /** Lower = higher priority (like MX records) */
  priority: number;
  /** For load balancing */
  weight: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

export interface AgentEndpoint {
  protocol: 'a2a' | 'mcp' | 'rest' | 'grpc' | 'websocket';
  url: string;
  /** Geographic region */
  region?: string;
  healthy: boolean;
  lastHealthCheck?: number;
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// Federation
// ---------------------------------------------------------------------------

export interface FederationPeer {
  id: string;
  name: string;
  /** Peer's CADP endpoint */
  url: string;
  publicKey?: string;
  trustLevel: 'full' | 'partial' | 'untrusted';
  /** Capabilities this peer shares */
  sharedCapabilities: string[];
  lastSync: number;
  status: 'connected' | 'disconnected' | 'syncing' | 'error';
}

export interface FederationConfig {
  enabled: boolean;
  peerId: string;
  peerName: string;
  listenPort: number;
  peers: Array<{ url: string; trustLevel: FederationPeer['trustLevel'] }>;
  /** How often to sync with peers (ms) */
  syncIntervalMs: number;
  maxPeers: number;
  /** Share our agents with peers */
  shareCapabilities: boolean;
  /** Accept agents from peers */
  acceptRemoteAgents: boolean;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RouteEntry {
  /** Glob pattern for agent IDs or capabilities */
  pattern: string;
  destination: AgentEndpoint;
  priority: number;
  weight: number;
  conditions?: RouteCondition[];
  metrics: RouteMetrics;
}

export interface RouteCondition {
  type: 'capability' | 'region' | 'cost' | 'latency' | 'load';
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'matches';
  value: string | number;
}

export interface RouteMetrics {
  totalRequests: number;
  successCount: number;
  failCount: number;
  avgLatencyMs: number;
  lastUsed: number;
}

// ---------------------------------------------------------------------------
// Protocol messages
// ---------------------------------------------------------------------------

export interface CADPMessage {
  type: CADPMessageType;
  id: string;
  /** Source peer/agent ID */
  source: string;
  /** Target peer/agent ID */
  destination?: string;
  payload: Record<string, unknown>;
  timestamp: number;
  /** Ed25519 signature */
  signature?: string;
}

export type CADPMessageType =
  | 'register'
  | 'deregister'
  | 'lookup'
  | 'lookup-response'
  | 'announce'
  | 'sync-request'
  | 'sync-response'
  | 'health-check'
  | 'health-response'
  | 'route-update'
  | 'error';

// ---------------------------------------------------------------------------
// Protocol config
// ---------------------------------------------------------------------------

export interface CADPConfig {
  enabled: boolean;
  port: number;
  hostname: string;
  peerId: string;
  federation: FederationConfig;
  healthCheckIntervalMs: number;
  /** Default TTL for DNS records (seconds) */
  recordTTL: number;
  maxRecords: number;
  routingAlgorithm: 'round-robin' | 'weighted' | 'least-latency' | 'capability-match';
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type CADPEventType =
  | 'cadp:agent:registered'
  | 'cadp:agent:deregistered'
  | 'cadp:lookup:hit'
  | 'cadp:lookup:miss'
  | 'cadp:peer:connected'
  | 'cadp:peer:disconnected'
  | 'cadp:peer:synced'
  | 'cadp:route:updated'
  | 'cadp:health:check';
