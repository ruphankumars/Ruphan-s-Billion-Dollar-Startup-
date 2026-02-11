import { describe, it, expect } from 'vitest';
import { PromptEnhancer } from '../../../src/prompt/enhancer.js';
import { PromptAnalyzer } from '../../../src/prompt/analyzer.js';
import type { MemoryRecallResult } from '../../../src/memory/types.js';

describe('PromptEnhancer', () => {
  const enhancer = new PromptEnhancer();
  const analyzer = new PromptAnalyzer();

  it('should enhance a simple prompt', () => {
    const prompt = 'add a login page';
    const analysis = analyzer.analyze(prompt);
    const result = enhancer.enhance(prompt, analysis, [], null);

    expect(result.systemPrompt).toBeDefined();
    expect(result.userPrompt).toContain(prompt);
    expect(result.analysis).toBe(analysis);
  });

  it('should inject memory context when available', () => {
    const prompt = 'fix the auth bug';
    const analysis = analyzer.analyze(prompt);

    const memories: MemoryRecallResult[] = [{
      entry: {
        id: 'mem1',
        type: 'semantic',
        content: 'This project uses JWT for authentication',
        metadata: {
          source: 'extraction',
          tags: ['auth'],
          entities: [],
          relations: [],
          confidence: 0.9,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        accessedAt: new Date(),
        accessCount: 3,
        importance: 0.8,
        decayFactor: 1.0,
      },
      relevance: 0.85,
      recencyBoost: 0.9,
      finalScore: 0.87,
    }];

    const result = enhancer.enhance(prompt, analysis, memories, null);

    expect(result.memoryContext).toContain('JWT');
    expect(result.memoryContext).toContain('Relevant Memories');
  });

  it('should inject repo context when available', () => {
    const prompt = 'add tests';
    const analysis = analyzer.analyze(prompt);

    const repoContext = {
      rootDir: '/test',
      languages: { typescript: 10, javascript: 5 },
      configFiles: ['package.json', 'tsconfig.json'],
      repoMap: 'src/index.ts\nsrc/app.ts',
      totalFiles: 15,
    };

    const result = enhancer.enhance(prompt, analysis, [], repoContext);

    expect(result.repoContext).toContain('typescript');
    expect(result.repoContext).toContain('Repository Context');
  });

  it('should add CoT context for complex tasks', () => {
    const prompt = 'implement a full authentication system with OAuth, JWT refresh tokens, role-based access control, and comprehensive tests';
    const analysis = analyzer.analyze(prompt);

    const result = enhancer.enhance(prompt, analysis, [], null);

    // Complex tasks should have CoT reasoning
    expect(result.cotContext).toBeDefined();
    expect(result.cotContext.length).toBeGreaterThan(0);
  });
});
