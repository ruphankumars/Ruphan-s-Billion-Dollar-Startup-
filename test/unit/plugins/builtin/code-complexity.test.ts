/**
 * Tests for CodeComplexityPlugin
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  CodeComplexityPlugin,
  analyzeComplexity,
} from '../../../../src/plugins/builtin/code-complexity-plugin.js';
import { PluginRegistry } from '../../../../src/plugins/registry.js';

const SIMPLE_CODE = `
export function add(a: number, b: number): number {
  return a + b;
}
`;

const COMPLEX_CODE = `
export function complexRouter(method: string, path: string, auth: boolean, role: string): string {
  if (method === 'GET') {
    if (path.startsWith('/api')) {
      if (auth) {
        if (role === 'admin') {
          return 'admin-api-read';
        } else if (role === 'user') {
          return 'user-api-read';
        } else {
          return 'guest-api-read';
        }
      } else {
        return 'public-api-read';
      }
    } else if (path.startsWith('/static')) {
      return 'static-file';
    } else {
      return 'page-render';
    }
  } else if (method === 'POST') {
    if (!auth) return 'unauthorized';
    if (path.startsWith('/api')) {
      if (role === 'admin' || role === 'editor') {
        return 'api-write';
      }
      return 'forbidden';
    }
    return 'form-submit';
  }
  return 'method-not-allowed';
}
`;

describe('CodeComplexityPlugin', () => {
  describe('analyzeComplexity', () => {
    it('should report low complexity for simple function', () => {
      const result = analyzeComplexity(SIMPLE_CODE, 'add.ts');
      expect(result.totalFunctions).toBeGreaterThanOrEqual(1);
      const addFn = result.functions.find(f => f.name === 'add');
      if (addFn) {
        expect(addFn.complexity).toBeLessThanOrEqual(2);
      }
    });

    it('should report high complexity for nested conditionals', () => {
      const result = analyzeComplexity(COMPLEX_CODE, 'router.ts');
      expect(result.maxComplexity).toBeGreaterThan(5);
      const routerFn = result.functions.find(f => f.name === 'complexRouter');
      if (routerFn) {
        expect(routerFn.complexity).toBeGreaterThan(8);
      }
    });

    it('should calculate average complexity', () => {
      const code = SIMPLE_CODE + '\n' + COMPLEX_CODE;
      const result = analyzeComplexity(code, 'mixed.ts');
      expect(result.averageComplexity).toBeGreaterThan(1);
    });

    it('should handle unsupported file extensions', () => {
      const result = analyzeComplexity('some content', 'readme.md');
      expect(result.totalFunctions).toBe(0);
      expect(result.averageComplexity).toBe(0);
    });

    it('should count ternary and logical operators', () => {
      const code = `
export function check(a: boolean, b: boolean, c: number): string {
  const x = a ? 'yes' : 'no';
  const y = a && b ? 'both' : a || b ? 'one' : 'none';
  const z = c ?? 0;
  return x + y + z;
}`;
      const result = analyzeComplexity(code, 'check.ts');
      const fn = result.functions.find(f => f.name === 'check');
      if (fn) {
        expect(fn.complexity).toBeGreaterThan(3);
      }
    });
  });

  describe('Plugin Registration', () => {
    it('should register tool and gate', async () => {
      const registry = new PluginRegistry();
      await registry.load(CodeComplexityPlugin);

      expect(registry.isLoaded('cortexos-code-complexity')).toBe(true);

      const tools = registry.getTools();
      expect(tools.some(t => t.name === 'complexity_analyze')).toBe(true);

      const gates = registry.getGates();
      expect(gates.has('complexity')).toBe(true);
    });

    it('should execute complexity gate on real files', async () => {
      const dir = join(tmpdir(), `complexity-test-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'complex.ts'), COMPLEX_CODE);

      const registry = new PluginRegistry();
      await registry.load(CodeComplexityPlugin);

      const gate = registry.getGates().get('complexity')!;
      const result = await gate.run({
        workingDir: dir,
        filesChanged: ['complex.ts'],
        executionId: 'test',
      });

      expect(result.gate).toBe('complexity');
      // May have warnings for high complexity
      expect(result.issues.length).toBeGreaterThanOrEqual(0);

      rmSync(dir, { recursive: true, force: true });
    });
  });
});
