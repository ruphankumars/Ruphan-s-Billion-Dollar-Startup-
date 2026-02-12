/**
 * ThoughtTree — Tree-of-Thought reasoning.
 *
 * Generates N candidate approaches, evaluates each with LLM-based scoring,
 * selects the best, and executes it via a standard Agent.
 *
 * Based on: Yao et al. 2023 — "Tree of Thoughts: Deliberate Problem Solving with Large Language Models"
 */

import type { LLMProvider } from '../../providers/types.js';
import type { AgentTask } from '../../agents/types.js';
import type { PromptAnalysis } from '../../prompt/types.js';
import type { TokenUsage } from '../../core/types.js';
import type {
  CandidateApproach,
  ReasoningResult,
  ThoughtStep,
  ReasoningTrace,
} from '../types.js';
import type { AgentOptions } from '../../agents/agent.js';
import { Agent } from '../../agents/agent.js';
import { ThoughtEvaluator } from './evaluator.js';
import { getLogger } from '../../core/logger.js';

const logger = getLogger();

interface ThoughtTreeConfig {
  candidates: number;
  complexityThreshold: number;
}

export class ThoughtTree {
  private config: ThoughtTreeConfig;
  private agentOptions: AgentOptions;
  private provider: LLMProvider;
  private evaluator: ThoughtEvaluator;

  constructor(config: ThoughtTreeConfig, agentOptions: AgentOptions) {
    this.config = config;
    this.agentOptions = agentOptions;
    this.provider = agentOptions.provider;
    this.evaluator = new ThoughtEvaluator(this.provider);
  }

  /**
   * Solve a task using Tree-of-Thought reasoning.
   *
   * 1. Generate N candidate approaches
   * 2. Score all candidates via ThoughtEvaluator
   * 3. Select the highest-scored candidate
   * 4. Execute via Agent with selected approach in context
   */
  async solve(task: AgentTask, analysis: PromptAnalysis): Promise<ReasoningResult> {
    const startTime = Date.now();
    const steps: ThoughtStep[] = [];
    const totalTokens: TokenUsage = { input: 0, output: 0, total: 0 };

    logger.info(
      { taskId: task.id, candidates: this.config.candidates },
      'ThoughtTree: generating candidate approaches',
    );

    // Step 1: Generate candidates
    steps.push({
      type: 'action',
      content: `Generating ${this.config.candidates} candidate approaches`,
      timestamp: Date.now(),
      tokenCost: 0,
    });

    const candidates = await this.generateCandidates(task, analysis);

    steps.push({
      type: 'observation',
      content: `Generated ${candidates.length} candidates:\n${candidates.map((c) => `  ${c.id}. ${c.description}`).join('\n')}`,
      timestamp: Date.now(),
      tokenCost: 0,
    });

    // Step 2: Score all candidates
    steps.push({
      type: 'action',
      content: 'Evaluating candidate approaches via LLM scoring',
      timestamp: Date.now(),
      tokenCost: 0,
    });

    const scoredCandidates = await this.evaluator.scoreAll(candidates, task);

    for (const candidate of scoredCandidates) {
      steps.push({
        type: 'observation',
        content: `Candidate ${candidate.id} ("${candidate.description}"): score=${candidate.score.toFixed(3)}`,
        timestamp: Date.now(),
        tokenCost: 0,
      });
    }

    // Step 3: Select the best candidate
    const selected = scoredCandidates.reduce((best, current) =>
      current.score > best.score ? current : best,
    );

    steps.push({
      type: 'thought',
      content: `Selected candidate ${selected.id} ("${selected.description}") with score ${selected.score.toFixed(3)}`,
      timestamp: Date.now(),
      tokenCost: 0,
    });

    // Step 4: Execute via Agent with selected approach
    const enhancedTask: AgentTask = {
      ...task,
      context: [
        task.context ?? '',
        '',
        '## Selected Approach (Tree-of-Thought)',
        `**Approach:** ${selected.description}`,
        `**Plan:** ${selected.plan}`,
        `**Confidence Score:** ${selected.score.toFixed(3)}`,
        '',
        'Follow this approach to complete the task.',
      ].join('\n'),
    };

    steps.push({
      type: 'action',
      content: 'Executing task with selected approach via Agent',
      timestamp: Date.now(),
      tokenCost: 0,
    });

    const agent = new Agent(this.agentOptions);
    const agentResult = await agent.execute(enhancedTask);

    if (agentResult.tokensUsed) {
      totalTokens.input += agentResult.tokensUsed.input;
      totalTokens.output += agentResult.tokensUsed.output;
      totalTokens.total += agentResult.tokensUsed.total;
    }

    const duration = Date.now() - startTime;
    const trace: ReasoningTrace = {
      strategy: 'tree-of-thought',
      steps,
      totalTokens,
      duration,
      outcome: agentResult.success ? 'success' : 'failure',
    };

    logger.info(
      { taskId: task.id, selectedCandidate: selected.id, score: selected.score, success: agentResult.success },
      'ThoughtTree: completed',
    );

    return { ...agentResult, reasoning: trace };
  }

  /**
   * Generate N candidate approaches by prompting the LLM.
   */
  private async generateCandidates(
    task: AgentTask,
    analysis: PromptAnalysis,
  ): Promise<CandidateApproach[]> {
    const n = this.config.candidates;

    const systemPrompt = `You are an expert software architect. Generate exactly ${n} distinct approaches to solve the given task. Each approach should be meaningfully different in strategy, architecture, or implementation technique.

Respond with ONLY a JSON array:
[{ "id": 1, "description": "brief name", "plan": "2-4 sentence implementation plan" }, ...]

Do not include any other text.`;

    const contextInfo = [
      `Complexity: ${analysis.complexity}`,
      `Domains: ${analysis.domains.join(', ')}`,
      `Languages: ${analysis.languages.join(', ')}`,
      `Intent: ${analysis.intent}`,
    ].join('\n');

    try {
      const response = await this.provider.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `## Task\n${task.description}\n\n## Context\n${contextInfo}` },
        ],
        temperature: 0.7,
        maxTokens: 2048,
      });

      const match = response.content.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array found');

      const raw: unknown = JSON.parse(match[0]);
      if (!Array.isArray(raw)) throw new Error('Not an array');

      return raw.map((item: Record<string, unknown>, index: number) => ({
        id: typeof item.id === 'number' ? item.id : index + 1,
        description: String(item.description ?? `Approach ${index + 1}`),
        plan: String(item.plan ?? 'No plan provided'),
        score: 0,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ error: message }, 'ThoughtTree: candidate generation failed, using fallback');

      return [{
        id: 1,
        description: 'Direct implementation approach',
        plan: `Implement the task directly: ${task.description}`,
        score: 0,
      }];
    }
  }
}
