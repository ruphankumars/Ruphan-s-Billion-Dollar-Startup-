import { describe, it, expect, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SWEBenchAdapter } from '../../../src/swebench/adapter.js';
import type { SWEBenchInstance, SWEBenchConfig } from '../../../src/swebench/types.js';

function createDatasetFile(instances: Partial<SWEBenchInstance>[]): string {
  const dir = join(tmpdir(), `cortex-swebench-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const filepath = join(dir, 'dataset.jsonl');

  const lines = instances.map(instance => JSON.stringify({
    instance_id: 'test-instance-1',
    repo: 'test/repo',
    base_commit: 'abc123',
    problem_statement: 'Test bug',
    hints_text: '',
    test_patch: '',
    patch: '',
    FAIL_TO_PASS: '[]',
    PASS_TO_PASS: '[]',
    environment_setup_commit: 'def456',
    version: '1.0',
    ...instance,
  }));

  writeFileSync(filepath, lines.join('\n'), 'utf-8');
  return filepath;
}

describe('SWEBenchAdapter', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
    cleanupDirs.length = 0;
  });

  it('should create adapter with config', () => {
    const adapter = new SWEBenchAdapter({ dataset: '/tmp/test.jsonl' });
    expect(adapter).toBeDefined();
  });

  it('should load JSONL dataset', () => {
    const filepath = createDatasetFile([
      { instance_id: 'inst-1' },
      { instance_id: 'inst-2' },
    ]);
    cleanupDirs.push(filepath.replace('/dataset.jsonl', ''));

    const adapter = new SWEBenchAdapter({ dataset: filepath });
    const instances = adapter.loadDataset();
    expect(instances).toHaveLength(2);
    expect(instances[0].instance_id).toBe('inst-1');
  });

  it('should respect limit config', () => {
    const filepath = createDatasetFile([
      { instance_id: 'inst-1' },
      { instance_id: 'inst-2' },
      { instance_id: 'inst-3' },
    ]);
    cleanupDirs.push(filepath.replace('/dataset.jsonl', ''));

    const adapter = new SWEBenchAdapter({ dataset: filepath, limit: 2 });
    const instances = adapter.loadDataset();
    expect(instances).toHaveLength(2);
  });

  it('should handle empty dataset', () => {
    const filepath = createDatasetFile([]);
    cleanupDirs.push(filepath.replace('/dataset.jsonl', ''));

    const adapter = new SWEBenchAdapter({ dataset: filepath });
    const instances = adapter.loadDataset();
    expect(instances).toHaveLength(0);
  });

  it('should handle malformed JSONL lines', () => {
    const dir = join(tmpdir(), `cortex-swebench-test-malformed-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const filepath = join(dir, 'dataset.jsonl');
    cleanupDirs.push(dir);

    const content = [
      JSON.stringify({ instance_id: 'good-1', repo: 'test/repo' }),
      'not valid json',
      JSON.stringify({ instance_id: 'good-2', repo: 'test/repo' }),
    ].join('\n');
    writeFileSync(filepath, content, 'utf-8');

    const adapter = new SWEBenchAdapter({ dataset: filepath });
    const instances = adapter.loadDataset();
    expect(instances).toHaveLength(2);
  });

  it('should build report with summary', async () => {
    const filepath = createDatasetFile([
      { instance_id: 'inst-1' },
    ]);
    cleanupDirs.push(filepath.replace('/dataset.jsonl', ''));

    const adapter = new SWEBenchAdapter({ dataset: filepath });
    const report = await adapter.run();

    expect(report).toHaveProperty('model');
    expect(report).toHaveProperty('provider');
    expect(report).toHaveProperty('dataset');
    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('results');
    expect(report).toHaveProperty('summary');
    expect(report.results).toHaveLength(1);
  });

  it('should calculate resolution rate correctly', async () => {
    const filepath = createDatasetFile([
      { instance_id: 'inst-1' },
      { instance_id: 'inst-2' },
    ]);
    cleanupDirs.push(filepath.replace('/dataset.jsonl', ''));

    const adapter = new SWEBenchAdapter({ dataset: filepath });
    const report = await adapter.run();

    // Dry run mode (no engine) produces no successes
    expect(report.summary.total).toBe(2);
    expect(typeof report.summary.resolutionRate).toBe('number');
    expect(report.summary.resolutionRate).toBeGreaterThanOrEqual(0);
    expect(report.summary.resolutionRate).toBeLessThanOrEqual(1);
  });

  it('should handle engine errors gracefully', async () => {
    const filepath = createDatasetFile([{ instance_id: 'inst-1' }]);
    cleanupDirs.push(filepath.replace('/dataset.jsonl', ''));

    const crashingEngine = async () => ({
      execute: async () => { throw new Error('Engine crashed'); },
    });

    const adapter = new SWEBenchAdapter({ dataset: filepath });
    const report = await adapter.run(crashingEngine);

    // Should not crash, just report failure
    expect(report.results).toHaveLength(1);
    expect(report.results[0].success).toBe(false);
  });

  it('should include model/provider in report', async () => {
    const filepath = createDatasetFile([{ instance_id: 'inst-1' }]);
    cleanupDirs.push(filepath.replace('/dataset.jsonl', ''));

    const adapter = new SWEBenchAdapter({
      dataset: filepath,
      provider: 'test-provider',
      model: 'test-model',
    });
    const report = await adapter.run();

    expect(report.model).toBe('test-model');
    expect(report.provider).toBe('test-provider');
  });

  it('should produce valid SWEBenchReport structure', async () => {
    const filepath = createDatasetFile([{ instance_id: 'inst-1' }]);
    cleanupDirs.push(filepath.replace('/dataset.jsonl', ''));

    const adapter = new SWEBenchAdapter({ dataset: filepath });
    const report = await adapter.run();

    expect(report.summary.total).toBe(1);
    expect(typeof report.summary.avgCost).toBe('number');
    expect(typeof report.summary.avgDuration).toBe('number');
    expect(typeof report.summary.totalCost).toBe('number');
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}/);
  });

  it('should track duration for each result', async () => {
    const filepath = createDatasetFile([{ instance_id: 'inst-1' }]);
    cleanupDirs.push(filepath.replace('/dataset.jsonl', ''));

    const adapter = new SWEBenchAdapter({ dataset: filepath });
    const report = await adapter.run();

    expect(report.results[0].duration).toBeGreaterThanOrEqual(0);
  });
});
