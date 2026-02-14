/**
 * Sync Types — CortexOS Cross-Device Session Sync
 *
 * Type definitions for session synchronization across devices,
 * conflict detection and resolution, and device management.
 */

// ═══════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════

export interface SyncSession {
  id: string;
  userId: string;
  deviceId: string;
  state: Record<string, unknown>;
  version: number;
  lastSync: number;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════

export interface SyncMessage {
  id: string;
  sessionId: string;
  deviceId: string;
  type: 'full' | 'delta' | 'ack';
  payload: unknown;
  version: number;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFLICTS
// ═══════════════════════════════════════════════════════════════

export interface SyncConflict {
  id: string;
  sessionId: string;
  key: string;
  deviceAValue: unknown;
  deviceBValue: unknown;
  resolution: 'deviceA' | 'deviceB' | 'merged';
  resolvedValue: unknown;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// DEVICES
// ═══════════════════════════════════════════════════════════════

export interface DeviceInfo {
  id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'tablet' | 'embedded' | 'server';
  lastSeen: number;
  capabilities: string[];
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface SyncConfig {
  enabled: boolean;
  maxDevices: number;
  maxSessionSize: number;
  conflictStrategy: 'latest-wins' | 'merge' | 'manual';
  syncIntervalMs: number;
  heartbeatIntervalMs: number;
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface SyncStats {
  totalSessions: number;
  totalDevices: number;
  totalSyncs: number;
  totalConflicts: number;
  avgSyncLatency: number;
}
