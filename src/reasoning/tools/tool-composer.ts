/**
 * ToolComposer — Creates composite tools from primitive tool sequences.
 *
 * Allows the reasoning system to compose multi-step tool workflows
 * (e.g., "read file → edit → run tests") into single callable tools.
 * Each composite tool executes its steps sequentially, piping outputs.
 *
 * Part of the Tool Discovery module for the Reasoning system.
 */

import type { Tool, ToolContext, ToolResult, ToolParameters } from '../../tools/types.js';
import { getLogger } from '../../core/logger.js';

const logger = getLogger();

export interface ToolStep {
  toolName: string;
  argMapping: Record<string, string | { literal: unknown }>;
}

export interface CompositeToolDef {
  name: string;
  description: string;
  parameters: ToolParameters;
  steps: ToolStep[];
}

export class ToolComposer {
  private toolMap: Map<string, Tool>;

  constructor(tools: Tool[]) {
    this.toolMap = new Map(tools.map(t => [t.name, t]));
  }

  /**
   * Create a composite tool from a definition.
   * The composite tool runs each step in sequence.
   */
  compose(definition: CompositeToolDef): Tool {
    const composer = this;

    return {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,

      async execute(
        args: Record<string, unknown>,
        context: ToolContext,
      ): Promise<ToolResult> {
        const stepResults: ToolResult[] = [];
        let lastOutput = '';

        for (let i = 0; i < definition.steps.length; i++) {
          const step = definition.steps[i];
          const tool = composer.toolMap.get(step.toolName);

          if (!tool) {
            return {
              success: false,
              output: '',
              error: `Composite tool step ${i + 1}: tool "${step.toolName}" not found`,
            };
          }

          // Resolve argument mappings
          const stepArgs: Record<string, unknown> = {};
          for (const [paramName, mapping] of Object.entries(step.argMapping)) {
            if (typeof mapping === 'object' && mapping !== null && 'literal' in mapping) {
              stepArgs[paramName] = mapping.literal;
            } else if (typeof mapping === 'string') {
              if (mapping === '$prev_output') {
                stepArgs[paramName] = lastOutput;
              } else if (mapping.startsWith('$args.')) {
                const argKey = mapping.slice(6);
                stepArgs[paramName] = args[argKey];
              } else if (mapping.startsWith('$step.')) {
                const [, stepIdx, field] = mapping.match(/^\$step\.(\d+)\.(.+)$/) ?? [];
                if (stepIdx !== undefined && field) {
                  const prevResult = stepResults[parseInt(stepIdx, 10)];
                  if (prevResult) {
                    stepArgs[paramName] = field === 'output'
                      ? prevResult.output
                      : prevResult.metadata?.[field];
                  }
                }
              } else {
                stepArgs[paramName] = mapping;
              }
            }
          }

          logger.debug(
            { composite: definition.name, step: i + 1, tool: step.toolName },
            'ToolComposer: executing step',
          );

          const result = await tool.execute(stepArgs, context);
          stepResults.push(result);
          lastOutput = result.output;

          // Abort on failure
          if (!result.success) {
            return {
              success: false,
              output: stepResults.map((r, idx) =>
                `Step ${idx + 1} (${definition.steps[idx].toolName}): ${r.success ? 'OK' : 'FAILED'} - ${r.output || r.error}`
              ).join('\n'),
              error: `Composite tool failed at step ${i + 1} (${step.toolName}): ${result.error}`,
              metadata: {
                failedStep: i + 1,
                stepResults: stepResults.map(r => ({ success: r.success, output: r.output.substring(0, 200) })),
              },
            };
          }
        }

        return {
          success: true,
          output: lastOutput,
          metadata: {
            stepsCompleted: stepResults.length,
            stepResults: stepResults.map(r => ({ success: r.success, output: r.output.substring(0, 200) })),
          },
        };
      },
    };
  }

  /**
   * Create a "read then edit" composite tool.
   */
  createReadEditTool(): Tool | null {
    if (!this.toolMap.has('file_read') || !this.toolMap.has('file_edit')) {
      return null;
    }

    return this.compose({
      name: 'read_and_edit',
      description: 'Read a file and then apply an edit to it in one operation',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read and edit' },
          old_text: { type: 'string', description: 'Text to find and replace' },
          new_text: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
      steps: [
        {
          toolName: 'file_read',
          argMapping: { path: '$args.path' },
        },
        {
          toolName: 'file_edit',
          argMapping: {
            path: '$args.path',
            old_text: '$args.old_text',
            new_text: '$args.new_text',
          },
        },
      ],
    });
  }

  /**
   * Create a "search then read" composite tool.
   */
  createSearchReadTool(): Tool | null {
    if (!this.toolMap.has('file_search') || !this.toolMap.has('file_read')) {
      return null;
    }

    return this.compose({
      name: 'search_and_read',
      description: 'Search for files matching a pattern then read the first match',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern' },
        },
        required: ['pattern'],
      },
      steps: [
        {
          toolName: 'file_search',
          argMapping: { pattern: '$args.pattern' },
        },
        {
          toolName: 'file_read',
          argMapping: { path: '$prev_output' },
        },
      ],
    });
  }

  /**
   * Get all composable tool pairs.
   */
  getAvailableComposites(): Tool[] {
    const composites: Tool[] = [];

    const readEdit = this.createReadEditTool();
    if (readEdit) composites.push(readEdit);

    const searchRead = this.createSearchReadTool();
    if (searchRead) composites.push(searchRead);

    return composites;
  }
}
