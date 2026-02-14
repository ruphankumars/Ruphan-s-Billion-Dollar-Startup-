import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { SurfaceManager } from '../../../src/surfaces/surface-manager.js';
import type { Surface, SurfaceStats, SurfaceType } from '../../../src/surfaces/types.js';

/** Create a mock Surface for testing */
function createMockSurface(overrides: Partial<Surface> & { id: string; type: SurfaceType }): Surface {
  const emitter = new EventEmitter();
  const mock: Surface = Object.assign(emitter, {
    id: overrides.id,
    type: overrides.type,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(false),
    getStats: vi.fn().mockReturnValue({
      type: overrides.type,
      isRunning: false,
      eventsReceived: 0,
      eventsProcessed: 0,
      errors: 0,
      uptime: 0,
    } satisfies SurfaceStats),
  });
  return mock;
}

describe('SurfaceManager', () => {
  let manager: SurfaceManager;

  beforeEach(() => {
    manager = new SurfaceManager();
  });

  // ── registerSurface ──

  describe('registerSurface', () => {
    it('should register a surface', () => {
      const surface = createMockSurface({ id: 'gh_test', type: 'github' });
      manager.registerSurface(surface);

      expect(manager.getSurface('gh_test')).toBe(surface);
    });

    it('should throw on duplicate registration', () => {
      const surface = createMockSurface({ id: 'dup_id', type: 'slack' });
      manager.registerSurface(surface);

      expect(() => manager.registerSurface(surface)).toThrow('already registered');
    });

    it('should emit surface:registered event', () => {
      const listener = vi.fn();
      manager.on('surface:registered', listener);

      const surface = createMockSurface({ id: 'ev_surface', type: 'github' });
      manager.registerSurface(surface);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          surfaceId: 'ev_surface',
          type: 'github',
        }),
      );
    });
  });

  // ── getSurface ──

  describe('getSurface', () => {
    it('should retrieve by ID', () => {
      const surface = createMockSurface({ id: 'find_me', type: 'discord' });
      manager.registerSurface(surface);

      const found = manager.getSurface('find_me');
      expect(found).toBe(surface);
    });

    it('should return undefined for unknown ID', () => {
      expect(manager.getSurface('nonexistent')).toBeUndefined();
    });
  });

  // ── getSurfaceByType ──

  describe('getSurfaceByType', () => {
    it('should retrieve by type', () => {
      const gh = createMockSurface({ id: 'gh_1', type: 'github' });
      const slack = createMockSurface({ id: 'slack_1', type: 'slack' });
      manager.registerSurface(gh);
      manager.registerSurface(slack);

      expect(manager.getSurfaceByType('slack')).toBe(slack);
    });

    it('should return undefined for unregistered type', () => {
      expect(manager.getSurfaceByType('vscode')).toBeUndefined();
    });
  });

  // ── startAll ──

  describe('startAll', () => {
    it('should start all registered surfaces', async () => {
      const s1 = createMockSurface({ id: 's1', type: 'github' });
      const s2 = createMockSurface({ id: 's2', type: 'slack' });

      manager.registerSurface(s1);
      manager.registerSurface(s2);

      await manager.startAll();

      expect(s1.start).toHaveBeenCalled();
      expect(s2.start).toHaveBeenCalled();
      expect(manager.isRunning()).toBe(true);
    });

    it('should emit surface:started for each surface', async () => {
      const listener = vi.fn();
      manager.on('surface:started', listener);

      const s1 = createMockSurface({ id: 'start1', type: 'github' });
      manager.registerSurface(s1);

      await manager.startAll();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          surfaceId: 'start1',
          type: 'github',
        }),
      );
    });

    it('should emit manager:started event', async () => {
      const listener = vi.fn();
      manager.on('manager:started', listener);

      await manager.startAll();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          managerId: manager.id,
        }),
      );
    });

    it('should emit surface:error if a surface fails to start', async () => {
      const listener = vi.fn();
      manager.on('surface:error', listener);

      const failing = createMockSurface({ id: 'fail_start', type: 'discord' });
      (failing.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('start failed'));

      manager.registerSurface(failing);
      await manager.startAll();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          surfaceId: 'fail_start',
          error: 'start failed',
        }),
      );
    });

    it('should continue starting other surfaces if one fails', async () => {
      const failing = createMockSurface({ id: 'fail', type: 'github' });
      (failing.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      const ok = createMockSurface({ id: 'ok', type: 'slack' });

      manager.registerSurface(failing);
      manager.registerSurface(ok);

      await manager.startAll();

      expect(ok.start).toHaveBeenCalled();
    });
  });

  // ── stopAll ──

  describe('stopAll', () => {
    it('should stop all running surfaces', async () => {
      const s1 = createMockSurface({ id: 'stop1', type: 'github' });
      const s2 = createMockSurface({ id: 'stop2', type: 'slack' });
      (s1.isRunning as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (s2.isRunning as ReturnType<typeof vi.fn>).mockReturnValue(true);

      manager.registerSurface(s1);
      manager.registerSurface(s2);

      await manager.startAll();
      await manager.stopAll();

      expect(s1.stop).toHaveBeenCalled();
      expect(s2.stop).toHaveBeenCalled();
      expect(manager.isRunning()).toBe(false);
    });

    it('should emit manager:stopped event', async () => {
      const listener = vi.fn();
      manager.on('manager:stopped', listener);

      await manager.startAll();
      await manager.stopAll();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          managerId: manager.id,
        }),
      );
    });

    it('should not call stop on surfaces that are not running', async () => {
      const s1 = createMockSurface({ id: 'not_running', type: 'github' });
      (s1.isRunning as ReturnType<typeof vi.fn>).mockReturnValue(false);

      manager.registerSurface(s1);
      await manager.stopAll();

      expect(s1.stop).not.toHaveBeenCalled();
    });
  });

  // ── listSurfaces ──

  describe('listSurfaces', () => {
    it('should list all registered surfaces', () => {
      const s1 = createMockSurface({ id: 'list1', type: 'github' });
      const s2 = createMockSurface({ id: 'list2', type: 'slack' });
      (s1.isRunning as ReturnType<typeof vi.fn>).mockReturnValue(true);

      manager.registerSurface(s1);
      manager.registerSurface(s2);

      const list = manager.listSurfaces();
      expect(list).toHaveLength(2);
      expect(list).toContainEqual({ id: 'list1', type: 'github', running: true });
      expect(list).toContainEqual({ id: 'list2', type: 'slack', running: false });
    });
  });

  // ── getStats ──

  describe('getStats', () => {
    it('should return aggregate stats across surfaces', () => {
      const s1 = createMockSurface({ id: 'stat1', type: 'github' });
      const s2 = createMockSurface({ id: 'stat2', type: 'slack' });

      (s1.getStats as ReturnType<typeof vi.fn>).mockReturnValue({
        type: 'github',
        isRunning: true,
        eventsReceived: 10,
        eventsProcessed: 8,
        errors: 2,
        uptime: 1000,
      } satisfies SurfaceStats);

      (s2.getStats as ReturnType<typeof vi.fn>).mockReturnValue({
        type: 'slack',
        isRunning: false,
        eventsReceived: 5,
        eventsProcessed: 5,
        errors: 0,
        uptime: 0,
      } satisfies SurfaceStats);

      manager.registerSurface(s1);
      manager.registerSurface(s2);

      const stats = manager.getStats();
      expect(stats.totalSurfaces).toBe(2);
      expect(stats.runningSurfaces).toBe(1);
      expect(stats.stoppedSurfaces).toBe(1);
      expect(stats.totalEventsReceived).toBe(15);
      expect(stats.totalEventsProcessed).toBe(13);
      expect(stats.totalErrors).toBe(2);
      expect(stats.surfaceStats).toHaveLength(2);
    });

    it('should return zero stats when no surfaces registered', () => {
      const stats = manager.getStats();
      expect(stats.totalSurfaces).toBe(0);
      expect(stats.runningSurfaces).toBe(0);
      expect(stats.totalEventsReceived).toBe(0);
    });
  });

  // ── Event Forwarding ──

  describe('event forwarding', () => {
    it('should forward events from registered surfaces to the manager', () => {
      const listener = vi.fn();
      const surface = createMockSurface({ id: 'fw_surface', type: 'github' });
      manager.registerSurface(surface);

      manager.on('surface:github:webhook', listener);

      surface.emit('surface:github:webhook', { event: 'push' });

      expect(listener).toHaveBeenCalledWith({ event: 'push' });
    });

    it('should forward events from multiple surfaces', () => {
      const listener = vi.fn();
      manager.on('surface:slack:message', listener);

      const s1 = createMockSurface({ id: 'fw1', type: 'slack' });
      const s2 = createMockSurface({ id: 'fw2', type: 'slack' });

      manager.registerSurface(s1);
      manager.registerSurface(s2);

      s1.emit('surface:slack:message', { from: 's1' });
      s2.emit('surface:slack:message', { from: 's2' });

      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  // ── unregisterSurface ──

  describe('unregisterSurface', () => {
    it('should remove a surface and return true', async () => {
      const surface = createMockSurface({ id: 'unreg', type: 'github' });
      manager.registerSurface(surface);

      const removed = await manager.unregisterSurface('unreg');
      expect(removed).toBe(true);
      expect(manager.getSurface('unreg')).toBeUndefined();
    });

    it('should return false for unknown ID', async () => {
      const removed = await manager.unregisterSurface('nobody');
      expect(removed).toBe(false);
    });

    it('should stop a running surface before unregistering', async () => {
      const surface = createMockSurface({ id: 'stop_before', type: 'slack' });
      (surface.isRunning as ReturnType<typeof vi.fn>).mockReturnValue(true);
      manager.registerSurface(surface);

      await manager.unregisterSurface('stop_before');

      expect(surface.stop).toHaveBeenCalled();
    });

    it('should emit surface:unregistered event', async () => {
      const listener = vi.fn();
      manager.on('surface:unregistered', listener);

      const surface = createMockSurface({ id: 'unreg_ev', type: 'discord' });
      manager.registerSurface(surface);

      await manager.unregisterSurface('unreg_ev');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          surfaceId: 'unreg_ev',
          type: 'discord',
        }),
      );
    });
  });

  // ── broadcast ──

  describe('broadcast', () => {
    it('should broadcast event to all surfaces', () => {
      const s1 = createMockSurface({ id: 'bc1', type: 'github' });
      const s2 = createMockSurface({ id: 'bc2', type: 'slack' });
      const s1Listener = vi.fn();
      const s2Listener = vi.fn();
      s1.on('test:broadcast', s1Listener);
      s2.on('test:broadcast', s2Listener);

      manager.registerSurface(s1);
      manager.registerSurface(s2);

      manager.broadcast('test:broadcast', { data: 'hello' });

      expect(s1Listener).toHaveBeenCalledWith({ data: 'hello' });
      expect(s2Listener).toHaveBeenCalledWith({ data: 'hello' });
    });

    it('should emit manager:broadcast event', () => {
      const listener = vi.fn();
      manager.on('manager:broadcast', listener);

      manager.broadcast('test:event');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'test:event',
          surfaceCount: 0,
        }),
      );
    });
  });
});
