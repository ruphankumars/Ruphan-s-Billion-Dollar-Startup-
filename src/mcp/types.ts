/**
 * MCP (Model Context Protocol) + A2A (Agent-to-Agent) Types
 *
 * Phase I: Protocol-Native Layer
 * CortexOS becomes an MCP Host and A2A Gateway — the kernel between tools and agents.
 *
 * MCP = Vertical integration (agent ↔ tools)
 * A2A = Horizontal integration (agent ↔ agents)
 * Protocol Bridge = Translation layer between MCP and A2A
 */

// ═══════════════════════════════════════════════════════════════
// MCP TYPES (Model Context Protocol — Anthropic)
// Based on MCP specification: JSON-RPC 2.0 over stdio/SSE
// ═══════════════════════════════════════════════════════════════

/** MCP transport type */
export type MCPTransport = 'stdio' | 'sse' | 'streamable-http';

/** MCP server connection configuration */
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransport;
  command?: string;           // For stdio: command to spawn
  args?: string[];            // For stdio: command arguments
  env?: Record<string, string>;
  url?: string;               // For SSE/HTTP: endpoint URL
  apiKey?: string;            // Optional auth
  headers?: Record<string, string>;
  timeout?: number;           // Connection timeout in ms
  retries?: number;
  enabled?: boolean;
}

/** MCP capability types as defined by the protocol */
export interface MCPCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  sampling?: Record<string, unknown>;
  logging?: Record<string, unknown>;
}

/** MCP Tool definition (from server) */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
  serverId: string;            // Which MCP server provides this tool
}

/** MCP Resource (data the server exposes) */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverId: string;
}

/** MCP Prompt template */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
  serverId: string;
}

/** JSON-RPC 2.0 message types */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/** MCP connection state */
export type MCPConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'initializing'
  | 'ready'
  | 'error';

/** MCP server instance (runtime state) */
export interface MCPServerInstance {
  config: MCPServerConfig;
  state: MCPConnectionState;
  capabilities: MCPCapabilities;
  tools: MCPTool[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  connectedAt?: number;
  lastError?: string;
  pid?: number;               // For stdio: child process ID
}

// ═══════════════════════════════════════════════════════════════
// A2A TYPES (Agent-to-Agent Protocol — Google)
// Based on A2A specification: HTTP + SSE + webhooks
// ═══════════════════════════════════════════════════════════════

/** A2A Agent Card — published at .well-known/agent.json */
export interface AgentCard {
  name: string;
  description: string;
  url: string;                 // Agent's A2A endpoint
  version: string;
  capabilities: AgentCapability[];
  skills: AgentSkill[];
  authentication?: AgentAuth;
  metadata?: Record<string, unknown>;
  provider?: {
    name: string;
    url?: string;
  };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

/** Agent capability advertisement */
export interface AgentCapability {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

/** Agent skill (what it can do) */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  inputModes?: string[];       // 'text', 'code', 'file', etc.
  outputModes?: string[];
  examples?: Array<{ input: string; output: string }>;
}

/** Agent authentication method */
export interface AgentAuth {
  type: 'apiKey' | 'oauth2' | 'bearer' | 'none';
  config?: Record<string, unknown>;
}

/** A2A Task — the unit of work between agents */
export interface A2ATask {
  id: string;
  status: A2ATaskStatus;
  input: A2AMessage;
  output?: A2AMessage;
  history?: A2AMessage[];
  artifacts?: A2AArtifact[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** A2A Task lifecycle states */
export type A2ATaskStatus =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled';

/** A2A Message between agents */
export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

/** A2A Message part (multi-modal support) */
export type A2APart =
  | { type: 'text'; text: string }
  | { type: 'code'; code: string; language?: string }
  | { type: 'file'; uri: string; mimeType?: string; name?: string }
  | { type: 'data'; data: Record<string, unknown> };

/** A2A Artifact — output of agent work */
export interface A2AArtifact {
  id: string;
  name: string;
  type: string;                // MIME type
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

/** A2A Push notification config */
export interface A2APushNotification {
  url: string;
  events?: A2ATaskStatus[];
  authentication?: AgentAuth;
}

// ═══════════════════════════════════════════════════════════════
// PROTOCOL BRIDGE TYPES
// ═══════════════════════════════════════════════════════════════

/** Protocol bridge translates between MCP and A2A */
export interface ProtocolBridgeConfig {
  enabled: boolean;
  autoDiscover: boolean;       // Auto-discover MCP tools as A2A capabilities
  exposeAsA2A: boolean;        // Expose CortexOS as A2A agent
  mcpToA2AMapping?: Array<{
    mcpTool: string;
    a2aSkill: string;
    transform?: string;        // Optional transformation function name
  }>;
}

/** Unified tool/agent reference */
export interface UnifiedCapability {
  id: string;
  name: string;
  description: string;
  source: 'mcp' | 'a2a' | 'local';
  sourceId: string;            // MCP server ID or A2A agent URL
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  costPerCall?: number;
  avgLatencyMs?: number;
  qualityScore?: number;       // 0-1, based on historical performance
}

// ═══════════════════════════════════════════════════════════════
// CORTEXOS MCP/A2A CONFIG
// ═══════════════════════════════════════════════════════════════

export interface MCPConfig {
  enabled: boolean;
  servers: MCPServerConfig[];
  autoConnect: boolean;
  discoveryEnabled: boolean;
  bridge: ProtocolBridgeConfig;
  a2a: {
    enabled: boolean;
    port: number;
    agentCard: Partial<AgentCard>;
    maxConcurrentTasks: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

export type MCPEventType =
  | 'mcp:server:connected'
  | 'mcp:server:disconnected'
  | 'mcp:server:error'
  | 'mcp:tool:called'
  | 'mcp:tool:result'
  | 'mcp:resource:read'
  | 'a2a:task:received'
  | 'a2a:task:completed'
  | 'a2a:task:failed'
  | 'a2a:agent:discovered'
  | 'bridge:translation';
