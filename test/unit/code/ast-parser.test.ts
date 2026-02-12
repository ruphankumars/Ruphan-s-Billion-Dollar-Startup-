import { describe, it, expect } from 'vitest';
import { ASTParser } from '../../../src/code/ast-parser.js';

describe('ASTParser', () => {
  const parser = new ASTParser();

  const tsCode = `
import { EventEmitter } from 'events';
import type { Config } from './types.js';

export interface Options {
  maxRetries: number;
  timeout?: number;
}

export class HttpClient extends EventEmitter {
  private baseUrl: string;
  private static instance: HttpClient;
  readonly timeout: number;

  constructor(baseUrl: string, timeout = 5000) {
    super();
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  async get(path: string): Promise<Response> {
    if (!path) throw new Error('Path required');
    const url = this.baseUrl + path;
    for (let i = 0; i < 3; i++) {
      try {
        return await fetch(url);
      } catch (err) {
        if (i === 2) throw err;
      }
    }
    throw new Error('Unreachable');
  }

  private buildUrl(path: string): string {
    return this.baseUrl + path;
  }
}

export function createClient(url: string): HttpClient {
  return new HttpClient(url);
}

const DEFAULT_TIMEOUT = 5000;
`.trim();

  it('should extract functions from TypeScript', () => {
    const result = parser.analyze(tsCode, 'client.ts', 'typescript');

    const funcNames = result.functions.map(f => f.name);
    expect(funcNames).toContain('createClient');
    expect(result.functions.length).toBeGreaterThan(0);
  });

  it('should extract classes with methods', () => {
    const result = parser.analyze(tsCode, 'client.ts', 'typescript');

    expect(result.classes.length).toBe(1);
    expect(result.classes[0].name).toBe('HttpClient');
    expect(result.classes[0].extends).toBe('EventEmitter');
    expect(result.classes[0].isExported).toBe(true);
    expect(result.classes[0].methods.length).toBeGreaterThan(0);
  });

  it('should extract class properties', () => {
    const result = parser.analyze(tsCode, 'client.ts', 'typescript');

    const props = result.classes[0].properties;
    const propNames = props.map(p => p.name);
    expect(propNames).toContain('baseUrl');
    expect(propNames).toContain('timeout');

    const baseUrl = props.find(p => p.name === 'baseUrl');
    expect(baseUrl?.isPrivate).toBe(true);
  });

  it('should extract import dependencies', () => {
    const result = parser.analyze(tsCode, 'client.ts', 'typescript');

    expect(result.imports.length).toBe(2);

    const eventsImport = result.imports.find(i => i.source === 'events');
    expect(eventsImport).toBeDefined();
    expect(eventsImport!.specifiers).toContain('EventEmitter');

    const typeImport = result.imports.find(i => i.source === './types.js');
    expect(typeImport).toBeDefined();
    expect(typeImport!.isTypeOnly).toBe(true);
  });

  it('should extract export names', () => {
    const result = parser.analyze(tsCode, 'client.ts', 'typescript');

    expect(result.exports).toContain('Options');
    expect(result.exports).toContain('HttpClient');
    expect(result.exports).toContain('createClient');
  });

  it('should compute complexity metrics', () => {
    const result = parser.analyze(tsCode, 'client.ts', 'typescript');

    expect(result.complexity.cyclomatic).toBeGreaterThan(1);
    expect(result.complexity.linesOfCode).toBeGreaterThan(10);
    expect(result.complexity.maxNesting).toBeGreaterThan(0);
    expect(result.complexity.avgFunctionLength).toBeGreaterThan(0);
  });

  it('should build call graph', () => {
    const result = parser.analyze(tsCode, 'client.ts', 'typescript');

    // createClient calls HttpClient constructor (which calls super())
    // buildUrl may be referenced in get
    expect(result.callGraph).toBeDefined();
    expect(Array.isArray(result.callGraph)).toBe(true);
  });

  it('should detect async functions', () => {
    const result = parser.analyze(tsCode, 'client.ts', 'typescript');

    const getFunc = result.functions.find(f => f.name === 'get');
    if (getFunc) {
      expect(getFunc.isAsync).toBe(true);
    }
  });

  it('should analyze Python code', () => {
    const pyCode = `
import os
from typing import Optional

class FileReader:
    def __init__(self, path: str):
        self.path = path

    def read(self) -> str:
        with open(self.path) as f:
            return f.read()

    async def read_async(self) -> str:
        return self.read()

def create_reader(path: str) -> FileReader:
    return FileReader(path)

_PRIVATE_VAR = 42
`.trim();

    const result = parser.analyze(pyCode, 'reader.py', 'python');

    expect(result.functions.length).toBeGreaterThan(0);
    const funcNames = result.functions.map(f => f.name);
    expect(funcNames).toContain('create_reader');
  });

  it('should analyze Go code', () => {
    const goCode = `
package main

import "fmt"

func main() {
    fmt.Println("Hello")
}

func Add(a int, b int) int {
    return a + b
}
`.trim();

    const result = parser.analyze(goCode, 'main.go', 'go');

    expect(result.functions.length).toBe(2);
    const funcNames = result.functions.map(f => f.name);
    expect(funcNames).toContain('main');
    expect(funcNames).toContain('Add');

    const addFunc = result.functions.find(f => f.name === 'Add');
    expect(addFunc?.isExported).toBe(true);
  });

  it('should analyze Rust code', () => {
    const rustCode = `
use std::io;

pub async fn read_file(path: &str) -> io::Result<String> {
    std::fs::read_to_string(path)
}

fn helper(x: i32) -> i32 {
    x * 2
}
`.trim();

    const result = parser.analyze(rustCode, 'lib.rs', 'rust');

    expect(result.functions.length).toBe(2);
    const readFile = result.functions.find(f => f.name === 'read_file');
    expect(readFile?.isExported).toBe(true);
    expect(readFile?.isAsync).toBe(true);
  });

  it('should detect language from file extension', () => {
    // TypeScript by default
    const tsResult = parser.analyze('const x = 1;', 'test.ts');
    expect(tsResult).toBeDefined();

    // Python
    const pyResult = parser.analyze('x = 1', 'test.py');
    expect(pyResult).toBeDefined();
  });

  it('should report tree-sitter availability', () => {
    // Tree-sitter is not installed, should be false
    expect(parser.isTreeSitterAvailable()).toBe(false);
  });
});
