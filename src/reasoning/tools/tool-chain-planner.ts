/**
 * ToolChainPlanner — Task-aware tool selection and relevance scoring.
 *
 * Given a task description and a list of available tools, scores each tool
 * for relevance and returns a prioritized subset. Enables agents to focus
 * on the most useful tools for any given task.
 *
 * Based on: Schick et al. 2023 — "Toolformer: Language Models Can Teach Themselves to Use Tools"
 */

import type { Tool } from '../../tools/types.js';
import type { AgentTask } from '../../agents/types.js';
import { getLogger } from '../../core/logger.js';

const logger = getLogger();

export interface ToolRelevance {
  tool: Tool;
  score: number;
  reason: string;
}

export interface ToolChainPlannerConfig {
  maxChainLength: number;
  minRelevanceScore?: number;
}

/**
 * Keyword→tool-name affinity mappings.
 * Used for fast heuristic scoring without LLM calls.
 */
const KEYWORD_TOOL_AFFINITY: Record<string, string[]> = {
  // File operations
  read: ['file_read', 'rag_search'],
  write: ['file_write', 'file_edit'],
  edit: ['file_edit', 'file_write'],
  create: ['file_write', 'file_create'],
  delete: ['file_delete'],
  search: ['file_search', 'rag_search', 'grep'],
  find: ['file_search', 'rag_search'],

  // Code operations
  test: ['run_tests', 'file_read'],
  lint: ['run_lint', 'file_read'],
  compile: ['run_build', 'file_read'],
  build: ['run_build'],
  run: ['run_command', 'run_tests'],
  debug: ['file_read', 'run_command'],
  refactor: ['file_edit', 'file_read', 'rag_search'],
  fix: ['file_edit', 'file_read'],
  implement: ['file_write', 'file_edit', 'file_read'],
  optimize: ['file_edit', 'file_read', 'rag_search'],

  // Git operations
  commit: ['git_commit', 'git_status'],
  push: ['git_push'],
  branch: ['git_branch'],
  merge: ['git_merge'],
  diff: ['git_diff'],
  status: ['git_status'],

  // Analysis
  analyze: ['file_read', 'rag_search', 'file_search'],
  review: ['file_read', 'rag_search'],
  document: ['file_write', 'file_read'],
};

export class ToolChainPlanner {
  private config: ToolChainPlannerConfig;

  constructor(config: ToolChainPlannerConfig) {
    this.config = config;
  }

  /**
   * Score and rank tools by relevance to the given task.
   */
  scoreTools(tools: Tool[], task: AgentTask): ToolRelevance[] {
    const taskWords = this.extractKeywords(task.description + ' ' + (task.context ?? ''));
    const scored: ToolRelevance[] = [];

    for (const tool of tools) {
      const result = this.scoreTool(tool, taskWords, task);
      scored.push(result);
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    logger.debug(
      { taskId: task.id, scored: scored.length, topTool: scored[0]?.tool.name },
      'ToolChainPlanner: tools scored',
    );

    return scored;
  }

  /**
   * Get the top-N most relevant tools for a task.
   */
  selectTools(tools: Tool[], task: AgentTask): Tool[] {
    const scored = this.scoreTools(tools, task);
    const minScore = this.config.minRelevanceScore ?? 0.1;
    const maxTools = this.config.maxChainLength;

    return scored
      .filter(s => s.score >= minScore)
      .slice(0, maxTools)
      .map(s => s.tool);
  }

  /**
   * Score a single tool against task keywords.
   */
  private scoreTool(
    tool: Tool,
    taskKeywords: string[],
    task: AgentTask,
  ): ToolRelevance {
    let score = 0;
    const reasons: string[] = [];

    // 1. Keyword-affinity matching
    for (const keyword of taskKeywords) {
      const affinityTools = KEYWORD_TOOL_AFFINITY[keyword];
      if (affinityTools && affinityTools.includes(tool.name)) {
        score += 0.3;
        reasons.push(`keyword "${keyword}" matches`);
      }
    }

    // 2. Tool name overlap with task
    const toolNameWords = tool.name.replace(/[-_]/g, ' ').split(/\s+/);
    for (const word of toolNameWords) {
      if (taskKeywords.includes(word.toLowerCase())) {
        score += 0.2;
        reasons.push(`tool name word "${word}" in task`);
      }
    }

    // 3. Tool description overlap with task
    const descWords = this.extractKeywords(tool.description);
    const overlap = descWords.filter(w => taskKeywords.includes(w));
    if (overlap.length > 0) {
      score += Math.min(overlap.length * 0.1, 0.3);
      reasons.push(`${overlap.length} description words match`);
    }

    // 4. Role-based boost
    const roleToolBoost: Record<string, string[]> = {
      developer: ['file_write', 'file_edit', 'file_read', 'run_command'],
      tester: ['run_tests', 'file_read', 'file_write'],
      researcher: ['file_read', 'rag_search', 'file_search'],
      architect: ['file_read', 'rag_search', 'file_search'],
    };
    const roleTools = roleToolBoost[task.role] ?? [];
    if (roleTools.includes(tool.name)) {
      score += 0.15;
      reasons.push(`role "${task.role}" affinity`);
    }

    // Normalize to 0-1
    score = Math.min(1, score);

    return {
      tool,
      score,
      reason: reasons.length > 0 ? reasons.join('; ') : 'no specific relevance',
    };
  }

  /**
   * Extract lowercase keywords from text.
   */
  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  }
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was',
  'will', 'have', 'has', 'been', 'being', 'should', 'would', 'could',
  'not', 'but', 'they', 'them', 'their', 'then', 'than', 'also',
  'each', 'all', 'any', 'can', 'its', 'may', 'use', 'using',
]);
