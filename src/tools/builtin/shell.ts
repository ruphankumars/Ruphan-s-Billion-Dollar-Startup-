import { execSync } from 'child_process';
import type { Tool, ToolParameters, ToolContext, ToolResult } from '../types.js';

export class ShellTool implements Tool {
  name = 'shell';
  description = 'Execute a shell command and return its output. Use for running tests, installing packages, or other shell operations.';
  parameters: ToolParameters = {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds', default: 30000 },
    },
    required: ['command'],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const command = args.command as string;
    const timeout = (args.timeout as number) || 30000;

    // Safety checks
    const dangerous = ['rm -rf /', 'rm -rf ~', 'mkfs', 'dd if=', ':(){', 'chmod -R 777 /'];
    for (const pattern of dangerous) {
      if (command.includes(pattern)) {
        return { success: false, output: '', error: `Blocked dangerous command: "${pattern}"` };
      }
    }

    try {
      const output = execSync(command, {
        cwd: context.workingDir,
        encoding: 'utf-8',
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      });

      const truncated = output.length > 10000
        ? output.substring(0, 10000) + '\n\n[... output truncated at 10000 chars ...]'
        : output;

      return {
        success: true,
        output: truncated.trim(),
        metadata: { command, fullLength: output.length },
      };
    } catch (err) {
      const execErr = err as Error & { stdout?: string; stderr?: string; status?: number };
      const output = (execErr.stdout || '') + (execErr.stderr || '');
      const truncated = output.length > 5000
        ? output.substring(0, 5000) + '\n\n[... truncated ...]'
        : output;

      return {
        success: false,
        output: truncated.trim(),
        error: `Command exited with code ${execErr.status || 1}: ${execErr.message.substring(0, 200)}`,
      };
    }
  }
}
