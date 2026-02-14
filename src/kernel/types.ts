/**
 * CortexOS Kernel — Core Foundation Type System
 *
 * Defines the type system for the 19 Kernel Primitives organized in a
 * 6-layer dependency hierarchy — analogous to Unix syscalls for AI.
 *
 * Layer 0 (Hardware Abstraction): attention()
 * Layer 1 (Core Execution): scale(), reason(), extend()
 * Layer 2 (Memory Subsystem): retrieve(), remember(), compress(), index(), evolve_memory()
 * Layer 3 (Reasoning & Search): search(), simulate()
 * Layer 4 (Model Lifecycle): adapt(), instruct(), distill(), align(), cascade()
 * Layer 5 (Coordination & Routing): route(), self_evolve(), judge()
 *
 * Research Foundations:
 * - Transformer (Vaswani 2017) → attention()
 * - Chain-of-Thought (Wei 2022) → reason()
 * - Tree-of-Thought (Yao 2023) → search()
 * - RAG (Lewis 2020) → retrieve()
 * - LoRA (Hu 2021) → adapt()
 * - DroPE (2025) → attention() RoPE extension
 * - UniversalRAG (2025) → route() multimodal
 * - MemRL (2025) → remember() Q-value based
 * - Focus (2025) → compress() slime mold GC
 * - SimpleMem (2025) → index() memory indexing
 * - Dr. Zero (2025) → evolve_memory() self-curriculum
 *
 * Zero external dependencies. Node.js built-ins only.
 */

import type { BudgetConfig } from '../evolution/types.js';

// ─── Kernel Primitive Identifiers ──────────────────────────────────────────

/** All 19 kernel primitives — the syscall table of CortexOS */
export type KernelPrimitiveId =
  // Layer 0: Hardware Abstraction
  | 'attention'
  // Layer 1: Core Execution
  | 'scale'
  | 'reason'
  | 'extend'
  // Layer 2: Memory Subsystem
  | 'retrieve'
  | 'remember'
  | 'compress'
  | 'index'
  | 'evolve_memory'
  // Layer 3: Reasoning & Search
  | 'search'
  | 'simulate'
  // Layer 4: Model Lifecycle
  | 'adapt'
  | 'instruct'
  | 'distill'
  | 'align'
  | 'cascade'
  // Layer 5: Coordination & Routing
  | 'route'
  | 'self_evolve'
  | 'judge';

/** Kernel layer number (0 = lowest, 5 = highest) */
export type KernelLayer = 0 | 1 | 2 | 3 | 4 | 5;

// ─── Layer 0: Hardware Abstraction ─────────────────────────────────────────

/** attention() — The foundational compute primitive (Transformer, DroPE) */
export interface AttentionConfig {
  /** Number of attention heads */
  numHeads: number;
  /** Head dimension */
  headDim: number;
  /** Maximum sequence length */
  maxSeqLength: number;
  /** Position encoding: rotary (RoPE/DroPE) or absolute */
  positionEncoding: 'rotary' | 'absolute' | 'alibi' | 'none';
  /** Enable flash attention optimization */
  flashAttention: boolean;
  /** Attention window size (0 = full) */
  windowSize: number;
  /** Dropout rate */
  dropout: number;
}

export interface AttentionInput {
  query: number[][];
  key: number[][];
  value: number[][];
  mask?: boolean[][];
  positionIds?: number[];
}

export interface AttentionOutput {
  output: number[][];
  attentionWeights: number[][];
  computeMs: number;
}

// ─── Layer 1: Core Execution ───────────────────────────────────────────────

/** scale() — Test-time compute scaling (RSA, STOP) */
export interface ScaleConfig {
  /** Scaling mode */
  mode: 'parallel' | 'sequential' | 'hybrid';
  /** Number of parallel candidates (N) */
  numCandidates: number;
  /** Sequential refinement steps (T) */
  refinementSteps: number;
  /** Confidence threshold for early stopping */
  confidenceThreshold: number;
  /** Maximum total tokens */
  maxTotalTokens: number;
}

export interface ScaleInput {
  task: string;
  candidates?: string[];
  currentConfidence?: number;
}

export interface ScaleOutput {
  bestCandidate: string;
  confidence: number;
  candidatesEvaluated: number;
  totalTokens: number;
  scalingMode: string;
}

/** reason() — Chain-of-thought reasoning (CoT, Reflexion) */
export interface ReasonConfig {
  /** Reasoning strategy */
  strategy: 'zero-shot' | 'few-shot' | 'self-consistency' | 'least-to-most';
  /** Maximum reasoning steps */
  maxSteps: number;
  /** Temperature for generation */
  temperature: number;
  /** Enable self-reflection after reasoning */
  enableReflection: boolean;
  /** Number of parallel chains for self-consistency */
  numChains: number;
}

export interface ReasonInput {
  problem: string;
  context?: string;
  fewShotExamples?: Array<{ problem: string; reasoning: string; answer: string }>;
}

export interface ReasonOutput {
  conclusion: string;
  steps: ReasoningStep[];
  confidence: number;
  chainId: string;
  reflections?: string[];
}

/** extend() — Context window extension (RoPE, DroPE, YaRN) */
export interface ExtendConfig {
  /** Extension method */
  method: 'rope-scaling' | 'drope' | 'yarn' | 'longrope' | 'sliding-window';
  /** Target context length */
  targetLength: number;
  /** Scaling factor */
  scalingFactor: number;
  /** Base frequency for RoPE */
  baseFrequency: number;
}

export interface ExtendInput {
  tokens: number[];
  positionIds: number[];
  currentMaxLength: number;
}

export interface ExtendOutput {
  extendedTokens: number[];
  effectiveLength: number;
  compressionRatio: number;
}

// ─── Layer 2: Memory Subsystem ─────────────────────────────────────────────

/** retrieve() — Retrieval-Augmented Generation (RAG, UniversalRAG) */
export interface RetrieveConfig {
  /** Maximum results to return */
  topK: number;
  /** Minimum similarity score */
  minScore: number;
  /** Retrieval method */
  method: 'dense' | 'sparse' | 'hybrid' | 'multimodal';
  /** Enable reranking */
  rerank: boolean;
  /** Maximum context tokens for retrieved chunks */
  maxContextTokens: number;
}

export interface RetrieveInput {
  query: string;
  filters?: Record<string, unknown>;
  modality?: 'text' | 'code' | 'image' | 'audio' | 'video' | 'structured';
}

export interface RetrieveOutput {
  results: Array<{
    content: string;
    score: number;
    metadata: Record<string, unknown>;
    source: string;
  }>;
  totalMatches: number;
  retrievalMs: number;
}

/** remember() — Memory storage with Q-value management (MemRL) */
export interface RememberConfig {
  /** Short-term memory capacity */
  stmCapacity: number;
  /** Long-term memory capacity */
  ltmCapacity: number;
  /** Q-value learning rate */
  qLearningRate: number;
  /** Q-value discount factor */
  qDiscountFactor: number;
  /** Eviction strategy */
  evictionStrategy: 'q-value' | 'lru' | 'lfu' | 'fifo';
  /** Auto-promote STM → LTM threshold */
  promotionThreshold: number;
}

export interface RememberInput {
  key: string;
  value: unknown;
  scope?: 'stm' | 'ltm';
  tags?: string[];
  importance?: number;
}

export interface RememberOutput {
  memoryId: string;
  scope: 'stm' | 'ltm';
  qValue: number;
  stored: boolean;
  evicted?: string[];
}

/** compress() — Context compression / slime mold GC (Focus) */
export interface CompressConfig {
  /** Target compression ratio */
  targetRatio: number;
  /** Compression method */
  method: 'summarize' | 'extract-key' | 'merge-similar' | 'slime-mold';
  /** Minimum Q-value to retain */
  retentionThreshold: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
}

export interface CompressInput {
  entries: Array<{ id: string; content: string; qValue: number; accessCount: number }>;
  targetSize?: number;
}

export interface CompressOutput {
  compressed: Array<{ id: string; content: string; originalIds: string[] }>;
  compressionRatio: number;
  entriesRemoved: number;
  entriesMerged: number;
}

/** index() — Memory indexing for efficient retrieval (SimpleMem) */
export interface IndexConfig {
  /** Index type */
  indexType: 'inverted' | 'vector' | 'hybrid' | 'graph';
  /** Embedding dimension for vector index */
  embeddingDim: number;
  /** Maximum entries before auto-rebuild */
  maxEntries: number;
  /** Enable incremental updates */
  incrementalUpdate: boolean;
}

export interface IndexInput {
  entries: Array<{ id: string; content: string; metadata?: Record<string, unknown> }>;
  operation: 'add' | 'update' | 'remove' | 'rebuild';
}

export interface IndexOutput {
  entriesProcessed: number;
  indexSize: number;
  rebuildRequired: boolean;
  indexMs: number;
}

/** evolve_memory() — Memory evolution / self-curriculum (Dr. Zero) */
export interface EvolveMemoryConfig {
  /** Evolution strategy */
  strategy: 'curriculum' | 'prune-grow' | 'consolidate' | 'specialize';
  /** Maximum evolution rounds per cycle */
  maxRounds: number;
  /** Quality threshold for retention */
  qualityThreshold: number;
  /** Enable difficulty scheduling */
  difficultySchedule: 'linear' | 'exponential' | 'adaptive';
}

export interface EvolveMemoryInput {
  memories: Array<{ id: string; content: string; quality: number; accessFrequency: number }>;
  currentRound: number;
}

export interface EvolveMemoryOutput {
  evolved: Array<{ id: string; content: string; quality: number }>;
  pruned: string[];
  newCurriculum: Array<{ difficulty: number; topic: string }>;
  evolutionScore: number;
}

// ─── Layer 3: Reasoning & Search ───────────────────────────────────────────

/** search() — Tree/graph search over reasoning space (ToT, MCTS) */
export interface SearchConfig {
  /** Search algorithm */
  algorithm: 'bfs' | 'dfs' | 'beam' | 'mcts';
  /** Maximum nodes to explore */
  maxNodes: number;
  /** Beam width for beam search */
  beamWidth: number;
  /** MCTS exploration constant */
  explorationConstant: number;
  /** Maximum depth */
  maxDepth: number;
  /** Enable pruning */
  pruning: boolean;
}

export interface SearchInput {
  problem: string;
  initialState: string;
  evaluator?: string;
  goalTest?: string;
}

export interface SearchOutput {
  bestPath: string[];
  bestScore: number;
  nodesExplored: number;
  treeId: string;
  searchMs: number;
}

/** simulate() — World model simulation / Monte Carlo rollout */
export interface SimulateConfig {
  /** Number of rollout trajectories */
  numTrajectories: number;
  /** Maximum steps per trajectory */
  maxSteps: number;
  /** Discount factor for rewards */
  discountFactor: number;
  /** Sampling strategy */
  sampling: 'uniform' | 'importance' | 'roulette';
}

export interface SimulateInput {
  initialState: string;
  transitionModel: string;
  rewardModel?: string;
}

export interface SimulateOutput {
  trajectories: Array<{
    states: string[];
    rewards: number[];
    totalReward: number;
  }>;
  expectedReward: number;
  bestTrajectory: number;
  simulationMs: number;
}

// ─── Layer 4: Model Lifecycle ──────────────────────────────────────────────

/** adapt() — LoRA / adapter management (LoRA, QLoRA) */
export interface AdaptConfig {
  /** Adapter type */
  adapterType: 'lora' | 'qlora' | 'ia3' | 'prefix-tuning';
  /** LoRA rank */
  rank: number;
  /** LoRA alpha */
  alpha: number;
  /** Dropout for adapter */
  dropout: number;
  /** Target modules for adaptation */
  targetModules: string[];
}

export interface AdaptInput {
  baseModel: string;
  taskType: string;
  trainingData?: Array<{ input: string; output: string }>;
}

export interface AdaptOutput {
  adapterId: string;
  adapterSize: number;
  taskType: string;
  applied: boolean;
}

/** instruct() — Instruction tuning / alignment (RLHF, DPO) */
export interface InstructConfig {
  /** Instruction format */
  format: 'chat' | 'completion' | 'structured';
  /** System prompt template */
  systemTemplate: string;
  /** Maximum instruction tokens */
  maxInstructTokens: number;
  /** Enable self-instruct generation */
  selfInstruct: boolean;
}

export interface InstructInput {
  instruction: string;
  context?: string;
  constraints?: string[];
  outputFormat?: string;
}

export interface InstructOutput {
  response: string;
  followedConstraints: boolean;
  instructionTokens: number;
  responseTokens: number;
}

/** distill() — Knowledge distillation (Hinton 2015) */
export interface DistillConfig {
  /** Temperature for soft targets */
  temperature: number;
  /** Weight of distillation loss vs task loss */
  alpha: number;
  /** Distillation method */
  method: 'logit' | 'feature' | 'attention' | 'progressive';
  /** Student model size ratio */
  studentRatio: number;
}

export interface DistillInput {
  teacherModel: string;
  studentModel: string;
  dataset?: Array<{ input: string; teacherOutput: string }>;
}

export interface DistillOutput {
  distillId: string;
  studentModel: string;
  qualityRetention: number;
  speedup: number;
  status: 'configured' | 'in-progress' | 'completed' | 'failed';
}

/** align() — Value alignment (RLHF, Constitutional AI, DPO) */
export interface AlignConfig {
  /** Alignment method */
  method: 'rlhf' | 'dpo' | 'constitutional' | 'self-rewarding';
  /** Number of preference pairs per round */
  pairsPerRound: number;
  /** Alignment learning rate */
  learningRate: number;
  /** Constitutional AI principles */
  principles: string[];
}

export interface AlignInput {
  output: string;
  context: string;
  criteria?: string[];
}

export interface AlignOutput {
  alignedOutput: string;
  alignmentScore: number;
  violationsFound: string[];
  revisionsApplied: number;
}

/** cascade() — Confidence-gated model cascading */
export interface CascadeConfig {
  /** Model tiers (ordered by capability/cost) */
  tiers: Array<{ model: string; confidenceThreshold: number; costPerToken: number }>;
  /** Confidence threshold to skip to next tier */
  escalationThreshold: number;
  /** Maximum tiers to try */
  maxTiers: number;
  /** Enable depth-aware routing (RLM pattern) */
  depthAware: boolean;
}

export interface CascadeInput {
  task: string;
  initialConfidence?: number;
  depth?: number;
  constraints?: { maxCost?: number; maxLatencyMs?: number };
}

export interface CascadeOutput {
  response: string;
  modelUsed: string;
  tierIndex: number;
  confidence: number;
  totalCost: number;
  totalLatencyMs: number;
}

// ─── Layer 5: Coordination & Routing ───────────────────────────────────────

/** route() — Modality-aware routing (UniversalRAG) */
export interface RouteConfig {
  /** Available modalities */
  modalities: string[];
  /** Default route */
  defaultRoute: string;
  /** Enable multimodal fusion */
  multimodalFusion: boolean;
  /** Routing strategy */
  strategy: 'rule-based' | 'learned' | 'adaptive';
}

export interface RouteInput {
  input: unknown;
  inputModality?: string;
  targetModality?: string;
  constraints?: Record<string, unknown>;
}

export interface RouteOutput {
  routeId: string;
  selectedRoute: string;
  modality: string;
  confidence: number;
  routingMs: number;
}

/** self_evolve() — Meta-RL self-evolution (Gödel Agent, STOP) */
export interface SelfEvolveConfig {
  /** Evolution mechanism */
  mechanism: 'meta-rl' | 'genetic' | 'gradient-free' | 'curriculum';
  /** Population size for evolutionary search */
  populationSize: number;
  /** Mutation rate */
  mutationRate: number;
  /** Enable formal verification of modifications */
  formalVerification: boolean;
  /** Maximum evolution generations */
  maxGenerations: number;
}

export interface SelfEvolveInput {
  currentStrategy: Record<string, unknown>;
  performanceHistory: Array<{ score: number; config: Record<string, unknown> }>;
  objective: string;
}

export interface SelfEvolveOutput {
  evolvedStrategy: Record<string, unknown>;
  improvementScore: number;
  generation: number;
  verified: boolean;
  changelog: string[];
}

/** judge() — Multi-judge evaluation panel (LLM-as-Judge) */
export interface JudgeConfig {
  /** Number of judges */
  numJudges: number;
  /** Consensus method */
  consensusMethod: 'majority' | 'weighted' | 'debate' | 'unanimous';
  /** Scoring rubric categories */
  rubricCategories: string[];
  /** Minimum agreement threshold */
  agreementThreshold: number;
}

export interface JudgeInput {
  output: string;
  criteria: string[];
  context?: string;
  reference?: string;
}

export interface JudgeOutput {
  verdictId: string;
  passed: boolean;
  overallScore: number;
  categoryScores: Record<string, number>;
  consensus: number;
  judgeVotes: Array<{ judgeId: string; score: number; reasoning: string }>;
}

// ─── Kernel Infrastructure Types ───────────────────────────────────────────

/** Generic kernel primitive interface */
export interface KernelPrimitive<TConfig, TInput, TOutput> {
  id: KernelPrimitiveId;
  layer: KernelLayer;
  config: TConfig;
  call(input: TInput): Promise<TOutput>;
  isEnabled(): boolean;
}

/** Kernel primitive handler function */
export type PrimitiveHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput
) => Promise<TOutput>;

/** Kernel configuration */
export interface KernelConfig {
  /** Enable all primitives on start */
  autoStart: boolean;
  /** Global budget for kernel operations */
  budget?: Partial<BudgetConfig>;
  /** Enable kernel event tracing */
  tracing: boolean;
  /** Maximum concurrent primitive calls */
  maxConcurrency: number;
  /** Call timeout in ms */
  callTimeoutMs: number;
}

/** Kernel budget tracking */
export interface KernelBudget {
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  callsByPrimitive: Record<string, number>;
}

/** Reasoning step used by reason() */
export interface ReasoningStep {
  id: string;
  content: string;
  type: 'hypothesis' | 'evidence' | 'deduction' | 'conclusion' | 'reflection';
  parentId: string | null;
  confidence: number;
  timestamp: number;
}

// ─── Kernel Registry Types ─────────────────────────────────────────────────

/** Record of a kernel primitive call */
export interface KernelCallRecord {
  primitiveId: KernelPrimitiveId;
  callId: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

/** Dependency validation result */
export interface KernelDependencyValidation {
  valid: boolean;
  missingDependencies: Array<{
    primitive: KernelPrimitiveId;
    missing: KernelPrimitiveId[];
  }>;
  circularDependencies: KernelPrimitiveId[][];
}

/** Per-layer statistics */
export interface KernelLayerStats {
  layer: KernelLayer;
  registeredCount: number;
  enabledCount: number;
  totalCalls: number;
  avgDurationMs: number;
  errorRate: number;
}

/** Overall kernel registry statistics */
export interface KernelRegistryStats {
  running: boolean;
  registeredPrimitives: number;
  enabledPrimitives: number;
  totalCalls: number;
  totalErrors: number;
  errorRate: number;
  avgCallDurationMs: number;
  layerStats: Record<number, KernelLayerStats>;
  callHistory: KernelCallRecord[];
  config: KernelConfig;
}

// ─── Kernel Event Types ────────────────────────────────────────────────────

export type KernelEventType =
  | 'kernel:started'
  | 'kernel:stopped'
  | 'kernel:primitive:registered'
  | 'kernel:primitive:unregistered'
  | 'kernel:primitive:called'
  | 'kernel:primitive:completed'
  | 'kernel:primitive:error'
  | 'kernel:primitive:enabled'
  | 'kernel:primitive:disabled'
  | 'kernel:budget:warning'
  | 'kernel:budget:exhausted'
  | 'kernel:dependency:validated';

export interface KernelPrimitiveRegisteredEvent {
  primitiveId: KernelPrimitiveId;
  layer: KernelLayer;
  timestamp: number;
}

export interface KernelPrimitiveCalledEvent {
  primitiveId: KernelPrimitiveId;
  callId: string;
  timestamp: number;
}

export interface KernelPrimitiveCompletedEvent {
  primitiveId: KernelPrimitiveId;
  callId: string;
  durationMs: number;
  timestamp: number;
}

export interface KernelPrimitiveErrorEvent {
  primitiveId: KernelPrimitiveId;
  callId: string;
  error: string;
  timestamp: number;
}

// ─── Kernel Primitive Metadata ─────────────────────────────────────────────

export interface KernelPrimitiveMetadata {
  id: KernelPrimitiveId;
  name: string;
  layer: KernelLayer;
  description: string;
  dependencies: KernelPrimitiveId[];
  researchOrigin: string;
}

// ─── Agent Primitive Identifiers (Userspace API) ───────────────────────────

/** The 10 userspace agent primitives that map to kernel syscalls */
export type AgentPrimitiveId =
  | 'cortex.llm'
  | 'cortex.tools'
  | 'cortex.rag'
  | 'cortex.memory'
  | 'cortex.agents'
  | 'cortex.web'
  | 'cortex.mcp'
  | 'cortex.observe'
  | 'cortex.ui'
  | 'cortex.evolve';

// ─── Context Manager Types ─────────────────────────────────────────────────

export interface ContextManagerConfig {
  /** STM capacity (number of entries) */
  stmCapacity: number;
  /** LTM capacity (number of entries) */
  ltmCapacity: number;
  /** Q-value learning rate */
  qLearningRate: number;
  /** Q-value discount factor */
  qDiscountFactor: number;
  /** Auto-compress when STM hits this percentage */
  autoCompressThreshold: number;
  /** Minimum Q-value for LTM promotion */
  promotionQThreshold: number;
  /** Enable semantic indexing */
  enableSemanticIndex: boolean;
}

export interface MemoryEntry {
  id: string;
  key: string;
  value: unknown;
  scope: 'stm' | 'ltm';
  qValue: number;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
  tags: string[];
  importance: number;
}

export interface KnowledgeBlock {
  id: string;
  summary: string;
  sourceIds: string[];
  createdAt: number;
  compressionRatio: number;
}

export interface SemanticIndex {
  entryId: string;
  keywords: string[];
  score: number;
}

export interface ContextManagerStats {
  running: boolean;
  stmSize: number;
  stmCapacity: number;
  ltmSize: number;
  ltmCapacity: number;
  totalStored: number;
  totalRetrieved: number;
  totalEvicted: number;
  totalCompressed: number;
  avgQValue: number;
  knowledgeBlocks: number;
  indexSize: number;
  config: ContextManagerConfig;
}

// ─── Model Router Types ────────────────────────────────────────────────────

export interface ModelRouterConfig {
  /** Default confidence threshold for cascade escalation */
  defaultConfidenceThreshold: number;
  /** Learning rate for outcome-based weight updates */
  learningRate: number;
  /** Enable depth-aware routing (cheaper models at deeper recursion) */
  depthAwareRouting: boolean;
  /** Maximum cascade depth */
  maxCascadeDepth: number;
  /** Maximum concurrent routes */
  maxConcurrentRoutes: number;
}

export interface ModelTier {
  id: string;
  name: string;
  model: string;
  confidenceThreshold: number;
  costPerToken: number;
  maxTokens: number;
  latencyMs: number;
  capabilities: string[];
}

export interface RoutingDecision {
  id: string;
  timestamp: number;
  tier: ModelTier;
  confidence: number;
  depth: number;
  reasoning: string;
  modality?: string;
}

export interface RouteConstraints {
  maxCost?: number;
  maxLatencyMs?: number;
  requiredCapabilities?: string[];
  preferredModel?: string;
}

export interface LoRAAdapter {
  id: string;
  name: string;
  taskType: string;
  baseModel: string;
  rank: number;
  alpha: number;
  successRate: number;
  usageCount: number;
  createdAt: number;
}

export interface DistillationConfig {
  id: string;
  teacherModel: string;
  studentModel: string;
  temperature: number;
  alpha: number;
  method: 'logit' | 'feature' | 'attention' | 'progressive';
  status: 'configured' | 'in-progress' | 'completed' | 'failed';
  metrics: { qualityRetention: number; speedup: number; costReduction: number };
  createdAt: number;
}

export type Modality = 'text' | 'code' | 'image' | 'audio' | 'video' | 'multimodal' | 'structured-data';

export interface ModalityRoute {
  modality: Modality;
  preferredModel: string;
  fallbackModel: string;
  preprocessor?: string;
  postprocessor?: string;
  maxTokens: number;
}

export interface ModelRouterStats {
  running: boolean;
  totalRoutes: number;
  totalEscalations: number;
  tierUsage: Record<string, number>;
  avgConfidence: number;
  adapterCount: number;
  distillationCount: number;
  modalityRoutes: number;
  config: ModelRouterConfig;
}

// ─── Reasoning Engine Types ────────────────────────────────────────────────

export interface ReasoningEngineConfig {
  /** Default reasoning strategy */
  defaultStrategy: 'zero-shot' | 'few-shot' | 'self-consistency' | 'least-to-most';
  /** Maximum reasoning steps per chain */
  maxStepsPerChain: number;
  /** Default search algorithm */
  defaultSearchAlgorithm: 'bfs' | 'dfs' | 'beam' | 'mcts';
  /** Default beam width */
  defaultBeamWidth: number;
  /** MCTS exploration constant (C) */
  mctsExplorationConstant: number;
  /** Number of judges for evaluation */
  defaultJudgeCount: number;
  /** Default simulation trajectories */
  defaultTrajectories: number;
  /** Evolution plateau detection window */
  plateauWindow: number;
}

export interface SearchNode {
  id: string;
  state: string;
  score: number;
  depth: number;
  parentId: string | null;
  children: string[];
  visits: number;
  totalReward: number;
}

export interface SimulationState {
  stateId: string;
  content: string;
  reward: number;
  step: number;
  terminal: boolean;
}

export interface SimulationTrajectory {
  id: string;
  states: SimulationState[];
  totalReward: number;
  steps: number;
}

export interface JudgeVerdict {
  id: string;
  output: string;
  passed: boolean;
  overallScore: number;
  categoryScores: Record<string, number>;
  consensus: number;
  votes: Array<{ judgeId: string; score: number; reasoning: string }>;
  evidence: Array<{ content: string; addedAt: number }>;
  timestamp: number;
}

export interface EvolutionRound {
  round: number;
  proposedProblems: Array<{ difficulty: number; content: string }>;
  solutions: Array<{ problemIndex: number; quality: number; content: string }>;
  avgQuality: number;
  bestQuality: number;
  difficulty: number;
}

export interface ReasoningEngineStats {
  running: boolean;
  totalChains: number;
  totalSteps: number;
  totalSearches: number;
  totalSimulations: number;
  totalJudgements: number;
  totalEvolutions: number;
  avgConfidence: number;
  avgSearchNodes: number;
  config: ReasoningEngineConfig;
}

// ─── Default Configurations ────────────────────────────────────────────────

export const DEFAULT_ATTENTION_CONFIG: Required<AttentionConfig> = {
  numHeads: 12,
  headDim: 64,
  maxSeqLength: 8192,
  positionEncoding: 'rotary',
  flashAttention: true,
  windowSize: 0,
  dropout: 0.0,
};

export const DEFAULT_SCALE_CONFIG: Required<ScaleConfig> = {
  mode: 'hybrid',
  numCandidates: 5,
  refinementSteps: 2,
  confidenceThreshold: 0.8,
  maxTotalTokens: 100000,
};

export const DEFAULT_REASON_CONFIG: Required<ReasonConfig> = {
  strategy: 'zero-shot',
  maxSteps: 10,
  temperature: 0.7,
  enableReflection: true,
  numChains: 3,
};

export const DEFAULT_EXTEND_CONFIG: Required<ExtendConfig> = {
  method: 'drope',
  targetLength: 128000,
  scalingFactor: 4.0,
  baseFrequency: 10000,
};

export const DEFAULT_RETRIEVE_CONFIG: Required<RetrieveConfig> = {
  topK: 10,
  minScore: 0.5,
  method: 'hybrid',
  rerank: true,
  maxContextTokens: 4096,
};

export const DEFAULT_REMEMBER_CONFIG: Required<RememberConfig> = {
  stmCapacity: 100,
  ltmCapacity: 1000,
  qLearningRate: 0.1,
  qDiscountFactor: 0.95,
  evictionStrategy: 'q-value',
  promotionThreshold: 0.7,
};

export const DEFAULT_COMPRESS_CONFIG: Required<CompressConfig> = {
  targetRatio: 0.5,
  method: 'slime-mold',
  retentionThreshold: 0.3,
  maxOutputTokens: 2048,
};

export const DEFAULT_INDEX_CONFIG: Required<IndexConfig> = {
  indexType: 'hybrid',
  embeddingDim: 768,
  maxEntries: 10000,
  incrementalUpdate: true,
};

export const DEFAULT_EVOLVE_MEMORY_CONFIG: Required<EvolveMemoryConfig> = {
  strategy: 'curriculum',
  maxRounds: 10,
  qualityThreshold: 0.5,
  difficultySchedule: 'adaptive',
};

export const DEFAULT_SEARCH_CONFIG: Required<SearchConfig> = {
  algorithm: 'beam',
  maxNodes: 100,
  beamWidth: 5,
  explorationConstant: 1.414,
  maxDepth: 10,
  pruning: true,
};

export const DEFAULT_SIMULATE_CONFIG: Required<SimulateConfig> = {
  numTrajectories: 10,
  maxSteps: 20,
  discountFactor: 0.99,
  sampling: 'importance',
};

export const DEFAULT_ADAPT_CONFIG: Required<AdaptConfig> = {
  adapterType: 'lora',
  rank: 8,
  alpha: 16,
  dropout: 0.05,
  targetModules: ['query', 'value'],
};

export const DEFAULT_INSTRUCT_CONFIG: Required<InstructConfig> = {
  format: 'chat',
  systemTemplate: 'You are a helpful AI assistant.',
  maxInstructTokens: 2048,
  selfInstruct: false,
};

export const DEFAULT_DISTILL_CONFIG: Required<DistillConfig> = {
  temperature: 3.0,
  alpha: 0.5,
  method: 'logit',
  studentRatio: 0.25,
};

export const DEFAULT_ALIGN_CONFIG: Required<AlignConfig> = {
  method: 'dpo',
  pairsPerRound: 100,
  learningRate: 0.0001,
  principles: ['helpful', 'harmless', 'honest'],
};

export const DEFAULT_CASCADE_CONFIG: Required<CascadeConfig> = {
  tiers: [
    { model: 'claude-haiku', confidenceThreshold: 0.8, costPerToken: 0.00025 },
    { model: 'claude-sonnet', confidenceThreshold: 0.6, costPerToken: 0.003 },
    { model: 'claude-opus', confidenceThreshold: 0.0, costPerToken: 0.015 },
  ],
  escalationThreshold: 0.6,
  maxTiers: 3,
  depthAware: true,
};

export const DEFAULT_ROUTE_CONFIG: Required<RouteConfig> = {
  modalities: ['text', 'code', 'image', 'audio', 'video', 'multimodal', 'structured-data'],
  defaultRoute: 'text',
  multimodalFusion: true,
  strategy: 'adaptive',
};

export const DEFAULT_SELF_EVOLVE_CONFIG: Required<SelfEvolveConfig> = {
  mechanism: 'meta-rl',
  populationSize: 8,
  mutationRate: 0.15,
  formalVerification: true,
  maxGenerations: 50,
};

export const DEFAULT_JUDGE_CONFIG: Required<JudgeConfig> = {
  numJudges: 3,
  consensusMethod: 'weighted',
  rubricCategories: ['correctness', 'completeness', 'clarity', 'efficiency'],
  agreementThreshold: 0.6,
};

// ─── Kernel Layer Mapping ──────────────────────────────────────────────────

/** Maps each primitive to its kernel layer */
export const KERNEL_LAYER_MAP: Record<KernelPrimitiveId, KernelLayer> = {
  // Layer 0: Hardware Abstraction
  attention: 0,
  // Layer 1: Core Execution
  scale: 1,
  reason: 1,
  extend: 1,
  // Layer 2: Memory Subsystem
  retrieve: 2,
  remember: 2,
  compress: 2,
  index: 2,
  evolve_memory: 2,
  // Layer 3: Reasoning & Search
  search: 3,
  simulate: 3,
  // Layer 4: Model Lifecycle
  adapt: 4,
  instruct: 4,
  distill: 4,
  align: 4,
  cascade: 4,
  // Layer 5: Coordination & Routing
  route: 5,
  self_evolve: 5,
  judge: 5,
};

/** Dependency graph — each primitive depends on primitives from lower layers */
export const KERNEL_PRIMITIVE_DEPENDENCIES: Record<KernelPrimitiveId, KernelPrimitiveId[]> = {
  // Layer 0: No dependencies
  attention: [],
  // Layer 1: Depends on Layer 0
  scale: ['attention'],
  reason: ['attention'],
  extend: ['attention'],
  // Layer 2: Depends on Layer 0-1
  retrieve: ['attention', 'reason'],
  remember: ['attention'],
  compress: ['attention', 'reason'],
  index: ['attention'],
  evolve_memory: ['attention', 'reason'],
  // Layer 3: Depends on Layer 0-2
  search: ['attention', 'reason', 'retrieve'],
  simulate: ['attention', 'reason'],
  // Layer 4: Depends on various lower layers
  adapt: ['attention'],
  instruct: ['attention', 'reason'],
  distill: ['attention', 'reason'],
  align: ['attention', 'reason'],
  cascade: ['attention', 'reason'],
  // Layer 5: Depends on multiple lower layers
  route: ['attention', 'reason', 'cascade'],
  self_evolve: ['attention', 'reason', 'search'],
  judge: ['attention', 'reason'],
};

/** Complete metadata for all 19 kernel primitives */
export const KERNEL_PRIMITIVE_METADATA: KernelPrimitiveMetadata[] = [
  { id: 'attention', name: 'Attention', layer: 0, description: 'Foundational compute primitive (Transformer)', dependencies: [], researchOrigin: 'Vaswani et al. 2017, DroPE 2025' },
  { id: 'scale', name: 'Scale', layer: 1, description: 'Test-time compute scaling (RSA, STOP)', dependencies: ['attention'], researchOrigin: 'arXiv:2509.26626, Microsoft STOP' },
  { id: 'reason', name: 'Reason', layer: 1, description: 'Chain-of-thought reasoning (CoT, Reflexion)', dependencies: ['attention'], researchOrigin: 'Wei et al. 2022, Reflexion 2023' },
  { id: 'extend', name: 'Extend', layer: 1, description: 'Context window extension (RoPE, DroPE, YaRN)', dependencies: ['attention'], researchOrigin: 'DroPE 2025, YaRN 2024' },
  { id: 'retrieve', name: 'Retrieve', layer: 2, description: 'Retrieval-augmented generation (RAG, UniversalRAG)', dependencies: ['attention', 'reason'], researchOrigin: 'Lewis et al. 2020, UniversalRAG 2025' },
  { id: 'remember', name: 'Remember', layer: 2, description: 'Memory storage with Q-value management (MemRL)', dependencies: ['attention'], researchOrigin: 'MemRL 2025' },
  { id: 'compress', name: 'Compress', layer: 2, description: 'Context compression / slime mold GC (Focus)', dependencies: ['attention', 'reason'], researchOrigin: 'Focus 2025' },
  { id: 'index', name: 'Index', layer: 2, description: 'Memory indexing for efficient retrieval (SimpleMem)', dependencies: ['attention'], researchOrigin: 'SimpleMem 2025' },
  { id: 'evolve_memory', name: 'Evolve Memory', layer: 2, description: 'Memory evolution / self-curriculum (Dr. Zero)', dependencies: ['attention', 'reason'], researchOrigin: 'Dr. Zero 2025' },
  { id: 'search', name: 'Search', layer: 3, description: 'Tree/graph search over reasoning space (ToT, MCTS)', dependencies: ['attention', 'reason', 'retrieve'], researchOrigin: 'Yao et al. 2023' },
  { id: 'simulate', name: 'Simulate', layer: 3, description: 'World model simulation / Monte Carlo rollout', dependencies: ['attention', 'reason'], researchOrigin: 'AlphaGo, MuZero' },
  { id: 'adapt', name: 'Adapt', layer: 4, description: 'LoRA / adapter management (LoRA, QLoRA)', dependencies: ['attention'], researchOrigin: 'Hu et al. 2021' },
  { id: 'instruct', name: 'Instruct', layer: 4, description: 'Instruction tuning / alignment (RLHF, DPO)', dependencies: ['attention', 'reason'], researchOrigin: 'InstructGPT 2022' },
  { id: 'distill', name: 'Distill', layer: 4, description: 'Knowledge distillation (Hinton 2015)', dependencies: ['attention', 'reason'], researchOrigin: 'Hinton et al. 2015' },
  { id: 'align', name: 'Align', layer: 4, description: 'Value alignment (RLHF, Constitutional AI, DPO)', dependencies: ['attention', 'reason'], researchOrigin: 'Anthropic 2022' },
  { id: 'cascade', name: 'Cascade', layer: 4, description: 'Confidence-gated model cascading', dependencies: ['attention', 'reason'], researchOrigin: 'CortexOS CRSAE' },
  { id: 'route', name: 'Route', layer: 5, description: 'Modality-aware routing (UniversalRAG)', dependencies: ['attention', 'reason', 'cascade'], researchOrigin: 'UniversalRAG 2025' },
  { id: 'self_evolve', name: 'Self Evolve', layer: 5, description: 'Meta-RL self-evolution (Gödel Agent, STOP)', dependencies: ['attention', 'reason', 'search'], researchOrigin: 'Gödel Agent 2024, STOP 2024' },
  { id: 'judge', name: 'Judge', layer: 5, description: 'Multi-judge evaluation panel (LLM-as-Judge)', dependencies: ['attention', 'reason'], researchOrigin: 'Zheng et al. 2023' },
];
