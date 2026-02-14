/**
 * Agent Registry — Manages Agent Listings in the Marketplace
 *
 * Provides CRUD operations for agent listings, quality metric tracking,
 * transaction management, and local JSON persistence.
 * Uses Node.js built-in modules — zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  AgentListing,
  AgentQualityMetrics,
  AgentTransaction,
  MarketplaceEventType,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// AGENT REGISTRY
// ═══════════════════════════════════════════════════════════════

export class AgentRegistry extends EventEmitter {
  private agents: Map<string, AgentListing> = new Map();
  private transactions: AgentTransaction[] = [];
  private readonly cachePath: string | undefined;

  constructor(options?: { cachePath?: string }) {
    super();
    this.cachePath = options?.cachePath;
  }

  // ─────────────────────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────────────────────

  /**
   * Register a new agent listing in the marketplace.
   * Assigns a unique ID and timestamps automatically.
   */
  register(listing: Omit<AgentListing, 'id' | 'createdAt' | 'updatedAt'>): AgentListing {
    const now = Date.now();
    const agent: AgentListing = {
      ...listing,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    this.agents.set(agent.id, agent);
    this.emit('marketplace:agent:registered' satisfies MarketplaceEventType, agent);
    return agent;
  }

  /**
   * Update an existing agent listing.
   * Merges provided fields and bumps updatedAt.
   */
  update(agentId: string, updates: Partial<AgentListing>): AgentListing {
    const existing = this.agents.get(agentId);
    if (!existing) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const updated: AgentListing = {
      ...existing,
      ...updates,
      id: existing.id,           // Prevent ID mutation
      createdAt: existing.createdAt, // Preserve original creation time
      updatedAt: Date.now(),
    };

    this.agents.set(agentId, updated);
    this.emit('marketplace:agent:updated' satisfies MarketplaceEventType, updated);
    return updated;
  }

  /**
   * Remove an agent listing from the registry.
   * Returns true if the agent was found and removed.
   */
  remove(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    this.agents.delete(agentId);
    this.emit('marketplace:agent:removed' satisfies MarketplaceEventType, agent);
    return true;
  }

  /**
   * Get a single agent listing by ID.
   */
  get(agentId: string): AgentListing | undefined {
    return this.agents.get(agentId);
  }

  /**
   * List agents with optional filters for status and author.
   */
  list(filter?: { status?: AgentListing['status']; author?: string }): AgentListing[] {
    let results = Array.from(this.agents.values());

    if (filter?.status) {
      results = results.filter(a => a.status === filter.status);
    }
    if (filter?.author) {
      const authorLower = filter.author.toLowerCase();
      results = results.filter(a =>
        a.author.id === filter.author ||
        a.author.name.toLowerCase().includes(authorLower)
      );
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────────
  // QUALITY TRACKING
  // ─────────────────────────────────────────────────────────────

  /**
   * Record the result of a call to an agent.
   * Updates rolling quality metrics (success rate, latency, cost).
   */
  recordCall(
    agentId: string,
    result: { success: boolean; latencyMs: number; cost: number; tokensUsed: number },
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const q = agent.quality;
    const prevTotal = q.totalCalls;
    const newTotal = prevTotal + 1;

    // Rolling average for success rate
    q.successRate = (q.successRate * prevTotal + (result.success ? 1 : 0)) / newTotal;

    // Rolling average for latency
    q.avgLatencyMs = (q.avgLatencyMs * prevTotal + result.latencyMs) / newTotal;

    // Rolling average for cost per call
    q.avgCostPerCall = (q.avgCostPerCall * prevTotal + result.cost) / newTotal;

    q.totalCalls = newTotal;
    q.lastVerified = Date.now();

    agent.updatedAt = Date.now();
  }

  /**
   * Get the current quality metrics for an agent.
   */
  getQualityMetrics(agentId: string): AgentQualityMetrics | undefined {
    const agent = this.agents.get(agentId);
    return agent ? { ...agent.quality } : undefined;
  }

  // ─────────────────────────────────────────────────────────────
  // TRANSACTIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a new transaction record.
   * Assigns a unique ID and start timestamp automatically.
   */
  createTransaction(
    tx: Omit<AgentTransaction, 'id' | 'startedAt'>,
  ): AgentTransaction {
    const transaction: AgentTransaction = {
      ...tx,
      id: randomUUID(),
      startedAt: Date.now(),
    };

    this.transactions.push(transaction);
    this.emit('marketplace:transaction:started' satisfies MarketplaceEventType, transaction);
    return transaction;
  }

  /**
   * Complete a pending transaction.
   * Marks it as completed or failed and records call metrics on the agent.
   */
  completeTransaction(
    txId: string,
    result: { success: boolean; tokensUsed?: number },
  ): void {
    const tx = this.transactions.find(t => t.id === txId);
    if (!tx) {
      throw new Error(`Transaction not found: ${txId}`);
    }

    const completedAt = Date.now();
    tx.status = result.success ? 'completed' : 'failed';
    tx.completedAt = completedAt;
    if (result.tokensUsed !== undefined) {
      tx.tokensUsed = result.tokensUsed;
    }

    // Update quality metrics on the seller agent
    const agent = this.agents.get(tx.sellerAgentId);
    if (agent) {
      this.recordCall(tx.sellerAgentId, {
        success: result.success,
        latencyMs: completedAt - tx.startedAt,
        cost: tx.cost,
        tokensUsed: tx.tokensUsed,
      });
    }

    const eventType: MarketplaceEventType = result.success
      ? 'marketplace:transaction:completed'
      : 'marketplace:transaction:failed';
    this.emit(eventType, tx);
  }

  /**
   * Query transactions with optional filters.
   */
  getTransactions(
    filter?: { agentId?: string; status?: AgentTransaction['status'] },
  ): AgentTransaction[] {
    let results = [...this.transactions];

    if (filter?.agentId) {
      results = results.filter(t =>
        t.buyerAgentId === filter.agentId || t.sellerAgentId === filter.agentId,
      );
    }
    if (filter?.status) {
      results = results.filter(t => t.status === filter.status);
    }

    return results;
  }

  /**
   * Get aggregate transaction statistics.
   */
  getTransactionStats(): {
    totalTransactions: number;
    totalSpent: number;
    avgCost: number;
  } {
    const completed = this.transactions.filter(t => t.status === 'completed');
    const totalSpent = completed.reduce((sum, t) => sum + t.cost, 0);

    return {
      totalTransactions: this.transactions.length,
      totalSpent,
      avgCost: completed.length > 0 ? totalSpent / completed.length : 0,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PERSISTENCE
  // ─────────────────────────────────────────────────────────────

  /**
   * Save the registry state (agents + transactions) to a local JSON file.
   */
  save(path?: string): void {
    const filePath = path ?? this.cachePath;
    if (!filePath) {
      throw new Error('No save path specified and no cachePath configured');
    }

    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data = {
      version: 1,
      savedAt: Date.now(),
      agents: Array.from(this.agents.entries()),
      transactions: this.transactions,
    };

    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Load registry state from a local JSON file.
   * Merges loaded data into current in-memory state.
   */
  load(path?: string): void {
    const filePath = path ?? this.cachePath;
    if (!filePath) {
      throw new Error('No load path specified and no cachePath configured');
    }

    if (!existsSync(filePath)) {
      return; // Nothing to load — start fresh
    }

    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as {
      version: number;
      savedAt: number;
      agents: Array<[string, AgentListing]>;
      transactions: AgentTransaction[];
    };

    this.agents = new Map(data.agents);
    this.transactions = data.transactions ?? [];
  }

  // ─────────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get high-level registry statistics.
   */
  getStats(): {
    totalAgents: number;
    activeAgents: number;
    totalTransactions: number;
    totalSpent: number;
  } {
    const activeAgents = Array.from(this.agents.values())
      .filter(a => a.status === 'active').length;
    const txStats = this.getTransactionStats();

    return {
      totalAgents: this.agents.size,
      activeAgents,
      totalTransactions: txStats.totalTransactions,
      totalSpent: txStats.totalSpent,
    };
  }
}
