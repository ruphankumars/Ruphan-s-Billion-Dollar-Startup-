# Getting Started with CortexOS

> The Operating System for AI Agent Teams

CortexOS is a production-grade AI agent orchestration engine featuring an 8-stage pipeline, persistent memory, 10 LLM providers, quality gates, and multi-agent swarm execution.

---

## Quick Install

```bash
npm install cortexos
```

## Your First Agent Run

```typescript
import { CortexEngine } from 'cortexos';

const engine = new CortexEngine();

const result = await engine.run({
  prompt: 'Fix the authentication bug and add unit tests',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
});

console.log(result.filesChanged);   // Files modified by agents
console.log(result.qualityReport);  // 6-gate verification results
console.log(result.cost);           // Total LLM cost
```

When you call `engine.run()`, CortexOS automatically executes its **8-stage pipeline**:

```
RECALL → ANALYZE → ENHANCE → DECOMPOSE → PLAN → EXECUTE → VERIFY → MEMORIZE
```

No manual orchestration needed.

---

## Core Concepts

### 1. The 8-Stage Pipeline

Every task flows through 8 stages:

| Stage | What It Does |
|-------|-------------|
| **RECALL** | Retrieves relevant memories and context from the persistent vector store |
| **ANALYZE** | Parses intent, complexity, entities, and estimates subtask count |
| **ENHANCE** | Augments the prompt with memory, repo map, and chain-of-thought context |
| **DECOMPOSE** | Breaks complex tasks into parallelizable subtask DAGs |
| **PLAN** | Assigns agents, tools, and strategies with wave-based scheduling |
| **EXECUTE** | Runs multi-agent swarm with IPC, handoffs, and tool orchestration |
| **VERIFY** | 6-gate quality check: lint, types, tests, security, review, syntax |
| **MEMORIZE** | Persists learnings with Ebbinghaus decay and cross-project sharing |

### 2. Multi-Agent Swarm

CortexOS includes 9 specialized agent roles:

- **Orchestrator** — Coordinates the overall task
- **Architect** — Designs system structure
- **Developer** — Writes implementation code
- **Tester** — Creates and runs tests
- **Reviewer** — Reviews code quality
- **Researcher** — Gathers information
- **Validator** — Validates outputs
- **UX Agent** — Handles user experience concerns
- **Documentation Writer** — Generates documentation

Agents execute in **waves** — independent subtasks run in parallel, dependent ones wait for predecessors.

### 3. Persistent Memory

CortexOS remembers across sessions:

```typescript
import { MemoryManager } from 'cortexos';

const memory = new MemoryManager({
  storePath: '.cortexos/memory.db',
});

// Memories are stored automatically after each run
// They use Ebbinghaus decay — important patterns strengthen over time
// Cross-project sharing lets learnings transfer between codebases
```

### 4. Quality Gates

Every output passes through 6 verification gates:

1. **Syntax Gate** — Validates code parses correctly
2. **Lint Gate** — Runs ESLint/configured linter
3. **Type Check Gate** — TypeScript type verification
4. **Test Gate** — Runs relevant test suites
5. **Security Gate** — Scans for vulnerabilities (OWASP patterns)
6. **Review Gate** — AI-powered code review

Failed gates trigger the **auto-fix loop** — CortexOS automatically attempts to fix issues and re-verify.

---

## Configuration

Create a `cortexos.config.ts` in your project root:

```typescript
import { CortexConfig } from 'cortexos';

export default {
  // LLM Provider
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',

  // Memory
  memory: {
    enabled: true,
    storePath: '.cortexos/memory.db',
    crossProject: true,
  },

  // Quality Gates
  quality: {
    gates: ['syntax', 'lint', 'typecheck', 'test', 'security', 'review'],
    autoFix: true,
    maxRetries: 3,
  },

  // Cost Control
  cost: {
    budgetPerRun: 1.00,      // USD
    budgetPerMonth: 50.00,   // USD
  },

  // Observability
  observability: {
    tracing: true,
    metrics: true,
    dashboard: false,       // Enable for real-time dashboard
  },
} satisfies CortexConfig;
```

---

## Provider Setup

CortexOS supports 10 LLM providers. Set the appropriate API key:

```bash
# Anthropic (Claude)
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (GPT-4)
export OPENAI_API_KEY=sk-...

# Google (Gemini)
export GOOGLE_AI_API_KEY=...

# Azure OpenAI
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_ENDPOINT=...

# AWS Bedrock
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...

# Ollama (local, no key needed)
# Runs on http://localhost:11434 by default
```

### Provider Failover

Configure automatic failover between providers:

```typescript
import { CortexEngine, FailoverProvider } from 'cortexos';

const engine = new CortexEngine({
  provider: new FailoverProvider({
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    fallbacks: [
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'google', model: 'gemini-pro' },
    ],
  }),
});
```

---

## Plugins

CortexOS ships with 5 built-in plugins:

### Metrics Dashboard
```typescript
import { MetricsDashboardPlugin } from 'cortexos';

engine.registerPlugin(new MetricsDashboardPlugin());
// Adds: metrics_snapshot, metrics_history tools
// Adds: performance-budget quality gate
```

### Code Complexity
```typescript
import { CodeComplexityPlugin } from 'cortexos';

engine.registerPlugin(new CodeComplexityPlugin({
  maxCyclomaticComplexity: 15,
}));
// Adds: complexity_analyze tool
// Adds: complexity quality gate
```

### Git Workflow
```typescript
import { GitWorkflowPlugin } from 'cortexos';

engine.registerPlugin(new GitWorkflowPlugin());
// Adds: git_smart_commit, git_branch_summary, git_changelog tools
// Adds: pre-verify middleware for sensitive file detection
```

### Dependency Audit
```typescript
import { DependencyAuditPlugin } from 'cortexos';

engine.registerPlugin(new DependencyAuditPlugin());
// Adds: dependency_audit, dependency_graph tools
// Adds: dependency-security quality gate
```

### Documentation Generator
```typescript
import { DocumentationGenPlugin } from 'cortexos';

engine.registerPlugin(new DocumentationGenPlugin({
  minCoverage: 80,
}));
// Adds: docs_generate, docs_coverage tools
// Adds: documentation-coverage quality gate
```

---

## CLI Usage

```bash
# Run a task
npx cortexos run --prompt "Refactor the auth module"

# Run with specific provider
npx cortexos run --provider openai --model gpt-4o --prompt "Add caching"

# Run with cost budget
npx cortexos run --budget 0.50 --prompt "Fix all lint warnings"

# Start metrics dashboard
npx cortexos dashboard --port 3000

# Check memory status
npx cortexos memory stats
```

---

## What's Next?

- [Architecture Deep Dive](./architecture.md) — How CortexOS works internally
- [Plugin Development Guide](./plugin-guide.md) — Build your own plugins
- [API Reference](./api-reference.md) — Complete API documentation
- [Tutorials](./tutorials/) — Step-by-step walkthroughs
