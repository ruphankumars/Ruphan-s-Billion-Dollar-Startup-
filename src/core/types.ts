import { z } from 'zod';

// ===== Configuration =====

export const CortexConfigSchema = z.object({
  providers: z.object({
    default: z.enum(['anthropic', 'openai', 'google', 'ollama']).default('anthropic'),
    anthropicApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
    googleApiKey: z.string().optional(),
    ollamaBaseUrl: z.string().default('http://localhost:11434'),
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
  'cost:update': unknown;
  'error': unknown;
  [key: string]: unknown;
}
