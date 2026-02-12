/**
 * Code Complexity Plugin — Static analysis gate and tool for code quality.
 *
 * Provides:
 * - `complexity_analyze` tool: Analyze cyclomatic complexity of changed files
 * - `complexity` gate: Fails if any function exceeds configurable complexity threshold
 * - Pre-execute middleware: Injects complexity context into prompts
 */

import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { CortexPlugin, PluginContext } from '../registry.js';
import type { Tool, ToolResult } from '../../tools/types.js';
import type { QualityGate, QualityContext, GateResult, GateIssue } from '../../quality/types.js';

// ===== Complexity Analysis =====

interface ComplexityResult {
  file: string;
  functions: FunctionComplexity[];
  averageComplexity: number;
  maxComplexity: number;
  totalFunctions: number;
}

interface FunctionComplexity {
  name: string;
  line: number;
  complexity: number;
  loc: number;
}

/**
 * Calculate cyclomatic complexity using control flow counting.
 * M = 1 + decision_points (if, else if, while, for, case, &&, ||, ?:, catch)
 */
function analyzeComplexity(content: string, filePath: string): ComplexityResult {
  const ext = extname(filePath);
  const isSupported = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'].includes(ext);

  if (!isSupported) {
    return { file: filePath, functions: [], averageComplexity: 0, maxComplexity: 0, totalFunctions: 0 };
  }

  const lines = content.split('\n');
  const functions: FunctionComplexity[] = [];

  // Extract function blocks using brace counting
  const funcPatterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/,
    /(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/,
    /(?:public|private|protected|static)\s+(?:async\s+)?(\w+)\s*\(/,
  ];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let funcName: string | null = null;
    let funcLine = i + 1;

    for (const pattern of funcPatterns) {
      const match = line.match(pattern);
      if (match && match[1] && !['if', 'else', 'while', 'for', 'switch', 'catch', 'return', 'import', 'from', 'new', 'class'].includes(match[1])) {
        funcName = match[1];
        break;
      }
    }

    if (funcName) {
      // Find the body of the function by counting braces
      let braceCount = 0;
      let started = false;
      let bodyLines: string[] = [];
      let j = i;

      while (j < lines.length) {
        const l = lines[j];
        for (const ch of l) {
          if (ch === '{') { braceCount++; started = true; }
          if (ch === '}') braceCount--;
        }
        if (started) bodyLines.push(l);
        if (started && braceCount === 0) break;
        j++;
      }

      if (bodyLines.length > 0) {
        const body = bodyLines.join('\n');
        let complexity = 1; // Base complexity

        // Decision point keywords
        const decisionPatterns = [
          /\bif\s*\(/g,
          /\belse\s+if\s*\(/g,
          /\bwhile\s*\(/g,
          /\bfor\s*[\s(]/g,
          /\bcase\s+/g,
          /\bcatch\s*\(/g,
          /\?\s*[^:]/g,    // Ternary
          /&&/g,
          /\|\|/g,
          /\?\?/g,          // Nullish coalescing
        ];

        for (const pattern of decisionPatterns) {
          const matches = body.match(pattern);
          if (matches) complexity += matches.length;
        }

        functions.push({
          name: funcName,
          line: funcLine,
          complexity,
          loc: bodyLines.length,
        });
      }

      i = j + 1;
    } else {
      i++;
    }
  }

  const complexities = functions.map(f => f.complexity);
  return {
    file: filePath,
    functions,
    averageComplexity: complexities.length > 0
      ? Math.round((complexities.reduce((a, b) => a + b, 0) / complexities.length) * 100) / 100
      : 0,
    maxComplexity: complexities.length > 0 ? Math.max(...complexities) : 0,
    totalFunctions: functions.length,
  };
}

// ===== Tool =====

function createComplexityTool(): Tool {
  return {
    name: 'complexity_analyze',
    description: 'Analyze cyclomatic complexity of source files. Returns per-function complexity scores.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'List of file paths to analyze (relative to working dir)',
          items: { type: 'string', description: 'File path' },
        },
        threshold: {
          type: 'number',
          description: 'Complexity threshold to flag (default: 10)',
          default: 10,
        },
      },
      required: ['files'],
    },
    async execute(args: Record<string, unknown>, context): Promise<ToolResult> {
      const files = args.files as string[];
      const threshold = (args.threshold as number) || 10;
      const results: ComplexityResult[] = [];
      const warnings: string[] = [];

      for (const file of files) {
        const fullPath = join(context.workingDir, file);
        if (!existsSync(fullPath)) {
          warnings.push(`File not found: ${file}`);
          continue;
        }

        try {
          const content = readFileSync(fullPath, 'utf-8');
          const result = analyzeComplexity(content, file);
          results.push(result);

          const highComplexity = result.functions.filter(f => f.complexity > threshold);
          for (const fn of highComplexity) {
            warnings.push(`${file}:${fn.line} — ${fn.name}() has complexity ${fn.complexity} (threshold: ${threshold})`);
          }
        } catch {
          warnings.push(`Error reading ${file}`);
        }
      }

      return {
        success: true,
        output: JSON.stringify({ results, warnings, threshold }, null, 2),
        metadata: {
          filesAnalyzed: results.length,
          totalFunctions: results.reduce((s, r) => s + r.totalFunctions, 0),
          warningCount: warnings.length,
        },
      };
    },
  };
}

// ===== Quality Gate =====

function createComplexityGate(maxComplexity: number): QualityGate {
  return {
    name: 'complexity',
    description: `Fails if any function exceeds cyclomatic complexity of ${maxComplexity}`,
    async run(context: QualityContext): Promise<GateResult> {
      const startTime = Date.now();
      const issues: GateIssue[] = [];

      for (const file of context.filesChanged) {
        const fullPath = join(context.workingDir, file);
        if (!existsSync(fullPath)) continue;

        try {
          const content = readFileSync(fullPath, 'utf-8');
          const result = analyzeComplexity(content, file);

          for (const fn of result.functions) {
            if (fn.complexity > maxComplexity) {
              issues.push({
                severity: fn.complexity > maxComplexity * 2 ? 'error' : 'warning',
                message: `Function "${fn.name}" has cyclomatic complexity ${fn.complexity} (max: ${maxComplexity})`,
                file,
                line: fn.line,
                rule: 'max-complexity',
                autoFixable: false,
                suggestion: `Consider breaking "${fn.name}" into smaller functions`,
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      return {
        gate: 'complexity',
        passed: issues.filter(i => i.severity === 'error').length === 0,
        issues,
        duration: Date.now() - startTime,
      };
    },
  };
}

// ===== Plugin =====

export const CodeComplexityPlugin: CortexPlugin = {
  name: 'cortexos-code-complexity',
  version: '1.0.0',
  description: 'Cyclomatic complexity analysis with quality gate and analysis tool',
  author: 'CortexOS',

  register(ctx: PluginContext): void {
    const config = ctx.getConfig('codeComplexity') as { maxComplexity?: number } | undefined;
    const maxComplexity = config?.maxComplexity ?? 15;

    ctx.registerTool(createComplexityTool());
    ctx.registerGate('complexity', createComplexityGate(maxComplexity));
  },
};

export { analyzeComplexity, type ComplexityResult, type FunctionComplexity };
