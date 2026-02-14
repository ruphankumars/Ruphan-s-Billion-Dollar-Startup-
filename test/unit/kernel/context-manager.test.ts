/**
 * ContextManager — MMU Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextManager } from '../../../src/kernel/context-manager.js';

describe('ContextManager', () => {
  let ctx: ContextManager;

  beforeEach(() => {
    ctx = new ContextManager({ stmCapacity: 10, ltmCapacity: 20 });
  });

  describe('lifecycle', () => {
    it('should start and stop', () => {
      expect(ctx.isRunning()).toBe(false);
      ctx.start();
      expect(ctx.isRunning()).toBe(true);
      ctx.stop();
      expect(ctx.isRunning()).toBe(false);
    });

    it('should emit lifecycle events', () => {
      const started = vi.fn();
      const stopped = vi.fn();
      ctx.on('kernel:context:started', started);
      ctx.on('kernel:context:stopped', stopped);

      ctx.start();
      ctx.stop();

      expect(started).toHaveBeenCalledTimes(1);
      expect(stopped).toHaveBeenCalledTimes(1);
    });
  });

  describe('store', () => {
    it('should store a memory entry in STM by default', () => {
      const entry = ctx.store('test-key', 'test-value');
      expect(entry.key).toBe('test-key');
      expect(entry.value).toBe('test-value');
      expect(entry.scope).toBe('stm');
      expect(entry.id).toMatch(/^mem_/);
    });

    it('should store in LTM when specified', () => {
      const entry = ctx.store('test-key', 'test-value', { scope: 'ltm' });
      expect(entry.scope).toBe('ltm');
    });

    it('should store with tags and importance', () => {
      const entry = ctx.store('test-key', 'test-value', {
        tags: ['tag1', 'tag2'],
        importance: 0.9,
      });
      expect(entry.tags).toEqual(['tag1', 'tag2']);
      expect(entry.importance).toBe(0.9);
      expect(entry.qValue).toBe(0.9);
    });

    it('should update existing entry with same key', () => {
      ctx.store('key1', 'value1');
      const updated = ctx.store('key1', 'value2');
      expect(updated.value).toBe('value2');
      expect(updated.accessCount).toBe(1);
    });

    it('should evict lowest Q-value when at capacity', () => {
      const mgr = new ContextManager({ stmCapacity: 3, ltmCapacity: 10 });

      mgr.store('a', 'val-a', { importance: 0.1 });
      mgr.store('b', 'val-b', { importance: 0.5 });
      mgr.store('c', 'val-c', { importance: 0.9 });
      // This should evict 'a' (lowest Q-value)
      mgr.store('d', 'val-d', { importance: 0.7 });

      expect(mgr.getByKey('a', 'stm')).toBeUndefined();
      expect(mgr.getByKey('d', 'stm')).toBeDefined();
    });

    it('should emit stored event', () => {
      const listener = vi.fn();
      ctx.on('kernel:context:stored', listener);

      ctx.store('key1', 'value1');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'key1', scope: 'stm' })
      );
    });

    it('should track total stored count', () => {
      ctx.store('a', 1);
      ctx.store('b', 2);
      ctx.store('c', 3);

      expect(ctx.getStats().totalStored).toBe(3);
    });
  });

  describe('retrieve', () => {
    beforeEach(() => {
      ctx.store('typescript basics', 'TS is a typed superset of JS', { tags: ['programming', 'typescript'] });
      ctx.store('python basics', 'Python is a dynamic language', { tags: ['programming', 'python'] });
      ctx.store('cooking recipe', 'How to make pasta', { tags: ['food', 'cooking'] });
    });

    it('should retrieve matching entries by query', () => {
      const results = ctx.retrieve('typescript programming');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].key).toContain('typescript');
    });

    it('should return results sorted by composite score', () => {
      const results = ctx.retrieve('programming');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by scope', () => {
      ctx.store('ltm-item', 'LTM value', { scope: 'ltm', tags: ['programming'] });

      const stmOnly = ctx.retrieve('programming', { scope: 'stm' });
      const ltmOnly = ctx.retrieve('programming', { scope: 'ltm' });
      const all = ctx.retrieve('programming', { scope: 'all' });

      expect(stmOnly.length).toBeLessThanOrEqual(all.length);
      expect(ltmOnly.every(e => e.scope === 'ltm')).toBe(true);
    });

    it('should filter by tags', () => {
      const results = ctx.retrieve('', { tags: ['cooking'] });
      expect(results.length).toBe(1);
      expect(results[0].key).toBe('cooking recipe');
    });

    it('should respect topK parameter', () => {
      const results = ctx.retrieve('programming', { topK: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should update access count on retrieval', () => {
      const results = ctx.retrieve('typescript');
      expect(results[0].accessCount).toBe(1);

      ctx.retrieve('typescript');
      const entry = ctx.getByKey('typescript basics');
      expect(entry?.accessCount).toBe(2);
    });

    it('should track total retrieved count', () => {
      ctx.retrieve('programming');
      expect(ctx.getStats().totalRetrieved).toBeGreaterThan(0);
    });
  });

  describe('update', () => {
    it('should update an existing entry', () => {
      const entry = ctx.store('key1', 'initial');
      const updated = ctx.update(entry.id, 'updated');
      expect(updated).toBe(true);

      const retrieved = ctx.getById(entry.id);
      expect(retrieved?.value).toBe('updated');
    });

    it('should return false for non-existent entry', () => {
      expect(ctx.update('non_existent', 'value')).toBe(false);
    });
  });

  describe('discard', () => {
    it('should remove an entry from STM', () => {
      const entry = ctx.store('key1', 'value1');
      expect(ctx.discard(entry.id)).toBe(true);
      expect(ctx.getById(entry.id)).toBeUndefined();
    });

    it('should remove an entry from LTM', () => {
      const entry = ctx.store('key1', 'value1', { scope: 'ltm' });
      expect(ctx.discard(entry.id)).toBe(true);
      expect(ctx.getById(entry.id)).toBeUndefined();
    });

    it('should return false for non-existent entry', () => {
      expect(ctx.discard('non_existent')).toBe(false);
    });
  });

  describe('compress (slime mold GC)', () => {
    it('should compress low-Q-value entries into a knowledge block', () => {
      for (let i = 0; i < 8; i++) {
        ctx.store(`entry-${i}`, `value-${i}`, { importance: i * 0.1 });
      }

      const block = ctx.compress();
      expect(block).not.toBeNull();
      expect(block!.id).toMatch(/^kb_/);
      expect(block!.sourceIds.length).toBeGreaterThan(0);
      expect(block!.summary).toBeTruthy();
    });

    it('should remove compressed entries from STM', () => {
      for (let i = 0; i < 8; i++) {
        ctx.store(`entry-${i}`, `value-${i}`, { importance: i * 0.1 });
      }

      const sizeBefore = ctx.getStats().stmSize;
      ctx.compress();
      const sizeAfter = ctx.getStats().stmSize;
      expect(sizeAfter).toBeLessThan(sizeBefore);
    });

    it('should return null if not enough entries to compress', () => {
      ctx.store('only-one', 'value');
      const block = ctx.compress();
      expect(block).toBeNull();
    });

    it('should emit compressed event', () => {
      const listener = vi.fn();
      ctx.on('kernel:context:compressed', listener);

      // Need at least 7 entries so bottom 30% >= 2 (floor(7 * 0.3) = 2)
      for (let i = 0; i < 8; i++) {
        ctx.store(`entry-${i}`, `value-${i}`, { importance: i * 0.1 });
      }
      ctx.compress();

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should track total compressed count', () => {
      for (let i = 0; i < 8; i++) {
        ctx.store(`entry-${i}`, `value-${i}`, { importance: 0.1 });
      }
      ctx.compress();

      expect(ctx.getStats().totalCompressed).toBeGreaterThan(0);
    });
  });

  describe('Q-value management (MemRL)', () => {
    it('should update Q-value with reward', () => {
      const entry = ctx.store('key1', 'value1', { importance: 0.5 });
      const initialQ = entry.qValue;

      ctx.updateQValue(entry.id, 1.0); // Positive reward
      const updated = ctx.getById(entry.id);
      expect(updated!.qValue).toBeGreaterThan(initialQ);
    });

    it('should clamp Q-value between 0 and 1', () => {
      const entry = ctx.store('key1', 'value1', { importance: 0.9 });

      // Apply very high reward repeatedly
      for (let i = 0; i < 20; i++) {
        ctx.updateQValue(entry.id, 10.0);
      }
      expect(ctx.getById(entry.id)!.qValue).toBeLessThanOrEqual(1.0);

      // Apply very negative reward repeatedly
      const entry2 = ctx.store('key2', 'value2', { importance: 0.1 });
      for (let i = 0; i < 20; i++) {
        ctx.updateQValue(entry2.id, -10.0);
      }
      expect(ctx.getById(entry2.id)!.qValue).toBeGreaterThanOrEqual(0);
    });

    it('should batch update Q-values', () => {
      const e1 = ctx.store('a', 1, { importance: 0.5 });
      const e2 = ctx.store('b', 2, { importance: 0.5 });

      ctx.batchUpdateQValues([e1.id, e2.id], 0.8);

      expect(ctx.getById(e1.id)!.qValue).not.toBe(0.5);
      expect(ctx.getById(e2.id)!.qValue).not.toBe(0.5);
    });

    it('should auto-promote to LTM when Q-value exceeds threshold', () => {
      const mgr = new ContextManager({
        stmCapacity: 10, ltmCapacity: 20, promotionQThreshold: 0.7, qLearningRate: 0.5
      });

      const entry = mgr.store('key1', 'value1', { importance: 0.65 });
      expect(entry.scope).toBe('stm');

      // Apply high reward to push Q above threshold
      for (let i = 0; i < 5; i++) {
        mgr.updateQValue(entry.id, 1.0);
      }

      // Entry should have been promoted to LTM
      const promoted = mgr.getById(entry.id);
      expect(promoted?.scope).toBe('ltm');
    });
  });

  describe('promote / demote', () => {
    it('should promote STM entry to LTM', () => {
      const entry = ctx.store('key1', 'value1');
      expect(entry.scope).toBe('stm');

      const result = ctx.promote(entry.id);
      expect(result).toBe(true);

      const promoted = ctx.getById(entry.id);
      expect(promoted?.scope).toBe('ltm');
    });

    it('should demote LTM entry to STM', () => {
      const entry = ctx.store('key1', 'value1', { scope: 'ltm' });
      expect(entry.scope).toBe('ltm');

      const result = ctx.demote(entry.id);
      expect(result).toBe(true);

      const demoted = ctx.getById(entry.id);
      expect(demoted?.scope).toBe('stm');
    });

    it('should return false when promoting non-STM entry', () => {
      const entry = ctx.store('key1', 'value1', { scope: 'ltm' });
      expect(ctx.promote(entry.id)).toBe(false);
    });

    it('should return false when demoting non-LTM entry', () => {
      const entry = ctx.store('key1', 'value1');
      expect(ctx.demote(entry.id)).toBe(false);
    });
  });

  describe('searchIndex (SimpleMem)', () => {
    it('should find entries by keyword', () => {
      ctx.store('typescript basics', 'TypeScript programming language', { tags: ['ts'] });
      ctx.store('python basics', 'Python programming language', { tags: ['py'] });

      const results = ctx.searchIndex('typescript');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty when semantic index is disabled', () => {
      const mgr = new ContextManager({ enableSemanticIndex: false, stmCapacity: 10, ltmCapacity: 20 });
      mgr.store('key1', 'value1');

      const results = mgr.searchIndex('key1');
      expect(results).toHaveLength(0);
    });

    it('should respect topK parameter', () => {
      for (let i = 0; i < 10; i++) {
        ctx.store(`item-${i}`, `description item ${i}`, { tags: ['item'] });
      }

      const results = ctx.searchIndex('item', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getByKey / getById', () => {
    it('should get entry by key', () => {
      ctx.store('my-key', 'my-value');
      const entry = ctx.getByKey('my-key');
      expect(entry?.value).toBe('my-value');
    });

    it('should get entry by key and scope', () => {
      ctx.store('key1', 'stm-value');
      ctx.store('key1', 'ltm-value', { scope: 'ltm' });

      expect(ctx.getByKey('key1', 'stm')?.value).toBe('stm-value');
      expect(ctx.getByKey('key1', 'ltm')?.value).toBe('ltm-value');
    });

    it('should get entry by ID', () => {
      const entry = ctx.store('key1', 'value1');
      expect(ctx.getById(entry.id)?.value).toBe('value1');
    });

    it('should return undefined for non-existent key', () => {
      expect(ctx.getByKey('nonexistent')).toBeUndefined();
    });
  });

  describe('exportLTM / importLTM', () => {
    it('should export LTM entries', () => {
      ctx.store('a', 1, { scope: 'ltm' });
      ctx.store('b', 2, { scope: 'ltm' });

      const exported = ctx.exportLTM();
      expect(exported).toHaveLength(2);
    });

    it('should import LTM entries', () => {
      ctx.store('a', 1, { scope: 'ltm' });
      const exported = ctx.exportLTM();

      const mgr2 = new ContextManager({ stmCapacity: 10, ltmCapacity: 20 });
      const imported = mgr2.importLTM(exported);
      expect(imported).toBe(1);
      expect(mgr2.getStats().ltmSize).toBe(1);
    });

    it('should not import duplicates', () => {
      ctx.store('a', 1, { scope: 'ltm' });
      const exported = ctx.exportLTM();

      const imported = ctx.importLTM(exported);
      expect(imported).toBe(0); // Already exists
    });
  });

  describe('clear', () => {
    it('should clear STM only', () => {
      ctx.store('stm-key', 'stm-val');
      ctx.store('ltm-key', 'ltm-val', { scope: 'ltm' });

      ctx.clear('stm');
      expect(ctx.getStats().stmSize).toBe(0);
      expect(ctx.getStats().ltmSize).toBe(1);
    });

    it('should clear LTM only', () => {
      ctx.store('stm-key', 'stm-val');
      ctx.store('ltm-key', 'ltm-val', { scope: 'ltm' });

      ctx.clear('ltm');
      expect(ctx.getStats().stmSize).toBe(1);
      expect(ctx.getStats().ltmSize).toBe(0);
    });

    it('should clear everything', () => {
      ctx.store('stm-key', 'stm-val');
      ctx.store('ltm-key', 'ltm-val', { scope: 'ltm' });

      ctx.clear('all');
      expect(ctx.getStats().stmSize).toBe(0);
      expect(ctx.getStats().ltmSize).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return comprehensive stats', () => {
      ctx.start();
      ctx.store('a', 1);
      ctx.store('b', 2, { scope: 'ltm' });

      const stats = ctx.getStats();
      expect(stats.running).toBe(true);
      expect(stats.stmSize).toBe(1);
      expect(stats.ltmSize).toBe(1);
      expect(stats.stmCapacity).toBe(10);
      expect(stats.ltmCapacity).toBe(20);
      expect(stats.totalStored).toBe(2);
      expect(stats.avgQValue).toBeGreaterThanOrEqual(0);
    });
  });
});
