/**
 * Shared Memory Bus Types — CortexOS
 *
 * Type definitions for the real-time event-driven shared memory bus.
 * Enables agents to simultaneously read/write shared state with
 * CRDT-based conflict resolution and pub/sub channels.
 */

// ═══════════════════════════════════════════════════════════════
// MEMORY ENTRIES
// ═══════════════════════════════════════════════════════════════

export interface MemoryEntry {
  /** Unique entry key */
  key: string;
  /** The stored value */
  value: unknown;
  /** Version number (incremented on each write) */
  version: number;
  /** Agent ID that last wrote this entry */
  writtenBy: string;
  /** Unix timestamp (ms) of last write */
  updatedAt: number;
  /** Unix timestamp (ms) of creation */
  createdAt: number;
  /** Optional TTL in milliseconds (0 = no expiry) */
  ttl: number;
  /** Tags for filtering */
  tags: string[];
}

// ═══════════════════════════════════════════════════════════════
// CHANNELS
// ═══════════════════════════════════════════════════════════════

export interface MemoryChannel {
  /** Channel name */
  name: string;
  /** Channel description */
  description: string;
  /** Agent IDs subscribed to this channel */
  subscribers: string[];
  /** Total messages published to this channel */
  messageCount: number;
  /** Unix timestamp (ms) of creation */
  createdAt: number;
}

export interface ChannelMessage {
  /** Unique message identifier */
  id: string;
  /** Channel this message belongs to */
  channel: string;
  /** Agent ID that published the message */
  publishedBy: string;
  /** Message type (e.g. 'state-update', 'notification', 'command') */
  type: string;
  /** Message payload */
  payload: unknown;
  /** Unix timestamp (ms) when the message was published */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// STATE PROJECTIONS
// ═══════════════════════════════════════════════════════════════

export interface StateProjection {
  /** Projection name */
  name: string;
  /** Keys to include in this projection */
  keys: string[];
  /** Transform function name (optional) */
  transform?: string;
  /** Read-only snapshot of the projected state */
  snapshot: Record<string, unknown>;
  /** Unix timestamp (ms) of last refresh */
  lastRefresh: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFLICT RESOLUTION
// ═══════════════════════════════════════════════════════════════

export type ConflictStrategy = 'last-write-wins' | 'highest-version' | 'merge' | 'custom';

export interface ConflictEvent {
  /** The key that had a conflict */
  key: string;
  /** The existing entry */
  existing: MemoryEntry;
  /** The incoming entry */
  incoming: Partial<MemoryEntry>;
  /** Strategy used to resolve */
  strategy: ConflictStrategy;
  /** Resolved value */
  resolvedValue: unknown;
  /** Unix timestamp (ms) */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// CHANGE STREAM
// ═══════════════════════════════════════════════════════════════

export type ChangeType = 'set' | 'delete' | 'expire' | 'merge';

export interface ChangeEvent {
  /** Unique change identifier */
  id: string;
  /** Type of change */
  type: ChangeType;
  /** The key that changed */
  key: string;
  /** Value before the change */
  oldValue: unknown;
  /** Value after the change */
  newValue: unknown;
  /** Agent that triggered the change */
  agentId: string;
  /** Unix timestamp (ms) */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface MemoryBusConfig {
  /** Whether the memory bus is enabled */
  enabled: boolean;
  /** Maximum number of entries */
  maxEntries: number;
  /** Default TTL in milliseconds (0 = no expiry) */
  defaultTtl: number;
  /** Conflict resolution strategy */
  conflictStrategy: ConflictStrategy;
  /** Maximum change history to retain */
  maxChangeHistory: number;
  /** Cleanup interval in milliseconds */
  cleanupIntervalMs: number;
  /** Maximum channels allowed */
  maxChannels: number;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface MemoryBusStats {
  /** Total entries in the bus */
  totalEntries: number;
  /** Total channels */
  totalChannels: number;
  /** Total subscribers across all channels */
  totalSubscribers: number;
  /** Total writes since startup */
  totalWrites: number;
  /** Total reads since startup */
  totalReads: number;
  /** Total conflicts resolved */
  totalConflicts: number;
  /** Total messages published */
  totalMessages: number;
  /** Total expired entries cleaned up */
  totalExpired: number;
  /** Average write latency in ms */
  avgWriteLatency: number;
}
