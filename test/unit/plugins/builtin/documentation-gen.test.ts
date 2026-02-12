/**
 * Tests for DocumentationGenPlugin
 */

import { describe, it, expect } from 'vitest';
import {
  DocumentationGenPlugin,
  analyzeDocCoverage,
  generateDocs,
} from '../../../../src/plugins/builtin/documentation-gen-plugin.js';
import { PluginRegistry } from '../../../../src/plugins/registry.js';

const WELL_DOCUMENTED_CODE = `
/**
 * Calculate the sum of two numbers.
 * @param a - First number
 * @param b - Second number
 * @returns The sum of a and b
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * Represents a user in the system.
 */
export class User {
  constructor(public name: string) {}
}

/**
 * User configuration options.
 */
export interface UserConfig {
  name: string;
  age: number;
}
`;

const POORLY_DOCUMENTED_CODE = `
export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero');
  return a / b;
}

export class Calculator {
  private history: number[] = [];

  add(a: number, b: number): number {
    const result = a + b;
    this.history.push(result);
    return result;
  }
}

export type Operation = 'add' | 'subtract' | 'multiply' | 'divide';

export const PI = 3.14159;
`;

describe('DocumentationGenPlugin', () => {
  describe('analyzeDocCoverage', () => {
    it('should report 100% for well-documented code', () => {
      const coverage = analyzeDocCoverage(WELL_DOCUMENTED_CODE, 'documented.ts');

      expect(coverage.exportedCount).toBe(3); // function, class, interface
      expect(coverage.documentedCount).toBe(3);
      expect(coverage.coveragePercent).toBe(100);
    });

    it('should report low coverage for undocumented code', () => {
      const coverage = analyzeDocCoverage(POORLY_DOCUMENTED_CODE, 'undocumented.ts');

      expect(coverage.exportedCount).toBeGreaterThan(0);
      expect(coverage.documentedCount).toBe(0);
      expect(coverage.coveragePercent).toBe(0);
    });

    it('should handle non-TypeScript files', () => {
      const coverage = analyzeDocCoverage('# README', 'README.md');
      expect(coverage.coveragePercent).toBe(100); // No exports to document
    });

    it('should detect exported vs non-exported symbols', () => {
      const code = `
export function publicFn(): void {}
function privateFn(): void {}
export class PublicClass {}
class PrivateClass {}
`;
      const coverage = analyzeDocCoverage(code, 'mixed.ts');
      expect(coverage.exportedCount).toBe(2); // publicFn, PublicClass
    });

    it('should extract doc comments', () => {
      const coverage = analyzeDocCoverage(WELL_DOCUMENTED_CODE, 'doc.ts');
      const addEntry = coverage.entries.find(e => e.name === 'add');

      expect(addEntry).toBeDefined();
      expect(addEntry!.documented).toBe(true);
      expect(addEntry!.docComment).toContain('Calculate the sum');
    });
  });

  describe('generateDocs', () => {
    it('should generate markdown with module header', () => {
      const docs = generateDocs(WELL_DOCUMENTED_CODE, 'math-utils.ts');

      expect(docs).toContain('# `math-utils`');
      expect(docs).toContain('Source: `math-utils.ts`');
    });

    it('should include function documentation', () => {
      const docs = generateDocs(WELL_DOCUMENTED_CODE, 'math.ts');

      expect(docs).toContain('`add`');
      expect(docs).toContain('Calculate the sum');
    });

    it('should include class documentation', () => {
      const docs = generateDocs(WELL_DOCUMENTED_CODE, 'user.ts');

      expect(docs).toContain('`User`');
    });

    it('should show undocumented note for missing docs', () => {
      const docs = generateDocs(POORLY_DOCUMENTED_CODE, 'calc.ts');

      expect(docs).toContain('No documentation available');
    });

    it('should show coverage percentage', () => {
      const docs = generateDocs(WELL_DOCUMENTED_CODE, 'test.ts');
      expect(docs).toContain('100%');
    });

    it('should include parameter information', () => {
      const docs = generateDocs(WELL_DOCUMENTED_CODE, 'test.ts');
      expect(docs).toContain('Parameters');
    });
  });

  describe('Plugin Registration', () => {
    it('should register tools, gate, and role', async () => {
      const registry = new PluginRegistry();
      await registry.load(DocumentationGenPlugin);

      expect(registry.isLoaded('cortexos-documentation-gen')).toBe(true);

      const tools = registry.getTools();
      expect(tools.some(t => t.name === 'docs_generate')).toBe(true);
      expect(tools.some(t => t.name === 'docs_coverage')).toBe(true);

      const gates = registry.getGates();
      expect(gates.has('documentation-coverage')).toBe(true);

      const roles = registry.getRoles();
      expect(roles.has('documentation-writer')).toBe(true);
    });

    it('should have documentation-writer role with correct config', async () => {
      const registry = new PluginRegistry();
      await registry.load(DocumentationGenPlugin);

      const role = registry.getRoles().get('documentation-writer')!;
      expect(role.systemPrompt).toContain('documentation writer');
      expect(role.defaultTools).toContain('docs_generate');
      expect(role.defaultTools).toContain('docs_coverage');
    });
  });
});
