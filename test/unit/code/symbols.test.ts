import { describe, it, expect } from 'vitest';
import { extractSymbols, extractTSSymbols, extractPythonSymbols } from '../../../src/code/symbols.js';

describe('Symbol Extraction', () => {
  describe('extractTSSymbols', () => {
    it('should extract exported functions', () => {
      const code = `export function greet(name: string): string {\n  return name;\n}`;
      const symbols = extractTSSymbols(code, 'test.ts');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('greet');
      expect(symbols[0].type).toBe('function');
      expect(symbols[0].exported).toBe(true);
    });

    it('should extract non-exported functions', () => {
      const code = `function helper(x: number): number {\n  return x;\n}`;
      const symbols = extractTSSymbols(code, 'test.ts');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('helper');
      expect(symbols[0].exported).toBe(false);
    });

    it('should extract async functions', () => {
      const code = `export async function fetchData(url: string): Promise<any> {\n  return fetch(url);\n}`;
      const symbols = extractTSSymbols(code, 'test.ts');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('fetchData');
      expect(symbols[0].type).toBe('function');
    });

    it('should extract class declarations', () => {
      const code = `export class MyService extends BaseService {\n  run() {}\n}`;
      const symbols = extractTSSymbols(code, 'test.ts');
      const classSymbol = symbols.find(s => s.type === 'class');
      expect(classSymbol).toBeDefined();
      expect(classSymbol!.name).toBe('MyService');
      expect(classSymbol!.exported).toBe(true);
      expect(classSymbol!.signature).toContain('extends BaseService');
    });

    it('should extract interfaces', () => {
      const code = `export interface Config {\n  key: string;\n}`;
      const symbols = extractTSSymbols(code, 'test.ts');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('Config');
      expect(symbols[0].type).toBe('interface');
    });

    it('should extract type aliases', () => {
      const code = `export type Status = 'active' | 'inactive';`;
      const symbols = extractTSSymbols(code, 'test.ts');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('Status');
      expect(symbols[0].type).toBe('type');
    });

    it('should extract enums', () => {
      const code = `export enum Direction {\n  Up,\n  Down,\n}`;
      const symbols = extractTSSymbols(code, 'test.ts');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('Direction');
      expect(symbols[0].type).toBe('enum');
    });

    it('should extract constants', () => {
      const code = `export const MAX_SIZE = 100;`;
      const symbols = extractTSSymbols(code, 'test.ts');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('MAX_SIZE');
      expect(symbols[0].type).toBe('constant');
    });

    it('should extract arrow functions', () => {
      const code = `export const add = (a: number, b: number) => a + b;`;
      const symbols = extractTSSymbols(code, 'test.ts');
      const arrowFunc = symbols.find(s => s.name === 'add');
      expect(arrowFunc).toBeDefined();
      expect(arrowFunc!.type).toBe('function');
    });

    it('should extract methods inside classes', () => {
      const code = `class Foo {\n  async handle(req: Request) {\n    return req;\n  }\n}`;
      const symbols = extractTSSymbols(code, 'test.ts');
      const method = symbols.find(s => s.type === 'method');
      expect(method).toBeDefined();
      expect(method!.name).toBe('handle');
    });
  });

  describe('extractPythonSymbols', () => {
    it('should extract Python functions', () => {
      const code = `def greet(name):\n    return f"Hello {name}"`;
      const symbols = extractPythonSymbols(code);
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('greet');
      expect(symbols[0].type).toBe('function');
    });

    it('should extract Python classes', () => {
      const code = `class MyClass(BaseClass):\n    def __init__(self):\n        pass`;
      const symbols = extractPythonSymbols(code);
      const classSymbol = symbols.find(s => s.type === 'class');
      expect(classSymbol).toBeDefined();
      expect(classSymbol!.name).toBe('MyClass');
    });

    it('should detect private functions with underscore', () => {
      const code = `def _private_helper(x):\n    return x`;
      const symbols = extractPythonSymbols(code);
      expect(symbols[0].exported).toBe(false);
    });

    it('should detect methods (indented defs)', () => {
      const code = `class Foo:\n    def bar(self):\n        pass`;
      const symbols = extractPythonSymbols(code);
      const method = symbols.find(s => s.type === 'method');
      expect(method).toBeDefined();
      expect(method!.name).toBe('bar');
    });
  });

  describe('extractSymbols (auto-detect)', () => {
    it('should auto-detect TypeScript by extension', () => {
      const code = `export function foo(): void {}`;
      const symbols = extractSymbols(code, 'test.ts');
      expect(symbols.length).toBe(1);
    });

    it('should auto-detect Python by extension', () => {
      const code = `def bar(x):\n    return x`;
      const symbols = extractSymbols(code, 'test.py');
      expect(symbols.length).toBe(1);
    });

    it('should default to TS extraction for unknown extensions', () => {
      const code = `export function baz(): void {}`;
      const symbols = extractSymbols(code, 'test.unknown');
      expect(symbols.length).toBe(1);
    });
  });
});
