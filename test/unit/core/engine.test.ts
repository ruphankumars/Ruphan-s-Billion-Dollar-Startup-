import { describe, it, expect } from 'vitest';
import { PromptAnalyzer } from '../../../src/prompt/analyzer.js';

describe('PromptAnalyzer', () => {
  const analyzer = new PromptAnalyzer();

  it('should analyze a simple prompt', () => {
    const result = analyzer.analyze('fix the login bug');

    expect(result.original).toBe('fix the login bug');
    expect(result.intent).toBe('fix');
    expect(result.complexity).toBeGreaterThan(0);
    expect(result.complexity).toBeLessThanOrEqual(1);
  });

  it('should detect create intent', () => {
    const result = analyzer.analyze('create a new REST API endpoint');
    expect(result.intent).toBe('create');
  });

  it('should detect web domain', () => {
    const result = analyzer.analyze('add a React component for the dashboard');
    expect(result.domains).toContain('web');
  });

  it('should detect auth domain', () => {
    const result = analyzer.analyze('implement JWT authentication');
    expect(result.domains).toContain('auth');
  });

  it('should detect TypeScript language', () => {
    const result = analyzer.analyze('add TypeScript types to the API');
    expect(result.languages).toContain('typescript');
  });

  it('should estimate subtasks', () => {
    const simple = analyzer.analyze('fix typo');
    const complex = analyzer.analyze('add authentication, create tests, and update documentation');

    expect(complex.estimatedSubtasks).toBeGreaterThan(simple.estimatedSubtasks);
  });

  it('should score complexity based on prompt length and terms', () => {
    const simple = analyzer.analyze('fix typo');
    const complex = analyzer.analyze(
      'implement a full OAuth2 authentication system with JWT refresh tokens, ' +
      'role-based access control, database migrations, API endpoints, ' +
      'middleware, comprehensive tests, and documentation',
    );

    expect(complex.complexity).toBeGreaterThan(simple.complexity);
  });

  it('should suggest agent roles', () => {
    const result = analyzer.analyze('analyze the code and fix the auth bug');

    expect(result.suggestedRoles).toContain('researcher');
    expect(result.suggestedRoles).toContain('developer');
    expect(result.suggestedRoles).toContain('validator');
  });

  it('should extract entities from prompts', () => {
    const result = analyzer.analyze('update the UserController in src/controllers/user.ts');

    expect(result.entities.some(e => e.includes('UserController') || e.includes('user.ts'))).toBe(true);
  });
});
