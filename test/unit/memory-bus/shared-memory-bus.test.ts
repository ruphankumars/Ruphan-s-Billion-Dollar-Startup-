import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SharedMemoryBus } from '../../../src/memory-bus/shared-memory-bus.js';

describe('SharedMemoryBus', () => {
  let bus: SharedMemoryBus;

  beforeEach(() => {
    bus = new SharedMemoryBus({ cleanupIntervalMs: 0 });
  });

  afterEach(() => {
    bus.stop();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('should create an instance with default config', () => {
      const defaultBus = new SharedMemoryBus();
      expect(defaultBus).toBeInstanceOf(SharedMemoryBus);
      expect(defaultBus.isRunning()).toBe(false);
    });

    it('should accept custom config overrides', () => {
      const customBus = new SharedMemoryBus({ maxEntries: 50, defaultTtl: 5000 });
      expect(customBus).toBeInstanceOf(SharedMemoryBus);
      // Confirm custom limit is enforced by filling past 50
      customBus.start();
      for (let i = 0; i < 55; i++) {
        customBus.set(`key-${i}`, i, 'agent-1');
      }
      // Should have evicted down to maxEntries
      expect(customBus.keys().length).toBeLessThanOrEqual(50);
      customBus.stop();
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should start and report running', () => {
      expect(bus.isRunning()).toBe(false);
      bus.start();
      expect(bus.isRunning()).toBe(true);
    });

    it('should stop and report not running', () => {
      bus.start();
      bus.stop();
      expect(bus.isRunning()).toBe(false);
    });

    it('should emit lifecycle events on start and stop', () => {
      const startSpy = vi.fn();
      const stopSpy = vi.fn();
      bus.on('membus:lifecycle:started', startSpy);
      bus.on('membus:lifecycle:stopped', stopSpy);

      bus.start();
      expect(startSpy).toHaveBeenCalledTimes(1);

      bus.stop();
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── State Operations ───────────────────────────────────────

  describe('set / get / has / delete / keys', () => {
    beforeEach(() => {
      bus.start();
    });

    it('should set and get a value', () => {
      const entry = bus.set('foo', 42, 'agent-1');
      expect(entry.key).toBe('foo');
      expect(entry.value).toBe(42);
      expect(entry.version).toBe(1);
      expect(entry.writtenBy).toBe('agent-1');

      const value = bus.get('foo', 'agent-2');
      expect(value).toBe(42);
    });

    it('should return undefined for a non-existent key', () => {
      const value = bus.get('missing', 'agent-1');
      expect(value).toBeUndefined();
    });

    it('should report has correctly', () => {
      expect(bus.has('foo')).toBe(false);
      bus.set('foo', 1, 'agent-1');
      expect(bus.has('foo')).toBe(true);
    });

    it('should delete an existing entry and return true', () => {
      bus.set('foo', 1, 'agent-1');
      const deleted = bus.delete('foo', 'agent-1');
      expect(deleted).toBe(true);
      expect(bus.has('foo')).toBe(false);
    });

    it('should return false when deleting a non-existent key', () => {
      const deleted = bus.delete('nope', 'agent-1');
      expect(deleted).toBe(false);
    });

    it('should return all keys', () => {
      bus.set('a', 1, 'agent-1');
      bus.set('b', 2, 'agent-1');
      bus.set('c', 3, 'agent-1');
      const keys = bus.keys();
      expect(keys).toContain('a');
      expect(keys).toContain('b');
      expect(keys).toContain('c');
      expect(keys.length).toBe(3);
    });

    it('should get the full MemoryEntry with getEntry', () => {
      bus.set('x', { nested: true }, 'agent-1', { tags: ['tag1'] });
      const entry = bus.getEntry('x');
      expect(entry).toBeDefined();
      expect(entry!.key).toBe('x');
      expect(entry!.tags).toEqual(['tag1']);
      expect(entry!.createdAt).toBeGreaterThan(0);
    });

    it('should set with custom TTL and tags', () => {
      bus.set('temp', 'data', 'agent-1', { ttl: 5000, tags: ['ephemeral'] });
      const entry = bus.getEntry('temp');
      expect(entry!.ttl).toBe(5000);
      expect(entry!.tags).toEqual(['ephemeral']);
    });
  });

  // ── Version Conflict Resolution ────────────────────────────

  describe('conflict resolution', () => {
    it('should use last-write-wins by default', () => {
      bus.start();
      bus.set('key', 'first', 'agent-1');
      bus.set('key', 'second', 'agent-2');

      const value = bus.get('key', 'agent-3');
      expect(value).toBe('second');

      const entry = bus.getEntry('key');
      expect(entry!.version).toBe(2);
      expect(entry!.writtenBy).toBe('agent-2');
    });

    it('should merge objects when strategy is merge', () => {
      const mergeBus = new SharedMemoryBus({
        conflictStrategy: 'merge',
        cleanupIntervalMs: 0,
      });
      mergeBus.start();

      mergeBus.set('obj', { a: 1, b: 2 }, 'agent-1');
      mergeBus.set('obj', { b: 3, c: 4 }, 'agent-2');

      const value = mergeBus.get('obj', 'reader') as Record<string, number>;
      expect(value.a).toBe(1);
      expect(value.b).toBe(3); // overwritten by incoming
      expect(value.c).toBe(4);
      mergeBus.stop();
    });

    it('should increment totalConflicts on overwrite', () => {
      bus.start();
      bus.set('key', 'v1', 'agent-1');
      bus.set('key', 'v2', 'agent-2');

      const stats = bus.getStats();
      expect(stats.totalConflicts).toBe(1);
    });
  });

  // ── Channels (Pub/Sub) ────────────────────────────────────

  describe('channels', () => {
    beforeEach(() => {
      bus.start();
    });

    it('should create a channel', () => {
      const channel = bus.createChannel('events', 'General events');
      expect(channel.name).toBe('events');
      expect(channel.description).toBe('General events');
      expect(channel.subscribers).toEqual([]);
      expect(channel.messageCount).toBe(0);
    });

    it('should throw when creating a duplicate channel', () => {
      bus.createChannel('events', 'General events');
      expect(() => bus.createChannel('events', 'Duplicate')).toThrow('Channel already exists');
    });

    it('should subscribe and publish a message to the channel', () => {
      bus.createChannel('updates', 'State updates');
      const received: unknown[] = [];
      bus.subscribe('updates', 'agent-1', (msg) => received.push(msg.payload));

      const msg = bus.publish('updates', 'agent-2', 'state-change', { key: 'foo' });
      expect(msg.channel).toBe('updates');
      expect(msg.publishedBy).toBe('agent-2');
      expect(msg.type).toBe('state-change');
      expect(received.length).toBe(1);
      expect(received[0]).toEqual({ key: 'foo' });
    });

    it('should throw when subscribing to a non-existent channel', () => {
      expect(() => bus.subscribe('ghost', 'agent-1', () => {})).toThrow('Channel not found');
    });

    it('should throw when publishing to a non-existent channel', () => {
      expect(() => bus.publish('ghost', 'agent-1', 'type', {})).toThrow('Channel not found');
    });

    it('should delete a channel and return true', () => {
      bus.createChannel('temp', 'Temporary');
      const deleted = bus.deleteChannel('temp');
      expect(deleted).toBe(true);
    });

    it('should return false when deleting a non-existent channel', () => {
      expect(bus.deleteChannel('nope')).toBe(false);
    });

    it('should not crash if a subscriber callback throws', () => {
      bus.createChannel('risky', 'Risky');
      bus.subscribe('risky', 'agent-1', () => {
        throw new Error('Subscriber error');
      });
      // Should not throw
      expect(() => bus.publish('risky', 'agent-2', 'ping', {})).not.toThrow();
    });
  });

  // ── State Projections ──────────────────────────────────────

  describe('projections', () => {
    beforeEach(() => {
      bus.start();
    });

    it('should create a projection with a snapshot of current state', () => {
      bus.set('x', 10, 'agent-1');
      bus.set('y', 20, 'agent-1');

      const projection = bus.createProjection('xy-view', ['x', 'y']);
      expect(projection.name).toBe('xy-view');
      expect(projection.snapshot).toEqual({ x: 10, y: 20 });
      expect(projection.keys).toEqual(['x', 'y']);
    });

    it('should refresh a projection after state changes', () => {
      bus.set('a', 1, 'agent-1');
      const projection = bus.createProjection('a-view', ['a']);
      expect(projection.snapshot.a).toBe(1);

      bus.set('a', 99, 'agent-2');
      const refreshed = bus.refreshProjection('a-view');
      expect(refreshed.snapshot.a).toBe(99);
    });

    it('should throw when refreshing a non-existent projection', () => {
      expect(() => bus.refreshProjection('ghost')).toThrow('Projection not found');
    });

    it('should return a projection by name', () => {
      bus.createProjection('test', ['key1']);
      const p = bus.getProjection('test');
      expect(p).toBeDefined();
      expect(p!.name).toBe('test');
    });

    it('should return undefined for a non-existent projection', () => {
      expect(bus.getProjection('nope')).toBeUndefined();
    });
  });

  // ── Change History ─────────────────────────────────────────

  describe('change history', () => {
    beforeEach(() => {
      bus.start();
    });

    it('should record changes for set operations', () => {
      bus.set('a', 1, 'agent-1');
      bus.set('b', 2, 'agent-1');
      const history = bus.getChangeHistory();
      expect(history.length).toBe(2);
      // Newest first
      expect(history[0].key).toBe('b');
      expect(history[1].key).toBe('a');
    });

    it('should record changes for delete operations', () => {
      bus.set('a', 1, 'agent-1');
      bus.delete('a', 'agent-1');
      const history = bus.getChangeHistory();
      expect(history[0].type).toBe('delete');
    });

    it('should limit history to specified count', () => {
      bus.set('a', 1, 'agent-1');
      bus.set('b', 2, 'agent-1');
      bus.set('c', 3, 'agent-1');
      const limited = bus.getChangeHistory(2);
      expect(limited.length).toBe(2);
    });
  });

  // ── Query ──────────────────────────────────────────────────

  describe('query', () => {
    beforeEach(() => {
      bus.start();
      bus.set('user:1', { name: 'Alice' }, 'agent-1', { tags: ['user', 'active'] });
      bus.set('user:2', { name: 'Bob' }, 'agent-2', { tags: ['user'] });
      bus.set('config:theme', 'dark', 'agent-1', { tags: ['config'] });
    });

    it('should query by prefix', () => {
      const results = bus.query({ prefix: 'user:' });
      expect(results.length).toBe(2);
    });

    it('should query by tags', () => {
      const results = bus.query({ tags: ['user', 'active'] });
      expect(results.length).toBe(1);
      expect((results[0].value as { name: string }).name).toBe('Alice');
    });

    it('should query by agentId', () => {
      const results = bus.query({ agentId: 'agent-2' });
      expect(results.length).toBe(1);
      expect(results[0].key).toBe('user:2');
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      const stats = bus.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.totalChannels).toBe(0);
      expect(stats.totalSubscribers).toBe(0);
      expect(stats.totalWrites).toBe(0);
      expect(stats.totalReads).toBe(0);
      expect(stats.totalConflicts).toBe(0);
      expect(stats.totalMessages).toBe(0);
      expect(stats.totalExpired).toBe(0);
      expect(stats.avgWriteLatency).toBe(0);
    });

    it('should track writes and reads', () => {
      bus.start();
      bus.set('a', 1, 'agent-1');
      bus.set('b', 2, 'agent-1');
      bus.get('a', 'agent-2');
      bus.get('b', 'agent-2');
      bus.get('c', 'agent-2'); // non-existent, still counts as a read

      const stats = bus.getStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.totalWrites).toBe(2);
      expect(stats.totalReads).toBe(3);
      expect(stats.avgWriteLatency).toBeGreaterThanOrEqual(0);
    });

    it('should track channel subscribers and messages', () => {
      bus.start();
      bus.createChannel('ch1', 'Test channel');
      bus.subscribe('ch1', 'agent-1', () => {});
      bus.subscribe('ch1', 'agent-2', () => {});
      bus.publish('ch1', 'agent-3', 'ping', {});

      const stats = bus.getStats();
      expect(stats.totalChannels).toBe(1);
      expect(stats.totalSubscribers).toBe(2);
      expect(stats.totalMessages).toBe(1);
    });
  });
});
