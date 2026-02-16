import { z } from 'zod';

// ===== Configuration =====

export const CortexConfigSchema = z.object({
  providers: z.object({
    default: z.enum([
      'anthropic', 'openai', 'google', 'ollama',
      'groq', 'mistral', 'together', 'deepseek', 'fireworks', 'cohere',
    ]).default('anthropic'),
    anthropicApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
    googleApiKey: z.string().optional(),
    ollamaBaseUrl: z.string().default('http://localhost:11434'),
    groqApiKey: z.string().optional(),
    mistralApiKey: z.string().optional(),
    togetherApiKey: z.string().optional(),
    deepseekApiKey: z.string().optional(),
    fireworksApiKey: z.string().optional(),
    cohereApiKey: z.string().optional(),
    failoverEnabled: z.boolean().default(false),
    failoverOrder: z.array(z.string()).optional(),
  }).default({}),
  memory: z.object({
    enabled: z.boolean().default(true),
    globalDir: z.string().optional(),
    projectDir: z.string().optional(),
  }).default({}),
  agents: z.object({
    maxParallel: z.number().min(1).max(16).default(4),
    maxIterations: z.number().min(1).max(100).default(25),
    worktreesEnabled: z.boolean().default(true),
    useChildProcess: z.boolean().default(false),
    /**
     * Agent orchestration topology (Issues 66-70: GraphOrchestrator <-> Engine).
     * - 'linear': Use SwarmCoordinator with wave-based linear execution (default).
     * - 'graph': Use GraphOrchestrator for dependency-graph-based agent selection.
     *   When 'graph' is set, the engine should use GraphOrchestrator instead of
     *   SwarmCoordinator for complex multi-dependency task execution.
     */
    topology: z.enum(['linear', 'graph']).default('linear'),
  }).default({}),
  cost: z.object({
    budgetPerRun: z.number().default(1.0),
    budgetPerDay: z.number().default(10.0),
    preferCheap: z.boolean().default(false),
    cacheEnabled: z.boolean().default(true),
  }).default({}),
  quality: z.object({
    gates: z.array(z.string()).default(['syntax', 'lint']),
    autoFix: z.boolean().default(true),
    maxRetries: z.number().default(3),
  }).default({}),
  ui: z.object({
    verbose: z.boolean().default(false),
    showCost: z.boolean().default(true),
    showMemory: z.boolean().default(true),
    showPlan: z.boolean().default(true),
  }).default({}),
  reasoning: z.object({
    enabled: z.boolean().default(false),
    strategies: z.object({
      react: z.object({
        enabled: z.boolean().default(true),
        maxThoughts: z.number().default(10),
      }).default({}),
      reflexion: z.object({
        enabled: z.boolean().default(true),
        maxRetries: z.number().default(2),
        triggerOn: z.enum(['failure', 'low-quality', 'both']).default('failure'),
      }).default({}),
      treeOfThought: z.object({
        enabled: z.boolean().default(true),
        candidates: z.number().default(3),
        complexityThreshold: z.number().default(0.6),
      }).default({}),
      debate: z.object({
        enabled: z.boolean().default(false),
        debaters: z.number().default(3),
        rounds: z.number().default(2),
        complexityThreshold: z.number().default(0.8),
      }).default({}),
      rag: z.object({
        enabled: z.boolean().default(true),
        maxChunks: z.number().default(10),
        chunkSize: z.number().default(500),
        minRelevance: z.number().default(0.3),
      }).default({}),
      toolDiscovery: z.object({
        enabled: z.boolean().default(true),
        maxChainLength: z.number().default(5),
      }).default({}),
    }).default({}),
    costBudget: z.number().default(0.50),
  }).default({}),
  embeddings: z.object({
    provider: z.enum(['local', 'openai', 'cohere']).default('local'),
    model: z.string().optional(),
  }).default({}),
  dashboard: z.object({
    port: z.number().default(3100),
    autoOpen: z.boolean().default(true),
  }).default({}),
});

export type CortexConfig = z.infer<typeof CortexConfigSchema> & {
  // Extended config properties used at runtime
  defaultModel?: string;
  defaultProvider?: string;
  globalDir?: string;
  budget?: {
    maxCostPerRun?: number;
    maxCostPerDay?: number;
    warningThreshold?: number;
  };
  [key: string]: unknown;
};

// ===== Execution =====

export type ExecutionStage =
  | 'recall' | 'enhance' | 'analyze' | 'decompose'
  | 'plan' | 'execute' | 'verify' | 'memorize' | 'complete' | 'error';

export interface ExecutionResult {
  success: boolean;
  response: string;
  filesChanged: FileChange[];
  plan: {
    tasks: PlanTask[];
    waves: PlanWave[];
  };
  quality: {
    passed: boolean;
    score: number;
    gateResults: Array<{
      gate: string;
      passed: boolean;
      issues: number;
    }>;
  };
  cost: {
    totalTokens: number;
    totalCost: number;
    breakdown: Array<{
      model: string;
      tokens: number;
      cost: number;
    }>;
  };
  duration: number;
  memoriesRecalled: number;
  memoriesStored: number;
}

export interface ExecutionPlan {
  tasks: PlanTask[];
  waves: PlanWave[];
  estimatedCost: number;
  estimatedDuration: number;
}

export interface PlanTask {
  id: string;
  title?: string;
  description?: string;
  role: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  dependencies?: string[];
  wave?: number;
  result?: string;
}

export interface PlanWave {
  waveNumber?: number;
  index?: number;
  taskIds: string[];
  canParallelize?: boolean;
  parallelizable?: boolean;
}

// ===== Agent Results =====

export interface AgentResult {
  taskId: string;
  role?: string;
  success: boolean;
  response: string;
  output?: string;
  filesChanged?: FileChange[];
  toolCalls?: number;
  iterations?: number;
  tokensUsed?: TokenUsage;
  duration?: number;
  error?: string;
}

export interface FileChange {
  path: string;
  type: 'create' | 'modify' | 'delete';
  content?: string;
  action?: 'created' | 'modified' | 'deleted';
  linesAdded?: number;
  linesRemoved?: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

// ===== Quality =====

export interface QualityReport {
  passed: boolean;
  gates?: QualityGateResult[];
  issues?: QualityIssue[];
  autoFixed?: number;
  overallScore?: number;
  appliedFixes?: Array<{
    file: string;
    rule?: string;
    description: string;
    type: 'lint' | 'syntax' | 'suggestion';
    success: boolean;
  }>;
  results?: Array<{
    gate: string;
    passed: boolean;
    issues: QualityIssue[];
  }>;
}

export interface QualityGateResult {
  gate: string;
  passed: boolean;
  issues: QualityIssue[];
  duration: number;
}

export interface QualityIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  gate?: string;
  autoFixable?: boolean;
}

// ===== Cost =====

export interface CostReport {
  totalCost: number;
  totalTokens: TokenUsage;
  modelBreakdown: ModelCost[];
  budgetRemaining: number;
  budgetUsedPercent: number;
}

export interface ModelCost {
  model: string;
  provider: string;
  calls: number;
  tokens: TokenUsage;
  cost: number;
}

// ===== Events =====

export interface CortexEvents {
  'engine:start': unknown;
  'engine:complete': unknown;
  'engine:error': unknown;
  'stage:start': unknown;
  'stage:complete': unknown;
  'plan:created': unknown;
  'wave:start': unknown;
  'wave:complete': unknown;
  'agent:start': unknown;
  'agent:progress': unknown;
  'agent:tool': unknown;
  'agent:complete': unknown;
  'agent:error': unknown;
  'memory:recall': unknown;
  'memory:store': unknown;
  'quality:gate': unknown;
  'quality:autofix': unknown;
  'cost:update': unknown;
  'error': unknown;
  // Cloud events
  'container:created': unknown;
  'container:started': unknown;
  'container:completed': unknown;
  'container:failed': unknown;
  'container:timeout': unknown;
  // Collaboration events
  'session:shared': unknown;
  'session:joined': unknown;
  'session:left': unknown;
  'session:steered': unknown;
  'artifact:created': unknown;
  // Automation events
  'automation:skill:start': unknown;
  'automation:skill:complete': unknown;
  'automation:schedule:fired': unknown;
  'automation:webhook:received': unknown;
  // MCP/A2A Protocol events (Phase I)
  'mcp:server:connected': unknown;
  'mcp:server:disconnected': unknown;
  'mcp:server:error': unknown;
  'mcp:tool:called': unknown;
  'mcp:tool:result': unknown;
  'a2a:task:received': unknown;
  'a2a:task:completed': unknown;
  'a2a:task:failed': unknown;
  'a2a:agent:discovered': unknown;
  'bridge:translation': unknown;
  // Daemon/Ambient events (Phase II)
  'daemon:started': unknown;
  'daemon:stopped': unknown;
  'daemon:file:changed': unknown;
  'daemon:critic:complete': unknown;
  'daemon:report:generated': unknown;
  // Marketplace events (Phase III)
  'marketplace:agent:registered': unknown;
  'marketplace:agent:removed': unknown;
  'marketplace:discovery:search': unknown;
  'marketplace:transaction:started': unknown;
  'marketplace:transaction:completed': unknown;
  'marketplace:negotiation:started': unknown;
  'marketplace:negotiation:completed': unknown;
  // CADP Protocol events (Phase IV)
  'cadp:agent:registered': unknown;
  'cadp:agent:deregistered': unknown;
  'cadp:lookup:hit': unknown;
  'cadp:lookup:miss': unknown;
  'cadp:peer:connected': unknown;
  'cadp:peer:disconnected': unknown;
  'cadp:peer:synced': unknown;
  'cadp:route:updated': unknown;
  // Runtime events (Phase V)
  'runtime:wasm:loaded': unknown;
  'runtime:wasm:executed': unknown;
  'runtime:wasm:error': unknown;
  'runtime:edge:connected': unknown;
  'runtime:edge:disconnected': unknown;
  'runtime:edge:deployed': unknown;
  'runtime:embedding:computed': unknown;
  'runtime:embedding:cached': unknown;
  // Verification events (Phase VI)
  'verify:spec:checked': unknown;
  'verify:contract:violated': unknown;
  'verify:invariant:broken': unknown;
  // Time-Travel events (Phase VI)
  'timetravel:recorded': unknown;
  'timetravel:replayed': unknown;
  'timetravel:diverged': unknown;
  // Multi-Modal events (Phase VI)
  'multimodal:image:analyzed': unknown;
  'multimodal:diagram:parsed': unknown;
  'multimodal:whiteboard:processed': unknown;
  // Trust Chain events
  'trust:peer:added': unknown;
  'trust:peer:removed': unknown;
  'trust:keys:rotated': unknown;
  // Surface events (Phase VI)
  'surface:started': unknown;
  'surface:stopped': unknown;
  'surface:error': unknown;
  'surface:github:webhook': unknown;
  'surface:github:pr:analyzed': unknown;
  'surface:github:issue:triaged': unknown;
  'surface:slack:command': unknown;
  'surface:slack:event': unknown;
  'surface:slack:interaction': unknown;
  'surface:discord:command': unknown;
  'surface:discord:interaction': unknown;
  // MCP Server events
  'mcp:server:started': unknown;
  'mcp:server:stopped': unknown;
  'mcp:server:request': unknown;
  'mcp:server:tool:registered': unknown;
  'mcp:server:resource:registered': unknown;
  // Self-Improvement events
  'selfimprove:cycle:started': unknown;
  'selfimprove:cycle:completed': unknown;
  'selfimprove:benchmark:run': unknown;
  'selfimprove:prompt:optimized': unknown;
  'selfimprove:strategy:updated': unknown;
  // Commerce events
  'commerce:contract:created': unknown;
  'commerce:contract:fulfilled': unknown;
  'commerce:contract:disputed': unknown;
  'commerce:payment:completed': unknown;
  'commerce:reputation:updated': unknown;
  // Sovereign/Air-Gap events
  'sovereign:started': unknown;
  'sovereign:stopped': unknown;
  'sovereign:model:loaded': unknown;
  'sovereign:chat:complete': unknown;
  'sovereign:embedding:complete': unknown;
  'sovereign:tool:executed': unknown;
  // Deploy Pipeline events
  'deploy:started': unknown;
  'deploy:completed': unknown;
  'deploy:failed': unknown;
  'deploy:rollback': unknown;
  'deploy:verified': unknown;
  // Voice-to-Code events
  'voice:transcription:started': unknown;
  'voice:transcription:completed': unknown;
  'voice:command:parsed': unknown;
  'voice:code:generated': unknown;
  // Spatial Computing events
  'spatial:session:started': unknown;
  'spatial:session:stopped': unknown;
  'spatial:gesture:recognized': unknown;
  'spatial:node:created': unknown;
  'spatial:node:connected': unknown;
  [key: string]: unknown;
}
