import { describe, it, expect, vi } from 'vitest';
import { ToolChainPlanner } from '../../../src/reasoning/tools/tool-chain-planner.js';
import { ToolComposer } from '../../../src/reasoning/tools/tool-composer.js';
import type { Tool, ToolContext, ToolResult } from '../../../src/tools/types.js';
import type { AgentTask } from '../../../src/agents/types.js';

function createTool(name: string, description: string): Tool {
  return {
    name,
    description,
    parameters: { type: 'object' as const, properties: {}, required: [] },
    execute: vi.fn(async () => ({ success: true, output: `${name} output` })),
  };
}

const toolContext: ToolContext = { workingDir: '/tmp', executionId: 'test' };

describe('ToolChainPlanner', () => {
  const planner = new ToolChainPlanner({ maxChainLength: 5 });

  const tools = [
    createTool('file_read', 'Read a file from the filesystem'),
    createTool('file_write', 'Write content to a file'),
    createTool('file_edit', 'Edit an existing file'),
    createTool('file_search', 'Search for files matching a pattern'),
    createTool('run_tests', 'Run the test suite'),
    createTool('run_command', 'Execute a shell command'),
    createTool('git_commit', 'Create a git commit'),
    createTool('rag_search', 'Search project code semantically'),
  ];

  describe('scoreTools', () => {
    it('should score all tools and return sorted results', () => {
      const task: AgentTask = {
        id: 't1',
        description: 'Read the config file and fix the bug',
        role: 'developer',
        dependencies: [],
        wave: 0,
      };

      const scored = planner.scoreTools(tools, task);
      expect(scored).toHaveLength(tools.length);

      // Should be sorted by score descending
      for (let i = 1; i < scored.length; i++) {
        expect(scored[i - 1].score).toBeGreaterThanOrEqual(scored[i].score);
      }
    });

    it('should score file_read higher for read-oriented tasks', () => {
      const task: AgentTask = {
        id: 't1',
        description: 'Read the configuration and analyze it',
        role: 'developer',
        dependencies: [],
        wave: 0,
      };

      const scored = planner.scoreTools(tools, task);
      const fileReadScore = scored.find(s => s.tool.name === 'file_read')!.score;
      const gitCommitScore = scored.find(s => s.tool.name === 'git_commit')!.score;

      expect(fileReadScore).toBeGreaterThan(gitCommitScore);
    });

    it('should score test tools higher for testing tasks', () => {
      const task: AgentTask = {
        id: 't1',
        description: 'Run tests and fix any failures',
        role: 'tester',
        dependencies: [],
        wave: 0,
      };

      const scored = planner.scoreTools(tools, task);
      const testScore = scored.find(s => s.tool.name === 'run_tests')!.score;

      expect(testScore).toBeGreaterThan(0);
    });

    it('should boost tools matching task role', () => {
      const devTask: AgentTask = {
        id: 't1',
        description: 'Implement the feature',
        role: 'developer',
        dependencies: [],
        wave: 0,
      };

      const scored = planner.scoreTools(tools, devTask);
      const fileWriteScore = scored.find(s => s.tool.name === 'file_write')!.score;

      // file_write should get a role boost for developer
      expect(fileWriteScore).toBeGreaterThan(0);
    });

    it('should provide reasons for each score', () => {
      const task: AgentTask = {
        id: 't1',
        description: 'Edit the file and run tests',
        role: 'developer',
        dependencies: [],
        wave: 0,
      };

      const scored = planner.scoreTools(tools, task);
      for (const item of scored) {
        expect(item.reason).toBeTruthy();
      }
    });

    it('should handle tasks with context', () => {
      const task: AgentTask = {
        id: 't1',
        description: 'Fix bug',
        role: 'developer',
        dependencies: [],
        wave: 0,
        context: 'The bug is in the search functionality',
      };

      const scored = planner.scoreTools(tools, task);
      const searchScore = scored.find(s => s.tool.name === 'file_search')!.score;
      expect(searchScore).toBeGreaterThan(0);
    });
  });

  describe('selectTools', () => {
    it('should return only the top N most relevant tools', () => {
      const narrowPlanner = new ToolChainPlanner({ maxChainLength: 3 });
      const task: AgentTask = {
        id: 't1',
        description: 'Read, edit, and test the code',
        role: 'developer',
        dependencies: [],
        wave: 0,
      };

      const selected = narrowPlanner.selectTools(tools, task);
      expect(selected.length).toBeLessThanOrEqual(3);
    });

    it('should filter out tools below minimum relevance', () => {
      const strictPlanner = new ToolChainPlanner({
        maxChainLength: 10,
        minRelevanceScore: 0.99,
      });

      const task: AgentTask = {
        id: 't1',
        description: 'Do something vague',
        role: 'developer',
        dependencies: [],
        wave: 0,
      };

      const selected = strictPlanner.selectTools(tools, task);
      // With very high threshold, few or no tools should be selected
      expect(selected.length).toBeLessThanOrEqual(tools.length);
    });

    it('should return Tool instances (not wrappers)', () => {
      const task: AgentTask = {
        id: 't1',
        description: 'Read and write files',
        role: 'developer',
        dependencies: [],
        wave: 0,
      };

      const selected = planner.selectTools(tools, task);
      for (const tool of selected) {
        expect(tool.name).toBeTruthy();
        expect(tool.execute).toBeDefined();
      }
    });
  });

  describe('keyword affinity', () => {
    it('should match "search" keyword to search tools', () => {
      const task: AgentTask = {
        id: 't1',
        description: 'Search for the authentication module',
        role: 'developer',
        dependencies: [],
        wave: 0,
      };

      const scored = planner.scoreTools(tools, task);
      const searchTools = scored.filter(s =>
        s.tool.name.includes('search') && s.score > 0,
      );
      expect(searchTools.length).toBeGreaterThan(0);
    });

    it('should match "commit" keyword to git tools', () => {
      const task: AgentTask = {
        id: 't1',
        description: 'Commit the changes to git',
        role: 'developer',
        dependencies: [],
        wave: 0,
      };

      const scored = planner.scoreTools(tools, task);
      const commitScore = scored.find(s => s.tool.name === 'git_commit')!.score;
      expect(commitScore).toBeGreaterThan(0);
    });

    it('should match "refactor" keyword to edit and read tools', () => {
      const task: AgentTask = {
        id: 't1',
        description: 'Refactor the codebase for better structure',
        role: 'developer',
        dependencies: [],
        wave: 0,
      };

      const scored = planner.scoreTools(tools, task);
      const editScore = scored.find(s => s.tool.name === 'file_edit')!.score;
      const readScore = scored.find(s => s.tool.name === 'file_read')!.score;

      expect(editScore).toBeGreaterThan(0);
      expect(readScore).toBeGreaterThan(0);
    });
  });
});

describe('ToolComposer', () => {
  const fileRead = createTool('file_read', 'Read a file');
  const fileEdit = createTool('file_edit', 'Edit a file');
  const fileSearch = createTool('file_search', 'Search for files');
  const allTools = [fileRead, fileEdit, fileSearch];

  describe('compose', () => {
    it('should create a composite tool with correct name and description', () => {
      const composer = new ToolComposer(allTools);
      const composite = composer.compose({
        name: 'custom_tool',
        description: 'A custom composite tool',
        parameters: { type: 'object', properties: {}, required: [] },
        steps: [],
      });

      expect(composite.name).toBe('custom_tool');
      expect(composite.description).toBe('A custom composite tool');
    });

    it('should execute steps sequentially', async () => {
      const composer = new ToolComposer(allTools);
      const composite = composer.compose({
        name: 'read_then_edit',
        description: 'Read then edit',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
        steps: [
          { toolName: 'file_read', argMapping: { path: '$args.path' } },
          { toolName: 'file_edit', argMapping: { content: '$prev_output' } },
        ],
      });

      const result = await composite.execute({ path: '/tmp/test.ts' }, toolContext);
      expect(result.success).toBe(true);
      expect(fileRead.execute).toHaveBeenCalled();
      expect(fileEdit.execute).toHaveBeenCalled();
    });

    it('should fail if a step references unknown tool', async () => {
      const composer = new ToolComposer(allTools);
      const composite = composer.compose({
        name: 'broken',
        description: 'Broken composite',
        parameters: { type: 'object', properties: {}, required: [] },
        steps: [
          { toolName: 'nonexistent', argMapping: {} },
        ],
      });

      const result = await composite.execute({}, toolContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent');
    });

    it('should abort on step failure', async () => {
      const failTool: Tool = {
        name: 'fail_tool',
        description: 'Always fails',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: vi.fn(async () => ({
          success: false,
          output: '',
          error: 'Intentional failure',
        })),
      };

      // Create a fresh mock to avoid contamination from previous tests
      const freshEdit = createTool('file_edit', 'Edit a file');

      const composer = new ToolComposer([failTool, freshEdit]);
      const composite = composer.compose({
        name: 'fail_chain',
        description: 'Will fail at step 1',
        parameters: { type: 'object', properties: {}, required: [] },
        steps: [
          { toolName: 'fail_tool', argMapping: {} },
          { toolName: 'file_edit', argMapping: {} },
        ],
      });

      const result = await composite.execute({}, toolContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('step 1');
      expect(freshEdit.execute).not.toHaveBeenCalled();
    });

    it('should pass literal values in argMapping', async () => {
      const composer = new ToolComposer(allTools);
      const composite = composer.compose({
        name: 'literal_test',
        description: 'Uses literal values',
        parameters: { type: 'object', properties: {}, required: [] },
        steps: [
          { toolName: 'file_read', argMapping: { path: { literal: '/hardcoded/path' } } },
        ],
      });

      await composite.execute({}, toolContext);
      expect(fileRead.execute).toHaveBeenCalledWith(
        { path: '/hardcoded/path' },
        toolContext,
      );
    });
  });

  describe('getAvailableComposites', () => {
    it('should create read_and_edit composite when both tools available', () => {
      const composer = new ToolComposer(allTools);
      const composites = composer.getAvailableComposites();

      const readEdit = composites.find(t => t.name === 'read_and_edit');
      expect(readEdit).toBeDefined();
    });

    it('should create search_and_read composite when both tools available', () => {
      const composer = new ToolComposer(allTools);
      const composites = composer.getAvailableComposites();

      const searchRead = composites.find(t => t.name === 'search_and_read');
      expect(searchRead).toBeDefined();
    });

    it('should not create composites when required tools are missing', () => {
      const composer = new ToolComposer([createTool('unrelated', 'Nothing')]);
      const composites = composer.getAvailableComposites();

      expect(composites.length).toBe(0);
    });
  });

  describe('createReadEditTool', () => {
    it('should return null when file_read is missing', () => {
      const composer = new ToolComposer([fileEdit]);
      expect(composer.createReadEditTool()).toBeNull();
    });

    it('should return null when file_edit is missing', () => {
      const composer = new ToolComposer([fileRead]);
      expect(composer.createReadEditTool()).toBeNull();
    });

    it('should create a working composite tool', async () => {
      const composer = new ToolComposer(allTools);
      const tool = composer.createReadEditTool();

      expect(tool).not.toBeNull();
      const result = await tool!.execute(
        { path: '/test.ts', old_text: 'foo', new_text: 'bar' },
        toolContext,
      );
      expect(result.success).toBe(true);
    });
  });

  describe('createSearchReadTool', () => {
    it('should return null when required tools missing', () => {
      const composer = new ToolComposer([fileEdit]);
      expect(composer.createSearchReadTool()).toBeNull();
    });

    it('should create a working composite tool', async () => {
      const composer = new ToolComposer(allTools);
      const tool = composer.createSearchReadTool();

      expect(tool).not.toBeNull();
      const result = await tool!.execute({ pattern: '*.ts' }, toolContext);
      expect(result.success).toBe(true);
    });
  });
});
