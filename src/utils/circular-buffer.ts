/**
 * CircularBuffer — Fixed-size ring buffer with O(1) push.
 *
 * When full, new items overwrite the oldest.
 * toArray() returns items in insertion order (oldest → newest).
 * Zero external dependencies.
 */
export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;    // next write position
  private count = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    if (capacity < 1) throw new Error('CircularBuffer capacity must be >= 1');
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * Push an item. If full, overwrites the oldest item.
   */
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Returns all items in order oldest → newest.
   */
  toArray(): T[] {
    if (this.count === 0) return [];
    const result: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      result.push(this.buffer[idx] as T);
    }
    return result;
  }

  /**
   * Get the most recent item (last pushed).
   */
  latest(): T | undefined {
    if (this.count === 0) return undefined;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    return this.buffer[idx];
  }

  get length(): number {
    return this.count;
  }

  get isFull(): boolean {
    return this.count >= this.capacity;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}
