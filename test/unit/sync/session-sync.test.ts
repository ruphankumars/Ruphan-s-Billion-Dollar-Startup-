/**
 * SessionSync — Unit Tests
 *
 * Tests cross-device session synchronization: lifecycle, device management,
 * session creation, state updates with delta merging, sync broadcast,
 * conflict detection/resolution, and statistics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionSync } from '../../../src/sync/session-sync.js';

describe('SessionSync', () => {
  let sync: SessionSync;

  beforeEach(() => {
    sync = new SessionSync();
  });

  afterEach(() => {
    sync.stop();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('creates sync manager with default config', () => {
      expect(sync.isRunning()).toBe(false);
      expect(sync.getStats().totalSessions).toBe(0);
    });

    it('accepts partial config', () => {
      const custom = new SessionSync({ maxDevices: 5 });
      expect(custom.isRunning()).toBe(false);
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('start / stop lifecycle', () => {
    it('starts and emits started event', () => {
      const handler = vi.fn();
      sync.on('sync:started', handler);
      sync.start();
      expect(sync.isRunning()).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('stops and emits stopped event', () => {
      const handler = vi.fn();
      sync.on('sync:stopped', handler);
      sync.start();
      sync.stop();
      expect(sync.isRunning()).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('double start is idempotent', () => {
      const handler = vi.fn();
      sync.on('sync:started', handler);
      sync.start();
      sync.start();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Device Management ──────────────────────────────────────

  describe('registerDevice / unregisterDevice', () => {
    it('registers a device and returns it with lastSeen', () => {
      const device = sync.registerDevice({
        id: 'dev-1',
        name: 'Laptop',
        type: 'desktop',
        capabilities: ['sync', 'compute'],
      });

      expect(device.id).toBe('dev-1');
      expect(device.lastSeen).toBeGreaterThan(0);
      expect(sync.getDevices()).toHaveLength(1);
    });

    it('throws when max device limit is reached', () => {
      const limited = new SessionSync({ maxDevices: 2 });
      limited.registerDevice({ id: 'd1', name: 'A', type: 'desktop', capabilities: [] });
      limited.registerDevice({ id: 'd2', name: 'B', type: 'mobile', capabilities: [] });

      expect(() =>
        limited.registerDevice({ id: 'd3', name: 'C', type: 'tablet', capabilities: [] }),
      ).toThrow(/Maximum device limit/);
    });

    it('unregisters a device and returns true', () => {
      sync.registerDevice({ id: 'dev-x', name: 'X', type: 'desktop', capabilities: [] });
      expect(sync.unregisterDevice('dev-x')).toBe(true);
      expect(sync.getDevices()).toHaveLength(0);
    });

    it('returns false for non-existent device unregistration', () => {
      expect(sync.unregisterDevice('ghost')).toBe(false);
    });
  });

  // ── Session Management ─────────────────────────────────────

  describe('createSession / getSession', () => {
    it('creates session with initial state and version 1', () => {
      sync.registerDevice({ id: 'dev-1', name: 'D', type: 'desktop', capabilities: [] });

      const session = sync.createSession('user-1', 'dev-1', { cursor: 0 });

      expect(session.id).toMatch(/^sync-/);
      expect(session.userId).toBe('user-1');
      expect(session.deviceId).toBe('dev-1');
      expect(session.state).toEqual({ cursor: 0 });
      expect(session.version).toBe(1);
    });

    it('throws when device is not registered', () => {
      expect(() => sync.createSession('u1', 'unknown-dev')).toThrow(/not registered/);
    });

    it('retrieves session by id', () => {
      sync.registerDevice({ id: 'd1', name: 'D', type: 'desktop', capabilities: [] });
      const session = sync.createSession('u1', 'd1');

      expect(sync.getSession(session.id)).toBeDefined();
      expect(sync.getSession(session.id)!.id).toBe(session.id);
    });

    it('returns undefined for non-existent session', () => {
      expect(sync.getSession('nope')).toBeUndefined();
    });

    it('lists sessions filtered by userId', () => {
      sync.registerDevice({ id: 'd1', name: 'D', type: 'desktop', capabilities: [] });
      sync.createSession('alice', 'd1');
      sync.createSession('bob', 'd1');
      sync.createSession('alice', 'd1');

      expect(sync.listSessions('alice')).toHaveLength(2);
      expect(sync.listSessions('bob')).toHaveLength(1);
    });
  });

  // ── State Updates ──────────────────────────────────────────

  describe('updateState', () => {
    it('applies delta updates and increments version', () => {
      sync.registerDevice({ id: 'd1', name: 'D', type: 'desktop', capabilities: [] });
      const session = sync.createSession('u1', 'd1', { x: 1, y: 2 });

      const updated = sync.updateState(session.id, { y: 3, z: 4 }, 'd1');

      expect(updated.state).toEqual({ x: 1, y: 3, z: 4 });
      expect(updated.version).toBe(2);
    });

    it('throws for non-existent session', () => {
      sync.registerDevice({ id: 'd1', name: 'D', type: 'desktop', capabilities: [] });
      expect(() => sync.updateState('bad-id', { a: 1 }, 'd1')).toThrow(/not found/);
    });

    it('throws for non-registered device', () => {
      sync.registerDevice({ id: 'd1', name: 'D', type: 'desktop', capabilities: [] });
      const session = sync.createSession('u1', 'd1');
      expect(() => sync.updateState(session.id, { a: 1 }, 'ghost-dev')).toThrow(/not registered/);
    });

    it('performs deep merge one level for nested objects', () => {
      sync.registerDevice({ id: 'd1', name: 'D', type: 'desktop', capabilities: [] });
      const session = sync.createSession('u1', 'd1', {
        settings: { theme: 'dark', font: 12 },
      });

      const updated = sync.updateState(
        session.id,
        { settings: { font: 14, lang: 'en' } },
        'd1',
      );

      expect(updated.state.settings).toEqual({ theme: 'dark', font: 14, lang: 'en' });
    });

    it('tracks sync metrics', () => {
      sync.registerDevice({ id: 'd1', name: 'D', type: 'desktop', capabilities: [] });
      const session = sync.createSession('u1', 'd1');

      sync.updateState(session.id, { a: 1 }, 'd1');
      sync.updateState(session.id, { b: 2 }, 'd1');

      const stats = sync.getStats();
      expect(stats.totalSyncs).toBe(2);
    });
  });

  // ── Sync Devices ───────────────────────────────────────────

  describe('syncDevices', () => {
    it('returns empty for non-existent session', () => {
      expect(sync.syncDevices('nope')).toHaveLength(0);
    });

    it('generates sync messages for all registered devices', () => {
      sync.registerDevice({ id: 'd1', name: 'A', type: 'desktop', capabilities: [] });
      sync.registerDevice({ id: 'd2', name: 'B', type: 'mobile', capabilities: [] });

      const session = sync.createSession('u1', 'd1', { data: 'hello' });
      const messages = sync.syncDevices(session.id);

      // d1 created it so version matches -> ack, d2 never synced -> full
      expect(messages).toHaveLength(2);
      const d1Msg = messages.find((m) => m.deviceId === 'd1');
      const d2Msg = messages.find((m) => m.deviceId === 'd2');
      expect(d1Msg!.type).toBe('ack');
      expect(d2Msg!.type).toBe('full');
    });

    it('sends delta to devices that are behind', () => {
      sync.registerDevice({ id: 'd1', name: 'A', type: 'desktop', capabilities: [] });
      sync.registerDevice({ id: 'd2', name: 'B', type: 'mobile', capabilities: [] });

      const session = sync.createSession('u1', 'd1', { v: 1 });
      // Sync so d2 knows about version 1
      sync.syncDevices(session.id);
      // Now update state from d1 -> version 2
      sync.updateState(session.id, { v: 2 }, 'd1');

      const messages = sync.syncDevices(session.id);
      const d2Msg = messages.find((m) => m.deviceId === 'd2');
      expect(d2Msg!.type).toBe('delta');
    });
  });

  // ── Conflict Detection & Resolution ────────────────────────

  describe('detectConflicts / resolveConflict', () => {
    it('detects conflict when behind device updates same key differently', () => {
      sync.registerDevice({ id: 'd1', name: 'A', type: 'desktop', capabilities: [] });
      sync.registerDevice({ id: 'd2', name: 'B', type: 'mobile', capabilities: [] });

      const session = sync.createSession('u1', 'd1', { color: 'red' });
      // d1 updates color -> version 2
      sync.updateState(session.id, { color: 'blue' }, 'd1');
      // d2 is still at version 0 (never synced), so its update conflicts
      const handler = vi.fn();
      sync.on('sync:conflict:detected', handler);

      sync.updateState(session.id, { color: 'green' }, 'd2');

      expect(handler).toHaveBeenCalled();
      const conflicts = sync.getConflicts(session.id);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].key).toBe('color');
    });

    it('auto-resolves with latest-wins strategy by default', () => {
      sync.registerDevice({ id: 'd1', name: 'A', type: 'desktop', capabilities: [] });
      sync.registerDevice({ id: 'd2', name: 'B', type: 'mobile', capabilities: [] });

      const session = sync.createSession('u1', 'd1', { val: 1 });
      sync.updateState(session.id, { val: 2 }, 'd1');
      sync.updateState(session.id, { val: 3 }, 'd2');

      const conflicts = sync.getConflicts(session.id);
      expect(conflicts[0].resolution).toBe('deviceB');
      expect(conflicts[0].resolvedValue).toBe(3);
    });

    it('manually resolves a conflict with deviceA', () => {
      sync.registerDevice({ id: 'd1', name: 'A', type: 'desktop', capabilities: [] });
      sync.registerDevice({ id: 'd2', name: 'B', type: 'mobile', capabilities: [] });

      const session = sync.createSession('u1', 'd1', { x: 10 });
      sync.updateState(session.id, { x: 20 }, 'd1');
      sync.updateState(session.id, { x: 30 }, 'd2');

      const conflicts = sync.getConflicts(session.id);
      const resolved = sync.resolveConflict(conflicts[0].id, 'deviceA');

      expect(resolved.resolution).toBe('deviceA');
      expect(resolved.resolvedValue).toBe(20);
      // Session state should be updated
      expect(sync.getSession(session.id)!.state.x).toBe(20);
    });

    it('throws for non-existent conflict resolution', () => {
      expect(() => sync.resolveConflict('ghost', 'deviceA')).toThrow(/not found/);
    });

    it('resolves with merged strategy for object values', () => {
      sync.registerDevice({ id: 'd1', name: 'A', type: 'desktop', capabilities: [] });
      sync.registerDevice({ id: 'd2', name: 'B', type: 'mobile', capabilities: [] });

      const session = sync.createSession('u1', 'd1', { data: { a: 1 } });
      sync.updateState(session.id, { data: { a: 2, b: 3 } }, 'd1');
      sync.updateState(session.id, { data: { a: 1, c: 4 } }, 'd2');

      const conflicts = sync.getConflicts(session.id);
      const resolved = sync.resolveConflict(conflicts[0].id, 'merged');
      expect(resolved.resolvedValue).toEqual({ a: 1, b: 3, c: 4 });
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zeroed stats initially', () => {
      const stats = sync.getStats();
      expect(stats.totalSessions).toBe(0);
      expect(stats.totalDevices).toBe(0);
      expect(stats.totalSyncs).toBe(0);
      expect(stats.totalConflicts).toBe(0);
      expect(stats.avgSyncLatency).toBe(0);
    });

    it('reflects registered devices and sessions', () => {
      sync.registerDevice({ id: 'd1', name: 'D', type: 'desktop', capabilities: [] });
      sync.createSession('u1', 'd1');

      const stats = sync.getStats();
      expect(stats.totalDevices).toBe(1);
      expect(stats.totalSessions).toBe(1);
    });

    it('tracks conflict count', () => {
      sync.registerDevice({ id: 'd1', name: 'A', type: 'desktop', capabilities: [] });
      sync.registerDevice({ id: 'd2', name: 'B', type: 'mobile', capabilities: [] });

      const session = sync.createSession('u1', 'd1', { k: 'a' });
      sync.updateState(session.id, { k: 'b' }, 'd1');
      sync.updateState(session.id, { k: 'c' }, 'd2');

      expect(sync.getStats().totalConflicts).toBeGreaterThan(0);
    });
  });
});
