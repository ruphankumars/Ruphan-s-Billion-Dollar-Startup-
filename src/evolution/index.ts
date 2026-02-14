/**
 * CortexOS Evolution Engine — CRSAE Module
 * Convergent Recursive Self-Aggregating Evolution
 *
 * The novel methodology that combines population-based reasoning,
 * adaptive compute scaling, meta-RL strategy evolution, persistent skill
 * libraries, cycle detection, and self-testing into a unified self-evolving
 * architecture.
 *
 * Components:
 * - PopulationReasoner: RSA-based population reasoning (arXiv:2509.26626)
 * - ConvergenceDetector: Embedding-based convergence detection
 * - BudgetController: Per-layer budget enforcement (Microsoft STOP)
 * - MetaController: Orchestrator-of-orchestrators (MAP + Godel Agent)
 * - StrategyEvolver: Meta-RL strategy evolution
 * - SkillLibrary: Persistent capability accumulation (Voyager)
 * - CycleDetector: Graph-based cycle detection (Backstage anti-pattern)
 */

// Core Components
export { PopulationReasoner } from './population-reasoner.js';
export { ConvergenceDetector } from './convergence-detector.js';
export { BudgetController, BudgetExceededError } from './budget-controller.js';
export { MetaController } from './meta-controller.js';
export { StrategyEvolver } from './strategy-evolver.js';
export { SkillLibrary } from './skill-library.js';
export { CycleDetector } from './cycle-detector.js';

// Types
export type {
  // Population Reasoning
  PopulationConfig,
  Candidate,
  PopulationState,
  AggregationResult,

  // Convergence Detection
  ConvergenceConfig,
  ConvergenceResult,

  // Budget Controller
  BudgetConfig,
  BudgetState,
  BudgetRemaining,
  BudgetTier,

  // Meta-Controller
  MetaControllerConfig,
  OrchestrationMode,
  ComputeScale,
  ReasoningDepth,
  OrchestrationDecision,
  DecisionOutcome,

  // Strategy Evolver
  StrategyEvolverConfig,
  StrategyVariant,
  PerformanceMetric,

  // Skill Library
  SkillLibraryConfig,
  Skill,
  SkillCategory,

  // Cycle Detector
  CycleDetectorConfig,
  CycleInfo,

  // Self-Tester
  SelfTesterConfig,
  SelfTestResult,
  SelfTestIssue,

  // Strategy Weight
  StrategyWeight,

  // Aggregate
  EvolutionConfig,
  EvolutionStats,
  EvolutionEventType,
} from './types.js';
