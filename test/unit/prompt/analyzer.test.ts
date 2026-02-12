import { describe, it, expect } from 'vitest';
import { PromptAnalyzer } from '../../../src/prompt/analyzer.js';

describe('PromptAnalyzer', () => {
  const analyzer = new PromptAnalyzer();

  describe('analyze()', () => {
    it('should return the original prompt unchanged', () => {
      const prompt = 'do something';
      const result = analyzer.analyze(prompt);
      expect(result.original).toBe(prompt);
    });
  });

  describe('complexity scoring', () => {
    it('should return low complexity (~0.1) for a simple short prompt', () => {
      const result = analyzer.analyze('fix a typo');
      // 3 words, no conjunctions, no file refs, no tech terms, 1 action verb (fix) = 0.05
      // Max(0.1, 0.05) = 0.1 (minimum floor)
      expect(result.complexity).toBeCloseTo(0.1, 1);
    });

    it('should increase complexity for prompts with more than 10 words', () => {
      const prompt = 'please create a new component that handles user input and displays results nicely on screen';
      // 15 words => +0.1, 1 conjunction "and" => +0.05, action verbs: "create" => +0.05
      const result = analyzer.analyze(prompt);
      expect(result.complexity).toBeGreaterThanOrEqual(0.2);
    });

    it('should return higher complexity for prompts with many tech terms', () => {
      const prompt =
        'build a REST API with JWT auth, PostgreSQL database, Redis caching, GraphQL endpoint, and Docker deployment with CI/CD pipeline and Kubernetes orchestration';
      const result = analyzer.analyze(prompt);
      // tech terms: rest, jwt, postgres, database, redis, graphql, docker, ci, cd, kubernetes = many
      // conjunctions: "and" x2, "with" is not a conjunction
      // action verbs: "build", "deploy" (from deployment)
      expect(result.complexity).toBeGreaterThanOrEqual(0.4);
    });

    it('should cap complexity at 1.0', () => {
      // Craft a prompt that would exceed 1.0 if uncapped
      const prompt =
        'create and implement and build and also additionally furthermore moreover ' +
        'a REST API with JWT auth database postgres mongo redis graphql middleware migration deploy ci cd docker kubernetes ' +
        'add create build implement fix update modify refactor optimize test deploy configure setup integrate ' +
        'file1.ts file2.ts file3.ts file4.ts ' +
        'this is a very long prompt with many many many words to push us over the word count limits ' +
        'and we keep going and going and going to make sure we exceed all the thresholds for every category';
      const result = analyzer.analyze(prompt);
      expect(result.complexity).toBeLessThanOrEqual(1.0);
    });

    it('should enforce minimum complexity of 0.1', () => {
      const result = analyzer.analyze('hi');
      expect(result.complexity).toBeGreaterThanOrEqual(0.1);
    });

    it('should increase complexity with conjunctions', () => {
      const simple = analyzer.analyze('fix the login page');
      const withConjunctions = analyzer.analyze('fix the login page and also update the signup page and additionally refactor the auth module');
      expect(withConjunctions.complexity).toBeGreaterThan(simple.complexity);
    });

    it('should increase complexity with file references', () => {
      const noFiles = analyzer.analyze('update the component');
      const withFiles = analyzer.analyze('update index.ts and app.tsx and main.js');
      expect(withFiles.complexity).toBeGreaterThan(noFiles.complexity);
    });
  });

  describe('domain detection', () => {
    it('should detect web domain for React-related prompts', () => {
      const result = analyzer.analyze('create a React component for the dashboard');
      expect(result.domains).toContain('web');
    });

    it('should detect api domain', () => {
      const result = analyzer.analyze('build a new REST endpoint for users');
      expect(result.domains).toContain('api');
    });

    it('should detect database domain', () => {
      const result = analyzer.analyze('write a SQL migration for the users table');
      expect(result.domains).toContain('database');
    });

    it('should detect multiple domains', () => {
      const result = analyzer.analyze('add REST API with postgres database');
      expect(result.domains).toContain('api');
      expect(result.domains).toContain('database');
    });

    it('should detect auth domain', () => {
      const result = analyzer.analyze('implement JWT authentication with login and signup');
      expect(result.domains).toContain('auth');
    });

    it('should detect testing domain', () => {
      const result = analyzer.analyze('write unit tests with full coverage');
      expect(result.domains).toContain('testing');
    });

    it('should detect devops domain', () => {
      const result = analyzer.analyze('deploy using Docker and Kubernetes');
      expect(result.domains).toContain('devops');
    });

    it('should detect cli domain', () => {
      const result = analyzer.analyze('build a CLI command for generating reports');
      expect(result.domains).toContain('cli');
    });

    it('should detect mobile domain', () => {
      const result = analyzer.analyze('create a Flutter app for iOS and Android');
      expect(result.domains).toContain('mobile');
    });

    it('should detect ml domain', () => {
      const result = analyzer.analyze('train a machine learning model for predictions');
      expect(result.domains).toContain('ml');
    });

    it('should detect security domain', () => {
      const result = analyzer.analyze('fix the XSS vulnerability in the form');
      expect(result.domains).toContain('security');
    });

    it('should return ["general"] when no specific domain is detected', () => {
      const result = analyzer.analyze('do something interesting');
      expect(result.domains).toEqual(['general']);
    });
  });

  describe('intent detection', () => {
    it('should detect "fix" intent', () => {
      const result = analyzer.analyze('fix the login bug');
      expect(result.intent).toBe('fix');
    });

    it('should detect "fix" intent from error-related words', () => {
      const result = analyzer.analyze('there is a bug when clicking submit');
      expect(result.intent).toBe('fix');
    });

    it('should detect "create" intent', () => {
      const result = analyzer.analyze('create a new user model');
      expect(result.intent).toBe('create');
    });

    it('should detect "create" intent from "build"', () => {
      const result = analyzer.analyze('build a dashboard');
      expect(result.intent).toBe('create');
    });

    it('should detect "modify" intent', () => {
      const result = analyzer.analyze('change the color of the button');
      expect(result.intent).toBe('modify');
    });

    it('should detect "refactor" intent', () => {
      const result = analyzer.analyze('refactor the service layer for better separation');
      expect(result.intent).toBe('refactor');
    });

    it('should detect "test" intent', () => {
      const result = analyzer.analyze('test the auth module thoroughly');
      expect(result.intent).toBe('test');
    });

    it('should detect "document" intent', () => {
      const result = analyzer.analyze('document the API endpoints in the readme');
      expect(result.intent).toBe('document');
    });

    it('should detect "analyze" intent', () => {
      const result = analyzer.analyze('investigate why the memory usage is high');
      expect(result.intent).toBe('analyze');
    });

    it('should detect "optimize" intent', () => {
      const result = analyzer.analyze('optimize database queries for better performance');
      expect(result.intent).toBe('optimize');
    });

    it('should detect "deploy" intent', () => {
      const result = analyzer.analyze('deploy to production');
      expect(result.intent).toBe('deploy');
    });

    it('should return "unknown" for a generic prompt', () => {
      const result = analyzer.analyze('hello world');
      expect(result.intent).toBe('unknown');
    });

    it('should prioritize "fix" over "create" when both patterns match', () => {
      // "fix" comes before "create" in the detection order
      const result = analyzer.analyze('fix by creating a new handler');
      expect(result.intent).toBe('fix');
    });
  });

  describe('language detection', () => {
    it('should detect TypeScript', () => {
      const result = analyzer.analyze('write TypeScript code for the parser');
      expect(result.languages).toContain('typescript');
    });

    it('should detect JavaScript via "node"', () => {
      const result = analyzer.analyze('set up a node server');
      expect(result.languages).toContain('javascript');
    });

    it('should detect Python', () => {
      const result = analyzer.analyze('write a Python script using Flask');
      expect(result.languages).toContain('python');
    });

    it('should detect Rust', () => {
      const result = analyzer.analyze('implement a Rust module with cargo');
      expect(result.languages).toContain('rust');
    });

    it('should detect Go', () => {
      const result = analyzer.analyze('build a Golang microservice');
      expect(result.languages).toContain('go');
    });

    it('should detect SQL via postgres', () => {
      const result = analyzer.analyze('optimize postgres queries');
      expect(result.languages).toContain('sql');
    });

    it('should detect multiple languages', () => {
      const result = analyzer.analyze('create a TypeScript frontend and Python backend');
      expect(result.languages).toContain('typescript');
      expect(result.languages).toContain('python');
    });

    it('should return empty array when no language is detected', () => {
      const result = analyzer.analyze('do something');
      expect(result.languages).toEqual([]);
    });
  });

  describe('entity extraction', () => {
    it('should extract file paths', () => {
      const result = analyzer.analyze('update the file src/index.ts');
      expect(result.entities).toContain('src/index.ts');
    });

    it('should extract quoted strings', () => {
      const result = analyzer.analyze('rename the function to "calculateTotal"');
      expect(result.entities).toContain('calculateTotal');
    });

    it('should extract PascalCase identifiers', () => {
      const result = analyzer.analyze('refactor the UserService class');
      expect(result.entities).toContain('UserService');
    });

    it('should extract multiple entities', () => {
      const result = analyzer.analyze('update UserController in src/controllers/user.ts to use the AuthService');
      expect(result.entities).toContain('UserController');
      expect(result.entities).toContain('AuthService');
      expect(result.entities.some(e => e.includes('user.ts'))).toBe(true);
    });

    it('should deduplicate entities', () => {
      const result = analyzer.analyze('use UserService and also UserService again');
      const userServiceCount = result.entities.filter(e => e === 'UserService').length;
      expect(userServiceCount).toBeLessThanOrEqual(1);
    });

    it('should limit entities to 20', () => {
      // Generate a prompt with more than 20 potential entities
      const files = Array.from({ length: 25 }, (_, i) => `file${i}.ts`).join(' ');
      const result = analyzer.analyze(`update ${files}`);
      expect(result.entities.length).toBeLessThanOrEqual(20);
    });
  });

  describe('suggested roles', () => {
    it('should always include "orchestrator"', () => {
      const result = analyzer.analyze('hello world');
      expect(result.suggestedRoles).toContain('orchestrator');
    });

    it('should always include "validator"', () => {
      const result = analyzer.analyze('hello world');
      expect(result.suggestedRoles).toContain('validator');
    });

    it('should include "developer" for implementation prompts', () => {
      const result = analyzer.analyze('implement the feature');
      expect(result.suggestedRoles).toContain('developer');
    });

    it('should include "tester" for test-related prompts', () => {
      const result = analyzer.analyze('improve test coverage');
      expect(result.suggestedRoles).toContain('tester');
    });

    it('should include "researcher" for investigation prompts', () => {
      const result = analyzer.analyze('investigate why the server crashes');
      expect(result.suggestedRoles).toContain('researcher');
    });

    it('should include "architect" for design prompts', () => {
      const result = analyzer.analyze('design the system architecture');
      expect(result.suggestedRoles).toContain('architect');
    });

    it('should include multiple roles for complex prompts', () => {
      const result = analyzer.analyze('analyze the codebase and implement new features and verify with test coverage');
      expect(result.suggestedRoles).toContain('orchestrator');
      expect(result.suggestedRoles).toContain('validator');
      expect(result.suggestedRoles).toContain('researcher');
      expect(result.suggestedRoles).toContain('developer');
      expect(result.suggestedRoles).toContain('tester');
    });
  });

  describe('subtask estimation', () => {
    it('should estimate at least 1 subtask', () => {
      const result = analyzer.analyze('hello');
      expect(result.estimatedSubtasks).toBeGreaterThanOrEqual(1);
    });

    it('should estimate more subtasks for prompts with multiple action verbs', () => {
      const result = analyzer.analyze('create the model, implement the controller, add tests, and deploy');
      expect(result.estimatedSubtasks).toBeGreaterThanOrEqual(3);
    });

    it('should estimate subtasks from bullet-point lists', () => {
      const prompt = `do the following:
- create user model
- add authentication
- write tests`;
      const result = analyzer.analyze(prompt);
      expect(result.estimatedSubtasks).toBeGreaterThanOrEqual(3);
    });

    it('should cap subtask estimation at 10', () => {
      const actions = 'add and create and build and implement and fix and update and modify and refactor and optimize and test and deploy and configure and setup and integrate';
      const result = analyzer.analyze(actions);
      expect(result.estimatedSubtasks).toBeLessThanOrEqual(10);
    });
  });
});
