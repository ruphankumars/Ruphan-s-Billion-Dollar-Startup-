import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import type { Tool, ToolParameters, ToolContext, ToolResult } from '../types.js';

export class FileWriteTool implements Tool {
  name = 'file_write';
  description = 'Write content to a file. Creates parent directories if they do not exist.';
  parameters: ToolParameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write (relative to working directory)' },
      content: { type: 'string', description: 'Content to write to the file' },
      createDirs: { type: 'boolean', description: 'Create parent directories if they do not exist', default: true },
    },
    required: ['path', 'content'],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const filePath = resolve(context.workingDir, args.path as string);
    const content = args.content as string;
    const createDirs = args.createDirs !== false;

    try {
      if (createDirs) {
        mkdirSync(dirname(filePath), { recursive: true });
      }
      writeFileSync(filePath, content, 'utf-8');
      const lineCount = content.split('\n').length;

      return {
        success: true,
        output: `Written ${lineCount} lines to ${args.path}`,
        metadata: { path: filePath, lineCount },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `Failed to write file: ${message}` };
    }
  }
}
