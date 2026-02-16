import { describe, it, expect } from 'vitest';
import { CircularBuffer } from '../../../src/utils/circular-buffer.js';

describe('CircularBuffer', () => {
  describe('constructor', () => {
    it('throws if capacity < 1', () => {
      expect(() => new CircularBuffer(0)).toThrow('capacity must be >= 1');
    });

    it('creates empty buffer', () => {
      const buf = new CircularBuffer<number>(10);
      expect(buf.length).toBe(0);
      expect(buf.isFull).toBe(false);
    });
  });

  describe('push', () => {
    it('adds items', () => {
      const buf = new CircularBuffer<number>(5);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      expect(buf.length).toBe(3);
      expect(buf.toArray()).toEqual([1, 2, 3]);
    });

    it('overwrites oldest when full', () => {
      const buf = new CircularBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      buf.push(4); // overwrites 1
      expect(buf.length).toBe(3);
      expect(buf.toArray()).toEqual([2, 3, 4]);
    });

    it('handles wrap-around correctly', () => {
      const buf = new CircularBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      buf.push(4);
      buf.push(5);
      expect(buf.toArray()).toEqual([3, 4, 5]);
    });
  });

  describe('toArray', () => {
    it('returns empty array for empty buffer', () => {
      const buf = new CircularBuffer<number>(5);
      expect(buf.toArray()).toEqual([]);
    });

    it('returns items in insertion order (oldest first)', () => {
      const buf = new CircularBuffer<string>(4);
      buf.push('a');
      buf.push('b');
      buf.push('c');
      expect(buf.toArray()).toEqual(['a', 'b', 'c']);
    });

    it('maintains order after wrap-around', () => {
      const buf = new CircularBuffer<number>(3);
      for (let i = 1; i <= 7; i++) {
        buf.push(i);
      }
      expect(buf.toArray()).toEqual([5, 6, 7]);
    });
  });

  describe('latest', () => {
    it('returns undefined for empty buffer', () => {
      const buf = new CircularBuffer<number>(5);
      expect(buf.latest()).toBeUndefined();
    });

    it('returns most recently pushed item', () => {
      const buf = new CircularBuffer<number>(5);
      buf.push(10);
      buf.push(20);
      buf.push(30);
      expect(buf.latest()).toBe(30);
    });

    it('returns correct latest after wrap-around', () => {
      const buf = new CircularBuffer<number>(2);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      expect(buf.latest()).toBe(3);
    });
  });

  describe('isFull', () => {
    it('returns false when not full', () => {
      const buf = new CircularBuffer<number>(5);
      buf.push(1);
      expect(buf.isFull).toBe(false);
    });

    it('returns true when full', () => {
      const buf = new CircularBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      expect(buf.isFull).toBe(true);
    });
  });

  describe('clear', () => {
    it('resets the buffer', () => {
      const buf = new CircularBuffer<number>(5);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      buf.clear();
      expect(buf.length).toBe(0);
      expect(buf.toArray()).toEqual([]);
      expect(buf.isFull).toBe(false);
    });

    it('allows reuse after clear', () => {
      const buf = new CircularBuffer<number>(3);
      buf.push(1);
      buf.push(2);
      buf.push(3);
      buf.clear();
      buf.push(10);
      buf.push(20);
      expect(buf.toArray()).toEqual([10, 20]);
    });
  });

  describe('capacity of 1', () => {
    it('always keeps only the latest', () => {
      const buf = new CircularBuffer<string>(1);
      buf.push('a');
      expect(buf.toArray()).toEqual(['a']);
      buf.push('b');
      expect(buf.toArray()).toEqual(['b']);
      expect(buf.length).toBe(1);
    });
  });

  describe('stress test', () => {
    it('handles many insertions correctly', () => {
      const buf = new CircularBuffer<number>(100);
      for (let i = 0; i < 10000; i++) {
        buf.push(i);
      }
      expect(buf.length).toBe(100);
      const arr = buf.toArray();
      expect(arr[0]).toBe(9900);
      expect(arr[99]).toBe(9999);
    });
  });
});
