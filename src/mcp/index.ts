/**
 * MCP + A2A Protocol Layer
 *
 * Phase I: Protocol-Native — CortexOS as the kernel between MCP and A2A
 *
 * Exports:
 * - MCPClient: Connect to MCP servers (5,800+ tools)
 * - A2AGateway: Publish Agent Cards, accept A2A tasks
 * - ProtocolBridge: Translate between MCP ↔ A2A
 */

export { MCPClient } from './mcp-client.js';
export { A2AGateway, type A2AGatewayOptions } from './a2a-gateway.js';
export { ProtocolBridge, type ProtocolBridgeOptions } from './protocol-bridge.js';

export type {
  // MCP Types
  MCPTransport,
  MCPServerConfig,
  MCPCapabilities,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPConnectionState,
  MCPServerInstance,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,

  // A2A Types
  AgentCard,
  AgentCapability,
  AgentSkill,
  AgentAuth,
  A2ATask,
  A2ATaskStatus,
  A2AMessage,
  A2APart,
  A2AArtifact,
  A2APushNotification,

  // Bridge Types
  ProtocolBridgeConfig,
  UnifiedCapability,

  // Config
  MCPConfig,

  // Events
  MCPEventType,
} from './types.js';
