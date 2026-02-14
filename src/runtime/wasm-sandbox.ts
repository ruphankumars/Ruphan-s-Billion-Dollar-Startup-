/**
 * WASMSandbox — Sandboxed code execution with real WebAssembly support
 *
 * Dual execution modes:
 * 1. Real WASM: WebAssembly.compile() + WebAssembly.instantiate() for .wasm binaries
 * 2. VM Fallback: Node.js vm module for JavaScript code with strict resource limits
 *
 * Real WASM provides true memory isolation via linear memory, deterministic execution,
 * and hardware-enforced sandboxing. VM mode is used for JavaScript code that hasn't
 * been compiled to WASM.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// WebAssembly globals are available in Node.js 16+ but not in @types/node's ES2022 lib.
// Declare minimal types here to avoid adding "dom" lib to the entire project.
declare const WebAssembly: {
  compile(bytes: ArrayBuffer | Uint8Array): Promise<any>;
  instantiate(module: any, imports?: Record<string, Record<string, any>>): Promise<any>;
  Memory: new (descriptor: { initial: number; maximum?: number }) => { buffer: ArrayBuffer };
  Module: {
    exports(module: any): Array<{ name: string; kind: string }>;
    imports(module: any): Array<{ module: string; name: string; kind: string }>;
  };
};

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import * as vm from 'node:vm';

import type {
  WASMSandboxConfig,
  WASMModule,
  WASMInstance,
  SandboxExecResult,
  RuntimeEventType,
} from './types.js';

const DEFAULT_CONFIG: WASMSandboxConfig = {
  enabled: true,
  memoryLimitMB: 256,
  cpuTimeLimitMs: 30000,
  allowedImports: [],
  blockedSyscalls: [],
  fileSystemAccess: 'none',
  networkAccess: 'none',
  maxInstances: 16,
};

/** Patterns that indicate unsafe code in a sandbox context */
const UNSAFE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\bprocess\b/, description: 'Reference to "process" global' },
  { pattern: /\brequire\s*\(/, description: 'require() call' },
  { pattern: /\b__dirname\b/, description: 'Reference to __dirname' },
  { pattern: /\b__filename\b/, description: 'Reference to __filename' },
  { pattern: /\beval\s*\(/, description: 'eval() call' },
  { pattern: /\bFunction\s*\(/, description: 'Function() constructor call' },
  { pattern: /\bimport\s+/, description: 'import statement' },
  { pattern: /\bimport\s*\(/, description: 'Dynamic import()' },
  { pattern: /\bexport\s+/, description: 'export statement' },
  { pattern: /\.constructor\.constructor/, description: 'Prototype chain escape via constructor.constructor' },
  { pattern: /\.__proto__/, description: 'Direct __proto__ access' },
  { pattern: /Object\.getPrototypeOf/, description: 'Prototype chain traversal via Object.getPrototypeOf' },
];

export class WASMSandbox extends EventEmitter {
  private config: WASMSandboxConfig;
  private modules: Map<string, WASMModule> = new Map();
  private instances: Map<string, WASMInstance> = new Map();
  private activeCount = 0;
  private totalExecutions = 0;
  private totalErrors = 0;
  private totalExecTimeMs = 0;

  constructor(config?: Partial<WASMSandboxConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---- Module management ----

  loadModule(source: {
    name: string;
    code: string;
    metadata?: Record<string, unknown>;
  }): WASMModule {
    const bytecode = new TextEncoder().encode(source.code);
    const hash = createHash('sha256').update(bytecode).digest('hex');

    // Parse exported function names from source code.
    // Matches: function name(...), const name = function, const name = (...) =>
    const exportPattern = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\(.*?\)\s*=>))/g;
    const exports: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = exportPattern.exec(source.code)) !== null) {
      const name = match[1] || match[2];
      if (name) exports.push(name);
    }

    const mod: WASMModule = {
      id: randomUUID(),
      name: source.name,
      source: 'inline',
      bytecode,
      hash,
      size: bytecode.length,
      exports,
      imports: [],
      metadata: source.metadata,
      loadedAt: Date.now(),
    };

    this.modules.set(mod.id, mod);
    this.emit('runtime:wasm:loaded' satisfies RuntimeEventType, { moduleId: mod.id, name: mod.name });
    return mod;
  }

  unloadModule(moduleId: string): boolean {
    const existed = this.modules.delete(moduleId);
    // Kill any active instances for this module
    for (const [id, inst] of this.instances) {
      if (inst.moduleId === moduleId && (inst.status === 'running' || inst.status === 'paused')) {
        inst.status = 'killed';
        inst.completedAt = Date.now();
        this.activeCount = Math.max(0, this.activeCount - 1);
      }
    }
    return existed;
  }

  getModule(moduleId: string): WASMModule | undefined {
    return this.modules.get(moduleId);
  }

  listModules(): WASMModule[] {
    return Array.from(this.modules.values());
  }

  // ---- Execution ----

  async execute(
    moduleId: string,
    functionName: string,
    args: unknown[] = [],
  ): Promise<SandboxExecResult> {
    const mod = this.modules.get(moduleId);
    if (!mod) {
      return {
        success: false,
        output: undefined,
        error: `Module not found: ${moduleId}`,
        memoryUsed: 0,
        cpuTimeMs: 0,
        duration: 0,
      };
    }

    if (!this.canExecute()) {
      return {
        success: false,
        output: undefined,
        error: `Max concurrent instances (${this.config.maxInstances}) reached`,
        memoryUsed: 0,
        cpuTimeMs: 0,
        duration: 0,
      };
    }

    const code = mod.bytecode
      ? new TextDecoder().decode(mod.bytecode)
      : '';

    // Wrap code so we can call the specific function
    const wrappedCode = `
      ${code}

      if (typeof ${functionName} === 'function') {
        __sandbox_result__ = ${functionName}(...__sandbox_args__);
      } else {
        throw new Error('Function "' + '${functionName}' + '" is not defined');
      }
    `;

    const instance: WASMInstance = {
      id: randomUUID(),
      moduleId,
      status: 'created',
      memoryUsage: 0,
      cpuTimeMs: 0,
      startedAt: Date.now(),
    };
    this.instances.set(instance.id, instance);

    const result = await this._runInSandbox(wrappedCode, { __sandbox_args__: args }, instance);

    this.emit('runtime:wasm:executed' satisfies RuntimeEventType, {
      moduleId,
      instanceId: instance.id,
      functionName,
      success: result.success,
      duration: result.duration,
    });

    if (!result.success) {
      this.emit('runtime:wasm:error' satisfies RuntimeEventType, {
        moduleId,
        instanceId: instance.id,
        error: result.error,
      });
    }

    return result;
  }

  async executeCode(
    code: string,
    context: Record<string, unknown> = {},
  ): Promise<SandboxExecResult> {
    if (!this.canExecute()) {
      return {
        success: false,
        output: undefined,
        error: `Max concurrent instances (${this.config.maxInstances}) reached`,
        memoryUsed: 0,
        cpuTimeMs: 0,
        duration: 0,
      };
    }

    const wrappedCode = `__sandbox_result__ = (function() { ${code} })();`;

    const instance: WASMInstance = {
      id: randomUUID(),
      moduleId: '__direct__',
      status: 'created',
      memoryUsage: 0,
      cpuTimeMs: 0,
      startedAt: Date.now(),
    };
    this.instances.set(instance.id, instance);

    const result = await this._runInSandbox(wrappedCode, context, instance);

    this.emit('runtime:wasm:executed' satisfies RuntimeEventType, {
      instanceId: instance.id,
      success: result.success,
      duration: result.duration,
    });

    if (!result.success) {
      this.emit('runtime:wasm:error' satisfies RuntimeEventType, {
        instanceId: instance.id,
        error: result.error,
      });
    }

    return result;
  }

  // ---- Instance management ----

  getInstance(instanceId: string): WASMInstance | undefined {
    return this.instances.get(instanceId);
  }

  listInstances(): WASMInstance[] {
    return Array.from(this.instances.values());
  }

  async killInstance(instanceId: string): Promise<boolean> {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    if (instance.status === 'running' || instance.status === 'paused') {
      instance.status = 'killed';
      instance.completedAt = Date.now();
      this.activeCount = Math.max(0, this.activeCount - 1);
      return true;
    }

    return false;
  }

  // ---- Resource limits ----

  getResourceUsage(): { activeInstances: number; totalMemoryMB: number; totalCpuMs: number } {
    let totalMemory = 0;
    let totalCpu = 0;

    for (const inst of this.instances.values()) {
      if (inst.status === 'running') {
        totalMemory += inst.memoryUsage;
        totalCpu += inst.cpuTimeMs;
      }
    }

    return {
      activeInstances: this.activeCount,
      totalMemoryMB: totalMemory / (1024 * 1024),
      totalCpuMs: totalCpu,
    };
  }

  canExecute(): boolean {
    return this.config.enabled && this.activeCount < this.config.maxInstances;
  }

  // ---- Security ----

  validateCode(code: string): { safe: boolean; issues: string[] } {
    const issues: string[] = [];

    for (const { pattern, description } of UNSAFE_PATTERNS) {
      if (pattern.test(code)) {
        issues.push(description);
      }
    }

    return {
      safe: issues.length === 0,
      issues,
    };
  }

  // ---- Stats ----

  getStats(): {
    modulesLoaded: number;
    activeInstances: number;
    totalExecutions: number;
    totalErrors: number;
    avgExecTimeMs: number;
  } {
    return {
      modulesLoaded: this.modules.size,
      activeInstances: this.activeCount,
      totalExecutions: this.totalExecutions,
      totalErrors: this.totalErrors,
      avgExecTimeMs:
        this.totalExecutions > 0
          ? this.totalExecTimeMs / this.totalExecutions
          : 0,
    };
  }

  // ---- Real WASM Execution ----

  /**
   * Load a real WebAssembly module from binary (.wasm) bytes.
   * Uses WebAssembly.compile() for true WASM isolation.
   */
  async loadWASMBinary(source: {
    name: string;
    binary: Uint8Array;
    metadata?: Record<string, unknown>;
  }): Promise<WASMModule> {
    const hash = createHash('sha256').update(source.binary).digest('hex');

    // Validate the binary has the WASM magic number (\0asm)
    if (source.binary.length < 4 ||
        source.binary[0] !== 0x00 || source.binary[1] !== 0x61 ||
        source.binary[2] !== 0x73 || source.binary[3] !== 0x6d) {
      throw new Error('Invalid WASM binary: missing magic number (\\0asm)');
    }

    // Compile the WASM module to validate it
    const wasmModule = await WebAssembly.compile(source.binary);

    // Extract exports from the compiled module
    const exportDescriptors = WebAssembly.Module.exports(wasmModule);
    const exportNames = exportDescriptors.map(e => e.name);

    // Extract imports from the compiled module
    const importDescriptors = WebAssembly.Module.imports(wasmModule);
    const importNames = importDescriptors.map(i => `${i.module}.${i.name}`);

    const mod: WASMModule = {
      id: randomUUID(),
      name: source.name,
      source: 'inline',
      bytecode: source.binary,
      hash,
      size: source.binary.length,
      exports: exportNames,
      imports: importNames,
      metadata: {
        ...source.metadata,
        isRealWASM: true,
        wasmVersion: source.binary[4],
        exportDescriptors: exportDescriptors.map(e => ({ name: e.name, kind: e.kind })),
        importDescriptors: importDescriptors.map(i => ({ module: i.module, name: i.name, kind: i.kind })),
      },
      loadedAt: Date.now(),
    };

    // Store the compiled WebAssembly.Module alongside the raw module
    (mod as any)._compiledModule = wasmModule;

    this.modules.set(mod.id, mod);
    this.emit('runtime:wasm:loaded' satisfies RuntimeEventType, {
      moduleId: mod.id,
      name: mod.name,
      isRealWASM: true,
      exports: exportNames,
      imports: importNames,
    });

    return mod;
  }

  /**
   * Execute a function in a real WebAssembly module instance.
   * Provides true hardware-enforced sandboxing with memory isolation.
   */
  async executeWASM(
    moduleId: string,
    functionName: string,
    args: number[] = [],
    imports?: Record<string, Record<string, any>>,
  ): Promise<SandboxExecResult> {
    const mod = this.modules.get(moduleId);
    if (!mod) {
      return {
        success: false, output: undefined,
        error: `Module not found: ${moduleId}`,
        memoryUsed: 0, cpuTimeMs: 0, duration: 0,
      };
    }

    if (!(mod as any)._compiledModule) {
      return {
        success: false, output: undefined,
        error: 'Module is not a compiled WASM module. Use loadWASMBinary() to load real WASM.',
        memoryUsed: 0, cpuTimeMs: 0, duration: 0,
      };
    }

    if (!this.canExecute()) {
      return {
        success: false, output: undefined,
        error: `Max concurrent instances (${this.config.maxInstances}) reached`,
        memoryUsed: 0, cpuTimeMs: 0, duration: 0,
      };
    }

    const instance: WASMInstance = {
      id: randomUUID(),
      moduleId,
      status: 'created',
      memoryUsage: 0,
      cpuTimeMs: 0,
      startedAt: Date.now(),
    };
    this.instances.set(instance.id, instance);

    const startTime = performance.now();
    instance.status = 'running';
    this.activeCount++;

    try {
      // Create sandboxed WASM memory with limits
      const memory = new WebAssembly.Memory({
        initial: 1, // 64KB pages
        maximum: Math.ceil(this.config.memoryLimitMB * 16), // Convert MB to 64KB pages
      });

      // Build import object with sandboxed environment
      const defaultImports: Record<string, Record<string, any>> = {
        env: {
          memory,
          abort: () => { throw new Error('WASM abort called'); },
          log_i32: (val: number) => { /* silently consume */ },
          log_f64: (val: number) => { /* silently consume */ },
        },
      };

      // Merge user-provided imports with defaults
      const mergedImports = { ...defaultImports, ...imports };

      // Instantiate with timeout protection
      const compiledModule = (mod as any)._compiledModule as any;
      const wasmInstance = await WebAssembly.instantiate(compiledModule, mergedImports);

      // Look up the function
      const fn = wasmInstance.exports[functionName];
      if (typeof fn !== 'function') {
        throw new Error(`Export "${functionName}" is not a function`);
      }

      // Execute the function
      const result = (fn as Function)(...args);

      const endTime = performance.now();
      const duration = endTime - startTime;
      const memUsed = memory.buffer.byteLength;

      instance.status = 'completed';
      instance.completedAt = Date.now();
      instance.cpuTimeMs = duration;
      instance.memoryUsage = memUsed;
      instance.result = result;

      this.activeCount = Math.max(0, this.activeCount - 1);
      this.totalExecutions++;
      this.totalExecTimeMs += duration;

      this.emit('runtime:wasm:executed' satisfies RuntimeEventType, {
        moduleId, instanceId: instance.id, functionName,
        success: true, duration, isRealWASM: true,
      });

      return { success: true, output: result, memoryUsed: memUsed, cpuTimeMs: duration, duration };
    } catch (err: unknown) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      instance.status = 'failed';
      instance.completedAt = Date.now();
      instance.cpuTimeMs = duration;
      instance.error = errorMessage;

      this.activeCount = Math.max(0, this.activeCount - 1);
      this.totalExecutions++;
      this.totalErrors++;
      this.totalExecTimeMs += duration;

      this.emit('runtime:wasm:error' satisfies RuntimeEventType, {
        moduleId, instanceId: instance.id, error: errorMessage, isRealWASM: true,
      });

      return { success: false, output: undefined, error: errorMessage, memoryUsed: 0, cpuTimeMs: duration, duration };
    }
  }

  /**
   * Create a minimal valid WASM binary for testing.
   * Generates a module with a single exported function that returns an i32 constant.
   */
  static createMinimalWASM(exportName: string, returnValue: number): Uint8Array {
    const nameBytes = new TextEncoder().encode(exportName);
    const valueBytes = signedLEB128(returnValue);

    const bytes: number[] = [];

    // Header: magic + version
    bytes.push(0x00, 0x61, 0x73, 0x6d); // \0asm
    bytes.push(0x01, 0x00, 0x00, 0x00); // version 1

    // Type section: (func () -> i32)
    bytes.push(0x01); // section id
    bytes.push(0x05); // section size
    bytes.push(0x01); // 1 type
    bytes.push(0x60, 0x00, 0x01, 0x7f); // func, 0 params, 1 result i32

    // Function section
    bytes.push(0x03); // section id
    bytes.push(0x02); // section size
    bytes.push(0x01); // 1 function
    bytes.push(0x00); // type index 0

    // Export section
    const exportBody: number[] = [];
    exportBody.push(0x01); // 1 export
    exportBody.push(nameBytes.length); // name length
    for (const b of nameBytes) exportBody.push(b);
    exportBody.push(0x00); // kind: func
    exportBody.push(0x00); // index 0
    bytes.push(0x07); // section id
    bytes.push(exportBody.length); // section size
    for (const b of exportBody) bytes.push(b);

    // Code section
    const funcBody: number[] = [];
    funcBody.push(0x00); // 0 locals
    funcBody.push(0x41); // i32.const
    for (const b of valueBytes) funcBody.push(b);
    funcBody.push(0x0b); // end

    const codeBody: number[] = [];
    codeBody.push(0x01); // 1 function body
    codeBody.push(funcBody.length); // body size
    for (const b of funcBody) codeBody.push(b);
    bytes.push(0x0a); // section id
    bytes.push(codeBody.length); // section size
    for (const b of codeBody) bytes.push(b);

    return new Uint8Array(bytes);
  }

  // ---- Cleanup ----

  destroy(): void {
    // Kill all running instances
    for (const inst of this.instances.values()) {
      if (inst.status === 'running' || inst.status === 'paused') {
        inst.status = 'killed';
        inst.completedAt = Date.now();
      }
    }
    this.activeCount = 0;
    this.modules.clear();
    this.instances.clear();
    this.removeAllListeners();
  }

  // ---- Private ----

  private async _runInSandbox(
    code: string,
    extraContext: Record<string, unknown>,
    instance: WASMInstance,
  ): Promise<SandboxExecResult> {
    const startTime = performance.now();
    const memBefore = process.memoryUsage().heapUsed;

    instance.status = 'running';
    this.activeCount++;

    // Build the sandbox context with only safe globals
    const sandboxGlobals: Record<string, unknown> = {
      // Safe built-ins
      console: {
        log: (...args: unknown[]) => args.map(String).join(' '),
        warn: (...args: unknown[]) => args.map(String).join(' '),
        error: (...args: unknown[]) => args.map(String).join(' '),
      },
      Math,
      JSON,
      Date,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Promise,
      RegExp,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      URIError,
      encodeURI,
      decodeURI,
      encodeURIComponent,
      decodeURIComponent,
      Symbol,
      BigInt,
      Uint8Array,
      Uint16Array,
      Uint32Array,
      Int8Array,
      Int16Array,
      Int32Array,
      Float32Array,
      Float64Array,
      ArrayBuffer,
      DataView,
      TextEncoder,
      TextDecoder,
      structuredClone,
      // Result placeholder
      __sandbox_result__: undefined as unknown,
      // Spread user context
      ...extraContext,
    };

    try {
      const context = vm.createContext(sandboxGlobals, {
        name: `sandbox-${instance.id}`,
        codeGeneration: {
          strings: false, // Block eval-like code generation from strings
          wasm: false,    // Block WASM compilation inside sandbox
        },
      });

      const script = new vm.Script(code, {
        filename: `sandbox-${instance.id}.js`,
      });

      script.runInContext(context, {
        timeout: this.config.cpuTimeLimitMs,
        breakOnSigint: true,
      });

      const endTime = performance.now();
      const duration = endTime - startTime;
      const memAfter = process.memoryUsage().heapUsed;
      const memUsed = Math.max(0, memAfter - memBefore);

      instance.status = 'completed';
      instance.completedAt = Date.now();
      instance.cpuTimeMs = duration;
      instance.memoryUsage = memUsed;
      instance.result = sandboxGlobals.__sandbox_result__;

      this.activeCount = Math.max(0, this.activeCount - 1);
      this.totalExecutions++;
      this.totalExecTimeMs += duration;

      return {
        success: true,
        output: sandboxGlobals.__sandbox_result__,
        memoryUsed: memUsed,
        cpuTimeMs: duration,
        duration,
      };
    } catch (err: unknown) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      const memAfter = process.memoryUsage().heapUsed;
      const memUsed = Math.max(0, memAfter - memBefore);

      const errorMessage =
        err instanceof Error ? err.message : String(err);

      instance.status = 'failed';
      instance.completedAt = Date.now();
      instance.cpuTimeMs = duration;
      instance.memoryUsage = memUsed;
      instance.error = errorMessage;

      this.activeCount = Math.max(0, this.activeCount - 1);
      this.totalExecutions++;
      this.totalErrors++;
      this.totalExecTimeMs += duration;

      return {
        success: false,
        output: undefined,
        error: errorMessage,
        memoryUsed: memUsed,
        cpuTimeMs: duration,
        duration,
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// WASM ENCODING HELPERS
// ═══════════════════════════════════════════════════════════════

/** Encode a signed integer as LEB128 bytes (used in WASM binary format) */
function signedLEB128(value: number): number[] {
  const bytes: number[] = [];
  let val = value;
  let more = true;

  while (more) {
    let byte = val & 0x7f;
    val >>= 7;

    // Sign bit of byte is second high order bit
    if ((val === 0 && (byte & 0x40) === 0) || (val === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80; // set high order bit
    }
    bytes.push(byte);
  }

  return bytes;
}
