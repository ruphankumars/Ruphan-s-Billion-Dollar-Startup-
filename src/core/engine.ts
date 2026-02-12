/**
 * CortexEngine — The Central Orchestrator
 * 8-Stage Pipeline: RECALL → ENHANCE → ANALYZE → DECOMPOSE → PLAN → EXECUTE → VERIFY → MEMORIZE
 *
 * This is the heart of CortexOS. It takes a raw user prompt and runs it
 * through the full pipeline, producing verified results with stored memories.
 */

import type { ExecutionResult, CortexConfig, AgentResult, FileChange, QualityReport } from './types.js';
import { ExecutionContext } from './context.js';
import { EventBus } from './events.js';
import { getLogger } from './logger.js';

// Subsystems
import { PromptAnalyzer } from '../prompt/analyzer.js';
import { PromptEnhancer } from '../prompt/enhancer.js';
import { PromptDecomposer } from '../prompt/decomposer.js';
import { ExecutionPlanner } from '../prompt/planner.js';
import type { PromptAnalysis, EnhancedPrompt, DecomposedTask, RepoContext } from '../prompt/types.js';

import { CortexMemoryManager } from '../memory/manager.js';
import { MemoryExtractor } from '../memory/pipeline/extractor.js';
import type { MemoryRecallResult, MemoryConfig } from '../memory/types.js';

import { Agent } from '../agents/agent.js';
import { SwarmCoordinator } from '../agents/coordinator.js';
import { AgentPool } from '../agents/pool.js';
import { WorktreeManager } from '../agents/sandbox/worktree.js';
import { MergeManager } from '../agents/sandbox/merger.js';
import { MessageBus } from '../agents/message-bus.js';
import { IPCMessageBus } from '../agents/ipc-bus.js';
import { HandoffManager } from '../agents/handoff.js';
import { HandoffExecutor } from '../agents/handoff-executor.js';
import { getRole } from '../agents/roles/index.js';
import type { AgentTask, AgentRole } from '../agents/types.js';

import { ProviderRegistry } from '../providers/registry.js';
import type { LLMProvider } from '../providers/types.js';

import { ToolRegistry } from '../tools/registry.js';

import { QualityVerifier } from '../quality/verifier.js';

import { CostTracker } from '../cost/tracker.js';
import { BudgetManager } from '../cost/budget.js';
import { ModelRouter } from '../cost/router.js';

import { RepoMapper } from '../code/mapper.js';

import { Tracer, type Span } from '../observability/tracer.js';
import { MetricsCollector, type RunMetric } from '../observability/metrics.js';
import { PluginRegistry } from '../plugins/registry.js';

import { ReasoningOrchestrator } from '../reasoning/orchestrator.js';

import { Timer } from '../utils/timer.js';

const logger = getLogger();

export interface EngineOptions {
  config: CortexConfig;
  projectDir: string;
}

export class CortexEngine {
  private config: CortexConfig;
  private projectDir: string;
  private events: EventBus;
  private providerRegistry: ProviderRegistry | null = null;
  private toolRegistry: ToolRegistry;
  private memoryManager: CortexMemoryManager | null = null;
  private costTracker: CostTracker;
  private budgetManager: BudgetManager;
  private modelRouter: ModelRouter;
  private analyzer: PromptAnalyzer;
  private enhancer: PromptEnhancer;
  private decomposer: PromptDecomposer;
  private planner: ExecutionPlanner;
  private verifier: QualityVerifier;
  private memoryExtractor: MemoryExtractor;
  private repoMapper: RepoMapper;
  private coordinator: SwarmCoordinator | null = null;
  private pool: AgentPool | null = null;
  private messageBus: MessageBus;
  private handoffManager: HandoffManager;
  private handoffExecutor: HandoffExecutor | null = null;
  private tracer: Tracer;
  private metrics: MetricsCollector;
  private pluginRegistry: PluginRegistry;
  private reasoningOrchestrator: ReasoningOrchestrator | null = null;
  private initialized = false;

  constructor(options: EngineOptions) {
    this.config = options.config;
    this.projectDir = options.projectDir;
    this.events = new EventBus();

    // Initialize tools
    this.toolRegistry = ToolRegistry.createDefault();

    // Initialize cost management
    this.costTracker = new CostTracker('engine');
    this.budgetManager = new BudgetManager({
      perRun: this.config.budget?.maxCostPerRun ?? this.config.cost?.budgetPerRun ?? 5.0,
      perDay: this.config.budget?.maxCostPerDay ?? this.config.cost?.budgetPerDay ?? 50.0,
    });
    this.modelRouter = new ModelRouter(
      this.config.defaultProvider ?? 'anthropic',
      this.config.cost?.preferCheap ?? false,
    );

    // Initialize intelligence systems
    this.analyzer = new PromptAnalyzer();
    this.enhancer = new PromptEnhancer();
    this.decomposer = new PromptDecomposer();
    this.planner = new ExecutionPlanner();
    this.verifier = new QualityVerifier();
    this.memoryExtractor = new MemoryExtractor();
    this.repoMapper = new RepoMapper();

    // Initialize inter-agent communication
    this.messageBus = new MessageBus();
    this.handoffManager = new HandoffManager(this.messageBus);

    // Initialize observability
    this.tracer = new Tracer();
    this.metrics = new MetricsCollector();
    this.pluginRegistry = new PluginRegistry(this.config as Record<string, unknown>);

    // Initialize memory (if enabled)
    if (this.config.memory?.enabled !== false) {
      const memConfig: MemoryConfig = {
        enabled: true,
        globalDir: this.config.globalDir || '~/.cortexos',
        projectDir: this.projectDir,
        maxMemories: 10000,
        embeddingModel: 'local-tfidf',
        decayEnabled: true,
        decayHalfLifeDays: 30,
        minImportanceThreshold: 0.1,
        consolidationInterval: 24,
      };
      this.memoryManager = CortexMemoryManager.create(memConfig);
    }
  }

  /**
   * Initialize async components (provider registry, plugin wiring, pool, coordinator)
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.providerRegistry = await ProviderRegistry.create(this.config);

    // Wire plugin-registered tools into the tool registry
    for (const tool of this.pluginRegistry.getTools()) {
      if (!this.toolRegistry.has(tool.name)) {
        this.toolRegistry.register(tool);
        logger.debug({ tool: tool.name }, 'Plugin tool merged into tool registry');
      }
    }

    // Wire plugin-registered providers into the provider registry
    for (const [name, provider] of this.pluginRegistry.getProviders()) {
      if (!this.providerRegistry.has(name)) {
        this.providerRegistry.register(name, provider);
        logger.debug({ provider: name }, 'Plugin provider merged into provider registry');
      }
    }

    // Wire plugin-registered gates — the verifier is rebuilt with gate list
    const pluginGates = this.pluginRegistry.getGates();
    if (pluginGates.size > 0) {
      for (const [name, gate] of pluginGates) {
        this.verifier.addGate(name, gate);
        logger.debug({ gate: name }, 'Plugin gate merged into verifier');
      }
    }

    // Initialize pool + coordinator if provider is available
    const provider = this.getProviderFromRegistry();
    if (provider) {
      const tools = this.toolRegistry.list();
      const maxParallel = this.config.agents?.maxParallel ?? 4;
      const useFork = this.config.agents?.useChildProcess === true && maxParallel > 1;

      // Upgrade to IPC bus when running in fork mode
      if (useFork) {
        const ipcBus = new IPCMessageBus();
        this.messageBus = ipcBus;
        this.handoffManager = new HandoffManager(ipcBus);
      }

      // Resolve worker script relative to this module for portability
      const workerScript = new URL('../agents/worker.js', import.meta.url).pathname;

      this.pool = new AgentPool({
        maxWorkers: maxParallel,
        workerScript,
        useChildProcess: useFork,
        provider,
        tools,
        toolContext: { workingDir: this.projectDir, executionId: 'engine' },
      });

      let worktreeManager: WorktreeManager | undefined;
      let mergeManager: MergeManager | undefined;

      if (this.config.agents?.worktreesEnabled !== false) {
        worktreeManager = new WorktreeManager(this.projectDir);
        if (worktreeManager.isAvailable()) {
          mergeManager = new MergeManager(this.projectDir);
        } else {
          worktreeManager = undefined;
        }
      }

      this.coordinator = new SwarmCoordinator({
        provider,
        tools,
        toolContext: { workingDir: this.projectDir, executionId: 'engine' },
        events: this.events,
        maxParallel,
        pool: this.pool,
        worktreeManager,
        mergeManager,
        messageBus: this.messageBus,
      });

      // Start the handoff executor for async task delegation
      this.handoffExecutor = new HandoffExecutor({
        provider,
        tools,
        toolContext: { workingDir: this.projectDir, executionId: 'engine' },
        messageBus: this.messageBus,
        handoffManager: this.handoffManager,
      });
      this.handoffExecutor.start();
    }

    // Initialize reasoning orchestrator if enabled
    if (this.config.reasoning?.enabled) {
      this.reasoningOrchestrator = new ReasoningOrchestrator(
        this.config.reasoning as any,
      );

      if (this.config.reasoning.strategies?.rag?.enabled !== false) {
        await this.reasoningOrchestrator.initializeRAG(this.projectDir);
      }

      if (this.config.reasoning.strategies?.toolDiscovery?.enabled !== false) {
        this.reasoningOrchestrator.initializeToolDiscovery(this.toolRegistry);
      }

      logger.info('CortexEngine: reasoning orchestrator initialized');
    }

    this.initialized = true;
  }

  private getProviderFromRegistry(): LLMProvider | undefined {
    if (!this.providerRegistry) return undefined;
    try { return this.providerRegistry.getDefault(); } catch { return undefined; }
  }

  /**
   * Execute the full 8-stage pipeline
   */
  async execute(prompt: string): Promise<ExecutionResult> {
    await this.ensureInitialized();

    const timer = new Timer();
    const context = new ExecutionContext(prompt, this.config);
    const trace = this.tracer.startTrace('execute', { prompt: prompt.substring(0, 100) });

    this.events.emit('engine:start', { prompt, context: context.toJSON() });
    logger.info({ prompt: prompt.substring(0, 100) }, 'Engine execution started');

    const stageSpans: Span[] = [];

    try {
      // Stage 1: RECALL
      context.setStage('recall');
      this.events.emit('stage:start', { stage: 'recall' });
      const recallSpan = this.tracer.startSpan('recall', 'stage', trace.id);
      const memories = await this.stageRecall(prompt);
      this.tracer.endSpan(recallSpan.id, 'success', { memoriesRecalled: memories.length });
      stageSpans.push(recallSpan);
      this.events.emit('stage:complete', { stage: 'recall', result: { memories: memories.length } });

      // Stage 2: ANALYZE
      context.setStage('analyze');
      this.events.emit('stage:start', { stage: 'analyze' });
      const analysis = this.stageAnalyze(prompt);
      this.events.emit('stage:complete', { stage: 'analyze', result: analysis });

      // Stage 3: ENHANCE
      context.setStage('enhance');
      this.events.emit('stage:start', { stage: 'enhance' });
      const enhanced = this.stageEnhance(prompt, analysis, memories);
      this.events.emit('stage:complete', { stage: 'enhance' });

      // Stage 4: DECOMPOSE
      context.setStage('decompose');
      this.events.emit('stage:start', { stage: 'decompose' });
      const tasks = await this.stageDecompose(prompt, analysis);
      this.events.emit('stage:complete', { stage: 'decompose', result: { tasks: tasks.length } });

      // Stage 5: PLAN
      context.setStage('plan');
      this.events.emit('stage:start', { stage: 'plan' });
      const plan = this.stagePlan(tasks);
      this.events.emit('plan:created', plan);
      this.events.emit('stage:complete', { stage: 'plan', result: plan });

      // Stage 6: EXECUTE
      context.setStage('execute');
      this.events.emit('stage:start', { stage: 'execute' });
      const results = await this.stageExecute(plan.tasks, plan.waves, enhanced, context, analysis);
      this.events.emit('stage:complete', { stage: 'execute', result: { agents: results.length } });

      // Stage 7: VERIFY
      context.setStage('verify');
      this.events.emit('stage:start', { stage: 'verify' });
      const qualityReport = await this.stageVerify(results, context);
      this.events.emit('stage:complete', { stage: 'verify', result: qualityReport });

      // Stage 8: MEMORIZE
      context.setStage('memorize');
      this.events.emit('stage:start', { stage: 'memorize' });
      const memoriesStored = await this.stageMemorize(results);
      this.events.emit('stage:complete', { stage: 'memorize', result: { stored: memoriesStored } });

      // Build final result
      const elapsed = timer.elapsed;
      const budget = this.config.budget?.maxCostPerRun ?? this.config.cost?.budgetPerRun ?? 5.0;
      const costSummary = this.costTracker.getSummary(budget);

      const executionResult: ExecutionResult = {
        success: qualityReport.passed,
        response: this.buildResponse(results),
        filesChanged: this.collectFileChanges(results),
        plan: {
          tasks: plan.tasks.map(t => ({
            id: t.id,
            title: t.title,
            role: t.role,
            status: 'completed' as const,
          })),
          waves: plan.waves,
        },
        quality: {
          passed: qualityReport.passed,
          score: qualityReport.overallScore ?? 100,
          gateResults: (qualityReport.results ?? []).map((r: any) => ({
            gate: r.gate,
            passed: r.passed,
            issues: r.issues?.length ?? 0,
          })),
        },
        cost: {
          totalTokens: costSummary.totalTokens,
          totalCost: costSummary.totalCost,
          breakdown: costSummary.modelBreakdown.map((m: any) => ({
            model: m.model,
            tokens: m.inputTokens + m.outputTokens,
            cost: m.cost,
          })),
        },
        duration: elapsed,
        memoriesRecalled: memories.length,
        memoriesStored,
      };

      context.setStage('complete');
      this.tracer.endSpan(trace.id, executionResult.success ? 'success' : 'error', {
        duration: elapsed,
        totalCost: costSummary.totalCost,
      });

      // Record metrics
      this.metrics.record({
        runId: context.id,
        timestamp: Date.now(),
        duration: elapsed,
        success: executionResult.success,
        prompt: prompt.substring(0, 200),
        stages: stageSpans.map(s => ({
          name: s.name,
          duration: s.duration || 0,
          success: s.status === 'success',
        })),
        agents: results.map(r => ({
          taskId: r.taskId,
          role: 'developer',
          duration: 0,
          success: r.success,
          tokensUsed: r.tokensUsed?.total || 0,
          toolCalls: 0,
          iterations: 0,
        })),
        cost: {
          totalTokens: costSummary.totalTokens,
          totalCost: costSummary.totalCost,
          inputTokens: costSummary.totalInputTokens ?? 0,
          outputTokens: costSummary.totalOutputTokens ?? 0,
          modelBreakdown: costSummary.modelBreakdown.map((m: any) => ({
            model: m.model,
            tokens: m.inputTokens + m.outputTokens,
            cost: m.cost,
          })),
        },
        quality: {
          passed: qualityReport.passed,
          score: qualityReport.overallScore ?? 100,
          gatesRun: qualityReport.results?.length ?? 0,
          issuesFound: qualityReport.results?.reduce((sum: number, r: any) => sum + (r.issues?.length ?? 0), 0) ?? 0,
        },
        memory: {
          recalled: memories.length,
          stored: memoriesStored,
        },
      });

      this.events.emit('engine:complete', executionResult);
      logger.info({ duration: elapsed, cost: costSummary.totalCost }, 'Engine execution completed');

      return executionResult;
    } catch (error) {
      const elapsed = timer.elapsed;
      const err = error instanceof Error ? error : new Error(String(error));

      this.tracer.endSpan(trace.id, 'error', { error: err.message });
      logger.error({ error: err.message, duration: elapsed }, 'Engine execution failed');
      this.events.emit('engine:error', { error: err.message });

      return {
        success: false,
        response: `Error: ${err.message}`,
        filesChanged: [],
        plan: { tasks: [], waves: [] },
        quality: { passed: false, score: 0, gateResults: [] },
        cost: { totalTokens: 0, totalCost: 0, breakdown: [] },
        duration: elapsed,
        memoriesRecalled: 0,
        memoriesStored: 0,
      };
    }
  }

  // ─── Stage Implementations ───────────────────────────────────────────

  private async stageRecall(prompt: string): Promise<MemoryRecallResult[]> {
    if (!this.memoryManager) return [];
    try {
      return await this.memoryManager.recall({ text: prompt, maxResults: 10 });
    } catch (error) {
      logger.warn({ error }, 'Memory recall failed');
      return [];
    }
  }

  private stageAnalyze(prompt: string): PromptAnalysis {
    return this.analyzer.analyze(prompt);
  }

  private stageEnhance(
    prompt: string,
    analysis: PromptAnalysis,
    memories: MemoryRecallResult[],
  ): EnhancedPrompt {
    let repoContext: RepoContext | null = null;
    try {
      const mapResult = this.repoMapper.generateMap({
        rootDir: this.projectDir,
        maxFiles: 200,
        includeSymbols: true,
      });
      repoContext = {
        rootDir: this.projectDir,
        languages: mapResult.languages,
        configFiles: [],
        repoMap: mapResult.map,
        totalFiles: mapResult.totalFiles,
      };
    } catch (error) {
      logger.warn({ error }, 'Failed to generate repo map');
    }
    return this.enhancer.enhance(prompt, analysis, memories, repoContext);
  }

  private async stageDecompose(prompt: string, analysis: PromptAnalysis): Promise<DecomposedTask[]> {
    return this.decomposer.decompose(prompt, analysis);
  }

  private stagePlan(tasks: DecomposedTask[]) {
    return this.planner.plan(tasks);
  }

  private async stageExecute(
    tasks: DecomposedTask[],
    waves: Array<{ waveNumber: number; taskIds: string[]; canParallelize: boolean }>,
    enhanced: EnhancedPrompt,
    context: ExecutionContext,
    analysis?: PromptAnalysis,
  ): Promise<AgentResult[]> {
    // If coordinator is available, delegate wave execution to it
    if (this.coordinator) {
      try {
        return await this.coordinator.executeWaves(tasks, waves);
      } catch (error) {
        logger.warn({ error }, 'Coordinator execution failed, falling back to inline execution');
        // Fall through to inline execution
      }
    }

    // Inline fallback: direct Promise.all per wave
    const allResults: AgentResult[] = [];
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    for (const wave of waves) {
      this.events.emit('wave:start', { wave: wave.waveNumber, tasks: wave.taskIds });

      const waveResults = await Promise.all(
        wave.taskIds.map(taskId => {
          const task = taskMap.get(taskId);
          if (!task) {
            return Promise.resolve<AgentResult>({
              taskId,
              success: false,
              response: 'Task not found',
              error: 'Task not found in plan',
            });
          }
          return this.executeTask(task, enhanced, context, analysis);
        }),
      );

      allResults.push(...waveResults);
      this.events.emit('wave:complete', { wave: wave.waveNumber });
    }

    return allResults;
  }

  private async executeTask(
    task: DecomposedTask,
    enhanced: EnhancedPrompt,
    context: ExecutionContext,
    analysis?: PromptAnalysis,
  ): Promise<AgentResult> {
    try {
      this.events.emit('agent:start', { taskId: task.id, role: task.role });

      const provider = this.getProvider();
      if (!provider) {
        return {
          taskId: task.id,
          success: false,
          response: 'No LLM provider available',
          error: `No LLM provider available for role: ${task.role}`,
        };
      }

      let role: AgentRole;
      try {
        role = getRole(task.role as any);
      } catch {
        role = getRole('developer');
      }

      const toolNames = role.defaultTools ?? [];
      const tools = toolNames
        .map((name: string) => this.toolRegistry.get(name))
        .filter((t: any): t is any => !!t);

      const agentOptions = {
        role: task.role as any,
        provider,
        tools,
        toolContext: {
          workingDir: this.projectDir,
          executionId: context.id,
        },
        maxIterations: this.config.agents?.maxIterations ?? 20,
        systemPrompt: enhanced.systemPrompt,
      };

      const agentTask: AgentTask = {
        id: task.id,
        description: task.description,
        role: task.role as any,
        dependencies: task.dependencies,
        wave: 0,
        context: [enhanced.userPrompt, task.context].filter(Boolean).join('\n\n'),
      };

      // Use reasoning orchestrator if available, otherwise plain Agent
      let result: AgentResult;
      if (this.reasoningOrchestrator && analysis) {
        result = await this.reasoningOrchestrator.execute(agentOptions, agentTask, analysis);
      } else {
        const agent = new Agent(agentOptions);
        result = await agent.execute(agentTask);
      }

      if (result.tokensUsed) {
        this.costTracker.record({
          model: role.defaultModel || 'balanced',
          provider: this.config.defaultProvider ?? 'anthropic',
          inputTokens: result.tokensUsed.input,
          outputTokens: result.tokensUsed.output,
        });
        context.addTokens(result.tokensUsed.input, result.tokensUsed.output);
      }

      this.events.emit('agent:complete', { taskId: task.id, role: task.role, success: result.success });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ taskId: task.id, error: err.message }, 'Task execution failed');
      this.events.emit('agent:error', { taskId: task.id, error: err.message });

      return {
        taskId: task.id,
        success: false,
        response: `Task failed: ${err.message}`,
        error: err.message,
      };
    }
  }

  private async stageVerify(results: AgentResult[], context: ExecutionContext): Promise<QualityReport> {
    const allChanges = this.collectFileChanges(results);
    const filePaths = allChanges.map(c => c.path);

    return this.verifier.verify({
      workingDir: this.projectDir,
      filesChanged: filePaths,
      executionId: context.id,
    });
  }

  private async stageMemorize(results: AgentResult[]): Promise<number> {
    if (!this.memoryManager) return 0;
    let stored = 0;
    for (const result of results) {
      try {
        const memories = this.memoryExtractor.extractFromResult(result, this.projectDir);
        for (const memory of memories) {
          await this.memoryManager.store(memory.content, memory.options);
          stored++;
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to store memory');
      }
    }
    return stored;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private getProvider(): LLMProvider | undefined {
    if (!this.providerRegistry) return undefined;
    try {
      return this.providerRegistry.getDefault();
    } catch {
      return undefined;
    }
  }

  private buildResponse(results: AgentResult[]): string {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const parts: string[] = [];
    for (const result of successful) {
      parts.push(result.response);
    }
    if (failed.length > 0) {
      parts.push(`\n⚠️ ${failed.length} task(s) had issues:`);
      for (const result of failed) {
        parts.push(`- ${result.error || 'Unknown error'}`);
      }
    }
    return parts.join('\n\n');
  }

  private collectFileChanges(results: AgentResult[]): FileChange[] {
    const changes: FileChange[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      if (result.filesChanged) {
        for (const change of result.filesChanged) {
          if (!seen.has(change.path)) {
            changes.push(change);
            seen.add(change.path);
          }
        }
      }
    }
    return changes;
  }

  getEventBus(): EventBus {
    return this.events;
  }

  getTracer(): Tracer {
    return this.tracer;
  }

  getMetrics(): MetricsCollector {
    return this.metrics;
  }

  getPluginRegistry(): PluginRegistry {
    return this.pluginRegistry;
  }

  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  getHandoffExecutor(): HandoffExecutor | null {
    return this.handoffExecutor;
  }

  async shutdown(): Promise<void> {
    if (this.handoffExecutor) {
      await this.handoffExecutor.stop();
    }
    if (this.pool) {
      await this.pool.shutdown();
    }
    this.messageBus.destroy();
    if (this.memoryManager) {
      await this.memoryManager.close();
    }
  }

  static create(options: EngineOptions): CortexEngine {
    return new CortexEngine(options);
  }
}
