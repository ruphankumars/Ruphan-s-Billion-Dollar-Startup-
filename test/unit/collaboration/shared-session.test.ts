import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharedSessionManager } from '../../../src/collaboration/shared-session.js';

describe('SharedSessionManager', () => {
  let manager: SharedSessionManager;

  beforeEach(() => {
    manager = new SharedSessionManager();
    vi.clearAllMocks();
  });

  describe('share', () => {
    it('creates a shared session with token', () => {
      // share({sessionId, createdBy, accessLevel?, expiresIn?, steeringEnabled?})
      const session = manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      expect(session).toBeDefined();
      expect(session.shareToken).toBeDefined();
      expect(typeof session.shareToken).toBe('string');
      expect(session.shareToken.length).toBeGreaterThan(0);
      expect(session.sessionId).toBe('session-1');
    });

    it('returns existing if already shared', () => {
      const first = manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
      });

      const second = manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
      });

      expect(second.shareToken).toBe(first.shareToken);
    });
  });

  describe('join', () => {
    it('joins a session via token', () => {
      const shared = manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      // join(token, {id, name})
      const result = manager.join(shared.shareToken, {
        id: 'user-2',
        name: 'Bob',
      });

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      // join returns the SharedSession (not just a viewer object)
      expect(result!.sessionId).toBe('session-1');
      expect(result!.viewers.length).toBeGreaterThanOrEqual(1);
    });

    it('returns null for invalid token', () => {
      const result = manager.join('invalid-token-xyz', {
        id: 'user-2',
        name: 'Bob',
      });

      expect(result).toBeNull();
    });

    it('returns null for expired session', () => {
      const shared = manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
        expiresIn: -1000, // already expired
      });

      const result = manager.join(shared.shareToken, {
        id: 'user-2',
        name: 'Bob',
      });

      expect(result).toBeNull();
    });
  });

  describe('leave', () => {
    it('marks viewer as inactive', () => {
      const shared = manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      manager.join(shared.shareToken, {
        id: 'user-2',
        name: 'Bob',
      });

      // leave(sessionId, memberId)
      manager.leave('session-1', 'user-2');

      const activeViewers = manager.getActiveViewers('session-1');
      const bobActive = activeViewers.find((v: any) => v.memberId === 'user-2');
      expect(bobActive).toBeUndefined();
    });
  });

  describe('revoke', () => {
    it('removes shared session', () => {
      const shared = manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
      });

      manager.revoke('session-1');

      const result = manager.getByToken(shared.shareToken);
      expect(result).toBeUndefined();
    });
  });

  describe('getBySessionId', () => {
    it('returns shared session', () => {
      manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
      });

      const result = manager.getBySessionId('session-1');
      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('session-1');
    });
  });

  describe('getByToken', () => {
    it('returns shared session', () => {
      const shared = manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
      });

      const result = manager.getByToken(shared.shareToken);
      expect(result).toBeDefined();
      expect(result!.sessionId).toBe('session-1');
      expect(result!.shareToken).toBe(shared.shareToken);
    });
  });

  describe('listShared', () => {
    it('lists all shared sessions', () => {
      manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      manager.share({
        sessionId: 'session-2',
        createdBy: 'user-1',
        steeringEnabled: false,
      });

      const list = manager.listShared();
      expect(list).toHaveLength(2);
    });
  });

  describe('getActiveViewers', () => {
    it('returns active viewers only', () => {
      const shared = manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      manager.join(shared.shareToken, { id: 'user-2', name: 'Bob' });
      manager.join(shared.shareToken, { id: 'user-3', name: 'Charlie' });
      // leave(sessionId, memberId)
      manager.leave('session-1', 'user-3');

      const viewers = manager.getActiveViewers('session-1');
      expect(viewers).toHaveLength(1);
      expect(viewers[0].memberId).toBe('user-2');
    });
  });

  describe('steer', () => {
    it('sends a steering command', () => {
      manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      // steer({sessionId, memberId, type, content})
      const command = manager.steer({
        sessionId: 'session-1',
        memberId: 'user-2',
        type: 'message',
        content: 'Focus on the header component',
      });

      expect(command).toBeDefined();
      expect(command).not.toBeNull();
      expect(command!.type).toBe('message');
      expect(command!.content).toBe('Focus on the header component');
      expect(command!.acknowledged).toBe(false);
    });

    it('returns null when steering disabled', () => {
      manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: false,
      });

      const command = manager.steer({
        sessionId: 'session-1',
        memberId: 'user-2',
        type: 'message',
        content: 'Focus on the header component',
      });

      expect(command).toBeNull();
    });
  });

  describe('getPendingCommands', () => {
    it('returns unacknowledged commands', () => {
      manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      manager.steer({
        sessionId: 'session-1',
        memberId: 'user-2',
        type: 'message',
        content: 'Command 1',
      });

      manager.steer({
        sessionId: 'session-1',
        memberId: 'user-2',
        type: 'message',
        content: 'Command 2',
      });

      const pending = manager.getPendingCommands('session-1');
      expect(pending).toHaveLength(2);
      expect(pending[0].acknowledged).toBe(false);
      expect(pending[1].acknowledged).toBe(false);
    });
  });

  describe('acknowledgeCommand', () => {
    it('marks command as acknowledged', () => {
      manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      const command = manager.steer({
        sessionId: 'session-1',
        memberId: 'user-2',
        type: 'message',
        content: 'Command 1',
      });

      // acknowledgeCommand(commandId) — not (sessionId, commandId)
      manager.acknowledgeCommand(command!.id);

      const pending = manager.getPendingCommands('session-1');
      expect(pending).toHaveLength(0);
    });
  });

  describe('addArtifact', () => {
    it('adds artifact to session', () => {
      manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      // addArtifact(sessionId, {type, name, url?, data?})
      // ArtifactType is: 'pull-request' | 'branch' | 'commit' | 'plan' | 'report' | 'diff' | 'file'
      const artifact = manager.addArtifact('session-1', {
        type: 'file',
        name: 'main.ts',
        data: { content: 'console.log("hello")' },
      });

      expect(artifact).toBeDefined();
      expect(artifact).not.toBeNull();
      expect(artifact!.type).toBe('file');
      expect(artifact!.name).toBe('main.ts');
    });
  });

  describe('getArtifacts', () => {
    it('returns artifacts, optionally filtered by type', () => {
      manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      manager.addArtifact('session-1', {
        type: 'file',
        name: 'main.ts',
      });

      manager.addArtifact('session-1', {
        type: 'report',
        name: 'diagram.png',
      });

      manager.addArtifact('session-1', {
        type: 'file',
        name: 'utils.ts',
      });

      const allArtifacts = manager.getArtifacts('session-1');
      expect(allArtifacts).toHaveLength(3);

      const fileArtifacts = manager.getArtifacts('session-1', 'file');
      expect(fileArtifacts).toHaveLength(2);
      expect(fileArtifacts.every((a: any) => a.type === 'file')).toBe(true);

      const reportArtifacts = manager.getArtifacts('session-1', 'report');
      expect(reportArtifacts).toHaveLength(1);
      expect(reportArtifacts[0].name).toBe('diagram.png');
    });
  });

  describe('getStats', () => {
    it('returns aggregate statistics', () => {
      manager.share({
        sessionId: 'session-1',
        createdBy: 'user-1',
        steeringEnabled: true,
      });

      manager.share({
        sessionId: 'session-2',
        createdBy: 'user-1',
        steeringEnabled: false,
      });

      const shared1 = manager.getBySessionId('session-1');
      manager.join(shared1!.shareToken, { id: 'user-2', name: 'Bob' });
      manager.join(shared1!.shareToken, { id: 'user-3', name: 'Charlie' });

      manager.steer({
        sessionId: 'session-1',
        memberId: 'user-2',
        type: 'message',
        content: 'Do something',
      });

      const stats = manager.getStats();
      expect(stats).toBeDefined();
      // Stats returns { totalShared, activeViewers, totalArtifacts, pendingCommands }
      expect(stats.totalShared).toBeGreaterThanOrEqual(2);
      expect(stats.activeViewers).toBeGreaterThanOrEqual(2);
      expect(stats.pendingCommands).toBeGreaterThanOrEqual(1);
    });
  });
});
