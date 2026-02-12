/**
 * RAGSearchTool — Tool interface for agents to call `rag_search`.
 *
 * Wraps RAGProvider as a standard Tool so agents can naturally discover
 * and use codebase search during task execution.
 *
 * Part of the RAG pipeline for the Reasoning module.
 */

import type { Tool, ToolContext, ToolResult, ToolParameters } from '../../tools/types.js';
import type { RAGProvider } from './rag-provider.js';

export class RAGSearchTool implements Tool {
  readonly name = 'rag_search';
  readonly description = 'Search the project codebase for relevant code snippets using semantic search. Returns the most relevant chunks of code related to the query.';
  readonly parameters: ToolParameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language query describing the code you are looking for',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5)',
        default: 5,
      },
    },
    required: ['query'],
  };

  private ragProvider: RAGProvider;

  constructor(ragProvider: RAGProvider) {
    this.ragProvider = ragProvider;
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const query = String(args.query ?? '');
    const maxResults = typeof args.max_results === 'number' ? args.max_results : 5;

    if (!query) {
      return {
        success: false,
        output: '',
        error: 'Query parameter is required',
      };
    }

    try {
      const results = await this.ragProvider.search(query, maxResults);

      if (results.length === 0) {
        return {
          success: true,
          output: 'No relevant code found for the query.',
          metadata: { results: 0 },
        };
      }

      const formatted = this.ragProvider.formatContext(results);

      return {
        success: true,
        output: formatted,
        metadata: {
          results: results.length,
          topScore: results[0].score,
          files: [...new Set(results.map(r => r.chunk.relativePath))],
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: '',
        error: `RAG search failed: ${message}`,
      };
    }
  }
}
