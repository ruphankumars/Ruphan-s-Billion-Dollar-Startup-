import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileWatcher, matchGlob } from '../../../src/daemon/file-watcher.js';
import type { WatchRule } from '../../../src/daemon/types.js';

// Mock fs to avoid real filesystem operations in tests
vi.mock('node:fs', () => ({
  watch: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
  createReadStream: vi.fn(() => ({
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'end') cb();
      return { on: vi.fn() };
    }),
  })),
  promises: {
    readdir: vi.fn(async () => []),
    stat: vi.fn(async () => ({
      isDirectory: () => false,
      isFile: () => true,
      size: 100,
    })),
  },
}));

describe('FileWatcher', () => {
  let watcher: FileWatcher;

  beforeEach(() => {
    watcher = new FileWatcher();
  });

  describe('constructor', () => {
    it('creates watcher with defaults', () => {
      expect(watcher).toBeInstanceOf(FileWatcher);
      expect(watcher.isActive()).toBe(false);
    });

    it('accepts custom options', () => {
      const custom = new FileWatcher({
        pollIntervalMs: 5000,
        maxFiles: 100,
      });
      expect(custom).toBeInstanceOf(FileWatcher);
    });
  });

  describe('addRule()', () => {
    it('adds rules', () => {
      const rule: WatchRule = {
        pattern: '**/*.ts',
        action: 'analyze',
        priority: 5,
      };

      watcher.addRule(rule);
      const rules = watcher.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].pattern).toBe('**/*.ts');
      expect(rules[0].action).toBe('analyze');
      expect(rules[0].priority).toBe(5);
    });

    it('clamps priority to valid range', () => {
      watcher.addRule({ pattern: '*.js', action: 'ignore', priority: 0 });
      watcher.addRule({ pattern: '*.py', action: 'critic', priority: 15 });

      const rules = watcher.getRules();
      // Priority should be clamped to [1, 10]
      const jsRule = rules.find((r) => r.pattern === '*.js');
      const pyRule = rules.find((r) => r.pattern === '*.py');
      expect(jsRule!.priority).toBe(1);
      expect(pyRule!.priority).toBe(10);
    });

    it('sorts rules by priority descending', () => {
      watcher.addRule({ pattern: '*.low', action: 'analyze', priority: 1 });
      watcher.addRule({ pattern: '*.high', action: 'critic', priority: 9 });
      watcher.addRule({ pattern: '*.mid', action: 'ignore', priority: 5 });

      const rules = watcher.getRules();
      expect(rules[0].pattern).toBe('*.high');
      expect(rules[1].pattern).toBe('*.mid');
      expect(rules[2].pattern).toBe('*.low');
    });
  });

  describe('getRules()', () => {
    it('returns rules', () => {
      expect(watcher.getRules()).toEqual([]);

      watcher.addRule({ pattern: '*.ts', action: 'analyze', priority: 5 });
      expect(watcher.getRules()).toHaveLength(1);
    });

    it('returns a copy', () => {
      watcher.addRule({ pattern: '*.ts', action: 'analyze', priority: 5 });
      const rules = watcher.getRules();
      rules.push({ pattern: '*.js', action: 'ignore', priority: 3 });

      // Original should not be affected
      expect(watcher.getRules()).toHaveLength(1);
    });
  });

  describe('removeRule()', () => {
    it('removes by pattern', () => {
      watcher.addRule({ pattern: '**/*.ts', action: 'analyze', priority: 5 });
      watcher.addRule({ pattern: '**/*.js', action: 'ignore', priority: 3 });

      expect(watcher.getRules()).toHaveLength(2);

      watcher.removeRule('**/*.ts');
      expect(watcher.getRules()).toHaveLength(1);
      expect(watcher.getRules()[0].pattern).toBe('**/*.js');
    });

    it('does nothing for non-existent pattern', () => {
      watcher.addRule({ pattern: '*.ts', action: 'analyze', priority: 5 });
      watcher.removeRule('*.py');
      expect(watcher.getRules()).toHaveLength(1);
    });
  });

  describe('isActive()', () => {
    it('returns false when not watching', () => {
      expect(watcher.isActive()).toBe(false);
    });
  });

  describe('getWatchedDirs()', () => {
    it('returns empty initially', () => {
      const dirs = watcher.getWatchedDirs();
      expect(dirs).toEqual([]);
    });
  });
});

describe('matchGlob()', () => {
  it('matches single wildcard', () => {
    expect(matchGlob('*.ts', 'file.ts')).toBe(true);
    expect(matchGlob('*.ts', 'file.js')).toBe(false);
  });

  it('matches double wildcard', () => {
    expect(matchGlob('**/*.ts', 'src/utils/file.ts')).toBe(true);
  });

  it('matches exact path', () => {
    expect(matchGlob('test.ts', 'test.ts')).toBe(true);
    expect(matchGlob('test.ts', 'other.ts')).toBe(false);
  });

  it('matches question mark', () => {
    expect(matchGlob('?.ts', 'a.ts')).toBe(true);
    expect(matchGlob('?.ts', 'ab.ts')).toBe(false);
  });
});
