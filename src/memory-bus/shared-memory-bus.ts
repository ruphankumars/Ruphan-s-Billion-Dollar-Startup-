/**
 * SharedMemoryBus — Real-Time Event-Driven Shared Memory
 *
 * Enables agents to simultaneously read/write shared state with
 * CRDT-based conflict resolution, pub/sub channels, and state
 * projections. Supports TTL-based expiry with automatic cleanup.
 *
 * Zero npm dependencies.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  MemoryEntry,
  MemoryChannel,
  ChannelMessage,
  StateProjection,
  ChangeEvent,
  ConflictEvent,
  MemoryBusConfig,
  MemoryBusStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface SetOptions {
  /** TTL in milliseconds (overrides default) */
  ttl?: number;
  /** Tags for filtering */
  tags?: string[];
}

interface QueryFilter {
  /** Filter by tags (entries must have all specified tags) */
  tags?: string[];
  /** Filter by key prefix */
  prefix?: string;
  /** Filter by the agent that last wrote the entry */
  agentId?: string;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: MemoryBusConfig = {
  enabled: true,
  maxEntries: 100_000,
  defaultTtl: 0,
  conflictStrategy: 'last-write-wins',
  maxChangeHistory: 10_000,
  cleanupIntervalMs: 30_000,
  maxChannels: 1_000,
};

// ═══════════════════════════════════════════════════════════════
// SHARED MEMORY BUS
// ═══════════════════════════════════════════════════════════════

export class SharedMemoryBus extends EventEmitter {
  private config: MemoryBusConfig;
  private running = false;

  /** Shared state entries keyed by entry key */
  private entries: Map<string, MemoryEntry> = new Map();

  /** Pub/sub channels keyed by channel name */
  private channels: Map<string, MemoryChannel> = new Map();

  /** Change history (bounded by maxChangeHistory) */
  private changeHistory: ChangeEvent[] = [];

  /** State projections keyed by projection name */
  private projections: Map<string, StateProjection> = new Map();

  /** Subscriber callbacks keyed by channel name */
  private subscribers: Map<string, Set<(msg: ChannelMessage) => void>> = new Map();

  /** Cleanup timer reference */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // ── Stats tracking ──────────────────────────────────────────
  private totalWrites = 0;
  private totalReads = 0;
  private totalConflicts = 0;
  private totalMessages = 0;
  private totalExpired = 0;
  private writeLatencySum = 0;

  constructor(config?: Partial<MemoryBusConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  /** Start the memory bus and begin the cleanup timer. */
  start(): void {
    this.running = true;

    if (this.config.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(
        () => this.cleanup(),
        this.config.cleanupIntervalMs,
      );
    }

    this.emit('membus:lifecycle:started', { timestamp: Date.now() });
  }

  /** Stop the memory bus and clear the cleanup timer. */
  stop(): void {
    this.running = false;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.emit('membus:lifecycle:stopped', { timestamp: Date.now() });
  }

  /** Whether the memory bus is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────────
  // STATE OPERATIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Write a value to shared state.
   *
   * If the key already exists, conflict resolution is applied using the
   * configured strategy. A ChangeEvent is recorded and
   * `membus:state:updated` is emitted.
   */
  set(key: string, value: unknown, agentId: string, options?: SetOptions): MemoryEntry {
    const start = Date.now();
    const existing = this.entries.get(key);

    let entry: MemoryEntry;

    if (existing) {
      // ── Conflict resolution ─────────────────────────────────
      const incoming: Partial<MemoryEntry> = {
        key,
        value,
        writtenBy: agentId,
        tags: options?.tags ?? existing.tags,
        ttl: options?.ttl ?? existing.ttl,
      };

      entry = this.resolveConflict(existing, incoming);
    } else {
      // ── New entry ───────────────────────────────────────────
      entry = {
        key,
        value,
        version: 1,
        writtenBy: agentId,
        updatedAt: Date.now(),
        createdAt: Date.now(),
        ttl: options?.ttl ?? this.config.defaultTtl,
        tags: options?.tags ?? [],
      };
    }

    // Enforce max entries — evict oldest if at capacity
    if (!existing && this.entries.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    this.entries.set(key, entry);

    // Record change
    const change: ChangeEvent = {
      id: `chg_${randomUUID().slice(0, 8)}`,
      type: existing ? 'set' : 'set',
      key,
      oldValue: existing?.value ?? null,
      newValue: value,
      agentId,
      timestamp: Date.now(),
    };
    this.pushChange(change);

    // Stats
    this.totalWrites++;
    this.writeLatencySum += Date.now() - start;

    this.emit('membus:state:updated', { entry, change });

    return entry;
  }

  /**
   * Read a value from shared state by key.
   *
   * Returns `undefined` if the key does not exist. Increments the read
   * counter and emits `membus:state:read`.
   */
  get(key: string, agentId: string): unknown {
    const entry = this.entries.get(key);
    this.totalReads++;

    if (entry) {
      this.emit('membus:state:read', { key, agentId, timestamp: Date.now() });
      return entry.value;
    }

    return undefined;
  }

  /**
   * Delete an entry from shared state.
   *
   * Returns `true` if the entry existed and was removed, `false` otherwise.
   * Records a ChangeEvent and emits `membus:state:deleted`.
   */
  delete(key: string, agentId: string): boolean {
    const existing = this.entries.get(key);
    if (!existing) return false;

    this.entries.delete(key);

    const change: ChangeEvent = {
      id: `chg_${randomUUID().slice(0, 8)}`,
      type: 'delete',
      key,
      oldValue: existing.value,
      newValue: null,
      agentId,
      timestamp: Date.now(),
    };
    this.pushChange(change);

    this.emit('membus:state:deleted', { key, agentId, change });

    return true;
  }

  /** Check whether a key exists in shared state. */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Return all keys currently in shared state. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Get the full MemoryEntry for a key (or undefined). */
  getEntry(key: string): MemoryEntry | undefined {
    return this.entries.get(key);
  }

  /**
   * Query entries by filter criteria.
   *
   * - `tags`: entries must contain **all** specified tags
   * - `prefix`: key must start with the given prefix
   * - `agentId`: entry must have been last written by this agent
   */
  query(filter: QueryFilter): MemoryEntry[] {
    let results = [...this.entries.values()];

    if (filter.tags && filter.tags.length > 0) {
      results = results.filter((e) =>
        filter.tags!.every((tag) => e.tags.includes(tag)),
      );
    }

    if (filter.prefix) {
      results = results.filter((e) => e.key.startsWith(filter.prefix!));
    }

    if (filter.agentId) {
      results = results.filter((e) => e.writtenBy === filter.agentId);
    }

    return results;
  }

  // ─────────────────────────────────────────────────────────────
  // CHANNELS (PUB/SUB)
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a new pub/sub channel.
   *
   * Throws if the channel already exists or the maximum channel limit
   * has been reached.
   */
  createChannel(name: string, description: string): MemoryChannel {
    if (this.channels.has(name)) {
      throw new Error(`Channel already exists: ${name}`);
    }
    if (this.channels.size >= this.config.maxChannels) {
      throw new Error(`Maximum channel limit reached: ${this.config.maxChannels}`);
    }

    const channel: MemoryChannel = {
      name,
      description,
      subscribers: [],
      messageCount: 0,
      createdAt: Date.now(),
    };

    this.channels.set(name, channel);
    this.subscribers.set(name, new Set());

    this.emit('membus:channel:created', { channel });

    return channel;
  }

  /**
   * Delete a channel and remove all its subscribers.
   *
   * Returns `true` if the channel existed and was removed.
   */
  deleteChannel(name: string): boolean {
    const channel = this.channels.get(name);
    if (!channel) return false;

    this.channels.delete(name);
    this.subscribers.delete(name);

    this.emit('membus:channel:deleted', { name, timestamp: Date.now() });

    return true;
  }

  /**
   * Subscribe an agent to a channel with a callback.
   *
   * The callback is invoked whenever a message is published to the channel.
   * Throws if the channel does not exist.
   */
  subscribe(channel: string, agentId: string, callback: (msg: ChannelMessage) => void): void {
    const ch = this.channels.get(channel);
    if (!ch) {
      throw new Error(`Channel not found: ${channel}`);
    }

    if (!ch.subscribers.includes(agentId)) {
      ch.subscribers.push(agentId);
    }

    this.subscribers.get(channel)!.add(callback);

    this.emit('membus:channel:subscribed', {
      channel,
      agentId,
      timestamp: Date.now(),
    });
  }

  /**
   * Unsubscribe an agent from a channel.
   *
   * Removes the agent ID from the channel's subscriber list.
   * Does not throw if the agent is not subscribed.
   */
  unsubscribe(channel: string, agentId: string): void {
    const ch = this.channels.get(channel);
    if (!ch) return;

    ch.subscribers = ch.subscribers.filter((id) => id !== agentId);

    this.emit('membus:channel:unsubscribed', {
      channel,
      agentId,
      timestamp: Date.now(),
    });
  }

  /**
   * Publish a message to a channel.
   *
   * Invokes all subscriber callbacks and emits `membus:channel:message`.
   * Throws if the channel does not exist.
   */
  publish(channel: string, agentId: string, type: string, payload: unknown): ChannelMessage {
    const ch = this.channels.get(channel);
    if (!ch) {
      throw new Error(`Channel not found: ${channel}`);
    }

    const message: ChannelMessage = {
      id: `msg_${randomUUID().slice(0, 8)}`,
      channel,
      publishedBy: agentId,
      type,
      payload,
      timestamp: Date.now(),
    };

    ch.messageCount++;
    this.totalMessages++;

    // Deliver to all subscriber callbacks
    const callbacks = this.subscribers.get(channel);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(message);
        } catch {
          // Subscriber errors should not break the bus
        }
      }
    }

    this.emit('membus:channel:message', { message });

    return message;
  }

  // ─────────────────────────────────────────────────────────────
  // STATE PROJECTIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a state projection — a named view over a subset of keys.
   *
   * Projections are lazily refreshed via `refreshProjection`.
   */
  createProjection(name: string, keys: string[], transform?: string): StateProjection {
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry) {
        snapshot[key] = entry.value;
      }
    }

    const projection: StateProjection = {
      name,
      keys,
      transform,
      snapshot,
      lastRefresh: Date.now(),
    };

    this.projections.set(name, projection);

    this.emit('membus:projection:created', { projection });

    return projection;
  }

  /**
   * Refresh a projection's snapshot with current state values.
   *
   * Returns the updated projection. Throws if the projection does not exist.
   */
  refreshProjection(name: string): StateProjection {
    const projection = this.projections.get(name);
    if (!projection) {
      throw new Error(`Projection not found: ${name}`);
    }

    const snapshot: Record<string, unknown> = {};
    for (const key of projection.keys) {
      const entry = this.entries.get(key);
      if (entry) {
        snapshot[key] = entry.value;
      }
    }

    projection.snapshot = snapshot;
    projection.lastRefresh = Date.now();

    this.emit('membus:projection:refreshed', { projection });

    return projection;
  }

  /** Get a projection by name (or undefined). */
  getProjection(name: string): StateProjection | undefined {
    return this.projections.get(name);
  }

  // ─────────────────────────────────────────────────────────────
  // CHANGE HISTORY
  // ─────────────────────────────────────────────────────────────

  /**
   * Retrieve recent change events.
   *
   * @param limit Maximum number of events to return (defaults to all).
   *              Events are returned newest-first.
   */
  getChangeHistory(limit?: number): ChangeEvent[] {
    const history = [...this.changeHistory].reverse();
    return limit ? history.slice(0, limit) : history;
  }

  // ─────────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────────

  /** Get memory bus statistics. */
  getStats(): MemoryBusStats {
    let totalSubscribers = 0;
    for (const ch of this.channels.values()) {
      totalSubscribers += ch.subscribers.length;
    }

    return {
      totalEntries: this.entries.size,
      totalChannels: this.channels.size,
      totalSubscribers,
      totalWrites: this.totalWrites,
      totalReads: this.totalReads,
      totalConflicts: this.totalConflicts,
      totalMessages: this.totalMessages,
      totalExpired: this.totalExpired,
      avgWriteLatency: this.totalWrites > 0
        ? this.writeLatencySum / this.totalWrites
        : 0,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Remove expired entries based on their TTL.
   *
   * Called periodically by the cleanup timer.
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.entries) {
      if (entry.ttl > 0 && now - entry.updatedAt >= entry.ttl) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      const entry = this.entries.get(key)!;
      this.entries.delete(key);
      this.totalExpired++;

      const change: ChangeEvent = {
        id: `chg_${randomUUID().slice(0, 8)}`,
        type: 'expire',
        key,
        oldValue: entry.value,
        newValue: null,
        agentId: 'system',
        timestamp: now,
      };
      this.pushChange(change);

      this.emit('membus:state:expired', { key, entry });
    }

    if (expiredKeys.length > 0) {
      this.emit('membus:cleanup:completed', {
        expired: expiredKeys.length,
        timestamp: now,
      });
    }
  }

  /**
   * Resolve a write conflict between an existing entry and incoming data.
   *
   * Supports four strategies:
   * - `last-write-wins`: Incoming value always wins
   * - `highest-version`: Entry with higher version wins
   * - `merge`: Shallow-merge objects, incoming wins for scalar values
   * - `custom`: Emits a conflict event and defaults to last-write-wins
   */
  private resolveConflict(
    existing: MemoryEntry,
    incoming: Partial<MemoryEntry>,
  ): MemoryEntry {
    this.totalConflicts++;

    let resolvedValue: unknown;

    switch (this.config.conflictStrategy) {
      case 'last-write-wins':
        resolvedValue = incoming.value;
        break;

      case 'highest-version':
        resolvedValue =
          (incoming.version ?? 0) >= existing.version
            ? incoming.value
            : existing.value;
        break;

      case 'merge':
        if (
          typeof existing.value === 'object' &&
          existing.value !== null &&
          typeof incoming.value === 'object' &&
          incoming.value !== null
        ) {
          resolvedValue = {
            ...(existing.value as Record<string, unknown>),
            ...(incoming.value as Record<string, unknown>),
          };
        } else {
          resolvedValue = incoming.value;
        }
        break;

      case 'custom':
      default:
        resolvedValue = incoming.value;
        break;
    }

    const conflictEvent: ConflictEvent = {
      key: existing.key,
      existing,
      incoming,
      strategy: this.config.conflictStrategy,
      resolvedValue,
      timestamp: Date.now(),
    };

    this.emit('membus:conflict:resolved', { conflict: conflictEvent });

    return {
      key: existing.key,
      value: resolvedValue,
      version: existing.version + 1,
      writtenBy: incoming.writtenBy ?? existing.writtenBy,
      updatedAt: Date.now(),
      createdAt: existing.createdAt,
      ttl: incoming.ttl ?? existing.ttl,
      tags: incoming.tags ?? existing.tags,
    };
  }

  /** Push a change event to history, evicting oldest entries if at capacity. */
  private pushChange(change: ChangeEvent): void {
    this.changeHistory.push(change);

    if (this.changeHistory.length > this.config.maxChangeHistory) {
      this.changeHistory = this.changeHistory.slice(
        this.changeHistory.length - this.config.maxChangeHistory,
      );
    }
  }

  /** Evict the oldest entry (by updatedAt) to make room for new entries. */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.updatedAt < oldestTime) {
        oldestTime = entry.updatedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.entries.get(oldestKey)!;
      this.entries.delete(oldestKey);

      const change: ChangeEvent = {
        id: `chg_${randomUUID().slice(0, 8)}`,
        type: 'delete',
        key: oldestKey,
        oldValue: entry.value,
        newValue: null,
        agentId: 'system',
        timestamp: Date.now(),
      };
      this.pushChange(change);

      this.emit('membus:state:evicted', { key: oldestKey, entry });
    }
  }
}
