/**
 * Agent Marketplace — The Main Marketplace Engine
 *
 * High-level orchestrator that composes AgentRegistry, AgentDiscovery,
 * and PricingEngine into a unified marketplace for hiring, executing,
 * publishing, and managing agents in the CortexOS Agent Economy.
 * Uses Node.js built-in modules — zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type {
  AgentListing,
  AgentTransaction,
  MarketplaceConfig,
  MarketplaceEventType,
} from './types.js';
import { AgentRegistry } from './agent-registry.js';
import { AgentDiscovery } from './discovery.js';
import { PricingEngine } from './pricing.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: MarketplaceConfig = {
  enabled: true,
  autoDiscover: false,
  maxConcurrentNegotiations: 10,
  defaultBudget: 10.0,
  commissionRate: 0.15,
};

// ═══════════════════════════════════════════════════════════════
// AGENT MARKETPLACE
// ═══════════════════════════════════════════════════════════════

export class AgentMarketplace extends EventEmitter {
  private config: MarketplaceConfig;
  private registry: AgentRegistry;
  private discovery: AgentDiscovery;
  private pricingEngine: PricingEngine;
  private initialized = false;

  constructor(config?: Partial<MarketplaceConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize subcomponents
    this.registry = new AgentRegistry({
      cachePath: this.config.localCachePath
        ? join(this.config.localCachePath, 'registry.json')
        : undefined,
    });
    this.discovery = new AgentDiscovery(this.registry);
    this.pricingEngine = new PricingEngine({
      maxBudget: this.config.defaultBudget,
      commissionRate: this.config.commissionRate,
    });

    // Forward events from subcomponents
    this.forwardEvents();
  }

  // ─────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  /**
   * Initialize the marketplace.
   * Loads persisted registry data and optionally discovers remote agents.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load persisted registry data
    if (this.config.localCachePath) {
      try {
        this.registry.load();
      } catch {
        // First run or corrupted cache — start fresh
      }
    }

    // Auto-discover remote registry if configured
    if (this.config.autoDiscover && this.config.registryUrl) {
      try {
        const remoteAgents = await this.fetchRemoteRegistry(this.config.registryUrl);
        for (const agent of remoteAgents) {
          // Only register agents that don't already exist locally
          const existing = this.registry.list().find(a => a.name === agent.name && a.author.id === agent.author.id);
          if (!existing) {
            this.registry.register({
              name: agent.name,
              description: agent.description,
              version: agent.version,
              author: agent.author,
              capabilities: agent.capabilities,
              tags: agent.tags,
              pricing: agent.pricing,
              quality: agent.quality,
              endpoints: agent.endpoints,
              status: agent.status,
            });
          }
        }
      } catch {
        // Remote registry unavailable — continue with local data
      }
    }

    this.initialized = true;
  }

  /**
   * Shut down the marketplace.
   * Persists registry data and cleans up resources.
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    // Persist registry data
    if (this.config.localCachePath) {
      try {
        this.registry.save();
      } catch {
        // Best-effort persistence
      }
    }

    this.initialized = false;
  }

  // ─────────────────────────────────────────────────────────────
  // HIGH-LEVEL OPERATIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Hire an agent for a task.
   *
   * 1. Search for agents matching the capability
   * 2. Rank by quality/cost ratio (composite score)
   * 3. Check budget
   * 4. Create a transaction
   * 5. Return the selected agent and transaction ID
   */
  async hireAgent(query: {
    capability: string;
    maxCost?: number;
    prompt: string;
  }): Promise<{ agent: AgentListing; transactionId: string } | null> {
    this.ensureInitialized();

    // Step 1: Search for matching agents
    const searchResult = this.discovery.search({
      capabilities: [query.capability],
      maxCost: query.maxCost,
      minRating: 0,
      sortBy: 'rating',
      sortOrder: 'desc',
      limit: 50,
    });

    if (searchResult.agents.length === 0) {
      // Fall back to recommendation based on the prompt
      const recommended = this.discovery.recommend(query.prompt, 10);
      if (recommended.length === 0) {
        return null;
      }
      // Use recommendations, filtered by cost if applicable
      searchResult.agents.push(
        ...recommended.filter(a =>
          query.maxCost === undefined || this.getEffectiveCost(a) <= query.maxCost,
        ),
      );
    }

    if (searchResult.agents.length === 0) {
      return null;
    }

    // Step 2: Rank by quality/cost ratio
    const ranked = this.rankAgents(searchResult.agents);

    // Step 3 & 4: Try agents in ranked order until one fits the budget
    for (const agent of ranked) {
      const cost = this.pricingEngine.calculateCost(agent, { callCount: 1 });

      // Check budget
      if (!this.pricingEngine.canAfford(cost)) {
        continue;
      }

      // Create transaction
      const transaction = this.registry.createTransaction({
        buyerAgentId: 'self', // The local CortexOS instance
        sellerAgentId: agent.id,
        taskId: randomUUID(),
        cost,
        tokensUsed: 0,
        status: 'pending',
        metadata: {
          capability: query.capability,
          prompt: query.prompt,
        },
      });

      // Reserve budget
      this.pricingEngine.recordSpend(cost);

      return { agent, transactionId: transaction.id };
    }

    // No affordable agent found
    return null;
  }

  /**
   * Execute a task on a specific agent.
   * Sends the input to the agent's endpoint and records the transaction result.
   *
   * Supports A2A, MCP HTTP, and REST endpoints.
   * Returns the execution result and completed transaction.
   */
  async executeTask(
    agentId: string,
    input: Record<string, unknown>,
  ): Promise<{ result: unknown; transaction: AgentTransaction }> {
    this.ensureInitialized();

    const agent = this.registry.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Calculate cost
    const cost = this.pricingEngine.calculateCost(agent, { callCount: 1 });

    // Create transaction
    const transaction = this.registry.createTransaction({
      buyerAgentId: 'self',
      sellerAgentId: agentId,
      taskId: randomUUID(),
      cost,
      tokensUsed: 0,
      status: 'pending',
      metadata: { input },
    });

    try {
      // Determine endpoint and execute
      const result = await this.callAgentEndpoint(agent, input);

      // Record spend
      if (this.pricingEngine.canAfford(cost)) {
        this.pricingEngine.recordSpend(cost);
      }

      // Complete transaction successfully
      this.registry.completeTransaction(transaction.id, {
        success: true,
        tokensUsed: typeof result === 'object' && result !== null && 'tokensUsed' in result
          ? Number((result as Record<string, unknown>).tokensUsed)
          : 0,
      });

      // Get the updated transaction
      const completedTx = this.registry.getTransactions({ agentId })
        .find(t => t.id === transaction.id) ?? transaction;

      return { result, transaction: completedTx };
    } catch (error) {
      // Complete transaction as failed
      this.registry.completeTransaction(transaction.id, { success: false });

      const failedTx = this.registry.getTransactions({ agentId })
        .find(t => t.id === transaction.id) ?? transaction;

      throw Object.assign(
        new Error(`Task execution failed for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`),
        { transaction: failedTx },
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // COMPONENTS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get the underlying agent registry.
   */
  getRegistry(): AgentRegistry {
    return this.registry;
  }

  /**
   * Get the underlying discovery service.
   */
  getDiscovery(): AgentDiscovery {
    return this.discovery;
  }

  /**
   * Get the underlying pricing engine.
   */
  getPricingEngine(): PricingEngine {
    return this.pricingEngine;
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLISHING
  // ─────────────────────────────────────────────────────────────

  /**
   * Publish a new agent to the marketplace.
   */
  async publishAgent(
    listing: Omit<AgentListing, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<AgentListing> {
    this.ensureInitialized();
    const agent = this.registry.register(listing);

    // Persist immediately
    if (this.config.localCachePath) {
      try {
        this.registry.save();
      } catch {
        // Best-effort persistence
      }
    }

    return agent;
  }

  /**
   * Unpublish an agent from the marketplace.
   * Marks it as inactive rather than deleting, preserving history.
   */
  async unpublishAgent(agentId: string): Promise<boolean> {
    this.ensureInitialized();
    const agent = this.registry.get(agentId);
    if (!agent) {
      return false;
    }

    // Mark as inactive rather than removing — preserve transaction history
    this.registry.update(agentId, { status: 'inactive' });

    // Persist immediately
    if (this.config.localCachePath) {
      try {
        this.registry.save();
      } catch {
        // Best-effort persistence
      }
    }

    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get aggregated stats from all marketplace subsystems.
   */
  getStats(): {
    registry: ReturnType<AgentRegistry['getStats']>;
    discovery: ReturnType<AgentDiscovery['getStats']>;
    pricing: ReturnType<PricingEngine['getStats']>;
  } {
    return {
      registry: this.registry.getStats(),
      discovery: this.discovery.getStats(),
      pricing: this.pricingEngine.getStats(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Ensure the marketplace has been initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Marketplace not initialized. Call initialize() first.');
    }
  }

  /**
   * Forward relevant events from subcomponents through the marketplace.
   */
  private forwardEvents(): void {
    const eventTypes: MarketplaceEventType[] = [
      'marketplace:agent:registered',
      'marketplace:agent:updated',
      'marketplace:agent:removed',
      'marketplace:discovery:search',
      'marketplace:negotiation:started',
      'marketplace:negotiation:completed',
      'marketplace:transaction:started',
      'marketplace:transaction:completed',
      'marketplace:transaction:failed',
    ];

    for (const eventType of eventTypes) {
      // Forward from registry
      this.registry.on(eventType, (data: unknown) => this.emit(eventType, data));
      // Forward from discovery
      this.discovery.on(eventType, (data: unknown) => this.emit(eventType, data));
      // Forward from pricing engine
      this.pricingEngine.on(eventType, (data: unknown) => this.emit(eventType, data));
    }
  }

  /**
   * Rank agents by a composite quality/cost score.
   * Higher quality and lower cost = higher rank.
   */
  private rankAgents(agents: AgentListing[]): AgentListing[] {
    return [...agents].sort((a, b) => {
      const scoreA = this.computeCompositeScore(a);
      const scoreB = this.computeCompositeScore(b);
      return scoreB - scoreA; // Descending — best first
    });
  }

  /**
   * Compute a composite score that balances quality against cost.
   */
  private computeCompositeScore(agent: AgentListing): number {
    const q = agent.quality;
    const cost = this.getEffectiveCost(agent);

    // Quality: rating (0-5) normalized to 0-1, plus success rate (0-1)
    const qualityScore = (q.rating / 5) * 0.6 + q.successRate * 0.4;

    // Cost efficiency: lower cost is better
    const costEfficiency = 1 / (1 + cost);

    // Experience factor: agents with more calls are more trustworthy (logarithmic)
    const experienceFactor = Math.log2(1 + q.totalCalls) / 10;

    // Latency factor: lower latency is better
    const latencyFactor = q.avgLatencyMs > 0 ? 1 / (1 + q.avgLatencyMs / 5000) : 1;

    return (qualityScore * 0.5 + costEfficiency * 0.3 + experienceFactor * 0.1 + latencyFactor * 0.1);
  }

  /**
   * Get the effective cost per call for an agent.
   */
  private getEffectiveCost(agent: AgentListing): number {
    const pricing = agent.pricing;
    if (pricing.model === 'free') return 0;
    if (pricing.baseCost !== undefined) return pricing.baseCost;
    if (pricing.tokenRate !== undefined) return pricing.tokenRate;
    return agent.quality.avgCostPerCall;
  }

  /**
   * Call an agent's endpoint with input data.
   * Tries endpoints in priority order: A2A > MCP HTTP > REST.
   */
  private async callAgentEndpoint(
    agent: AgentListing,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const endpoints = agent.endpoints;

    // Try A2A endpoint first
    if (endpoints.a2aUrl) {
      return this.postJson(`${endpoints.a2aUrl}/tasks/send`, {
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tasks/send',
        params: {
          id: randomUUID(),
          message: {
            role: 'user',
            parts: [{ type: 'text', text: JSON.stringify(input) }],
          },
        },
      });
    }

    // Try MCP HTTP endpoint
    if (endpoints.mcpUrl) {
      return this.postJson(endpoints.mcpUrl, {
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/call',
        params: input,
      });
    }

    // Try plain REST endpoint
    if (endpoints.restUrl) {
      return this.postJson(endpoints.restUrl, input);
    }

    // MCP stdio command — cannot be called over network
    if (endpoints.mcpCommand) {
      throw new Error(
        `Agent ${agent.name} only supports MCP stdio (command: ${endpoints.mcpCommand}). ` +
        'Network execution not supported for stdio-based agents.',
      );
    }

    throw new Error(`Agent ${agent.name} has no callable endpoints configured.`);
  }

  /**
   * POST JSON to a URL and return the parsed response.
   * Uses Node.js built-in http/https modules.
   */
  private postJson(url: string, body: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const isHttps = url.startsWith('https://');
      const doRequest = isHttps ? httpsRequest : httpRequest;

      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        timeout: 30_000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      const req = doRequest(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf-8');

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${responseBody}`));
            return;
          }

          try {
            resolve(JSON.parse(responseBody));
          } catch {
            resolve(responseBody); // Return raw text if not JSON
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request to ${url} timed out after 30s`));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Fetch agent listings from a remote registry URL.
   */
  private fetchRemoteRegistry(registryUrl: string): Promise<AgentListing[]> {
    return new Promise((resolve) => {
      const isHttps = registryUrl.startsWith('https://');
      const doRequest = isHttps ? httpsRequest : httpRequest;

      const req = doRequest(registryUrl, { method: 'GET', timeout: 15_000 }, (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          resolve([]);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            const data = JSON.parse(body);
            if (Array.isArray(data)) {
              resolve(data as AgentListing[]);
            } else if (data && Array.isArray(data.agents)) {
              resolve(data.agents as AgentListing[]);
            } else {
              resolve([]);
            }
          } catch {
            resolve([]);
          }
        });
      });

      req.on('error', () => resolve([]));
      req.on('timeout', () => {
        req.destroy();
        resolve([]);
      });

      req.end();
    });
  }
}
