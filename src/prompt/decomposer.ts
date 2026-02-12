/**
 * Prompt Decomposer
 * Breaks down complex prompts into a DAG of subtasks,
 * each assigned to an appropriate agent role.
 * Uses LLM for complex decomposition, heuristics for simple tasks.
 */

import type { DecomposedTask, PromptAnalysis } from './types.js';
import type { LLMProvider } from '../providers/types.js';
import { nanoid } from 'nanoid';
import { DECOMPOSITION_TEMPLATE } from './templates/decomposition.js';

export class PromptDecomposer {
  private provider?: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider;
  }

  /**
   * Decompose a prompt into subtasks
   * Uses heuristic decomposition for simple tasks, LLM for complex ones
   */
  async decompose(
    prompt: string,
    analysis: PromptAnalysis,
  ): Promise<DecomposedTask[]> {
    if (analysis.complexity < 0.3 || analysis.estimatedSubtasks <= 1) {
      return this.heuristicDecompose(prompt, analysis);
    }

    if (this.provider) {
      try {
        return await this.llmDecompose(prompt, analysis);
      } catch {
        // Fall back to heuristic
        return this.heuristicDecompose(prompt, analysis);
      }
    }

    return this.heuristicDecompose(prompt, analysis);
  }

  /**
   * Heuristic-based decomposition for simple tasks
   */
  private heuristicDecompose(
    prompt: string,
    analysis: PromptAnalysis,
  ): DecomposedTask[] {
    const tasks: DecomposedTask[] = [];

    // Phase 1: Research/understand (if needed)
    if (analysis.intent === 'analyze' || analysis.complexity > 0.3) {
      tasks.push({
        id: nanoid(8),
        title: 'Analyze project context',
        description: `Understand the current project structure and relevant files for: ${prompt}`,
        role: 'researcher',
        dependencies: [],
        priority: 10,
        estimatedComplexity: 0.3,
        requiredTools: ['file_read', 'file_search', 'shell'],
        context: 'Read project files and understand the codebase structure.',
      });
    }

    // Step 2: Design (for complex or create tasks)
    if (analysis.intent === 'create' && analysis.complexity > 0.5) {
      const researchId = tasks.length > 0 ? tasks[0].id : undefined;
      tasks.push({
        id: nanoid(8),
        title: 'Design solution architecture',
        description: `Design the approach for: ${prompt}`,
        role: 'architect',
        dependencies: researchId ? [researchId] : [],
        priority: 9,
        estimatedComplexity: 0.5,
        requiredTools: ['file_read', 'file_search'],
        context: 'Design the solution before implementation.',
      });
    }

    // Step 3: Implement
    const implementDeps = tasks.map(t => t.id);
    tasks.push({
      id: nanoid(8),
      title: `${this.getActionVerb(analysis.intent)} implementation`,
      description: prompt,
      role: 'developer',
      dependencies: implementDeps,
      priority: 8,
      estimatedComplexity: analysis.complexity,
      requiredTools: ['file_read', 'file_write', 'file_search', 'shell', 'git'],
      context: `Primary implementation task. Intent: ${analysis.intent}`,
    });

    // Phase 4: Test (if applicable)
    if (analysis.intent !== 'analyze' && analysis.intent !== 'document') {
      const implementId = tasks[tasks.length - 1].id;
      tasks.push({
        id: nanoid(8),
        title: 'Verify implementation',
        description: `Verify and test the changes made for: ${prompt}`,
        role: 'tester',
        dependencies: [implementId],
        priority: 7,
        estimatedComplexity: 0.3,
        requiredTools: ['file_read', 'shell'],
        context: 'Run tests and verify the implementation works correctly.',
      });
    }

    // Phase 5: Validate (always)
    const validateDeps = [tasks[tasks.length - 1].id];
    tasks.push({
      id: nanoid(8),
      title: 'Quality review',
      description: `Review all changes for quality and correctness`,
      role: 'validator',
      dependencies: validateDeps,
      priority: 6,
      estimatedComplexity: 0.2,
      requiredTools: ['file_read'],
      context: 'Final quality check on all changes.',
    });

    return tasks;
  }

  /**
   * LLM-based decomposition for complex tasks
   */
  private async llmDecompose(
    prompt: string,
    analysis: PromptAnalysis,
  ): Promise<DecomposedTask[]> {
    if (!this.provider) {
      return this.heuristicDecompose(prompt, analysis);
    }

    const systemPrompt = DECOMPOSITION_TEMPLATE
      .replace('{complexity}', analysis.complexity.toFixed(2))
      .replace('{domains}', analysis.domains.join(', '))
      .replace('{languages}', analysis.languages.join(', ') || 'auto-detect')
      .replace('{intent}', analysis.intent);

    const response = await this.provider.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Decompose this task into subtasks:\n\n${prompt}\n\nReturn a JSON array of tasks with: id, title, description, role, dependencies (array of ids), priority (1-10), estimatedComplexity (0-1), requiredTools (array), context.`,
        },
      ],
      temperature: 0.3,
      maxTokens: 2000,
    });

    try {
      // Extract JSON from response
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return this.heuristicDecompose(prompt, analysis);
      }

      const parsed = JSON.parse(jsonMatch[0]) as DecomposedTask[];

      // Validate and normalize
      return parsed.map(task => ({
        id: task.id || nanoid(8),
        title: task.title || 'Unnamed task',
        description: task.description || '',
        role: this.validateRole(task.role),
        dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
        priority: Math.min(10, Math.max(1, task.priority || 5)),
        estimatedComplexity: Math.min(1, Math.max(0, task.estimatedComplexity || 0.5)),
        requiredTools: Array.isArray(task.requiredTools) ? task.requiredTools : [],
        context: task.context || '',
      }));
    } catch {
      return this.heuristicDecompose(prompt, analysis);
    }
  }

  /**
   * Get action verb for intent
   */
  private getActionVerb(intent: string): string {
    const verbs: Record<string, string> = {
      create: 'Create',
      modify: 'Update',
      fix: 'Fix',
      refactor: 'Refactor',
      test: 'Test',
      document: 'Document',
      analyze: 'Analyze',
      optimize: 'Optimize',
      deploy: 'Deploy',
    };
    return verbs[intent] || 'Execute';
  }

  /**
   * Validate role name
   */
  private validateRole(role: string): string {
    const validRoles = ['orchestrator', 'researcher', 'developer', 'architect', 'tester', 'validator', 'ux-agent'];
    return validRoles.includes(role) ? role : 'developer';
  }
}
