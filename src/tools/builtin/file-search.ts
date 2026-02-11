import { glob } from 'glob';
import type { Tool, ToolParameters, ToolContext, ToolResult } from '../types.js';

export class FileSearchTool implements Tool {
  name = 'file_search';
  description = 'Search for files matching a glob pattern in the project directory.';
  parameters: ToolParameters = {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern to match files (e.g. "**/*.ts", "src/**/*.js")' },
      path: { type: 'string', description: 'Directory to search in (relative to working directory)' },
      maxResults: { type: 'number', description: 'Maximum number of results to return', default: 50 },
    },
    required: ['pattern'],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const pattern = args.pattern as string;
    const searchPath = args.path as string || '.';
    const maxResults = (args.maxResults as number) || 50;

    try {
      const cwd = searchPath === '.' ? context.workingDir : `${context.workingDir}/${searchPath}`;
      const files = await glob(pattern, {
        cwd,
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'coverage/**', '.cortexos/**'],
        maxDepth: 15,
      });

      const limited = files.slice(0, maxResults);
      const output = limited.length > 0
        ? limited.join('\n')
        : 'No files found matching the pattern.';

      return {
        success: true,
        output: files.length > maxResults
          ? `${output}\n\n... and ${files.length - maxResults} more files`
          : output,
        metadata: { totalMatches: files.length, returned: limited.length },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `File search failed: ${message}` };
    }
  }
}
