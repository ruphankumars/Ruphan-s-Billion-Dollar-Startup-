import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
    splitting: false,
    external: ['better-sqlite3', 'web-tree-sitter'],
  },
  {
    entry: ['bin/cortexos.ts'],
    format: ['esm'],
    sourcemap: true,
    target: 'node20',
    splitting: false,
    banner: { js: '#!/usr/bin/env node\n' },
    external: ['better-sqlite3', 'web-tree-sitter'],
  },
  {
    entry: ['src/agents/worker.ts'],
    format: ['esm'],
    sourcemap: true,
    target: 'node20',
    outDir: 'dist/workers',
    splitting: false,
    external: ['better-sqlite3', 'web-tree-sitter'],
  },
]);
