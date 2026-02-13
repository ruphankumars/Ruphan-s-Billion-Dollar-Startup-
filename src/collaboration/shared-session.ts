/**
 * Shared Session Manager — Session Sharing & Collaboration
 *
 * Generates share tokens, manages share URLs, tracks viewers,
 * handles steering input, and manages session artifacts.
 */

import { randomUUID } from 'node:crypto';
import type {
  SharedSession,
  SessionViewer,
  SessionArtifact,
  ArtifactType,
  AccessLevel,
  SteeringCommand,
  SteeringType,
  CollaborationEvent,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// SHARED SESSION MANAGER
// ═══════════════════════════════════════════════════════════════

export class SharedSessionManager {
  private sessions: Map<string, SharedSession> = new Map();
  private tokenIndex: Map<string, string> = new Map(); // token → sessionId
  private steeringQueue: Map<string, SteeringCommand[]> = new Map();
  private listeners: Map<string, Array<(event: CollaborationEvent) => void>> = new Map();
  private shareBaseUrl: string;

  constructor(options?: { shareBaseUrl?: string }) {
    this.shareBaseUrl = options?.shareBaseUrl ?? 'http://localhost:3100/shared';
  }

  /** Share a session, generating a share token */
  share(options: {
    sessionId: string;
    createdBy: string;
    accessLevel?: AccessLevel;
    expiresIn?: number;
    steeringEnabled?: boolean;
  }): SharedSession {
    // Check if already shared
    const existing = this.sessions.get(options.sessionId);
    if (existing) return existing;

    const shareToken = randomUUID();
    const shareUrl = `${this.shareBaseUrl}/${shareToken}`;

    const shared: SharedSession = {
      sessionId: options.sessionId,
      shareToken,
      shareUrl,
      createdBy: options.createdBy,
      createdAt: Date.now(),
      expiresAt: options.expiresIn ? Date.now() + options.expiresIn : undefined,
      accessLevel: options.accessLevel ?? 'viewer',
      viewers: [],
      artifacts: [],
      steeringEnabled: options.steeringEnabled ?? true,
    };

    this.sessions.set(options.sessionId, shared);
    this.tokenIndex.set(shareToken, options.sessionId);
    this.steeringQueue.set(options.sessionId, []);

    this.emit('session:shared', options.sessionId, options.createdBy);

    return shared;
  }

  /** Join a shared session via token */
  join(token: string, member: { id: string; name: string }): SharedSession | null {
    const sessionId = this.tokenIndex.get(token);
    if (!sessionId) return null;

    const shared = this.sessions.get(sessionId);
    if (!shared) return null;

    // Check expiry
    if (shared.expiresAt && Date.now() > shared.expiresAt) {
      return null;
    }

    // Check if already a viewer
    const existing = shared.viewers.find((v) => v.memberId === member.id);
    if (existing) {
      existing.lastSeenAt = Date.now();
      existing.isActive = true;
      return shared;
    }

    const viewer: SessionViewer = {
      memberId: member.id,
      name: member.name,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      isActive: true,
    };

    shared.viewers.push(viewer);
    this.emit('session:joined', sessionId, member.id);

    return shared;
  }

  /** Leave a shared session */
  leave(sessionId: string, memberId: string): void {
    const shared = this.sessions.get(sessionId);
    if (!shared) return;

    const viewer = shared.viewers.find((v) => v.memberId === memberId);
    if (viewer) {
      viewer.isActive = false;
      viewer.lastSeenAt = Date.now();
    }

    this.emit('session:left', sessionId, memberId);
  }

  /** Revoke a shared session */
  revoke(sessionId: string): boolean {
    const shared = this.sessions.get(sessionId);
    if (!shared) return false;

    this.tokenIndex.delete(shared.shareToken);
    this.sessions.delete(sessionId);
    this.steeringQueue.delete(sessionId);
    return true;
  }

  /** Get shared session by session ID */
  getBySessionId(sessionId: string): SharedSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Get shared session by token */
  getByToken(token: string): SharedSession | undefined {
    const sessionId = this.tokenIndex.get(token);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  /** List all shared sessions */
  listShared(): SharedSession[] {
    return [...this.sessions.values()];
  }

  /** Get active viewers for a session */
  getActiveViewers(sessionId: string): SessionViewer[] {
    const shared = this.sessions.get(sessionId);
    if (!shared) return [];
    return shared.viewers.filter((v) => v.isActive);
  }

  // ─── Steering ─────────────────────────────────────────────

  /** Send a steering command to a session */
  steer(options: {
    sessionId: string;
    memberId: string;
    type: SteeringType;
    content: string;
  }): SteeringCommand | null {
    const shared = this.sessions.get(options.sessionId);
    if (!shared || !shared.steeringEnabled) return null;

    const command: SteeringCommand = {
      id: `steer_${randomUUID().slice(0, 8)}`,
      sessionId: options.sessionId,
      memberId: options.memberId,
      type: options.type,
      content: options.content,
      createdAt: Date.now(),
      acknowledged: false,
    };

    const queue = this.steeringQueue.get(options.sessionId) ?? [];
    queue.push(command);
    this.steeringQueue.set(options.sessionId, queue);

    this.emit('session:steered', options.sessionId, options.memberId);

    return command;
  }

  /** Get pending steering commands for a session */
  getPendingCommands(sessionId: string): SteeringCommand[] {
    const queue = this.steeringQueue.get(sessionId) ?? [];
    return queue.filter((c) => !c.acknowledged);
  }

  /** Acknowledge a steering command */
  acknowledgeCommand(commandId: string): boolean {
    for (const queue of this.steeringQueue.values()) {
      const cmd = queue.find((c) => c.id === commandId);
      if (cmd) {
        cmd.acknowledged = true;
        return true;
      }
    }
    return false;
  }

  // ─── Artifacts ────────────────────────────────────────────

  /** Add an artifact to a shared session */
  addArtifact(
    sessionId: string,
    artifact: {
      type: ArtifactType;
      name: string;
      url?: string;
      data?: Record<string, unknown>;
    },
  ): SessionArtifact | null {
    const shared = this.sessions.get(sessionId);
    if (!shared) return null;

    const art: SessionArtifact = {
      id: `art_${randomUUID().slice(0, 8)}`,
      type: artifact.type,
      name: artifact.name,
      url: artifact.url,
      data: artifact.data,
      createdAt: Date.now(),
    };

    shared.artifacts.push(art);
    this.emit('artifact:created', sessionId);

    return art;
  }

  /** Get artifacts for a session */
  getArtifacts(sessionId: string, type?: ArtifactType): SessionArtifact[] {
    const shared = this.sessions.get(sessionId);
    if (!shared) return [];
    if (type) return shared.artifacts.filter((a) => a.type === type);
    return [...shared.artifacts];
  }

  // ─── Events ───────────────────────────────────────────────

  /** Listen to collaboration events */
  on(event: string, listener: (event: CollaborationEvent) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(listener);
  }

  /** Get session statistics */
  getStats(): {
    totalShared: number;
    activeViewers: number;
    totalArtifacts: number;
    pendingCommands: number;
  } {
    let activeViewers = 0;
    let totalArtifacts = 0;
    let pendingCommands = 0;

    for (const shared of this.sessions.values()) {
      activeViewers += shared.viewers.filter((v) => v.isActive).length;
      totalArtifacts += shared.artifacts.length;
    }

    for (const queue of this.steeringQueue.values()) {
      pendingCommands += queue.filter((c) => !c.acknowledged).length;
    }

    return {
      totalShared: this.sessions.size,
      activeViewers,
      totalArtifacts,
      pendingCommands,
    };
  }

  // ─── Internal ─────────────────────────────────────────────

  private emit(type: CollaborationEvent['type'], sessionId?: string, memberId?: string): void {
    const event: CollaborationEvent = {
      type,
      sessionId,
      memberId,
      timestamp: Date.now(),
    };
    const listeners = this.listeners.get(type) || [];
    for (const listener of listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }
}
