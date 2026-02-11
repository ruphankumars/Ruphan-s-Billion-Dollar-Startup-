import type { ModelPricing } from './types.js';
import { MODEL_PRICING, getModelByTier } from './pricing.js';
import type { PromptAnalysis } from '../prompt/types.js';
import { getLogger } from '../core/logger.js';

export interface RoutingDecision {
  model: string;
  provider: string;
  tier: 'fast' | 'balanced' | 'powerful';
  reasoning: string;
  estimatedCost: number;
}

/**
 * Smart model router — routes tasks to the optimal model based on complexity,
 * role requirements, and cost constraints
 */
export class ModelRouter {
  private logger = getLogger();

  constructor(
    private defaultProvider: string,
    private preferCheap: boolean = false,
  ) {}

  /**
   * Route a task to the optimal model
   */
  route(params: {
    role: string;
    complexity: number;
    estimatedTokens: number;
    budget: number;
    analysis?: PromptAnalysis;
  }): RoutingDecision {
    const { role, complexity, estimatedTokens, budget } = params;

    // Determine tier based on role and complexity
    let tier: 'fast' | 'balanced' | 'powerful' = 'balanced';

    if (this.preferCheap) {
      tier = 'fast';
    } else {
      // Role-based tier selection
      switch (role) {
        case 'researcher':
          tier = 'fast'; // Research doesn't need top-tier models
          break;
        case 'validator':
          tier = complexity > 0.7 ? 'powerful' : 'balanced';
          break;
        case 'developer':
          tier = complexity > 0.5 ? 'powerful' : 'balanced';
          break;
        case 'architect':
          tier = 'powerful'; // Architecture always needs best reasoning
          break;
        case 'tester':
          tier = 'balanced';
          break;
        case 'orchestrator':
          tier = 'powerful';
          break;
        case 'ux-agent':
          tier = 'fast';
          break;
        default:
          tier = complexity > 0.6 ? 'powerful' : 'balanced';
      }
    }

    // Get model for the tier
    let pricing = getModelByTier(this.defaultProvider, tier);

    // If no model found for tier, fall back
    if (!pricing) {
      pricing = MODEL_PRICING.find(p => p.provider === this.defaultProvider);
    }

    // If still no model, use first available
    if (!pricing) {
      pricing = MODEL_PRICING[0];
    }

    // Check if estimated cost fits within budget
    const estimatedCost = (estimatedTokens / 1_000_000) * (pricing.inputPer1M + pricing.outputPer1M) / 2;

    if (estimatedCost > budget * 0.5) {
      // If single task would use >50% of remaining budget, downgrade
      const cheaperPricing = getModelByTier(this.defaultProvider, 'fast');
      if (cheaperPricing) {
        this.logger.debug({ original: pricing.model, downgraded: cheaperPricing.model }, 'Downgrading model due to budget');
        pricing = cheaperPricing;
      }
    }

    const reasoning = `Role "${role}" with complexity ${complexity.toFixed(2)} → tier "${tier}" → model "${pricing.model}"`;

    this.logger.debug({ routing: reasoning });

    return {
      model: pricing.model,
      provider: pricing.provider,
      tier: pricing.tier,
      reasoning,
      estimatedCost,
    };
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): string[] {
    return [...new Set(MODEL_PRICING.map(p => p.provider))];
  }
}
