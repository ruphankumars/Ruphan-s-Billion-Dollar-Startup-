/**
 * SessionSync — Cross-Device Session Synchronization
 *
 * Manages shared sessions across multiple devices with real-time state
 * synchronization, conflict detection, and configurable resolution strategies.
 * Supports full state sync, delta updates, and three conflict strategies:
 * latest-wins, merge, and manual.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  SyncSession,
  SyncMessage,
  SyncConflict,
  DeviceInfo,
  SyncConfig,
  SyncStats,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: SyncConfig = {
  enabled: true,
  maxDevices: 50,
  maxSessionSize: 1024 * 1024, // 1 MB serialized
  conflictStrategy: 'latest-wins',
  syncIntervalMs: 5000,
  heartbeatIntervalMs: 15000,
};

// ═══════════════════════════════════════════════════════════════
// SESSION SYNC
// ═══════════════════════════════════════════════════════════════

export class SessionSync extends EventEmitter {
  private config: SyncConfig;
  private running = false;

  /** Active sessions keyed by session ID */
  private sessions: Map<string, SyncSession> = new Map();

  /** Registered devices keyed by device ID */
  private devices: Map<string, DeviceInfo> = new Map();

  /** Conflict log */
  private conflicts: SyncConflict[] = [];

  /** Per-session version tracking: sessionId -> Map<deviceId, lastKnownVersion> */
  private deviceVersions: Map<string, Map<string, number>> = new Map();

  /** Total sync operations performed (for stats) */
  private totalSyncs = 0;

  /** Cumulative sync latency in ms (for avg calculation) */
  private totalSyncLatency = 0;

  constructor(config?: Partial<SyncConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit('sync:started', { timestamp: Date.now() });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.emit('sync:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // DEVICE MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Register a new device for sync participation.
   */
  registerDevice(device: Omit<DeviceInfo, 'lastSeen'>): DeviceInfo {
    if (this.devices.size >= this.config.maxDevices) {
      throw new Error(`Maximum device limit reached (${this.config.maxDevices})`);
    }

    const newDevice: DeviceInfo = {
      ...device,
      lastSeen: Date.now(),
    };

    this.devices.set(newDevice.id, newDevice);

    this.emit('sync:device:registered', { device: newDevice, timestamp: Date.now() });
    return newDevice;
  }

  /**
   * Unregister a device and clean up its version tracking.
   */
  unregisterDevice(deviceId: string): boolean {
    const existed = this.devices.delete(deviceId);
    if (existed) {
      // Clean up version tracking for this device
      for (const versionMap of this.deviceVersions.values()) {
        versionMap.delete(deviceId);
      }
      this.emit('sync:device:unregistered', { deviceId, timestamp: Date.now() });
    }
    return existed;
  }

  /**
   * Get all registered devices.
   */
  getDevices(): DeviceInfo[] {
    return [...this.devices.values()];
  }

  // ─────────────────────────────────────────────────────────
  // SESSION MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /**
   * Create a new shared session for a user on a specific device.
   */
  createSession(
    userId: string,
    deviceId: string,
    initialState?: Record<string, unknown>,
  ): SyncSession {
    if (!this.devices.has(deviceId)) {
      throw new Error(`Device "${deviceId}" is not registered`);
    }

    const now = Date.now();
    const session: SyncSession = {
      id: `sync-${randomUUID().slice(0, 8)}`,
      userId,
      deviceId,
      state: initialState ? { ...initialState } : {},
      version: 1,
      lastSync: now,
      createdAt: now,
    };

    this.sessions.set(session.id, session);

    // Initialize version tracking for the creating device
    const versionMap = new Map<string, number>();
    versionMap.set(deviceId, 1);
    this.deviceVersions.set(session.id, versionMap);

    // Update device lastSeen
    const device = this.devices.get(deviceId);
    if (device) device.lastSeen = now;

    this.emit('sync:session:created', { session, timestamp: now });
    return session;
  }

  /**
   * Update session state from a specific device.
   * Detects conflicts if another device has modified the same keys.
   * Increments the session version.
   */
  updateState(
    sessionId: string,
    updates: Record<string, unknown>,
    deviceId: string,
  ): SyncSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    if (!this.devices.has(deviceId)) {
      throw new Error(`Device "${deviceId}" is not registered`);
    }

    const syncStart = Date.now();

    // Detect conflicts before applying
    const detectedConflicts = this.detectConflicts(session, updates, deviceId);
    for (const conflict of detectedConflicts) {
      this.conflicts.push(conflict);
      this.emit('sync:conflict:detected', { conflict, timestamp: syncStart });
    }

    // Apply updates (merge or overwrite depending on conflict strategy)
    session.state = this.mergeState(session.state, updates);
    session.version++;
    session.lastSync = syncStart;

    // Update version tracking
    let versionMap = this.deviceVersions.get(sessionId);
    if (!versionMap) {
      versionMap = new Map();
      this.deviceVersions.set(sessionId, versionMap);
    }
    versionMap.set(deviceId, session.version);

    // Update device lastSeen
    const device = this.devices.get(deviceId);
    if (device) device.lastSeen = syncStart;

    // Track sync metrics
    this.totalSyncs++;
    this.totalSyncLatency += Date.now() - syncStart;

    this.emit('sync:state:updated', {
      session,
      deviceId,
      updates,
      conflicts: detectedConflicts.length,
      timestamp: syncStart,
    });

    return session;
  }

  // ─────────────────────────────────────────────────────────
  // SYNC OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Generate sync messages for all devices participating in a session.
   * Each device receives either a full state or a delta depending on
   * whether it has seen the latest version.
   */
  syncDevices(sessionId: string): SyncMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    const messages: SyncMessage[] = [];
    const versionMap = this.deviceVersions.get(sessionId) ?? new Map<string, number>();

    for (const [deviceId, device] of this.devices.entries()) {
      const lastKnownVersion = versionMap.get(deviceId) ?? 0;

      if (lastKnownVersion >= session.version) {
        // Device is up to date — send ack
        messages.push({
          id: `msg-${randomUUID().slice(0, 8)}`,
          sessionId,
          deviceId,
          type: 'ack',
          payload: { version: session.version },
          version: session.version,
          timestamp: Date.now(),
        });
      } else if (lastKnownVersion === 0) {
        // Device has never synced — send full state
        messages.push({
          id: `msg-${randomUUID().slice(0, 8)}`,
          sessionId,
          deviceId,
          type: 'full',
          payload: { ...session.state },
          version: session.version,
          timestamp: Date.now(),
        });
        versionMap.set(deviceId, session.version);
      } else {
        // Device is behind — send delta (for simplicity, send full state as delta payload)
        messages.push({
          id: `msg-${randomUUID().slice(0, 8)}`,
          sessionId,
          deviceId,
          type: 'delta',
          payload: { ...session.state },
          version: session.version,
          timestamp: Date.now(),
        });
        versionMap.set(deviceId, session.version);
      }

      // Update device lastSeen
      device.lastSeen = Date.now();
    }

    this.deviceVersions.set(sessionId, versionMap);
    return messages;
  }

  // ─────────────────────────────────────────────────────────
  // CONFLICT RESOLUTION
  // ─────────────────────────────────────────────────────────

  /**
   * Manually resolve a conflict by choosing a resolution strategy.
   */
  resolveConflict(
    conflictId: string,
    resolution: SyncConflict['resolution'],
  ): SyncConflict {
    const conflict = this.conflicts.find((c) => c.id === conflictId);
    if (!conflict) {
      throw new Error(`Conflict "${conflictId}" not found`);
    }

    conflict.resolution = resolution;
    switch (resolution) {
      case 'deviceA':
        conflict.resolvedValue = conflict.deviceAValue;
        break;
      case 'deviceB':
        conflict.resolvedValue = conflict.deviceBValue;
        break;
      case 'merged':
        // Attempt deep merge if both are objects; otherwise prefer deviceB (latest)
        if (
          typeof conflict.deviceAValue === 'object' &&
          conflict.deviceAValue !== null &&
          typeof conflict.deviceBValue === 'object' &&
          conflict.deviceBValue !== null
        ) {
          conflict.resolvedValue = {
            ...(conflict.deviceAValue as Record<string, unknown>),
            ...(conflict.deviceBValue as Record<string, unknown>),
          };
        } else {
          conflict.resolvedValue = conflict.deviceBValue;
        }
        break;
    }

    // Apply resolution to the session state
    const session = this.sessions.get(conflict.sessionId);
    if (session) {
      session.state[conflict.key] = conflict.resolvedValue;
      session.version++;
      session.lastSync = Date.now();
    }

    this.emit('sync:conflict:resolved', { conflict, timestamp: Date.now() });
    return conflict;
  }

  // ─────────────────────────────────────────────────────────
  // ACCESSORS
  // ─────────────────────────────────────────────────────────

  /**
   * Get a session by ID.
   */
  getSession(id: string): SyncSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * List sessions, optionally filtered by user ID.
   */
  listSessions(userId?: string): SyncSession[] {
    const all = [...this.sessions.values()];
    if (userId) {
      return all.filter((s) => s.userId === userId);
    }
    return all;
  }

  /**
   * Get conflicts, optionally filtered by session ID.
   */
  getConflicts(sessionId?: string): SyncConflict[] {
    if (sessionId) {
      return this.conflicts.filter((c) => c.sessionId === sessionId);
    }
    return [...this.conflicts];
  }

  /**
   * Get sync statistics.
   */
  getStats(): SyncStats {
    return {
      totalSessions: this.sessions.size,
      totalDevices: this.devices.size,
      totalSyncs: this.totalSyncs,
      totalConflicts: this.conflicts.length,
      avgSyncLatency:
        this.totalSyncs > 0
          ? Math.round((this.totalSyncLatency / this.totalSyncs) * 100) / 100
          : 0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — Conflict Detection
  // ─────────────────────────────────────────────────────────

  /**
   * Detect conflicts between the current session state and incoming updates.
   * A conflict occurs when a key in the update was modified by a different
   * device since the updating device last synced.
   */
  private detectConflicts(
    session: SyncSession,
    updates: Record<string, unknown>,
    deviceId: string,
  ): SyncConflict[] {
    const conflicts: SyncConflict[] = [];
    const versionMap = this.deviceVersions.get(session.id);

    if (!versionMap) return conflicts;

    const deviceVersion = versionMap.get(deviceId) ?? 0;

    // If the device is behind the current version, there may be conflicts
    if (deviceVersion < session.version) {
      for (const key of Object.keys(updates)) {
        if (key in session.state) {
          const existingValue = session.state[key];
          const incomingValue = updates[key];

          // Only flag if values actually differ
          if (JSON.stringify(existingValue) !== JSON.stringify(incomingValue)) {
            const conflict: SyncConflict = {
              id: `conflict-${randomUUID().slice(0, 8)}`,
              sessionId: session.id,
              key,
              deviceAValue: existingValue,
              deviceBValue: incomingValue,
              resolution: 'merged', // Default; will be updated by strategy
              resolvedValue: null,
              timestamp: Date.now(),
            };

            // Auto-resolve based on configured strategy
            switch (this.config.conflictStrategy) {
              case 'latest-wins':
                conflict.resolution = 'deviceB';
                conflict.resolvedValue = incomingValue;
                break;
              case 'merge':
                if (
                  typeof existingValue === 'object' &&
                  existingValue !== null &&
                  typeof incomingValue === 'object' &&
                  incomingValue !== null
                ) {
                  conflict.resolution = 'merged';
                  conflict.resolvedValue = {
                    ...(existingValue as Record<string, unknown>),
                    ...(incomingValue as Record<string, unknown>),
                  };
                } else {
                  conflict.resolution = 'deviceB';
                  conflict.resolvedValue = incomingValue;
                }
                break;
              case 'manual':
                // Leave unresolved for manual resolution
                conflict.resolution = 'merged';
                conflict.resolvedValue = existingValue; // Keep existing until resolved
                break;
            }

            conflicts.push(conflict);
          }
        }
      }
    }

    return conflicts;
  }

  // ─────────────────────────────────────────────────────────
  // PRIVATE — State Merging
  // ─────────────────────────────────────────────────────────

  /**
   * Merge incoming state into existing state.
   * Performs a shallow merge (incoming keys overwrite existing).
   * For objects, does a recursive shallow merge one level deep.
   */
  private mergeState(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged = { ...existing };

    for (const [key, value] of Object.entries(incoming)) {
      const existingVal = merged[key];

      if (
        typeof existingVal === 'object' &&
        existingVal !== null &&
        !Array.isArray(existingVal) &&
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        // Shallow merge nested objects one level deep
        merged[key] = {
          ...(existingVal as Record<string, unknown>),
          ...(value as Record<string, unknown>),
        };
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }
}
