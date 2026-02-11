/**
 * Symbol Extraction
 * Extracts function names, class names, exports, and other symbols
 * from source code using regex patterns (Phase 3 adds tree-sitter AST).
 */

export interface CodeSymbol {
  name: string;
  type: SymbolType;
  line: number;
  exported: boolean;
  signature?: string;
}

export type SymbolType =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'constant'
  | 'method'
  | 'import';

/**
 * Extract symbols from TypeScript/JavaScript source code
 */
export function extractTSSymbols(content: string, filePath: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Exported/non-exported function declarations
    const funcMatch = line.match(/^(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (funcMatch) {
      symbols.push({
        name: funcMatch[3],
        type: 'function',
        line: lineNum,
        exported: !!funcMatch[1],
        signature: `function ${funcMatch[3]}(${funcMatch[4]})`,
      });
      continue;
    }

    // Arrow functions assigned to const/let
    const arrowMatch = line.match(/^(export\s+)?(const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    if (arrowMatch) {
      symbols.push({
        name: arrowMatch[3],
        type: 'function',
        line: lineNum,
        exported: !!arrowMatch[1],
      });
      continue;
    }

    // Class declarations
    const classMatch = line.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classMatch) {
      symbols.push({
        name: classMatch[3],
        type: 'class',
        line: lineNum,
        exported: !!classMatch[1],
        signature: classMatch[4] ? `class ${classMatch[3]} extends ${classMatch[4]}` : `class ${classMatch[3]}`,
      });
      continue;
    }

    // Interface declarations
    const ifaceMatch = line.match(/^(export\s+)?interface\s+(\w+)/);
    if (ifaceMatch) {
      symbols.push({
        name: ifaceMatch[2],
        type: 'interface',
        line: lineNum,
        exported: !!ifaceMatch[1],
      });
      continue;
    }

    // Type declarations
    const typeMatch = line.match(/^(export\s+)?type\s+(\w+)\s*=/);
    if (typeMatch) {
      symbols.push({
        name: typeMatch[2],
        type: 'type',
        line: lineNum,
        exported: !!typeMatch[1],
      });
      continue;
    }

    // Enum declarations
    const enumMatch = line.match(/^(export\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      symbols.push({
        name: enumMatch[2],
        type: 'enum',
        line: lineNum,
        exported: !!enumMatch[1],
      });
      continue;
    }

    // Const/let exports
    const constMatch = line.match(/^(export\s+)?const\s+(\w+)\s*[=:]/);
    if (constMatch && !arrowMatch) {
      symbols.push({
        name: constMatch[2],
        type: 'constant',
        line: lineNum,
        exported: !!constMatch[1],
      });
      continue;
    }

    // Method declarations inside classes
    const methodMatch = line.match(/^\s+(async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*\w+)?\s*\{/);
    if (methodMatch && methodMatch[2] !== 'if' && methodMatch[2] !== 'for' && methodMatch[2] !== 'while') {
      symbols.push({
        name: methodMatch[2],
        type: 'method',
        line: lineNum,
        exported: false,
        signature: `${methodMatch[2]}(${methodMatch[3]})`,
      });
    }
  }

  return symbols;
}

/**
 * Extract symbols from Python source code
 */
export function extractPythonSymbols(content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Function/method definitions
    const funcMatch = line.match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (funcMatch) {
      const indent = funcMatch[1].length;
      symbols.push({
        name: funcMatch[2],
        type: indent > 0 ? 'method' : 'function',
        line: lineNum,
        exported: !funcMatch[2].startsWith('_'),
        signature: `def ${funcMatch[2]}(${funcMatch[3]})`,
      });
      continue;
    }

    // Class definitions
    const classMatch = line.match(/^class\s+(\w+)(?:\(([^)]*)\))?/);
    if (classMatch) {
      symbols.push({
        name: classMatch[1],
        type: 'class',
        line: lineNum,
        exported: !classMatch[1].startsWith('_'),
      });
    }
  }

  return symbols;
}

/**
 * Extract symbols based on detected language
 */
export function extractSymbols(content: string, filePath: string, language?: string): CodeSymbol[] {
  const lang = language || detectLanguageFromPath(filePath);

  switch (lang) {
    case 'typescript':
    case 'javascript':
      return extractTSSymbols(content, filePath);
    case 'python':
      return extractPythonSymbols(content);
    default:
      return extractTSSymbols(content, filePath); // Default to TS extraction
  }
}

function detectLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const extMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    py: 'python', pyi: 'python',
    rs: 'rust', go: 'go', java: 'java', rb: 'ruby',
  };
  return extMap[ext || ''] || 'unknown';
}
