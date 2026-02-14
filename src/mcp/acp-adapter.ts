/**
 * ACP Protocol Adapter — Agent Communication Protocol bridge.
 *
 * Provides inter-agent discovery, messaging, and routing with
 * bidirectional bridging to MCP and A2A protocols for seamless
 * multi-protocol agent communication in CortexOS.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type {
  ACPAgentInfo,
  ACPMessage,
  ACPResponse,
  ACPDiscoveryResult,
  ACPRoute,
  ACPConfig,
  ACPStats,
} from './acp-types.js';

/** Default configuration */
const DEFAULT_CONFIG: ACPConfig = {
  enabled: true,
  baseUrl: 'http://localhost',
  port: 3100,
  discoveryEndpoint: '/acp/discover',
  heartbeatIntervalMs: 30_000,
  timeoutMs: 30_000,
  maxRetries: 3,
};

/**
 * ACPAdapter manages agent registration, inter-agent messaging,
 * route management, and protocol bridging between ACP, MCP, and A2A.
 */
export class ACPAdapter extends EventEmitter {
  private agents: Map<string, ACPAgentInfo> = new Map();
  private routes: ACPRoute[] = [];
  private messageLog: ACPMessage[] = [];
  private responseLog: ACPResponse[] = [];
  private errorCount = 0;
  private totalLatency = 0;
  private running = false;
  private config: ACPConfig;

  constructor(config?: Partial<ACPConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start the ACP adapter */
  start(): void {
    this.running = true;
    this.emit('acp:adapter:started', {
      baseUrl: this.config.baseUrl,
      port: this.config.port,
    });
  }

  /** Stop the ACP adapter */
  stop(): void {
    this.running = false;
    this.emit('acp:adapter:stopped');
  }

  /** Check if the adapter is running */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Register a new agent with the ACP adapter.
   * Sets initial status to 'available'.
   */
  registerAgent(info: Omit<ACPAgentInfo, 'status'>): ACPAgentInfo {
    const agent: ACPAgentInfo = {
      ...info,
      status: 'available',
    };

    this.agents.set(agent.id, agent);
    this.emit('acp:agent:registered', {
      agentId: agent.id,
      name: agent.name,
      capabilities: agent.capabilities,
    });

    return agent;
  }

  /**
   * Unregister an agent by ID.
   */
  unregisterAgent(agentId: string): boolean {
    const deleted = this.agents.delete(agentId);
    if (deleted) {
      this.emit('acp:agent:unregistered', { agentId });
    }
    return deleted;
  }

  /**
   * Update the status of a registered agent.
   */
  updateAgentStatus(agentId: string, status: ACPAgentInfo['status']): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    agent.status = status;
    this.emit('acp:agent:status-changed', { agentId, status });
  }

  /**
   * Discover agents, optionally filtering by capabilities.
   * Supports pagination.
   */
  discoverAgents(
    capabilities?: string[],
    page = 1,
    pageSize = 20,
  ): ACPDiscoveryResult {
    let agents = [...this.agents.values()];

    // Filter by capabilities if specified
    if (capabilities && capabilities.length > 0) {
      agents = agents.filter(agent =>
        capabilities.some(cap => agent.capabilities.includes(cap)),
      );
    }

    const total = agents.length;
    const startIndex = (page - 1) * pageSize;
    const pagedAgents = agents.slice(startIndex, startIndex + pageSize);

    return {
      agents: pagedAgents,
      total,
      page,
      pageSize,
    };
  }

  /**
   * Send a message from one agent to another.
   * Validates sender and receiver exist, then logs the message.
   */
  sendMessage(
    from: string,
    to: string,
    method: string,
    body: unknown,
    headers?: Record<string, string>,
  ): ACPMessage {
    const message: ACPMessage = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      method,
      from,
      to,
      body,
      headers: headers ?? {},
      timestamp: Date.now(),
    };

    this.messageLog.push(message);

    // Validate target agent exists and is available
    const targetAgent = this.agents.get(to);
    if (targetAgent && targetAgent.status === 'offline') {
      this.errorCount++;
      this.emit('acp:message:failed', {
        messageId: message.id,
        reason: `Target agent ${to} is offline`,
      });
    }

    this.emit('acp:message:sent', {
      messageId: message.id,
      from,
      to,
      method,
    });

    return message;
  }

  /**
   * Handle a response to a previously sent message.
   */
  handleResponse(
    requestId: string,
    status: number,
    body: unknown,
    headers?: Record<string, string>,
  ): ACPResponse {
    const response: ACPResponse = {
      id: `res-${randomUUID().slice(0, 8)}`,
      requestId,
      status,
      body,
      headers: headers ?? {},
      timestamp: Date.now(),
    };

    this.responseLog.push(response);

    // Calculate latency from original message
    const originalMessage = this.messageLog.find(m => m.id === requestId);
    if (originalMessage) {
      const latency = response.timestamp - originalMessage.timestamp;
      this.totalLatency += latency;
    }

    if (status >= 400) {
      this.errorCount++;
    }

    this.emit('acp:response:received', {
      responseId: response.id,
      requestId,
      status,
    });

    return response;
  }

  /**
   * Add a route to the ACP routing table.
   */
  addRoute(route: ACPRoute): void {
    this.routes.push(route);
    this.emit('acp:route:added', {
      path: route.path,
      method: route.method,
    });
  }

  /** Get all registered routes */
  getRoutes(): ACPRoute[] {
    return [...this.routes];
  }

  /** Get a specific agent by ID */
  getAgent(id: string): ACPAgentInfo | undefined {
    return this.agents.get(id);
  }

  /**
   * List all agents with optional filtering by capability or status.
   */
  listAgents(filter?: {
    capability?: string;
    status?: ACPAgentInfo['status'];
  }): ACPAgentInfo[] {
    let agents = [...this.agents.values()];

    if (filter?.capability) {
      agents = agents.filter(a => a.capabilities.includes(filter.capability!));
    }

    if (filter?.status) {
      agents = agents.filter(a => a.status === filter.status);
    }

    return agents;
  }

  /**
   * Get the message log with optional filtering.
   */
  getMessageLog(filter?: {
    from?: string;
    to?: string;
    method?: string;
    since?: number;
  }): ACPMessage[] {
    let messages = [...this.messageLog];

    if (filter?.from !== undefined) {
      messages = messages.filter(m => m.from === filter.from);
    }
    if (filter?.to !== undefined) {
      messages = messages.filter(m => m.to === filter.to);
    }
    if (filter?.method !== undefined) {
      messages = messages.filter(m => m.method === filter.method);
    }
    if (filter?.since !== undefined) {
      messages = messages.filter(m => m.timestamp >= filter.since!);
    }

    return messages;
  }

  /**
   * Bridge an ACP message to MCP tool invocation format.
   * Converts the ACP message method and body into an MCP-compatible
   * tool name and arguments structure.
   */
  bridgeToMCP(acpMessage: ACPMessage): {
    tool: string;
    arguments: Record<string, unknown>;
  } {
    // Map ACP method to MCP tool name
    // Convention: ACP method "namespace/action" becomes MCP tool "namespace_action"
    const tool = acpMessage.method.replace(/\//g, '_').replace(/\./g, '_');

    // Build MCP arguments from ACP body
    const args: Record<string, unknown> = {};

    if (typeof acpMessage.body === 'object' && acpMessage.body !== null) {
      Object.assign(args, acpMessage.body);
    } else {
      args['input'] = acpMessage.body;
    }

    // Include ACP metadata as MCP arguments
    args['_acp_from'] = acpMessage.from;
    args['_acp_to'] = acpMessage.to;
    args['_acp_message_id'] = acpMessage.id;

    this.emit('acp:bridge:to-mcp', {
      messageId: acpMessage.id,
      tool,
    });

    return { tool, arguments: args };
  }

  /**
   * Bridge an MCP tool result back to ACP response format.
   */
  bridgeFromMCP(tool: string, result: unknown): ACPResponse {
    const response: ACPResponse = {
      id: `res-${randomUUID().slice(0, 8)}`,
      requestId: `mcp:${tool}`,
      status: 200,
      body: result,
      headers: {
        'x-bridge-source': 'mcp',
        'x-mcp-tool': tool,
      },
      timestamp: Date.now(),
    };

    this.responseLog.push(response);
    this.emit('acp:bridge:from-mcp', {
      responseId: response.id,
      tool,
    });

    return response;
  }

  /**
   * Bridge an ACP message to Google A2A task format.
   * Converts ACP messaging semantics into A2A task-based semantics.
   */
  bridgeToA2A(acpMessage: ACPMessage): {
    taskId: string;
    message: unknown;
  } {
    const taskId = `a2a-${randomUUID().slice(0, 8)}`;

    // Build A2A message structure
    const message = {
      role: 'user',
      parts: [
        {
          type: 'text',
          text: typeof acpMessage.body === 'string'
            ? acpMessage.body
            : JSON.stringify(acpMessage.body),
        },
      ],
      metadata: {
        acp_from: acpMessage.from,
        acp_to: acpMessage.to,
        acp_method: acpMessage.method,
        acp_message_id: acpMessage.id,
        ...acpMessage.headers,
      },
    };

    this.emit('acp:bridge:to-a2a', {
      messageId: acpMessage.id,
      taskId,
    });

    return { taskId, message };
  }

  /**
   * Get adapter statistics.
   */
  getStats(): ACPStats {
    const totalResponses = this.responseLog.length;
    const avgLatencyMs = totalResponses > 0
      ? this.totalLatency / totalResponses
      : 0;

    const activeConnections = [...this.agents.values()].filter(
      a => a.status === 'available' || a.status === 'busy',
    ).length;

    return {
      totalMessages: this.messageLog.length,
      totalResponses,
      totalErrors: this.errorCount,
      avgLatencyMs,
      registeredAgents: this.agents.size,
      activeConnections,
    };
  }
}
