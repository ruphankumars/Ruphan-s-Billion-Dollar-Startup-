# Changelog

All notable changes to CortexOS are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0-beta.1] — 2025-02-12

### Added
- **Auto-fix loop** — `stageVerify()` now retries with `AutoFixer` when fixable quality issues are detected (`quality.autoFix`, `quality.maxRetries`)
- **Cross-project memory** — `GlobalMemoryPool` shares high-importance memories across projects via `~/.cortexos/memory/global-vectors.db`
- **Provider failover** — `FailoverProvider` cascades through providers on failure with per-provider health tracking
- **Circuit breaker** — `CircuitBreaker` (CLOSED/OPEN/HALF_OPEN) prevents cascade failures in provider calls
- **Rate limiting** — `TokenBucketRateLimiter` throttles API calls with configurable burst capacity
- **Anthropic prompt caching** — System messages sent with `cache_control: { type: 'ephemeral' }` for server-side caching
- **Tree-sitter AST parsing** — Optional `web-tree-sitter` integration for richer structural analysis (graceful regex fallback)
- **Memory relation discovery** — `discoverRelations()` now persists entity-overlap-based `related_to` relations via `updateMetadata()`
- **LSP integration** — `LSPClient` (JSON-RPC over stdio) and `LSPManager` (multi-language auto-discovery)
- **Documentation** — README.md, CHANGELOG.md, CONTRIBUTING.md
- `quality:autofix` event emitted during auto-fix iterations
- `failoverEnabled` and `failoverOrder` provider configuration
- `crossProject`, `crossProjectEnabled`, `crossProjectThreshold` memory configuration
- `cacheStats` field on `LLMResponse` for Anthropic cache hit tracking
- `appliedFixes` field on `QualityReport`
- `FixResult` type in quality types
- `updateMetadata()` method on `SQLiteVectorStore`

### Changed
- Version bumped to `1.0.0-beta.1`
- `BaseLLMProvider` now wraps calls with circuit breaker and rate limiter
- `ProviderRegistry.getWithFailover()` constructs failover chains
- `CortexMemoryManager` accepts optional `GlobalMemoryPool` for cross-project sync
- `MemoryConsolidator.discoverRelations()` persists relations (previously was no-op)
- Recall scoring now includes relation boost (+0.05 per related result)

## [0.1.0] — 2025-02-11

### Added
- **Phase 10** — VS Code extension, real-time dashboard, SWE-bench adapter
  - `DashboardServer` with WebSocket live updates
  - `SWEBenchAdapter` for benchmark evaluation
  - VS Code extension with sidebar panel
- **Phase 9** — Benchmark framework with 30+ tasks across 6 categories
- **Phase 8** — Plugin system, observability (tracing + metrics)
  - `PluginRegistry` with role templates, custom gates, tools, providers
  - `Tracer` with span hierarchy and export
  - `MetricsCollector` with aggregate computation
- **Phase 7** — Advanced reasoning strategies
  - ReAct agent with thought-action-observation loop
  - Reflexion engine with self-reflection memory
  - Tree-of-Thought with configurable branching
  - Multi-agent Debate arena with judge
  - RAG provider with file indexing
  - Tool Discovery with chain planning
- **Phase 6** — Provider ecosystem expansion
  - 10 providers: Anthropic, OpenAI, Google, Ollama, Groq, Mistral, Together, DeepSeek, Fireworks, Cohere
  - `OpenAICompatibleProvider` base for compatible APIs
  - `MiddlewareProvider` for request/response transformation
  - `ModelRouter` for cost-based model selection
- **Phase 5** — Cost management system
  - `CostTracker`, `BudgetManager`, model pricing database
- **Phase 4** — Memory system
  - `CortexMemoryManager` with vector search
  - `LocalEmbeddingEngine` (TF-IDF)
  - `SQLiteVectorStore` with cosine similarity
  - `MemoryConsolidator` for deduplication and merging
  - Working, episodic, semantic, procedural memory types
- **Phase 3** — Quality verification pipeline
  - 6 quality gates: syntax, lint, type-check, test, review, security
  - `QualityVerifier` orchestrator
- **Phase 2** — Multi-agent execution
  - `SwarmCoordinator` with wave-based parallel execution
  - `AgentPool` with worker management
  - `WorktreeManager` for git worktree sandboxing
  - `MergeManager` for result integration
  - `HandoffManager` and `HandoffExecutor` for inter-agent delegation
  - `MessageBus` and `IPCMessageBus` for communication
- **Phase 1** — Core engine and prompt intelligence
  - `CortexEngine` 8-stage pipeline
  - `PromptAnalyzer`, `PromptEnhancer`, `PromptDecomposer`, `ExecutionPlanner`
  - `Agent` with tool execution loop
  - `ToolRegistry` and `ToolExecutor`
  - `RepoMapper` and `CodeParser`
  - Configuration system with `ConfigManager`
  - Error hierarchy and logging
