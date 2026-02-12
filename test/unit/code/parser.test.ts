import { describe, it, expect } from 'vitest';
import { CodeParser } from '../../../src/code/parser.js';

describe('CodeParser', () => {
  const parser = new CodeParser();

  const sampleTS = `
import { EventEmitter } from 'events';
import type { Config } from './types.js';

export class MyService extends EventEmitter {
  private name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  async run(): Promise<void> {
    if (this.name) {
      for (const item of [1, 2, 3]) {
        console.log(item);
      }
    }
  }
}

export function createService(name: string): MyService {
  return new MyService(name);
}

const DEFAULT_NAME = 'default';
`.trim();

  it('should extract symbols from source code', () => {
    const result = parser.parseContent(sampleTS, 'service.ts');
    expect(result.symbols.length).toBeGreaterThan(0);
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('MyService');
    expect(names).toContain('createService');
  });

  it('should extract imports', () => {
    const result = parser.parseContent(sampleTS, 'service.ts');
    expect(result.imports.length).toBe(2);

    const eventsImport = result.imports.find(i => i.source === 'events');
    expect(eventsImport).toBeDefined();
    expect(eventsImport!.specifiers).toContain('EventEmitter');

    const typeImport = result.imports.find(i => i.source === './types.js');
    expect(typeImport).toBeDefined();
  });

  it('should extract exports', () => {
    const result = parser.parseContent(sampleTS, 'service.ts');
    expect(result.exports).toContain('MyService');
    expect(result.exports).toContain('createService');
  });

  it('should count lines of code', () => {
    const result = parser.parseContent(sampleTS, 'service.ts');
    expect(result.loc).toBeGreaterThan(10);
  });

  it('should estimate cyclomatic complexity', () => {
    const result = parser.parseContent(sampleTS, 'service.ts');
    // Has if + for = at least 3 complexity points
    expect(result.complexity).toBeGreaterThan(2);
  });

  it('should handle CommonJS require', () => {
    const cjsCode = `const express = require('express');\nconst { Router } = require('express');`;
    const result = parser.parseContent(cjsCode, 'app.js');
    expect(result.imports.length).toBe(2);
    expect(result.imports[0].source).toBe('express');
    expect(result.imports[0].isDefault).toBe(true);
    expect(result.imports[1].specifiers).toContain('Router');
  });

  it('should handle empty source', () => {
    const result = parser.parseContent('', 'empty.ts');
    expect(result.symbols.length).toBe(0);
    expect(result.imports.length).toBe(0);
    expect(result.exports.length).toBe(0);
    expect(result.loc).toBe(0);
  });

  it('should handle default and re-exports', () => {
    const code = `export default class App {}\nexport { foo, bar as baz } from './utils.js';`;
    const result = parser.parseContent(code, 'app.ts');
    expect(result.exports).toContain('default');
    expect(result.exports).toContain('baz');
  });
});
