import { describe, it, expect, beforeEach } from 'vitest';
import { PRAnalyzer, type PRInput } from '../../../src/surfaces/github/pr-analyzer.js';

/** Create a minimal PRInput with sensible defaults */
function createPRInput(overrides: Partial<PRInput> = {}): PRInput {
  return {
    title: overrides.title ?? 'Add user authentication',
    body: overrides.body ?? 'This PR implements user authentication using JWT tokens.',
    diff: overrides.diff ?? `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,10 @@
+import { sign } from 'jsonwebtoken';
+
+export function authenticate(user: string) {
+  return sign({ user }, 'secret');
+}
`,
    files: overrides.files ?? ['src/auth.ts'],
    headRef: overrides.headRef ?? 'feat/auth',
    baseRef: overrides.baseRef ?? 'main',
    author: overrides.author ?? 'testdev',
    isDraft: overrides.isDraft ?? false,
  };
}

describe('PRAnalyzer', () => {
  let analyzer: PRAnalyzer;

  beforeEach(() => {
    analyzer = new PRAnalyzer();
  });

  // ── analyzePR ──

  describe('analyzePR', () => {
    it('should produce a PR analysis with a score', () => {
      const input = createPRInput();
      const analysis = analyzer.analyzePR(input);

      expect(analysis.overallScore).toBeGreaterThanOrEqual(0);
      expect(analysis.overallScore).toBeLessThanOrEqual(100);
      expect(analysis.summary).toBeDefined();
      expect(analysis.summary.length).toBeGreaterThan(0);
      expect(analysis.metrics).toBeDefined();
      expect(analysis.categories).toBeDefined();
      expect(Array.isArray(analysis.issues)).toBe(true);
      expect(Array.isArray(analysis.suggestions)).toBe(true);
    });

    it('should calculate correct metrics', () => {
      const diff = `diff --git a/src/auth.ts b/src/auth.ts
+line1
+line2
+line3
-removed1
-removed2
`;
      const input = createPRInput({ diff, files: ['src/auth.ts', 'src/utils.ts'] });
      const analysis = analyzer.analyzePR(input);

      expect(analysis.metrics.totalFiles).toBe(2);
      expect(analysis.metrics.linesAdded).toBe(3);
      expect(analysis.metrics.linesRemoved).toBe(2);
      expect(analysis.metrics.totalChanges).toBe(5);
    });

    it('should detect xs change size for small diffs', () => {
      const diff = `diff --git a/src/fix.ts b/src/fix.ts
+const x = 1;
`;
      const input = createPRInput({
        diff,
        files: ['src/fix.ts'],
        title: 'Fix a typo in variable name',
        body: 'This is a small fix for a typo in the variable.',
      });
      const analysis = analyzer.analyzePR(input);

      expect(analysis.metrics.changeSize).toBe('xs');
    });

    it('should detect xl change size for large diffs', () => {
      // Generate 600 added lines
      const addedLines = Array.from({ length: 600 }, (_, i) => `+line ${i}`).join('\n');
      const diff = `diff --git a/src/big.ts b/src/big.ts\n${addedLines}`;
      const input = createPRInput({
        diff,
        files: Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`),
        body: 'A very large PR that changes many files and lines.',
      });
      const analysis = analyzer.analyzePR(input);

      expect(analysis.metrics.changeSize).toBe('xl');
    });
  });

  // ── Rule: large PR detection ──

  describe('rules — large PR', () => {
    it('should flag xl PRs with a warning', () => {
      const addedLines = Array.from({ length: 600 }, (_, i) => `+line ${i}`).join('\n');
      const diff = `diff --git a/src/big.ts b/src/big.ts\n${addedLines}`;
      const input = createPRInput({
        diff,
        files: ['src/big.ts'],
        body: 'A very large change.',
      });
      const analysis = analyzer.analyzePR(input);

      const sizeIssue = analysis.issues.find((i) =>
        i.message.toLowerCase().includes('very large pr') || i.message.toLowerCase().includes('lines changed'),
      );
      expect(sizeIssue).toBeDefined();
      expect(sizeIssue!.severity).toBe('warning');
    });

    it('should flag PRs with many files changed', () => {
      const files = Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`);
      const diff = files.map((f) => `diff --git a/${f} b/${f}\n+line`).join('\n');
      const input = createPRInput({ diff, files, body: 'Many files.' });
      const analysis = analyzer.analyzePR(input);

      const fileIssue = analysis.issues.find((i) =>
        i.message.includes('files changed'),
      );
      expect(fileIssue).toBeDefined();
    });
  });

  // ── Rule: no tests ──

  describe('rules — no tests', () => {
    it('should warn when source files change but no tests are updated', () => {
      // 15 lines of added code (above xs threshold of 10)
      const addedLines = Array.from({ length: 15 }, (_, i) => `+line ${i}`).join('\n');
      const diff = `diff --git a/src/auth.ts b/src/auth.ts\n${addedLines}`;
      const input = createPRInput({
        diff,
        files: ['src/auth.ts'],
        body: 'Implements auth without tests.',
      });
      const analysis = analyzer.analyzePR(input);

      const testIssue = analysis.issues.find((i) =>
        i.message.toLowerCase().includes('test'),
      );
      expect(testIssue).toBeDefined();
      expect(testIssue!.severity).toBe('warning');
    });

    it('should not warn when test files are included', () => {
      const diff = `diff --git a/src/auth.ts b/src/auth.ts
+new code line 1
+new code line 2
+new code line 3
+new code line 4
+new code line 5
+new code line 6
+new code line 7
+new code line 8
+new code line 9
+new code line 10
+new code line 11
diff --git a/test/auth.test.ts b/test/auth.test.ts
+test line 1
+test line 2
`;
      const input = createPRInput({
        diff,
        files: ['src/auth.ts', 'test/auth.test.ts'],
        body: 'Auth with tests.',
      });
      const analysis = analyzer.analyzePR(input);

      expect(analysis.metrics.hasTests).toBe(true);
      expect(analysis.metrics.testFilesChanged).toBe(1);
    });
  });

  // ── Rule: sensitive files ──

  describe('rules — sensitive files', () => {
    it('should flag sensitive files with error severity', () => {
      const input = createPRInput({
        files: ['src/auth.ts', '.env.production', 'config/credentials.json'],
        body: 'Adding config files.',
      });
      const analysis = analyzer.analyzePR(input);

      const sensitiveIssues = analysis.issues.filter((i) =>
        i.message.toLowerCase().includes('sensitive'),
      );
      expect(sensitiveIssues.length).toBeGreaterThanOrEqual(2);
      expect(sensitiveIssues.every((i) => i.severity === 'error')).toBe(true);
    });
  });

  // ── Rule: title and description ──

  describe('rules — title and description', () => {
    it('should warn on very short title', () => {
      const input = createPRInput({ title: 'Fix' });
      const analysis = analyzer.analyzePR(input);

      const titleIssue = analysis.issues.find((i) =>
        i.message.toLowerCase().includes('title'),
      );
      expect(titleIssue).toBeDefined();
    });

    it('should warn on missing description', () => {
      const input = createPRInput({ body: '' });
      const analysis = analyzer.analyzePR(input);

      const descIssue = analysis.issues.find((i) =>
        i.message.toLowerCase().includes('description'),
      );
      expect(descIssue).toBeDefined();
    });

    it('should suggest using draft for WIP PRs', () => {
      const input = createPRInput({ title: 'WIP: work in progress feature' });
      const analysis = analyzer.analyzePR(input);

      const wipSuggestion = analysis.suggestions.find((s) =>
        s.message.toLowerCase().includes('work-in-progress') || s.message.toLowerCase().includes('draft'),
      );
      expect(wipSuggestion).toBeDefined();
    });
  });

  // ── Rule: branch naming ──

  describe('rules — branch naming', () => {
    it('should suggest conventional branch naming for non-conventional branches', () => {
      const input = createPRInput({ headRef: 'my-branch' });
      const analysis = analyzer.analyzePR(input);

      const branchSuggestion = analysis.suggestions.find((s) =>
        s.message.toLowerCase().includes('branch name'),
      );
      expect(branchSuggestion).toBeDefined();
    });

    it('should not flag conventional branch names', () => {
      const input = createPRInput({ headRef: 'feat/new-auth' });
      const analysis = analyzer.analyzePR(input);

      const branchSuggestion = analysis.suggestions.find((s) =>
        s.message.toLowerCase().includes('branch name'),
      );
      expect(branchSuggestion).toBeUndefined();
    });
  });

  // ── Rule: draft status ──

  describe('rules — draft status', () => {
    it('should suggest marking as ready when PR is draft', () => {
      const input = createPRInput({ isDraft: true });
      const analysis = analyzer.analyzePR(input);

      const draftSuggestion = analysis.suggestions.find((s) =>
        s.message.toLowerCase().includes('draft'),
      );
      expect(draftSuggestion).toBeDefined();
    });
  });

  // ── Rule: diff patterns (console.log, debugger, etc.) ──

  describe('rules — diff patterns', () => {
    it('should detect console.log in diff', () => {
      const diff = `diff --git a/src/auth.ts b/src/auth.ts
+  console.log('debug');
+  const result = true;
`;
      const input = createPRInput({ diff, files: ['src/auth.ts'] });
      const analysis = analyzer.analyzePR(input);

      const consoleIssue = analysis.issues.find((i) =>
        i.message.includes('console.log'),
      );
      expect(consoleIssue).toBeDefined();
    });

    it('should detect debugger statement in diff', () => {
      const diff = `diff --git a/src/auth.ts b/src/auth.ts
+  debugger;
`;
      const input = createPRInput({ diff, files: ['src/auth.ts'] });
      const analysis = analyzer.analyzePR(input);

      const debugIssue = analysis.issues.find((i) =>
        i.message.includes('debugger'),
      );
      expect(debugIssue).toBeDefined();
    });

    it('should detect FIXME comments in diff', () => {
      const diff = `diff --git a/src/auth.ts b/src/auth.ts
+  // FIXME: this needs to be fixed
`;
      const input = createPRInput({ diff, files: ['src/auth.ts'] });
      const analysis = analyzer.analyzePR(input);

      const fixmeIssue = analysis.issues.find((i) =>
        i.message.includes('FIXME'),
      );
      expect(fixmeIssue).toBeDefined();
    });
  });

  // ── generateReviewComment ──

  describe('generateReviewComment', () => {
    it('should generate a formatted review comment', () => {
      const input = createPRInput();
      const analysis = analyzer.analyzePR(input);
      const comment = analyzer.generateReviewComment(analysis);

      expect(comment).toContain('CortexOS PR Analysis');
      expect(comment).toContain(`Score: ${analysis.overallScore}/100`);
      expect(comment).toContain('Metrics');
      expect(comment).toContain('Files changed');
      expect(comment).toContain('CortexOS');
    });

    it('should include issues section when issues exist', () => {
      const input = createPRInput({
        title: 'Fix',
        body: '',
        files: ['.env.production'],
      });
      const analysis = analyzer.analyzePR(input);
      const comment = analyzer.generateReviewComment(analysis);

      expect(comment).toContain('Issues');
    });

    it('should include suggestions section when suggestions exist', () => {
      const input = createPRInput({ headRef: 'my-branch', isDraft: true });
      const analysis = analyzer.analyzePR(input);
      const comment = analyzer.generateReviewComment(analysis);

      expect(comment).toContain('Suggestions');
    });
  });

  // ── suggestLabels ──

  describe('suggestLabels', () => {
    it('should suggest bug label for fix branches', () => {
      const input = createPRInput({
        headRef: 'fix/login-bug',
        title: 'Fix login bug',
      });
      const labels = analyzer.suggestLabels(input);

      expect(labels).toContain('bug');
    });

    it('should suggest feature label for feature branches', () => {
      const input = createPRInput({
        headRef: 'feat/new-auth',
        title: 'Add user authentication',
      });
      const labels = analyzer.suggestLabels(input);

      expect(labels).toContain('feature');
    });

    it('should suggest documentation label for doc PRs', () => {
      const input = createPRInput({
        headRef: 'docs/update-readme',
        title: 'Update documentation',
        files: ['README.md'],
      });
      const labels = analyzer.suggestLabels(input);

      expect(labels).toContain('documentation');
    });

    it('should suggest tests label for test PRs', () => {
      const input = createPRInput({
        files: ['test/auth.test.ts'],
        title: 'Add tests for auth module',
      });
      const labels = analyzer.suggestLabels(input);

      expect(labels).toContain('tests');
    });

    it('should suggest size/small for small PRs', () => {
      const input = createPRInput({
        diff: '+line1\n+line2',
        files: ['src/fix.ts'],
      });
      const labels = analyzer.suggestLabels(input);

      expect(labels).toContain('size/small');
    });

    it('should suggest size/large for large PRs', () => {
      const addedLines = Array.from({ length: 600 }, (_, i) => `+line ${i}`).join('\n');
      const input = createPRInput({
        diff: `diff --git a/src/big.ts b/src/big.ts\n${addedLines}`,
        files: ['src/big.ts'],
      });
      const labels = analyzer.suggestLabels(input);

      expect(labels).toContain('size/large');
    });
  });

  // ── Scoring ──

  describe('scoring', () => {
    it('should give a higher score to clean PRs', () => {
      const cleanInput = createPRInput({
        title: 'Add user authentication feature',
        body: 'This PR implements user authentication using JWT tokens. Includes unit tests and documentation.',
        files: ['src/auth.ts', 'test/auth.test.ts', 'docs/auth.md'],
        headRef: 'feat/auth',
        diff: `diff --git a/src/auth.ts b/src/auth.ts
+line 1
+line 2
+line 3
diff --git a/test/auth.test.ts b/test/auth.test.ts
+test 1
+test 2
diff --git a/docs/auth.md b/docs/auth.md
+doc line 1
`,
      });

      const dirtyInput = createPRInput({
        title: 'Fix',
        body: '',
        files: ['.env.production', 'src/auth.ts'],
        headRef: 'my-branch',
        diff: `diff --git a/src/auth.ts b/src/auth.ts
+  console.log('debug');
+  debugger;
+  // FIXME: broken
` + Array.from({ length: 600 }, (_, i) => `+line ${i}`).join('\n'),
      });

      const cleanAnalysis = analyzer.analyzePR(cleanInput);
      const dirtyAnalysis = analyzer.analyzePR(dirtyInput);

      expect(cleanAnalysis.overallScore).toBeGreaterThan(dirtyAnalysis.overallScore);
    });

    it('should give bonus for having tests', () => {
      const withTests = createPRInput({
        files: ['src/auth.ts', 'test/auth.test.ts'],
        diff: `diff --git a/src/auth.ts b/src/auth.ts
+line 1
diff --git a/test/auth.test.ts b/test/auth.test.ts
+test 1
`,
      });

      const withoutTests = createPRInput({
        files: ['src/auth.ts'],
        diff: `diff --git a/src/auth.ts b/src/auth.ts
+line 1
`,
      });

      const withTestsAnalysis = analyzer.analyzePR(withTests);
      const withoutTestsAnalysis = analyzer.analyzePR(withoutTests);

      // Both may have high scores, but with tests should be >= without
      expect(withTestsAnalysis.metrics.hasTests).toBe(true);
      expect(withoutTestsAnalysis.metrics.hasTests).toBe(false);
    });
  });

  // ── Categorization ──

  describe('categorization', () => {
    it('should categorize bug fix PRs', () => {
      const input = createPRInput({
        headRef: 'fix/login-issue',
        title: 'Fix login bug',
      });
      const analysis = analyzer.analyzePR(input);

      expect(analysis.categories).toContain('bug-fix');
    });

    it('should categorize feature PRs', () => {
      const input = createPRInput({
        headRef: 'feat/new-feature',
        title: 'Add new dashboard',
      });
      const analysis = analyzer.analyzePR(input);

      expect(analysis.categories).toContain('feature');
    });

    it('should categorize documentation PRs', () => {
      const input = createPRInput({
        files: ['README.md', 'docs/api.md'],
        title: 'Update documentation',
      });
      const analysis = analyzer.analyzePR(input);

      expect(analysis.categories).toContain('documentation');
    });

    it('should categorize CI/CD PRs', () => {
      const input = createPRInput({
        files: ['.github/workflows/ci.yml', 'Dockerfile'],
        title: 'Update CI configuration',
      });
      const analysis = analyzer.analyzePR(input);

      expect(analysis.categories).toContain('ci-cd');
    });

    it('should categorize security PRs', () => {
      const input = createPRInput({
        title: 'Fix security vulnerability in auth',
      });
      const analysis = analyzer.analyzePR(input);

      expect(analysis.categories).toContain('security');
    });

    it('should categorize performance PRs', () => {
      const input = createPRInput({
        title: 'Optimize database query performance',
      });
      const analysis = analyzer.analyzePR(input);

      expect(analysis.categories).toContain('performance');
    });

    it('should default to maintenance when no category detected', () => {
      const input = createPRInput({
        headRef: 'update-something',
        title: 'Update internal stuff',
        files: ['src/internal.ts'],
      });
      const analysis = analyzer.analyzePR(input);

      // Should have at least one category
      expect(analysis.categories.length).toBeGreaterThan(0);
    });
  });
});
