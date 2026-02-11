import type { ToolResult, ToolContext } from './types.js';
import type { ToolRegistry } from './registry.js';
import { getLogger } from '../core/logger.js';
import { ToolError } from '../core/errors.js';

export class ToolExecutor {
  private logger = getLogger();

  constructor(
    private registry: ToolRegistry,
    private context: ToolContext,
  ) {}

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.logger.debug({ tool: name, args: Object.keys(args) }, 'Executing tool');

    try {
      const tool = this.registry.get(name);
      const result = await tool.execute(args, this.context);

      this.logger.debug({ tool: name, success: result.success }, 'Tool result');
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ tool: name, error: message }, 'Tool execution failed');

      return {
        success: false,
        output: '',
        error: `Tool "${name}" failed: ${message}`,
      };
    }
  }
}
