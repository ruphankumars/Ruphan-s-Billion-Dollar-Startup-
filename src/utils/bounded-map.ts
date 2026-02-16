/**
 * BoundedMap — LRU-evicting Map with configurable max size.
 *
 * O(1) get/set/delete via Map + doubly-linked list.
 * When set() exceeds maxSize, the least-recently-used entry is evicted.
 * Zero external dependencies (Node.js built-ins only).
 */
import { EventEmitter } from 'node:events';

interface Node<K, V> {
  key: K;
  value: V;
  prev: Node<K, V> | null;
  next: Node<K, V> | null;
}

export class BoundedMap<K, V> extends EventEmitter {
  private map: Map<K, Node<K, V>> = new Map();
  private head: Node<K, V> | null = null; // most recently used
  private tail: Node<K, V> | null = null; // least recently used
  private readonly maxSize: number;

  constructor(maxSize: number) {
    super();
    if (maxSize < 1) throw new Error('BoundedMap maxSize must be >= 1');
    this.maxSize = maxSize;
  }

  /**
   * Get a value and promote it to most-recently-used.
   */
  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.moveToHead(node);
    return node.value;
  }

  /**
   * Set a key-value pair. Evicts LRU entry if at capacity.
   */
  set(key: K, value: V): this {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToHead(existing);
      return this;
    }

    // Evict if at capacity
    if (this.map.size >= this.maxSize) {
      this.evictTail();
    }

    const node: Node<K, V> = { key, value, prev: null, next: this.head };
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    if (!this.tail) {
      this.tail = node;
    }
    this.map.set(key, node);
    return this;
  }

  /**
   * Delete a key.
   */
  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNode(node);
    this.map.delete(key);
    return true;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  *keys(): IterableIterator<K> {
    let node = this.head;
    while (node) {
      yield node.key;
      node = node.next;
    }
  }

  *values(): IterableIterator<V> {
    let node = this.head;
    while (node) {
      yield node.value;
      node = node.next;
    }
  }

  *entries(): IterableIterator<[K, V]> {
    let node = this.head;
    while (node) {
      yield [node.key, node.value];
      node = node.next;
    }
  }

  forEach(callback: (value: V, key: K, map: BoundedMap<K, V>) => void): void {
    let node = this.head;
    while (node) {
      callback(node.value, node.key, this);
      node = node.next;
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  // ─── Internal ──────────────────────────────────────────────

  private moveToHead(node: Node<K, V>): void {
    if (node === this.head) return;
    this.removeNode(node);
    node.prev = null;
    node.next = this.head;
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: Node<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
    node.prev = null;
    node.next = null;
  }

  private evictTail(): void {
    if (!this.tail) return;
    const evicted = this.tail;
    this.removeNode(evicted);
    this.map.delete(evicted.key);
    this.emit('evicted', { key: evicted.key, value: evicted.value });
  }
}
