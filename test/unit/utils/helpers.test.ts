import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Logger mock (used by retry.ts)
// ---------------------------------------------------------------------------
vi.mock('../../../src/core/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------
import { retry, sleep, withTimeout } from '../../../src/utils/retry.js';
import { Timer, formatDuration, measure, stopwatch } from '../../../src/utils/timer.js';
import {
  estimateTokens,
  formatTokens,
  formatCost,
  truncateToTokenBudget,
  calculateCost,
} from '../../../src/utils/tokens.js';
import { sha256, shortHash, randomHex, cacheKey, contentFingerprint } from '../../../src/utils/crypto.js';
import { collect, map, filter, take, buffer, fromCallback } from '../../../src/utils/stream.js';

// ===========================================================================
//  retry.ts
// ===========================================================================
describe('retry', () => {
  describe('retry()', () => {
    it('should resolve on successful first attempt without retrying', async () => {
      const fn = vi.fn().mockResolvedValue('ok');

      const result = await retry(fn, { baseDelay: 0, maxDelay: 0 });

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure then succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockResolvedValue('success');

      const result = await retry(fn, { baseDelay: 0, maxDelay: 0, maxRetries: 3 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after maxRetries is exceeded', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always-fail'));

      await expect(
        retry(fn, { baseDelay: 0, maxDelay: 0, maxRetries: 2 }),
      ).rejects.toThrow('always-fail');

      // Initial attempt + 2 retries = 3 calls
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw immediately for non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('FatalCrash'));

      await expect(
        retry(fn, {
          baseDelay: 0,
          maxDelay: 0,
          maxRetries: 5,
          retryableErrors: ['TimeoutError', 'ECONNRESET'],
        }),
      ).rejects.toThrow('FatalCrash');

      // Only the initial attempt — no retries because error is not retryable
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry when error matches retryableErrors list', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('recovered');

      const result = await retry(fn, {
        baseDelay: 0,
        maxDelay: 0,
        maxRetries: 3,
        retryableErrors: ['ECONNRESET'],
      });

      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should call onRetry callback on each retry attempt', async () => {
      const onRetry = vi.fn();
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('err-1'))
        .mockRejectedValueOnce(new Error('err-2'))
        .mockResolvedValue('done');

      await retry(fn, { baseDelay: 0, maxDelay: 0, maxRetries: 3, onRetry });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ message: 'err-1' }));
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.objectContaining({ message: 'err-2' }));
    });

    it('should coerce non-Error throws into Error objects', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce('string-error')
        .mockResolvedValue('ok');

      const result = await retry(fn, { baseDelay: 0, maxDelay: 0 });
      expect(result).toBe('ok');
    });
  });

  describe('sleep()', () => {
    it('should resolve after the specified delay', async () => {
      const start = performance.now();
      await sleep(50);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timing variance
    });

    it('should resolve immediately for 0ms', async () => {
      const start = performance.now();
      await sleep(0);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('withTimeout()', () => {
    it('should resolve with the value when promise completes before timeout', async () => {
      const promise = new Promise<string>(resolve => setTimeout(() => resolve('fast'), 10));
      const result = await withTimeout(promise, 5000);
      expect(result).toBe('fast');
    });

    it('should reject with timeout error when promise exceeds timeout', async () => {
      const promise = new Promise<string>(resolve => setTimeout(() => resolve('slow'), 5000));
      await expect(withTimeout(promise, 10)).rejects.toThrow('Operation timed out after 10ms');
    });

    it('should use custom timeout message when provided', async () => {
      const promise = new Promise<string>(resolve => setTimeout(() => resolve('slow'), 5000));
      await expect(withTimeout(promise, 10, 'Custom timeout!')).rejects.toThrow('Custom timeout!');
    });

    it('should propagate the original error if promise rejects before timeout', async () => {
      const promise = Promise.reject(new Error('original error'));
      await expect(withTimeout(promise, 5000)).rejects.toThrow('original error');
    });
  });
});

// ===========================================================================
//  timer.ts
// ===========================================================================
describe('timer', () => {
  describe('Timer class', () => {
    it('should measure elapsed time greater than 0', async () => {
      const timer = new Timer();
      // small busy-wait to ensure measurable elapsed
      await sleep(10);
      expect(timer.elapsed).toBeGreaterThan(0);
    });

    it('should freeze elapsed time after stop()', async () => {
      const timer = new Timer();
      await sleep(10);
      const stopped = timer.stop();
      await sleep(20);
      // After stop, elapsed should remain the same
      expect(timer.elapsed).toBe(stopped);
    });

    it('should record laps with labels', async () => {
      const timer = new Timer();
      await sleep(5);
      const lap1 = timer.lap('phase-1');
      await sleep(5);
      const lap2 = timer.lap('phase-2');

      expect(lap1).toBeGreaterThan(0);
      expect(lap2).toBeGreaterThan(lap1);

      const laps = timer.getLaps();
      expect(laps).toHaveProperty('phase-1');
      expect(laps).toHaveProperty('phase-2');
      expect(laps['phase-1']).toBe(lap1);
      expect(laps['phase-2']).toBe(lap2);
    });

    it('should return a formatted string via .formatted', () => {
      const timer = new Timer();
      const formatted = timer.formatted;
      expect(typeof formatted).toBe('string');
      // Should end with "ms" for very short durations
      expect(formatted).toMatch(/\d+ms/);
    });
  });

  describe('formatDuration()', () => {
    it('should format sub-second durations as milliseconds', () => {
      expect(formatDuration(0)).toBe('0ms');
      expect(formatDuration(1)).toBe('1ms');
      expect(formatDuration(500)).toBe('500ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('should format second-range durations with one decimal', () => {
      expect(formatDuration(1000)).toBe('1.0s');
      expect(formatDuration(1500)).toBe('1.5s');
      expect(formatDuration(59999)).toBe('60.0s');
    });

    it('should format minute-range durations as Xm Xs', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(125000)).toBe('2m 5s');
    });
  });

  describe('measure()', () => {
    it('should return the result and a positive duration', async () => {
      const { result, duration } = await measure(async () => {
        await sleep(5);
        return 42;
      });

      expect(result).toBe(42);
      expect(duration).toBeGreaterThan(0);
    });

    it('should propagate errors from the measured function', async () => {
      await expect(
        measure(async () => {
          throw new Error('measure-error');
        }),
      ).rejects.toThrow('measure-error');
    });
  });

  describe('stopwatch()', () => {
    it('should return elapsed in milliseconds', async () => {
      const sw = stopwatch();
      await sleep(10);
      expect(sw.elapsed()).toBeGreaterThan(0);
    });

    it('should return a formatted elapsed string', async () => {
      const sw = stopwatch();
      const formatted = sw.formatted();
      expect(typeof formatted).toBe('string');
      expect(formatted).toMatch(/\d+ms/);
    });

    it('should continue ticking after reads', async () => {
      const sw = stopwatch();
      await sleep(5);
      const first = sw.elapsed();
      await sleep(5);
      const second = sw.elapsed();
      expect(second).toBeGreaterThan(first);
    });
  });
});

// ===========================================================================
//  tokens.ts
// ===========================================================================
describe('tokens', () => {
  describe('estimateTokens()', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('should return 0 for undefined/null-ish input', () => {
      expect(estimateTokens(undefined as unknown as string)).toBe(0);
      expect(estimateTokens(null as unknown as string)).toBe(0);
    });

    it('should estimate ~4 chars per token for plain English text', () => {
      const text = 'Hello world this is a test sentence for token estimation';
      const tokens = estimateTokens(text);
      // 56 chars / 4 = 14 tokens
      expect(tokens).toBe(Math.ceil(text.length / 4));
    });

    it('should estimate ~3.5 chars per token for code text (with symbols)', () => {
      const code = 'function add(a, b) { return a + b; }';
      const tokens = estimateTokens(code);
      // Code path: 3.5 chars/token
      expect(tokens).toBe(Math.ceil(code.length / 3.5));
    });

    it('should detect code via symbol characters', () => {
      const plainText = 'The quick brown fox jumps over the lazy dog';
      const codeText = 'if (x > 0) { return true; }';

      const plainTokens = estimateTokens(plainText);
      const codeTokens = estimateTokens(codeText);

      // Code text of similar length should produce more tokens (smaller divisor)
      // Using ratio comparison: codeTokens/codeText.length > plainTokens/plainText.length
      expect(codeTokens / codeText.length).toBeGreaterThan(plainTokens / plainText.length);
    });
  });

  describe('formatTokens()', () => {
    it('should format counts under 1000 as plain numbers', () => {
      expect(formatTokens(0)).toBe('0');
      expect(formatTokens(1)).toBe('1');
      expect(formatTokens(999)).toBe('999');
    });

    it('should format counts in the thousands as X.XK', () => {
      expect(formatTokens(1000)).toBe('1.0K');
      expect(formatTokens(1500)).toBe('1.5K');
      expect(formatTokens(999999)).toBe('1000.0K');
    });

    it('should format counts in the millions as X.XXM', () => {
      expect(formatTokens(1000000)).toBe('1.00M');
      expect(formatTokens(2500000)).toBe('2.50M');
    });
  });

  describe('formatCost()', () => {
    it('should format costs < $0.01 with 4 decimal places', () => {
      expect(formatCost(0.001)).toBe('$0.0010');
      expect(formatCost(0.0099)).toBe('$0.0099');
      expect(formatCost(0)).toBe('$0.0000');
    });

    it('should format costs >= $0.01 and < $1 with 3 decimal places', () => {
      expect(formatCost(0.01)).toBe('$0.010');
      expect(formatCost(0.5)).toBe('$0.500');
      expect(formatCost(0.999)).toBe('$0.999');
    });

    it('should format costs >= $1 with 2 decimal places', () => {
      expect(formatCost(1)).toBe('$1.00');
      expect(formatCost(10.5)).toBe('$10.50');
      expect(formatCost(100.999)).toBe('$101.00');
    });
  });

  describe('truncateToTokenBudget()', () => {
    it('should return text unchanged when within budget', () => {
      const text = 'Hello world';
      const result = truncateToTokenBudget(text, 1000);
      expect(result).toBe(text);
    });

    it('should truncate text that exceeds the budget', () => {
      const text = 'a'.repeat(4000); // ~1000 tokens at 4 chars/token
      const result = truncateToTokenBudget(text, 100);

      expect(result.length).toBeLessThan(text.length);
      expect(result).toContain('[... truncated to fit token budget ...]');
    });

    it('should apply 5% safety margin when truncating', () => {
      const text = 'a'.repeat(4000); // ~1000 tokens
      const maxTokens = 500;
      const result = truncateToTokenBudget(text, maxTokens);

      // The truncated portion (before the message) should be approximately
      // text.length * (maxTokens / estimateTokens(text)) * 0.95
      const estimated = estimateTokens(text);
      const expectedMaxChars = Math.floor(text.length * (maxTokens / estimated) * 0.95);
      const truncatedPart = result.split('\n\n[... truncated')[0];
      expect(truncatedPart.length).toBe(expectedMaxChars);
    });
  });

  describe('calculateCost()', () => {
    it('should calculate cost correctly from token counts and pricing', () => {
      const cost = calculateCost(1_000_000, 500_000, {
        inputPer1M: 3.0,
        outputPer1M: 15.0,
      });
      // 1M input * $3/1M = $3
      // 500K output * $15/1M = $7.5
      // Total = $10.5
      expect(cost).toBeCloseTo(10.5);
    });

    it('should return 0 for zero tokens', () => {
      const cost = calculateCost(0, 0, { inputPer1M: 3.0, outputPer1M: 15.0 });
      expect(cost).toBe(0);
    });

    it('should handle fractional token counts', () => {
      const cost = calculateCost(100, 200, { inputPer1M: 10.0, outputPer1M: 20.0 });
      // 100/1M * 10 = 0.001
      // 200/1M * 20 = 0.004
      expect(cost).toBeCloseTo(0.005);
    });
  });
});

// ===========================================================================
//  crypto.ts
// ===========================================================================
describe('crypto', () => {
  describe('sha256()', () => {
    it('should produce a deterministic 64-char hex hash', () => {
      const hash1 = sha256('hello');
      const hash2 = sha256('hello');

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different hashes for different inputs', () => {
      expect(sha256('hello')).not.toBe(sha256('world'));
    });

    it('should match known SHA-256 value', () => {
      // SHA-256 of "hello" is well-known
      expect(sha256('hello')).toBe(
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      );
    });
  });

  describe('shortHash()', () => {
    it('should return exactly 8 characters', () => {
      const hash = shortHash('test-input');
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should be deterministic', () => {
      expect(shortHash('abc')).toBe(shortHash('abc'));
    });

    it('should be the first 8 chars of the full sha256', () => {
      const full = sha256('anything');
      const short = shortHash('anything');
      expect(full.startsWith(short)).toBe(true);
    });
  });

  describe('randomHex()', () => {
    it('should return a hex string of the specified length', () => {
      const hex = randomHex(32);
      expect(hex).toHaveLength(32);
      expect(hex).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should default to length 16', () => {
      const hex = randomHex();
      expect(hex).toHaveLength(16);
    });

    it('should produce different values on each call', () => {
      const a = randomHex(16);
      const b = randomHex(16);
      expect(a).not.toBe(b);
    });

    it('should handle odd lengths', () => {
      const hex = randomHex(7);
      expect(hex).toHaveLength(7);
      expect(hex).toMatch(/^[0-9a-f]{7}$/);
    });
  });

  describe('cacheKey()', () => {
    it('should produce a deterministic hash from parts', () => {
      const key1 = cacheKey('model', 'prompt', 'v1');
      const key2 = cacheKey('model', 'prompt', 'v1');
      expect(key1).toBe(key2);
    });

    it('should produce different keys for different parts', () => {
      const key1 = cacheKey('a', 'b');
      const key2 = cacheKey('a', 'c');
      expect(key1).not.toBe(key2);
    });

    it('should join parts with :: before hashing', () => {
      // cacheKey('a', 'b') should equal sha256('a::b')
      expect(cacheKey('a', 'b')).toBe(sha256('a::b'));
    });

    it('should handle a single part', () => {
      expect(cacheKey('solo')).toBe(sha256('solo'));
    });
  });

  describe('contentFingerprint()', () => {
    it('should return a 16-character hex string', () => {
      const fp = contentFingerprint('Hello world');
      expect(fp).toHaveLength(16);
      expect(fp).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should normalize case differences', () => {
      expect(contentFingerprint('Hello World')).toBe(contentFingerprint('hello world'));
    });

    it('should normalize whitespace differences', () => {
      expect(contentFingerprint('hello   world')).toBe(contentFingerprint('hello world'));
      expect(contentFingerprint('  hello\t\nworld  ')).toBe(contentFingerprint('hello world'));
    });

    it('should normalize punctuation differences', () => {
      expect(contentFingerprint('hello, world!')).toBe(contentFingerprint('hello world'));
    });

    it('should produce different fingerprints for different content', () => {
      expect(contentFingerprint('hello world')).not.toBe(contentFingerprint('goodbye world'));
    });
  });
});

// ===========================================================================
//  stream.ts
// ===========================================================================
describe('stream', () => {
  /**
   * Helper: create an async iterable from an array.
   */
  async function* toAsync<T>(items: T[]): AsyncGenerator<T> {
    for (const item of items) {
      yield item;
    }
  }

  describe('collect()', () => {
    it('should gather all items from an async iterable into an array', async () => {
      const items = await collect(toAsync([1, 2, 3]));
      expect(items).toEqual([1, 2, 3]);
    });

    it('should return an empty array for an empty iterable', async () => {
      const items = await collect(toAsync([]));
      expect(items).toEqual([]);
    });
  });

  describe('map()', () => {
    it('should transform each item', async () => {
      const doubled = await collect(map(toAsync([1, 2, 3]), x => x * 2));
      expect(doubled).toEqual([2, 4, 6]);
    });

    it('should handle type transformations', async () => {
      const strings = await collect(map(toAsync([1, 2, 3]), x => String(x)));
      expect(strings).toEqual(['1', '2', '3']);
    });

    it('should return empty for empty iterable', async () => {
      const result = await collect(map(toAsync<number>([]), x => x * 2));
      expect(result).toEqual([]);
    });
  });

  describe('filter()', () => {
    it('should remove items that do not match the predicate', async () => {
      const evens = await collect(filter(toAsync([1, 2, 3, 4, 5]), x => x % 2 === 0));
      expect(evens).toEqual([2, 4]);
    });

    it('should return all items if predicate always returns true', async () => {
      const all = await collect(filter(toAsync([1, 2, 3]), () => true));
      expect(all).toEqual([1, 2, 3]);
    });

    it('should return empty if predicate always returns false', async () => {
      const none = await collect(filter(toAsync([1, 2, 3]), () => false));
      expect(none).toEqual([]);
    });
  });

  describe('take()', () => {
    it('should yield only the first n items', async () => {
      const items = await collect(take(toAsync([1, 2, 3, 4, 5]), 3));
      expect(items).toEqual([1, 2, 3]);
    });

    it('should yield all items if n exceeds iterable length', async () => {
      const items = await collect(take(toAsync([1, 2]), 10));
      expect(items).toEqual([1, 2]);
    });

    it('should yield nothing when n is 0', async () => {
      const items = await collect(take(toAsync([1, 2, 3]), 0));
      expect(items).toEqual([]);
    });
  });

  describe('buffer()', () => {
    it('should yield batches of the specified size', async () => {
      const batches = await collect(buffer(toAsync([1, 2, 3, 4, 5, 6]), 2));
      expect(batches).toEqual([[1, 2], [3, 4], [5, 6]]);
    });

    it('should yield a partial final batch', async () => {
      const batches = await collect(buffer(toAsync([1, 2, 3, 4, 5]), 3));
      expect(batches).toEqual([[1, 2, 3], [4, 5]]);
    });

    it('should yield a single batch if size exceeds item count', async () => {
      const batches = await collect(buffer(toAsync([1, 2]), 10));
      expect(batches).toEqual([[1, 2]]);
    });

    it('should yield nothing for an empty iterable', async () => {
      const batches = await collect(buffer(toAsync<number>([]), 3));
      expect(batches).toEqual([]);
    });
  });

  describe('fromCallback()', () => {
    it('should collect items pushed before iteration', async () => {
      const { iterable, push, done } = fromCallback<number>();

      push(1);
      push(2);
      push(3);
      done();

      const items = await collect(iterable);
      expect(items).toEqual([1, 2, 3]);
    });

    it('should collect items pushed during iteration', async () => {
      const { iterable, push, done } = fromCallback<string>();

      // Push items asynchronously
      setTimeout(() => {
        push('a');
        push('b');
        done();
      }, 10);

      const items = await collect(iterable);
      expect(items).toEqual(['a', 'b']);
    });

    it('should handle interleaved push and consume', async () => {
      const { iterable, push, done } = fromCallback<number>();

      const result: number[] = [];

      // Start consuming
      const consumer = (async () => {
        for await (const item of iterable) {
          result.push(item);
        }
      })();

      // Push items with small delays
      push(10);
      await sleep(5);
      push(20);
      await sleep(5);
      push(30);
      done();

      await consumer;
      expect(result).toEqual([10, 20, 30]);
    });

    it('should yield no items when done() is called immediately', async () => {
      const { iterable, done } = fromCallback<number>();
      done();

      const items = await collect(iterable);
      expect(items).toEqual([]);
    });

    it('should handle the error callback', async () => {
      const { iterable, push, error: emitError } = fromCallback<number>();

      push(1);

      // After consuming the queued item, next call to next() will encounter the error
      setTimeout(() => {
        emitError(new Error('stream-error'));
      }, 10);

      const iterator = iterable[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first).toEqual({ value: 1, done: false });

      // Give time for error to be set
      await sleep(20);
      await expect(iterator.next()).rejects.toThrow('stream-error');
    });
  });

  describe('composing stream utilities', () => {
    it('should chain map, filter, and take', async () => {
      const source = toAsync([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const pipeline = take(
        filter(
          map(source, x => x * 2),
          x => x > 5,
        ),
        3,
      );

      const result = await collect(pipeline);
      // map: [2,4,6,8,10,12,14,16,18,20]
      // filter (>5): [6,8,10,12,14,16,18,20]
      // take 3: [6,8,10]
      expect(result).toEqual([6, 8, 10]);
    });
  });
});
