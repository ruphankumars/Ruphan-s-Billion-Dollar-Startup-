# CortexOS Architecture

> Deep dive into the system design of CortexOS

---

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      CortexOS Engine                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌──────────┐  │
│  │ RECALL  │──▶│ ANALYZE │──▶│ ENHANCE │──▶│DECOMPOSE │  │
│  └─────────┘   └─────────┘   └─────────┘   └──────────┘  │
│       │                                          │         │
│       ▼                                          ▼         │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐  │
│  │MEMORIZE │◀──│ VERIFY  │◀──│ EXECUTE │◀──│  PLAN   │  │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                     Support Systems                         │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Memory   │  │Providers │  │ Quality  │  │ Plugins  │  │
│  │ System   │  │ Network  │  │  Gates   │  │ System   │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Agent   │  │Reasoning │  │  Code    │  │Observable│  │
│  │  Layer   │  │Strategies│  │ Intel    │  │   -ity   │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer Architecture

### Layer 1: Core Engine (`src/core/`)

The heart of CortexOS. Manages the 8-stage pipeline, event bus, configuration, and streaming.

**Key Files:**
- `engine.ts` — Main `CortexEngine` class, pipeline orchestration
- `types.ts` — All core type definitions
- `streaming.ts` — `StreamController` with SSE, async iterators, event-based streaming
- `mutex.ts` — `AsyncMutex`, `RWLock`, `Semaphore` for concurrent safety
- `error-chain.ts` — `ChainableError`, `ErrorAggregator` for structured error handling
- `config-migration.ts` — Schema evolution with validation diagnostics
- `graceful.ts` — Component health monitoring and fallback reporting

**Pipeline Flow:**
```typescript
// Simplified engine.run() flow
async run(input: RunInput): Promise<RunResult> {
  const memories = await this.recall(input);           // Stage 1
  const analysis = await this.analyze(input);          // Stage 2
  const enhanced = await this.enhance(input, analysis, memories); // Stage 3
  const subtasks = await this.decompose(enhanced);     // Stage 4
  const plan = await this.plan(subtasks);              // Stage 5
  const execution = await this.execute(plan);          // Stage 6
  const verified = await this.verify(execution);       // Stage 7
  await this.memorize(verified);                       // Stage 8
  return verified;
}
```

### Layer 2: Agent System (`src/agents/`)

Multi-agent swarm execution with wave-based parallelism.

**Key Files:**
- `coordinator.ts` — Orchestrates agent assignment and wave scheduling
- `pool.ts` — Dynamic agent pool with scaling
- `roles.ts` — 9 specialized agent role definitions
- `ipc-bus.ts` — Inter-process communication between agents
- `handoff-executor.ts` — Agent-to-agent task handoff protocol
- `message-bus.ts` — Event-driven agent messaging

**Wave Execution Model:**
```
Wave 1: [Agent-A, Agent-B, Agent-C]  ← Run in parallel
             │          │
             ▼          ▼
Wave 2: [Agent-D, Agent-E]           ← Wait for Wave 1, then parallel
             │
             ▼
Wave 3: [Agent-F]                    ← Sequential dependency
```

### Layer 3: Memory System (`src/memory/`)

Persistent learning with vector similarity search.

**Key Files:**
- `manager.ts` — High-level memory API
- `store/vector-sqlite.ts` — SQLite-backed vector store with TF-IDF
- `consolidation.ts` — Ebbinghaus decay curves, memory strengthening
- `eviction.ts` — LRU, importance-based, hybrid, size-based eviction policies
- `global-pool.ts` — Cross-project memory sharing
- `embeddings.ts` — TF-IDF local + neural embedding providers
- `extractor.ts` — Automatic knowledge extraction from run results

**Memory Lifecycle:**
```
Store → Embed → Index → Recall → Consolidate → Decay/Strengthen → Evict
                                      ↑
                                Cross-project sync
```

### Layer 4: Provider Network (`src/providers/`)

10 LLM providers with resilience infrastructure.

**Supported Providers:**
1. Anthropic (Claude)
2. OpenAI (GPT-4, GPT-4o)
3. Google (Gemini)
4. Azure OpenAI
5. AWS Bedrock
6. Mistral
7. Cohere
8. Ollama (local)
9. Meta Llama
10. Custom (OpenAI-compatible)

**Resilience Stack:**
- `failover.ts` — Primary/fallback provider chains with health tracking
- `circuit-breaker.ts` — 3-state circuit breaker (CLOSED → OPEN → HALF_OPEN)
- `rate-limiter.ts` — Token bucket rate limiter with burst support
- `middleware.ts` — Request/response middleware pipeline
- `anthropic-cache.ts` — Anthropic prompt caching (`cache_control: ephemeral`)

### Layer 5: Quality Assurance (`src/quality/`)

6-gate verification pipeline with auto-fix.

**Gates:**
1. `syntax.ts` — AST parsing validation
2. `lint.ts` — ESLint integration
3. `type-check.ts` — TypeScript compiler check
4. `test-gate.ts` — Test runner execution
5. `security.ts` — OWASP vulnerability scanning
6. `review.ts` — AI-powered code review

**Auto-Fix Loop:**
```
Execute → Verify → [FAIL] → Auto-Fix → Re-Verify → [FAIL] → Retry (max 3)
                     ↓                                          ↓
                  [PASS]                                    Report failure
```

### Layer 6: Plugin System (`src/plugins/`)

Sandboxed, capability-based plugin architecture.

**Key Files:**
- `registry.ts` — Plugin discovery, registration, lifecycle management
- `sandbox.ts` — Capability-based permissions, resource limits, isolation
- `builtin/` — 5 built-in plugins (metrics, complexity, git, deps, docs)

**Plugin Interface:**
```typescript
interface CortexPlugin {
  name: string;
  version: string;
  register(ctx: PluginContext): void;
}

interface PluginContext {
  registerTool(tool: Tool): void;
  registerProvider(provider: LLMProvider): void;
  registerGate(gate: QualityGate): void;
  registerRole(role: AgentRole): void;
  registerMiddleware(hook: string, fn: MiddlewareFn): void;
  getConfig<T>(key: string): T;
}
```

### Layer 7: Reasoning Strategies (`src/reasoning/`)

6 research-backed reasoning strategies:

| Strategy | Paper | Use Case |
|----------|-------|----------|
| **ReAct** | Yao 2023 | Tool-using agent loops |
| **Reflexion** | Shinn 2023 | Self-correcting with reflection |
| **Tree-of-Thought** | Yao 2023 | Complex multi-step reasoning |
| **Multi-Agent Debate** | Du 2023 | Consensus through discussion |
| **RAG** | Lewis 2020 | Retrieval-augmented generation |
| **Tool Discovery** | Schick 2023 | Dynamic tool selection |

### Layer 8: Code Intelligence (`src/code/`)

Deep code understanding without running code.

- `parser.ts` — Multi-language code parsing
- `ast-parser.ts` — Tree-sitter AST analysis with regex fallback
- `mapper.ts` — Repository structure mapping
- `differ.ts` — Intelligent diff analysis
- `symbols.ts` — Symbol extraction and cross-referencing
- `languages.ts` — Language detection and configuration
- `lsp-client.ts` — LSP protocol client (JSON-RPC over stdio)
- `lsp-manager.ts` — Auto-discovery of 6+ language servers

### Layer 9: Observability (`src/observability/`, `src/cost/`, `src/dashboard/`)

Full production observability stack.

- **Tracing:** Distributed tracing with nested spans, trace export
- **Metrics:** `MetricsCollector` with aggregation, `RunMetric` tracking
- **Cost:** Per-model pricing, budget enforcement, cost routing
- **Dashboard:** WebSocket real-time updates, REST API, SSE streaming
- **Events:** 19+ event types via `EventBus`

---

## Data Flow

```
User Prompt
    │
    ▼
┌─ RECALL ─────────────────────────────────────────────┐
│  MemoryManager.recall()                              │
│  → SQLiteVectorStore.search(embedding, threshold)    │
│  → Returns: MemoryRecallResult[]                     │
└──────────────────────────────────────────────────────┘
    │
    ▼
┌─ ANALYZE ────────────────────────────────────────────┐
│  PromptAnalyzer.analyze(prompt)                      │
│  → Returns: { intent, complexity, entities,          │
│               estimatedSubtasks }                    │
└──────────────────────────────────────────────────────┘
    │
    ▼
┌─ ENHANCE ────────────────────────────────────────────┐
│  PromptEnhancer.enhance(prompt, analysis,            │
│                         memories, repoContext)        │
│  → Returns: EnhancedPrompt { systemPrompt,           │
│             userPrompt, memoryContext, cotContext }   │
└──────────────────────────────────────────────────────┘
    │
    ▼
┌─ DECOMPOSE ──────────────────────────────────────────┐
│  PromptDecomposer.decompose(enhanced)                │
│  → Returns: DecomposedTask[] (DAG of subtasks)       │
└──────────────────────────────────────────────────────┘
    │
    ▼
┌─ PLAN ───────────────────────────────────────────────┐
│  PromptPlanner.plan(subtasks, agents, tools)         │
│  → Returns: ExecutionPlan { waves, assignments }     │
└──────────────────────────────────────────────────────┘
    │
    ▼
┌─ EXECUTE ────────────────────────────────────────────┐
│  AgentCoordinator.execute(plan)                      │
│  → Wave-based parallel execution                     │
│  → IPC between agents, tool calls, LLM requests     │
│  → Returns: ExecutionResult { filesChanged, output } │
└──────────────────────────────────────────────────────┘
    │
    ▼
┌─ VERIFY ─────────────────────────────────────────────┐
│  QualityVerifier.verify(result)                      │
│  → 6 gates: syntax → lint → types → tests           │
│            → security → review                       │
│  → Auto-fix loop on failure (max 3 retries)          │
│  → Returns: QualityReport { passed, gates, fixes }   │
└──────────────────────────────────────────────────────┘
    │
    ▼
┌─ MEMORIZE ───────────────────────────────────────────┐
│  MemoryManager.store(learnings)                      │
│  → Extract knowledge from result                     │
│  → Embed and index                                   │
│  → Consolidate with existing memories                │
│  → Cross-project sync (if enabled)                   │
└──────────────────────────────────────────────────────┘
    │
    ▼
  RunResult
```

---

## Directory Structure

```
cortexos/
├── src/
│   ├── core/           # Engine, types, streaming, concurrency
│   ├── agents/         # Coordinator, pool, roles, IPC, handoffs
│   ├── memory/         # Vector store, consolidation, eviction, embeddings
│   ├── providers/      # 10 LLM providers, failover, circuit breaker
│   ├── prompt/         # Analyzer, enhancer, decomposer, planner
│   ├── quality/        # 6 gates, auto-fixer, verifier
│   ├── plugins/        # Registry, sandbox, 5 built-in plugins
│   ├── reasoning/      # 6 research-backed strategies
│   ├── code/           # Parser, AST, mapper, LSP, symbols
│   ├── cost/           # Tracker, pricing, budget, router
│   ├── observability/  # Tracer, metrics collector
│   ├── dashboard/      # WebSocket server, REST API
│   ├── tools/          # File, shell, git, search tools
│   └── index.ts        # Public API exports
├── test/
│   ├── unit/           # 75% of tests — isolated component tests
│   ├── integration/    # 20% — cross-component tests
│   └── helpers/        # Mock providers, test utilities
├── landing/            # Neumorphic landing page
├── docs/               # Documentation
├── .github/workflows/  # CI/CD pipelines
└── dist/               # Built output (ESM + DTS)
```
