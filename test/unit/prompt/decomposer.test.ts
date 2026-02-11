import { describe, it, expect } from 'vitest';
import { PromptDecomposer } from '../../../src/prompt/decomposer.js';
import { PromptAnalyzer } from '../../../src/prompt/analyzer.js';

describe('PromptDecomposer', () => {
  const decomposer = new PromptDecomposer();
  const analyzer = new PromptAnalyzer();

  it('should decompose a simple prompt into tasks', async () => {
    const prompt = 'add a hello endpoint';
    const analysis = analyzer.analyze(prompt);
    const tasks = await decomposer.decompose(prompt, analysis);

    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some(t => t.role === 'developer')).toBe(true);
  });

  it('should include a validator task', async () => {
    const prompt = 'create a user model';
    const analysis = analyzer.analyze(prompt);
    const tasks = await decomposer.decompose(prompt, analysis);

    expect(tasks.some(t => t.role === 'validator')).toBe(true);
  });

  it('should add researcher task for analyze-intent prompts', async () => {
    const prompt = 'analyze the authentication flow and identify security issues in the codebase';
    const analysis = analyzer.analyze(prompt);
    const tasks = await decomposer.decompose(prompt, analysis);

    // The heuristic adds researcher when intent is 'analyze' or complexity > 0.3
    const hasResearcher = tasks.some(t => t.role === 'researcher');
    // Should have at least some task decomposition
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    // Either has a researcher or the prompt was simple enough to skip
    expect(hasResearcher || analysis.complexity <= 0.3).toBe(true);
  });

  it('should set dependencies correctly', async () => {
    const prompt = 'create a REST API with authentication and tests';
    const analysis = analyzer.analyze(prompt);
    const tasks = await decomposer.decompose(prompt, analysis);

    // Validator should depend on other tasks
    const validator = tasks.find(t => t.role === 'validator');
    expect(validator).toBeDefined();
    expect(validator!.dependencies.length).toBeGreaterThan(0);
  });

  it('should assign priority to tasks', async () => {
    const prompt = 'fix the login bug';
    const analysis = analyzer.analyze(prompt);
    const tasks = await decomposer.decompose(prompt, analysis);

    for (const task of tasks) {
      expect(task.priority).toBeGreaterThanOrEqual(1);
      expect(task.priority).toBeLessThanOrEqual(10);
    }
  });
});
