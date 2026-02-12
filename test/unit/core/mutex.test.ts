import { describe, it, expect } from 'vitest';
import { AsyncMutex, AsyncRWLock, AsyncSemaphore } from '../../../src/core/mutex.js';

describe('AsyncMutex', () => {
  it('should acquire and release lock', async () => {
    const mutex = new AsyncMutex();
    expect(mutex.isLocked).toBe(false);

    const release = await mutex.acquire();
    expect(mutex.isLocked).toBe(true);

    release();
    expect(mutex.isLocked).toBe(false);
  });

  it('should queue concurrent acquire calls', async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    const p1 = mutex.acquire().then(release => {
      order.push(1);
      setTimeout(release, 10);
    });

    const p2 = mutex.acquire().then(release => {
      order.push(2);
      release();
    });

    const p3 = mutex.acquire().then(release => {
      order.push(3);
      release();
    });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('should tryAcquire without blocking', () => {
    const mutex = new AsyncMutex();
    const release = mutex.tryAcquire();
    expect(release).not.toBeNull();
    expect(mutex.isLocked).toBe(true);

    const second = mutex.tryAcquire();
    expect(second).toBeNull();

    release!();
    expect(mutex.isLocked).toBe(false);
  });

  it('should support withLock helper', async () => {
    const mutex = new AsyncMutex();
    const result = await mutex.withLock(() => 42);
    expect(result).toBe(42);
    expect(mutex.isLocked).toBe(false);
  });

  it('should release lock even on error in withLock', async () => {
    const mutex = new AsyncMutex();
    await expect(mutex.withLock(() => { throw new Error('fail'); })).rejects.toThrow('fail');
    expect(mutex.isLocked).toBe(false);
  });

  it('should report queue length', async () => {
    const mutex = new AsyncMutex();
    expect(mutex.queueLength).toBe(0);

    const release = await mutex.acquire();

    // Queue up two waiters
    const p1 = mutex.acquire();
    const p2 = mutex.acquire();

    // Need a tick for the promises to register
    await new Promise(r => setTimeout(r, 0));
    expect(mutex.queueLength).toBe(2);

    release();
    const r1 = await p1;
    r1();
    const r2 = await p2;
    r2();
  });

  it('should handle idempotent release', async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.acquire();
    release();
    release(); // Double release should be safe
    expect(mutex.isLocked).toBe(false);
  });
});

describe('AsyncRWLock', () => {
  it('should allow multiple concurrent readers', async () => {
    const lock = new AsyncRWLock();

    const r1 = await lock.acquireRead();
    const r2 = await lock.acquireRead();
    expect(lock.readerCount).toBe(2);

    r1();
    expect(lock.readerCount).toBe(1);
    r2();
    expect(lock.readerCount).toBe(0);
  });

  it('should give exclusive access to writers', async () => {
    const lock = new AsyncRWLock();
    const release = await lock.acquireWrite();
    expect(lock.isWriteLocked).toBe(true);
    release();
    expect(lock.isWriteLocked).toBe(false);
  });

  it('should block writers when readers hold lock', async () => {
    const lock = new AsyncRWLock();
    const order: string[] = [];

    const readRelease = await lock.acquireRead();
    order.push('reader-acquired');

    const writerPromise = lock.acquireWrite().then(release => {
      order.push('writer-acquired');
      release();
    });

    // Writer should be waiting
    await new Promise(r => setTimeout(r, 10));
    expect(order).toEqual(['reader-acquired']);

    readRelease();
    await writerPromise;
    expect(order).toEqual(['reader-acquired', 'writer-acquired']);
  });

  it('should support withRead and withWrite helpers', async () => {
    const lock = new AsyncRWLock();
    const readResult = await lock.withRead(() => 'read-value');
    expect(readResult).toBe('read-value');

    const writeResult = await lock.withWrite(() => 'write-value');
    expect(writeResult).toBe('write-value');
  });

  it('should release on error in withWrite', async () => {
    const lock = new AsyncRWLock();
    await expect(lock.withWrite(() => { throw new Error('fail'); })).rejects.toThrow('fail');
    expect(lock.isWriteLocked).toBe(false);
  });
});

describe('AsyncSemaphore', () => {
  it('should allow up to maxPermits concurrent access', async () => {
    const sem = new AsyncSemaphore(3);
    expect(sem.available).toBe(3);

    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    const r3 = await sem.acquire();
    expect(sem.available).toBe(0);

    r1();
    expect(sem.available).toBe(1);
    r2();
    r3();
    expect(sem.available).toBe(3);
  });

  it('should queue when permits exhausted', async () => {
    const sem = new AsyncSemaphore(1);
    const order: number[] = [];

    const r1 = await sem.acquire();
    order.push(1);

    const p2 = sem.acquire().then(release => {
      order.push(2);
      release();
    });

    await new Promise(r => setTimeout(r, 5));
    expect(order).toEqual([1]);

    r1();
    await p2;
    expect(order).toEqual([1, 2]);
  });

  it('should support tryAcquire', () => {
    const sem = new AsyncSemaphore(1);
    const r1 = sem.tryAcquire();
    expect(r1).not.toBeNull();

    const r2 = sem.tryAcquire();
    expect(r2).toBeNull();

    r1!();
    const r3 = sem.tryAcquire();
    expect(r3).not.toBeNull();
    r3!();
  });

  it('should support withPermit helper', async () => {
    const sem = new AsyncSemaphore(2);
    const result = await sem.withPermit(() => 'done');
    expect(result).toBe('done');
    expect(sem.available).toBe(2);
  });

  it('should release on error in withPermit', async () => {
    const sem = new AsyncSemaphore(1);
    await expect(sem.withPermit(() => { throw new Error('fail'); })).rejects.toThrow('fail');
    expect(sem.available).toBe(1);
  });

  it('should throw on invalid maxPermits', () => {
    expect(() => new AsyncSemaphore(0)).toThrow();
    expect(() => new AsyncSemaphore(-1)).toThrow();
  });

  it('should report waiting count', async () => {
    const sem = new AsyncSemaphore(1);
    expect(sem.waiting).toBe(0);

    const r1 = await sem.acquire();
    const p2 = sem.acquire();
    const p3 = sem.acquire();

    await new Promise(r => setTimeout(r, 0));
    expect(sem.waiting).toBe(2);

    r1();
    const r2 = await p2;
    r2();
    const r3 = await p3;
    r3();
  });

  it('should report max permits', () => {
    const sem = new AsyncSemaphore(5);
    expect(sem.max).toBe(5);
  });
});
