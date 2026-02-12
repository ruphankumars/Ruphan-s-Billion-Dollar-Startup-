import { describe, it, expect, vi } from 'vitest';
import { DebateArena } from '../../../src/reasoning/debate/debate-arena.js';
import { JudgeAgent } from '../../../src/reasoning/debate/judge.js';
import type { LLMProvider, LLMResponse } from '../../../src/providers/types.js';
import type { ToolContext } from '../../../src/tools/types.js';
import type { AgentTask } from '../../../src/agents/types.js';
import type { PromptAnalysis } from '../../../src/prompt/types.js';
import type { DebaterArgument } from '../../../src/reasoning/types.js';

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
  description: 'Design a microservices architecture',
  role: 'architect',
  dependencies: [],
  wave: 0,
};

const baseAnalysis: PromptAnalysis = {
  complexity: 0.85,
  domains: ['backend', 'architecture'],
  languages: ['typescript'],
  intent: 'implement' as any,
  keywords: ['microservices', 'architecture'],
  hasDependencies: false,
  estimatedTokens: 2000,
  suggestedRole: 'architect',
};

describe('JudgeAgent', () => {
  it('should evaluate arguments and return a verdict', async () => {
    const provider = createMockProvider([{
      content: '{"selectedApproach":"Use event-driven architecture","synthesizedInsights":"All debaters agreed on loose coupling","confidence":0.85}',
      toolCalls: [],
      usage: { inputTokens: 500, outputTokens: 200 },
    }]);

    const judge = new JudgeAgent(provider);
    const args: DebaterArgument[] = [
      { debaterId: 0, perspective: 'pragmatic-engineer', argument: 'Use REST APIs for simplicity.', round: 0 },
      { debaterId: 1, perspective: 'performance-architect', argument: 'Use gRPC for performance.', round: 0 },
    ];

    const verdict = await judge.evaluate(baseTask, args);
    expect(verdict.selectedApproach).toBeTruthy();
    expect(verdict.synthesizedInsights).toBeTruthy();
    expect(verdict.confidence).toBeGreaterThanOrEqual(0);
    expect(verdict.confidence).toBeLessThanOrEqual(1);
  });

  it('should parse verdict from JSON in response', async () => {
    const provider = createMockProvider([{
      content: 'Here is my verdict: {"selectedApproach":"Use microservices","synthesizedInsights":"Good approach","confidence":0.9}',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 100 },
    }]);

    const judge = new JudgeAgent(provider);
    const verdict = await judge.evaluate(baseTask, [
      { debaterId: 0, perspective: 'test', argument: 'Test', round: 0 },
    ]);

    expect(verdict.selectedApproach).toBe('Use microservices');
    expect(verdict.confidence).toBe(0.9);
  });

  it('should use fallback verdict on parse failure', async () => {
    const provider = createMockProvider([{
      content: 'This is not valid JSON at all',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    }]);

    const judge = new JudgeAgent(provider);
    const args: DebaterArgument[] = [
      { debaterId: 0, perspective: 'pragmatic', argument: 'Simple approach.', round: 0 },
    ];

    const verdict = await judge.evaluate(baseTask, args);
    expect(verdict.confidence).toBe(0.5);
    expect(verdict.selectedApproach).toBeTruthy();
  });

  it('should use fallback verdict on LLM error', async () => {
    const provider = {
      name: 'mock',
      complete: vi.fn(async () => { throw new Error('API error'); }),
      stream: vi.fn(),
      listModels: vi.fn(async () => []),
    } as unknown as LLMProvider;

    const judge = new JudgeAgent(provider);
    const args: DebaterArgument[] = [
      { debaterId: 0, perspective: 'test', argument: 'My argument.', round: 0 },
    ];

    const verdict = await judge.evaluate(baseTask, args);
    expect(verdict.confidence).toBe(0.5);
  });

  it('should clamp confidence to 0-1 range', async () => {
    const provider = createMockProvider([{
      content: '{"selectedApproach":"Test","synthesizedInsights":"Test","confidence":1.5}',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
    }]);

    const judge = new JudgeAgent(provider);
    const verdict = await judge.evaluate(baseTask, [
      { debaterId: 0, perspective: 'test', argument: 'Test', round: 0 },
    ]);

    expect(verdict.confidence).toBeLessThanOrEqual(1);
    expect(verdict.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe('DebateArena', () => {
  describe('debate', () => {
    it('should run a multi-agent debate and return result', async () => {
      let callCount = 0;
      const provider = {
        name: 'mock',
        complete: vi.fn(async () => {
          callCount++;
          // Debater arguments (2 debaters × 1 round = 2 calls)
          if (callCount <= 2) {
            return {
              content: `Debater ${callCount} argument: Use approach ${callCount}.`,
              toolCalls: [],
              usage: { inputTokens: 100, outputTokens: 100 },
            };
          }
          // Judge evaluation (call 3)
          if (callCount === 3) {
            return {
              content: '{"selectedApproach":"Use approach 1 with optimizations","synthesizedInsights":"Both approaches have merit","confidence":0.82}',
              toolCalls: [],
              usage: { inputTokens: 200, outputTokens: 100 },
            };
          }
          // Agent execution (call 4+)
          return {
            content: 'Implemented using the selected approach.',
            toolCalls: [],
            usage: { inputTokens: 200, outputTokens: 150 },
          };
        }),
        stream: vi.fn(),
        listModels: vi.fn(async () => []),
      } as unknown as LLMProvider;

      const arena = new DebateArena(
        { debaters: 2, rounds: 1, complexityThreshold: 0.8 },
        { role: 'architect', provider, tools: [], toolContext },
      );

      const result = await arena.debate(baseTask, baseAnalysis);
      expect(result.reasoning).toBeDefined();
      expect(result.reasoning!.strategy).toBe('debate');
      expect(result.reasoning!.steps.length).toBeGreaterThan(0);
    });

    it('should assign perspectives from the built-in list', async () => {
      let debaterCalls: any[] = [];
      const provider = {
        name: 'mock',
        complete: vi.fn(async (request: any) => {
          const systemContent = request.messages[0]?.content || '';
          if (systemContent.includes('pragmatic') || systemContent.includes('performance') || systemContent.includes('safety')) {
            debaterCalls.push(systemContent);
          }
          return {
            content: '{"selectedApproach":"Test","synthesizedInsights":"Test","confidence":0.8}',
            toolCalls: [],
            usage: { inputTokens: 10, outputTokens: 10 },
          };
        }),
        stream: vi.fn(),
        listModels: vi.fn(async () => []),
      } as unknown as LLMProvider;

      const arena = new DebateArena(
        { debaters: 3, rounds: 1, complexityThreshold: 0.8 },
        { role: 'architect', provider, tools: [], toolContext },
      );

      await arena.debate(baseTask, baseAnalysis);
      // At least some debaters should have perspective prompts
      expect(debaterCalls.length).toBeGreaterThan(0);
    });

    it('should handle debater argument failures gracefully', async () => {
      let callCount = 0;
      const provider = {
        name: 'mock',
        complete: vi.fn(async () => {
          callCount++;
          if (callCount === 1) throw new Error('Debater 1 failed');
          return {
            content: '{"selectedApproach":"Fallback","synthesizedInsights":"Limited debate","confidence":0.5}',
            toolCalls: [],
            usage: { inputTokens: 10, outputTokens: 10 },
          };
        }),
        stream: vi.fn(),
        listModels: vi.fn(async () => []),
      } as unknown as LLMProvider;

      const arena = new DebateArena(
        { debaters: 2, rounds: 1, complexityThreshold: 0.8 },
        { role: 'architect', provider, tools: [], toolContext },
      );

      const result = await arena.debate(baseTask, baseAnalysis);
      // Should still complete with fallback
      expect(result).toBeDefined();
      expect(result.reasoning!.strategy).toBe('debate');
    });

    it('should run multiple rounds of debate', async () => {
      let argCalls = 0;
      const provider = {
        name: 'mock',
        complete: vi.fn(async () => {
          argCalls++;
          // 2 debaters × 2 rounds = 4 argument calls, then judge, then agent
          if (argCalls <= 4) {
            return {
              content: `Round argument ${argCalls}`,
              toolCalls: [],
              usage: { inputTokens: 10, outputTokens: 10 },
            };
          }
          if (argCalls === 5) {
            return {
              content: '{"selectedApproach":"Best approach","synthesizedInsights":"Multi-round insights","confidence":0.9}',
              toolCalls: [],
              usage: { inputTokens: 10, outputTokens: 10 },
            };
          }
          return {
            content: 'Executed.',
            toolCalls: [],
            usage: { inputTokens: 10, outputTokens: 10 },
          };
        }),
        stream: vi.fn(),
        listModels: vi.fn(async () => []),
      } as unknown as LLMProvider;

      const arena = new DebateArena(
        { debaters: 2, rounds: 2, complexityThreshold: 0.8 },
        { role: 'architect', provider, tools: [], toolContext },
      );

      const result = await arena.debate(baseTask, baseAnalysis);
      expect(result.reasoning).toBeDefined();
      // Should have observation steps for each argument
      const observations = result.reasoning!.steps.filter(s => s.type === 'observation');
      expect(observations.length).toBeGreaterThanOrEqual(4);
    });

    it('should produce valid reasoning trace structure', async () => {
      const provider = createMockProvider([
        { content: 'Argument 1', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: 'Argument 2', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: '{"selectedApproach":"Test","synthesizedInsights":"Test","confidence":0.8}', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: 'Done.', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
      ]);

      const arena = new DebateArena(
        { debaters: 2, rounds: 1, complexityThreshold: 0.8 },
        { role: 'architect', provider, tools: [], toolContext },
      );

      const result = await arena.debate(baseTask, baseAnalysis);
      expect(result.reasoning!.strategy).toBe('debate');
      expect(typeof result.reasoning!.duration).toBe('number');
      expect(['success', 'failure', 'budget-exceeded']).toContain(result.reasoning!.outcome);
      expect(Array.isArray(result.reasoning!.steps)).toBe(true);
    });

    it('should limit debaters to available perspectives', async () => {
      const provider = createMockProvider([
        { content: 'Arg', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: 'Arg', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: 'Arg', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: 'Arg', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: 'Arg', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: '{"selectedApproach":"T","synthesizedInsights":"I","confidence":0.7}', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
        { content: 'Done.', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } },
      ]);

      // Request 10 debaters but only 5 perspectives exist
      const arena = new DebateArena(
        { debaters: 10, rounds: 1, complexityThreshold: 0.8 },
        { role: 'architect', provider, tools: [], toolContext },
      );

      const result = await arena.debate(baseTask, baseAnalysis);
      // Should still work, limited to 5 perspectives
      expect(result).toBeDefined();
    });

    it('should inject judge verdict into agent execution context', async () => {
      let lastAgentCall: any = null;
      let callCount = 0;
      const provider = {
        name: 'mock',
        complete: vi.fn(async (request: any) => {
          callCount++;
          if (callCount <= 2) {
            return { content: 'Debate argument', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } };
          }
          if (callCount === 3) {
            return {
              content: '{"selectedApproach":"Use event sourcing","synthesizedInsights":"Key insight","confidence":0.88}',
              toolCalls: [],
              usage: { inputTokens: 10, outputTokens: 10 },
            };
          }
          lastAgentCall = request;
          return { content: 'Executed.', toolCalls: [], usage: { inputTokens: 10, outputTokens: 10 } };
        }),
        stream: vi.fn(),
        listModels: vi.fn(async () => []),
      } as unknown as LLMProvider;

      const arena = new DebateArena(
        { debaters: 2, rounds: 1, complexityThreshold: 0.8 },
        { role: 'architect', provider, tools: [], toolContext },
      );

      await arena.debate(baseTask, baseAnalysis);
      // The agent execution should have the verdict in its messages
      expect(lastAgentCall).toBeDefined();
      const userMsg = lastAgentCall.messages.find((m: any) => m.role === 'user');
      expect(userMsg.content).toContain('event sourcing');
    });
  });
});
