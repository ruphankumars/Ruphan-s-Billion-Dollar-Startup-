# CortexOS — CLAUDE.md

> **The Operating System for AI Agent Teams — Recursive Self-Evolving Architecture**
> This file defines the development methodology, architectural principles, and agent instructions for CortexOS.

---

## Default Workflow Protocol

You are an expert software engineer and pair programmer.
Before taking any action, you must follow this structured workflow:

1. **Context First**: Read necessary files (@files), git history, and documentation to understand existing patterns, types, and architecture.
2. **Brainstorm & Ask**: Identify 3-5 crucial questions about requirements, edge cases, and constraints. Ask me these questions before proposing a solution.
3. **Plan & Diagram**: Propose a high-level plan. For complex changes, create a Mermaid sequence or component diagram showing interactions, data flow, and potential side effects.
4. **Identify Gaps**: List all assumptions and potential failure modes in the proposed plan.
5. **Implement in Iterations**: Once I approve, implement the code in small, testable chunks.
6. **Verify**: Run tests and linters after edits.

**Rules:**
- DO NOT edit files until I approve your plan.
- If you are uncertain about an implementation approach, propose 2-3 options with pros/cons.
- Conform to existing naming conventions, database schemas, and types.
- If a required file or structure is missing, ask me to define it before assuming its existence.

---

## Parallel Agent Task Execution Protocol

### Architecture: Recursive Self-Aggregating Agent Swarm

When executing complex, multi-step tasks, CortexOS agents MUST use the following parallel execution methodology derived from cutting-edge research in recursive self-improvement, test-time compute scaling, and population-based reasoning.

### 1. Population-Based Task Decomposition (RSA Pattern)

Inspired by **Recursive Self-Aggregation** (arXiv:2509.26626):

```
Given a complex task T:
1. Generate N parallel solution candidates (Population P₀)
2. For each iteration t = 1..T:
   a. For each candidate i in P_t:
      - Sample K candidates from P_t (without replacement)
      - Aggregate sampled solutions into improved candidate
   b. P_{t+1} = {improved candidates}
3. Select best from final population P_T
```

**Parameters:**
- **N (Population Size)**: Controls solution diversity. Default: 5 for standard tasks, 8 for critical tasks.
- **K (Aggregation Set Size)**: Controls mixing speed. Default: 3 (optimal cost/quality tradeoff).
- **T (Iteration Depth)**: Controls refinement depth. Default: 2 for standard, 4 for critical.

**Key Insight**: This ALWAYS outperforms single-shot reasoning. The model implicitly verifies correctness by cross-referencing multiple candidate solutions. No external reward model needed.

### 2. Draft-Critique-Revision Loop (DCR Pattern)

From **Recursive Agents** (hankbesser/recursive-agents):

```
For each agent task:
1. DRAFT: Generate initial solution using domain-specific system prompt
2. CRITIQUE: Same LLM evaluates draft against quality criteria
3. REVISE: Generate improved version incorporating critique
4. CONVERGENCE CHECK: Compute semantic similarity between revisions
   - If cosine_similarity(embed(prev), embed(curr)) >= 0.98: STOP
   - Else: Continue loop (max 5 iterations)
```

**Protocol Injection**: All agents inherit a shared reasoning protocol (the "reasoning kernel") that defines HOW to think. Domain-specific templates define WHAT to think about. Changing the protocol changes reasoning across all agents simultaneously.

### 3. Budget-Constrained Self-Improvement (STOP Pattern)

From **Microsoft STOP** (Self-Taught Optimizer):

```
Every parallel agent MUST operate within strict resource budgets:
- Per-call token budget: Defined by task tier
- Per-iteration API call cap: Max 25 calls per improvement cycle
- Per-session compute ceiling: Hard limit prevents runaway costs
- Budget tracking: Every LLM call decrements remaining budget
- Budget exceeded → Raise exception, return best-so-far result
```

**Self-Improvement Loop**:
```
1. Load current improvement strategy (seed)
2. Apply strategy to target problem → candidate solution
3. Evaluate candidate against utility function
4. Apply strategy to ITSELF (meta-optimization)
5. If improved strategy scores higher → replace seed
6. Checkpoint after each iteration for resumability
```

### 4. Context-as-Variable Exploration (RLM Pattern)

From **Recursive LLM** (ysz/recursive-llm):

```
Instead of stuffing context into prompts:
1. Store context as a Python/TypeScript variable in sandboxed REPL
2. Agent writes code to explore context (search, slice, filter, aggregate)
3. Agent can spawn recursive sub-agents for context partitions
4. Each recursion level can use a cheaper model (dual-model routing)
5. REPL sandbox restricts dangerous operations (RestrictedPython-style)
```

**Depth-Aware Model Selection**:
- Depth 0 (root): Use most capable model (Claude Opus / GPT-4)
- Depth 1-2 (sub-tasks): Use balanced model (Claude Sonnet / GPT-4o)
- Depth 3+ (leaf tasks): Use fast model (Claude Haiku / GPT-4o-mini)

### 5. Hierarchical Meta-Evaluation (Meta-Ranking Pattern)

From **Recursive Self-Improvement Suite** (keskival):

```
For quality assurance of agent outputs:
1. Generate N candidate solutions
2. Generate M independent rankings of those solutions
3. Generate 1 meta-ranking that ranks the M rankings
4. Select the best solution from the best ranking
5. Cross-validate against ALL ranking criteria
```

**DPO Training Data Generation**: Every (good_solution, better_solution, ranking_label) tuple is stored for future model improvement. The system generates its own training data during normal operation.

### 6. Modular Agentic Planning (MAP Pattern)

From the uploaded **Modular Agentic Planner** diagram:

```
Components:
├── Task Decomposer: Goals + States → Subgoals
├── Actor: Proposes actions from subgoals
├── Monitor: Evaluates proposed actions (scores σ, errors ε)
│   └── Feedback loop to Actor for refinement
├── Predictor: Simulates action outcomes → predicted states
├── Evaluator: Assigns value scores to predicted states
└── Orchestrator: Selects best (action, predicted_state) → Plan P

Flow:
Goals (s_goal) + States (s_0)
  → Task Decomposer → subgoals (s_z)
  → Actor → proposed actions (a)
  → Monitor → filtered actions + feedback
  → Predictor → predicted states (s̃_{t+1})
  → Evaluator → predicted values (v)
  → Orchestrator → Final Plan P
```

### 7. Test-Time Compute Scaling Strategy

From the uploaded **Parallel/Sequential/Hybrid Scaling** diagram:

```
Three scaling modes:

PARALLEL SCALING:
  Prompt → [Model₁, Model₂, Model₃] → [τ₁, τ₂, τ₃] → Combine → τ
  Use when: Tasks are decomposable, compute budget is high

SEQUENTIAL SCALING:
  Prompt → Model → τ⁽¹⁾ → Model → τ⁽²⁾ → ... → τ⁽ᵀ⁾
  Use when: Tasks require iterative refinement, each step depends on previous

HYBRID SCALING (PREFERRED):
  Prompt → [Model₁, Model₂, Model₃] → [τ₁⁽¹⁾, τ₂⁽¹⁾, τ₃⁽¹⁾]
       → [Model₁, Model₂, Model₃] → [τ₁⁽²⁾, τ₂⁽²⁾, τ₃⁽²⁾]
       → ... → Combine → τ⁽ᵀ⁾
  Use when: Maximum quality needed, combines diversity with depth
```

**Adaptive Compute Allocation**:
- Confidence < 0.4: Escalate to Hybrid Scaling (N=8, T=4)
- Confidence 0.4-0.7: Use Parallel Scaling (N=5, T=2)
- Confidence > 0.7: Single-shot sufficient

### 8. Self-Evolving Agent Architecture

From the uploaded **Self-Evolving Agents** diagram and survey (CharlesQ9):

```
Evolution Hierarchy:
LLMs (Language Understanding)
  → Foundation Agents (Planning, Tool Calling, Workflow Construction)
    → Self-Evolving Agents (Learning from Feedback & Experience)
      → ASI (Artificial Super Intelligence) [target]

Evolution Dimensions:
1. WHAT to evolve: Models | Memory | Prompts | Tools | Architecture
2. WHEN to evolve: Intra-task (within execution) | Inter-task (across executions)
3. HOW to evolve: Reward-based | Imitation-based | Population-based
4. WHERE to evolve: General-purpose | Domain-specific

CortexOS targets the "Self-Evolving Agents" tier with:
- Reflexion: Verbal RL with self-evaluation after each task
- STaR: Bootstrapping reasoning from successful reasoning traces
- Voyager: Persistent skill library that grows with each execution
- EvoFlow: Workflow DAGs evolve via evolutionary algorithms
- TextGrad: Natural language gradients for pipeline optimization
```

### 9. Knowledge-Augmented Reasoning (Top-Down Pattern)

From the uploaded **Top-Down Knowledge Card** diagram:

```
For knowledge-intensive tasks:
1. Parse question → identify knowledge domain needed
2. TWO parallel paths:
   a. AUTO SELECTION: Relevance Selector picks domain from knowledge cards
   b. EXP SELECTION: User/agent explicitly chooses information source
3. Retrieve domain-specific knowledge documents
4. Apply Factuality Selector to filter for accurate knowledge
5. Combine verified knowledge with question for final answer

Knowledge Card Grid:
[N] [A] [H]
[B] [P] [S]    → Each card = a domain (sports, biomedical, NLP, books, etc.)
[G] [C] [...]

This replaces hallucination-prone direct LLM answers with
knowledge-grounded, factually-verified responses.
```

---

## CortexOS Architecture Conventions

### Module Pattern (MANDATORY for all new modules)

```typescript
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

// 1. Types file: src/{module}/types.ts
export interface ModuleConfig { /* with sane defaults */ }
export interface ModuleStats { /* counters and metrics */ }

// 2. Implementation: src/{module}/{module-name}.ts
export class ModuleName extends EventEmitter {
  private running = false;
  private config: Required<ModuleConfig>;

  constructor(config?: Partial<ModuleConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.running = true;
    this.emit('module:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('module:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean { return this.running; }

  getStats(): ModuleStats { /* return computed metrics */ }
}
```

### Event Naming Convention
```
module:entity:action
```
Examples: `self-improve:feedback:recorded`, `graph:node:added`, `daemon:file:changed`

### ID Generation Convention
```typescript
const id = `prefix_${randomUUID().slice(0, 8)}`;
// Examples: fb_a1b2c3d4, reg_e5f6g7h8, node_i9j0k1l2
```

### Zero External Dependencies Rule
All new modules MUST use only Node.js built-ins:
- `node:crypto` for UUIDs and hashing
- `node:events` for EventEmitter
- `node:fs` and `node:path` for file operations
- `node:http` / `node:https` for networking
- NO npm packages in new modules

### Map-Based Storage Pattern
```typescript
// Primary storage
private items: Map<string, ItemType> = new Map();

// Bounded history
private history: HistoryEntry[] = [];
private readonly maxHistory = 1000;

addToHistory(entry: HistoryEntry): void {
  this.history.push(entry);
  if (this.history.length > this.maxHistory) {
    this.history.splice(0, this.history.length - this.maxHistory);
  }
}
```

### Configuration Pattern
```typescript
const DEFAULT_CONFIG: Required<ModuleConfig> = {
  maxItems: 100,
  ttlMs: 3600000,
  enableMetrics: true,
};

constructor(config?: Partial<ModuleConfig>) {
  this.config = { ...DEFAULT_CONFIG, ...config };
}
```

---

## Novel Methodology: CortexOS Recursive Evolution Engine (COREE)

### The Invention: Convergent Recursive Self-Aggregating Evolution (CRSAE)

CortexOS introduces **CRSAE** — a novel methodology that combines ALL researched patterns into a unified self-evolving architecture that outperforms every existing system:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CRSAE Architecture                           │
│                                                                 │
│  Layer 1: POPULATION REASONING (from RSA + STOP)                │
│  ├── Maintain N solution candidates per task                    │
│  ├── Cross-pollinate via K-aggregation every iteration          │
│  ├── Budget-constrained: hard limits at every level             │
│  └── Convergence detection via embedding similarity             │
│                                                                 │
│  Layer 2: MODULAR PLANNING (from MAP + PromptFlow)              │
│  ├── Task Decomposer with recursive sub-decomposition          │
│  ├── Actor-Monitor-Predictor-Evaluator pipeline                 │
│  ├── Dynamic re-planning after partial execution                │
│  └── Hybrid DAG + cyclic flows (solve PromptFlow's limitation) │
│                                                                 │
│  Layer 3: META-EVOLUTION (from Godel Agent + Self-Evolving)     │
│  ├── Four-role system: Improver/Verifier/Evaluator/Coordinator  │
│  ├── Provably beneficial modifications (dual-gate: proof + test)│
│  ├── Strategy weights evolve via meta-RL                        │
│  └── Persistent skill library grows with each execution         │
│                                                                 │
│  Layer 4: KNOWLEDGE GROUNDING (from Knowledge Cards + RLM)      │
│  ├── Context stored as queryable variables, not prompt-stuffed  │
│  ├── Domain-specific knowledge card selection                   │
│  ├── Factuality verification before answer generation           │
│  └── Recursive context exploration with depth-aware models      │
│                                                                 │
│  Layer 5: SELF-TESTING LOOP (from Self-Dogfooding + Backstage)  │
│  ├── Agents test their own outputs immediately                  │
│  ├── Cycle detection prevents infinite recursion                │
│  ├── Rate-limit-aware processing with per-entity budgets        │
│  └── Hot-reload evolution without session disruption            │
│                                                                 │
│  CROSS-CUTTING: ADAPTIVE COMPUTE SCALING                        │
│  ├── Parallel: Multiple candidates in parallel                  │
│  ├── Sequential: Iterative refinement chains                    │
│  ├── Hybrid: Population + refinement (preferred for critical)   │
│  └── Confidence-gated: Scale compute based on uncertainty       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why CRSAE Outperforms Everything

| System | Limitation | CRSAE Advantage |
|--------|-----------|-----------------|
| **Cursor/Windsurf** | Single-shot code generation | Population-based N-candidate reasoning with aggregation |
| **Devin/OpenHands** | Fixed agent topology | Dynamic graph-based topology that evolves per task |
| **AutoGPT/CrewAI** | No self-improvement loop | Meta-RL evolves the improvement strategy itself |
| **LangGraph** | DAG-only workflows | Hybrid DAG + cyclic flows with re-planning |
| **PromptFlow** | Cannot represent recursion | Native recursive flows with cycle detection |
| **Replit Agent** | No formal verification | Dual-gate (proof + test) before any self-modification |
| **Claude Code/Copilot** | No persistent learning | Voyager-style skill library + STaR reasoning bootstrapping |
| **Manus** | Cloud-dependent | Sovereign runtime with air-gap mode |
| **SWE-Agent** | Single strategy** | Adaptive strategy selection evolving via feedback |

### Implementation Priorities

#### Phase 1: Core CRSAE Engine (Critical)
```
src/evolution/
├── types.ts                    — Core types for evolution engine
├── population-reasoner.ts      — RSA-based population reasoning
├── convergence-detector.ts     — Embedding-based convergence detection
├── budget-controller.ts        — Per-layer budget enforcement
├── meta-controller.ts          — Orchestrator-of-orchestrators
└── index.ts                    — Barrel exports
```

#### Phase 2: Adaptive Planning Integration
```
src/evolution/
├── adaptive-planner.ts         — MAP-based modular planning with re-planning
├── plan-repairer.ts            — Repairs plans after partial execution failure
├── strategy-evolver.ts         — Meta-RL for strategy weight evolution
└── skill-library.ts            — Persistent, growing capability library
```

#### Phase 3: Self-Testing & Verification
```
src/evolution/
├── self-tester.ts              — Agent self-dogfooding test loop
├── cycle-detector.ts           — Graph-based cycle detection for all pipelines
├── proof-gate.ts               — Formal verification gate (SMT-style)
└── training-accumulator.ts     — DPO preference pair generation
```

---

## Existing Module Map (44 modules, 268+ files)

### Core Infrastructure
| Module | Path | Key Classes |
|--------|------|-------------|
| Core | `src/core/` | CortexEngine, EventBus, ConfigManager, StreamController |
| Agents | `src/agents/` | Agent, SwarmCoordinator, AgentPool, GraphOrchestrator |
| Memory | `src/memory/` | CortexMemoryManager, SQLiteVectorStore, KnowledgeGraph |
| Providers | `src/providers/` | Anthropic/OpenAI/Google/Ollama, CircuitBreaker, FailoverProvider |
| Tools | `src/tools/` | ToolRegistry, ToolExecutor |

### Intelligence Layer
| Module | Path | Key Classes |
|--------|------|-------------|
| Reasoning | `src/reasoning/` | ReasoningOrchestrator, ReAct, Reflexion, ToT, Debate, RAG |
| Prompt | `src/prompt/` | Analyzer, Enhancer, Decomposer, Planner |
| Code | `src/code/` | ASTParser, RepoMapper, LSPClient, LSPManager |
| Quality | `src/quality/` | QualityVerifier, AutoFixer, 6 gates |

### Self-Improvement (Current — needs CRSAE integration)
| Module | Path | Key Classes |
|--------|------|-------------|
| Self-Improve | `src/self-improve/` | FeedbackLoop, RegressionDetector, CapabilityExpander |
| Verification | `src/verification/` | SpecVerifier, ContractChecker, InvariantMonitor |
| Time-Travel | `src/time-travel/` | DecisionRecorder, Replayer, DivergenceAnalyzer |

### Platform Layer
| Module | Path | Key Classes |
|--------|------|-------------|
| MCP/A2A/ACP | `src/mcp/` | MCPClient, MCPServer, A2AGateway, ACPAdapter |
| Protocol/CADP | `src/protocol/` | AgentDNS, Federation, Routing, TrustChain |
| Marketplace | `src/marketplace/` | AgentMarketplace, Discovery, PricingEngine |
| Commerce | `src/commerce/` | NegotiationEngine, AuctionSystem, CoalitionManager |

### Operations Layer
| Module | Path | Key Classes |
|--------|------|-------------|
| Observability | `src/observability/` | DistributedTracer, AlertManager, MetricsCollector |
| Cost/FinOps | `src/cost/`, `src/finops/` | CostTracker, BudgetManager, AgentFinOps |
| Daemon | `src/daemon/` | CortexDaemon, FileWatcher, CriticAgent, ProactiveEngine |
| Automation | `src/automation/` | AutomationEngine, SkillRegistry, CronScheduler |

### Deployment & Runtime
| Module | Path | Key Classes |
|--------|------|-------------|
| Cloud | `src/cloud/` | DockerManager, ContainerPool |
| Deploy | `src/deploy/` | Packager, Deployer (Docker/NPM/Edge targets) |
| Runtime | `src/runtime/` | WASMSandbox, EdgeAdapter, NeuralEmbeddingEngine |
| Sovereign | `src/sovereign/` | SovereignRuntime, LocalProvider, OfflineToolkit |

### Surfaces & UX
| Module | Path | Key Classes |
|--------|------|-------------|
| Surfaces | `src/surfaces/` | GitHub App, Slack Bot, Discord Bot, PR Analyzer |
| Dashboard | `src/dashboard/` | DashboardServer, WebSocket handler |
| Collaboration | `src/collaboration/` | TeamManager, SharedSession |
| Voice | `src/voice/` | VoiceEngine, VoiceCommandParser |
| Spatial | `src/spatial/` | TopologyGraph, SceneSerializer |
| Multimodal | `src/multimodal/` | ImageAnalyzer, DiagramParser, WhiteboardBridge |

---

## Critical Integration Gaps to Close

### Gap 1: Self-Improvement Loop Not Closed
**Problem**: FeedbackLoop, RegressionDetector, CapabilityExpander exist but are NOT wired into CortexEngine's execute() pipeline.
**Fix**: CRSAE meta-controller hooks into post-execution to feed results into FeedbackLoop, reads recommendations in ReasoningOrchestrator before strategy selection.

### Gap 2: No Adaptive Compute at Execution Time
**Problem**: ReasoningOrchestrator uses fixed complexity thresholds. No mechanism to "think harder" when confidence is low.
**Fix**: CRSAE AdaptiveComputeController wraps ReasoningOrchestrator, implements progressive deepening based on ConfidenceScorer output.

### Gap 3: GraphOrchestrator is Orphaned
**Problem**: The most sophisticated agent selection system is not used by the engine.
**Fix**: CRSAE meta-controller selects between SwarmCoordinator (linear waves) and GraphOrchestrator (graph-based) based on task topology.

### Gap 4: Planning is Rigid and Non-Adaptive
**Problem**: Plan is created once, executed without modification. No re-planning on failure.
**Fix**: CRSAE adaptive-planner implements plan-execute-replan loop with the MAP architecture.

### Gap 5: Two Event Systems Disconnected
**Problem**: Core EventBus and per-module EventEmitters are separate. No system-wide observability.
**Fix**: CRSAE event bridge propagates module events to central EventBus.

### Gap 6: No Meta-Controller
**Problem**: No top-level controller decides WHICH orchestration strategy, WHAT reasoning depth, HOW to adapt.
**Fix**: CRSAE meta-controller is the "kernel" that makes all orchestration decisions and evolves those decisions over time.

---

## Research References

### Core Research Papers & Repositories
1. **Recursive Agents** — Draft-Critique-Revision with embedding convergence: https://github.com/hankbesser/recursive-agents
2. **Microsoft STOP** — Self-Taught Optimizer, meta-optimization of improvement strategies: https://github.com/microsoft/stop
3. **Recursive LLM** — Context-as-variable with sandboxed REPL exploration: https://github.com/ysz/recursive-llm
4. **Self-Evolving Agents Survey** — 5-dimensional taxonomy (What/When/How/Where/Eval): https://github.com/CharlesQ9/Self-Evolving-Agents
5. **Recursive Self-Improvement Suite** — Hierarchical meta-ranking with DPO training data: https://github.com/keskival/recursive-self-improvement-suite
6. **Godel Agent** — Provably beneficial self-modification with formal verification: https://gist.github.com/ruvnet/15c6ef556be49e173ab0ecd6d252a7b9
7. **RSA Paper** — Recursive Self-Aggregation for test-time compute scaling: https://arxiv.org/html/2509.26626v1
8. **Self-Testing Loop** — AI self-dogfooding MCP development pattern: https://medium.com/@anirudhgangwal/the-self-testing-loop-how-i-used-ai-to-build-its-own-development-tools-200695abba88
9. **PromptFlow Recursive Flows** — DAG limitation analysis for agent workflows: https://github.com/microsoft/promptflow/issues/2279
10. **Backstage Cycle Detection** — Anti-pattern: self-referencing entities causing cascading failures: https://github.com/backstage/backstage/issues/27063

### Architectural Patterns from Diagrams
- **Top-Down Knowledge Cards**: Dual-path (auto + explicit) knowledge selection with factuality verification
- **Parallel/Sequential/Hybrid Scaling**: Three compute scaling modes with hybrid as optimal
- **Population Aggregation**: RSA population dynamics with aggregation prompts
- **Self-Evolving Agent Hierarchy**: LLMs → Foundation Agents → Self-Evolving → ASI
- **Modular Agentic Planner (MAP)**: Task Decomposer → Actor/Monitor → Predictor/Evaluator → Orchestrator

---

## Build & Test Commands

```bash
# Build
npm run build            # TypeScript compilation via tsup

# Test
npm test                 # Run all tests via vitest
npx vitest run           # Run all tests (alternative)
npx vitest run test/unit/evolution  # Run evolution module tests only

# Type Check
npx tsc --noEmit         # Verify TypeScript compilation

# Lint
npm run lint             # ESLint check

# Development
npm run dev              # Watch mode
```

### Test Configuration
- Framework: **Vitest**
- Test pattern: `test/**/*.test.ts`
- Tests MUST be in `test/` directory (NOT `tests/`)
- Convention: `test/unit/{module}/{feature}.test.ts`

---

## Git Workflow

```bash
# Feature branches
git checkout -b feat/{module-name}/{feature-description}

# Commit messages
feat: {description}     # New features
fix: {description}      # Bug fixes
docs: {description}     # Documentation
test: {description}     # Tests
refactor: {description} # Refactoring

# Never force push to main
# Always create new commits (never amend unless explicitly asked)
# Stage specific files, never use git add -A
```

---

*Last updated: February 14, 2026*
*CortexOS v0.1.0 — 44 modules, 268+ source files, 3,979 tests, 178 test files*
