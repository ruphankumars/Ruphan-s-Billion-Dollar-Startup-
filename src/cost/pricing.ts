import type { ModelPricing } from './types.js';

/**
 * Model pricing database — updated February 2026
 */
export const MODEL_PRICING: ModelPricing[] = [
  // Anthropic
  {
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    contextWindow: 200000,
    tier: 'powerful',
  },
  {
    model: 'claude-haiku-4-20250414',
    provider: 'anthropic',
    inputPer1M: 0.80,
    outputPer1M: 4.0,
    contextWindow: 200000,
    tier: 'fast',
  },

  // OpenAI
  {
    model: 'gpt-4o',
    provider: 'openai',
    inputPer1M: 2.5,
    outputPer1M: 10.0,
    contextWindow: 128000,
    tier: 'powerful',
  },
  {
    model: 'gpt-4o-mini',
    provider: 'openai',
    inputPer1M: 0.15,
    outputPer1M: 0.60,
    contextWindow: 128000,
    tier: 'fast',
  },

  // Google
  {
    model: 'gemini-2.0-flash',
    provider: 'google',
    inputPer1M: 0.10,
    outputPer1M: 0.40,
    contextWindow: 1000000,
    tier: 'fast',
  },
  {
    model: 'gemini-2.0-pro',
    provider: 'google',
    inputPer1M: 1.25,
    outputPer1M: 5.0,
    contextWindow: 1000000,
    tier: 'powerful',
  },

  // Ollama (local — free)
  {
    model: 'llama3.2',
    provider: 'ollama',
    inputPer1M: 0,
    outputPer1M: 0,
    contextWindow: 128000,
    tier: 'balanced',
  },
  {
    model: 'qwen2.5-coder',
    provider: 'ollama',
    inputPer1M: 0,
    outputPer1M: 0,
    contextWindow: 32000,
    tier: 'balanced',
  },

  // Groq
  {
    model: 'llama-3.3-70b-versatile',
    provider: 'groq',
    inputPer1M: 0.59,
    outputPer1M: 0.79,
    contextWindow: 128000,
    tier: 'powerful',
  },
  {
    model: 'mixtral-8x7b-32768',
    provider: 'groq',
    inputPer1M: 0.24,
    outputPer1M: 0.24,
    contextWindow: 32768,
    tier: 'fast',
  },

  // Mistral
  {
    model: 'mistral-large-latest',
    provider: 'mistral',
    inputPer1M: 2.0,
    outputPer1M: 6.0,
    contextWindow: 128000,
    tier: 'powerful',
  },
  {
    model: 'mistral-small-latest',
    provider: 'mistral',
    inputPer1M: 0.1,
    outputPer1M: 0.3,
    contextWindow: 128000,
    tier: 'fast',
  },

  // Together
  {
    model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    provider: 'together',
    inputPer1M: 0.88,
    outputPer1M: 0.88,
    contextWindow: 128000,
    tier: 'powerful',
  },
  {
    model: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    provider: 'together',
    inputPer1M: 0.60,
    outputPer1M: 0.60,
    contextWindow: 32768,
    tier: 'fast',
  },

  // DeepSeek
  {
    model: 'deepseek-chat',
    provider: 'deepseek',
    inputPer1M: 0.14,
    outputPer1M: 0.28,
    contextWindow: 128000,
    tier: 'powerful',
  },
  {
    model: 'deepseek-coder',
    provider: 'deepseek',
    inputPer1M: 0.14,
    outputPer1M: 0.28,
    contextWindow: 128000,
    tier: 'fast',
  },

  // Fireworks
  {
    model: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    provider: 'fireworks',
    inputPer1M: 0.90,
    outputPer1M: 0.90,
    contextWindow: 128000,
    tier: 'powerful',
  },
  {
    model: 'accounts/fireworks/models/mixtral-8x7b-instruct',
    provider: 'fireworks',
    inputPer1M: 0.50,
    outputPer1M: 0.50,
    contextWindow: 32768,
    tier: 'fast',
  },

  // Cohere
  {
    model: 'command-r-plus',
    provider: 'cohere',
    inputPer1M: 2.50,
    outputPer1M: 10.0,
    contextWindow: 128000,
    tier: 'powerful',
  },
  {
    model: 'command-r',
    provider: 'cohere',
    inputPer1M: 0.15,
    outputPer1M: 0.60,
    contextWindow: 128000,
    tier: 'fast',
  },
];

/**
 * Get pricing for a specific model
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  return MODEL_PRICING.find(p => p.model === model);
}

/**
 * Get the cheapest model for a given provider
 */
export function getCheapestModel(provider: string): ModelPricing | undefined {
  return MODEL_PRICING
    .filter(p => p.provider === provider)
    .sort((a, b) => a.inputPer1M - b.inputPer1M)[0];
}

/**
 * Get the most powerful model for a given provider
 */
export function getPowerfulModel(provider: string): ModelPricing | undefined {
  return MODEL_PRICING
    .filter(p => p.provider === provider)
    .sort((a, b) => b.inputPer1M - a.inputPer1M)[0];
}

/**
 * Get model by tier preference
 */
export function getModelByTier(
  provider: string,
  tier: 'fast' | 'balanced' | 'powerful',
): ModelPricing | undefined {
  return MODEL_PRICING.find(p => p.provider === provider && p.tier === tier)
    || MODEL_PRICING.find(p => p.provider === provider);
}

/**
 * Calculate cost for a given model and token usage
 */
export function calculateModelCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.inputPer1M
    + (outputTokens / 1_000_000) * pricing.outputPer1M;
}
