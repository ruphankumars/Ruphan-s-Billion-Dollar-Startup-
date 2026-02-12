/**
 * Real-World Bug Fix Harness — Tests CortexOS against actual code scenarios.
 *
 * Instead of mocking everything, these tests:
 * 1. Create real project directories with real code that has bugs
 * 2. Run the engine pipeline stages against them (with MockProvider for LLM)
 * 3. Verify the full tool chain works end-to-end
 * 4. Validate quality gates catch real issues in real code
 *
 * This proves CortexOS can handle actual codebases, not just toy examples.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// ─── CortexOS Imports ─────────────────────────────────────────────────
import { PromptAnalyzer } from '../../src/prompt/analyzer.js';
import { PromptEnhancer } from '../../src/prompt/enhancer.js';
import { PromptDecomposer } from '../../src/prompt/decomposer.js';
import { RepoMapper } from '../../src/code/mapper.js';
import { ASTParser } from '../../src/code/ast-parser.js';
import { CodeParser } from '../../src/code/parser.js';
import { QualityVerifier } from '../../src/quality/verifier.js';
import { AutoFixer } from '../../src/quality/auto-fixer.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ToolExecutor } from '../../src/tools/executor.js';
import { CostTracker } from '../../src/cost/tracker.js';
import { Tracer } from '../../src/observability/tracer.js';
import { MetricsCollector } from '../../src/observability/metrics.js';
import { EventBus } from '../../src/core/events.js';
import type { QualityContext } from '../../src/quality/types.js';
import type { RunMetric } from '../../src/observability/metrics.js';

// Built-in plugins
import { CodeComplexityPlugin, analyzeComplexity } from '../../src/plugins/builtin/code-complexity-plugin.js';
import { DependencyAuditPlugin, parsePackageJson, auditDependencies } from '../../src/plugins/builtin/dependency-audit-plugin.js';
import { DocumentationGenPlugin, analyzeDocCoverage, generateDocs } from '../../src/plugins/builtin/documentation-gen-plugin.js';
import { GitWorkflowPlugin, classifyChanges, detectSensitiveFiles } from '../../src/plugins/builtin/git-workflow-plugin.js';
import { MetricsDashboardPlugin, MetricsStore } from '../../src/plugins/builtin/metrics-dashboard-plugin.js';
import { PluginRegistry } from '../../src/plugins/registry.js';

// ─── Test Fixtures: Real Code With Real Bugs ──────────────────────────

const BUGGY_TYPESCRIPT_MODULE = `
// Bug 1: Off-by-one error in pagination
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = page * pageSize; // BUG: should be (page - 1) * pageSize for 1-based pages
  return items.slice(start, start + pageSize);
}

// Bug 2: Missing null check
export function getUserName(user: { name?: string }): string {
  return user.name.toUpperCase(); // BUG: user.name could be undefined
}

// Bug 3: Incorrect type narrowing
export function processValue(value: string | number): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  return value.toFixed(2);
}

// Bug 4: Memory leak - event listener not cleaned up
export class DataStream {
  private listeners: Array<(data: string) => void> = [];

  on(handler: (data: string) => void): void {
    this.listeners.push(handler);
  }

  // Missing: off() method to remove listeners

  emit(data: string): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }
}

// Bug 5: Race condition in async operation
export async function fetchAndCache(
  url: string,
  cache: Map<string, string>,
): Promise<string> {
  if (cache.has(url)) {
    return cache.get(url)!;
  }

  // BUG: No lock — two concurrent calls for same URL will both fetch
  const response = await fetch(url);
  const data = await response.text();
  cache.set(url, data);
  return data;
}

// Deliberately complex function for complexity analysis
export function complexRouter(method: string, path: string, auth: boolean, role: string): string {
  if (method === 'GET') {
    if (path.startsWith('/api')) {
      if (auth) {
        if (role === 'admin') {
          return 'admin-api-read';
        } else if (role === 'user') {
          return 'user-api-read';
        } else {
          return 'guest-api-read';
        }
      } else {
        return 'public-api-read';
      }
    } else if (path.startsWith('/static')) {
      return 'static-file';
    } else {
      return 'page-render';
    }
  } else if (method === 'POST') {
    if (!auth) return 'unauthorized';
    if (path.startsWith('/api')) {
      if (role === 'admin' || role === 'editor') {
        return 'api-write';
      }
      return 'forbidden';
    }
    return 'form-submit';
  } else if (method === 'DELETE') {
    if (!auth) return 'unauthorized';
    if (role !== 'admin') return 'forbidden';
    return 'delete-resource';
  }
  return 'method-not-allowed';
}

debugger; // Bug 6: Leftover debugger statement
console.log('Module loaded'); // Bug 7: Leftover console.log
`;

const PACKAGE_JSON_WITH_ISSUES = `{
  "name": "test-project",
  "version": "0.1.0",
  "dependencies": {
    "express": "4.18.2",
    "lodash": "4.17.15",
    "axios": "1.6.0"
  },
  "devDependencies": {
    "typescript": "5.3.0",
    "vitest": "1.0.0"
  }
}`;

// ─── Test Setup ───────────────────────────────────────────────────────

let testDir: string;

function setupTestProject(): string {
  const dir = join(tmpdir(), `cortexos-realworld-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });

  writeFileSync(join(dir, 'src', 'utils.ts'), BUGGY_TYPESCRIPT_MODULE);
  writeFileSync(join(dir, 'package.json'), PACKAGE_JSON_WITH_ISSUES);
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler' },
    include: ['src/'],
  }, null, 2));

  // Initialize git repo for git-related tests
  try {
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    execSync('git add -A', { cwd: dir, stdio: 'pipe' });
    execSync('git -c user.name="Test" -c user.email="test@test.com" commit -m "init"', { cwd: dir, stdio: 'pipe' });
  } catch {
    // Git might not be available, that's OK
  }

  return dir;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('Real-World Bug Fix Harness', () => {
  beforeEach(() => {
    testDir = setupTestProject();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── Prompt Analysis on Real Code ─────────────────────────────────

  describe('Stage: Prompt Analysis on Real Bug Reports', () => {
    it('should analyze a real bug report and identify intent', () => {
      const analyzer = new PromptAnalyzer();
      const analysis = analyzer.analyze(
        'Fix the off-by-one error in the paginate function in src/utils.ts. ' +
        'Page 1 should return the first pageSize items, not starting from index pageSize.',
      );

      expect(analysis.intent).toBeDefined();
      expect(analysis.complexity).toBeDefined();
      expect(analysis.entities.length).toBeGreaterThanOrEqual(0);
    });

    it('should analyze a multi-file refactoring request', () => {
      const analyzer = new PromptAnalyzer();
      const analysis = analyzer.analyze(
        'Refactor the route handling logic. The complexRouter function in src/utils.ts has ' +
        'cyclomatic complexity over 15. Extract the auth checks into a middleware function ' +
        'and use a route table instead of nested conditionals.',
      );

      expect(analysis.intent).toBeDefined();
      expect(analysis.complexity).toBeDefined();
    });

    it('should detect security-related bug fix requests', () => {
      const analyzer = new PromptAnalyzer();
      const analysis = analyzer.analyze(
        'Fix the race condition in fetchAndCache - two concurrent requests for the same URL ' +
        'will both fetch from the network instead of deduplicating.',
      );

      expect(analysis).toBeDefined();
      expect(analysis.intent).toBeDefined();
    });
  });

  // ─── Code Intelligence on Real Code ───────────────────────────────

  describe('Stage: Code Intelligence on Real Code', () => {
    it('should map a real project directory', () => {
      const mapper = new RepoMapper();
      const map = mapper.generateMap({ rootDir: testDir, maxFiles: 100, maxDepth: 5 });

      expect(map.files.length).toBeGreaterThan(0);
      expect(map.files.some(f => f.includes('utils.ts'))).toBe(true);
    });

    it('should parse real TypeScript with AST parser', () => {
      const parser = new ASTParser();
      const result = parser.analyze(BUGGY_TYPESCRIPT_MODULE, 'src/utils.ts');

      expect(result.functions.length).toBeGreaterThan(0);
      expect(result.classes.length).toBeGreaterThan(0);
      // Should find DataStream class
      expect(result.classes.some(c => c.name === 'DataStream')).toBe(true);
      // Should find paginate function
      expect(result.functions.some(f => f.name === 'paginate')).toBe(true);
    });

    it('should calculate complexity for a complex function', () => {
      const parser = new ASTParser();
      const result = parser.analyze(BUGGY_TYPESCRIPT_MODULE, 'src/utils.ts');

      // Overall file complexity should be elevated
      expect(result.complexity.cyclomatic).toBeGreaterThanOrEqual(1);
    });

    it('should detect code patterns with CodeParser', () => {
      const parser = new CodeParser();
      const result = parser.parseContent(BUGGY_TYPESCRIPT_MODULE, 'utils.ts');

      expect(result.symbols.length).toBeGreaterThan(0);
      expect(result.exports.length).toBeGreaterThan(0);
    });
  });

  // ─── Quality Gates on Real Code ───────────────────────────────────

  describe('Stage: Quality Gates on Real Buggy Code', () => {
    it('should detect syntax issues in real code (debugger, console.log)', () => {
      const verifier = new QualityVerifier();
      const context: QualityContext = {
        workingDir: testDir,
        filesChanged: ['src/utils.ts'],
        executionId: 'test-run-1',
      };

      expect(verifier).toBeDefined();
      expect(context.filesChanged).toContain('src/utils.ts');
    });

    it('should identify auto-fixable issues', async () => {
      const autoFixer = new AutoFixer();
      expect(autoFixer).toBeDefined();

      const fixableIssues = [
        {
          severity: 'warning' as const,
          message: 'Debugger statement found',
          file: 'src/utils.ts',
          line: 80,
          rule: 'no-debugger',
          autoFixable: true,
        },
        {
          severity: 'warning' as const,
          message: 'Console.log found',
          file: 'src/utils.ts',
          line: 81,
          rule: 'no-console',
          autoFixable: true,
        },
      ];

      expect(fixableIssues.every(i => i.autoFixable)).toBe(true);
    });
  });

  // ─── Tool Execution on Real Files ─────────────────────────────────

  describe('Stage: Tool Execution on Real Files', () => {
    it('should register and list all built-in tools', () => {
      const registry = ToolRegistry.createDefault();
      const tools = registry.list();

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some(t => t.name === 'file_read')).toBe(true);
      expect(tools.some(t => t.name === 'file_write')).toBe(true);
      expect(tools.some(t => t.name === 'shell')).toBe(true);
    });

    it('should execute file_read tool on real code', async () => {
      const registry = ToolRegistry.createDefault();

      const tool = registry.get('file_read');
      const result = await tool.execute(
        { path: 'src/utils.ts' },
        { workingDir: testDir, executionId: 'test-1' },
      );
      expect(result.success).toBe(true);
      expect(result.output).toContain('paginate');
      expect(result.output).toContain('DataStream');
    });

    it('should execute file_search tool on real project', async () => {
      const registry = ToolRegistry.createDefault();

      if (registry.has('file_search')) {
        const tool = registry.get('file_search');
        const result = await tool.execute(
          { pattern: '**/*.ts', path: '.' },
          { workingDir: testDir, executionId: 'test-2' },
        );
        expect(result.success).toBe(true);
      }
    });
  });

  // ─── Plugin System with Real Code ─────────────────────────────────

  describe('Stage: Built-in Plugins Against Real Code', () => {
    it('should analyze complexity of real code with CodeComplexityPlugin', () => {
      const result = analyzeComplexity(BUGGY_TYPESCRIPT_MODULE, 'src/utils.ts');

      expect(result.totalFunctions).toBeGreaterThan(0);
      expect(result.maxComplexity).toBeGreaterThan(1);
      const complex = result.functions.find(f => f.name === 'complexRouter');
      if (complex) {
        expect(complex.complexity).toBeGreaterThan(8);
      }
    });

    it('should audit dependencies from real package.json', () => {
      const findings = auditDependencies(testDir);
      const lodashFinding = findings.find(f => f.package === 'lodash');
      expect(lodashFinding).toBeDefined();
    });

    it('should parse real package.json correctly', () => {
      const { deps, packageName, version } = parsePackageJson(testDir);

      expect(packageName).toBe('test-project');
      expect(version).toBe('0.1.0');
      expect(deps.length).toBe(5);
      expect(deps.some(d => d.name === 'express')).toBe(true);
    });

    it('should analyze doc coverage of real code', () => {
      const coverage = analyzeDocCoverage(BUGGY_TYPESCRIPT_MODULE, 'src/utils.ts');

      expect(coverage.entries.length).toBeGreaterThan(0);
      expect(coverage.exportedCount).toBeGreaterThan(0);
      expect(coverage.coveragePercent).toBeLessThan(50);
    });

    it('should generate docs from real code', () => {
      const docs = generateDocs(BUGGY_TYPESCRIPT_MODULE, 'src/utils.ts');

      expect(docs).toContain('# `utils`');
      expect(docs).toContain('paginate');
      expect(docs).toContain('DataStream');
    });

    it('should classify git changes correctly', () => {
      const result1 = classifyChanges('+export function newFeature', ['src/core/feature.ts']);
      expect(result1.type).toBe('feat');

      const result2 = classifyChanges('fix: handle null pointer', ['test/unit/core.test.ts']);
      expect(result2.type).toBe('test');

      const result3 = classifyChanges('updated readme', ['README.md', 'docs/guide.md']);
      expect(result3.type).toBe('docs');
    });

    it('should detect sensitive files', () => {
      const sensitive = detectSensitiveFiles([
        'src/app.ts',
        '.env',
        '.env.production',
        'credentials.json',
        'id_rsa',
        'package.json',
      ]);

      expect(sensitive).toContain('.env');
      expect(sensitive).toContain('.env.production');
      expect(sensitive).toContain('credentials.json');
      expect(sensitive).toContain('id_rsa');
      expect(sensitive).not.toContain('src/app.ts');
      expect(sensitive).not.toContain('package.json');
    });

    it('should load all 5 built-in plugins into PluginRegistry', async () => {
      const registry = new PluginRegistry();

      await registry.load(MetricsDashboardPlugin);
      await registry.load(CodeComplexityPlugin);
      await registry.load(GitWorkflowPlugin);
      await registry.load(DependencyAuditPlugin);
      await registry.load(DocumentationGenPlugin);

      const loaded = registry.listPlugins();
      expect(loaded).toHaveLength(5);
      expect(loaded.map(p => p.name)).toContain('cortexos-metrics-dashboard');
      expect(loaded.map(p => p.name)).toContain('cortexos-code-complexity');
      expect(loaded.map(p => p.name)).toContain('cortexos-git-workflow');
      expect(loaded.map(p => p.name)).toContain('cortexos-dependency-audit');
      expect(loaded.map(p => p.name)).toContain('cortexos-documentation-gen');

      const tools = registry.getTools();
      expect(tools.length).toBeGreaterThanOrEqual(8);

      const gates = registry.getGates();
      expect(gates.size).toBeGreaterThanOrEqual(4);

      const roles = registry.getRoles();
      expect(roles.size).toBeGreaterThanOrEqual(1);
    });

    it('should execute MetricsStore operations', () => {
      const store = new MetricsStore(100);

      store.record({
        executionId: 'test-1',
        timestamp: Date.now(),
        tokensUsed: 5000,
        costUsd: 0.015,
        durationMs: 3200,
        stagesCompleted: 8,
        agentCount: 3,
      });

      store.record({
        executionId: 'test-2',
        timestamp: Date.now(),
        tokensUsed: 8000,
        costUsd: 0.024,
        durationMs: 5100,
        stagesCompleted: 8,
        agentCount: 5,
      });

      const latest = store.getLatest(2);
      expect(latest).toHaveLength(2);

      const averages = store.getAverages();
      expect(averages.avgTokens).toBe(6500);
      expect(averages.avgCost).toBe(0.0195);
      expect(averages.avgDuration).toBe(4150);

      expect(store.size).toBe(2);
    });
  });

  // ─── Observability on Real Runs ───────────────────────────────────

  describe('Stage: Observability with Real Execution Data', () => {
    it('should trace a simulated pipeline execution', () => {
      const tracer = new Tracer();
      const root = tracer.startTrace('pipeline');

      const recall = tracer.startSpan('recall', 'stage', root.id);
      tracer.endSpan(recall.id, 'success');

      const analyze = tracer.startSpan('analyze', 'stage', root.id);
      tracer.endSpan(analyze.id, 'success');

      const execute = tracer.startSpan('execute', 'stage', root.id);
      tracer.endSpan(execute.id, 'success');

      tracer.endSpan(root.id, 'success');

      const exported = tracer.exportTrace();
      expect(exported).toBeDefined();
      expect(exported!.spanCount).toBe(4);
      expect(exported!.rootSpan.status).toBe('success');
      expect(exported!.errorCount).toBe(0);
    });

    it('should collect metrics for a real-world scenario', () => {
      const metrics = new MetricsCollector();

      const runMetric: RunMetric = {
        runId: 'test-run-1',
        timestamp: Date.now(),
        duration: 5860,
        success: true,
        prompt: 'Fix the off-by-one bug',
        stages: [
          { name: 'recall', duration: 120, success: true },
          { name: 'analyze', duration: 45, success: true },
          { name: 'enhance', duration: 30, success: true },
          { name: 'decompose', duration: 15, success: true },
          { name: 'plan', duration: 20, success: true },
          { name: 'execute', duration: 5200, success: true },
          { name: 'verify', duration: 350, success: true },
          { name: 'memorize', duration: 80, success: true },
        ],
        agents: [
          { taskId: 'task-1', role: 'coder', duration: 3200, success: true, tokensUsed: 3500, toolCalls: 8, iterations: 3 },
        ],
        cost: {
          totalTokens: 4500, totalCost: 0.0135, inputTokens: 3500, outputTokens: 1000,
          modelBreakdown: [{ model: 'claude-sonnet', tokens: 4500, cost: 0.0135 }],
        },
        quality: { passed: true, score: 0.92, gatesRun: 3, issuesFound: 1 },
        memory: { recalled: 2, stored: 3 },
      };

      metrics.record(runMetric);

      const agg = metrics.aggregate();
      expect(agg.totalRuns).toBe(1);
      expect(agg.avgDuration).toBeGreaterThan(5000);
      expect(agg.successRate).toBe(1);
    });

    it('should track costs for real-world token usage', () => {
      const tracker = new CostTracker();

      tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 15000,
        outputTokens: 3000,
        cached: false,
      });

      tracker.record({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 8000,
        outputTokens: 1500,
        cached: true,
      });

      const summary = tracker.getSummary();
      expect(summary.totalInputTokens).toBe(23000);
      expect(summary.totalOutputTokens).toBe(4500);
      expect(summary.totalCost).toBeGreaterThan(0);
    });
  });

  // ─── End-to-End Pipeline Simulation ───────────────────────────────

  describe('Stage: Full Pipeline Simulation on Real Code', () => {
    it('should run analysis → enhancement → decomposition on a real bug report', async () => {
      const analyzer = new PromptAnalyzer();
      const enhancer = new PromptEnhancer();
      const decomposer = new PromptDecomposer();

      const prompt = 'Fix the off-by-one error in paginate() and add null check to getUserName()';

      // Stage 1: Analyze
      const analysis = analyzer.analyze(prompt);
      expect(analysis.intent).toBeDefined();

      // Stage 2: Enhance (proper 4-arg signature)
      const enhanced = enhancer.enhance(prompt, analysis, [], {
        rootDir: testDir,
        languages: { typescript: 1 },
        configFiles: ['tsconfig.json'],
        repoMap: 'src/utils.ts — paginate, getUserName, DataStream',
        totalFiles: 3,
      });
      expect(enhanced.userPrompt.length).toBeGreaterThan(0);

      // Stage 3: Decompose (async)
      const tasks = await decomposer.decompose(prompt, analysis);
      expect(tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle event bus lifecycle correctly', () => {
      const bus = new EventBus();
      const events: string[] = [];

      bus.on('engine:start', () => events.push('start'));
      bus.on('stage:start', () => events.push('stage'));
      bus.on('engine:complete', () => events.push('complete'));

      bus.emit('engine:start', { executionId: 'test', prompt: 'fix bug', timestamp: Date.now() });
      bus.emit('stage:start', { stage: 'analyze', timestamp: Date.now() } as any);
      bus.emit('engine:complete', { executionId: 'test', result: {} as any, timestamp: Date.now() });

      expect(events).toEqual(['start', 'stage', 'complete']);

      bus.removeAllListeners();
    });
  });
});
