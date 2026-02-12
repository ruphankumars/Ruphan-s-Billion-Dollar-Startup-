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

// Sandbox (Phase 2)
export { WorktreeManager, type WorktreeInfo } from './agents/sandbox/worktree.js';
export { MergeManager, type MergeResult } from './agents/sandbox/merger.js';
export { FileLockManager } from './agents/sandbox/lock.js';

// Providers
export { BaseLLMProvider } from './providers/base.js';
export { ProviderRegistry } from './providers/registry.js';
export { AnthropicProvider } from './providers/anthropic.js';
export { OpenAIProvider } from './providers/openai.js';
export { MiddlewareProvider, type MiddlewareOptions } from './providers/middleware.js';
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
export { SQLiteVectorStore } from './memory/store/vector-sqlite.js';
export { MemoryExtractor } from './memory/pipeline/extractor.js';
export { WorkingMemory } from './memory/types/working.js';
export { MemoryConsolidator, type ConsolidationResult, type ConsolidationOptions } from './memory/consolidation.js';
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

// Quality
export { QualityVerifier } from './quality/verifier.js';
export { TypeCheckGate } from './quality/gates/type-check.js';
export { TestGate } from './quality/gates/test.js';
export { ReviewGate } from './quality/gates/review.js';
export { SecurityGate } from './quality/gates/security.js';
export type { QualityGate, QualityContext, GateResult, GateIssue } from './quality/types.js';

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

// Utils
export { Timer, formatDuration, measure } from './utils/timer.js';
export { retry, withTimeout } from './utils/retry.js';
export { estimateTokens, formatTokens, formatCost } from './utils/tokens.js';

// Version
export { VERSION, NAME } from './version.js';
