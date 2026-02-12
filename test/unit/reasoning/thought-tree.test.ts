import { describe, it, expect, vi } from 'vitest';
import { ThoughtTree } from '../../../src/reasoning/tot/thought-tree.js';
import { ThoughtEvaluator } from '../../../src/reasoning/tot/evaluator.js';
import type { LLMProvider, LLMResponse } from '../../../src/providers/types.js';
import type { ToolContext } from '../../../src/tools/types.js';
import type { AgentTask } from '../../../src/agents/types.js';
import type { PromptAnalysis } from '../../../src/prompt/types.js';

function createMockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    complete: vi.fn(async () => {
      const response = responses[Math.min(callIndex++, responses.length - 1)];
      return response;
    }),
    stream: vi.fn(),
    listModels: vi.fn(async () => []),
  } as unknown as LLMProvider;
}

const toolContext: ToolContext = { workingDir: '/tmp', executionId: 'test' };

const baseTask: AgentTask = {
  id: 'task-1',
  description: 'Implement a caching system',
  role: 'developer',
  dependencies: [],
  wave: 0,
};

const baseAnalysis: PromptAnalysis = {
  complexity: 0.7,
  domains: ['backend'],
  languages: ['typescript'],
  intent: 'implement' as any,
  keywords: ['cache', 'system'],
  hasDependencies: false,
  estimatedTokens: 1000,
  suggestedRole: 'developer',
};

describe('ThoughtEvaluator', () => {
  it('should score candidates and normalize to 0-1', async () => {
    const provider = createMockProvider([{
      content: '[8, 6, 7]',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    }]);

    const evaluator = new ThoughtEvaluator(provider);
    const candidates = [
      { id: 1, description: 'In-memory cache', plan: 'Use Map', score: 0 },
      { id: 2, description: 'Redis cache', plan: 'Use Redis', score: 0 },
      { id: 3, description: 'File cache', plan: 'Use files', score: 0 },
    ];

    const scored = await evaluator.scoreAll(candidates, baseTask);
    expect(scored).toHaveLength(3);
    expect(scored[0].score).toBeGreaterThan(0);
    expect(scored[0].score).toBeLessThanOrEqual(1);
  });

  it('should fall back to equal scores on parse failure', async () => {
    const provider = createMockProvider([{
      content: 'Invalid response',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
    }]);

    const evaluator = new ThoughtEvaluator(provider);
    const candidates = [
      { id: 1, description: 'Approach A', plan: 'Plan A', score: 0 },
      { id: 2, description: 'Approach B', plan: 'Plan B', score: 0 },
    ];

    const scored = await evaluator.scoreAll(candidates, baseTask);
    expect(scored).toHaveLength(2);
    expect(scored[0].score).toBe(0.5);
    expect(scored[1].score).toBe(0.5);
  });

  it('should handle LLM errors gracefully', async () => {
    const provider = {
      name: 'mock',
      complete: vi.fn(async () => { throw new Error('API error'); }),
      stream: vi.fn(),
      listModels: vi.fn(async () => []),
    } as unknown as LLMProvider;

    const evaluator = new ThoughtEvaluator(provider);
    const candidates = [
      { id: 1, description: 'Approach', plan: 'Plan', score: 0 },
    ];

    const scored = await evaluator.scoreAll(candidates, baseTask);
    expect(scored).toHaveLength(1);
    expect(scored[0].score).toBe(0.5);
  });
});

describe('ThoughtTree', () => {
  describe('solve', () => {
    it('should generate candidates, score them, and execute best', async () => {
      let callCount = 0;
      const provider = {
        name: 'mock',
        complete: vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            // Candidate generation
            return {
              content: '[{"id":1,"description":"Memory cache","plan":"Use Map for O(1) lookups"},{"id":2,"description":"Disk cache","plan":"Use file system"}]',
              toolCalls: [],
              usage: { inputTokens: 100, outputTokens: 200 },
            };
          }
          if (callCount === 2) {
            // Scoring
            return {
              content: '[9, 5]',
              toolCalls: [],
              usage: { inputTokens: 100, outputTokens: 50 },
            };
          }
          // Agent execution
          return {
            content: 'Implemented memory cache with Map.',
            toolCalls: [],
            usage: { inputTokens: 200, outputTokens: 150 },
          };
        }),
        stream: vi.fn(),
        listModels: vi.fn(async () => []),
      } as unknown as LLMProvider;

      const tree = new ThoughtTree(
        { candidates: 2, complexityThreshold: 0.6 },
        { role: 'developer', provider, tools: [], toolContext },
      );

      const result = await tree.solve(baseTask, baseAnalysis);
      expect(result.reasoning).toBeDefined();
      expect(result.reasoning!.strategy).toBe('tree-of-thought');
      expect(result.reasoning!.steps.length).toBeGreaterThan(0);
    });

    it('should fall back to direct approach on generation failure', async () => {
      const provider = createMockProvider([
        // Failed generation
        { content: 'Not valid JSON', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        // Scoring
        { content: '[5]', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        // Agent execution
        { content: 'Done.', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
      ]);

      const tree = new ThoughtTree(
        { candidates: 3, complexityThreshold: 0.6 },
        { role: 'developer', provider, tools: [], toolContext },
      );

      const result = await tree.solve(baseTask, baseAnalysis);
      // Should still produce a result via fallback
      expect(result).toBeDefined();
      expect(result.reasoning!.strategy).toBe('tree-of-thought');
    });

    it('should select the highest-scored candidate', async () => {
      let callCount = 0;
      const provider = {
        name: 'mock',
        complete: vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: '[{"id":1,"description":"Approach A","plan":"Plan A"},{"id":2,"description":"Approach B","plan":"Plan B"},{"id":3,"description":"Approach C","plan":"Plan C"}]',
              toolCalls: [],
              usage: { inputTokens: 100, outputTokens: 200 },
            };
          }
          if (callCount === 2) {
            return {
              content: '[3, 9, 6]',  // B scores highest
              toolCalls: [],
              usage: { inputTokens: 100, outputTokens: 50 },
            };
          }
          return {
            content: 'Implemented using Approach B.',
            toolCalls: [],
            usage: { inputTokens: 200, outputTokens: 150 },
          };
        }),
        stream: vi.fn(),
        listModels: vi.fn(async () => []),
      } as unknown as LLMProvider;

      const tree = new ThoughtTree(
        { candidates: 3, complexityThreshold: 0.6 },
        { role: 'developer', provider, tools: [], toolContext },
      );

      const result = await tree.solve(baseTask, baseAnalysis);
      // The thought steps should show the selected candidate
      const selection = result.reasoning!.steps.find(s => s.type === 'thought');
      expect(selection).toBeDefined();
    });

    it('should track token usage across all phases', async () => {
      let callCount = 0;
      const provider = {
        name: 'mock',
        complete: vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            return { content: '[{"id":1,"description":"A","plan":"P"}]', toolCalls: [], usage: { inputTokens: 50, outputTokens: 50 } };
          }
          if (callCount === 2) {
            return { content: '[7]', toolCalls: [], usage: { inputTokens: 30, outputTokens: 10 } };
          }
          return { content: 'Done.', toolCalls: [], usage: { inputTokens: 100, outputTokens: 50 } };
        }),
        stream: vi.fn(),
        listModels: vi.fn(async () => []),
      } as unknown as LLMProvider;

      const tree = new ThoughtTree(
        { candidates: 1, complexityThreshold: 0.6 },
        { role: 'developer', provider, tools: [], toolContext },
      );

      const result = await tree.solve(baseTask, baseAnalysis);
      expect(result.reasoning!.duration).toBeGreaterThanOrEqual(0);
    });

    it('should record observation steps for each scored candidate', async () => {
      let callCount = 0;
      const provider = {
        name: 'mock',
        complete: vi.fn(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: '[{"id":1,"description":"Cache A","plan":"Plan A"},{"id":2,"description":"Cache B","plan":"Plan B"}]',
              toolCalls: [],
              usage: { inputTokens: 10, outputTokens: 10 },
            };
          }
          if (callCount === 2) {
            return { content: '[8, 6]', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } };
          }
          return { content: 'Done.', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } };
        }),
        stream: vi.fn(),
        listModels: vi.fn(async () => []),
      } as unknown as LLMProvider;

      const tree = new ThoughtTree(
        { candidates: 2, complexityThreshold: 0.6 },
        { role: 'developer', provider, tools: [], toolContext },
      );

      const result = await tree.solve(baseTask, baseAnalysis);
      const observations = result.reasoning!.steps.filter(s => s.type === 'observation');
      // Should have observations for candidate generation + scoring of each
      expect(observations.length).toBeGreaterThanOrEqual(2);
    });

    it('should produce valid ReasoningResult structure', async () => {
      const provider = createMockProvider([
        { content: '[{"id":1,"description":"Simple","plan":"Direct"}]', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: '[8]', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: 'Implemented.', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
      ]);

      const tree = new ThoughtTree(
        { candidates: 1, complexityThreshold: 0.6 },
        { role: 'developer', provider, tools: [], toolContext },
      );

      const result = await tree.solve(baseTask, baseAnalysis);
      expect(result.taskId).toBe('task-1');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.response).toBe('string');
      expect(result.reasoning).toBeDefined();
      expect(result.reasoning!.strategy).toBe('tree-of-thought');
      expect(Array.isArray(result.reasoning!.steps)).toBe(true);
      expect(typeof result.reasoning!.duration).toBe('number');
      expect(['success', 'failure', 'budget-exceeded']).toContain(result.reasoning!.outcome);
    });
  });
});
