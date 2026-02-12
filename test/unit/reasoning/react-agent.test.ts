import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReActAgent } from '../../../src/reasoning/react/react-agent.js';
import type { LLMProvider, LLMResponse } from '../../../src/providers/types.js';
import type { Tool, ToolContext } from '../../../src/tools/types.js';
import type { AgentTask } from '../../../src/agents/types.js';

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

function createMockTool(name: string): Tool {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: { type: 'object' as const, properties: {}, required: [] },
    execute: vi.fn(async () => ({ success: true, output: `${name} result` })),
  };
}

const toolContext: ToolContext = { workingDir: '/tmp', executionId: 'test' };

const baseTask: AgentTask = {
  id: 'task-1',
  description: 'Write a hello world function',
  role: 'developer',
  dependencies: [],
  wave: 0,
};

describe('ReActAgent', () => {
  describe('constructor', () => {
    it('should create an agent with a unique id', () => {
      const provider = createMockProvider([]);
      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [],
        toolContext,
        maxThoughts: 5,
      });
      expect(agent.id).toBeTruthy();
      expect(agent.id.length).toBeGreaterThan(0);
    });

    it('should create agents with different ids', () => {
      const provider = createMockProvider([]);
      const opts = { role: 'developer' as const, provider, tools: [], toolContext, maxThoughts: 5 };
      const agent1 = new ReActAgent(opts);
      const agent2 = new ReActAgent(opts);
      expect(agent1.id).not.toBe(agent2.id);
    });
  });

  describe('execute', () => {
    it('should return success when LLM completes without tool calls', async () => {
      const provider = createMockProvider([{
        content: 'Thought: The task is simple.\n\nHere is the result.',
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      }]);

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [],
        toolContext,
        maxThoughts: 5,
      });

      const result = await agent.execute(baseTask);
      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-1');
      expect(result.reasoning).toBeDefined();
      expect(result.reasoning!.strategy).toBe('react');
    });

    it('should extract thoughts from LLM response', async () => {
      const provider = createMockProvider([{
        content: 'Thought: I need to analyze the requirements first.\n\nThe result is ready.',
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50 },
      }]);

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [],
        toolContext,
        maxThoughts: 5,
      });

      const result = await agent.execute(baseTask);
      expect(result.reasoning!.steps.some(s => s.type === 'thought')).toBe(true);
    });

    it('should handle tool calls with action and observation steps', async () => {
      const provider = createMockProvider([
        {
          content: 'Thought: I need to read the file first.',
          toolCalls: [{ id: 'tc1', name: 'file_read', arguments: '{"path":"/tmp/test.ts"}' }],
          usage: { inputTokens: 100, outputTokens: 50 },
        },
        {
          content: 'Thought: Now I can write the function.',
          toolCalls: [],
          usage: { inputTokens: 200, outputTokens: 100 },
        },
      ]);

      const fileTool = createMockTool('file_read');
      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [fileTool],
        toolContext,
        maxThoughts: 5,
      });

      const result = await agent.execute(baseTask);
      expect(result.success).toBe(true);

      const actions = result.reasoning!.steps.filter(s => s.type === 'action');
      const observations = result.reasoning!.steps.filter(s => s.type === 'observation');
      expect(actions.length).toBeGreaterThan(0);
      expect(observations.length).toBeGreaterThan(0);
    });

    it('should track token usage across iterations', async () => {
      const provider = createMockProvider([
        {
          content: 'Thought: Let me process this.',
          toolCalls: [{ id: 'tc1', name: 'tool1', arguments: '{}' }],
          usage: { inputTokens: 100, outputTokens: 50 },
        },
        {
          content: 'Done.',
          toolCalls: [],
          usage: { inputTokens: 200, outputTokens: 100 },
        },
      ]);

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [createMockTool('tool1')],
        toolContext,
        maxThoughts: 5,
      });

      const result = await agent.execute(baseTask);
      expect(result.tokensUsed!.input).toBe(300);
      expect(result.tokensUsed!.output).toBe(150);
      expect(result.tokensUsed!.total).toBe(450);
    });

    it('should fail when max iterations reached', async () => {
      // Always returns tool calls, never completes
      const provider = createMockProvider([{
        content: 'Thought: Keep going.',
        toolCalls: [{ id: 'tc1', name: 'tool1', arguments: '{}' }],
        usage: { inputTokens: 10, outputTokens: 10 },
      }]);

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [createMockTool('tool1')],
        toolContext,
        maxIterations: 2,
        maxThoughts: 5,
      });

      const result = await agent.execute(baseTask);
      expect(result.success).toBe(false);
      expect(result.error).toContain('maximum iterations');
      expect(result.reasoning!.outcome).toBe('failure');
    });

    it('should handle LLM errors gracefully', async () => {
      const provider = {
        name: 'mock',
        complete: vi.fn(async () => { throw new Error('LLM timeout'); }),
        stream: vi.fn(),
        listModels: vi.fn(async () => []),
      } as unknown as LLMProvider;

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [],
        toolContext,
        maxThoughts: 5,
      });

      const result = await agent.execute(baseTask);
      expect(result.success).toBe(false);
      expect(result.error).toBe('LLM timeout');
      expect(result.reasoning!.strategy).toBe('react');
    });

    it('should handle unknown tool calls', async () => {
      const provider = createMockProvider([
        {
          content: 'Thought: Use an unknown tool.',
          toolCalls: [{ id: 'tc1', name: 'nonexistent', arguments: '{}' }],
          usage: { inputTokens: 10, outputTokens: 10 },
        },
        {
          content: 'Done.',
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10 },
        },
      ]);

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [],
        toolContext,
        maxThoughts: 5,
      });

      const result = await agent.execute(baseTask);
      const observations = result.reasoning!.steps.filter(s => s.type === 'observation');
      expect(observations.some(o => o.content.includes('Unknown tool'))).toBe(true);
    });

    it('should include task context in messages', async () => {
      const provider = createMockProvider([{
        content: 'Done.',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 10 },
      }]);

      const taskWithContext = { ...baseTask, context: 'Use TypeScript' };
      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [],
        toolContext,
        maxThoughts: 5,
      });

      await agent.execute(taskWithContext);
      const calls = (provider.complete as any).mock.calls;
      const messages = calls[0][0].messages;
      expect(messages.some((m: any) => m.content.includes('Use TypeScript'))).toBe(true);
    });

    it('should inject ReAct system prompt', async () => {
      const provider = createMockProvider([{
        content: 'Done.',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 10 },
      }]);

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [],
        toolContext,
        maxThoughts: 5,
      });

      await agent.execute(baseTask);
      const calls = (provider.complete as any).mock.calls;
      const systemMsg = calls[0][0].messages.find((m: any) => m.role === 'system');
      expect(systemMsg.content).toContain('ReAct');
      expect(systemMsg.content).toContain('Thought:');
    });

    it('should combine custom system prompt with ReAct prompt', async () => {
      const provider = createMockProvider([{
        content: 'Done.',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 10 },
      }]);

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [],
        toolContext,
        maxThoughts: 5,
        systemPrompt: 'You are an expert developer.',
      });

      await agent.execute(baseTask);
      const calls = (provider.complete as any).mock.calls;
      const systemMsg = calls[0][0].messages.find((m: any) => m.role === 'system');
      expect(systemMsg.content).toContain('expert developer');
      expect(systemMsg.content).toContain('ReAct');
    });

    it('should record file changes from file_write tool calls', async () => {
      const provider = createMockProvider([
        {
          content: 'Thought: Writing the file.',
          toolCalls: [{ id: 'tc1', name: 'file_write', arguments: '{"path":"/tmp/hello.ts","content":"export const x = 1;"}' }],
          usage: { inputTokens: 10, outputTokens: 10 },
        },
        {
          content: 'Done.',
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10 },
        },
      ]);

      const writeTool = createMockTool('file_write');
      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [writeTool],
        toolContext,
        maxThoughts: 5,
      });

      const result = await agent.execute(baseTask);
      expect(result.filesChanged).toHaveLength(1);
      expect(result.filesChanged![0].path).toBe('/tmp/hello.ts');
    });

    it('should extract multiple thoughts from a single response', async () => {
      const provider = createMockProvider([{
        content: 'Thought: First, I analyze.\nThought: Second, I plan.\n\nHere is the answer.',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 10 },
      }]);

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [],
        toolContext,
        maxThoughts: 10,
      });

      const result = await agent.execute(baseTask);
      const thoughts = result.reasoning!.steps.filter(s => s.type === 'thought');
      expect(thoughts.length).toBe(2);
    });

    it('should produce reasoning trace with correct duration', async () => {
      const provider = createMockProvider([{
        content: 'Done.',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 10 },
      }]);

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [],
        toolContext,
        maxThoughts: 5,
      });

      const result = await agent.execute(baseTask);
      expect(result.reasoning!.duration).toBeGreaterThanOrEqual(0);
      expect(result.reasoning!.totalTokens.total).toBeGreaterThan(0);
    });

    it('should handle tool call with non-string arguments', async () => {
      const provider = createMockProvider([
        {
          content: 'Thought: Call tool.',
          toolCalls: [{ id: 'tc1', name: 'tool1', arguments: { key: 'value' } }],
          usage: { inputTokens: 10, outputTokens: 10 },
        },
        {
          content: 'Done.',
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10 },
        },
      ]);

      const agent = new ReActAgent({
        role: 'developer',
        provider,
        tools: [createMockTool('tool1')],
        toolContext,
        maxThoughts: 5,
      });

      const result = await agent.execute(baseTask);
      expect(result.success).toBe(true);
    });
  });
});
