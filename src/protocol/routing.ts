/**
 * AgentRouter — Intelligent routing for agent requests
 *
 * Routes requests to the best agent endpoint based on configurable algorithms:
 * round-robin, weighted, least-latency, or capability-match. Supports
 * pattern-based routing with conditions and collects per-route metrics.
 *
 * Part of CortexOS Phase IV: The Agent Internet
 */

import { EventEmitter } from 'events';
import type {
  AgentEndpoint,
  CADPConfig,
  CADPEventType,
  RouteCondition,
  RouteEntry,
  RouteMetrics,
} from './types.js';
import type { AgentDNS } from './agent-dns.js';

export class AgentRouter extends EventEmitter {
  private routes: Map<string, RouteEntry> = new Map();
  private agentDNS: AgentDNS;
  private algorithm: CADPConfig['routingAlgorithm'];
  private roundRobinCounters: Map<string, number> = new Map();

  constructor(
    agentDNS: AgentDNS,
    options?: { algorithm?: CADPConfig['routingAlgorithm'] },
  ) {
    super();
    this.agentDNS = agentDNS;
    this.algorithm = options?.algorithm ?? 'least-latency';
  }

  // ---------------------------------------------------------------------------
  // Route management
  // ---------------------------------------------------------------------------

  /** Add a new route. Initializes metrics to zero. */
  addRoute(route: Omit<RouteEntry, 'metrics'>): RouteEntry {
    const fullRoute: RouteEntry = {
      ...route,
      metrics: {
        totalRequests: 0,
        successCount: 0,
        failCount: 0,
        avgLatencyMs: 0,
        lastUsed: 0,
      },
    };
    this.routes.set(route.pattern, fullRoute);
    this.emit('cadp:route:updated' satisfies CADPEventType, {
      pattern: route.pattern,
      action: 'added',
    });
    return fullRoute;
  }

  /** Remove a route by its pattern. */
  removeRoute(pattern: string): boolean {
    const existed = this.routes.delete(pattern);
    if (existed) {
      this.roundRobinCounters.delete(pattern);
      this.emit('cadp:route:updated' satisfies CADPEventType, {
        pattern,
        action: 'removed',
      });
    }
    return existed;
  }

  /** Update an existing route. Returns the updated route, or null if not found. */
  updateRoute(pattern: string, updates: Partial<RouteEntry>): RouteEntry | null {
    const existing = this.routes.get(pattern);
    if (!existing) return null;

    const updated: RouteEntry = {
      ...existing,
      ...updates,
      pattern, // pattern is immutable (it's the key)
      metrics: existing.metrics, // preserve metrics unless explicitly updated
    };

    if (updates.metrics) {
      updated.metrics = { ...existing.metrics, ...updates.metrics };
    }

    this.routes.set(pattern, updated);
    this.emit('cadp:route:updated' satisfies CADPEventType, {
      pattern,
      action: 'updated',
    });
    return updated;
  }

  /** Get a route by pattern. */
  getRoute(pattern: string): RouteEntry | undefined {
    return this.routes.get(pattern);
  }

  /** List all routes, sorted by priority (lower = higher priority). */
  listRoutes(): RouteEntry[] {
    return Array.from(this.routes.values()).sort((a, b) => a.priority - b.priority);
  }

  // ---------------------------------------------------------------------------
  // Core routing: find the best endpoint for a request
  // ---------------------------------------------------------------------------

  /**
   * Route a request to the best endpoint.
   *
   * Strategy:
   * 1. If `agentId` is provided, resolve directly via AgentDNS.
   * 2. Check explicit routes (pattern matching against agentId or capability).
   * 3. If `capability` is provided, resolve all matching endpoints via AgentDNS.
   * 4. Apply the configured routing algorithm to select the best endpoint.
   * 5. Filter by conditions (region, latency, protocol, etc.).
   */
  route(request: {
    agentId?: string;
    capability?: string;
    region?: string;
    maxLatency?: number;
    maxCost?: number;
    protocol?: AgentEndpoint['protocol'];
  }): AgentEndpoint | null {
    // Step 1: Try direct agent resolution
    if (request.agentId) {
      const directEndpoint = this.agentDNS.resolve(request.agentId, request.protocol);
      if (directEndpoint) {
        // Check if it passes filters
        if (this.endpointMatchesFilters(directEndpoint, request)) {
          return directEndpoint;
        }
      }
    }

    // Step 2: Check explicit routes
    const matchedRoutes = this.findMatchingRoutes(request);
    if (matchedRoutes.length > 0) {
      // Filter by conditions
      const validRoutes = matchedRoutes.filter((route) => {
        if (route.conditions && route.conditions.length > 0) {
          const context = this.buildConditionContext(request, route);
          return this.evaluateConditions(route.conditions, context);
        }
        return true;
      });

      if (validRoutes.length > 0) {
        // Apply routing algorithm to matched route destinations
        const endpoints = validRoutes
          .map((r) => r.destination)
          .filter((ep) => ep.healthy && this.endpointMatchesFilters(ep, request));

        if (endpoints.length > 0) {
          const selected = this.applyAlgorithm(endpoints, validRoutes, request.capability);
          if (selected) return selected;
        }
      }
    }

    // Step 3: Try capability-based resolution via AgentDNS
    if (request.capability) {
      const endpoints = this.agentDNS.resolveAll(request.capability);
      const filtered = endpoints.filter((ep) => this.endpointMatchesFilters(ep, request));
      if (filtered.length > 0) {
        return this.applyAlgorithm(filtered, [], request.capability);
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Multi-route: find all possible endpoints
  // ---------------------------------------------------------------------------

  /**
   * Find all possible endpoints for a request, up to `limit`.
   */
  routeAll(request: {
    capability?: string;
    limit?: number;
  }): AgentEndpoint[] {
    const limit = request.limit ?? 100;
    const results: AgentEndpoint[] = [];
    const seen = new Set<string>();

    // Gather from explicit routes
    for (const route of this.routes.values()) {
      if (request.capability && this.patternMatches(route.pattern, request.capability)) {
        if (route.destination.healthy && !seen.has(route.destination.url)) {
          seen.add(route.destination.url);
          results.push(route.destination);
          if (results.length >= limit) return results;
        }
      }
    }

    // Gather from AgentDNS capability index
    if (request.capability) {
      const dnsEndpoints = this.agentDNS.resolveAll(request.capability);
      for (const ep of dnsEndpoints) {
        if (!seen.has(ep.url)) {
          seen.add(ep.url);
          results.push(ep);
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Record a routing result (for metrics)
  // ---------------------------------------------------------------------------

  /** Record the outcome of a routed request for metrics tracking. */
  recordResult(pattern: string, result: { success: boolean; latencyMs: number }): void {
    const route = this.routes.get(pattern);
    if (!route) return;

    const m = route.metrics;
    m.totalRequests++;
    m.lastUsed = Date.now();

    if (result.success) {
      m.successCount++;
    } else {
      m.failCount++;
    }

    // Rolling average latency
    if (m.totalRequests === 1) {
      m.avgLatencyMs = result.latencyMs;
    } else {
      m.avgLatencyMs =
        m.avgLatencyMs + (result.latencyMs - m.avgLatencyMs) / m.totalRequests;
    }
  }

  // ---------------------------------------------------------------------------
  // Routing algorithms
  // ---------------------------------------------------------------------------

  /** Cycle through endpoints sequentially. */
  routeRoundRobin(endpoints: AgentEndpoint[]): AgentEndpoint | null {
    if (endpoints.length === 0) return null;

    // Use a global counter key for round-robin
    const key = '_global_rr';
    const counter = this.roundRobinCounters.get(key) ?? 0;
    const index = counter % endpoints.length;
    this.roundRobinCounters.set(key, counter + 1);

    return endpoints[index];
  }

  /** Probability-based selection using weight values. */
  routeWeighted(entries: Array<{ endpoint: AgentEndpoint; weight: number }>): AgentEndpoint | null {
    if (entries.length === 0) return null;

    const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
    if (totalWeight <= 0) {
      // Fallback to first entry if all weights are zero
      return entries[0].endpoint;
    }

    let random = Math.random() * totalWeight;
    for (const entry of entries) {
      random -= entry.weight;
      if (random <= 0) {
        return entry.endpoint;
      }
    }

    // Fallback (should not normally reach here due to floating point)
    return entries[entries.length - 1].endpoint;
  }

  /** Pick the endpoint with the lowest average latency. */
  routeLeastLatency(endpoints: AgentEndpoint[]): AgentEndpoint | null {
    if (endpoints.length === 0) return null;

    let best = endpoints[0];
    let bestLatency = best.latencyMs ?? Number.MAX_SAFE_INTEGER;

    for (let i = 1; i < endpoints.length; i++) {
      const lat = endpoints[i].latencyMs ?? Number.MAX_SAFE_INTEGER;
      if (lat < bestLatency) {
        best = endpoints[i];
        bestLatency = lat;
      }
    }

    return best;
  }

  /**
   * Prefer endpoints with a matching protocol, then sort by latency.
   * If `capability` is provided it is used for preference ordering but
   * filtering by capability is done upstream.
   */
  routeCapabilityMatch(endpoints: AgentEndpoint[], capability: string): AgentEndpoint | null {
    if (endpoints.length === 0) return null;

    // Prefer a2a protocol for agent-to-agent capability routing, then mcp, then rest
    const protocolOrder: AgentEndpoint['protocol'][] = ['a2a', 'mcp', 'rest', 'grpc', 'websocket'];

    // Sort by protocol preference, then by latency
    const sorted = [...endpoints].sort((a, b) => {
      const pa = protocolOrder.indexOf(a.protocol);
      const pb = protocolOrder.indexOf(b.protocol);
      if (pa !== pb) return pa - pb;

      const la = a.latencyMs ?? Number.MAX_SAFE_INTEGER;
      const lb = b.latencyMs ?? Number.MAX_SAFE_INTEGER;
      return la - lb;
    });

    return sorted[0];
  }

  // ---------------------------------------------------------------------------
  // Condition evaluation
  // ---------------------------------------------------------------------------

  /** Evaluate a set of route conditions against a context. All conditions must pass. */
  evaluateConditions(conditions: RouteCondition[], context: Record<string, unknown>): boolean {
    for (const cond of conditions) {
      const contextValue = context[cond.type];
      if (!this.evaluateSingleCondition(cond, contextValue)) {
        return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats(): {
    totalRoutes: number;
    totalRequests: number;
    avgLatencyMs: number;
    successRate: number;
  } {
    let totalRequests = 0;
    let totalSuccess = 0;
    let latencySum = 0;
    let latencyCount = 0;

    for (const route of this.routes.values()) {
      totalRequests += route.metrics.totalRequests;
      totalSuccess += route.metrics.successCount;
      if (route.metrics.totalRequests > 0) {
        latencySum += route.metrics.avgLatencyMs * route.metrics.totalRequests;
        latencyCount += route.metrics.totalRequests;
      }
    }

    return {
      totalRoutes: this.routes.size,
      totalRequests,
      avgLatencyMs: latencyCount > 0 ? latencySum / latencyCount : 0,
      successRate: totalRequests > 0 ? totalSuccess / totalRequests : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Apply the configured routing algorithm to select one endpoint.
   */
  private applyAlgorithm(
    endpoints: AgentEndpoint[],
    routes: RouteEntry[],
    capability?: string,
  ): AgentEndpoint | null {
    switch (this.algorithm) {
      case 'round-robin':
        return this.routeRoundRobin(endpoints);

      case 'weighted': {
        // Build weighted entries from routes, or use equal weights
        const entries = endpoints.map((ep) => {
          const matchingRoute = routes.find((r) => r.destination.url === ep.url);
          return {
            endpoint: ep,
            weight: matchingRoute?.weight ?? 1,
          };
        });
        return this.routeWeighted(entries);
      }

      case 'least-latency':
        return this.routeLeastLatency(endpoints);

      case 'capability-match':
        return this.routeCapabilityMatch(endpoints, capability ?? '');

      default:
        return this.routeLeastLatency(endpoints);
    }
  }

  /**
   * Find all routes whose pattern matches the request's agentId or capability.
   * Routes are returned sorted by priority (lower = higher priority).
   */
  private findMatchingRoutes(request: {
    agentId?: string;
    capability?: string;
  }): RouteEntry[] {
    const matched: RouteEntry[] = [];

    for (const route of this.routes.values()) {
      if (request.agentId && this.patternMatches(route.pattern, request.agentId)) {
        matched.push(route);
      } else if (request.capability && this.patternMatches(route.pattern, request.capability)) {
        matched.push(route);
      }
    }

    return matched.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Simple glob-style pattern matching.
   * Supports `*` (any chars except `/`) and `**` (any chars including `/`).
   */
  private patternMatches(pattern: string, value: string): boolean {
    // Exact match fast path
    if (pattern === value) return true;
    if (pattern === '*' || pattern === '**') return true;

    // Convert glob to regex
    let regex = '^';
    let i = 0;
    while (i < pattern.length) {
      const c = pattern[i];
      if (c === '*') {
        if (pattern[i + 1] === '*') {
          regex += '.*';
          i += 2;
          continue;
        }
        regex += '[^/]*';
      } else if (c === '?') {
        regex += '.';
      } else if ('.+^${}()|[]\\'.includes(c)) {
        regex += '\\' + c;
      } else {
        regex += c;
      }
      i++;
    }
    regex += '$';

    try {
      return new RegExp(regex).test(value);
    } catch {
      return false;
    }
  }

  /** Check whether an endpoint matches the request's filter criteria. */
  private endpointMatchesFilters(
    ep: AgentEndpoint,
    request: {
      region?: string;
      maxLatency?: number;
      protocol?: AgentEndpoint['protocol'];
    },
  ): boolean {
    if (request.protocol && ep.protocol !== request.protocol) {
      return false;
    }
    if (request.region && ep.region && ep.region !== request.region) {
      return false;
    }
    if (
      request.maxLatency !== undefined &&
      ep.latencyMs !== undefined &&
      ep.latencyMs > request.maxLatency
    ) {
      return false;
    }
    return true;
  }

  /** Build a context map for condition evaluation from the request and route. */
  private buildConditionContext(
    request: Record<string, unknown>,
    route: RouteEntry,
  ): Record<string, unknown> {
    return {
      capability: request.capability ?? '',
      region: request.region ?? route.destination.region ?? '',
      latency: route.destination.latencyMs ?? 0,
      load: route.metrics.totalRequests,
      cost: request.maxCost ?? 0,
    };
  }

  /** Evaluate a single condition against a context value. */
  private evaluateSingleCondition(
    cond: RouteCondition,
    contextValue: unknown,
  ): boolean {
    const { operator, value: condValue } = cond;

    // Handle missing context value
    if (contextValue === undefined || contextValue === null) {
      // If the context doesn't have this value, the condition is considered non-applicable (pass)
      return true;
    }

    switch (operator) {
      case 'eq':
        return contextValue === condValue;

      case 'ne':
        return contextValue !== condValue;

      case 'gt':
        return typeof contextValue === 'number' && typeof condValue === 'number'
          ? contextValue > condValue
          : false;

      case 'lt':
        return typeof contextValue === 'number' && typeof condValue === 'number'
          ? contextValue < condValue
          : false;

      case 'contains':
        if (typeof contextValue === 'string' && typeof condValue === 'string') {
          return contextValue.includes(condValue);
        }
        if (Array.isArray(contextValue)) {
          return contextValue.includes(condValue);
        }
        return false;

      case 'matches':
        if (typeof contextValue === 'string' && typeof condValue === 'string') {
          try {
            return new RegExp(condValue).test(contextValue);
          } catch {
            return false;
          }
        }
        return false;

      default:
        return false;
    }
  }
}
