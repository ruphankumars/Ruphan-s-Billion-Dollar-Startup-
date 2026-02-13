/**
 * Collaboration WebSocket — Real-Time Session Collaboration
 *
 * Extends the dashboard WebSocket with session-scoped channels,
 * viewer tracking, presence, and steering commands.
 */

import { randomUUID } from 'node:crypto';
import { SharedSessionManager } from './shared-session.js';
import type {
  CollaborationEvent,
  SteeringCommand,
  SteeringType,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// COLLABORATION WS HANDLER
// ═══════════════════════════════════════════════════════════════

export interface WSConnection {
  id: string;
  send: (data: string) => void;
  sessionId?: string;
  memberId?: string;
  memberName?: string;
}

export class CollaborationWSHandler {
  private connections: Map<string, WSConnection> = new Map();
  private sessionChannels: Map<string, Set<string>> = new Map(); // sessionId → connectionIds
  private sharedSessions: SharedSessionManager;

  constructor(sharedSessions: SharedSessionManager) {
    this.sharedSessions = sharedSessions;
  }

  /** Handle a new WebSocket connection */
  handleConnection(ws: { send: (data: string) => void }): string {
    const connId = `ws_${randomUUID().slice(0, 8)}`;
    const connection: WSConnection = { id: connId, send: ws.send.bind(ws) };
    this.connections.set(connId, connection);
    return connId;
  }

  /** Handle an incoming message */
  handleMessage(connId: string, data: string): void {
    const conn = this.connections.get(connId);
    if (!conn) return;

    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'join-session':
          this.handleJoinSession(conn, message.token, message.memberId, message.memberName);
          break;

        case 'leave-session':
          this.handleLeaveSession(conn);
          break;

        case 'steer':
          this.handleSteer(conn, message.steerType, message.content);
          break;

        case 'presence':
          this.handlePresence(conn);
          break;

        default:
          conn.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${message.type}` }));
      }
    } catch {
      conn.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  }

  /** Handle disconnection */
  handleDisconnect(connId: string): void {
    const conn = this.connections.get(connId);
    if (!conn) return;

    if (conn.sessionId) {
      this.handleLeaveSession(conn);
    }

    this.connections.delete(connId);
  }

  /** Broadcast an event to all viewers of a session */
  broadcastToSession(sessionId: string, event: CollaborationEvent | Record<string, unknown>): void {
    const channelConns = this.sessionChannels.get(sessionId);
    if (!channelConns) return;

    const message = JSON.stringify(event);
    for (const connId of channelConns) {
      const conn = this.connections.get(connId);
      if (conn) {
        try { conn.send(message); } catch { /* ignore */ }
      }
    }
  }

  /** Broadcast an update to all connections for a session */
  broadcastSessionUpdate(sessionId: string, update: Record<string, unknown>): void {
    this.broadcastToSession(sessionId, { type: 'session:update', sessionId, ...update, timestamp: Date.now() });
  }

  /** Get connected viewer count for a session */
  getViewerCount(sessionId: string): number {
    return this.sessionChannels.get(sessionId)?.size ?? 0;
  }

  /** Get all active session channels */
  getActiveChannels(): Array<{ sessionId: string; viewers: number }> {
    const channels: Array<{ sessionId: string; viewers: number }> = [];
    for (const [sessionId, conns] of this.sessionChannels) {
      channels.push({ sessionId, viewers: conns.size });
    }
    return channels;
  }

  /** Get total connection count */
  get connectionCount(): number {
    return this.connections.size;
  }

  // ─── Internal ─────────────────────────────────────────────

  private handleJoinSession(
    conn: WSConnection,
    token: string,
    memberId?: string,
    memberName?: string,
  ): void {
    const shared = this.sharedSessions.getByToken(token);
    if (!shared) {
      conn.send(JSON.stringify({ type: 'error', message: 'Invalid or expired share token' }));
      return;
    }

    // Leave previous session if any
    if (conn.sessionId) this.handleLeaveSession(conn);

    // Join new session
    conn.sessionId = shared.sessionId;
    conn.memberId = memberId ?? 'anonymous';
    conn.memberName = memberName ?? 'Anonymous';

    if (!this.sessionChannels.has(shared.sessionId)) {
      this.sessionChannels.set(shared.sessionId, new Set());
    }
    this.sessionChannels.get(shared.sessionId)!.add(conn.id);

    // Register with shared session manager
    this.sharedSessions.join(token, { id: conn.memberId, name: conn.memberName });

    // Send confirmation
    conn.send(JSON.stringify({
      type: 'joined',
      sessionId: shared.sessionId,
      accessLevel: shared.accessLevel,
      steeringEnabled: shared.steeringEnabled,
      viewers: shared.viewers,
      artifacts: shared.artifacts,
    }));

    // Notify others
    this.broadcastToSession(shared.sessionId, {
      type: 'session:joined',
      sessionId: shared.sessionId,
      memberId: conn.memberId,
      timestamp: Date.now(),
      data: { name: conn.memberName },
    });
  }

  private handleLeaveSession(conn: WSConnection): void {
    if (!conn.sessionId) return;

    const sessionId = conn.sessionId;
    const channel = this.sessionChannels.get(sessionId);
    if (channel) {
      channel.delete(conn.id);
      if (channel.size === 0) this.sessionChannels.delete(sessionId);
    }

    this.sharedSessions.leave(sessionId, conn.memberId ?? 'anonymous');

    // Notify others
    this.broadcastToSession(sessionId, {
      type: 'session:left',
      sessionId,
      memberId: conn.memberId,
      timestamp: Date.now(),
    });

    conn.sessionId = undefined;
    conn.memberId = undefined;
    conn.memberName = undefined;
  }

  private handleSteer(conn: WSConnection, steerType: SteeringType, content: string): void {
    if (!conn.sessionId) {
      conn.send(JSON.stringify({ type: 'error', message: 'Not in a session' }));
      return;
    }

    const command = this.sharedSessions.steer({
      sessionId: conn.sessionId,
      memberId: conn.memberId ?? 'anonymous',
      type: steerType ?? 'message',
      content: content ?? '',
    });

    if (!command) {
      conn.send(JSON.stringify({ type: 'error', message: 'Steering not enabled' }));
      return;
    }

    conn.send(JSON.stringify({ type: 'steer:ack', commandId: command.id }));

    // Broadcast steering event to session
    this.broadcastToSession(conn.sessionId, {
      type: 'session:steered',
      sessionId: conn.sessionId,
      memberId: conn.memberId,
      timestamp: Date.now(),
      data: { commandId: command.id, steerType, content },
    });
  }

  private handlePresence(conn: WSConnection): void {
    if (!conn.sessionId) return;

    const shared = this.sharedSessions.getBySessionId(conn.sessionId);
    if (!shared) return;

    conn.send(JSON.stringify({
      type: 'presence',
      sessionId: conn.sessionId,
      viewers: shared.viewers.filter((v) => v.isActive),
    }));
  }
}
