/**
 * Benchmark Tasks — Predefined coding tasks for self-validation.
 *
 * 12 tasks across 4 categories that test CortexOS's ability to
 * perform real-world coding operations. Each task includes setup
 * files, validation criteria, and difficulty ratings.
 */

import type { BenchmarkTask } from './types.js';

export const BENCHMARK_TASKS: BenchmarkTask[] = [
  // ===== File Operations (3 tasks) =====
  {
    id: 'file-create-ts',
    name: 'Create TypeScript Module',
    category: 'file-ops',
    prompt: 'Create a TypeScript file called src/utils/validator.ts that exports a function validateEmail(email: string): boolean which uses a regex to validate email addresses.',
    expectedOutcome: 'A valid TypeScript file with exported validateEmail function',
    maxTimeMs: 30000,
    difficulty: 'easy',
    expectedFiles: ['src/utils/validator.ts'],
    expectedPatterns: {
      'src/utils/validator.ts': 'export.*function.*validateEmail|export.*const.*validateEmail',
    },
  },
  {
    id: 'file-modify-json',
    name: 'Read and Modify JSON',
    category: 'file-ops',
    prompt: 'Read the package.json file and add a new script called "lint" with the value "eslint src/**/*.ts". Keep all existing content intact.',
    expectedOutcome: 'package.json updated with new lint script',
    maxTimeMs: 30000,
    difficulty: 'easy',
    setupFiles: {
      'package.json': JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: { test: 'vitest', build: 'tsc' },
      }, null, 2),
    },
    expectedFiles: ['package.json'],
    expectedPatterns: {
      'package.json': '"lint".*eslint',
    },
  },
  {
    id: 'file-search-replace',
    name: 'Search and Replace Across Files',
    category: 'file-ops',
    prompt: 'Find all occurrences of "Logger" in the src/ directory and rename them to "AppLogger". Update both class names and imports.',
    expectedOutcome: 'All Logger references renamed to AppLogger',
    maxTimeMs: 60000,
    difficulty: 'medium',
    setupFiles: {
      'src/logger.ts': 'export class Logger {\n  log(msg: string) { console.log(msg); }\n}\n',
      'src/app.ts': 'import { Logger } from \'./logger\';\nconst logger = new Logger();\nlogger.log("hello");\n',
    },
    expectedPatterns: {
      'src/logger.ts': 'AppLogger',
      'src/app.ts': 'AppLogger',
    },
  },

  // ===== Code Generation (3 tasks) =====
  {
    id: 'codegen-function',
    name: 'Generate Function with Tests',
    category: 'code-gen',
    prompt: 'Create a function called fibonacci(n: number): number that returns the nth Fibonacci number. Put it in src/math/fibonacci.ts. Also create a test file test/fibonacci.test.ts with at least 3 test cases.',
    expectedOutcome: 'fibonacci function and test file created',
    maxTimeMs: 60000,
    difficulty: 'easy',
    expectedFiles: ['src/math/fibonacci.ts'],
    expectedPatterns: {
      'src/math/fibonacci.ts': 'fibonacci',
    },
  },
  {
    id: 'codegen-interface',
    name: 'Implement Interface',
    category: 'code-gen',
    prompt: 'Given the interface in src/types.ts, create a class InMemoryCache in src/cache.ts that implements the Cache interface. Use a Map for storage.',
    expectedOutcome: 'InMemoryCache class implementing Cache interface',
    maxTimeMs: 60000,
    difficulty: 'medium',
    setupFiles: {
      'src/types.ts': 'export interface Cache {\n  get(key: string): unknown | undefined;\n  set(key: string, value: unknown, ttlMs?: number): void;\n  delete(key: string): boolean;\n  clear(): void;\n  size(): number;\n}\n',
    },
    expectedFiles: ['src/cache.ts'],
    expectedPatterns: {
      'src/cache.ts': 'class InMemoryCache.*implements.*Cache|InMemoryCache.*Cache',
    },
  },
  {
    id: 'codegen-class',
    name: 'Create Class with Methods',
    category: 'code-gen',
    prompt: 'Create a TypeScript class called Stack<T> in src/data-structures/stack.ts with methods: push(item: T), pop(): T | undefined, peek(): T | undefined, isEmpty(): boolean, and size(): number. Use an internal array for storage.',
    expectedOutcome: 'Generic Stack class with all methods',
    maxTimeMs: 60000,
    difficulty: 'medium',
    expectedFiles: ['src/data-structures/stack.ts'],
    expectedPatterns: {
      'src/data-structures/stack.ts': 'class Stack',
    },
  },

  // ===== Debugging (3 tasks) =====
  {
    id: 'debug-type-error',
    name: 'Fix Type Error',
    category: 'debugging',
    prompt: 'The file src/handler.ts has a type error. Fix it so that TypeScript compiles without errors.',
    expectedOutcome: 'Type error resolved',
    maxTimeMs: 60000,
    difficulty: 'easy',
    setupFiles: {
      'src/handler.ts': 'interface User {\n  id: number;\n  name: string;\n  email: string;\n}\n\nfunction processUser(user: User): string {\n  return user.id + " - " + user.name;\n}\n\nconst result: number = processUser({ id: 1, name: "Alice", email: "alice@test.com" });\nconsole.log(result);\n',
      'tsconfig.json': '{"compilerOptions":{"strict":true,"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}',
    },
    expectedFiles: ['src/handler.ts'],
    expectedPatterns: {
      'src/handler.ts': 'string.*=.*processUser|const result',
    },
  },
  {
    id: 'debug-import-error',
    name: 'Resolve Import Error',
    category: 'debugging',
    prompt: 'The file src/main.ts has a broken import. The utils module was moved from src/helpers/utils.ts to src/utils/helpers.ts. Fix the import path.',
    expectedOutcome: 'Import path corrected',
    maxTimeMs: 30000,
    difficulty: 'easy',
    setupFiles: {
      'src/main.ts': 'import { formatDate } from \'./helpers/utils\';\n\nconsole.log(formatDate(new Date()));\n',
      'src/utils/helpers.ts': 'export function formatDate(date: Date): string {\n  return date.toISOString();\n}\n',
    },
    expectedFiles: ['src/main.ts'],
    expectedPatterns: {
      'src/main.ts': './utils/helpers',
    },
  },
  {
    id: 'debug-logic-bug',
    name: 'Fix Logic Bug',
    category: 'debugging',
    prompt: 'The function findMax in src/utils.ts has a logic bug — it always returns the first element instead of the maximum. Fix the implementation.',
    expectedOutcome: 'findMax correctly returns the maximum value',
    maxTimeMs: 60000,
    difficulty: 'medium',
    setupFiles: {
      'src/utils.ts': 'export function findMax(arr: number[]): number | undefined {\n  if (arr.length === 0) return undefined;\n  let max = arr[0];\n  for (let i = 0; i < arr.length; i++) {\n    if (arr[i] > max) {\n      // Bug: forgot to update max\n      return arr[0];\n    }\n  }\n  return max;\n}\n',
    },
    expectedFiles: ['src/utils.ts'],
    expectedPatterns: {
      'src/utils.ts': 'max = arr\\[i\\]|max = arr',
    },
  },

  // ===== Multi-Step (3 tasks) =====
  {
    id: 'multi-read-edit-test',
    name: 'Read, Edit, and Verify',
    category: 'multi-step',
    prompt: 'Read src/config.ts, add a new configuration option called "maxRetries" with a default value of 3, and ensure the type definition is updated. The option should be a number.',
    expectedOutcome: 'Config updated with maxRetries option',
    maxTimeMs: 90000,
    difficulty: 'medium',
    setupFiles: {
      'src/config.ts': 'export interface AppConfig {\n  port: number;\n  host: string;\n  debug: boolean;\n}\n\nexport const DEFAULT_CONFIG: AppConfig = {\n  port: 3000,\n  host: "localhost",\n  debug: false,\n};\n',
    },
    expectedFiles: ['src/config.ts'],
    expectedPatterns: {
      'src/config.ts': 'maxRetries.*number|maxRetries.*3',
    },
  },
  {
    id: 'multi-refactor',
    name: 'Refactor Module',
    category: 'multi-step',
    prompt: 'Refactor the single file src/monolith.ts by extracting the User and Product classes into separate files: src/models/user.ts and src/models/product.ts. Update imports in src/monolith.ts to use the new locations.',
    expectedOutcome: 'Classes extracted to separate files with correct imports',
    maxTimeMs: 120000,
    difficulty: 'hard',
    setupFiles: {
      'src/monolith.ts': 'export class User {\n  constructor(public id: number, public name: string) {}\n  greet() { return `Hello ${this.name}`; }\n}\n\nexport class Product {\n  constructor(public id: number, public title: string, public price: number) {}\n  format() { return `${this.title}: $${this.price}`; }\n}\n\nexport function createOrder(user: User, products: Product[]) {\n  return { user, products, total: products.reduce((s, p) => s + p.price, 0) };\n}\n',
    },
    expectedFiles: ['src/models/user.ts', 'src/models/product.ts'],
    expectedPatterns: {
      'src/models/user.ts': 'class User',
      'src/models/product.ts': 'class Product',
    },
  },
  {
    id: 'multi-feature',
    name: 'Implement Feature with Tests',
    category: 'multi-step',
    prompt: 'Add a pagination utility to the project. Create src/utils/pagination.ts with a function paginate<T>(items: T[], page: number, pageSize: number): { data: T[], totalPages: number, currentPage: number }. Also create test/pagination.test.ts with tests for empty arrays, single page, and multiple pages.',
    expectedOutcome: 'Pagination utility and tests created',
    maxTimeMs: 120000,
    difficulty: 'hard',
    expectedFiles: ['src/utils/pagination.ts'],
    expectedPatterns: {
      'src/utils/pagination.ts': 'paginate|pagination',
    },
  },
];

/** Get tasks filtered by category */
export function getTasksByCategory(category: string): BenchmarkTask[] {
  return BENCHMARK_TASKS.filter(t => t.category === category);
}

/** Get all available categories */
export function getCategories(): string[] {
  return [...new Set(BENCHMARK_TASKS.map(t => t.category))];
}
