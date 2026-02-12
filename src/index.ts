/**
 * CortexOS — The Operating System for AI Agent Teams
 * Public SDK exports for programmatic usage
 *
 * @example
 * ```typescript
 * import { CortexEngine, ConfigManager } from 'cortexos';
 *
 * const config = new ConfigManager().load(process.cwd());
 * const engine = CortexEngine.create({ config, projectDir: process.cwd() });
 * const result = await engine.execute("add JWT auth with tests");
 * ```
 */

// Core
export { CortexEngine, type EngineOptions } from './core/engine.js';
export { ExecutionContext } from './core/context.js';
export { EventBus } from './core/events.js';
export { ConfigManager } from './core/config.js';
export { getLogger, setLogger } from './core/logger.js';
export {
  CortexError,
  ConfigError,
  ProviderError,
  BudgetExceededError,
  ToolError,
  MemoryError,
  QualityError,
  AgentError,
} from './core/errors.js';
export {
  ChainableError,
  ErrorAggregator,
  type ErrorContext,
  type SerializedError,
} from './core/error-chain.js';
export {
  ConfigMigrator,
  diffConfigs,
  validateConfig,
  type MigrationStep,
  type ConfigDiff,
  type ValidationDiagnostic,
} from './core/config-migration.js';
export {
  AsyncMutex,
  AsyncRWLock,
  AsyncSemaphore,
} from './core/mutex.js';
export {
  GracefulDegradation,
  type DegradationReport,
  type ComponentStatus,
} from './core/graceful.js';
export {
  StreamController,
  StreamBridge,
  formatSSE,
  createStreamPipeline,
  type StreamEvent,
  type StreamEventType,
  type StreamCallback,
} from './core/streaming.js';
export type {
  CortexConfig,
  ExecutionResult,
  ExecutionPlan,
  PlanTask,
  PlanWave,
  AgentResult,
  FileChange,
  TokenUsage,
  QualityReport,
  CostReport,
  CortexEvents,
} from './core/types.js';

// Agents
export { Agent, type AgentOptions } from './agents/agent.js';
export { SwarmCoordinator, type CoordinatorOptions } from './agents/coordinator.js';
export { AgentPool, type PoolOptions, type PoolStats } from './agents/pool.js';
export { MessageBus, type AgentMessage, type MessageType } from './agents/message-bus.js';
export { HandoffManager, type HandoffRequest } from './agents/handoff.js';
export { HandoffExecutor, type HandoffExecutorOptions } from './agents/handoff-executor.js';
export { IPCMessageBus, type IPCBusOptions, type IPCEnvelope } from './agents/ipc-bus.js';
export { getRole, getAllRoles } from './agents/roles/index.js';
export type { AgentRoleName, AgentTask, AgentConfig, AgentState, AgentRole } from './agents/types.js';

// Sandbox
export { WorktreeManager, type WorktreeInfo } from './agents/sandbox/worktree.js';
export { MergeManager, type MergeResult } from './agents/sandbox/merger.js';
export { FileLockManager } from './agents/sandbox/lock.js';

// Providers
export { BaseLLMProvider } from './providers/base.js';
export { ProviderRegistry } from './providers/registry.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { OpenAIProvider } from './providers/openai.js';
export { OpenAICompatibleProvider, type OpenAICompatibleConfig } from './providers/openai-compatible.js';
export { GoogleProvider } from './providers/google.js';
export { OllamaProvider } from './providers/ollama.js';
export { PROVIDER_CONFIGS, GROQ_CONFIG, MISTRAL_CONFIG, TOGETHER_CONFIG, DEEPSEEK_CONFIG, FIREWORKS_CONFIG, COHERE_CONFIG } from './providers/provider-configs.js';
export { MiddlewareProvider, type MiddlewareOptions } from './providers/middleware.js';
export { FailoverProvider, type FailoverOptions } from './providers/failover.js';
export { CircuitBreaker, CircuitOpenError, type CircuitBreakerOptions, type CircuitState } from './providers/circuit-breaker.js';
export { TokenBucketRateLimiter, type RateLimiterOptions } from './providers/rate-limiter.js';
export type {
  LLMProvider,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ToolCall,
  ToolDefinition,
  ProviderConfig,
} from './providers/types.js';

// Tools
export { ToolRegistry } from './tools/registry.js';
export { ToolExecutor } from './tools/executor.js';
export type { Tool, ToolParameters, ToolContext, ToolResult } from './tools/types.js';

// Memory
export { CortexMemoryManager } from './memory/manager.js';
export { LocalEmbeddingEngine, cosineSimilarity } from './memory/embeddings.js';
export { ProviderEmbeddingEngine, type ProviderEmbeddingConfig } from './memory/provider-embeddings.js';
export { SQLiteVectorStore } from './memory/store/vector-sqlite.js';
export { GlobalMemoryPool } from './memory/global-pool.js';
export { MemoryExtractor } from './memory/pipeline/extractor.js';
export { WorkingMemory } from './memory/types/working.js';
export { MemoryConsolidator, type ConsolidationResult, type ConsolidationOptions } from './memory/consolidation.js';
export {
  MemoryEvictor,
  type EvictionConfig,
  type EvictionPolicy,
  type EvictionResult,
} from './memory/eviction.js';
export type {
  MemoryEntry,
  MemoryQuery,
  MemoryRecallResult,
  MemoryStoreOptions,
  MemoryStats,
  MemoryConfig,
  MemoryType,
  MemoryManager,
} from './memory/types.js';

// Prompt Engine
export { PromptAnalyzer } from './prompt/analyzer.js';
export { PromptEnhancer } from './prompt/enhancer.js';
export { PromptDecomposer } from './prompt/decomposer.js';
export { ExecutionPlanner } from './prompt/planner.js';
export type {
  PromptAnalysis,
  PromptIntent,
  EnhancedPrompt,
  DecomposedTask,
  RepoContext,
} from './prompt/types.js';

// Code Intelligence
export { RepoMapper, type RepoMapOptions, type RepoMapResult } from './code/mapper.js';
export { CodeParser, type ParseResult } from './code/parser.js';
export { ASTParser, type StructuralAnalysis, type FunctionInfo, type ClassInfo, type ComplexityMetrics, type CallEdge } from './code/ast-parser.js';
export { extractSymbols, type CodeSymbol, type SymbolType } from './code/symbols.js';
export { detectLanguage, detectProjectLanguages, LANGUAGES } from './code/languages.js';
export { generateDiff, formatDiff, summarizeChanges, type FileDiff } from './code/differ.js';
export { LSPClient, type LSPClientOptions, type LSPDiagnostic, type LSPLocation, type LSPHoverResult } from './code/lsp-client.js';
export { LSPManager, type LanguageServerConfig } from './code/lsp-manager.js';

// Quality
export { QualityVerifier } from './quality/verifier.js';
export { TypeCheckGate } from './quality/gates/type-check.js';
export { TestGate } from './quality/gates/test.js';
export { ReviewGate } from './quality/gates/review.js';
export { SecurityGate } from './quality/gates/security.js';
export { AutoFixer } from './quality/auto-fixer.js';
export type { QualityGate, QualityContext, GateResult, GateIssue, FixResult } from './quality/types.js';

// Cost
export { CostTracker } from './cost/tracker.js';
export { BudgetManager } from './cost/budget.js';
export { ModelRouter } from './cost/router.js';
export { MODEL_PRICING, calculateModelCost } from './cost/pricing.js';
export type { ModelPricing, CostEntry, CostSummary, BudgetConfig } from './cost/types.js';

// Observability
export { Tracer, type Span, type SpanKind, type SpanStatus, type TraceExport } from './observability/tracer.js';
export { MetricsCollector, type RunMetric, type AggregateMetrics, type StageMetric, type AgentMetric } from './observability/metrics.js';

// Plugins
export { PluginRegistry, type CortexPlugin, type PluginContext, type RoleTemplate } from './plugins/registry.js';
export {
  PluginSandbox,
  type PluginCapability,
  type PluginLimits,
  type SandboxViolation,
} from './plugins/sandbox.js';

// Built-in Plugins
export {
  MetricsDashboardPlugin,
  MetricsStore,
  CodeComplexityPlugin,
  analyzeComplexity,
  GitWorkflowPlugin,
  classifyChanges,
  detectSensitiveFiles,
  DependencyAuditPlugin,
  auditDependencies,
  parsePackageJson,
  classifyLicense,
  DocumentationGenPlugin,
  analyzeDocCoverage,
  generateDocs,
  getBuiltinPlugins,
  getBuiltinPlugin,
  listBuiltinPlugins,
} from './plugins/builtin/index.js';

// Reasoning
export { ReasoningOrchestrator } from './reasoning/orchestrator.js';
export { ReActAgent } from './reasoning/react/react-agent.js';
export { ReflexionEngine } from './reasoning/reflexion/reflexion-engine.js';
export { ReflexionMemory } from './reasoning/reflexion/reflexion-memory.js';
export { ThoughtTree } from './reasoning/tot/thought-tree.js';
export { ThoughtEvaluator } from './reasoning/tot/evaluator.js';
export { DebateArena } from './reasoning/debate/debate-arena.js';
export { JudgeAgent } from './reasoning/debate/judge.js';
export { RAGProvider } from './reasoning/rag/rag-provider.js';
export { FileIndexer } from './reasoning/rag/file-indexer.js';
export { RAGSearchTool } from './reasoning/rag/rag-search-tool.js';
export { ToolChainPlanner } from './reasoning/tools/tool-chain-planner.js';
export { ToolComposer } from './reasoning/tools/tool-composer.js';
export type {
  ReasoningStrategy, ReasoningConfig,
  ThoughtStep, ReasoningTrace, ReasoningResult,
} from './reasoning/types.js';

// Utils
export { Timer, formatDuration, measure } from './utils/timer.js';
export { retry, withTimeout } from './utils/retry.js';
export { estimateTokens, formatTokens, formatCost } from './utils/tokens.js';

// Benchmark
export { BenchmarkRunner, type BenchmarkEngineInterface } from './benchmark/runner.js';
export { BenchmarkReporter } from './benchmark/reporter.js';
export { BENCHMARK_TASKS, getTasksByCategory, getCategories } from './benchmark/tasks.js';
export type {
  BenchmarkTask, BenchmarkResult, BenchmarkReport, BenchmarkConfig,
  BenchmarkSummary, BenchmarkCategoryResult, BenchmarkCategory, BenchmarkDifficulty,
} from './benchmark/types.js';

// Dashboard
export { DashboardServer, type DashboardOptions } from './dashboard/server.js';
export { createAPIHandler } from './dashboard/api.js';
export { createWebSocketHandler } from './dashboard/websocket.js';

// SWE-bench
export { SWEBenchAdapter } from './swebench/adapter.js';
export { SWEBenchPromptBuilder } from './swebench/prompt-builder.js';
export { PatchExtractor } from './swebench/patch-extractor.js';
export { SWEBenchEvaluator } from './swebench/evaluator.js';
export type {
  SWEBenchInstance, SWEBenchResult, SWEBenchReport, SWEBenchSummary, SWEBenchConfig,
} from './swebench/types.js';

// Version
export { VERSION, NAME } from './version.js';
