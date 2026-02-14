import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CriticAgent } from '../../../src/daemon/critic-agent.js';

describe('CriticAgent', () => {
  let critic: CriticAgent;

  beforeEach(() => {
    critic = new CriticAgent();
  });

  describe('Static detectHardcodedSecrets()', () => {
    it('finds API keys', () => {
      const content = `const key = "sk-proj-abcdefghijklmnopqrstuvwxyz1234";`;
      const issues = CriticAgent.detectHardcodedSecrets(content, 'test.ts');

      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].severity).toBe('critical');
      expect(issues[0].category).toBe('security');
      expect(issues[0].file).toBe('test.ts');
    });

    it('finds private keys', () => {
      const content = `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWep4P...`;
      const issues = CriticAgent.detectHardcodedSecrets(content, 'key.pem');

      expect(issues.length).toBeGreaterThan(0);
      const privateKeyIssue = issues.find((i) =>
        i.message.includes('Private key'),
      );
      expect(privateKeyIssue).toBeDefined();
      expect(privateKeyIssue!.severity).toBe('critical');
    });

    it('finds passwords', () => {
      const content = `const config = { password: "mySecretPassword123" };`;
      const issues = CriticAgent.detectHardcodedSecrets(content, 'config.ts');

      expect(issues.length).toBeGreaterThan(0);
      const passwordIssue = issues.find((i) =>
        i.message.toLowerCase().includes('password'),
      );
      expect(passwordIssue).toBeDefined();
    });

    it('returns no issues for clean code', () => {
      const content = `const name = "Hello World";\nconst count = 42;`;
      const issues = CriticAgent.detectHardcodedSecrets(content, 'clean.ts');

      expect(issues).toEqual([]);
    });

    it('finds AWS access key IDs', () => {
      const content = `const awsKey = "AKIAIOSFODNN7EXAMPLE";`;
      const issues = CriticAgent.detectHardcodedSecrets(content, 'aws.ts');

      expect(issues.length).toBeGreaterThan(0);
      const awsIssue = issues.find((i) => i.message.includes('AWS'));
      expect(awsIssue).toBeDefined();
    });

    it('finds GitHub tokens', () => {
      const content = `const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";`;
      const issues = CriticAgent.detectHardcodedSecrets(content, 'gh.ts');

      expect(issues.length).toBeGreaterThan(0);
      const ghIssue = issues.find((i) => i.message.includes('GitHub'));
      expect(ghIssue).toBeDefined();
    });
  });

  describe('Static detectLargeFiles()', () => {
    it('warns on big files', () => {
      const bigContent = Array(15001).fill('// line of code').join('\n');
      const files = [{ path: 'big-file.ts', content: bigContent }];

      const issues = CriticAgent.detectLargeFiles(files);
      expect(issues.length).toBe(1);
      expect(issues[0].severity).toBe('medium');
      expect(issues[0].category).toBe('quality');
      expect(issues[0].file).toBe('big-file.ts');
      expect(issues[0].message).toContain('15001');
    });

    it('does not warn on small files', () => {
      const smallContent = Array(100).fill('// line of code').join('\n');
      const files = [{ path: 'small-file.ts', content: smallContent }];

      const issues = CriticAgent.detectLargeFiles(files);
      expect(issues).toEqual([]);
    });

    it('respects custom threshold', () => {
      const content = Array(51).fill('// line of code').join('\n');
      const files = [{ path: 'medium.ts', content }];

      const issues = CriticAgent.detectLargeFiles(files, 50);
      expect(issues.length).toBe(1);
    });
  });

  describe('Static detectTodoFixme()', () => {
    it('finds TODO comments', () => {
      const content = `// TODO: Implement this function\nfunction test() {}`;
      const issues = CriticAgent.detectTodoFixme(content, 'todo.ts');

      expect(issues.length).toBe(1);
      expect(issues[0].severity).toBe('low');
      expect(issues[0].category).toBe('quality');
      expect(issues[0].message).toContain('TODO');
      expect(issues[0].line).toBe(1);
    });

    it('finds FIXME comments', () => {
      const content = `function buggy() {\n  // FIXME: This causes crashes\n  return null;\n}`;
      const issues = CriticAgent.detectTodoFixme(content, 'fixme.ts');

      expect(issues.length).toBe(1);
      expect(issues[0].severity).toBe('medium');
      expect(issues[0].message).toContain('FIXME');
      expect(issues[0].line).toBe(2);
    });

    it('finds HACK comments', () => {
      const content = `// HACK: Workaround for upstream bug`;
      const issues = CriticAgent.detectTodoFixme(content, 'hack.ts');

      expect(issues.length).toBe(1);
      expect(issues[0].severity).toBe('medium');
      expect(issues[0].message).toContain('HACK');
    });

    it('finds XXX comments with high severity', () => {
      const content = `// XXX: Critical issue here`;
      const issues = CriticAgent.detectTodoFixme(content, 'xxx.ts');

      expect(issues.length).toBe(1);
      expect(issues[0].severity).toBe('high');
    });

    it('returns empty for clean code', () => {
      const content = `function clean() { return 42; }`;
      const issues = CriticAgent.detectTodoFixme(content, 'clean.ts');

      expect(issues).toEqual([]);
    });
  });

  describe('Static detectComplexity()', () => {
    it('finds deeply nested code', () => {
      const content = `function deep() {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          if (e) {
            return true;
          }
        }
      }
    }
  }
}`;
      const issues = CriticAgent.detectComplexity(content, 'complex.ts');

      const nestingIssue = issues.find((i) =>
        i.message.includes('nesting depth'),
      );
      expect(nestingIssue).toBeDefined();
      expect(nestingIssue!.severity).toBe('medium');
      expect(nestingIssue!.category).toBe('quality');
    });

    it('does not flag shallow code', () => {
      const content = `function simple() {\n  if (a) {\n    return true;\n  }\n  return false;\n}`;
      const issues = CriticAgent.detectComplexity(content, 'simple.ts');

      const nestingIssue = issues.find((i) =>
        i.message.includes('nesting depth'),
      );
      expect(nestingIssue).toBeUndefined();
    });
  });

  describe('review()', () => {
    it('produces a CriticReport', async () => {
      const context = {
        files: [
          {
            path: 'test.ts',
            content: `const key = "sk-proj-abcdefghijklmnopqrstuvwxyz1234";\n// TODO: Fix this\nfunction test() { return 1; }`,
          },
        ],
        taskId: 'task-123',
      };

      const report = await critic.review(context);

      expect(report).toBeDefined();
      expect(report.id).toBeDefined();
      expect(report.taskId).toBe('task-123');
      expect(typeof report.timestamp).toBe('number');
      expect(['pass', 'warn', 'fail']).toContain(report.verdict);
      expect(typeof report.confidence).toBe('number');
      expect(report.confidence).toBeGreaterThanOrEqual(0);
      expect(report.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(report.issues)).toBe(true);
      expect(report.issues.length).toBeGreaterThan(0);
      expect(Array.isArray(report.suggestions)).toBe(true);
      expect(typeof report.duration).toBe('number');
    });

    it('emits review:complete event', async () => {
      const emitSpy = vi.fn();
      critic.on('review:complete', emitSpy);

      await critic.review({
        files: [{ path: 'clean.ts', content: 'const x = 1;' }],
      });

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getReviewCount() and getAverageConfidence()', () => {
    it('starts at 0', () => {
      expect(critic.getReviewCount()).toBe(0);
      expect(critic.getAverageConfidence()).toBe(0);
    });

    it('updates after reviews', async () => {
      await critic.review({
        files: [{ path: 'a.ts', content: 'const x = 1;' }],
      });
      await critic.review({
        files: [{ path: 'b.ts', content: 'const y = 2;' }],
      });

      expect(critic.getReviewCount()).toBe(2);
      expect(critic.getAverageConfidence()).toBeGreaterThan(0);
      expect(critic.getAverageConfidence()).toBeLessThanOrEqual(1);
    });
  });
});
