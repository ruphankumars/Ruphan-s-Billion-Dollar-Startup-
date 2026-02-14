/**
 * Protocol Bridge — MCP ↔ A2A Translation Layer
 *
 * The critical missing piece in the agent ecosystem: translates between
 * MCP (vertical: agent ↔ tools) and A2A (horizontal: agent ↔ agents).
 *
 * CortexOS is the orchestration kernel that sits between both protocols,
 * providing a unified capability registry.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { MCPClient } from './mcp-client.js';
import type { A2AGateway } from './a2a-gateway.js';
import type {
  MCPTool,
  MCPResource,
  AgentCard,
  AgentSkill,
  A2ATask,
  A2AMessage,
  A2APart,
  A2AArtifact,
  UnifiedCapability,
  ProtocolBridgeConfig,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// PROTOCOL BRIDGE
// ═══════════════════════════════════════════════════════════════

export interface ProtocolBridgeOptions {
  config?: Partial<ProtocolBridgeConfig>;
  mcpClient?: MCPClient;
  a2aGateway?: A2AGateway;
}

export class ProtocolBridge extends EventEmitter {
  private mcpClient: MCPClient | null;
  private a2aGateway: A2AGateway | null;
  private config: ProtocolBridgeConfig;
  private capabilities: Map<string, UnifiedCapability> = new Map();
  private discoveredAgents: Map<string, AgentCard> = new Map();
  private translationCache: Map<string, { result: unknown; expires: number }> = new Map();
  private cacheMaxAge = 60_000; // 1 minute cache

  constructor(options: ProtocolBridgeOptions = {}) {
    super();
    this.mcpClient = options.mcpClient ?? null;
    this.a2aGateway = options.a2aGateway ?? null;
    this.config = {
      enabled: true,
      autoDiscover: true,
      exposeAsA2A: true,
      ...options.config,
    };
  }

  /** Initialize the bridge: discover MCP tools and register them as unified capabilities */
  async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    // Index MCP tools
    if (this.mcpClient) {
      await this.indexMCPTools();
    }

    // Index A2A agents from known endpoints
    if (this.config.autoDiscover) {
      // Discovered agents are added via discoverAgent()
    }

    // Apply custom mappings
    if (this.config.mcpToA2AMapping) {
      for (const mapping of this.config.mcpToA2AMapping) {
        const cap = this.capabilities.get(mapping.mcpTool);
        if (cap) {
          // Create A2A skill alias
          const skillCap: UnifiedCapability = {
            ...cap,
            id: mapping.a2aSkill,
            name: mapping.a2aSkill,
          };
          this.capabilities.set(mapping.a2aSkill, skillCap);
        }
      }
    }

    // Wire A2A gateway task handler
    if (this.a2aGateway && this.config.exposeAsA2A) {
      this.a2aGateway.setTaskHandler((task) => this.handleA2ATask(task));

      // Update A2A skills from indexed capabilities
      this.a2aGateway.updateSkills(this.buildA2ASkills());
    }

    this.emit('bridge:initialized', { capabilities: this.capabilities.size });
  }

  /** Set or replace the MCP client */
  setMCPClient(client: MCPClient): void {
    this.mcpClient = client;
  }

  /** Set or replace the A2A gateway */
  setA2AGateway(gateway: A2AGateway): void {
    this.a2aGateway = gateway;
  }

  // ─── Unified Capability Registry ─────────────────────────

  /** Get all unified capabilities (MCP tools + A2A agents + local) */
  getCapabilities(): UnifiedCapability[] {
    return [...this.capabilities.values()];
  }

  /** Find a capability by name */
  findCapability(name: string): UnifiedCapability | undefined {
    return this.capabilities.get(name);
  }

  /** Find capabilities matching a query */
  searchCapabilities(query: string): UnifiedCapability[] {
    const q = query.toLowerCase();
    return [...this.capabilities.values()].filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }

  /** Register a local capability (CortexOS native) */
  registerLocalCapability(cap: Omit<UnifiedCapability, 'source' | 'sourceId'>): void {
    const unified: UnifiedCapability = {
      ...cap,
      source: 'local',
      sourceId: 'cortexos',
    };
    this.capabilities.set(cap.id, unified);
    this.emit('bridge:capability:registered', { id: cap.id, source: 'local' });
  }

  /** Remove a capability */
  removeCapability(id: string): boolean {
    const result = this.capabilities.delete(id);
    if (result) this.emit('bridge:capability:removed', { id });
    return result;
  }

  // ─── MCP → Unified ────────────────────────────────────────

  /** Index all MCP tools as unified capabilities */
  async indexMCPTools(): Promise<number> {
    if (!this.mcpClient) return 0;

    const tools = this.mcpClient.getAllTools();
    let count = 0;

    for (const tool of tools) {
      const cap: UnifiedCapability = {
        id: `mcp:${tool.serverId}:${tool.name}`,
        name: tool.name,
        description: tool.description,
        source: 'mcp',
        sourceId: tool.serverId,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      };
      this.capabilities.set(cap.id, cap);
      count++;
    }

    this.emit('bridge:mcp:indexed', { count });
    return count;
  }

  /** Execute a capability (route to MCP or A2A or local) */
  async executeCapability(
    capabilityId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) {
      throw new Error(`Capability "${capabilityId}" not found`);
    }

    this.emit('bridge:execute:start', { id: capabilityId, source: cap.source });

    const startTime = Date.now();
    let result: unknown;

    try {
      switch (cap.source) {
        case 'mcp':
          result = await this.executeMCPCapability(cap, input);
          break;
        case 'a2a':
          result = await this.executeA2ACapability(cap, input);
          break;
        case 'local':
          result = await this.executeLocalCapability(cap, input);
          break;
        default:
          throw new Error(`Unknown capability source: ${cap.source}`);
      }

      const duration = Date.now() - startTime;
      this.updateCapabilityStats(capabilityId, duration, true);
      this.emit('bridge:execute:complete', { id: capabilityId, duration });

      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      this.updateCapabilityStats(capabilityId, duration, false);
      this.emit('bridge:execute:error', {
        id: capabilityId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // ─── A2A Agent Discovery ──────────────────────────────────

  /** Discover a remote A2A agent by its base URL */
  async discoverAgent(baseUrl: string): Promise<AgentCard | null> {
    try {
      const cardUrl = `${baseUrl.replace(/\/$/, '')}/.well-known/agent.json`;
      const response = await fetch(cardUrl, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) return null;

      const card = (await response.json()) as AgentCard;
      this.discoveredAgents.set(baseUrl, card);

      // Register agent skills as capabilities
      for (const skill of card.skills ?? []) {
        const cap: UnifiedCapability = {
          id: `a2a:${card.name}:${skill.id}`,
          name: `${card.name}/${skill.name}`,
          description: skill.description,
          source: 'a2a',
          sourceId: baseUrl,
        };
        this.capabilities.set(cap.id, cap);
      }

      this.emit('a2a:agent:discovered', { url: baseUrl, name: card.name, skills: card.skills?.length ?? 0 });
      return card;
    } catch {
      return null;
    }
  }

  /** Get all discovered agents */
  getDiscoveredAgents(): Array<{ url: string; card: AgentCard }> {
    return [...this.discoveredAgents.entries()].map(([url, card]) => ({ url, card }));
  }

  /** Remove a discovered agent */
  removeAgent(baseUrl: string): boolean {
    const card = this.discoveredAgents.get(baseUrl);
    if (!card) return false;

    // Remove all capabilities from this agent
    for (const skill of card.skills ?? []) {
      this.capabilities.delete(`a2a:${card.name}:${skill.id}`);
    }

    this.discoveredAgents.delete(baseUrl);
    return true;
  }

  // ─── MCP Tool → A2A Task Translation ─────────────────────

  /** Convert an MCP tool call into an A2A task */
  mcpToolToA2ATask(
    toolName: string,
    args: Record<string, unknown>,
  ): A2ATask {
    const now = Date.now();
    return {
      id: `task_${randomUUID().slice(0, 12)}`,
      status: 'submitted',
      input: {
        role: 'user',
        parts: this.convertArgsToA2AParts(toolName, args),
      },
      history: [],
      artifacts: [],
      metadata: {
        source: 'mcp-bridge',
        originalTool: toolName,
        originalArgs: args,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Convert A2A task result back to MCP tool result format */
  a2aTaskToMCPResult(task: A2ATask): Record<string, unknown> {
    const content: Array<{ type: string; text?: string; [key: string]: unknown }> = [];

    if (task.output) {
      for (const part of task.output.parts) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text });
        } else if (part.type === 'code') {
          content.push({ type: 'text', text: `\`\`\`${part.language ?? ''}\n${part.code}\n\`\`\`` });
        } else if (part.type === 'data') {
          content.push({ type: 'text', text: JSON.stringify(part.data, null, 2) });
        }
      }
    }

    // Include artifacts
    for (const artifact of task.artifacts ?? []) {
      content.push({
        type: 'resource',
        resource: {
          uri: `a2a://artifact/${artifact.id}`,
          name: artifact.name,
          mimeType: artifact.type,
        },
      });
    }

    return {
      content: content.length > 0 ? content : [{ type: 'text', text: 'No output' }],
      isError: task.status === 'failed',
    };
  }

  /** Convert A2A task input into MCP tool call format */
  a2aTaskToMCPToolCall(task: A2ATask): { toolName: string; args: Record<string, unknown> } | null {
    const meta = task.metadata as Record<string, unknown> | undefined;
    if (meta?.originalTool) {
      return {
        toolName: meta.originalTool as string,
        args: (meta.originalArgs as Record<string, unknown>) ?? {},
      };
    }

    // Heuristic: extract tool name and args from text parts
    const textParts = task.input.parts.filter((p) => p.type === 'text') as Array<{ type: 'text'; text: string }>;
    if (textParts.length === 0) return null;

    return {
      toolName: 'execute',
      args: { prompt: textParts.map((p) => p.text).join('\n') },
    };
  }

  // ─── Bridge Stats ─────────────────────────────────────────

  /** Get bridge statistics */
  getStats(): {
    totalCapabilities: number;
    bySource: Record<string, number>;
    discoveredAgents: number;
    cacheSize: number;
  } {
    const bySource: Record<string, number> = { mcp: 0, a2a: 0, local: 0 };
    for (const cap of this.capabilities.values()) {
      bySource[cap.source] = (bySource[cap.source] ?? 0) + 1;
    }

    return {
      totalCapabilities: this.capabilities.size,
      bySource,
      discoveredAgents: this.discoveredAgents.size,
      cacheSize: this.translationCache.size,
    };
  }

  /** Clear the translation cache */
  clearCache(): void {
    this.translationCache.clear();
  }

  // ─── Internal: Execution Routers ──────────────────────────

  private async executeMCPCapability(
    cap: UnifiedCapability,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.mcpClient) throw new Error('MCP client not configured');

    const serverId = cap.sourceId;
    const toolName = cap.name;

    this.emit('bridge:translation', {
      direction: 'execute→mcp',
      capability: cap.id,
      serverId,
      toolName,
    });

    return this.mcpClient.callTool(serverId, toolName, input);
  }

  private async executeA2ACapability(
    cap: UnifiedCapability,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const agentUrl = cap.sourceId;

    // Create an A2A task
    const task: Omit<A2ATask, 'id' | 'createdAt' | 'updatedAt'> = {
      status: 'submitted',
      input: {
        role: 'user',
        parts: this.buildA2AParts(input),
      },
    };

    this.emit('bridge:translation', {
      direction: 'execute→a2a',
      capability: cap.id,
      agentUrl,
    });

    // Send task to remote agent
    const response = await fetch(`${agentUrl}/a2a/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: task.input }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`A2A agent error: ${response.status} ${response.statusText}`);
    }

    const createdTask = (await response.json()) as A2ATask;

    // Poll for completion
    return this.pollA2ATask(agentUrl, createdTask.id);
  }

  private async executeLocalCapability(
    cap: UnifiedCapability,
    _input: Record<string, unknown>,
  ): Promise<unknown> {
    // Local capabilities are handled by CortexOS engine
    // This is wired externally
    this.emit('bridge:translation', {
      direction: 'execute→local',
      capability: cap.id,
    });

    throw new Error(`Local capability "${cap.id}" has no handler registered`);
  }

  private async pollA2ATask(agentUrl: string, taskId: string): Promise<A2ATask> {
    const maxAttempts = 60;
    const pollInterval = 2_000;

    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(`${agentUrl}/a2a/tasks/${taskId}`, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Failed to poll task: ${response.status}`);
      }

      const task = (await response.json()) as A2ATask;

      if (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled') {
        return task;
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Task ${taskId} timed out after ${maxAttempts * pollInterval}ms`);
  }

  // ─── Internal: A2A Task Handler ───────────────────────────

  /** Handle incoming A2A tasks (routed from A2AGateway) */
  private async handleA2ATask(task: A2ATask): Promise<A2ATask> {
    this.emit('bridge:a2a:task:received', { taskId: task.id });

    // Extract prompt from task input
    const textParts = task.input.parts.filter((p) => p.type === 'text') as Array<{ type: 'text'; text: string }>;
    const prompt = textParts.map((p) => p.text).join('\n');

    if (!prompt) {
      return {
        ...task,
        status: 'failed',
        output: {
          role: 'agent',
          parts: [{ type: 'text', text: 'No text input provided' }],
        },
      };
    }

    // Check if this maps to an MCP tool call
    const mcpCall = this.a2aTaskToMCPToolCall(task);
    if (mcpCall && this.mcpClient) {
      const toolResult = this.mcpClient.findTool(mcpCall.toolName);
      if (toolResult) {
        try {
          const result = await this.mcpClient.callTool(
            toolResult.serverId,
            mcpCall.toolName,
            mcpCall.args,
          );
          return {
            ...task,
            status: 'completed',
            output: {
              role: 'agent',
              parts: [{ type: 'data', data: result as Record<string, unknown> }],
            },
          };
        } catch (err) {
          return {
            ...task,
            status: 'failed',
            output: {
              role: 'agent',
              parts: [{ type: 'text', text: `MCP tool error: ${err instanceof Error ? err.message : String(err)}` }],
            },
          };
        }
      }
    }

    // Default: return a "needs external handler" response
    // The CortexOS engine will wire its own handler
    return {
      ...task,
      status: 'completed',
      output: {
        role: 'agent',
        parts: [{ type: 'text', text: `Task "${task.id}" processed. Prompt: ${prompt.slice(0, 200)}` }],
      },
    };
  }

  // ─── Internal: Helpers ────────────────────────────────────

  private convertArgsToA2AParts(toolName: string, args: Record<string, unknown>): A2APart[] {
    const parts: A2APart[] = [
      { type: 'text', text: `Execute tool: ${toolName}` },
    ];

    // Convert common arg patterns
    if (typeof args.prompt === 'string') {
      parts.push({ type: 'text', text: args.prompt });
    }
    if (typeof args.code === 'string') {
      parts.push({ type: 'code', code: args.code, language: args.language as string | undefined });
    }
    if (Object.keys(args).length > 0) {
      parts.push({ type: 'data', data: args });
    }

    return parts;
  }

  private buildA2AParts(input: Record<string, unknown>): A2APart[] {
    const parts: A2APart[] = [];

    if (typeof input.prompt === 'string' || typeof input.text === 'string') {
      parts.push({ type: 'text', text: (input.prompt ?? input.text) as string });
    }
    if (typeof input.code === 'string') {
      parts.push({ type: 'code', code: input.code, language: input.language as string | undefined });
    }

    // Include all data as a data part
    if (parts.length === 0) {
      parts.push({ type: 'data', data: input });
    }

    return parts;
  }

  private buildA2ASkills(): AgentSkill[] {
    const skills: AgentSkill[] = [];

    for (const cap of this.capabilities.values()) {
      if (cap.source === 'mcp') {
        skills.push({
          id: cap.id,
          name: `MCP: ${cap.name}`,
          description: cap.description,
          tags: ['mcp', 'tool'],
        });
      }
    }

    return skills;
  }

  private updateCapabilityStats(
    capabilityId: string,
    durationMs: number,
    success: boolean,
  ): void {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) return;

    // Running average for latency
    const prevLatency = cap.avgLatencyMs ?? durationMs;
    cap.avgLatencyMs = Math.round((prevLatency * 0.8) + (durationMs * 0.2));

    // Quality score decay/boost
    const prevQuality = cap.qualityScore ?? 0.5;
    cap.qualityScore = success
      ? Math.min(1, prevQuality + 0.05)
      : Math.max(0, prevQuality - 0.1);
  }
}
