/**
 * ACP Protocol Adapter — Type Definitions
 *
 * Agent Communication Protocol types for inter-agent messaging,
 * discovery, routing, and protocol bridging in CortexOS.
 */

// ── Agent Types ─────────────────────────────────────────────────────

export interface ACPAgentInfo {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  endpoint: string;
  version: string;
  status: 'available' | 'busy' | 'offline';
}

// ── Message Types ───────────────────────────────────────────────────

export interface ACPMessage {
  id: string;
  method: string;
  from: string;
  to: string;
  body: unknown;
  headers: Record<string, string>;
  timestamp: number;
}

export interface ACPResponse {
  id: string;
  requestId: string;
  status: number;
  body: unknown;
  headers: Record<string, string>;
  timestamp: number;
}

// ── Discovery Types ─────────────────────────────────────────────────

export interface ACPDiscoveryResult {
  agents: ACPAgentInfo[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Routing Types ───────────────────────────────────────────────────

export interface ACPRoute {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  handler: string;
  description: string;
}

// ── Configuration ───────────────────────────────────────────────────

export interface ACPConfig {
  enabled: boolean;
  baseUrl: string;
  port: number;
  discoveryEndpoint: string;
  heartbeatIntervalMs: number;
  timeoutMs: number;
  maxRetries: number;
}

// ── Stats ───────────────────────────────────────────────────────────

export interface ACPStats {
  totalMessages: number;
  totalResponses: number;
  totalErrors: number;
  avgLatencyMs: number;
  registeredAgents: number;
  activeConnections: number;
}
