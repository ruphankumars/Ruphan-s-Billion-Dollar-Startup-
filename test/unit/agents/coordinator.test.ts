import { describe, it, expect } from 'vitest';
import { PromptAnalyzer } from '../../../src/prompt/analyzer.js';
import { PromptDecomposer } from '../../../src/prompt/decomposer.js';
import { ExecutionPlanner } from '../../../src/prompt/planner.js';

describe('Execution Pipeline', () => {
  const analyzer = new PromptAnalyzer();
  const decomposer = new PromptDecomposer();
  const planner = new ExecutionPlanner();

  it('should create a valid execution plan from prompt', async () => {
    const prompt = 'add a user authentication system';
    const analysis = analyzer.analyze(prompt);
    const tasks = await decomposer.decompose(prompt, analysis);
    const plan = planner.plan(tasks);

    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(plan.waves.length).toBeGreaterThan(0);
    expect(plan.totalEstimatedCost).toBeGreaterThan(0);
    expect(plan.estimatedDuration).toBeGreaterThan(0);
  });

  it('should respect task dependencies in wave scheduling', async () => {
    const prompt = 'create REST API with auth, tests, and documentation';
    const analysis = analyzer.analyze(prompt);
    const tasks = await decomposer.decompose(prompt, analysis);
    const plan = planner.plan(tasks);

    // First wave should have no dependencies
    const firstWave = plan.waves[0];
    for (const taskId of firstWave.taskIds) {
      const task = plan.tasks.find(t => t.id === taskId);
      expect(task).toBeDefined();
      expect(task!.dependencies.length).toBe(0);
    }
  });

  it('should handle single-task prompts', async () => {
    const prompt = 'fix typo';
    const analysis = analyzer.analyze(prompt);
    const tasks = await decomposer.decompose(prompt, analysis);
    const plan = planner.plan(tasks);

    expect(plan.tasks.length).toBeGreaterThanOrEqual(1);
    expect(plan.waves.length).toBeGreaterThanOrEqual(1);
  });
});
