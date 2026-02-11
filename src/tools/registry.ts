import type { Tool, ToolContext } from './types.js';
import type { ToolDefinition } from '../providers/types.js';
import { FileReadTool } from './builtin/file-read.js';
import { FileWriteTool } from './builtin/file-write.js';
import { FileSearchTool } from './builtin/file-search.js';
import { ShellTool } from './builtin/shell.js';
import { GitTool } from './builtin/git.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found. Available: ${this.list().map(t => t.name).join(', ')}`);
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.list().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as Record<string, unknown>,
    }));
  }

  getDefinitionsForNames(names: string[]): ToolDefinition[] {
    return names
      .filter(name => this.has(name))
      .map(name => {
        const tool = this.get(name);
        return {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as unknown as Record<string, unknown>,
        };
      });
  }

  static createDefault(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register(new FileReadTool());
    registry.register(new FileWriteTool());
    registry.register(new FileSearchTool());
    registry.register(new ShellTool());
    registry.register(new GitTool());
    return registry;
  }
}
