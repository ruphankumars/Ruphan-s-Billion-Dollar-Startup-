/**
 * Collect all items from an async iterable into an array
 */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

/**
 * Transform an async iterable by applying a function to each item
 */
export async function* map<T, U>(
  iterable: AsyncIterable<T>,
  fn: (item: T) => U,
): AsyncGenerator<U> {
  for await (const item of iterable) {
    yield fn(item);
  }
}

/**
 * Filter items from an async iterable
 */
export async function* filter<T>(
  iterable: AsyncIterable<T>,
  predicate: (item: T) => boolean,
): AsyncGenerator<T> {
  for await (const item of iterable) {
    if (predicate(item)) {
      yield item;
    }
  }
}

/**
 * Take only the first n items from an async iterable
 */
export async function* take<T>(
  iterable: AsyncIterable<T>,
  n: number,
): AsyncGenerator<T> {
  let count = 0;
  for await (const item of iterable) {
    if (count >= n) break;
    yield item;
    count++;
  }
}

/**
 * Buffer items from an async iterable, yielding arrays of buffered items
 */
export async function* buffer<T>(
  iterable: AsyncIterable<T>,
  size: number,
): AsyncGenerator<T[]> {
  let batch: T[] = [];
  for await (const item of iterable) {
    batch.push(item);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) {
    yield batch;
  }
}

/**
 * Create an async iterable from a callback-based stream
 */
export function fromCallback<T>(): {
  iterable: AsyncIterable<T>;
  push: (item: T) => void;
  done: () => void;
  error: (err: Error) => void;
} {
  const queue: T[] = [];
  let resolve: ((value: IteratorResult<T>) => void) | null = null;
  let finished = false;
  let lastError: Error | null = null;

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (finished) {
            return Promise.resolve({ value: undefined as unknown as T, done: true });
          }
          if (lastError) {
            return Promise.reject(lastError);
          }
          return new Promise<IteratorResult<T>>(r => {
            resolve = r;
          });
        },
      };
    },
  };

  return {
    iterable,
    push(item: T) {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: item, done: false });
      } else {
        queue.push(item);
      }
    },
    done() {
      finished = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as unknown as T, done: true });
      }
    },
    error(err: Error) {
      lastError = err;
      if (resolve) {
        resolve = null;
      }
    },
  };
}
