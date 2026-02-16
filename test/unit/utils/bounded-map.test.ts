import { describe, it, expect, vi } from 'vitest';
import { BoundedMap } from '../../../src/utils/bounded-map.js';

describe('BoundedMap', () => {
  describe('constructor', () => {
    it('throws if maxSize < 1', () => {
      expect(() => new BoundedMap(0)).toThrow('maxSize must be >= 1');
    });

    it('creates empty map', () => {
      const m = new BoundedMap<string, number>(10);
      expect(m.size).toBe(0);
    });
  });

  describe('get/set', () => {
    it('stores and retrieves values', () => {
      const m = new BoundedMap<string, number>(10);
      m.set('a', 1);
      m.set('b', 2);
      expect(m.get('a')).toBe(1);
      expect(m.get('b')).toBe(2);
    });

    it('returns undefined for missing keys', () => {
      const m = new BoundedMap<string, number>(10);
      expect(m.get('missing')).toBeUndefined();
    });

    it('overwrites existing keys', () => {
      const m = new BoundedMap<string, number>(10);
      m.set('a', 1);
      m.set('a', 99);
      expect(m.get('a')).toBe(99);
      expect(m.size).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('evicts least recently used when at capacity', () => {
      const m = new BoundedMap<string, number>(3);
      m.set('a', 1);
      m.set('b', 2);
      m.set('c', 3);
      m.set('d', 4); // should evict 'a'
      expect(m.has('a')).toBe(false);
      expect(m.has('b')).toBe(true);
      expect(m.has('c')).toBe(true);
      expect(m.has('d')).toBe(true);
      expect(m.size).toBe(3);
    });

    it('get() promotes to MRU', () => {
      const m = new BoundedMap<string, number>(3);
      m.set('a', 1);
      m.set('b', 2);
      m.set('c', 3);
      m.get('a'); // promote 'a' to MRU
      m.set('d', 4); // should evict 'b' (now LRU)
      expect(m.has('a')).toBe(true);
      expect(m.has('b')).toBe(false);
    });

    it('set() on existing promotes to MRU', () => {
      const m = new BoundedMap<string, number>(3);
      m.set('a', 1);
      m.set('b', 2);
      m.set('c', 3);
      m.set('a', 10); // promote 'a'
      m.set('d', 4); // should evict 'b'
      expect(m.has('a')).toBe(true);
      expect(m.has('b')).toBe(false);
    });

    it('emits evicted event', () => {
      const m = new BoundedMap<string, number>(2);
      const handler = vi.fn();
      m.on('evicted', handler);
      m.set('a', 1);
      m.set('b', 2);
      m.set('c', 3);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({ key: 'a', value: 1 });
    });

    it('handles maxSize of 1', () => {
      const m = new BoundedMap<string, number>(1);
      m.set('a', 1);
      m.set('b', 2);
      expect(m.size).toBe(1);
      expect(m.has('a')).toBe(false);
      expect(m.get('b')).toBe(2);
    });
  });

  describe('delete', () => {
    it('deletes existing keys', () => {
      const m = new BoundedMap<string, number>(10);
      m.set('a', 1);
      expect(m.delete('a')).toBe(true);
      expect(m.has('a')).toBe(false);
      expect(m.size).toBe(0);
    });

    it('returns false for missing keys', () => {
      const m = new BoundedMap<string, number>(10);
      expect(m.delete('missing')).toBe(false);
    });

    it('correctly relinks after delete', () => {
      const m = new BoundedMap<string, number>(5);
      m.set('a', 1);
      m.set('b', 2);
      m.set('c', 3);
      m.delete('b'); // delete middle
      expect([...m.keys()]).toEqual(['c', 'a']);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const m = new BoundedMap<string, number>(10);
      m.set('a', 1);
      m.set('b', 2);
      m.clear();
      expect(m.size).toBe(0);
      expect(m.get('a')).toBeUndefined();
    });
  });

  describe('iterators', () => {
    it('keys() returns keys in MRU order', () => {
      const m = new BoundedMap<string, number>(10);
      m.set('a', 1);
      m.set('b', 2);
      m.set('c', 3);
      expect([...m.keys()]).toEqual(['c', 'b', 'a']);
    });

    it('values() returns values in MRU order', () => {
      const m = new BoundedMap<string, number>(10);
      m.set('a', 1);
      m.set('b', 2);
      expect([...m.values()]).toEqual([2, 1]);
    });

    it('entries() returns [key, value] pairs', () => {
      const m = new BoundedMap<string, number>(10);
      m.set('x', 10);
      m.set('y', 20);
      expect([...m.entries()]).toEqual([['y', 20], ['x', 10]]);
    });

    it('forEach iterates over all entries', () => {
      const m = new BoundedMap<string, number>(10);
      m.set('a', 1);
      m.set('b', 2);
      const results: [string, number][] = [];
      m.forEach((v, k) => results.push([k, v]));
      expect(results).toEqual([['b', 2], ['a', 1]]);
    });

    it('Symbol.iterator works with for-of', () => {
      const m = new BoundedMap<string, number>(10);
      m.set('a', 1);
      m.set('b', 2);
      const results: [string, number][] = [];
      for (const [k, v] of m) {
        results.push([k, v]);
      }
      expect(results).toEqual([['b', 2], ['a', 1]]);
    });
  });

  describe('stress test', () => {
    it('handles many insertions without leaking', () => {
      const m = new BoundedMap<number, number>(100);
      for (let i = 0; i < 10000; i++) {
        m.set(i, i * 2);
      }
      expect(m.size).toBe(100);
      // Only the last 100 should remain
      expect(m.has(9999)).toBe(true);
      expect(m.has(9900)).toBe(true);
      expect(m.has(9899)).toBe(false);
    });
  });
});
