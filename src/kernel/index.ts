/**
 * CortexOS Kernel — Core Foundation
 *
 * The deeply embedded core foundation that ALL AI activities require.
 * Analogous to the Unix kernel — provides the 19 kernel primitives
 * (syscalls) organized in a 6-layer dependency hierarchy.
 *
 * Components:
 * - KernelRegistry: The syscall table — registers and dispatches primitives
 * - ContextManager: The MMU — Q-value based memory management (MemRL/Focus/SimpleMem)
 * - ModelRouter: The I/O bus — confidence-gated cascade routing (UniversalRAG/LoRA/RLM)
 * - ReasoningEngine: The CPU — CoT, ToT, MCTS, simulation, judging, self-evolution
 *
 * Layer Architecture:
 *   Layer 0 (Hardware Abstraction): attention()
 *   Layer 1 (Core Execution): scale(), reason(), extend()
 *   Layer 2 (Memory Subsystem): retrieve(), remember(), compress(), index(), evolve_memory()
 *   Layer 3 (Reasoning & Search): search(), simulate()
 *   Layer 4 (Model Lifecycle): adapt(), instruct(), distill(), align(), cascade()
 *   Layer 5 (Coordination & Routing): route(), self_evolve(), judge()
 */

// Core Components
export { KernelRegistry } from './kernel-registry.js';
export { ContextManager } from './context-manager.js';
export { ModelRouter } from './model-router.js';
export { ReasoningEngine } from './reasoning-engine.js';

// Types — Kernel Infrastructure
export type {
  KernelPrimitiveId,
  KernelLayer,
  KernelConfig,
  KernelBudget,
  KernelPrimitive,
  PrimitiveHandler,
  KernelPrimitiveMetadata,
  AgentPrimitiveId,
} from './types.js';

// Types — Registry
export type {
  KernelRegistryStats,
  KernelCallRecord,
  KernelDependencyValidation,
  KernelLayerStats,
} from './types.js';

// Types — Events
export type {
  KernelEventType,
  KernelPrimitiveRegisteredEvent,
  KernelPrimitiveCalledEvent,
  KernelPrimitiveCompletedEvent,
  KernelPrimitiveErrorEvent,
} from './types.js';

// Types — Layer 0: Hardware Abstraction
export type {
  AttentionConfig,
  AttentionInput,
  AttentionOutput,
} from './types.js';

// Types — Layer 1: Core Execution
export type {
  ScaleConfig,
  ScaleInput,
  ScaleOutput,
  ReasonConfig,
  ReasonInput,
  ReasonOutput,
  ExtendConfig,
  ExtendInput,
  ExtendOutput,
} from './types.js';

// Types — Layer 2: Memory Subsystem
export type {
  RetrieveConfig,
  RetrieveInput,
  RetrieveOutput,
  RememberConfig,
  RememberInput,
  RememberOutput,
  CompressConfig,
  CompressInput,
  CompressOutput,
  IndexConfig,
  IndexInput,
  IndexOutput,
  EvolveMemoryConfig,
  EvolveMemoryInput,
  EvolveMemoryOutput,
} from './types.js';

// Types — Layer 3: Reasoning & Search
export type {
  SearchConfig,
  SearchInput,
  SearchOutput,
  SimulateConfig,
  SimulateInput,
  SimulateOutput,
} from './types.js';

// Types — Layer 4: Model Lifecycle
export type {
  AdaptConfig,
  AdaptInput,
  AdaptOutput,
  InstructConfig,
  InstructInput,
  InstructOutput,
  DistillConfig,
  DistillInput,
  DistillOutput,
  AlignConfig,
  AlignInput,
  AlignOutput,
  CascadeConfig,
  CascadeInput,
  CascadeOutput,
} from './types.js';

// Types — Layer 5: Coordination & Routing
export type {
  RouteConfig,
  RouteInput,
  RouteOutput,
  SelfEvolveConfig,
  SelfEvolveInput,
  SelfEvolveOutput,
  JudgeConfig,
  JudgeInput,
  JudgeOutput,
} from './types.js';

// Types — Context Manager
export type {
  ContextManagerConfig,
  MemoryEntry,
  KnowledgeBlock,
  SemanticIndex,
  ContextManagerStats,
} from './types.js';

// Types — Model Router
export type {
  ModelRouterConfig,
  ModelTier,
  RoutingDecision,
  RouteConstraints,
  LoRAAdapter,
  DistillationConfig,
  Modality,
  ModalityRoute,
  ModelRouterStats,
} from './types.js';

// Types — Reasoning Engine
export type {
  ReasoningEngineConfig,
  ReasoningStep,
  SearchNode,
  SimulationState,
  SimulationTrajectory,
  JudgeVerdict,
  EvolutionRound,
  ReasoningEngineStats,
} from './types.js';

// Constants
export {
  KERNEL_LAYER_MAP,
  KERNEL_PRIMITIVE_DEPENDENCIES,
  KERNEL_PRIMITIVE_METADATA,
} from './types.js';

// Default Configs
export {
  DEFAULT_ATTENTION_CONFIG,
  DEFAULT_SCALE_CONFIG,
  DEFAULT_REASON_CONFIG,
  DEFAULT_EXTEND_CONFIG,
  DEFAULT_RETRIEVE_CONFIG,
  DEFAULT_REMEMBER_CONFIG,
  DEFAULT_COMPRESS_CONFIG,
  DEFAULT_INDEX_CONFIG,
  DEFAULT_EVOLVE_MEMORY_CONFIG,
  DEFAULT_SEARCH_CONFIG,
  DEFAULT_SIMULATE_CONFIG,
  DEFAULT_ADAPT_CONFIG,
  DEFAULT_INSTRUCT_CONFIG,
  DEFAULT_DISTILL_CONFIG,
  DEFAULT_ALIGN_CONFIG,
  DEFAULT_CASCADE_CONFIG,
  DEFAULT_ROUTE_CONFIG,
  DEFAULT_SELF_EVOLVE_CONFIG,
  DEFAULT_JUDGE_CONFIG,
} from './types.js';
