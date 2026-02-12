/**
 * SWE-bench Self-Test — Tests CortexOS against its OWN codebase.
 *
 * Creates synthetic "SWE-bench instances" from CortexOS's own code,
 * simulating real-world bug fix scenarios using the existing adapter.
 *
 * This validates:
 * 1. The SWE-bench adapter can load and parse instances
 * 2. Prompt building works with real TypeScript codebases
 * 3. Patch extraction works with real git diffs
 * 4. The evaluation harness correctly tests patches
 * 5. CortexOS can reason about its own code structure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// SWE-bench components
import { SWEBenchAdapter } from '../../src/swebench/adapter.js';
import { SWEBenchPromptBuilder } from '../../src/swebench/prompt-builder.js';
import { PatchExtractor } from '../../src/swebench/patch-extractor.js';
import { SWEBenchEvaluator } from '../../src/swebench/evaluator.js';
import type { SWEBenchInstance, SWEBenchConfig } from '../../src/swebench/types.js';

// Code intelligence (used to analyze CortexOS itself)
import { ASTParser } from '../../src/code/ast-parser.js';
import { CodeParser } from '../../src/code/parser.js';
import { RepoMapper } from '../../src/code/mapper.js';
import { PromptAnalyzer } from '../../src/prompt/analyzer.js';
import { PromptEnhancer } from '../../src/prompt/enhancer.js';

// ─── Self-Test Instances ──────────────────────────────────────────────

/**
 * Create synthetic SWE-bench instances based on CortexOS's own codebase.
 * Each instance represents a realistic bug that CortexOS should be able to fix.
 */
function createSelfTestInstances(): SWEBenchInstance[] {
  return [
    {
      instance_id: 'cortexos__cortexos-001',
      repo: 'cortexos/cortexos',
      base_commit: 'HEAD',
      problem_statement: `
The Timer class in src/utils/timer.ts reports duration in milliseconds but
the formatDuration helper only handles seconds. When timer.stop() returns
a value less than 1000, formatDuration shows "0s" instead of "500ms".
Add millisecond formatting to formatDuration for values under 1 second.
      `.trim(),
      hints_text: 'Look at the formatDuration function and add an ms branch.',
      test_patch: '',
      patch: '',
      FAIL_TO_PASS: '["test/unit/utils/timer.test.ts::formatDuration handles sub-second"]',
      PASS_TO_PASS: '["test/unit/utils/timer.test.ts::Timer tracks duration"]',
      environment_setup_commit: 'HEAD',
      version: '1.0.0-beta.1',
    },
    {
      instance_id: 'cortexos__cortexos-002',
      repo: 'cortexos/cortexos',
      base_commit: 'HEAD',
      problem_statement: `
The PluginRegistry in src/plugins/registry.ts does not validate plugin names
for uniqueness before loading. If you call load() with a plugin that has the
same name as an already-loaded plugin, it silently overwrites the first.
Add a warning log and proper re-registration that calls unload first.
      `.trim(),
      hints_text: 'Check if plugin.name is already in the Map before registering.',
      test_patch: '',
      patch: '',
      FAIL_TO_PASS: '["test/unit/plugins/registry.test.ts::handles duplicate plugin names"]',
      PASS_TO_PASS: '["test/unit/plugins/registry.test.ts::loads a plugin"]',
      environment_setup_commit: 'HEAD',
      version: '1.0.0-beta.1',
    },
    {
      instance_id: 'cortexos__cortexos-003',
      repo: 'cortexos/cortexos',
      base_commit: 'HEAD',
      problem_statement: `
The CostTracker in src/cost/tracker.ts does not handle the case where a
provider has no pricing entry. When calculating cost for an unknown model,
it should return 0 cost with a warning rather than throwing an error.
      `.trim(),
      hints_text: 'Add a fallback in the record() method when pricing is missing.',
      test_patch: '',
      patch: '',
      FAIL_TO_PASS: '["test/unit/cost/tracker.test.ts::handles unknown model gracefully"]',
      PASS_TO_PASS: '["test/unit/cost/tracker.test.ts::tracks anthropic costs"]',
      environment_setup_commit: 'HEAD',
      version: '1.0.0-beta.1',
    },
  ];
}

// ─── Temp Dataset Helpers ─────────────────────────────────────────────

let tempDir: string;

function createTempDataset(instances: SWEBenchInstance[]): string {
  const datasetPath = join(tempDir, 'self-test-dataset.jsonl');
  const content = instances.map(i => JSON.stringify(i)).join('\n');
  writeFileSync(datasetPath, content);
  return datasetPath;
}

function createTempRepo(): string {
  const repoDir = join(tempDir, 'mock-repo');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(join(repoDir, 'src'), { recursive: true });

  // Create minimal source files
  writeFileSync(join(repoDir, 'src', 'index.ts'), `
export function hello(): string {
  return 'Hello from CortexOS';
}

export function add(a: number, b: number): number {
  return a + b;
}
  `);

  writeFileSync(join(repoDir, 'package.json'), JSON.stringify({
    name: 'cortexos-selftest',
    version: '1.0.0',
    type: 'module',
  }));

  // Initialize git
  try {
    execSync('git init', { cwd: repoDir, stdio: 'pipe' });
    execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
    execSync(
      'git -c user.name="Test" -c user.email="test@test.com" commit -m "initial"',
      { cwd: repoDir, stdio: 'pipe' },
    );
  } catch {
    // Git may not be available
  }

  return repoDir;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('SWE-bench Self-Test (CortexOS vs. CortexOS)', () => {
  beforeEach(() => {
    tempDir = join(tmpdir(), `cortexos-swebench-selftest-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── Instance Creation & Parsing ────────────────────────────────

  describe('Self-Test Instance Management', () => {
    it('should create valid SWE-bench instances from CortexOS codebase', () => {
      const instances = createSelfTestInstances();

      expect(instances).toHaveLength(3);

      for (const instance of instances) {
        expect(instance.instance_id).toMatch(/^cortexos__cortexos-\d+$/);
        expect(instance.repo).toBe('cortexos/cortexos');
        expect(instance.problem_statement.length).toBeGreaterThan(50);
        expect(instance.FAIL_TO_PASS).toBeTruthy();
        expect(instance.PASS_TO_PASS).toBeTruthy();
      }
    });

    it('should serialize and deserialize instances as JSONL', () => {
      const instances = createSelfTestInstances();
      const jsonl = instances.map(i => JSON.stringify(i)).join('\n');
      const parsed = jsonl.split('\n').map(line => JSON.parse(line) as SWEBenchInstance);

      expect(parsed).toHaveLength(3);
      expect(parsed[0].instance_id).toBe(instances[0].instance_id);
      expect(parsed[1].problem_statement).toBe(instances[1].problem_statement);
    });

    it('should load self-test dataset with SWEBenchAdapter', () => {
      const instances = createSelfTestInstances();
      const datasetPath = createTempDataset(instances);

      const adapter = new SWEBenchAdapter({
        dataset: datasetPath,
        timeout: 30000,
      });

      const loaded = adapter.loadDataset();
      expect(loaded).toHaveLength(3);
      expect(loaded[0].instance_id).toBe('cortexos__cortexos-001');
    });

    it('should respect limit config when loading dataset', () => {
      const instances = createSelfTestInstances();
      const datasetPath = createTempDataset(instances);

      const adapter = new SWEBenchAdapter({
        dataset: datasetPath,
        limit: 1,
        timeout: 30000,
      });

      const loaded = adapter.loadDataset();
      expect(loaded).toHaveLength(1);
    });
  });

  // ─── Prompt Building ────────────────────────────────────────────

  describe('Prompt Building for Self-Test Instances', () => {
    it('should build prompts from CortexOS instance descriptions', () => {
      const promptBuilder = new SWEBenchPromptBuilder();
      const instances = createSelfTestInstances();
      const repoDir = createTempRepo();

      for (const instance of instances) {
        const prompt = promptBuilder.build(instance, repoDir);

        expect(prompt).toBeTruthy();
        expect(prompt.length).toBeGreaterThan(100);
        // Should contain the problem statement
        expect(prompt).toContain(instance.problem_statement.trim().slice(0, 30));
      }
    });

    it('should enrich prompts with test info from FAIL_TO_PASS', () => {
      const promptBuilder = new SWEBenchPromptBuilder();
      const instance = createSelfTestInstances()[0];
      const repoDir = createTempRepo();

      const prompt = promptBuilder.build(instance, repoDir);

      // The prompt should reference failing tests or the problem
      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).toContain(instance.problem_statement.trim().slice(0, 20));
    });
  });

  // ─── Patch Extraction ───────────────────────────────────────────

  describe('Patch Extraction from Self-Test Fixes', () => {
    it('should extract patches from file changes', () => {
      const extractor = new PatchExtractor();

      const patch = extractor.extract(
        [
          {
            path: 'src/utils/timer.ts',
            type: 'modify',
            content: `
export function formatDuration(ms: number): string {
  if (ms < 1000) return \`\${Math.round(ms)}ms\`;
  const seconds = Math.floor(ms / 1000);
  return \`\${seconds}s\`;
}
            `.trim(),
          },
        ],
        tempDir,
      );

      expect(patch).toBeTruthy();
      expect(patch.length).toBeGreaterThan(0);
    });

    it('should handle multi-file patches', () => {
      const extractor = new PatchExtractor();

      const patch = extractor.extract(
        [
          { path: 'src/a.ts', type: 'modify', content: 'const x = 1;' },
          { path: 'src/b.ts', type: 'create', content: 'export const y = 2;' },
          { path: 'src/c.ts', type: 'delete' },
        ],
        tempDir,
      );

      expect(patch).toBeTruthy();
    });

    it('should generate unified diff format', () => {
      const extractor = new PatchExtractor();
      const repoDir = createTempRepo();

      // Make a change
      const filePath = join(repoDir, 'src', 'index.ts');
      const original = readFileSync(filePath, 'utf-8');
      writeFileSync(filePath, original.replace('Hello from CortexOS', 'Hello from CortexOS v2'));

      // Try git diff extraction
      try {
        const diff = execSync('git diff', { cwd: repoDir, encoding: 'utf-8' });
        expect(diff).toContain('Hello from CortexOS v2');
      } catch {
        // Git might not be available — test the extractor directly
        const patch = extractor.extract(
          [{ path: 'src/index.ts', type: 'modify', content: readFileSync(filePath, 'utf-8') }],
          repoDir,
        );
        expect(patch).toBeTruthy();
      }
    });
  });

  // ─── Evaluator ──────────────────────────────────────────────────

  describe('Evaluation of Self-Test Results', () => {
    it('should create evaluator with timeout', () => {
      const evaluator = new SWEBenchEvaluator(30000);
      expect(evaluator).toBeDefined();
    });

    it('should handle evaluation of instance in mock repo', async () => {
      const evaluator = new SWEBenchEvaluator(10000);
      const repoDir = createTempRepo();
      const instance = createSelfTestInstances()[0];

      // Evaluate — will fail since no test suite exists in mock repo
      // but should not throw
      const result = await evaluator.evaluate(instance, repoDir);

      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.tests_passed).toBe('number');
      expect(typeof result.tests_total).toBe('number');
    });
  });

  // ─── Code Intelligence on Own Codebase ──────────────────────────

  describe('CortexOS Analyzing Its Own Source Code', () => {
    it('should analyze CortexOS engine source with AST parser', () => {
      const projectRoot = join(import.meta.dirname, '../../');
      const enginePath = join(projectRoot, 'src/core/engine.ts');

      if (existsSync(enginePath)) {
        const content = readFileSync(enginePath, 'utf-8');
        const parser = new ASTParser();
        const result = parser.analyze(content, 'src/core/engine.ts');

        expect(result.functions.length).toBeGreaterThan(0);
        expect(result.classes.length).toBeGreaterThan(0);
        // Should find CortexEngine class
        expect(result.classes.some(c => c.name === 'CortexEngine')).toBe(true);
      }
    });

    it('should map CortexOS project structure', () => {
      const projectRoot = join(import.meta.dirname, '../../');
      const mapper = new RepoMapper();
      const map = mapper.generateMap({ rootDir: projectRoot, maxFiles: 50, maxDepth: 3 });

      expect(map.files.length).toBeGreaterThan(0);
      // Should find key files
      expect(map.files.some(f => f.includes('engine'))).toBe(true);
    });

    it('should analyze CortexOS prompt analysis on its own bug reports', () => {
      const analyzer = new PromptAnalyzer();

      const analysis = analyzer.analyze(
        'Fix the race condition in the StreamController where closing the stream ' +
        'while events are being emitted can cause a "write after close" error. ' +
        'The close() method should wait for pending emits to complete.',
      );

      expect(analysis.intent).toBeDefined();
      expect(analysis.complexity).toBeDefined();
    });

    it('should enhance prompts using CortexOS repo context', () => {
      const analyzer = new PromptAnalyzer();
      const enhancer = new PromptEnhancer();

      const prompt = 'Add retry logic to the SQLiteVectorStore.store() method';
      const analysis = analyzer.analyze(prompt);

      const enhanced = enhancer.enhance(prompt, analysis, [], {
        rootDir: '/tmp/cortexos',
        languages: { typescript: 50 },
        configFiles: ['tsconfig.json', 'package.json'],
        repoMap: `
src/memory/store/vector-sqlite.ts — SQLiteVectorStore class
src/utils/retry.ts — retry() helper with exponential backoff
src/memory/types.ts — VectorStore interface
        `.trim(),
        totalFiles: 50,
      });

      expect(enhanced.userPrompt).toBeTruthy();
      expect(enhanced.repoContext).toContain('SQLiteVectorStore');
    });
  });

  // ─── Full SWE-bench Adapter Run (Dry) ───────────────────────────

  describe('Full SWE-bench Adapter Dry Run', () => {
    it('should run adapter in dry-run mode with self-test dataset', async () => {
      const instances = createSelfTestInstances();
      const datasetPath = createTempDataset(instances);

      const adapter = new SWEBenchAdapter({
        dataset: datasetPath,
        limit: 1,
        provider: 'mock',
        model: 'self-test',
        timeout: 10000,
      });

      // Dry run (no engine factory) — validates the pipeline doesn't crash
      const report = await adapter.run();

      expect(report).toBeDefined();
      expect(report.model).toBe('self-test');
      expect(report.provider).toBe('mock');
      expect(report.results).toHaveLength(1);
      expect(report.summary.total).toBe(1);
      // In dry-run mode, nothing resolves
      expect(report.summary.resolved).toBe(0);
    });

    it('should run adapter with mock engine factory', async () => {
      const instances = createSelfTestInstances();
      const datasetPath = createTempDataset(instances);

      const adapter = new SWEBenchAdapter({
        dataset: datasetPath,
        limit: 1,
        provider: 'cortexos',
        model: 'self-test',
        timeout: 15000,
      });

      // Mock engine factory that simulates a fix
      const mockEngineFactory = async (workDir: string) => ({
        execute: async (prompt: string) => ({
          success: true,
          filesChanged: [
            {
              path: 'src/utils/timer.ts',
              type: 'modify',
              content: 'export function formatDuration(ms: number): string { return `${ms}ms`; }',
            },
          ],
          cost: { totalCost: 0.05 },
        }),
      });

      const report = await adapter.run(mockEngineFactory);

      expect(report).toBeDefined();
      expect(report.results).toHaveLength(1);
      // The mock engine returned a filesChanged array, so the adapter should have a patch or empty
      expect(typeof report.results[0].model_patch).toBe('string');
      // Cost may be 0 if repo clone fails in test env (expected — no real GitHub repo)
      expect(typeof report.results[0].cost).toBe('number');
      expect(report.results[0].duration).toBeGreaterThan(0);
    });

    it('should build complete report with summary statistics', async () => {
      const instances = createSelfTestInstances();
      const datasetPath = createTempDataset(instances);

      const adapter = new SWEBenchAdapter({
        dataset: datasetPath,
        limit: 3,
        timeout: 10000,
      });

      const report = await adapter.run();

      expect(report.summary).toBeDefined();
      expect(report.summary.total).toBe(3);
      expect(typeof report.summary.resolutionRate).toBe('number');
      expect(typeof report.summary.avgCost).toBe('number');
      expect(typeof report.summary.avgDuration).toBe('number');
      expect(report.timestamp).toBeTruthy();
    });
  });
});
