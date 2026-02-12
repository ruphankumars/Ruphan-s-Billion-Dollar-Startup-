import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ASTParser } from '../../../src/code/ast-parser.js';

describe('ASTParser — Tree-sitter Integration', () => {
  let parser: ASTParser;

  beforeEach(() => {
    parser = new ASTParser();
  });

  it('should initialize without tree-sitter (graceful fallback)', async () => {
    // In test environment, tree-sitter WASM likely not available
    const result = await parser.initTreeSitter();
    // Either true (if web-tree-sitter is installed) or false (graceful fallback)
    expect(typeof result).toBe('boolean');
  });

  it('should analyze TypeScript file with regex fallback', async () => {
    const content = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export class UserService {
  private users: Map<string, User> = new Map();

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  addUser(user: User): void {
    this.users.set(user.id, user);
  }
}

interface User {
  id: string;
  name: string;
}
`;

    const result = await parser.analyze(content, 'service.ts');

    expect(result.functions.length).toBeGreaterThan(0);
    expect(result.classes.length).toBeGreaterThan(0);
  });

  it('should detect complexity in TypeScript', async () => {
    const content = `
function complex(x: number): string {
  if (x > 10) {
    if (x > 20) {
      for (let i = 0; i < x; i++) {
        if (i % 2 === 0) {
          switch(i) {
            case 0: return 'zero';
            case 2: return 'two';
            default: break;
          }
        }
      }
    }
  } else if (x < 0) {
    while (x < 0) {
      x++;
    }
  }
  return x > 5 ? 'big' : 'small';
}
`;

    const result = await parser.analyze(content, 'complex.ts');
    expect(result.complexity).toBeDefined();
    expect(result.complexity.cyclomatic).toBeGreaterThan(1);
  });

  it('should extract imports', async () => {
    const content = `
import { readFile } from 'fs/promises';
import path from 'path';
import type { Config } from './types.js';
`;

    const result = await parser.analyze(content, 'imports.ts');
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });

  it('should extract exports', async () => {
    const content = `
export const API_VERSION = '2.0';
export function createServer() { return null; }
export default class App {}
export type { Config } from './types.js';
`;

    const result = await parser.analyze(content, 'exports.ts');
    expect(result.exports.length).toBeGreaterThan(0);
  });

  it('should handle JavaScript files', async () => {
    const content = `
function add(a, b) {
  return a + b;
}

class Calculator {
  multiply(a, b) {
    return a * b;
  }
}

module.exports = { add, Calculator };
`;

    const result = await parser.analyze(content, 'calc.js');
    expect(result.functions.length).toBeGreaterThan(0);
    expect(result.classes.length).toBeGreaterThan(0);
  });

  it('should handle empty files', async () => {
    const result = await parser.analyze('', 'empty.ts');
    expect(result.functions).toEqual([]);
    expect(result.classes).toEqual([]);
  });

  it('should handle Python files with regex', async () => {
    const content = `
def greet(name):
    return f"Hello, {name}!"

class UserManager:
    def __init__(self):
        self.users = {}

    def add_user(self, user):
        self.users[user.id] = user
`;

    const result = await parser.analyze(content, 'manager.py');
    expect(result.functions.length).toBeGreaterThan(0);
  });

  it('should extract call graph edges', async () => {
    const content = `
function a() { b(); c(); }
function b() { c(); }
function c() { console.log('done'); }
`;

    const result = await parser.analyze(content, 'callgraph.ts');
    expect(result.callGraph).toBeDefined();
    expect(result.callGraph.length).toBeGreaterThan(0);
  });

  it('should detect class methods with their class name', async () => {
    const content = `
class AuthService {
  async login(email: string, password: string): Promise<Token> {
    const user = await this.findUser(email);
    return this.generateToken(user);
  }

  private async findUser(email: string): Promise<User> {
    return db.users.findOne({ email });
  }
}
`;

    const result = await parser.analyze(content, 'auth.ts');
    expect(result.classes.length).toBe(1);
    expect(result.classes[0].name).toBe('AuthService');
    expect(result.classes[0].methods.length).toBeGreaterThanOrEqual(1);
  });
});
