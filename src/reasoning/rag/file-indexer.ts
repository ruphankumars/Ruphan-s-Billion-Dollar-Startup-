/**
 * FileIndexer — Walks project directories and chunks files into embeddable segments.
 *
 * Produces an array of { path, chunk, startLine } for embedding and search.
 * Respects ignore patterns and file size limits to keep indexing fast.
 *
 * Part of the RAG pipeline for the Reasoning module.
 */

import { walkDirSync, readFileSafe } from '../../utils/fs.js';
import { extname, relative } from 'path';
import { getLogger } from '../../core/logger.js';

const logger = getLogger();

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.rb', '.swift', '.kt', '.scala',
  '.vue', '.svelte', '.css', '.scss', '.html', '.json', '.yaml',
  '.yml', '.toml', '.md', '.txt', '.sh', '.bash', '.sql',
]);

const MAX_FILE_SIZE = 100_000; // 100KB

export interface FileChunk {
  path: string;
  relativePath: string;
  chunk: string;
  startLine: number;
  endLine: number;
}

export interface IndexerOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  maxFiles?: number;
  extensions?: Set<string>;
}

export class FileIndexer {
  private chunkSize: number;
  private chunkOverlap: number;
  private maxFiles: number;
  private extensions: Set<string>;

  constructor(options: IndexerOptions = {}) {
    this.chunkSize = options.chunkSize ?? 500;
    this.chunkOverlap = options.chunkOverlap ?? 50;
    this.maxFiles = options.maxFiles ?? 1000;
    this.extensions = options.extensions ?? CODE_EXTENSIONS;
  }

  /**
   * Index a project directory into embeddable chunks.
   */
  indexProject(projectDir: string): FileChunk[] {
    const chunks: FileChunk[] = [];
    let fileCount = 0;

    for (const filePath of walkDirSync(projectDir)) {
      if (fileCount >= this.maxFiles) break;

      const ext = extname(filePath).toLowerCase();
      if (!this.extensions.has(ext)) continue;

      const content = readFileSafe(filePath);
      if (!content || content.length > MAX_FILE_SIZE) continue;

      const relativePath = relative(projectDir, filePath);
      const fileChunks = this.chunkFile(filePath, relativePath, content);
      chunks.push(...fileChunks);
      fileCount++;
    }

    logger.info(
      { files: fileCount, chunks: chunks.length },
      'FileIndexer: project indexed',
    );

    return chunks;
  }

  /**
   * Split a file into overlapping line-based chunks.
   */
  chunkFile(filePath: string, relativePath: string, content: string): FileChunk[] {
    const lines = content.split('\n');
    const chunks: FileChunk[] = [];

    if (lines.length <= this.chunkSize) {
      // Small file — single chunk
      chunks.push({
        path: filePath,
        relativePath,
        chunk: content,
        startLine: 1,
        endLine: lines.length,
      });
      return chunks;
    }

    // Sliding window with overlap
    let startLine = 0;
    while (startLine < lines.length) {
      const endLine = Math.min(startLine + this.chunkSize, lines.length);
      const chunkLines = lines.slice(startLine, endLine);

      chunks.push({
        path: filePath,
        relativePath,
        chunk: chunkLines.join('\n'),
        startLine: startLine + 1,
        endLine,
      });

      startLine += this.chunkSize - this.chunkOverlap;
    }

    return chunks;
  }
}
