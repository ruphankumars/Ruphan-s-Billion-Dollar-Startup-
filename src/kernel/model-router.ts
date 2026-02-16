/**
 * ModelRouter — The I/O Bus Controller of CortexOS
 *
 * Handles confidence-gated model cascading, modality-aware routing,
 * LoRA adapter management, and knowledge distillation configuration.
 *
 * Every model interaction in CortexOS is routed through this module.
 *
 * Key Patterns:
 * - Cascade: Confidence-gated tier routing (haiku → sonnet → opus)
 * - Route: Modality-aware routing (UniversalRAG)
 * - Adapt: LoRA adapter management (LoRA/QLoRA)
 * - Distill: Model distillation configuration (Hinton 2015)
 * - Depth-aware: Cheaper models at deeper recursion (RLM pattern)
 *
 * Research Foundations:
 * - UniversalRAG (2025): Multimodal routing
 * - LoRA (Hu 2021): Parameter-efficient fine-tuning
 * - RLM (2024): Recursive LLM depth-aware model selection
 * - Knowledge Distillation (Hinton 2015)
 *
 * Zero external dependencies. Node.js built-ins only.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { BoundedMap } from '../utils/bounded-map.js';
import type {
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

const DEFAULT_CONFIG: Required<ModelRouterConfig> = {
  defaultConfidenceThreshold: 0.6,
  learningRate: 0.1,
  depthAwareRouting: true,
  maxCascadeDepth: 5,
  maxConcurrentRoutes: 20,
};

export class ModelRouter extends EventEmitter {
  private config: Required<ModelRouterConfig>;
  private running = false;

  // Model tiers (ordered by capability/cost ascending)
  private tiers: Map<string, ModelTier> = new Map();

  // Routing decisions
  private decisions = new BoundedMap<string, RoutingDecision>(1000);

  // Modality routes
  private modalityRoutes: Map<Modality, ModalityRoute> = new Map();

  // LoRA adapters
  private adapters: Map<string, LoRAAdapter> = new Map();

  // Distillation configs
  private distillations: Map<string, DistillationConfig> = new Map();

  // Metrics
  private totalRoutes = 0;
  private totalEscalations = 0;
  private tierUsage: Record<string, number> = {};
  private confidenceSum = 0;
  private confidenceCount = 0;
  private activeRoutes = 0;

  constructor(config?: Partial<ModelRouterConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeDefaults();
  }

  start(): void {
    this.running = true;
    this.emit('kernel:router:started', { timestamp: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.emit('kernel:router:stopped', { timestamp: Date.now() });
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Cascade: Route a request through model tiers based on confidence.
   * Starts at cheapest tier, escalates if confidence is below threshold.
   * Supports depth-aware routing (RLM pattern).
   */
  cascade(request: {
    task: string;
    confidence?: number;
    depth?: number;
    constraints?: RouteConstraints;
    modality?: Modality;
  }): RoutingDecision {
    const depth = request.depth ?? 0;
    const confidence = request.confidence ?? 0.5;

    // Enforce maxCascadeDepth
    if (depth >= this.config.maxCascadeDepth) {
      throw new Error(
        `Cascade depth limit reached (${this.config.maxCascadeDepth}). ` +
        `Cannot cascade further for task at depth ${depth}`
      );
    }

    // Enforce maxConcurrentRoutes
    if (this.activeRoutes >= this.config.maxConcurrentRoutes) {
      throw new Error(
        `Concurrent route limit reached (${this.config.maxConcurrentRoutes}). ` +
        `Cannot route additional tasks`
      );
    }

    this.activeRoutes++;

    // Get ordered tiers
    const orderedTiers = [...this.tiers.values()]
      .sort((a, b) => a.costPerToken - b.costPerToken);

    if (orderedTiers.length === 0) {
      throw new Error('No model tiers registered');
    }

    // Depth-aware adjustment: deeper calls prefer cheaper models
    let adjustedConfidence = confidence;
    if (this.config.depthAwareRouting && depth > 0) {
      // Increase effective confidence at depth to prefer cheaper models
      adjustedConfidence = Math.min(1.0, confidence + depth * 0.15);
    }

    // Filter by constraints
    let candidates = orderedTiers;
    if (request.constraints?.requiredCapabilities) {
      candidates = candidates.filter(t =>
        request.constraints!.requiredCapabilities!.every(cap =>
          t.capabilities.includes(cap)
        )
      );
    }

    if (request.constraints?.maxCost) {
      candidates = candidates.filter(t =>
        t.costPerToken <= request.constraints!.maxCost!
      );
    }

    if (request.constraints?.preferredModel) {
      const preferred = candidates.find(t => t.model === request.constraints!.preferredModel);
      if (preferred) {
        candidates = [preferred, ...candidates.filter(t => t !== preferred)];
      }
    }

    if (candidates.length === 0) {
      candidates = orderedTiers; // Fall back to all tiers
    }

    // Select tier based on adjusted confidence
    let selectedTier = candidates[candidates.length - 1]; // Default to most capable
    for (const tier of candidates) {
      if (adjustedConfidence >= tier.confidenceThreshold) {
        selectedTier = tier;
        break;
      }
    }

    const decision: RoutingDecision = {
      id: `route_${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      tier: selectedTier,
      confidence: adjustedConfidence,
      depth,
      reasoning: `Task confidence ${(confidence * 100).toFixed(0)}% (adjusted: ${(adjustedConfidence * 100).toFixed(0)}%) → ${selectedTier.name} (threshold: ${(selectedTier.confidenceThreshold * 100).toFixed(0)}%, depth: ${depth})`,
      modality: request.modality,
    };

    this.decisions.set(decision.id, decision);
    this.totalRoutes++;
    this.tierUsage[selectedTier.id] = (this.tierUsage[selectedTier.id] ?? 0) + 1;
    this.confidenceSum += adjustedConfidence;
    this.confidenceCount++;

    this.emit('kernel:router:cascaded', {
      decisionId: decision.id,
      tier: selectedTier.name,
      model: selectedTier.model,
      confidence: adjustedConfidence,
      depth,
      timestamp: Date.now(),
    });

    return decision;
  }

  /**
   * Escalate a routing decision to a higher-tier model.
   */
  escalate(decisionId: string): RoutingDecision | null {
    const original = this.decisions.get(decisionId);
    if (!original) return null;

    const orderedTiers = [...this.tiers.values()]
      .sort((a, b) => a.costPerToken - b.costPerToken);

    const currentIndex = orderedTiers.findIndex(t => t.id === original.tier.id);
    if (currentIndex >= orderedTiers.length - 1) return null; // Already at highest tier

    const nextTier = orderedTiers[currentIndex + 1];

    const escalated: RoutingDecision = {
      id: `route_${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      tier: nextTier,
      confidence: original.confidence * 0.8, // Lower confidence for escalation
      depth: original.depth,
      reasoning: `ESCALATED from ${original.tier.name} → ${nextTier.name}. ${original.reasoning}`,
      modality: original.modality,
    };

    this.decisions.set(escalated.id, escalated);
    this.totalEscalations++;
    this.tierUsage[nextTier.id] = (this.tierUsage[nextTier.id] ?? 0) + 1;

    this.emit('kernel:router:escalated', {
      originalId: decisionId,
      escalatedId: escalated.id,
      fromTier: original.tier.name,
      toTier: nextTier.name,
      timestamp: Date.now(),
    });

    return escalated;
  }

  /**
   * Route based on modality (UniversalRAG pattern).
   */
  route(modality: Modality, constraints?: RouteConstraints): RoutingDecision {
    const modalityRoute = this.modalityRoutes.get(modality);

    if (modalityRoute) {
      // Find the tier matching the preferred model
      const preferredTier = [...this.tiers.values()].find(
        t => t.model === modalityRoute.preferredModel
      );

      if (preferredTier) {
        const decision: RoutingDecision = {
          id: `route_${randomUUID().slice(0, 8)}`,
          timestamp: Date.now(),
          tier: preferredTier,
          confidence: 0.7,
          depth: 0,
          reasoning: `Modality route: ${modality} → ${preferredTier.name} (${modalityRoute.preferredModel})`,
          modality,
        };

        this.decisions.set(decision.id, decision);
        this.totalRoutes++;
        this.tierUsage[preferredTier.id] = (this.tierUsage[preferredTier.id] ?? 0) + 1;

        return decision;
      }
    }

    // Fall back to cascade routing
    return this.cascade({
      task: `Handle ${modality} input`,
      confidence: 0.5,
      modality,
      constraints,
    });
  }

  /**
   * Register a modality route.
   */
  registerModalityRoute(route: ModalityRoute): void {
    this.modalityRoutes.set(route.modality, route);

    this.emit('kernel:router:modality:registered', {
      modality: route.modality,
      preferredModel: route.preferredModel,
      timestamp: Date.now(),
    });
  }

  /**
   * Register/create a LoRA adapter.
   */
  adapt(adapter: Omit<LoRAAdapter, 'id' | 'createdAt'>): LoRAAdapter {
    const full: LoRAAdapter = {
      ...adapter,
      id: `adapter_${randomUUID().slice(0, 8)}`,
      createdAt: Date.now(),
    };

    this.adapters.set(full.id, full);

    this.emit('kernel:router:adapter:created', {
      adapterId: full.id,
      name: full.name,
      taskType: full.taskType,
      baseModel: full.baseModel,
      timestamp: Date.now(),
    });

    return full;
  }

  /**
   * Select the best adapter for a task type.
   */
  selectAdapter(taskType: string, baseModel?: string): LoRAAdapter | null {
    const candidates = [...this.adapters.values()]
      .filter(a => a.taskType === taskType)
      .filter(a => !baseModel || a.baseModel === baseModel);

    if (candidates.length === 0) return null;

    // Select by highest success rate, then most used
    candidates.sort((a, b) => {
      const rateDiff = b.successRate - a.successRate;
      if (Math.abs(rateDiff) > 0.01) return rateDiff;
      return b.usageCount - a.usageCount;
    });

    return candidates[0];
  }

  /**
   * Configure a knowledge distillation.
   */
  distill(config: Omit<DistillationConfig, 'id' | 'createdAt' | 'status' | 'metrics'>): DistillationConfig {
    const full: DistillationConfig = {
      ...config,
      id: `distill_${randomUUID().slice(0, 8)}`,
      status: 'configured',
      metrics: { qualityRetention: 0, speedup: 0, costReduction: 0 },
      createdAt: Date.now(),
    };

    this.distillations.set(full.id, full);

    this.emit('kernel:router:distillation:created', {
      distillId: full.id,
      teacherModel: full.teacherModel,
      studentModel: full.studentModel,
      timestamp: Date.now(),
    });

    return full;
  }

  /**
   * Update a distillation's status and metrics.
   */
  updateDistillation(
    distillId: string,
    update: Partial<Pick<DistillationConfig, 'status' | 'metrics'>>
  ): boolean {
    const config = this.distillations.get(distillId);
    if (!config) return false;

    if (update.status) config.status = update.status;
    if (update.metrics) {
      config.metrics = { ...config.metrics, ...update.metrics };
    }

    return true;
  }

  /**
   * Register a model tier.
   */
  registerTier(tier: ModelTier): void {
    this.tiers.set(tier.id, tier);

    this.emit('kernel:router:tier:registered', {
      tierId: tier.id,
      name: tier.name,
      model: tier.model,
      timestamp: Date.now(),
    });
  }

  /**
   * Record the outcome of a routing decision.
   * Updates internal weights via EMA.
   */
  recordOutcome(
    decisionId: string,
    outcome: {
      success: boolean;
      quality: number;
      latencyMs: number;
      tokensUsed: number;
    }
  ): void {
    const decision = this.decisions.get(decisionId);
    if (!decision) return;

    // Decrement active routes counter
    if (this.activeRoutes > 0) {
      this.activeRoutes--;
    }

    // Update tier confidence threshold based on outcome
    const tier = this.tiers.get(decision.tier.id);
    if (tier) {
      const lr = this.config.learningRate;

      // Target-based learning: move threshold toward a target based on success/failure
      if (outcome.success && outcome.quality > 0.7) {
        // Tier performed well — lower threshold to route more tasks here
        const target = Math.max(0, tier.confidenceThreshold - 0.05);
        tier.confidenceThreshold = Math.max(0,
          tier.confidenceThreshold + lr * (target - tier.confidenceThreshold)
        );
      }
      if (!outcome.success || outcome.quality < 0.3) {
        // Tier performed poorly — raise threshold to route fewer tasks here
        const target = Math.min(1, tier.confidenceThreshold + 0.05);
        tier.confidenceThreshold = Math.min(1,
          tier.confidenceThreshold + lr * (target - tier.confidenceThreshold)
        );
      }
    }

    // Update LoRA adapter stats if one was used for this task
    for (const adapter of this.adapters.values()) {
      if (adapter.baseModel === decision.tier.model) {
        adapter.usageCount++;
        // EMA update for success rate
        const successSignal = outcome.success ? 1 : 0;
        adapter.successRate = adapter.successRate * 0.95 + successSignal * 0.05;
        break;
      }
    }

    this.emit('kernel:router:outcome', {
      decisionId,
      tier: decision.tier.name,
      success: outcome.success,
      quality: outcome.quality,
      timestamp: Date.now(),
    });
  }

  /**
   * Get a specific routing decision.
   */
  getDecision(decisionId: string): RoutingDecision | undefined {
    return this.decisions.get(decisionId);
  }

  /**
   * Get all registered model tiers.
   */
  getTiers(): ModelTier[] {
    return [...this.tiers.values()].sort((a, b) => a.costPerToken - b.costPerToken);
  }

  /**
   * Get all LoRA adapters.
   */
  getAdapters(): LoRAAdapter[] {
    return [...this.adapters.values()];
  }

  /**
   * Get all distillation configs.
   */
  getDistillations(): DistillationConfig[] {
    return [...this.distillations.values()];
  }

  /**
   * Get comprehensive statistics.
   */
  getStats(): ModelRouterStats {
    return {
      running: this.running,
      totalRoutes: this.totalRoutes,
      totalEscalations: this.totalEscalations,
      tierUsage: { ...this.tierUsage },
      avgConfidence: this.confidenceCount > 0 ? this.confidenceSum / this.confidenceCount : 0,
      adapterCount: this.adapters.size,
      distillationCount: this.distillations.size,
      modalityRoutes: this.modalityRoutes.size,
      config: { ...this.config },
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private initializeDefaults(): void {
    // Default model tiers (Claude family)
    const defaultTiers: ModelTier[] = [
      {
        id: 'tier_fast',
        name: 'Fast',
        model: 'claude-haiku',
        confidenceThreshold: 0.8,
        costPerToken: 0.00025,
        maxTokens: 4096,
        latencyMs: 500,
        capabilities: ['text', 'code', 'classification'],
      },
      {
        id: 'tier_balanced',
        name: 'Balanced',
        model: 'claude-sonnet',
        confidenceThreshold: 0.5,
        costPerToken: 0.003,
        maxTokens: 8192,
        latencyMs: 2000,
        capabilities: ['text', 'code', 'reasoning', 'analysis', 'multimodal'],
      },
      {
        id: 'tier_best',
        name: 'Best',
        model: 'claude-opus',
        confidenceThreshold: 0.0,
        costPerToken: 0.015,
        maxTokens: 16384,
        latencyMs: 5000,
        capabilities: ['text', 'code', 'reasoning', 'analysis', 'multimodal', 'complex-reasoning', 'research'],
      },
    ];

    for (const tier of defaultTiers) {
      this.tiers.set(tier.id, tier);
    }

    // Default modality routes
    const defaultRoutes: ModalityRoute[] = [
      { modality: 'text', preferredModel: 'claude-sonnet', fallbackModel: 'claude-haiku', maxTokens: 4096 },
      { modality: 'code', preferredModel: 'claude-sonnet', fallbackModel: 'claude-haiku', maxTokens: 8192 },
      { modality: 'image', preferredModel: 'claude-sonnet', fallbackModel: 'claude-opus', maxTokens: 4096 },
      { modality: 'audio', preferredModel: 'claude-opus', fallbackModel: 'claude-sonnet', maxTokens: 4096 },
      { modality: 'video', preferredModel: 'claude-opus', fallbackModel: 'claude-sonnet', maxTokens: 8192 },
      { modality: 'multimodal', preferredModel: 'claude-opus', fallbackModel: 'claude-sonnet', maxTokens: 8192 },
      { modality: 'structured-data', preferredModel: 'claude-sonnet', fallbackModel: 'claude-haiku', maxTokens: 4096 },
    ];

    for (const route of defaultRoutes) {
      this.modalityRoutes.set(route.modality, route);
    }
  }
}
