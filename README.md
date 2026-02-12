# CortexOS

**The Operating System for AI Agent Teams** — intelligent orchestration, persistent memory, and quality assurance for multi-agent AI workflows.

[![npm version](https://img.shields.io/npm/v/cortexos.svg)](https://www.npmjs.com/package/cortexos)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)

---

## Features

- **10 LLM Providers** — Anthropic, OpenAI, Google, Ollama, Groq, Mistral, Together, DeepSeek, Fireworks, Cohere
- **8-Stage Pipeline** — RECALL > ENHANCE > ANALYZE > DECOMPOSE > PLAN > EXECUTE > VERIFY > MEMORIZE
- **Persistent Memory** — Ebbinghaus decay curves, cross-project sharing via global memory pool, relation discovery
- **Quality Gates** — Syntax, lint, type-check, test, security, and AI-review gates with auto-fix retry loop
- **Multi-Agent Swarm** — Parallel agent execution with worktree sandboxing, handoffs, and IPC message bus
- **Reasoning Strategies** — ReAct, Reflexion, Tree-of-Thought, Multi-Agent Debate, RAG, Tool Discovery
- **Provider Resilience** — Failover chains, circuit breaker, token-bucket rate limiting, prompt caching
- **Code Intelligence** — AST parsing (regex + tree-sitter), LSP integration, repo mapping
- **Observability** — OpenTelemetry-compatible tracing, metrics collection, real-time dashboard
- **SWE-bench Ready** — Built-in adapter for SWE-bench evaluation and benchmarking

## Quickstart

### CLI

```bash
npx cortexos run "add JWT authentication with tests"
```

### Programmatic API

```typescript
import { CortexEngine, ConfigManager } from 'cortexos';

const config = new ConfigManager().load(process.cwd());
const engine = CortexEngine.create({ config, projectDir: process.cwd() });
const result = await engine.execute("add JWT auth with tests");

console.log(result.success);       // true
console.log(result.filesChanged);  // [{ path: 'src/auth.ts', type: 'create' }, ...]
console.log(result.quality);       // { passed: true, score: 100, gateResults: [...] }
```

## Architecture

```
User Prompt
    |
    v
[1. RECALL]     — Search persistent memory for relevant context
[2. ENHANCE]    — Enrich prompt with repo map, memories, analysis
[3. ANALYZE]    — Detect intent, complexity, language, scope
[4. DECOMPOSE]  — Break into parallelizable sub-tasks
[5. PLAN]       — Build execution waves with dependency ordering
[6. EXECUTE]    — Dispatch to agent swarm (sandboxed worktrees)
[7. VERIFY]     — Run quality gates, auto-fix if needed
[8. MEMORIZE]   — Store learnings for future recall
    |
    v
ExecutionResult { success, filesChanged, quality, cost, duration }
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `cortexos run <prompt>` | Execute a task through the full pipeline |
| `cortexos plan <prompt>` | Generate an execution plan without running |
| `cortexos memory recall <query>` | Search stored memories |
| `cortexos memory stats` | Show memory system statistics |
| `cortexos benchmark` | Run built-in benchmarks |
| `cortexos dashboard` | Launch the real-time monitoring dashboard |
| `cortexos config` | View/edit configuration |

## Configuration

CortexOS looks for configuration in `cortexos.config.yaml`:

```yaml
providers:
  default: anthropic
  anthropicApiKey: $ANTHROPIC_API_KEY
  failoverEnabled: true
  failoverOrder: [anthropic, openai, google]

quality:
  gates: [syntax, lint, type-check, test]
  autoFix: true
  maxRetries: 3

memory:
  enabled: true

agents:
  maxParallel: 4
  worktreesEnabled: true

reasoning:
  enabled: true
```

## Provider Setup

Set the API key for your preferred provider:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
# or
export GOOGLE_API_KEY=AI...
```

For local inference with Ollama, no API key is needed:

```yaml
providers:
  default: ollama
  ollamaBaseUrl: http://localhost:11434
```

## Project Structure

```
src/
  core/       — Engine, config, events, context, errors
  agents/     — Agent, swarm coordinator, pool, sandbox, handoffs
  providers/  — LLM providers, failover, circuit breaker, rate limiter
  memory/     — Vector store, embeddings, consolidation, global pool
  quality/    — Quality gates, verifier, auto-fixer
  code/       — AST parser, repo mapper, LSP client, differ
  prompt/     — Analyzer, enhancer, decomposer, planner
  reasoning/  — ReAct, Reflexion, ToT, Debate, RAG, Tool Discovery
  tools/      — Tool registry, executor, built-in tools
  cost/       — Tracker, budget, router, pricing
  observability/ — Tracer, metrics
  plugins/    — Plugin registry
  dashboard/  — Real-time monitoring server
  benchmark/  — Benchmark runner, tasks, reporter
  swebench/   — SWE-bench adapter
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and PR guidelines.

## License

[MIT](LICENSE)
