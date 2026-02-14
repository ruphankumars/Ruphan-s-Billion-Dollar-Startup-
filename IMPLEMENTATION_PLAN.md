# CortexOS: Complete Gap Implementation Plan

## Overview
Implementation plan for all 20 missing features across 5 priority tiers.
Total estimated: ~45 source files, ~45 test files, ~15,000 LOC new source, ~12,000 LOC new tests.

---

## Architecture: Module Layout

```
src/
├── surfaces/                     # NEW — Nerve System Adapter Surfaces
│   ├── types.ts                  # Shared surface types
│   ├── surface-manager.ts        # Unified surface lifecycle manager
│   ├── github/                   # GitHub App/Bot Surface
│   │   ├── types.ts
│   │   ├── github-app.ts         # GitHub webhook handler + bot
│   │   ├── pr-analyzer.ts        # PR analysis automation
│   │   └── index.ts
│   ├── slack/                    # Slack Bot Surface
│   │   ├── types.ts
│   │   ├── slack-bot.ts          # Slack event handler + slash commands
│   │   ├── slack-blocks.ts       # Slack Block Kit message builders
│   │   └── index.ts
│   ├── discord/                  # Discord Bot Surface
│   │   ├── types.ts
│   │   ├── discord-bot.ts        # Discord gateway + interactions
│   │   └── index.ts
│   └── index.ts                  # Barrel exports
│
├── mcp/
│   ├── mcp-server.ts             # NEW — CortexOS AS an MCP Server
│   └── (existing files)
│
├── runtime/
│   ├── wasm-sandbox.ts           # UPGRADE — Real WASM via node:wasi
│   ├── edge-adapter.ts           # UPGRADE — Real deployment adapters
│   ├── neural-embeddings.ts      # UPGRADE — ONNX neural inference
│   └── (existing types.ts)
│
├── protocol/
│   ├── cadp-spec.ts              # NEW — CADP RFC specification
│   ├── trust-chain.ts            # NEW — Cross-org federation trust
│   └── (existing files)
│
├── self-improve/                 # NEW — Self-Improvement Loop
│   ├── types.ts
│   ├── feedback-loop.ts          # Outcome-based learning
│   ├── regression-detector.ts    # Performance regression detection
│   ├── capability-expander.ts    # Automatic capability expansion
│   └── index.ts
│
├── commerce/                     # NEW — Agent-to-Agent Commerce
│   ├── types.ts
│   ├── negotiation-engine.ts     # Autonomous price negotiation
│   ├── coalition-manager.ts      # Agent coalition formation
│   ├── auction.ts                # Task auction system
│   └── index.ts
│
├── sovereign/                    # NEW — Air-Gap / Sovereign Mode
│   ├── types.ts
│   ├── sovereign-runtime.ts      # Full offline orchestration
│   ├── local-provider.ts         # Ollama-first local provider
│   ├── offline-tools.ts          # Offline tool implementations
│   └── index.ts
│
├── deploy/                       # NEW — One-Click Deploy Pipeline
│   ├── types.ts
│   ├── deployer.ts               # Deploy orchestrator
│   ├── packager.ts               # Agent config → deployable bundle
│   ├── targets/                  # Deploy target adapters
│   │   ├── docker-target.ts
│   │   ├── npm-target.ts
│   │   └── edge-target.ts
│   └── index.ts
│
├── voice/                        # NEW — Voice-to-Code Interface
│   ├── types.ts
│   ├── voice-engine.ts           # Speech recognition bridge
│   ├── voice-commands.ts         # Voice command parser
│   └── index.ts
│
├── spatial/                      # NEW — Spatial Computing (AR/VR)
│   ├── types.ts
│   ├── topology-graph.ts         # 3D agent topology data model
│   ├── scene-serializer.ts       # Scene → JSON → WebGL/WebXR
│   └── index.ts
│
├── verification/                 # NEW — Formal Verification
│   ├── types.ts
│   ├── spec-verifier.ts          # Specification-based verification
│   ├── contract-checker.ts       # Design-by-contract checking
│   ├── invariant-monitor.ts      # Runtime invariant monitoring
│   └── index.ts
│
├── time-travel/                  # NEW — Time-Travel Debugging
│   ├── types.ts
│   ├── recorder.ts               # Decision recording
│   ├── replayer.ts               # Decision replay engine
│   ├── diff-analyzer.ts          # Divergence analysis
│   └── index.ts
│
├── multimodal/                   # NEW — Multi-Modal Input
│   ├── types.ts
│   ├── image-analyzer.ts         # Screenshot/image → code
│   ├── diagram-parser.ts         # Diagram → architecture
│   ├── whiteboard-bridge.ts      # Whiteboard → tasks
│   └── index.ts
│
└── dashboard/
    ├── static/
    │   └── index.html            # UPGRADE — Full production dashboard
    └── (existing files)
```

---

## Phase 1: 🔴 Critical Missing (Items 1-4)

### 1. MCP Server Mode (`src/mcp/mcp-server.ts`)
CortexOS exposes itself AS an MCP server so other AI tools can discover and use it.

**Class**: `MCPServer extends EventEmitter`
**Protocol**: JSON-RPC 2.0 over stdio + HTTP/SSE (bidirectional)
**Capabilities exposed**:
- Tools: `cortexos_execute`, `cortexos_analyze`, `cortexos_review`, `cortexos_memory_query`, `cortexos_agent_hire`, `cortexos_status`
- Resources: `cortexos://config`, `cortexos://agents`, `cortexos://memory/{query}`, `cortexos://metrics`
- Prompts: `cortexos_task`, `cortexos_review`, `cortexos_debug`

**Methods**:
- `start(options)`: Start MCP server (stdio or HTTP)
- `stop()`: Graceful shutdown
- `registerTool(tool)`: Add a tool
- `registerResource(resource)`: Add a resource
- `registerPrompt(prompt)`: Add a prompt
- `handleRequest(request)`: Route JSON-RPC to handler
- `getStats()`: Connection metrics

**Events**: `mcp:server:started`, `mcp:server:client:connected`, `mcp:server:tool:invoked`, `mcp:server:stopped`

### 2. GitHub App Surface (`src/surfaces/github/`)

**Class**: `GitHubApp extends EventEmitter`
**Transport**: HTTP webhook receiver (extends automation webhook pattern)
**Events handled**:
- `pull_request` (opened, synchronize, closed)
- `push` (commit analysis)
- `issues` (triage, auto-label)
- `issue_comment` (command parsing: `/cortexos review`, `/cortexos fix`)
- `check_run` (CI integration)

**Sub-class**: `PRAnalyzer`
- `analyzePR(payload)`: Full PR review using CriticAgent
- `commentOnPR(owner, repo, prNumber, body)`: Post review comments
- `suggestFixes(diff)`: Generate fix suggestions
- `triageIssue(issue)`: Auto-label and assign

**API calls**: Uses `fetch()` to GitHub REST API v3 (zero npm deps)
**Auth**: GitHub App JWT + installation token pattern

### 3. Slack Bot Surface (`src/surfaces/slack/`)

**Class**: `SlackBot extends EventEmitter`
**Transport**: HTTP webhook (Slack Events API) + Web API calls
**Events handled**:
- `app_mention` — Respond when @mentioned
- `message` — DM and channel message handling
- `slash_command` — `/cortexos run`, `/cortexos status`, `/cortexos review`
- `interactive` — Button/modal callbacks

**Sub-module**: `SlackBlocks`
- Block Kit message builders for rich responses
- Execution result formatting
- Agent status cards
- Cost/quality summary blocks

**Auth**: OAuth 2.0 Bot Token, Signing Secret verification (HMAC-SHA256)

### 4. Nerve System Surface Manager (`src/surfaces/`)

**Class**: `SurfaceManager extends EventEmitter`
**Responsibility**: Unified lifecycle for all projection surfaces

**Interface**: `Surface`
```typescript
interface Surface {
  id: string;
  type: 'github' | 'slack' | 'discord' | 'mcp-server' | 'rest-api' | 'dashboard' | 'vscode';
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getStats(): SurfaceStats;
}
```

**Methods**:
- `registerSurface(surface)`: Add surface
- `startAll()`: Start all surfaces
- `stopAll()`: Graceful shutdown all
- `getSurface(id)`: Get specific surface
- `getStats()`: Aggregate stats across all surfaces
- `broadcast(event, data)`: Send event to all surfaces

**Also includes**: `DiscordBot` class (Discord gateway via WebSocket)

---

## Phase 2: 🟡 Partially Implemented (Items 5-9)

### 5. Real WASM Sandbox (`src/runtime/wasm-sandbox.ts` — UPGRADE)
- Replace `node:vm` with `node:wasi` for actual WebAssembly execution
- Keep `node:vm` as fallback for non-WASM code
- Add real memory isolation via WASM linear memory limits
- Add CPU time limiting via `--experimental-wasm-threads`
- Module compilation from WAT/WASM binary
- Real import/export resolution

### 6. Real Edge Deployment (`src/runtime/edge-adapter.ts` — UPGRADE)
- Cloudflare Workers: Real `wrangler` CLI integration
- AWS Lambda: Real `aws-cli` or SDK integration
- Deno Deploy: Real `deployctl` integration
- Add deployment manifest generation
- Add rollback support
- Add health-check verification post-deploy

### 7. Neural Embeddings (`src/runtime/neural-embeddings.ts` — UPGRADE)
- Add ONNX Runtime integration for local transformer models
- Support MiniLM-L6 (384d), all-MiniLM-L12 (384d), BGE-small (384d)
- Tokenizer: Simple WordPiece implementation (zero deps)
- Model loading: Download + cache ONNX models
- Keep TF-IDF/n-gram as lightweight fallbacks
- Batch inference support

### 8. Production Dashboard UI (`src/dashboard/static/index.html` — UPGRADE)
Full single-page application (vanilla JS, no framework):
- **Real-time metrics**: Token usage, cost, latency charts (Canvas-based)
- **Agent topology graph**: Force-directed graph of active agents
- **Memory explorer**: Browse semantic/episodic/working memories
- **Cost charts**: Budget burn-down, model cost comparison
- **Trace viewer**: Waterfall view of execution spans
- **Pipeline view**: Live 8-stage execution pipeline
- **Activity feed**: Scrollable real-time event log
- **Surface status**: All projection surfaces status cards

### 9. Agent Marketplace UI
Embedded in dashboard as a tab:
- **Agent catalog**: Browse available agents with cards
- **Search & filter**: By capability, cost, rating
- **Agent detail view**: Stats, reviews, pricing
- **Install/hire flow**: One-click agent hiring
- **Transaction history**: Cost tracking per agent
- **Publishing wizard**: Register your own agent

---

## Phase 3: 🟠 Not Started (Items 10-14)

### 10. CADP Protocol Specification (`src/protocol/cadp-spec.ts`)
- Machine-readable RFC document as TypeScript constants
- Protocol version negotiation
- Message format specification with Zod validation
- Wire format: JSON over HTTP/2 + WebSocket
- Discovery protocol: DNS TXT records + `.well-known/cadp.json`
- Security: Ed25519 signatures on all messages
- Reference implementation test vectors

### 11. Self-Improvement Loop (`src/self-improve/`)
**FeedbackLoop**: Records execution outcomes → adjusts strategy weights
**RegressionDetector**: Tracks quality/speed/cost metrics over time, alerts on regression
**CapabilityExpander**: When tasks fail, identifies missing capabilities and suggests tools/plugins

### 12. Agent-to-Agent Commerce (`src/commerce/`)
**NegotiationEngine**: Multi-round bid/ask protocol
**CoalitionManager**: Form temporary agent teams for complex tasks
**AuctionSystem**: Open/sealed-bid task auctions

### 13. Sovereign Mode (`src/sovereign/`)
**SovereignRuntime**: Complete offline orchestration
**LocalProvider**: Ollama-first with automatic model selection
**OfflineTools**: File I/O, git, shell — all tools that work without internet

### 14. Deploy Pipeline (`src/deploy/`)
**Deployer**: Orchestrates build → package → deploy → verify
**Packager**: Agent config → Docker/npm/edge bundle
**Targets**: Docker, npm, edge (Cloudflare/Lambda/Deno)

---

## Phase 4: ⚪ Visionary (Items 15-20)

### 15. Voice-to-Code (`src/voice/`)
Bridge to Web Speech API / system microphone → STT → command parser → CortexOS engine

### 16. Spatial Computing (`src/spatial/`)
3D topology data model → JSON scene graph → consumable by Three.js/WebXR clients

### 17. Cross-Org Federation (`src/protocol/trust-chain.ts`)
Ed25519 trust chains, certificate pinning, federated identity verification

### 18. Formal Verification (`src/verification/`)
Specification contracts, runtime invariant monitoring, pre/post condition checking

### 19. Time-Travel Debugging (`src/time-travel/`)
Decision recording, deterministic replay, divergence analysis

### 20. Multi-Modal Input (`src/multimodal/`)
Image → code via vision LLM, diagram parsing via edge detection, whiteboard task extraction

---

## Implementation Order (Dependency-Aware)

```
Parallel Stream A (Protocol):     1 → 10 → 17
Parallel Stream B (Surfaces):     4 → 2 → 3 → Discord
Parallel Stream C (Runtime):      5 → 6 → 7 → 13
Parallel Stream D (Economy):      12 → 11 → 14
Parallel Stream E (UI):           8 → 9
Parallel Stream F (Visionary):    18 → 19 → 15 → 16 → 20
```

## Execution Strategy

**Round 1** (Sync — Foundation): Items 1 (MCP Server) + 4 (Surface Manager)
**Round 2** (Parallel): Items 2,3 (GitHub+Slack) || Items 5,6,7 (Runtime upgrades) || Item 8 (Dashboard)
**Round 3** (Parallel): Items 10,11,12 (Protocol+Self-Improve+Commerce) || Items 9,13,14 (Marketplace UI+Sovereign+Deploy)
**Round 4** (Parallel): Items 15,16,17,18,19,20 (All visionary features)

## Conventions
- All new modules follow existing patterns: EventEmitter, Map-based state, async lifecycle
- Zero npm deps for protocol/surface layers (Node built-ins only)
- Kebab-case files, PascalCase classes, camelCase methods
- Events: `module:entity:action` pattern
- IDs: `prefix_${randomUUID().slice(0,8)}`
- All public classes get barrel exports in `src/index.ts`
- Tests: Vitest with describe/it/expect, comprehensive coverage

## New Events Added to CortexEvents
```typescript
// MCP Server events
'mcp:server:started': unknown;
'mcp:server:client:connected': unknown;
'mcp:server:tool:invoked': unknown;
'mcp:server:stopped': unknown;

// Surface events
'surface:started': unknown;
'surface:stopped': unknown;
'surface:error': unknown;
'surface:github:webhook': unknown;
'surface:github:pr:analyzed': unknown;
'surface:github:issue:triaged': unknown;
'surface:slack:command': unknown;
'surface:slack:message': unknown;
'surface:discord:command': unknown;
'surface:discord:message': unknown;

// Self-improvement events
'improve:feedback:recorded': unknown;
'improve:regression:detected': unknown;
'improve:capability:expanded': unknown;

// Commerce events
'commerce:negotiation:started': unknown;
'commerce:negotiation:completed': unknown;
'commerce:auction:started': unknown;
'commerce:auction:completed': unknown;
'commerce:coalition:formed': unknown;

// Sovereign events
'sovereign:started': unknown;
'sovereign:offline:ready': unknown;

// Deploy events
'deploy:started': unknown;
'deploy:packaged': unknown;
'deploy:deployed': unknown;
'deploy:verified': unknown;

// Verification events
'verify:spec:checked': unknown;
'verify:contract:violated': unknown;
'verify:invariant:broken': unknown;

// Time-travel events
'timetravel:recorded': unknown;
'timetravel:replayed': unknown;
'timetravel:diverged': unknown;

// Voice events
'voice:command:received': unknown;
'voice:transcription:complete': unknown;

// Multi-modal events
'multimodal:image:analyzed': unknown;
'multimodal:diagram:parsed': unknown;
```
