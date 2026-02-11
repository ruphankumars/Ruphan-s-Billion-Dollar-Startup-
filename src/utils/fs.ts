import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { readFile, writeFile, mkdir, stat, readdir, access } from 'fs/promises';
import { dirname, join, relative, resolve } from 'path';

/**
 * Ensure a directory exists, creating it recursively if needed
 */
export function ensureDirSync(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Async version of ensureDir
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await access(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Read file content safely, returns null if file doesn't exist
 */
export function readFileSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Async read file safely
 */
export async function readFileSafeAsync(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write file with automatic directory creation
 */
export function writeFileSafe(filePath: string, content: string): void {
  ensureDirSync(dirname(filePath));
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Async write file with directory creation
 */
export async function writeFileSafeAsync(filePath: string, content: string): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Check if a path exists
 */
export function pathExists(p: string): boolean {
  return existsSync(p);
}

/**
 * Get file size in bytes, returns 0 if file doesn't exist
 */
export function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Count lines in a file
 */
export function countLines(filePath: string): number {
  const content = readFileSafe(filePath);
  if (!content) return 0;
  return content.split('\n').length;
}

/**
 * Walk a directory tree recursively, yielding file paths
 */
export function* walkDirSync(
  dir: string,
  options: { ignore?: Set<string>; maxDepth?: number } = {},
): Generator<string> {
  const { ignore = new Set(['node_modules', '.git', 'dist', 'coverage']), maxDepth = 20 } = options;

  function* walk(currentDir: string, depth: number): Generator<string> {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.cortexos.yaml') continue;

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        yield* walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        yield fullPath;
      }
    }
  }

  yield* walk(dir, 0);
}

/**
 * Get relative path from a root directory
 */
export function getRelativePath(filePath: string, rootDir: string): string {
  return relative(rootDir, filePath);
}

/**
 * Resolve a path relative to the working directory
 */
export function resolvePath(filePath: string, workingDir: string): string {
  if (filePath.startsWith('/') || filePath.startsWith('~')) {
    return resolve(filePath);
  }
  return resolve(workingDir, filePath);
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}
