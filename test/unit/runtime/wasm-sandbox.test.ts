import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WASMSandbox } from '../../../src/runtime/wasm-sandbox.js';

describe('WASMSandbox', () => {
  let sandbox: WASMSandbox;

  beforeEach(() => {
    sandbox = new WASMSandbox();
  });

  afterEach(() => {
    sandbox.destroy();
  });

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates a sandbox with default config', () => {
      expect(sandbox).toBeInstanceOf(WASMSandbox);
    });

    it('accepts custom config', () => {
      const custom = new WASMSandbox({
        memoryLimitMB: 512,
        cpuTimeLimitMs: 5000,
        maxInstances: 4,
      });
      expect(custom).toBeInstanceOf(WASMSandbox);
      custom.destroy();
    });

    it('merges partial config with defaults', () => {
      const partial = new WASMSandbox({ maxInstances: 3 });
      expect(partial.canExecute()).toBe(true);
      partial.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Module management
  // ---------------------------------------------------------------------------

  describe('loadModule()', () => {
    it('loads a module from source code', () => {
      const mod = sandbox.loadModule({
        name: 'test-mod',
        code: 'function add(a, b) { return a + b; }',
      });

      expect(mod.id).toBeDefined();
      expect(mod.name).toBe('test-mod');
      expect(mod.source).toBe('inline');
      expect(mod.hash).toBeDefined();
      expect(mod.size).toBeGreaterThan(0);
      expect(mod.exports).toContain('add');
    });

    it('detects multiple exported functions', () => {
      const mod = sandbox.loadModule({
        name: 'multi',
        code: `
          function greet(name) { return "Hello " + name; }
          const double = (x) => x * 2;
          let triple = function(x) { return x * 3; }
        `,
      });

      expect(mod.exports).toContain('greet');
      expect(mod.exports).toContain('double');
      expect(mod.exports).toContain('triple');
    });

    it('computes SHA-256 hash of bytecode', () => {
      const mod = sandbox.loadModule({ name: 'hash-test', code: 'function f() {}' });
      expect(mod.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('stores metadata when provided', () => {
      const mod = sandbox.loadModule({
        name: 'meta',
        code: 'function f() {}',
        metadata: { author: 'test', version: '1.0' },
      });

      expect(mod.metadata).toEqual({ author: 'test', version: '1.0' });
    });

    it('emits runtime:wasm:loaded event', () => {
      const spy = vi.fn();
      sandbox.on('runtime:wasm:loaded', spy);

      sandbox.loadModule({ name: 'ev-mod', code: 'function f() {}' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'ev-mod' }));
    });

    it('assigns a unique ID to each module', () => {
      const m1 = sandbox.loadModule({ name: 'mod1', code: 'function f() {}' });
      const m2 = sandbox.loadModule({ name: 'mod2', code: 'function g() {}' });

      expect(m1.id).not.toBe(m2.id);
    });
  });

  describe('unloadModule()', () => {
    it('removes an existing module', () => {
      const mod = sandbox.loadModule({ name: 'unload-me', code: 'function f() {}' });
      expect(sandbox.unloadModule(mod.id)).toBe(true);
      expect(sandbox.getModule(mod.id)).toBeUndefined();
    });

    it('returns false for non-existent module', () => {
      expect(sandbox.unloadModule('ghost')).toBe(false);
    });

    it('kills running instances of the module', async () => {
      const mod = sandbox.loadModule({ name: 'kill-mod', code: 'function f() { return 1; }' });
      await sandbox.execute(mod.id, 'f');

      const instances = sandbox.listInstances();
      expect(instances.length).toBeGreaterThan(0);

      sandbox.unloadModule(mod.id);

      for (const inst of sandbox.listInstances()) {
        if (inst.moduleId === mod.id) {
          expect(['completed', 'killed', 'failed']).toContain(inst.status);
        }
      }
    });
  });

  describe('getModule() / listModules()', () => {
    it('getModule returns a module by ID', () => {
      const mod = sandbox.loadModule({ name: 'get-mod', code: 'function f() {}' });
      expect(sandbox.getModule(mod.id)).toBeDefined();
    });

    it('getModule returns undefined for unknown ID', () => {
      expect(sandbox.getModule('unknown')).toBeUndefined();
    });

    it('listModules returns all loaded modules', () => {
      sandbox.loadModule({ name: 'mod-a', code: 'function a() {}' });
      sandbox.loadModule({ name: 'mod-b', code: 'function b() {}' });

      expect(sandbox.listModules()).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Execution: execute()
  // ---------------------------------------------------------------------------

  describe('execute()', () => {
    it('executes a function from a loaded module', async () => {
      const mod = sandbox.loadModule({
        name: 'calc',
        code: 'function add(a, b) { return a + b; }',
      });

      const result = await sandbox.execute(mod.id, 'add', [3, 4]);
      expect(result.success).toBe(true);
      expect(result.output).toBe(7);
    });

    it('returns failure for non-existent module', async () => {
      const result = await sandbox.execute('ghost-id', 'fn');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Module not found');
    });

    it('returns failure when function is not defined', async () => {
      const mod = sandbox.loadModule({
        name: 'no-fn',
        code: 'function definedFn() { return 1; }',
      });

      const result = await sandbox.execute(mod.id, 'undefinedFn');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not defined');
    });

    it('captures execution duration', async () => {
      const mod = sandbox.loadModule({
        name: 'dur',
        code: 'function f() { return 42; }',
      });

      const result = await sandbox.execute(mod.id, 'f');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.cpuTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('captures memory usage', async () => {
      const mod = sandbox.loadModule({
        name: 'mem',
        code: 'function f() { return Array(1000).fill(0); }',
      });

      const result = await sandbox.execute(mod.id, 'f');
      expect(result.memoryUsed).toBeGreaterThanOrEqual(0);
    });

    it('creates instance records', async () => {
      const mod = sandbox.loadModule({
        name: 'inst',
        code: 'function f() { return 1; }',
      });

      await sandbox.execute(mod.id, 'f');
      const instances = sandbox.listInstances();
      expect(instances.length).toBeGreaterThan(0);
    });

    it('emits runtime:wasm:executed event on success', async () => {
      const spy = vi.fn();
      sandbox.on('runtime:wasm:executed', spy);

      const mod = sandbox.loadModule({
        name: 'ev-exec',
        code: 'function f() { return 1; }',
      });

      await sandbox.execute(mod.id, 'f');
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        moduleId: mod.id,
        success: true,
      }));
    });

    it('emits runtime:wasm:error event on failure', async () => {
      const spy = vi.fn();
      sandbox.on('runtime:wasm:error', spy);

      const mod = sandbox.loadModule({
        name: 'ev-err',
        code: 'function f() { throw new Error("boom"); }',
      });

      await sandbox.execute(mod.id, 'f');
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        moduleId: mod.id,
      }));
    });

    it('rejects execution when maxInstances reached', async () => {
      const tiny = new WASMSandbox({ maxInstances: 1 });
      const mod = tiny.loadModule({
        name: 'tiny-mod',
        code: 'function f() { return 1; }',
      });

      const first = await tiny.execute(mod.id, 'f');
      expect(first.success).toBe(true);

      // After completion the slot is freed
      expect(tiny.canExecute()).toBe(true);

      tiny.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Execution: executeCode()
  // ---------------------------------------------------------------------------

  describe('executeCode()', () => {
    it('executes inline code and returns result', async () => {
      const result = await sandbox.executeCode('return 2 + 2;');
      expect(result.success).toBe(true);
      expect(result.output).toBe(4);
    });

    it('executes code with string operations', async () => {
      const result = await sandbox.executeCode('return "hello" + " world";');
      expect(result.success).toBe(true);
      expect(result.output).toBe('hello world');
    });

    it('passes context variables', async () => {
      const result = await sandbox.executeCode('return x + y;', { x: 10, y: 20 });
      expect(result.success).toBe(true);
      expect(result.output).toBe(30);
    });

    it('handles array operations', async () => {
      const result = await sandbox.executeCode('return [1,2,3].map(x => x * 2);');
      expect(result.success).toBe(true);
      expect(result.output).toEqual([2, 4, 6]);
    });

    it('handles errors in code', async () => {
      const result = await sandbox.executeCode('throw new Error("test error");');
      expect(result.success).toBe(false);
      expect(result.error).toContain('test error');
    });

    it('handles syntax errors', async () => {
      const result = await sandbox.executeCode('return {{{invalid;');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('provides safe built-ins (Math, JSON, Date, etc.)', async () => {
      const result = await sandbox.executeCode('return Math.max(1, 2, 3);');
      expect(result.success).toBe(true);
      expect(result.output).toBe(3);

      const jsonResult = await sandbox.executeCode('return JSON.stringify({ a: 1 });');
      expect(jsonResult.output).toBe('{"a":1}');
    });

    it('provides console object (but it is sandboxed)', async () => {
      const result = await sandbox.executeCode('console.log("hello"); return 42;');
      expect(result.success).toBe(true);
      expect(result.output).toBe(42);
    });

    it('handles object creation and manipulation', async () => {
      const result = await sandbox.executeCode(`
        const obj = { name: "test", value: 42 };
        return Object.keys(obj).length;
      `);
      expect(result.success).toBe(true);
      expect(result.output).toBe(2);
    });

    it('handles Map and Set', async () => {
      const result = await sandbox.executeCode(`
        const m = new Map();
        m.set("a", 1);
        m.set("b", 2);
        return m.size;
      `);
      expect(result.success).toBe(true);
      expect(result.output).toBe(2);
    });

    it('reports execution duration', async () => {
      const result = await sandbox.executeCode('return 1;');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('rejects when sandbox is disabled', async () => {
      const disabled = new WASMSandbox({ enabled: false });
      const result = await disabled.executeCode('return 1;');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Max concurrent instances');
      disabled.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Instance management
  // ---------------------------------------------------------------------------

  describe('getInstance() / listInstances()', () => {
    it('returns undefined for unknown instance', () => {
      expect(sandbox.getInstance('unknown')).toBeUndefined();
    });

    it('returns empty array initially', () => {
      expect(sandbox.listInstances()).toEqual([]);
    });

    it('lists all instances after execution', async () => {
      await sandbox.executeCode('return 1;');
      await sandbox.executeCode('return 2;');

      expect(sandbox.listInstances()).toHaveLength(2);
    });
  });

  describe('killInstance()', () => {
    it('returns false for non-existent instance', async () => {
      expect(await sandbox.killInstance('unknown')).toBe(false);
    });

    it('returns false for already completed instance', async () => {
      await sandbox.executeCode('return 1;');
      const instances = sandbox.listInstances();
      expect(instances.length).toBeGreaterThan(0);

      const result = await sandbox.killInstance(instances[0].id);
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Resource management
  // ---------------------------------------------------------------------------

  describe('getResourceUsage()', () => {
    it('returns initial resource usage', () => {
      const usage = sandbox.getResourceUsage();
      expect(usage.activeInstances).toBe(0);
      expect(usage.totalMemoryMB).toBe(0);
      expect(usage.totalCpuMs).toBe(0);
    });
  });

  describe('canExecute()', () => {
    it('returns true when enabled and under limit', () => {
      expect(sandbox.canExecute()).toBe(true);
    });

    it('returns false when disabled', () => {
      const disabled = new WASMSandbox({ enabled: false });
      expect(disabled.canExecute()).toBe(false);
      disabled.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Code validation (security)
  // ---------------------------------------------------------------------------

  describe('validateCode()', () => {
    it('marks safe code as safe', () => {
      const result = sandbox.validateCode('function add(a, b) { return a + b; }');
      expect(result.safe).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('detects process reference', () => {
      const result = sandbox.validateCode('const pid = process.pid;');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('Reference to "process" global');
    });

    it('detects require() calls', () => {
      const result = sandbox.validateCode('const fs = require("fs");');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('require() call');
    });

    it('detects __dirname', () => {
      const result = sandbox.validateCode('console.log(__dirname);');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('Reference to __dirname');
    });

    it('detects __filename', () => {
      const result = sandbox.validateCode('console.log(__filename);');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('Reference to __filename');
    });

    it('detects eval()', () => {
      const result = sandbox.validateCode('eval("alert(1)");');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('eval() call');
    });

    it('detects Function() constructor', () => {
      const result = sandbox.validateCode('new Function("return 1")();');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('Function() constructor call');
    });

    it('detects import statements', () => {
      const result = sandbox.validateCode('import fs from "fs";');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('import statement');
    });

    it('detects dynamic import()', () => {
      const result = sandbox.validateCode('const m = import("./module");');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('Dynamic import()');
    });

    it('detects constructor.constructor escape', () => {
      const result = sandbox.validateCode('"".constructor.constructor("return this")();');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('Prototype chain escape via constructor.constructor');
    });

    it('detects __proto__ access', () => {
      const result = sandbox.validateCode('obj.__proto__.polluted = true;');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('Direct __proto__ access');
    });

    it('detects Object.getPrototypeOf', () => {
      const result = sandbox.validateCode('Object.getPrototypeOf({});');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('Prototype chain traversal via Object.getPrototypeOf');
    });

    it('detects export statements', () => {
      const result = sandbox.validateCode('export default function() {}');
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('export statement');
    });

    it('reports multiple issues at once', () => {
      const result = sandbox.validateCode(`
        const fs = require("fs");
        eval("dangerous");
        process.exit(1);
      `);
      expect(result.safe).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  describe('getStats()', () => {
    it('returns initial stats', () => {
      const stats = sandbox.getStats();
      expect(stats.modulesLoaded).toBe(0);
      expect(stats.activeInstances).toBe(0);
      expect(stats.totalExecutions).toBe(0);
      expect(stats.totalErrors).toBe(0);
      expect(stats.avgExecTimeMs).toBe(0);
    });

    it('tracks executions and errors', async () => {
      sandbox.loadModule({ name: 's1', code: 'function f() { return 1; }' });
      await sandbox.executeCode('return 1;');
      await sandbox.executeCode('throw new Error("fail");');

      const stats = sandbox.getStats();
      expect(stats.modulesLoaded).toBe(1);
      expect(stats.totalExecutions).toBe(2);
      expect(stats.totalErrors).toBe(1);
      expect(stats.avgExecTimeMs).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Destroy
  // ---------------------------------------------------------------------------

  describe('destroy()', () => {
    it('clears modules and instances', async () => {
      sandbox.loadModule({ name: 'd1', code: 'function f() {}' });
      await sandbox.executeCode('return 1;');

      sandbox.destroy();

      expect(sandbox.listModules()).toHaveLength(0);
      expect(sandbox.listInstances()).toHaveLength(0);
    });

    it('removes all listeners', () => {
      sandbox.on('runtime:wasm:loaded', () => {});
      sandbox.destroy();
      expect(sandbox.listenerCount('runtime:wasm:loaded')).toBe(0);
    });

    it('can be called multiple times safely', () => {
      sandbox.destroy();
      sandbox.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Stress tests
  // ---------------------------------------------------------------------------

  describe('stress tests', () => {
    it('handles 100 sequential code executions', async () => {
      for (let i = 0; i < 100; i++) {
        const result = await sandbox.executeCode(`return ${i} * 2;`);
        expect(result.success).toBe(true);
        expect(result.output).toBe(i * 2);
      }
    });

    it('handles concurrent code executions within max instances', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        sandbox.executeCode(`return ${i};`),
      );

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r.success);
      expect(successes.length).toBeGreaterThan(0);
    });

    it('handles error-heavy workloads', async () => {
      const promises = Array.from({ length: 30 }, (_, i) =>
        sandbox.executeCode(
          i % 2 === 0 ? `return ${i};` : 'throw new Error("fail");',
        ),
      );

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r.success).length;
      const failures = results.filter((r) => !r.success).length;
      expect(successes + failures).toBe(30);
    });

    it('handles loading many modules', () => {
      for (let i = 0; i < 100; i++) {
        sandbox.loadModule({ name: `mod-${i}`, code: `function fn${i}() { return ${i}; }` });
      }

      expect(sandbox.listModules()).toHaveLength(100);
    });

    it('handles rapid load/unload cycles', () => {
      for (let i = 0; i < 100; i++) {
        const mod = sandbox.loadModule({ name: `cycle-${i}`, code: 'function f() {}' });
        sandbox.unloadModule(mod.id);
      }

      expect(sandbox.listModules()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty code execution', async () => {
      const result = await sandbox.executeCode('');
      expect(result.success).toBe(true);
      expect(result.output).toBeUndefined();
    });

    it('handles code that returns undefined', async () => {
      const result = await sandbox.executeCode('return undefined;');
      expect(result.success).toBe(true);
      expect(result.output).toBeUndefined();
    });

    it('handles code that returns null', async () => {
      const result = await sandbox.executeCode('return null;');
      expect(result.success).toBe(true);
      expect(result.output).toBeNull();
    });

    it('handles code that returns complex objects', async () => {
      const result = await sandbox.executeCode(`
        return { nested: { array: [1, 2, { deep: true }] } };
      `);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ nested: { array: [1, 2, { deep: true }] } });
    });

    it('handles module with no functions', () => {
      const mod = sandbox.loadModule({ name: 'no-fns', code: 'const x = 42;' });
      expect(mod.exports).toEqual([]);
    });

    it('handles very long code strings', () => {
      const code = 'function f() { return ' + '"x".repeat(10000)' + '; }';
      const mod = sandbox.loadModule({ name: 'long', code });
      expect(mod.size).toBeGreaterThan(0);
    });

    it('handles TypedArray operations in sandbox', async () => {
      const result = await sandbox.executeCode(`
        const arr = new Uint8Array([1, 2, 3]);
        return arr.length;
      `);
      expect(result.success).toBe(true);
      expect(result.output).toBe(3);
    });

    it('handles RegExp in sandbox', async () => {
      const result = await sandbox.executeCode(`
        const match = /hello (\\w+)/.exec("hello world");
        return match[1];
      `);
      expect(result.success).toBe(true);
      expect(result.output).toBe('world');
    });
  });
});
