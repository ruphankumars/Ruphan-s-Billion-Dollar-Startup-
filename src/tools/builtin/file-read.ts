import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Tool, ToolParameters, ToolContext, ToolResult } from '../types.js';

export class FileReadTool implements Tool {
  name = 'file_read';
  description = 'Read the contents of a file. Returns the file content with line numbers.';
  parameters: ToolParameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read (relative to working directory)' },
      offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
      limit: { type: 'number', description: 'Maximum number of lines to read' },
    },
    required: ['path'],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = resolve(context.workingDir, args.path as string);
    const offset = (args.offset as number) || 1;
    const limit = (args.limit as number) || 10000;

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const startLine = Math.max(0, offset - 1);
      const endLine = Math.min(lines.length, startLine + limit);
      const selectedLines = lines.slice(startLine, endLine);

      const numbered = selectedLines
        .map((line, i) => `${String(startLine + i + 1).padStart(5)} | ${line}`)
        .join('\n');

      return {
        success: true,
        output: numbered,
        metadata: { lineCount: lines.length, path: filePath },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Failed to read file: ${message}` };
    }
  }
}
