/**
 * Prompt Enhancer — The Super Prompt Engine (Key Differentiator)
 * Takes a raw user prompt and enhances it with:
 * 1. Relevant memories from past interactions
 * 2. Repository context (file map, tech stack, patterns)
 * 3. Chain-of-thought reasoning scaffolding
 * 4. Role-specific instructions
 */

import type { PromptAnalysis, EnhancedPrompt, RepoContext } from './types.js';
import type { MemoryRecallResult } from '../memory/types.js';
import { SYSTEM_TEMPLATE, COT_TEMPLATE } from './templates/system.js';
import { getEnhancementTemplate } from './templates/enhancement.js';

export class PromptEnhancer {
  /**
   * Enhance a raw prompt with memory, context, and CoT
   */
  enhance(
    prompt: string,
    analysis: PromptAnalysis,
    memories: MemoryRecallResult[],
    repoContext: RepoContext | null,
  ): EnhancedPrompt {
    // Build memory context
    const memoryContext = this.buildMemoryContext(memories);

    // Build repo context
    const repoCtx = this.buildRepoContext(repoContext);

    // Build chain-of-thought context
    const cotContext = this.buildCoTContext(analysis);

    // Build enhanced system prompt
    const systemPrompt = this.buildSystemPrompt(analysis, memoryContext, repoCtx);

    // Build enhanced user prompt
    const userPrompt = this.buildUserPrompt(prompt, analysis, memoryContext, repoCtx, cotContext);

    return {
      systemPrompt,
      userPrompt,
      memoryContext,
      repoContext: repoCtx,
      cotContext,
      analysis,
    };
  }

  /**
   * Build memory context from recalled memories
   */
  private buildMemoryContext(memories: MemoryRecallResult[]): string {
    if (memories.length === 0) return '';

    const sections: string[] = ['## Relevant Memories\n'];

    for (const mem of memories) {
      const typeLabel = mem.entry.type.charAt(0).toUpperCase() + mem.entry.type.slice(1);
      const score = (mem.finalScore * 100).toFixed(0);
      sections.push(
        `### [${typeLabel}] (relevance: ${score}%)\n${mem.entry.content}\n`,
      );
    }

    return sections.join('\n');
  }

  /**
   * Build repository context string
   */
  private buildRepoContext(repoContext: RepoContext | null): string {
    if (!repoContext) return '';

    const parts: string[] = ['## Repository Context\n'];

    // Languages
    if (Object.keys(repoContext.languages).length > 0) {
      const langList = Object.entries(repoContext.languages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([lang, count]) => `${lang} (${count} files)`)
        .join(', ');
      parts.push(`**Languages:** ${langList}`);
    }

    // Config files
    if (repoContext.configFiles.length > 0) {
      parts.push(`**Config Files:** ${repoContext.configFiles.join(', ')}`);
    }

    // Git info
    if (repoContext.gitBranch) {
      parts.push(`**Branch:** ${repoContext.gitBranch}`);
    }

    parts.push(`**Total Files:** ${repoContext.totalFiles}`);

    // Repository map (truncated)
    if (repoContext.repoMap) {
      const truncatedMap = repoContext.repoMap.length > 3000
        ? repoContext.repoMap.substring(0, 3000) + '\n... (truncated)'
        : repoContext.repoMap;
      parts.push(`\n### Repository Map\n\`\`\`\n${truncatedMap}\n\`\`\``);
    }

    return parts.join('\n');
  }

  /**
   * Build chain-of-thought scaffolding
   */
  private buildCoTContext(analysis: PromptAnalysis): string {
    const template = COT_TEMPLATE;

    return template
      .replace('{intent}', analysis.intent)
      .replace('{complexity}', analysis.complexity.toFixed(2))
      .replace('{domains}', analysis.domains.join(', '))
      .replace('{subtasks}', analysis.estimatedSubtasks.toString())
      .replace('{languages}', analysis.languages.join(', ') || 'auto-detect');
  }

  /**
   * Build the enhanced system prompt
   */
  private buildSystemPrompt(
    analysis: PromptAnalysis,
    memoryContext: string,
    repoContext: string,
  ): string {
    let systemPrompt = SYSTEM_TEMPLATE;

    // Inject analysis metadata
    systemPrompt = systemPrompt
      .replace('{intent}', analysis.intent)
      .replace('{complexity}', analysis.complexity.toFixed(2))
      .replace('{domains}', analysis.domains.join(', '));

    return systemPrompt;
  }

  /**
   * Build the enhanced user prompt
   */
  private buildUserPrompt(
    originalPrompt: string,
    analysis: PromptAnalysis,
    memoryContext: string,
    repoContext: string,
    cotContext: string,
  ): string {
    const enhancementTemplate = getEnhancementTemplate(analysis.intent);

    const parts: string[] = [];

    // Add memory context if available
    if (memoryContext) {
      parts.push(memoryContext);
    }

    // Add repo context if available
    if (repoContext) {
      parts.push(repoContext);
    }

    // Add CoT scaffolding for complex tasks
    if (analysis.complexity > 0.4) {
      parts.push(cotContext);
    }

    // Add the original prompt with enhancement
    parts.push(`## Task\n${originalPrompt}`);

    // Add enhancement-specific guidance
    parts.push(enhancementTemplate);

    return parts.join('\n\n');
  }
}
