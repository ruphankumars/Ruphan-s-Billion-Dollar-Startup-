/**
 * Packager — Bundle Creator for Deployments
 *
 * Packages source code into deployable bundles with manifests,
 * content hashing, and validation. Reads project metadata from
 * package.json to auto-generate manifests.
 * Zero npm dependencies — uses node:fs, node:path, node:crypto.
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DeployManifest, PackageBundle } from './types.js';

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.env',
  '.env.*',
  'dist',
  'coverage',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_BUNDLE_FILES = 5000;

// ═══════════════════════════════════════════════════════════════
// PACKAGER
// ═══════════════════════════════════════════════════════════════

export class Packager extends EventEmitter {
  private running = false;

  constructor() {
    super();
  }

  // ─────────────────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────────────────

  start(): void {
    this.running = true;
    this.emit('deploy:packager:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('deploy:packager:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─────────────────────────────────────────────────────────
  // CORE OPERATIONS
  // ─────────────────────────────────────────────────────────

  /**
   * Create a deployable bundle from a project directory.
   */
  createBundle(projectDir: string, manifest: DeployManifest): PackageBundle {
    const files = new Map<string, string>();
    let totalSize = 0;

    this.emit('deploy:bundle:start', {
      timestamp: Date.now(),
      projectDir,
      name: manifest.name,
    });

    // Collect all files
    this.collectFiles(projectDir, projectDir, files);

    // Calculate total size
    for (const content of files.values()) {
      totalSize += Buffer.byteLength(content, 'utf-8');
    }

    // Calculate hash
    const hash = this.calculateHash({ manifest, files });

    const bundle: PackageBundle = {
      manifest,
      files,
      size: totalSize,
      hash,
    };

    this.emit('deploy:bundle:complete', {
      timestamp: Date.now(),
      fileCount: files.size,
      totalSize,
      hash,
    });

    return bundle;
  }

  /**
   * Auto-detect and generate a manifest from package.json and project structure.
   */
  generateManifest(projectDir: string): DeployManifest {
    const packageJsonPath = path.join(projectDir, 'package.json');
    let pkg: Record<string, unknown> = {};

    if (fs.existsSync(packageJsonPath)) {
      try {
        const raw = fs.readFileSync(packageJsonPath, 'utf-8');
        pkg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Fall through to defaults
      }
    }

    // Detect entry point
    let entryPoint = 'index.js';
    const mainField = pkg.main as string | undefined;
    if (mainField) {
      entryPoint = mainField;
    } else if (fs.existsSync(path.join(projectDir, 'dist/index.js'))) {
      entryPoint = 'dist/index.js';
    } else if (fs.existsSync(path.join(projectDir, 'src/index.ts'))) {
      entryPoint = 'src/index.ts';
    }

    // Extract dependencies
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;

    const manifest: DeployManifest = {
      name: (pkg.name as string) ?? path.basename(projectDir),
      version: (pkg.version as string) ?? '0.0.0',
      entryPoint,
      dependencies: deps,
      environment: {},
      resources: {
        memory: '256Mi',
        cpu: '0.5',
        disk: '1Gi',
      },
      healthCheck: {
        path: '/health',
        interval: 30,
        timeout: 5,
      },
    };

    this.emit('deploy:manifest:generated', {
      timestamp: Date.now(),
      manifest,
    });

    return manifest;
  }

  /**
   * Calculate SHA256 hash of bundle contents.
   */
  calculateHash(bundle: Pick<PackageBundle, 'manifest' | 'files'>): string {
    const hasher = createHash('sha256');

    // Hash manifest
    hasher.update(JSON.stringify(bundle.manifest));

    // Hash file contents in sorted order for deterministic hash
    const sortedPaths = [...bundle.files.keys()].sort();
    for (const filePath of sortedPaths) {
      hasher.update(filePath);
      hasher.update(bundle.files.get(filePath)!);
    }

    return hasher.digest('hex');
  }

  /**
   * Validate that a bundle is complete and well-formed.
   */
  validateBundle(bundle: PackageBundle): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate manifest
    if (!bundle.manifest.name) {
      errors.push('Manifest missing "name" field');
    }
    if (!bundle.manifest.version) {
      errors.push('Manifest missing "version" field');
    }
    if (!bundle.manifest.entryPoint) {
      errors.push('Manifest missing "entryPoint" field');
    }

    // Check entry point exists in bundle
    if (bundle.manifest.entryPoint && !bundle.files.has(bundle.manifest.entryPoint)) {
      warnings.push(`Entry point "${bundle.manifest.entryPoint}" not found in bundle files`);
    }

    // Check bundle has files
    if (bundle.files.size === 0) {
      errors.push('Bundle contains no files');
    }

    // Check bundle size
    if (bundle.size > 100 * 1024 * 1024) {
      warnings.push(`Bundle size (${(bundle.size / 1024 / 1024).toFixed(1)}MB) exceeds 100MB`);
    }

    // Verify hash
    const computedHash = this.calculateHash(bundle);
    if (bundle.hash && bundle.hash !== computedHash) {
      errors.push('Bundle hash mismatch — contents may have been modified');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get bundle statistics.
   */
  getBundleStats(bundle: PackageBundle): {
    fileCount: number;
    totalSize: number;
    totalSizeMB: string;
    hash: string;
    extensions: Record<string, number>;
    largestFiles: Array<{ path: string; size: number }>;
  } {
    const extensions: Record<string, number> = {};
    const fileSizes: Array<{ path: string; size: number }> = [];

    for (const [filePath, content] of bundle.files) {
      const ext = path.extname(filePath) || '(no extension)';
      extensions[ext] = (extensions[ext] ?? 0) + 1;

      fileSizes.push({
        path: filePath,
        size: Buffer.byteLength(content, 'utf-8'),
      });
    }

    // Sort by size descending, take top 10
    fileSizes.sort((a, b) => b.size - a.size);
    const largestFiles = fileSizes.slice(0, 10);

    return {
      fileCount: bundle.files.size,
      totalSize: bundle.size,
      totalSizeMB: (bundle.size / 1024 / 1024).toFixed(2),
      hash: bundle.hash,
      extensions,
      largestFiles,
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL
  // ─────────────────────────────────────────────────────────

  /**
   * Recursively collect files from a directory.
   */
  private collectFiles(
    rootDir: string,
    currentDir: string,
    files: Map<string, string>,
    depth = 0,
  ): void {
    if (depth > 20 || files.size >= MAX_BUNDLE_FILES) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.size >= MAX_BUNDLE_FILES) break;

      // Check ignore patterns
      if (this.shouldIgnore(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);

      if (entry.isDirectory()) {
        this.collectFiles(rootDir, fullPath, files, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_SIZE) continue; // Skip large files

          const content = fs.readFileSync(fullPath, 'utf-8');
          files.set(relativePath, content);
        } catch {
          // Skip files we cannot read (binary, permissions, etc.)
        }
      }
    }
  }

  /**
   * Check if a file/directory should be ignored.
   */
  private shouldIgnore(name: string): boolean {
    if (name.startsWith('.')) return true;

    for (const pattern of DEFAULT_IGNORE_PATTERNS) {
      if (pattern.includes('*')) {
        // Simple glob
        const regex = new RegExp(
          '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
        );
        if (regex.test(name)) return true;
      } else {
        if (name === pattern) return true;
      }
    }

    return false;
  }
}
