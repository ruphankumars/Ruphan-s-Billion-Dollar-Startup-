import { execSync } from 'child_process';
import type { Tool, ToolParameters, ToolContext, ToolResult } from '../types.js';

export class GitTool implements Tool {
  name = 'git';
  description = 'Execute git commands. Supports: status, diff, log, add, commit, branch, checkout.';
  parameters: ToolParameters = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Git subcommand (status, diff, log, add, commit, branch, checkout)',
        enum: ['status', 'diff', 'log', 'add', 'commit', 'branch', 'checkout'],
      },
      args: { type: 'string', description: 'Additional arguments for the git command' },
    },
    required: ['command'],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = args.command as string;
    const gitArgs = (args.args as string) || '';

    // Safety: block dangerous operations
    const blocked = ['push --force', 'push -f', 'reset --hard', 'clean -f'];
    for (const pattern of blocked) {
      if (gitArgs.includes(pattern)) {
        return { success: false, output: '', error: `Blocked dangerous git operation: ${pattern}` };
      }
    }

    const fullCommand = `git ${command} ${gitArgs}`.trim();

    try {
      const output = execSync(fullCommand, {
        cwd: context.workingDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });

      return {
        success: true,
        output: output.trim() || `git ${command} completed successfully`,
        metadata: { command: fullCommand },
      };
    } catch (err) {
      const execErr = err as Error & { stdout?: string; stderr?: string };
      return {
        success: false,
        output: (execErr.stdout || '').trim(),
        error: (execErr.stderr || execErr.message).trim(),
      };
    }
  }
}
