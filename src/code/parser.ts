/**
 * Code Parser
 * Provides code analysis utilities.
 * Uses regex-based parsing for key patterns.
 * See also: ASTParser for multi-language structural analysis.
 */

import { readFileSync } from 'fs';
import { extractSymbols, type CodeSymbol } from './symbols.js';

export interface ParseResult {
  symbols: CodeSymbol[];
  imports: ImportInfo[];
  exports: string[];
  loc: number;
  complexity: number;
}

export interface ImportInfo {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isNamespace: boolean;
  line: number;
}

export class CodeParser {
  /**
   * Parse a source file and extract structural information
   */
  parseFile(filePath: string): ParseResult {
    const content = readFileSync(filePath, 'utf-8');
    return this.parseContent(content, filePath);
  }

  /**
   * Parse source code content
   */
  parseContent(content: string, filePath: string): ParseResult {
    const symbols = extractSymbols(content, filePath);
    const imports = this.extractImports(content);
    const exports = this.extractExports(content);
    const loc = content.split('\n').filter(line => line.trim().length > 0).length;
    const complexity = this.estimateComplexity(content);

    return { symbols, imports, exports, loc, complexity };
  }

  /**
   * Extract import statements
   */
  private extractImports(content: string): ImportInfo[] {
    const imports: ImportInfo[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // ES module imports
      const esMatch = line.match(/^import\s+(?:(?:(\w+)\s*,?\s*)?(?:\{([^}]+)\})?(?:\*\s+as\s+(\w+))?)\s+from\s+['"]([^'"]+)['"]/);
      if (esMatch) {
        const specifiers: string[] = [];
        let isDefault = false;
        let isNamespace = false;

        if (esMatch[1]) {
          specifiers.push(esMatch[1]);
          isDefault = true;
        }
        if (esMatch[2]) {
          specifiers.push(...esMatch[2].split(',').map(s => s.trim()).filter(Boolean));
        }
        if (esMatch[3]) {
          specifiers.push(esMatch[3]);
          isNamespace = true;
        }

        imports.push({
          source: esMatch[4],
          specifiers,
          isDefault,
          isNamespace,
          line: i + 1,
        });
        continue;
      }

      // Type-only imports
      const typeMatch = line.match(/^import\s+type\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
      if (typeMatch) {
        imports.push({
          source: typeMatch[2],
          specifiers: typeMatch[1].split(',').map(s => s.trim()).filter(Boolean),
          isDefault: false,
          isNamespace: false,
          line: i + 1,
        });
        continue;
      }

      // CommonJS require
      const cjsMatch = line.match(/(?:const|let|var)\s+(?:(\w+)|(?:\{([^}]+)\}))\s*=\s*require\(['"]([^'"]+)['"]\)/);
      if (cjsMatch) {
        imports.push({
          source: cjsMatch[3],
          specifiers: cjsMatch[1] ? [cjsMatch[1]] : (cjsMatch[2]?.split(',').map(s => s.trim()) || []),
          isDefault: !!cjsMatch[1],
          isNamespace: false,
          line: i + 1,
        });
      }
    }

    return imports;
  }

  /**
   * Extract export names
   */
  private extractExports(content: string): string[] {
    const exports: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      // Named exports
      const namedMatch = line.match(/^export\s+(?:const|let|var|function|class|interface|type|enum|abstract)\s+(\w+)/);
      if (namedMatch) {
        exports.push(namedMatch[1]);
        continue;
      }

      // Re-exports
      const reExportMatch = line.match(/^export\s+\{([^}]+)\}/);
      if (reExportMatch) {
        exports.push(...reExportMatch[1].split(',').map(s => {
          const parts = s.trim().split(/\s+as\s+/);
          return parts[parts.length - 1].trim();
        }));
        continue;
      }

      // Default export
      if (line.match(/^export\s+default\s+/)) {
        exports.push('default');
      }
    }

    return exports;
  }

  /**
   * Estimate cyclomatic complexity (simplified)
   */
  private estimateComplexity(content: string): number {
    let complexity = 1; // Base complexity

    // Count branching points
    const branchPatterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\belse\s*\{/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\?\?/g,     // Nullish coalescing
      /\?\./g,     // Optional chaining
      /&&/g,       // Logical AND
      /\|\|/g,     // Logical OR
    ];

    for (const pattern of branchPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }
}
