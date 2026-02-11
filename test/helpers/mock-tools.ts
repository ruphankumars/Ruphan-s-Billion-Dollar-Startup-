/**
 * Mock Tools for Testing
 */

import type { Tool, ToolResult, ToolContext } from '../../src/tools/types.js';

export function createMockTool(name: string, result?: string): Tool {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input parameter' },
      },
      required: [],
    },
    execute: async (args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
      return {
        success: true,
        output: result ?? `Mock result from ${name}`,
      };
    },
  };
}

export function createFailingTool(name: string, errorMessage: string): Tool {
  return {
    name,
    description: `Failing mock ${name} tool`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async (): Promise<ToolResult> => {
      return {
        success: false,
        output: '',
        error: errorMessage,
      };
    },
  };
}
