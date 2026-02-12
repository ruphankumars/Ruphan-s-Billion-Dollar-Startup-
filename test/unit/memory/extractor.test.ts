import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryExtractor } from '../../../src/memory/pipeline/extractor.js';
import type { AgentResult } from '../../../src/core/types.js';

describe('MemoryExtractor', () => {
  let extractor: MemoryExtractor;

  beforeEach(() => {
    extractor = new MemoryExtractor();
  });

  function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
    return {
      taskId: 'task-1',
      success: true,
      response: 'Completed the task successfully.',
      ...overrides,
    };
  }

  describe('extractFromResult', () => {
    it('should extract episodic memory with type episodic', () => {
      const result = makeResult();
      const memories = extractor.extractFromResult(result);

      const episodic = memories.find(m => m.options.type === 'episodic');
      expect(episodic).toBeDefined();
      expect(episodic!.options.type).toBe('episodic');
      expect(episodic!.content).toContain('succeeded');
    });

    it('should assign higher importance (0.8) to failed results', () => {
      const result = makeResult({
        success: false,
        response: 'Task failed due to compilation errors.',
      });
      const memories = extractor.extractFromResult(result);

      const episodic = memories.find(m => m.options.type === 'episodic');
      expect(episodic).toBeDefined();
      expect(episodic!.options.importance).toBe(0.8);
      expect(episodic!.content).toContain('failed');
    });

    it('should include file count in episodic memory when files changed', () => {
      const result = makeResult({
        filesChanged: [
          { path: 'src/index.ts', type: 'modify' },
          { path: 'src/utils.ts', type: 'create' },
        ],
      });
      const memories = extractor.extractFromResult(result);

      const episodic = memories.find(m => m.options.type === 'episodic');
      expect(episodic).toBeDefined();
      expect(episodic!.content).toContain('2 files');
    });

    it('should extract semantic memories from file path mentions', () => {
      const result = makeResult({
        response: 'I found src/index.ts and modified it to fix the bug.',
      });
      const memories = extractor.extractFromResult(result);

      const semantic = memories.filter(m => m.options.type === 'semantic');
      const fileMem = semantic.find(m => m.content.includes('src/index.ts'));
      expect(fileMem).toBeDefined();
      expect(fileMem!.options.tags).toContain('files');
    });

    it('should extract semantic memories from technology mentions', () => {
      const result = makeResult({
        response: 'The project uses React for the frontend.',
      });
      const memories = extractor.extractFromResult(result);

      const semantic = memories.filter(m => m.options.type === 'semantic');
      const techMem = semantic.find(m => m.content.includes('React'));
      expect(techMem).toBeDefined();
      expect(techMem!.options.tags).toContain('technology');
    });

    it('should extract error patterns on failure', () => {
      const result = makeResult({
        success: false,
        response: 'Failed to compile.',
        error: 'TypeError: Cannot read property of undefined',
      });
      const memories = extractor.extractFromResult(result);

      const errorMem = memories.find(
        m => m.options.type === 'semantic' && m.options.tags?.includes('error'),
      );
      expect(errorMem).toBeDefined();
      expect(errorMem!.content).toContain('TypeError');
      expect(errorMem!.options.importance).toBe(0.9);
    });

    it('should extract procedural memories only on success', () => {
      const successResult = makeResult({
        success: true,
        filesChanged: [{ path: 'src/app.ts', type: 'modify' }],
      });
      const failResult = makeResult({
        success: false,
        filesChanged: [{ path: 'src/app.ts', type: 'modify' }],
      });

      const successMemories = extractor.extractFromResult(successResult);
      const failMemories = extractor.extractFromResult(failResult);

      const successProcedural = successMemories.filter(m => m.options.type === 'procedural');
      const failProcedural = failMemories.filter(m => m.options.type === 'procedural');

      expect(successProcedural.length).toBeGreaterThan(0);
      expect(failProcedural.length).toBe(0);
    });

    it('should include change types and file extensions in procedural memory', () => {
      const result = makeResult({
        success: true,
        filesChanged: [
          { path: 'src/index.ts', type: 'modify' },
          { path: 'src/new-file.tsx', type: 'create' },
        ],
      });
      const memories = extractor.extractFromResult(result);

      const procedural = memories.find(m => m.options.type === 'procedural');
      expect(procedural).toBeDefined();
      expect(procedural!.content).toContain('modify');
      expect(procedural!.content).toContain('create');
      expect(procedural!.content).toContain('.ts');
      expect(procedural!.content).toContain('.tsx');
    });

    it('should assign importance 0.5 to successful episodic memories', () => {
      const result = makeResult({ success: true });
      const memories = extractor.extractFromResult(result);

      const episodic = memories.find(m => m.options.type === 'episodic');
      expect(episodic!.options.importance).toBe(0.5);
    });
  });

  describe('extractFromFeedback', () => {
    it('should create high-importance (0.95) semantic memory', () => {
      const memories = extractor.extractFromFeedback(
        'Great work on the refactoring!',
        'Refactor authentication module',
      );

      expect(memories.length).toBeGreaterThan(0);
      const feedbackMem = memories[0];
      expect(feedbackMem.options.type).toBe('semantic');
      expect(feedbackMem.options.importance).toBe(0.95);
    });

    it('should include task description in the memory content', () => {
      const memories = extractor.extractFromFeedback(
        'Please use smaller functions next time.',
        'Implement user registration',
      );

      const feedbackMem = memories[0];
      expect(feedbackMem.content).toContain('Implement user registration');
      expect(feedbackMem.content).toContain('Please use smaller functions next time.');
    });
  });
});
