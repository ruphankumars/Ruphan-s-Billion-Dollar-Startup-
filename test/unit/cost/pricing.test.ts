import { describe, it, expect } from 'vitest';
import {
  MODEL_PRICING,
  getModelPricing,
  getCheapestModel,
  getPowerfulModel,
  getModelByTier,
  calculateModelCost,
} from '../../../src/cost/pricing.js';

describe('Pricing', () => {
  describe('getModelPricing', () => {
    it('returns correct pricing for known model', () => {
      const pricing = getModelPricing('claude-sonnet-4-20250514');

      expect(pricing).toBeDefined();
      expect(pricing!.model).toBe('claude-sonnet-4-20250514');
      expect(pricing!.provider).toBe('anthropic');
      expect(pricing!.inputPer1M).toBe(3.0);
      expect(pricing!.outputPer1M).toBe(15.0);
    });

    it('returns undefined for unknown model', () => {
      const pricing = getModelPricing('nonexistent-model');

      expect(pricing).toBeUndefined();
    });
  });

  describe('getCheapestModel', () => {
    it('returns claude-haiku for anthropic (lower inputPer1M)', () => {
      const cheapest = getCheapestModel('anthropic');

      expect(cheapest).toBeDefined();
      expect(cheapest!.model).toBe('claude-haiku-4-20250414');
      expect(cheapest!.inputPer1M).toBe(0.80);
    });

    it('returns gpt-4o-mini for openai', () => {
      const cheapest = getCheapestModel('openai');

      expect(cheapest).toBeDefined();
      expect(cheapest!.model).toBe('gpt-4o-mini');
      expect(cheapest!.inputPer1M).toBe(0.15);
    });
  });

  describe('getPowerfulModel', () => {
    it('returns claude-sonnet for anthropic', () => {
      const powerful = getPowerfulModel('anthropic');

      expect(powerful).toBeDefined();
      expect(powerful!.model).toBe('claude-sonnet-4-20250514');
      expect(powerful!.inputPer1M).toBe(3.0);
    });
  });

  describe('getModelByTier', () => {
    it('returns claude-haiku for anthropic fast tier', () => {
      const model = getModelByTier('anthropic', 'fast');

      expect(model).toBeDefined();
      expect(model!.model).toBe('claude-haiku-4-20250414');
      expect(model!.tier).toBe('fast');
    });

    it('returns claude-sonnet for anthropic powerful tier', () => {
      const model = getModelByTier('anthropic', 'powerful');

      expect(model).toBeDefined();
      expect(model!.model).toBe('claude-sonnet-4-20250514');
      expect(model!.tier).toBe('powerful');
    });
  });

  describe('calculateModelCost', () => {
    it('returns correct amount for known model', () => {
      const cost = calculateModelCost('claude-sonnet-4-20250514', 1000, 500);

      // (1000 / 1M) * 3.0 + (500 / 1M) * 15.0 = 0.003 + 0.0075 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it('returns 0 for unknown model', () => {
      const cost = calculateModelCost('unknown-model', 1000, 500);

      expect(cost).toBe(0);
    });

    it('calculates correctly: (input/1M)*inputPer1M + (output/1M)*outputPer1M', () => {
      // gpt-4o: inputPer1M = 2.5, outputPer1M = 10.0
      const inputTokens = 500_000;
      const outputTokens = 200_000;

      const cost = calculateModelCost('gpt-4o', inputTokens, outputTokens);

      const expected =
        (inputTokens / 1_000_000) * 2.5 +
        (outputTokens / 1_000_000) * 10.0;
      // 0.5 * 2.5 + 0.2 * 10.0 = 1.25 + 2.0 = 3.25
      expect(cost).toBeCloseTo(expected, 6);
      expect(cost).toBeCloseTo(3.25, 6);
    });

    it('Ollama models are free (cost = 0)', () => {
      const llamaCost = calculateModelCost('llama3.2', 1_000_000, 1_000_000);
      const qwenCost = calculateModelCost('qwen2.5-coder', 500_000, 500_000);

      expect(llamaCost).toBe(0);
      expect(qwenCost).toBe(0);
    });
  });
});
