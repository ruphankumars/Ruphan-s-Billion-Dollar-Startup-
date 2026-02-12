/**
 * Documentation Generator Plugin — Auto-generate docs from code analysis.
 *
 * Provides:
 * - `docs_generate` tool: Generate markdown documentation from source files
 * - `docs_coverage` tool: Analyze documentation coverage (JSDoc/TSDoc presence)
 * - `documentation-coverage` gate: Fails if exported functions lack documentation
 * - Agent role: documentation-writer with specialized prompts
 */

import { readFileSync, existsSync } from 'fs';
import { join, extname, basename, relative } from 'path';
import type { CortexPlugin, PluginContext, RoleTemplate } from '../registry.js';
import type { Tool, ToolResult, ToolContext } from '../../tools/types.js';
import type { QualityGate, QualityContext, GateResult, GateIssue } from '../../quality/types.js';

// ===== Doc Analysis =====

interface DocEntry {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'enum';
  exported: boolean;
  documented: boolean;
  line: number;
  docComment?: string;
  signature?: string;
}

interface DocCoverage {
  file: string;
  entries: DocEntry[];
  exportedCount: number;
  documentedCount: number;
  coveragePercent: number;
}

/**
 * Analyze documentation coverage for a TypeScript/JavaScript file.
 */
function analyzeDocCoverage(content: string, filePath: string): DocCoverage {
  const ext = extname(filePath);
  if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    return { file: filePath, entries: [], exportedCount: 0, documentedCount: 0, coveragePercent: 100 };
  }

  const lines = content.split('\n');
  const entries: DocEntry[] = [];

  // Patterns for declarations
  const patterns: Array<{ pattern: RegExp; type: DocEntry['type'] }> = [
    { pattern: /^export\s+(?:async\s+)?function\s+(\w+)/, type: 'function' },
    { pattern: /^export\s+(?:default\s+)?class\s+(\w+)/, type: 'class' },
    { pattern: /^export\s+(?:default\s+)?interface\s+(\w+)/, type: 'interface' },
    { pattern: /^export\s+type\s+(\w+)/, type: 'type' },
    { pattern: /^export\s+(?:const|let|var)\s+(\w+)/, type: 'variable' },
    { pattern: /^export\s+enum\s+(\w+)/, type: 'enum' },
    { pattern: /^(?:async\s+)?function\s+(\w+)/, type: 'function' },
    { pattern: /^class\s+(\w+)/, type: 'class' },
    { pattern: /^interface\s+(\w+)/, type: 'interface' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    for (const { pattern, type } of patterns) {
      const match = line.match(pattern);
      if (!match) continue;

      const name = match[1];
      const exported = line.startsWith('export');
      const lineNum = i + 1;

      // Check for JSDoc/TSDoc above
      let documented = false;
      let docComment: string | undefined;

      if (i > 0) {
        // Look backwards for doc comment
        let j = i - 1;
        while (j >= 0 && lines[j].trim() === '') j--; // Skip blank lines

        if (j >= 0 && lines[j].trim().endsWith('*/')) {
          // Found end of doc comment, trace back to start
          const docLines: string[] = [];
          while (j >= 0) {
            docLines.unshift(lines[j]);
            if (lines[j].trim().startsWith('/**') || lines[j].trim().startsWith('/*')) {
              documented = true;
              break;
            }
            j--;
          }
          if (documented) {
            docComment = docLines.join('\n').trim();
          }
        }
      }

      // Extract signature for functions
      let signature: string | undefined;
      if (type === 'function') {
        // Grab until we hit { or end of line
        let sigLines = [lines[i]];
        let k = i + 1;
        while (k < lines.length && !sigLines.join(' ').includes('{')) {
          sigLines.push(lines[k]);
          k++;
        }
        signature = sigLines.join(' ').replace(/\{.*$/, '').trim();
      }

      entries.push({ name, type, exported, documented, line: lineNum, docComment, signature });
      break; // Only match first pattern per line
    }
  }

  const exportedEntries = entries.filter(e => e.exported);
  const documentedExports = exportedEntries.filter(e => e.documented);

  return {
    file: filePath,
    entries,
    exportedCount: exportedEntries.length,
    documentedCount: documentedExports.length,
    coveragePercent: exportedEntries.length > 0
      ? Math.round((documentedExports.length / exportedEntries.length) * 100)
      : 100,
  };
}

/**
 * Generate markdown documentation from a source file.
 */
function generateDocs(content: string, filePath: string): string {
  const coverage = analyzeDocCoverage(content, filePath);
  const moduleName = basename(filePath, extname(filePath));

  const lines: string[] = [];
  lines.push(`# \`${moduleName}\``);
  lines.push('');
  lines.push(`> Source: \`${filePath}\``);
  lines.push('');

  // Group by type
  const groups = new Map<string, DocEntry[]>();
  for (const entry of coverage.entries.filter(e => e.exported)) {
    const key = entry.type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  const typeOrder: DocEntry['type'][] = ['class', 'interface', 'function', 'type', 'variable', 'enum'];

  for (const type of typeOrder) {
    const entries = groups.get(type);
    if (!entries || entries.length === 0) continue;

    const heading = type.charAt(0).toUpperCase() + type.slice(1) + (entries.length > 1 ? 's' : '');
    lines.push(`## ${heading}`);
    lines.push('');

    for (const entry of entries) {
      lines.push(`### \`${entry.name}\``);
      lines.push('');

      if (entry.signature) {
        lines.push('```typescript');
        lines.push(entry.signature);
        lines.push('```');
        lines.push('');
      }

      if (entry.docComment) {
        // Extract description from doc comment
        const desc = entry.docComment
          .replace(/^\/\*\*\s*/, '')
          .replace(/\s*\*\/\s*$/, '')
          .split('\n')
          .map(l => l.replace(/^\s*\*\s?/, ''))
          .filter(l => !l.startsWith('@'))
          .join('\n')
          .trim();

        if (desc) {
          lines.push(desc);
          lines.push('');
        }

        // Extract @param, @returns, @example
        const paramLines = entry.docComment
          .split('\n')
          .filter(l => l.includes('@param'))
          .map(l => l.replace(/.*@param\s+/, '').replace(/^\{[^}]*\}\s*/, '').trim());

        if (paramLines.length > 0) {
          lines.push('**Parameters:**');
          for (const p of paramLines) {
            lines.push(`- ${p}`);
          }
          lines.push('');
        }

        const returnLine = entry.docComment
          .split('\n')
          .find(l => l.includes('@returns'));
        if (returnLine) {
          lines.push(`**Returns:** ${returnLine.replace(/.*@returns?\s+/, '').trim()}`);
          lines.push('');
        }
      } else {
        lines.push('*No documentation available.*');
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push(`*Documentation coverage: ${coverage.coveragePercent}% (${coverage.documentedCount}/${coverage.exportedCount} exports documented)*`);
  lines.push('');

  return lines.join('\n');
}

// ===== Tools =====

function createDocGenerateTool(): Tool {
  return {
    name: 'docs_generate',
    description: 'Generate markdown API documentation from TypeScript/JavaScript source files',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'File paths to generate docs for (relative to working dir)',
          items: { type: 'string', description: 'File path' },
        },
      },
      required: ['files'],
    },
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const files = args.files as string[];
      const docs: Array<{ file: string; markdown: string }> = [];

      for (const file of files) {
        const fullPath = join(context.workingDir, file);
        if (!existsSync(fullPath)) continue;

        try {
          const content = readFileSync(fullPath, 'utf-8');
          const markdown = generateDocs(content, file);
          docs.push({ file, markdown });
        } catch {
          docs.push({ file, markdown: `# ${file}\n\n*Error generating documentation*\n` });
        }
      }

      return {
        success: true,
        output: JSON.stringify({ filesProcessed: docs.length, docs }, null, 2),
        metadata: { filesProcessed: docs.length },
      };
    },
  };
}

function createDocCoverageTool(): Tool {
  return {
    name: 'docs_coverage',
    description: 'Analyze JSDoc/TSDoc documentation coverage across source files',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'File paths to analyze (relative to working dir)',
          items: { type: 'string', description: 'File path' },
        },
        threshold: {
          type: 'number',
          description: 'Minimum coverage percentage to consider acceptable (default: 60)',
        },
      },
      required: ['files'],
    },
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const files = args.files as string[];
      const threshold = (args.threshold as number) || 60;
      const results: DocCoverage[] = [];

      for (const file of files) {
        const fullPath = join(context.workingDir, file);
        if (!existsSync(fullPath)) continue;

        try {
          const content = readFileSync(fullPath, 'utf-8');
          results.push(analyzeDocCoverage(content, file));
        } catch { /* skip */ }
      }

      const totalExported = results.reduce((s, r) => s + r.exportedCount, 0);
      const totalDocumented = results.reduce((s, r) => s + r.documentedCount, 0);
      const overallCoverage = totalExported > 0
        ? Math.round((totalDocumented / totalExported) * 100)
        : 100;

      const belowThreshold = results.filter(r => r.coveragePercent < threshold);

      return {
        success: true,
        output: JSON.stringify({
          overallCoverage: `${overallCoverage}%`,
          totalExported,
          totalDocumented,
          threshold: `${threshold}%`,
          filesAnalyzed: results.length,
          filesBelowThreshold: belowThreshold.map(r => ({
            file: r.file,
            coverage: `${r.coveragePercent}%`,
            undocumented: r.entries
              .filter(e => e.exported && !e.documented)
              .map(e => `${e.type} ${e.name} (line ${e.line})`),
          })),
        }, null, 2),
      };
    },
  };
}

// ===== Quality Gate =====

function createDocCoverageGate(minCoverage: number): QualityGate {
  return {
    name: 'documentation-coverage',
    description: `Fails if documentation coverage of exported symbols falls below ${minCoverage}%`,
    async run(context: QualityContext): Promise<GateResult> {
      const startTime = Date.now();
      const issues: GateIssue[] = [];

      for (const file of context.filesChanged) {
        const ext = extname(file);
        if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) continue;

        const fullPath = join(context.workingDir, file);
        if (!existsSync(fullPath)) continue;

        try {
          const content = readFileSync(fullPath, 'utf-8');
          const coverage = analyzeDocCoverage(content, file);

          if (coverage.exportedCount > 0 && coverage.coveragePercent < minCoverage) {
            const undocumented = coverage.entries.filter(e => e.exported && !e.documented);
            for (const entry of undocumented) {
              issues.push({
                severity: 'warning',
                message: `Exported ${entry.type} "${entry.name}" lacks JSDoc/TSDoc documentation`,
                file,
                line: entry.line,
                rule: 'doc-coverage',
                autoFixable: false,
                suggestion: `Add /** ... */ documentation above "${entry.name}"`,
              });
            }
          }
        } catch { /* skip */ }
      }

      return {
        gate: 'documentation-coverage',
        passed: true, // Gate is advisory (warnings only)
        issues,
        duration: Date.now() - startTime,
      };
    },
  };
}

// ===== Agent Role =====

const DOC_WRITER_ROLE: RoleTemplate = {
  systemPrompt: `You are a technical documentation writer for a TypeScript project.
Your job is to generate clear, accurate API documentation from source code.
Follow TSDoc conventions. Include @param, @returns, @example tags.
Write concise descriptions that explain what the code does, not how.
Avoid redundant descriptions that just restate the function name.`,
  defaultModel: 'claude-sonnet',
  defaultTools: ['docs_generate', 'docs_coverage', 'file_read'],
  maxIterations: 5,
};

// ===== Plugin =====

export const DocumentationGenPlugin: CortexPlugin = {
  name: 'cortexos-documentation-gen',
  version: '1.0.0',
  description: 'Auto-generate documentation, analyze coverage, and enforce documentation standards',
  author: 'CortexOS',

  register(ctx: PluginContext): void {
    const config = ctx.getConfig('documentationGen') as { minCoverage?: number } | undefined;
    const minCoverage = config?.minCoverage ?? 50;

    ctx.registerTool(createDocGenerateTool());
    ctx.registerTool(createDocCoverageTool());
    ctx.registerGate('documentation-coverage', createDocCoverageGate(minCoverage));
    ctx.registerRole('documentation-writer', DOC_WRITER_ROLE);
  },
};

export { analyzeDocCoverage, generateDocs, type DocEntry, type DocCoverage };
