/**
 * Async Mutex & Concurrent Safety Primitives
 *
 * Provides async-safe locking for shared state in multi-agent environments.
 * - AsyncMutex: single-resource exclusive lock
 * - AsyncRWLock: reader-writer lock (multiple readers, exclusive writer)
 * - AsyncSemaphore: counting semaphore for bounded concurrency
 */

/**
 * AsyncMutex — Exclusive lock for async operations.
 * Only one holder at a time; others queue in FIFO order.
 */
export class AsyncMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  /**
   * Acquire the lock. Returns a release function.
   */
  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        resolve(this.createRelease());
      });
    });
  }

  /**
   * Try to acquire the lock without waiting.
   * Returns release function if acquired, null if lock is held.
   */
  tryAcquire(): (() => void) | null {
    if (!this.locked) {
      this.locked = true;
      return this.createRelease();
    }
    return null;
  }

  /**
   * Run a function while holding the lock.
   */
  async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return; // Idempotent
      released = true;

      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        // Execute next in microtask to avoid stack overflow
        queueMicrotask(next);
      } else {
        this.locked = false;
      }
    };
  }
}

/**
 * AsyncRWLock — Reader-Writer lock.
 * Multiple readers can hold the lock simultaneously.
 * Writers get exclusive access (no readers or other writers).
 */
export class AsyncRWLock {
  private readers = 0;
  private writer = false;
  private readerQueue: Array<() => void> = [];
  private writerQueue: Array<() => void> = [];

  /**
   * Acquire a read lock. Multiple readers can hold simultaneously.
   */
  async acquireRead(): Promise<() => void> {
    if (!this.writer && this.writerQueue.length === 0) {
      this.readers++;
      return this.createReadRelease();
    }

    return new Promise<() => void>((resolve) => {
      this.readerQueue.push(() => {
        this.readers++;
        resolve(this.createReadRelease());
      });
    });
  }

  /**
   * Acquire a write lock. Exclusive access (no readers or other writers).
   */
  async acquireWrite(): Promise<() => void> {
    if (!this.writer && this.readers === 0) {
      this.writer = true;
      return this.createWriteRelease();
    }

    return new Promise<() => void>((resolve) => {
      this.writerQueue.push(() => {
        this.writer = true;
        resolve(this.createWriteRelease());
      });
    });
  }

  /**
   * Run a function while holding a read lock.
   */
  async withRead<T>(fn: () => T | Promise<T>): Promise<T> {
    const release = await this.acquireRead();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Run a function while holding a write lock.
   */
  async withWrite<T>(fn: () => T | Promise<T>): Promise<T> {
    const release = await this.acquireWrite();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  get readerCount(): number {
    return this.readers;
  }

  get isWriteLocked(): boolean {
    return this.writer;
  }

  private createReadRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.readers--;
      this.processQueue();
    };
  }

  private createWriteRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.writer = false;
      this.processQueue();
    };
  }

  private processQueue(): void {
    // Prefer writers over readers (write-priority)
    if (this.readers === 0 && !this.writer && this.writerQueue.length > 0) {
      const next = this.writerQueue.shift()!;
      queueMicrotask(next);
    } else if (!this.writer && this.readerQueue.length > 0) {
      // Wake all pending readers
      const readers = [...this.readerQueue];
      this.readerQueue = [];
      for (const reader of readers) {
        queueMicrotask(reader);
      }
    }
  }
}

/**
 * AsyncSemaphore — Counting semaphore for bounded concurrency.
 */
export class AsyncSemaphore {
  private permits: number;
  private readonly maxPermits: number;
  private queue: Array<() => void> = [];

  constructor(maxPermits: number) {
    if (maxPermits < 1) throw new Error('Semaphore must have at least 1 permit');
    this.maxPermits = maxPermits;
    this.permits = maxPermits;
  }

  /**
   * Acquire a permit. Waits if none available.
   */
  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        resolve(this.createRelease());
      });
    });
  }

  /**
   * Try to acquire a permit without waiting.
   */
  tryAcquire(): (() => void) | null {
    if (this.permits > 0) {
      this.permits--;
      return this.createRelease();
    }
    return null;
  }

  /**
   * Run a function while holding a permit.
   */
  async withPermit<T>(fn: () => T | Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  get available(): number {
    return this.permits;
  }

  get waiting(): number {
    return this.queue.length;
  }

  get max(): number {
    return this.maxPermits;
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        queueMicrotask(next);
      } else {
        this.permits++;
      }
    };
  }
}
