/**
 * Agent Discovery — Search and Discover Agents in the Marketplace
 *
 * Provides local registry searching with text matching, capability/tag filtering,
 * cost/quality constraints, sorting, and pagination. Also supports remote agent
 * discovery via the A2A /.well-known/agent.json convention.
 * Uses Node.js built-in modules — zero npm dependencies.
 */

import { EventEmitter } from 'node:events';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type {
  AgentListing,
  DiscoveryQuery,
  DiscoveryResult,
  AgentQualityMetrics,
  AgentEndpoints,
  MarketplaceEventType,
} from './types.js';
import type { AgentRegistry } from './agent-registry.js';

// ═══════════════════════════════════════════════════════════════
// AGENT DISCOVERY
// ═══════════════════════════════════════════════════════════════

export class AgentDiscovery extends EventEmitter {
  private registry: AgentRegistry;
  private discoveredEndpoints: Map<string, number> = new Map(); // url -> lastChecked timestamp
  private totalSearches = 0;
  private totalDiscovered = 0;
  private lastScanAt: number | undefined;

  constructor(registry: AgentRegistry) {
    super();
    this.registry = registry;
  }

  // ─────────────────────────────────────────────────────────────
  // LOCAL SEARCH
  // ─────────────────────────────────────────────────────────────

  /**
   * Search the local registry with filtering, sorting, and pagination.
   *
   * Text matching: case-insensitive match against name, description, capabilities, tags.
   * Capabilities filter: agent must have ALL requested capabilities.
   * Tags filter: agent must have ANY requested tag.
   * Cost/rating/successRate filters applied on quality metrics.
   */
  search(query: DiscoveryQuery): DiscoveryResult {
    const startTime = performance.now();
    this.totalSearches++;

    let agents = this.registry.list({ status: 'active' });

    // Text search — case-insensitive match against multiple fields
    if (query.text) {
      const terms = query.text.toLowerCase().split(/\s+/).filter(Boolean);
      agents = agents.filter(agent => {
        const searchable = [
          agent.name,
          agent.description,
          ...agent.capabilities,
          ...agent.tags,
        ].join(' ').toLowerCase();

        return terms.every(term => searchable.includes(term));
      });
    }

    // Capabilities filter — must have ALL requested capabilities
    if (query.capabilities && query.capabilities.length > 0) {
      const required = query.capabilities.map(c => c.toLowerCase());
      agents = agents.filter(agent => {
        const agentCaps = agent.capabilities.map(c => c.toLowerCase());
        return required.every(req => agentCaps.some(cap => cap.includes(req)));
      });
    }

    // Tags filter — must have ANY requested tag
    if (query.tags && query.tags.length > 0) {
      const requested = query.tags.map(t => t.toLowerCase());
      agents = agents.filter(agent => {
        const agentTags = agent.tags.map(t => t.toLowerCase());
        return requested.some(req => agentTags.some(tag => tag.includes(req)));
      });
    }

    // Cost filter — max cost per call
    if (query.maxCost !== undefined) {
      agents = agents.filter(agent => {
        const cost = this.getEffectiveCost(agent);
        return cost <= query.maxCost!;
      });
    }

    // Rating filter
    if (query.minRating !== undefined) {
      agents = agents.filter(agent => agent.quality.rating >= query.minRating!);
    }

    // Success rate filter
    if (query.minSuccessRate !== undefined) {
      agents = agents.filter(agent => agent.quality.successRate >= query.minSuccessRate!);
    }

    // Count total before pagination
    const total = agents.length;

    // Sort
    const sortBy = query.sortBy ?? 'rating';
    const sortOrder = query.sortOrder ?? 'desc';
    agents = this.sortAgents(agents, sortBy, sortOrder);

    // Pagination
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    agents = agents.slice(offset, offset + limit);

    const executionTimeMs = performance.now() - startTime;

    this.emit('marketplace:discovery:search' satisfies MarketplaceEventType, {
      query,
      resultCount: total,
      executionTimeMs,
    });

    return { agents, total, query, executionTimeMs };
  }

  // ─────────────────────────────────────────────────────────────
  // REMOTE DISCOVERY
  // ─────────────────────────────────────────────────────────────

  /**
   * Discover a remote agent by fetching /.well-known/agent.json from the given URL.
   * Parses the A2A Agent Card and registers it in the local registry if valid.
   */
  async discoverRemote(url: string): Promise<AgentListing | null> {
    try {
      const baseUrl = url.replace(/\/+$/, '');
      const agentJsonUrl = `${baseUrl}/.well-known/agent.json`;

      const agentCard = await this.fetchJson(agentJsonUrl);
      if (!agentCard || !agentCard.name) {
        return null;
      }

      // Convert A2A Agent Card to AgentListing
      const provider = agentCard.provider as Record<string, unknown> | undefined;
      const listing = this.registry.register({
        name: String(agentCard.name ?? 'Unknown Agent'),
        description: String(agentCard.description ?? ''),
        version: String(agentCard.version ?? '0.0.0'),
        author: {
          id: String(provider?.name ?? 'unknown'),
          name: String(provider?.name ?? 'Unknown'),
          url: baseUrl,
          verified: false,
        },
        capabilities: this.extractCapabilities(agentCard),
        tags: this.extractTags(agentCard),
        pricing: {
          model: 'negotiated',
          currency: 'USD',
        },
        quality: {
          rating: 0,
          totalCalls: 0,
          successRate: 0,
          avgLatencyMs: 0,
          avgCostPerCall: 0,
        },
        endpoints: {
          a2aUrl: baseUrl,
        },
        status: 'active',
      });

      this.discoveredEndpoints.set(url, Date.now());
      this.totalDiscovered++;
      return listing;
    } catch {
      // Failed to discover — return null rather than throwing
      return null;
    }
  }

  /**
   * Scan a list of known endpoint URLs for A2A agents.
   * Returns all successfully discovered agents.
   */
  async scanEndpoints(urls: string[]): Promise<AgentListing[]> {
    this.lastScanAt = Date.now();
    const results: AgentListing[] = [];

    // Scan sequentially to avoid overwhelming targets
    for (const url of urls) {
      const agent = await this.discoverRemote(url);
      if (agent) {
        results.push(agent);
      }
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────────
  // INTELLIGENT SELECTION
  // ─────────────────────────────────────────────────────────────

  /**
   * Find the single best agent for a given capability.
   * Ranks by a composite score of quality rating, success rate, and cost efficiency.
   */
  findBest(
    capability: string,
    options?: { maxCost?: number; minRating?: number },
  ): AgentListing | null {
    const result = this.search({
      capabilities: [capability],
      maxCost: options?.maxCost,
      minRating: options?.minRating,
      limit: 100,
      sortBy: 'rating',
      sortOrder: 'desc',
    });

    if (result.agents.length === 0) {
      return null;
    }

    // Score agents by composite quality/cost ratio
    let bestAgent: AgentListing | null = null;
    let bestScore = -Infinity;

    for (const agent of result.agents) {
      const score = this.computeAgentScore(agent);
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestAgent;
  }

  /**
   * Recommend agents based on a free-text task description.
   * Scores agents by matching their tags and capabilities against
   * keywords extracted from the task description (string-based, no embeddings).
   */
  recommend(taskDescription: string, limit: number = 5): AgentListing[] {
    const keywords = this.extractKeywords(taskDescription);
    if (keywords.length === 0) {
      return [];
    }

    const allAgents = this.registry.list({ status: 'active' });

    const scored: Array<{ agent: AgentListing; score: number }> = [];

    for (const agent of allAgents) {
      let score = 0;

      // Match against capabilities
      for (const cap of agent.capabilities) {
        const capLower = cap.toLowerCase();
        for (const keyword of keywords) {
          if (capLower.includes(keyword)) {
            score += 3; // Capability matches are weighted higher
          }
        }
      }

      // Match against tags
      for (const tag of agent.tags) {
        const tagLower = tag.toLowerCase();
        for (const keyword of keywords) {
          if (tagLower.includes(keyword)) {
            score += 2;
          }
        }
      }

      // Match against name and description
      const nameLower = agent.name.toLowerCase();
      const descLower = agent.description.toLowerCase();
      for (const keyword of keywords) {
        if (nameLower.includes(keyword)) {
          score += 2;
        }
        if (descLower.includes(keyword)) {
          score += 1;
        }
      }

      // Boost by quality
      score *= (0.5 + agent.quality.rating / 10); // rating 5 = 1.0x boost, 0 = 0.5x
      score *= (0.5 + agent.quality.successRate / 2); // successRate 1.0 = 1.0x boost

      if (score > 0) {
        scored.push({ agent, score });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(s => s.agent);
  }

  // ─────────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get discovery service statistics.
   */
  getStats(): {
    totalSearches: number;
    totalDiscovered: number;
    lastScanAt?: number;
  } {
    return {
      totalSearches: this.totalSearches,
      totalDiscovered: this.totalDiscovered,
      lastScanAt: this.lastScanAt,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get the effective cost per call for an agent.
   */
  private getEffectiveCost(agent: AgentListing): number {
    const pricing = agent.pricing;
    if (pricing.model === 'free') return 0;
    if (pricing.baseCost !== undefined) return pricing.baseCost;
    if (pricing.tokenRate !== undefined) return pricing.tokenRate; // Approximate
    return agent.quality.avgCostPerCall;
  }

  /**
   * Sort agents by a given field and order.
   */
  private sortAgents(
    agents: AgentListing[],
    sortBy: NonNullable<DiscoveryQuery['sortBy']>,
    sortOrder: NonNullable<DiscoveryQuery['sortOrder']>,
  ): AgentListing[] {
    const multiplier = sortOrder === 'asc' ? 1 : -1;

    return [...agents].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (sortBy) {
        case 'rating':
          aVal = a.quality.rating;
          bVal = b.quality.rating;
          break;
        case 'cost':
          aVal = this.getEffectiveCost(a);
          bVal = this.getEffectiveCost(b);
          break;
        case 'latency':
          aVal = a.quality.avgLatencyMs;
          bVal = b.quality.avgLatencyMs;
          break;
        case 'popularity':
          aVal = a.quality.totalCalls;
          bVal = b.quality.totalCalls;
          break;
        default:
          aVal = a.quality.rating;
          bVal = b.quality.rating;
      }

      return (aVal - bVal) * multiplier;
    });
  }

  /**
   * Compute a composite score for agent ranking.
   * Balances quality (rating + success rate) against cost efficiency.
   */
  private computeAgentScore(agent: AgentListing): number {
    const q = agent.quality;
    const cost = this.getEffectiveCost(agent);

    // Quality component: rating (0-5) + success rate bonus (0-1)
    const qualityScore = q.rating + q.successRate * 2;

    // Cost penalty: higher cost reduces score
    // Avoid division by zero — treat free agents as cost 0.001
    const costFactor = 1 / (1 + (cost > 0 ? cost : 0));

    // Popularity bonus (logarithmic so it doesn't dominate)
    const popularityBonus = Math.log2(1 + q.totalCalls) * 0.1;

    // Latency penalty (lower is better)
    const latencyPenalty = q.avgLatencyMs > 0 ? 1 / (1 + q.avgLatencyMs / 1000) : 1;

    return (qualityScore * costFactor + popularityBonus) * latencyPenalty;
  }

  /**
   * Extract keywords from a task description.
   * Removes common stop words and returns unique lowercase terms.
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'need', 'must',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it',
      'they', 'them', 'their', 'this', 'that', 'these', 'those',
      'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'how',
      'what', 'which', 'who', 'whom', 'why',
      'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
      'into', 'about', 'between', 'through', 'during', 'before', 'after',
      'not', 'no', 'nor', 'so', 'too', 'very', 'just', 'also',
      'up', 'out', 'off', 'over', 'under', 'again',
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    return Array.from(new Set(words));
  }

  /**
   * Extract capabilities from an A2A Agent Card response.
   */
  private extractCapabilities(agentCard: Record<string, unknown>): string[] {
    const capabilities: string[] = [];

    if (Array.isArray(agentCard.skills)) {
      for (const skill of agentCard.skills) {
        if (skill && typeof skill === 'object' && 'name' in skill) {
          capabilities.push(String((skill as { name: string }).name));
        }
      }
    }

    if (agentCard.capabilities && typeof agentCard.capabilities === 'object') {
      const caps = agentCard.capabilities as Record<string, unknown>;
      if (caps.streaming) capabilities.push('streaming');
      if (caps.pushNotifications) capabilities.push('push-notifications');
      if (caps.stateTransitionHistory) capabilities.push('state-history');
    }

    return capabilities;
  }

  /**
   * Extract tags from an A2A Agent Card response.
   */
  private extractTags(agentCard: Record<string, unknown>): string[] {
    const tags: string[] = [];

    if (Array.isArray(agentCard.defaultInputModes)) {
      tags.push(...agentCard.defaultInputModes.map((m: unknown) => `input:${String(m)}`));
    }
    if (Array.isArray(agentCard.defaultOutputModes)) {
      tags.push(...agentCard.defaultOutputModes.map((m: unknown) => `output:${String(m)}`));
    }

    if (agentCard.metadata && typeof agentCard.metadata === 'object') {
      const meta = agentCard.metadata as Record<string, unknown>;
      if (meta.protocol) tags.push(`protocol:${String(meta.protocol)}`);
    }

    return tags;
  }

  /**
   * Fetch JSON from a URL using Node.js built-in http/https modules.
   */
  private fetchJson(url: string): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const isHttps = url.startsWith('https://');
      const doRequest = isHttps ? httpsRequest : httpRequest;

      const req = doRequest(url, { method: 'GET', timeout: 10_000 }, (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          resolve(null);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8');
            resolve(JSON.parse(body) as Record<string, unknown>);
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    });
  }
}
