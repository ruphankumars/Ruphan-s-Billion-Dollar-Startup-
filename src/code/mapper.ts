/**
 * Repository Mapper
 * Creates a compact representation of the repository structure
 * including file tree, key symbols, and relationships.
 * This "repo map" is injected into prompts for context.
 */

import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative, extname } from 'path';
import { extractSymbols, type CodeSymbol } from './symbols.js';
import { detectLanguage } from './languages.js';

export interface RepoMapOptions {
  rootDir: string;
  maxFiles?: number;
  maxDepth?: number;
  includeSymbols?: boolean;
  ignoreDirs?: string[];
  ignoreExtensions?: string[];
}

export interface RepoMapResult {
  map: string;
  files: string[];
  languages: Record<string, number>;
  totalFiles: number;
  symbolCount: number;
}

const DEFAULT_IGNORE_DIRS = [
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.pytest_cache', 'target', 'vendor',
  '.cortexos', '.vscode', '.idea', 'coverage', '.turbo',
  '.cache', 'tmp', 'temp',
];

const DEFAULT_IGNORE_EXTENSIONS = [
  '.lock', '.log', '.map', '.min.js', '.min.css',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.wav', '.avi',
  '.zip', '.tar', '.gz', '.bz2',
  '.db', '.sqlite', '.sqlite3',
  '.pdf', '.doc', '.docx',
];

export class RepoMapper {
  /**
   * Generate a repository map
   */
  generateMap(options: RepoMapOptions): RepoMapResult {
    const {
      rootDir,
      maxFiles = 500,
      maxDepth = 8,
      includeSymbols = true,
      ignoreDirs = DEFAULT_IGNORE_DIRS,
      ignoreExtensions = DEFAULT_IGNORE_EXTENSIONS,
    } = options;

    const ignoreSet = new Set(ignoreDirs);
    const ignoreExtSet = new Set(ignoreExtensions);

    // Collect files
    const files: string[] = [];
    this.walkDir(rootDir, rootDir, files, ignoreSet, ignoreExtSet, maxDepth, 0);

    // Limit files
    const limitedFiles = files.slice(0, maxFiles);

    // Detect languages
    const languages: Record<string, number> = {};
    for (const file of limitedFiles) {
      const lang = detectLanguage(file);
      if (lang) {
        languages[lang] = (languages[lang] || 0) + 1;
      }
    }

    // Build map
    let symbolCount = 0;
    const mapLines: string[] = [];

    for (const file of limitedFiles) {
      const relPath = relative(rootDir, file);
      const ext = extname(file);

      if (includeSymbols && this.isCodeFile(ext)) {
        try {
          const content = readFileSync(file, 'utf-8');
          const symbols = extractSymbols(content, file);
          symbolCount += symbols.length;

          if (symbols.length > 0) {
            mapLines.push(`${relPath}`);
            // Show exported symbols only to keep map compact
            const exported = symbols.filter(s => s.exported);
            for (const sym of exported.slice(0, 10)) {
              const prefix = this.getSymbolPrefix(sym.type);
              mapLines.push(`  ${prefix} ${sym.name}${sym.signature ? ` — ${sym.signature}` : ''}`);
            }
            if (exported.length > 10) {
              mapLines.push(`  ... +${exported.length - 10} more exports`);
            }
          } else {
            mapLines.push(relPath);
          }
        } catch {
          mapLines.push(relPath);
        }
      } else {
        mapLines.push(relPath);
      }
    }

    if (files.length > maxFiles) {
      mapLines.push(`\n... and ${files.length - maxFiles} more files`);
    }

    return {
      map: mapLines.join('\n'),
      files: limitedFiles,
      languages,
      totalFiles: files.length,
      symbolCount,
    };
  }

  /**
   * Recursively walk directory
   */
  private walkDir(
    rootDir: string,
    dir: string,
    files: string[],
    ignoreDirs: Set<string>,
    ignoreExts: Set<string>,
    maxDepth: number,
    currentDepth: number,
  ): void {
    if (currentDepth > maxDepth) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      // Sort: directories first, then files
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name) && !entry.name.startsWith('.')) {
            this.walkDir(rootDir, fullPath, files, ignoreDirs, ignoreExts, maxDepth, currentDepth + 1);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (!ignoreExts.has(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Permission denied or other read error — skip
    }
  }

  /**
   * Check if a file extension represents source code
   */
  private isCodeFile(ext: string): boolean {
    const codeExts = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.rs', '.go', '.java', '.rb', '.swift',
      '.c', '.cpp', '.h', '.hpp', '.cs',
      '.php', '.kt', '.scala', '.ex', '.exs',
    ]);
    return codeExts.has(ext);
  }

  /**
   * Get display prefix for symbol type
   */
  private getSymbolPrefix(type: string): string {
    const prefixes: Record<string, string> = {
      function: 'fn',
      class: 'cls',
      interface: 'iface',
      type: 'type',
      enum: 'enum',
      constant: 'const',
      variable: 'var',
      method: 'method',
    };
    return prefixes[type] || '•';
  }
}
