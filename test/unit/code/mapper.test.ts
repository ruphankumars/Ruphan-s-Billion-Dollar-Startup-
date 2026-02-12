import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RepoMapper } from '../../../src/code/mapper.js';

describe('RepoMapper', () => {
  let tempDir: string;
  let mapper: RepoMapper;

  beforeEach(() => {
    tempDir = join(tmpdir(), `cortexos-mapper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    mapper = new RepoMapper();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a file inside the temp directory.
   */
  function createFile(relativePath: string, content = ''): void {
    const fullPath = join(tempDir, relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content);
  }

  it('should find files in a directory', () => {
    createFile('src/index.ts', 'export const x = 1;');
    createFile('src/utils.ts', 'export function add(a: number, b: number) { return a + b; }');
    createFile('README.md', '# Hello');

    const result = mapper.generateMap({ rootDir: tempDir });

    expect(result.files.length).toBe(3);
    expect(result.totalFiles).toBe(3);
    expect(result.map).toContain('index.ts');
    expect(result.map).toContain('utils.ts');
  });

  it('should respect maxDepth', () => {
    createFile('level1/level2/level3/deep.ts', 'const deep = true;');
    createFile('top.ts', 'const top = true;');

    const shallowResult = mapper.generateMap({ rootDir: tempDir, maxDepth: 1 });
    const deepResult = mapper.generateMap({ rootDir: tempDir, maxDepth: 8 });

    // With maxDepth=1, we should only reach level1/ but not deeper sub-directories
    expect(shallowResult.totalFiles).toBeLessThan(deepResult.totalFiles);
  });

  it('should ignore node_modules by default', () => {
    createFile('src/app.ts', 'const app = 1;');
    createFile('node_modules/lib/index.js', 'module.exports = {};');

    const result = mapper.generateMap({ rootDir: tempDir });

    const hasNodeModulesFile = result.files.some(f => f.includes('node_modules'));
    expect(hasNodeModulesFile).toBe(false);
  });

  it('should ignore .git directory by default', () => {
    createFile('src/app.ts', 'const app = 1;');
    // .git is a dot-directory and is explicitly in DEFAULT_IGNORE_DIRS
    mkdirSync(join(tempDir, '.git'), { recursive: true });
    writeFileSync(join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/main');

    const result = mapper.generateMap({ rootDir: tempDir });

    const hasGitFile = result.files.some(f => f.includes('.git'));
    expect(hasGitFile).toBe(false);
  });

  it('should detect languages from file extensions', () => {
    createFile('src/index.ts', 'export const x = 1;');
    createFile('src/helper.ts', 'export const y = 2;');
    createFile('lib/main.py', 'x = 1');
    createFile('cmd/server.go', 'package main');

    const result = mapper.generateMap({ rootDir: tempDir });

    expect(result.languages.typescript).toBe(2);
    expect(result.languages.python).toBe(1);
    expect(result.languages.go).toBe(1);
  });

  it('should extract symbols from TypeScript files when includeSymbols is true', () => {
    createFile('src/module.ts', [
      'export function greet(name: string): string {',
      '  return `Hello, ${name}`;',
      '}',
      '',
      'export class Greeter {',
      '  greet(name: string) {',
      '    return `Hello, ${name}`;',
      '  }',
      '}',
    ].join('\n'));

    const result = mapper.generateMap({ rootDir: tempDir, includeSymbols: true });

    expect(result.symbolCount).toBeGreaterThan(0);
    expect(result.map).toContain('greet');
    expect(result.map).toContain('Greeter');
  });

  it('should skip symbol extraction when includeSymbols is false', () => {
    createFile('src/module.ts', [
      'export function greet(name: string): string {',
      '  return `Hello, ${name}`;',
      '}',
    ].join('\n'));

    const result = mapper.generateMap({ rootDir: tempDir, includeSymbols: false });

    expect(result.symbolCount).toBe(0);
    // The file path itself should still appear in the map
    expect(result.map).toContain('module.ts');
  });

  it('should respect maxFiles limit', () => {
    for (let i = 0; i < 10; i++) {
      createFile(`src/file${i}.ts`, `export const x${i} = ${i};`);
    }

    const result = mapper.generateMap({ rootDir: tempDir, maxFiles: 3 });

    expect(result.files.length).toBe(3);
    // totalFiles reflects how many were found before the limit
    expect(result.totalFiles).toBe(10);
  });

  it('should return correct totalFiles count', () => {
    createFile('a.ts', 'const a = 1;');
    createFile('b.ts', 'const b = 2;');
    createFile('c.ts', 'const c = 3;');

    const result = mapper.generateMap({ rootDir: tempDir });

    expect(result.totalFiles).toBe(3);
    expect(result.files.length).toBe(3);
  });

  it('should return an empty result for an empty directory', () => {
    const result = mapper.generateMap({ rootDir: tempDir });

    expect(result.files.length).toBe(0);
    expect(result.totalFiles).toBe(0);
    expect(result.symbolCount).toBe(0);
    expect(Object.keys(result.languages).length).toBe(0);
    expect(result.map).toBe('');
  });

  it('should include a truncation message when files exceed maxFiles', () => {
    for (let i = 0; i < 5; i++) {
      createFile(`file${i}.ts`, `const x = ${i};`);
    }

    const result = mapper.generateMap({ rootDir: tempDir, maxFiles: 2 });

    expect(result.map).toContain('more files');
    expect(result.totalFiles).toBe(5);
    expect(result.files.length).toBe(2);
  });

  it('should ignore files with excluded extensions', () => {
    createFile('src/app.ts', 'const app = 1;');
    createFile('assets/logo.png', 'binary data');
    createFile('data/records.db', 'binary data');

    const result = mapper.generateMap({ rootDir: tempDir });

    const hasPng = result.files.some(f => f.endsWith('.png'));
    const hasDb = result.files.some(f => f.endsWith('.db'));
    expect(hasPng).toBe(false);
    expect(hasDb).toBe(false);
    expect(result.files.length).toBe(1);
  });

  it('should support custom ignoreDirs', () => {
    createFile('src/app.ts', 'const app = 1;');
    createFile('vendor/lib.ts', 'const lib = 1;');
    createFile('custom_ignore/stuff.ts', 'const stuff = 1;');

    const result = mapper.generateMap({
      rootDir: tempDir,
      ignoreDirs: ['custom_ignore'],
    });

    const hasCustomIgnore = result.files.some(f => f.includes('custom_ignore'));
    expect(hasCustomIgnore).toBe(false);
    // vendor should still be included since we overrode ignoreDirs
    const hasVendor = result.files.some(f => f.includes('vendor'));
    expect(hasVendor).toBe(true);
  });
});
