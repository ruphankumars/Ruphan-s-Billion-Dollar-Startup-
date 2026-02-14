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

// Structured Output
export {
  StructuredOutputParser,
  PRESET_SCHEMAS,
  type SchemaField,
  type SchemaDefinition,
  type OutputSchema,
  type ParseResult as StructuredParseResult,
  type ParseError,
} from './core/structured-output.js';

// Workflow DSL
export {
  WorkflowBuilder,
  WorkflowEngine,
  PRESET_WORKFLOWS,
  type WorkflowStep,
  type StepConfig,
  type RetryPolicy,
  type WorkflowDefinition,
  type WorkflowState,
  type StepResult,
  type WorkflowCheckpoint,
} from './core/workflow-dsl.js';

// Session Management
export {
  SessionManager,
  ConversationContextBuilder,
  type ConversationMessage,
  type MessageMetadata,
  type ToolCallRecord,
  type Session,
  type SessionMetadata,
  type SessionQuery,
  type SessionStats,
} from './core/session.js';

// Automation
export {
  AutomationEngine,
  SkillRegistry,
  PRESET_SKILLS,
  CronScheduler,
  WebhookServer,
  EventTriggerManager,
  parseCron,
  matchesCron,
  getNextMatch,
  validateCron,
  describeCron,
} from './automation/index.js';
export type {
  Skill,
  Schedule,
  WebhookConfig,
  EventTriggerConfig,
  AutomationRunRecord,
  TriggerSource,
  AutomationConfig,
} from './automation/index.js';
export type { CronFields, CronValidation } from './automation/cron-parser.js';

// Cloud
export {
  DockerManager,
  EnvironmentRegistry,
  PRESET_ENVIRONMENTS,
  ContainerPool,
} from './cloud/index.js';
export type {
  Environment,
  ResourceLimits,
  ContainerInfo,
  ContainerStatus,
  ResourceUsage,
  CloudTask,
  CloudTaskResult,
  CloudTaskStatus,
  RepoMount,
  ContainerEvent,
  ContainerEventType,
  CloudConfig,
} from './cloud/index.js';
export type { ContainerPoolOptions } from './cloud/container-pool.js';

// Collaboration
export {
  TeamManager,
  SharedSessionManager,
  CollaborationWSHandler,
  ACCESS_PERMISSIONS,
} from './collaboration/index.js';
export { createCollaborationAPIHandler } from './collaboration/index.js';
export type {
  TeamConfig,
  TeamMember,
  TeamRole,
  AccessLevel,
  AccessPermission,
  SharedSession,
  SessionViewer,
  SessionArtifact,
  ArtifactType,
  SteeringCommand,
  SteeringType,
  CollaborationEvent,
  CollaborationConfig,
} from './collaboration/index.js';

// API Server
export { APIServer } from './api/index.js';
export { generateApiKey, createAuthMiddleware, createCorsMiddleware } from './api/index.js';
export type {
  RunTaskRequest,
  RunTaskResponse,
  TaskRecord,
  APIServerConfig,
} from './api/index.js';

// Templates
export { TemplateRegistry, BUILTIN_TEMPLATES } from './templates/registry.js';
export type {
  ProjectTemplate,
  TemplateFile,
  ScaffoldOptions,
  ScaffoldResult,
} from './templates/types.js';

// MCP / A2A Protocol (Phase I)
export { MCPClient } from './mcp/mcp-client.js';
export { A2AGateway, type A2AGatewayOptions } from './mcp/a2a-gateway.js';
export { ProtocolBridge, type ProtocolBridgeOptions } from './mcp/protocol-bridge.js';
export type {
  MCPTransport,
  MCPServerConfig,
  MCPCapabilities,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPConnectionState,
  MCPServerInstance,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  AgentCard,
  AgentCapability,
  AgentSkill,
  AgentAuth,
  A2ATask,
  A2ATaskStatus,
  A2AMessage,
  A2APart,
  A2AArtifact,
  A2APushNotification,
  ProtocolBridgeConfig,
  UnifiedCapability,
  MCPConfig,
  MCPEventType,
} from './mcp/types.js';

// Daemon / Ambient Engine (Phase II)
export { CortexDaemon } from './daemon/daemon.js';
export { FileWatcher } from './daemon/file-watcher.js';
export { CriticAgent } from './daemon/critic-agent.js';
export { ConfidenceScorer } from './daemon/confidence-scorer.js';
export { SleepReportGenerator } from './daemon/sleep-report.js';
export type {
  DaemonConfig,
  DaemonState,
  FileEvent,
  WatchRule,
  CriticReport,
  CriticIssue,
  ConfidenceScore,
  ConfidenceFactor,
  SleepReport,
  SleepReportSection,
} from './daemon/types.js';

// Marketplace / Agent Economy (Phase III)
export { AgentMarketplace } from './marketplace/marketplace.js';
export { AgentRegistry as MarketplaceRegistry } from './marketplace/agent-registry.js';
export { AgentDiscovery } from './marketplace/discovery.js';
export { PricingEngine } from './marketplace/pricing.js';
export type {
  AgentListing,
  AgentAuthor,
  AgentPricing,
  AgentQualityMetrics,
  AgentEndpoints,
  DiscoveryQuery,
  DiscoveryResult,
  PricingNegotiation,
  AgentTransaction,
  MarketplaceConfig,
  MarketplaceEventType,
} from './marketplace/types.js';

// CADP Protocol / Agent Internet (Phase IV)
export { AgentDNS } from './protocol/agent-dns.js';
export { FederationManager } from './protocol/federation.js';
export { AgentRouter } from './protocol/routing.js';
export {
  CADPSpecification,
  PROTOCOL_VERSION as CADP_PROTOCOL_VERSION,
  MESSAGE_TYPES as CADP_MESSAGE_TYPES,
  WIRE_FORMAT as CADP_WIRE_FORMAT,
  DISCOVERY_PROTOCOL as CADP_DISCOVERY_PROTOCOL,
  SECURITY as CADP_SECURITY,
  MESSAGE_SCHEMAS as CADP_MESSAGE_SCHEMAS,
} from './protocol/cadp-spec.js';
export { TrustChain } from './protocol/trust-chain.js';
export type {
  TrustKeyPair,
  TrustCertificate,
  TrustedPeer,
} from './protocol/trust-chain.js';
export type {
  AgentIdentity,
  AgentDNSRecord,
  AgentEndpoint,
  FederationPeer,
  FederationConfig,
  RouteEntry,
  RouteCondition,
  RouteMetrics,
  CADPMessage,
  CADPMessageType,
  CADPConfig,
  CADPEventType,
} from './protocol/types.js';

// MCP Server Mode
export {
  MCPServer,
  type MCPServerOptions,
  type MCPToolHandler,
  type MCPResourceHandler,
  type MCPPromptHandler,
  type MCPToolResult,
  type MCPResourceContent,
  type MCPPromptResult,
  type MCPServerStats,
} from './mcp/mcp-server.js';

// Surface Adapters (GitHub, Slack, Discord)
export { SurfaceManager } from './surfaces/surface-manager.js';
export type { SurfaceManagerStats } from './surfaces/surface-manager.js';
export { GitHubApp } from './surfaces/github/github-app.js';
export { PRAnalyzer } from './surfaces/github/pr-analyzer.js';
export type { PRAnalysis, PRIssue, PRSuggestion, PRMetrics, PRInput } from './surfaces/github/pr-analyzer.js';
export { SlackBot } from './surfaces/slack/slack-bot.js';
export { SlackBlocks } from './surfaces/slack/slack-blocks.js';
export { DiscordBot } from './surfaces/discord/discord-bot.js';
export type { DiscordCommandOption, DiscordCommandDefinition } from './surfaces/discord/discord-bot.js';
export type {
  SurfaceType,
  Surface,
  SurfaceStats,
  SurfaceManagerConfig,
  SurfaceConfig,
  SurfaceEventType,
  GitHubAppConfig,
  GitHubWebhookPayload,
  PRPayload,
  IssuePayload,
  IssueCommentPayload,
  PushPayload,
  GitHubAppStats,
  SlackBotConfig,
  SlackEvent,
  SlackSlashCommand,
  SlackInteraction,
  SlackBlock,
  SlackBotStats,
  DiscordBotConfig,
  DiscordInteraction,
  DiscordBotStats,
} from './surfaces/types.js';

// Sovereign Runtime (Phase V)
export { WASMSandbox } from './runtime/wasm-sandbox.js';
export { EdgeAdapter } from './runtime/edge-adapter.js';
export { NeuralEmbeddingEngine } from './runtime/neural-embeddings.js';
export type {
  WASMSandboxConfig,
  WASMModule,
  WASMInstance,
  SandboxExecResult,
  EdgeTarget,
  EdgeCapability,
  EdgeConstraints,
  EdgeConnection,
  EdgeDeployment,
  EdgeDeploymentMetrics,
  EmbeddingModel,
  EmbeddingRequest,
  EmbeddingResult,
  VectorSearchResult,
  RuntimeConfig,
  RuntimeEventType,
} from './runtime/types.js';

// Formal Verification (Phase VI)
export { SpecVerifier } from './verification/spec-verifier.js';
export { ContractChecker } from './verification/contract-checker.js';
export { InvariantMonitor } from './verification/invariant-monitor.js';
export type {
  SpecContract,
  Condition,
  VerificationResult,
  ConditionResult,
  InvariantViolation,
  VerificationConfig,
  VerificationStats,
} from './verification/types.js';

// Time-Travel Debugging (Phase VI)
export { DecisionRecorder } from './time-travel/recorder.js';
export { DecisionReplayer } from './time-travel/replayer.js';
export { DivergenceAnalyzer } from './time-travel/diff-analyzer.js';
export type {
  DecisionRecord,
  DecisionContext,
  DecisionOutcome,
  ReplayConfig,
  ReplayResult,
  Divergence,
  TimeTravelConfig,
  TimeTravelStats,
} from './time-travel/types.js';

// Multi-Modal Input (Phase VI)
export { ImageAnalyzer } from './multimodal/image-analyzer.js';
export { DiagramParser } from './multimodal/diagram-parser.js';
export { WhiteboardBridge } from './multimodal/whiteboard-bridge.js';
export type {
  ImageAnalysis,
  UIElement,
  ExtractedCode,
  DiagramAnalysis,
  DiagramNode,
  DiagramConnection,
  WhiteboardTask,
  MultiModalConfig,
  MultiModalStats,
} from './multimodal/types.js';

// Self-Improvement Loop
export { FeedbackLoop } from './self-improve/feedback-loop.js';
export { RegressionDetector } from './self-improve/regression-detector.js';
export { CapabilityExpander } from './self-improve/capability-expander.js';
export type {
  FeedbackRecord,
  FeedbackMetrics,
  RegressionAlert,
  CapabilityGap,
  SelfImproveConfig,
  SelfImproveStats,
} from './self-improve/types.js';

// Agent-to-Agent Commerce
export { NegotiationEngine } from './commerce/negotiation-engine.js';
export { AuctionSystem } from './commerce/auction.js';
export { CoalitionManager } from './commerce/coalition-manager.js';
export type {
  Bid,
  Auction,
  AuctionStatus,
  NegotiationRound,
  Negotiation,
  NegotiationStatus,
  Coalition,
  CoalitionStatus,
  CommerceConfig,
  CommerceStats,
} from './commerce/types.js';

// Sovereign / Air-Gap Mode
export { SovereignRuntime } from './sovereign/sovereign-runtime.js';
export { LocalProvider } from './sovereign/local-provider.js';
export { OfflineToolkit } from './sovereign/offline-tools.js';
export type {
  SovereignConfig,
  SovereignStatus,
  SovereignMode,
  OfflineTool,
  ToolResult as SovereignToolResult,
  ToolCategory,
  OllamaModel,
  OllamaGenerateRequest,
  OllamaGenerateResponse,
  OllamaChatMessage,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaEmbeddingResponse,
} from './sovereign/types.js';

// Deploy Pipeline
export { Packager } from './deploy/packager.js';
export { Deployer } from './deploy/deployer.js';
export { DockerTarget } from './deploy/targets/docker-target.js';
export { NpmTarget } from './deploy/targets/npm-target.js';
export { EdgeTarget as EdgeDeployTarget } from './deploy/targets/edge-target.js';
export type {
  DeployConfig,
  DeployTarget,
  DeployTargetType,
  DeployManifest,
  DeployResult,
  DeployStatus,
  PackageBundle,
} from './deploy/types.js';

// Voice-to-Code
export { VoiceEngine } from './voice/voice-engine.js';
export { VoiceCommandParser } from './voice/voice-commands.js';
export type {
  VoiceConfig,
  VoiceProvider,
  VoiceCommand,
  ParsedCommand,
  CommandIntent,
  VoiceStats,
} from './voice/types.js';

// Spatial Computing
export { TopologyGraph } from './spatial/topology-graph.js';
export { SceneSerializer } from './spatial/scene-serializer.js';
export type {
  SceneGraph,
  SceneNode,
  SceneNodeType,
  SceneEdge,
  SceneEdgeType,
  Vec3,
  CameraState,
  SpatialConfig,
  LayoutAlgorithm,
} from './spatial/types.js';

// Shared Memory Bus
export { SharedMemoryBus } from './memory-bus/index.js';
export type {
  MemoryEntry as MemoryBusEntry,
  MemoryChannel,
  ChannelMessage,
  StateProjection,
  ConflictStrategy,
  ConflictEvent,
  ChangeType,
  ChangeEvent,
  MemoryBusConfig,
  MemoryBusStats,
} from './memory-bus/index.js';

// Agent Lifecycle Management
export { AgentLifecycleManager } from './lifecycle/index.js';
export type {
  AgentPhase,
  AgentManifest,
  DeployEnvironment,
  AgentDeployment,
  ResourceAllocation,
  HealthCheck,
  AgentPerformanceMetrics,
  SLADefinition,
  LifecycleConfig,
  LifecycleStats,
} from './lifecycle/index.js';

// AI Guardrails Engine
export { GuardrailsEngine } from './guardrails/index.js';
export type {
  PolicySeverity,
  RuleType,
  PolicyRule,
  SafetyPolicy,
  PolicyEvaluation,
  PolicyViolation,
  AuditAction,
  AuditLogEntry,
  ComplianceStandard,
  ComplianceFinding,
  ComplianceReport,
  RateLimitRule,
  GuardrailsConfig,
  GuardrailsStats,
} from './guardrails/index.js';

// Graph-of-Agents Orchestrator
export { GraphOrchestrator } from './agents/graph-orchestrator.js';
export type {
  AgentNode,
  AgentEdge,
  EdgeType,
  GraphMessage,
  SubsetSelection,
  SelectionStrategy,
  GraphTopology,
  TopologyMetrics,
  GraphOrchestratorConfig,
  GraphOrchestratorStats,
} from './agents/graph-types.js';

// Production Observability (extended)
export { DistributedTracer } from './observability/distributed-tracer.js';
export { AlertManager } from './observability/alert-manager.js';
export { TraceExporter } from './observability/trace-exporter.js';
export type {
  SpanContext,
  DetailedSpan,
  SpanKind as DetailedSpanKind,
  SpanStatusDetail,
  SpanEvent,
  SpanLink,
  TraceTree,
  AlertRule,
  AlertCondition,
  Alert,
  CostAttribution,
  ExportFormat,
  ExportConfig,
  ObservabilityConfig,
  ObservabilityStats,
} from './observability/types.js';

// Agent FinOps
export { AgentFinOps } from './finops/index.js';
export type {
  ConsumptionRecord,
  CostForecast,
  ResourceTag,
  TaggedCost,
  RightsizingRecommendation,
  BudgetLevel,
  Budget as FinOpsBudget,
  BudgetAlert,
  FinOpsReport,
  FinOpsConfig,
  FinOpsStats,
} from './finops/index.js';

// ACP Protocol Adapter
export { ACPAdapter } from './mcp/acp-adapter.js';
export type {
  ACPAgentInfo,
  ACPMessage,
  ACPResponse,
  ACPDiscoveryResult,
  ACPRoute,
  ACPConfig,
  ACPStats,
} from './mcp/acp-types.js';

// Knowledge Graph
export { KnowledgeGraph } from './memory/knowledge-graph.js';
export type {
  Entity,
  Relationship,
  GraphPath,
  GraphPattern,
  InferenceRule,
  KnowledgeGraphConfig,
  KnowledgeGraphStats,
} from './memory/knowledge-graph-types.js';

// Proactive Agent Daemon
export { ProactiveEngine } from './daemon/proactive-engine.js';
export type {
  ContextPattern,
  PredictedNeed,
  ProactiveRule,
  ProactiveConfig,
  ProactiveStats,
} from './daemon/proactive-engine.js';

// User Behavior Model / Personalization
export { UserBehaviorModel } from './personalization/index.js';
export type {
  UserPreference,
  BehaviorEvent,
  UserProfile,
  PersonalizationRule,
  PersonalizationConfig,
  PersonalizationStats,
} from './personalization/index.js';

// Cross-Device Session Sync
export { SessionSync } from './sync/index.js';
export type {
  SyncSession,
  SyncMessage,
  SyncConflict,
  DeviceInfo,
  SyncConfig,
  SyncStats,
} from './sync/index.js';

// Semantic Scheduler
export { SemanticScheduler } from './scheduler/index.js';
export type {
  SemanticTask,
  TaskSemanticType,
  ResourceSlot,
  ResourceProfile,
  SchedulerQueue,
  SchedulerConfig,
  SchedulerStats,
} from './scheduler/index.js';

// Digital Agent Identity
export { IdentityManager } from './identity/index.js';
export type {
  AgentIdentity as DigitalAgentIdentity,
  IdentityToken,
  ActionLog,
  TrustLevel,
  IdentityVerification,
  IdentityConfig,
  IdentityStats,
} from './identity/index.js';

// GPU Resource Manager
export { GPUManager } from './gpu/index.js';
export type {
  GPUDevice,
  GPUAllocation,
  InferenceBatch,
  InferenceRequest,
  GPUConfig,
  GPUStats,
} from './gpu/index.js';

// Agent Workforce Planner
export { WorkforcePlanner } from './workforce/index.js';
export type {
  WorkforceEntity,
  AvailabilityWindow,
  WorkforcePlan,
  TaskAssignment,
  SkillGap,
  CapacityForecast,
  WorkforceConfig,
  WorkforceStats,
} from './workforce/index.js';

// Evolution Engine — CRSAE (Convergent Recursive Self-Aggregating Evolution)
export {
  PopulationReasoner,
  ConvergenceDetector,
  BudgetController,
  BudgetExceededError as EvolutionBudgetExceededError,
  MetaController,
  StrategyEvolver,
  SkillLibrary,
  CycleDetector,
} from './evolution/index.js';
export type {
  PopulationConfig,
  Candidate,
  PopulationState,
  AggregationResult,
  ConvergenceConfig,
  ConvergenceResult,
  BudgetConfig as EvolutionBudgetConfig,
  BudgetState,
  BudgetRemaining,
  BudgetTier,
  MetaControllerConfig,
  OrchestrationMode,
  ComputeScale,
  ReasoningDepth,
  OrchestrationDecision,
  DecisionOutcome as EvolutionDecisionOutcome,
  StrategyEvolverConfig,
  StrategyVariant,
  PerformanceMetric as EvolutionPerformanceMetric,
  SkillLibraryConfig,
  Skill as EvolutionSkill,
  SkillCategory,
  CycleDetectorConfig,
  CycleInfo,
  SelfTesterConfig,
  SelfTestResult,
  SelfTestIssue,
  EvolutionConfig,
  EvolutionStats,
  EvolutionEventType,
} from './evolution/index.js';

// Kernel — Core Foundation (19 Kernel Primitives)
export {
  KernelRegistry,
  ContextManager,
  ModelRouter as KernelModelRouter,
  ReasoningEngine,
  KERNEL_LAYER_MAP,
  KERNEL_PRIMITIVE_DEPENDENCIES,
  KERNEL_PRIMITIVE_METADATA,
  DEFAULT_ATTENTION_CONFIG,
  DEFAULT_SCALE_CONFIG,
  DEFAULT_REASON_CONFIG,
  DEFAULT_EXTEND_CONFIG,
  DEFAULT_RETRIEVE_CONFIG,
  DEFAULT_REMEMBER_CONFIG,
  DEFAULT_COMPRESS_CONFIG,
  DEFAULT_INDEX_CONFIG,
  DEFAULT_EVOLVE_MEMORY_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  DEFAULT_SIMULATE_CONFIG,
  DEFAULT_ADAPT_CONFIG,
  DEFAULT_INSTRUCT_CONFIG,
  DEFAULT_DISTILL_CONFIG,
  DEFAULT_ALIGN_CONFIG,
  DEFAULT_CASCADE_CONFIG,
  DEFAULT_ROUTE_CONFIG,
  DEFAULT_SELF_EVOLVE_CONFIG,
  DEFAULT_JUDGE_CONFIG,
} from './kernel/index.js';
export type {
  // Kernel Infrastructure
  KernelPrimitiveId,
  KernelLayer,
  KernelConfig,
  KernelBudget,
  KernelPrimitiveMetadata,
  AgentPrimitiveId,
  PrimitiveHandler,
  KernelRegistryStats,
  KernelCallRecord,
  KernelDependencyValidation,
  KernelLayerStats,
  KernelEventType,
  // Layer 0: Hardware Abstraction
  AttentionConfig,
  AttentionInput,
  AttentionOutput,
  // Layer 1: Core Execution
  ScaleConfig,
  ScaleInput,
  ScaleOutput,
  ReasonConfig,
  ReasonInput,
  ReasonOutput,
  ExtendConfig,
  ExtendInput,
  ExtendOutput,
  // Layer 2: Memory Subsystem
  RetrieveConfig,
  RetrieveInput,
  RetrieveOutput,
  RememberConfig,
  RememberInput,
  RememberOutput,
  CompressConfig as KernelCompressConfig,
  CompressInput,
  CompressOutput,
  IndexConfig,
  IndexInput,
  IndexOutput,
  EvolveMemoryConfig,
  EvolveMemoryInput,
  EvolveMemoryOutput,
  // Layer 3: Reasoning & Search
  SearchConfig,
  SearchInput,
  SearchOutput,
  SimulateConfig,
  SimulateInput,
  SimulateOutput,
  // Layer 4: Model Lifecycle
  AdaptConfig,
  AdaptInput,
  AdaptOutput,
  InstructConfig,
  InstructInput,
  InstructOutput,
  DistillConfig as KernelDistillConfig,
  DistillInput,
  DistillOutput,
  AlignConfig,
  AlignInput,
  AlignOutput,
  CascadeConfig,
  CascadeInput,
  CascadeOutput,
  // Layer 5: Coordination & Routing
  RouteConfig,
  RouteInput,
  RouteOutput,
  SelfEvolveConfig,
  SelfEvolveInput,
  SelfEvolveOutput,
  JudgeConfig,
  JudgeInput,
  JudgeOutput,
  // Context Manager
  ContextManagerConfig,
  MemoryEntry as KernelMemoryEntry,
  KnowledgeBlock,
  SemanticIndex,
  ContextManagerStats,
  // Model Router
  ModelRouterConfig,
  ModelTier,
  RoutingDecision,
  RouteConstraints,
  LoRAAdapter,
  DistillationConfig as KernelDistillationConfig,
  Modality,
  ModalityRoute,
  ModelRouterStats,
  // Reasoning Engine
  ReasoningEngineConfig,
  ReasoningStep as KernelReasoningStep,
  SearchNode,
  SimulationState,
  SimulationTrajectory,
  JudgeVerdict,
  EvolutionRound as KernelEvolutionRound,
  ReasoningEngineStats,
} from './kernel/index.js';

// Version
export { VERSION, NAME } from './version.js';
