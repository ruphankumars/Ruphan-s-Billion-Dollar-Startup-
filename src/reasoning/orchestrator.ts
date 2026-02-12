/**
 * ReasoningOrchestrator — Central coordinator for advanced reasoning strategies.
 *
 * Selects the appropriate reasoning strategy based on task complexity:
 * - complexity < 0.3  → Passthrough (plain Agent)
 * - 0.3 ≤ c < 0.6    → ReAct (thought-action-observation loop)
 * - 0.6 ≤ c < 0.8    → Tree-of-Thought (generate + evaluate candidates)
 * - complexity ≥ 0.8  → Multi-Agent Debate (diverse perspectives + judge)
 * - On failure         → Reflexion retry (self-reflection + retry)
 *
 * RAG and Tool Discovery are always-on augmentations injected before execution.
 */

import type { LLMProvider } from '../providers/types.js';
import type { AgentTask } from '../agents/types.js';
import type { PromptAnalysis } from '../prompt/types.js';
import type { Tool } from '../tools/types.js';
import type { AgentOptions } from '../agents/agent.js';
import type { ReasoningConfig, ReasoningResult } from './types.js';
import { DEFAULT_REASONING_CONFIG } from './types.js';
import { Agent } from '../agents/agent.js';
import { ReActAgent } from './react/react-agent.js';
import { ReflexionEngine } from './reflexion/reflexion-engine.js';
import { ThoughtTree } from './tot/thought-tree.js';
import { DebateArena } from './debate/debate-arena.js';
import { RAGProvider } from './rag/rag-provider.js';
import { RAGSearchTool } from './rag/rag-search-tool.js';
import { ToolChainPlanner } from './tools/tool-chain-planner.js';
import { ToolComposer } from './tools/tool-composer.js';
import type { ToolRegistry } from '../tools/registry.js';
import { getLogger } from '../core/logger.js';

const logger = getLogger();

export class ReasoningOrchestrator {
  private config: ReasoningConfig;
  private ragProvider: RAGProvider | null = null;
  private toolPlanner: ToolChainPlanner | null = null;
  private toolComposer: ToolComposer | null = null;

  constructor(config?: Partial<ReasoningConfig>) {
    this.config = { ...DEFAULT_REASONING_CONFIG, ...config };
  }

  /**
   * Initialize RAG pipeline for a project.
   */
  async initializeRAG(projectDir: string): Promise<void> {
    if (!this.config.strategies.rag.enabled) return;

    this.ragProvider = new RAGProvider({
      maxChunks: this.config.strategies.rag.maxChunks,
      chunkSize: this.config.strategies.rag.chunkSize,
      minRelevance: this.config.strategies.rag.minRelevance,
    });

    await this.ragProvider.indexProject(projectDir);
    logger.info('ReasoningOrchestrator: RAG pipeline initialized');
  }

  /**
   * Initialize Tool Discovery with the tool registry.
   */
  initializeToolDiscovery(toolRegistry: ToolRegistry): void {
    if (!this.config.strategies.toolDiscovery.enabled) return;

    const tools = toolRegistry.list();

    this.toolPlanner = new ToolChainPlanner({
      maxChainLength: this.config.strategies.toolDiscovery.maxChainLength,
    });

    this.toolComposer = new ToolComposer(tools);
    logger.info('ReasoningOrchestrator: Tool Discovery initialized');
  }

  /**
   * Execute a task with the appropriate reasoning strategy.
   */
  async execute(
    agentOptions: AgentOptions,
    task: AgentTask,
    analysis: PromptAnalysis,
  ): Promise<ReasoningResult> {
    const complexity = analysis.complexity;

    // Augment tools with RAG + composites
    const augmentedTools = this.augmentTools(agentOptions.tools ?? [], task);
    const augmentedOptions: AgentOptions = {
      ...agentOptions,
      tools: augmentedTools,
    };

    logger.info(
      { taskId: task.id, complexity, tools: augmentedTools.length },
      'ReasoningOrchestrator: selecting strategy',
    );

    // Select and execute strategy
    let result: ReasoningResult;

    if (complexity >= 0.8 && this.config.strategies.debate.enabled) {
      result = await this.executeDebate(augmentedOptions, task, analysis);
    } else if (complexity >= 0.6 && this.config.strategies.treeOfThought.enabled) {
      result = await this.executeTreeOfThought(augmentedOptions, task, analysis);
    } else if (complexity >= 0.3 && this.config.strategies.react.enabled) {
      result = await this.executeReAct(augmentedOptions, task);
    } else {
      // Passthrough — plain Agent
      result = await this.executePassthrough(augmentedOptions, task);
    }

    // Reflexion retry on failure
    if (
      !result.success &&
      this.config.strategies.reflexion.enabled &&
      this.shouldReflect(result)
    ) {
      logger.info({ taskId: task.id }, 'ReasoningOrchestrator: triggering Reflexion');
      result = await this.executeReflexion(augmentedOptions, task, result);
    }

    return result;
  }

  /**
   * Plain agent passthrough (complexity < 0.3).
   */
  private async executePassthrough(
    options: AgentOptions,
    task: AgentTask,
  ): Promise<ReasoningResult> {
    const agent = new Agent(options);
    const result = await agent.execute(task);
    return { ...result };
  }

  /**
   * ReAct reasoning loop.
   */
  private async executeReAct(
    options: AgentOptions,
    task: AgentTask,
  ): Promise<ReasoningResult> {
    const reactAgent = new ReActAgent({
      ...options,
      maxThoughts: this.config.strategies.react.maxThoughts,
    });
    return reactAgent.execute(task);
  }

  /**
   * Tree-of-Thought candidate evaluation.
   */
  private async executeTreeOfThought(
    options: AgentOptions,
    task: AgentTask,
    analysis: PromptAnalysis,
  ): Promise<ReasoningResult> {
    const tree = new ThoughtTree(
      {
        candidates: this.config.strategies.treeOfThought.candidates,
        complexityThreshold: this.config.strategies.treeOfThought.complexityThreshold,
      },
      options,
    );
    return tree.solve(task, analysis);
  }

  /**
   * Multi-Agent Debate with judge.
   */
  private async executeDebate(
    options: AgentOptions,
    task: AgentTask,
    analysis: PromptAnalysis,
  ): Promise<ReasoningResult> {
    const arena = new DebateArena(
      {
        debaters: this.config.strategies.debate.debaters,
        rounds: this.config.strategies.debate.rounds,
        complexityThreshold: this.config.strategies.debate.complexityThreshold,
      },
      options,
    );
    return arena.debate(task, analysis);
  }

  /**
   * Reflexion retry with self-reflection.
   */
  private async executeReflexion(
    options: AgentOptions,
    task: AgentTask,
    failedResult: ReasoningResult,
  ): Promise<ReasoningResult> {
    const engine = new ReflexionEngine({
      ...options,
      maxRetries: this.config.strategies.reflexion.maxRetries,
      triggerOn: this.config.strategies.reflexion.triggerOn,
    });
    return engine.reflectAndRetry(task, failedResult);
  }

  /**
   * Augment the tool list with RAG search and composite tools.
   */
  private augmentTools(baseTools: Tool[], task: AgentTask): Tool[] {
    const tools = [...baseTools];

    // Add RAG search tool if available
    if (this.ragProvider) {
      tools.push(new RAGSearchTool(this.ragProvider));
    }

    // Add composite tools
    if (this.toolComposer) {
      const composites = this.toolComposer.getAvailableComposites();
      tools.push(...composites);
    }

    // Reorder by relevance if planner is available
    if (this.toolPlanner) {
      const scored = this.toolPlanner.selectTools(tools, task);
      return scored;
    }

    return tools;
  }

  /**
   * Determine if Reflexion should be triggered.
   */
  private shouldReflect(result: ReasoningResult): boolean {
    const trigger = this.config.strategies.reflexion.triggerOn;
    if (trigger === 'failure') return !result.success;
    if (trigger === 'low-quality') return !result.success;
    if (trigger === 'both') return !result.success;
    return false;
  }

  /**
   * Get the current reasoning configuration.
   */
  getConfig(): ReasoningConfig {
    return { ...this.config };
  }
}
