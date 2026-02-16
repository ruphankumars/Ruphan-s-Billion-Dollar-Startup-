/**
 * CortexOS Evolution Engine — CRSAE Types
 * Convergent Recursive Self-Aggregating Evolution
 *
 * Zero external dependencies. Node.js built-ins only.
 */

// ─── Population Reasoning Types ─────────────────────────────────────────────

export interface PopulationConfig {
  /** Number of candidate solutions per task (N) */
  populationSize: number;
  /** Number of candidates to aggregate per iteration (K) */
  aggregationSetSize: number;
  /** Maximum iteration depth (T) */
  maxIterations: number;
  /** Convergence similarity threshold (0-1) */
  convergenceThreshold: number;
  /** Maximum tokens per candidate generation */
  maxTokensPerCandidate: number;
  /** Enable diversity tracking */
  trackDiversity: boolean;
}

export interface Candidate {
  id: string;
  content: string;
  score: number;
  iteration: number;
  parentIds: string[];
  metadata: Record<string, unknown>;
}

export interface PopulationState {
  candidates: Candidate[];
  iteration: number;
  diversityScore: number;
  converged: boolean;
  bestCandidate: Candidate | null;
}

export interface AggregationResult {
  aggregatedContent: string;
  sourceIds: string[];
  improvementScore: number;
}

// ─── Convergence Detection Types ────────────────────────────────────────────

export interface ConvergenceConfig {
  /** Similarity threshold for convergence (default 0.98) */
  similarityThreshold: number;
  /** Minimum iterations before convergence check */
  minIterations: number;
  /** Window size for stability detection */
  stabilityWindow: number;
  /** Method for similarity computation */
  method: 'cosine' | 'jaccard' | 'levenshtein';
}

export interface ConvergenceResult {
  converged: boolean;
  similarity: number;
  iterations: number;
  stabilityScore: number;
  history: number[];
}

// ─── Budget Controller Types ────────────────────────────────────────────────

export interface BudgetConfig {
  /** Maximum API calls per task */
  maxApiCalls: number;
  /** Maximum tokens per task */
  maxTokens: number;
  /** Maximum wall-clock time in milliseconds */
  maxTimeMs: number;
  /** Maximum recursion depth */
  maxDepth: number;
  /** Cost ceiling in dollars */
  maxCostUsd: number;
  /** Enable automatic budget scaling for critical tasks */
  autoScale: boolean;
  /** Budget tier (affects all limits proportionally) */
  tier: BudgetTier;
}

export type BudgetTier = 'minimal' | 'standard' | 'enhanced' | 'critical';

export interface BudgetState {
  apiCallsUsed: number;
  tokensUsed: number;
  elapsedMs: number;
  currentDepth: number;
  costUsd: number;
  remaining: BudgetRemaining;
  exhausted: boolean;
}

export interface BudgetRemaining {
  apiCalls: number;
  tokens: number;
  timeMs: number;
  depth: number;
  costUsd: number;
}

// ─── Meta-Controller Types ──────────────────────────────────────────────────

export interface MetaControllerConfig {
  /** Enable adaptive strategy selection */
  adaptiveStrategy: boolean;
  /** Enable adaptive compute scaling */
  adaptiveCompute: boolean;
  /** Enable self-evolution of the controller itself */
  selfEvolve: boolean;
  /** Learning rate for strategy weight updates */
  learningRate: number;
  /** History size for decision tracking */
  maxDecisionHistory: number;
  /** Confidence threshold for compute escalation */
  escalationThreshold: number;
}

export type OrchestrationMode = 'linear-wave' | 'graph-based' | 'hybrid' | 'single-agent';
export type ComputeScale = 'minimal' | 'standard' | 'parallel' | 'sequential' | 'hybrid';
export type ReasoningDepth = 'shallow' | 'standard' | 'deep' | 'exhaustive';

export interface OrchestrationDecision {
  id: string;
  timestamp: number;
  taskId: string;
  mode: OrchestrationMode;
  computeScale: ComputeScale;
  reasoningDepth: ReasoningDepth;
  populationConfig: Partial<PopulationConfig>;
  budgetAllocation: Partial<BudgetConfig>;
  confidence: number;
  reasoning: string;
}

export interface DecisionOutcome {
  decisionId: string;
  success: boolean;
  qualityScore: number;
  speedMs: number;
  tokenCost: number;
  feedback: string;
}

export interface StrategyWeight {
  strategy: string;
  weight: number;
  taskTypeWeights: Map<string, number>;
  successRate: number;
  avgQuality: number;
  sampleCount: number;
}

// ─── Skill Library Types ────────────────────────────────────────────────────

export interface SkillLibraryConfig {
  /** Maximum number of skills to store */
  maxSkills: number;
  /** Minimum usage count to keep a skill */
  minUsageForRetention: number;
  /** Skill expiry time in milliseconds (0 = never) */
  expiryMs: number;
  /** Enable skill composition (combining multiple skills) */
  enableComposition: boolean;
  /** Optional file path for JSON persistence (Issues 76-78) */
  persistPath?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  code: string;
  promptTemplate: string;
  toolConfig: Record<string, unknown>;
  usageCount: number;
  successRate: number;
  avgQuality: number;
  createdAt: number;
  lastUsedAt: number;
  tags: string[];
  dependencies: string[];
}

export type SkillCategory =
  | 'code-generation'
  | 'code-review'
  | 'testing'
  | 'debugging'
  | 'refactoring'
  | 'documentation'
  | 'architecture'
  | 'data-processing'
  | 'api-integration'
  | 'optimization'
  | 'security'
  | 'devops'
  | 'custom';

// ─── Strategy Evolver Types ─────────────────────────────────────────────────

export interface StrategyEvolverConfig {
  /** Learning rate for EMA weight updates */
  learningRate: number;
  /** Exploration rate (epsilon-greedy) */
  explorationRate: number;
  /** Minimum samples before strategy considered reliable */
  minSamples: number;
  /** Maximum strategy variants to maintain */
  maxVariants: number;
  /** Enable cross-task transfer learning */
  crossTaskTransfer: boolean;
  /** Optional file path for JSON persistence (Issues 76-78) */
  persistPath?: string;
}

export interface StrategyVariant {
  id: string;
  name: string;
  config: Record<string, unknown>;
  weight: number;
  taskTypePerformance: Map<string, PerformanceMetric>;
  generationNumber: number;
  parentId: string | null;
}

export interface PerformanceMetric {
  successRate: number;
  avgQuality: number;
  avgSpeed: number;
  avgCost: number;
  sampleCount: number;
}

// ─── Cycle Detector Types ───────────────────────────────────────────────────

export interface CycleDetectorConfig {
  /** Maximum graph size before forced pruning */
  maxNodes: number;
  /** Enable real-time cycle detection on edge addition */
  realtimeDetection: boolean;
  /** Maximum depth for DFS traversal */
  maxTraversalDepth: number;
}

export interface CycleInfo {
  detected: boolean;
  path: string[];
  depth: number;
  type: 'self-reference' | 'mutual' | 'transitive';
}

// ─── Self-Tester Types ──────────────────────────────────────────────────────

export interface SelfTesterConfig {
  /** Maximum test iterations per output */
  maxTestIterations: number;
  /** Minimum confidence to pass self-test */
  minConfidence: number;
  /** Enable regression testing against previous outputs */
  enableRegression: boolean;
  /** Maximum time for self-test in milliseconds */
  maxTestTimeMs: number;
}

export interface SelfTestResult {
  id: string;
  passed: boolean;
  confidence: number;
  issues: SelfTestIssue[];
  iterations: number;
  timeMs: number;
  regressions: string[];
}

export interface SelfTestIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  location: string;
  suggestion: string;
}

// ─── Evolution Engine Aggregate Types ───────────────────────────────────────

export interface EvolutionConfig {
  population: Partial<PopulationConfig>;
  convergence: Partial<ConvergenceConfig>;
  budget: Partial<BudgetConfig>;
  metaController: Partial<MetaControllerConfig>;
  skillLibrary: Partial<SkillLibraryConfig>;
  strategyEvolver: Partial<StrategyEvolverConfig>;
  cycleDetector: Partial<CycleDetectorConfig>;
  selfTester: Partial<SelfTesterConfig>;
}

export interface EvolutionStats {
  totalTasksProcessed: number;
  totalIterations: number;
  avgConvergenceIterations: number;
  avgPopulationDiversity: number;
  strategyDistribution: Record<string, number>;
  skillCount: number;
  budgetUtilization: number;
  selfTestPassRate: number;
  cyclesDetected: number;
  improvementRate: number;
}

export type EvolutionEventType =
  | 'evolution:started'
  | 'evolution:iteration'
  | 'evolution:converged'
  | 'evolution:budget:warning'
  | 'evolution:budget:exhausted'
  | 'evolution:strategy:selected'
  | 'evolution:strategy:evolved'
  | 'evolution:skill:created'
  | 'evolution:skill:used'
  | 'evolution:cycle:detected'
  | 'evolution:selftest:passed'
  | 'evolution:selftest:failed'
  | 'evolution:meta:decision';
