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
  [key: string]: unknown;
}
