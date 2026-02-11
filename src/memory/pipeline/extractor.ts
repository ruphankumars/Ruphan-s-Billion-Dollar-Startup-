/**
 * Memory Extractor
 * Extracts memories from agent interactions and outputs.
 * Identifies facts, events, patterns, and learnings worth remembering.
 */

import type { MemoryStoreOptions, MemoryType } from '../types.js';
import type { AgentResult } from '../../core/types.js';

export interface ExtractedMemory {
  content: string;
  options: MemoryStoreOptions;
}

export class MemoryExtractor {
  /**
   * Extract memories from an agent execution result
   */
  extractFromResult(result: AgentResult, project?: string): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    // Extract episodic memory (what happened)
    memories.push(this.extractEpisodic(result, project));

    // Extract semantic memories (what we learned)
    const semanticMemories = this.extractSemantic(result, project);
    memories.push(...semanticMemories);

    // Extract procedural memories (how we did it)
    if (result.success) {
      const proceduralMemories = this.extractProcedural(result, project);
      memories.push(...proceduralMemories);
    }

    return memories;
  }

  /**
   * Extract episodic memory from execution result
   */
  private extractEpisodic(result: AgentResult, project?: string): ExtractedMemory {
    const outcome = result.success ? 'succeeded' : 'failed';
    const fileCount = result.filesChanged?.length ?? 0;
    const parts = [
      `Task ${outcome}: ${result.response.substring(0, 200)}`,
    ];

    if (fileCount > 0) {
      parts.push(`Modified ${fileCount} files: ${result.filesChanged!.map(f => f.path).join(', ')}`);
    }

    if (result.tokensUsed) {
      parts.push(`Tokens used: ${result.tokensUsed.total}`);
    }

    return {
      content: parts.join('\n'),
      options: {
        type: 'episodic' as MemoryType,
        importance: result.success ? 0.5 : 0.8,
        tags: ['execution', outcome],
        entities: result.filesChanged?.map(f => f.path) ?? [],
        project,
        source: 'agent-execution',
      },
    };
  }

  /**
   * Extract semantic memories (facts/knowledge) from result
   */
  private extractSemantic(result: AgentResult, project?: string): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];
    const response = result.response;

    // Extract file structure learnings
    const filePatterns = response.match(/(?:found|created|modified|exists at)\s+[`"]?([\w/.]+\.\w+)[`"]?/gi);
    if (filePatterns) {
      const paths = new Set<string>();
      for (const match of filePatterns) {
        const path = match.replace(/^(?:found|created|modified|exists at)\s+[`"]?/i, '').replace(/[`"]?$/, '');
        if (path.includes('/') || path.includes('.')) {
          paths.add(path);
        }
      }

      if (paths.size > 0) {
        memories.push({
          content: `Project file structure includes: ${[...paths].join(', ')}`,
          options: {
            type: 'semantic',
            importance: 0.6,
            tags: ['structure', 'files'],
            entities: [...paths],
            project,
            source: 'extraction',
          },
        });
      }
    }

    // Extract technology/pattern learnings
    const techPatterns = response.match(/(?:uses?|using|built with|requires?|depends on)\s+([\w@/.]+(?:\s+[\d.]+)?)/gi);
    if (techPatterns) {
      const techs = new Set<string>();
      for (const match of techPatterns) {
        const tech = match.replace(/^(?:uses?|using|built with|requires?|depends on)\s+/i, '').trim();
        if (tech.length > 1 && tech.length < 50) {
          techs.add(tech);
        }
      }

      if (techs.size > 0) {
        memories.push({
          content: `Project technologies: ${[...techs].join(', ')}`,
          options: {
            type: 'semantic',
            importance: 0.7,
            tags: ['technology', 'dependencies'],
            entities: [...techs],
            project,
            source: 'extraction',
          },
        });
      }
    }

    // Extract error patterns from failures
    if (!result.success && result.error) {
      memories.push({
        content: `Error encountered: ${result.error.substring(0, 500)}`,
        options: {
          type: 'semantic',
          importance: 0.9,
          tags: ['error', 'debugging'],
          entities: [],
          project,
          source: 'error-extraction',
        },
      });
    }

    return memories;
  }

  /**
   * Extract procedural memories (how-to patterns) from successful results
   */
  private extractProcedural(result: AgentResult, project?: string): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    // If files were changed, remember the pattern
    if (result.filesChanged && result.filesChanged.length > 0) {
      const changeTypes = new Set(result.filesChanged.map(f => f.type));
      const extensions = new Set(
        result.filesChanged.map(f => {
          const parts = f.path.split('.');
          return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
        }).filter(Boolean),
      );

      memories.push({
        content: [
          `Procedure for similar tasks:`,
          `- Actions: ${[...changeTypes].join(', ')}`,
          `- File types: ${[...extensions].join(', ')}`,
          `- Files touched: ${result.filesChanged.length}`,
          `- Task summary: ${result.response.substring(0, 150)}`,
        ].join('\n'),
        options: {
          type: 'procedural',
          importance: 0.6,
          tags: ['procedure', 'pattern'],
          entities: [...extensions],
          project,
          source: 'pattern-extraction',
        },
      });
    }

    return memories;
  }

  /**
   * Extract memories from user feedback
   */
  extractFromFeedback(
    feedback: string,
    taskDescription: string,
    project?: string,
  ): ExtractedMemory[] {
    const memories: ExtractedMemory[] = [];

    // User feedback is high-importance semantic memory
    memories.push({
      content: `User feedback on "${taskDescription}": ${feedback}`,
      options: {
        type: 'semantic',
        importance: 0.95,
        tags: ['feedback', 'user-preference'],
        entities: [],
        project,
        source: 'user-feedback',
      },
    });

    return memories;
  }
}
