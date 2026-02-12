/**
 * SWE-bench Adapter — Runs CortexOS against real-world GitHub issues.
 *
 * Loads SWE-bench dataset instances, creates isolated git workspaces,
 * runs the CortexOS engine to generate patches, and evaluates them
 * against the repository's test suite.
 */

import { execSync } from 'child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type {
  SWEBenchInstance,
  SWEBenchResult,
  SWEBenchReport,
  SWEBenchSummary,
  SWEBenchConfig,
} from './types.js';
import { SWEBenchPromptBuilder } from './prompt-builder.js';
import { PatchExtractor } from './patch-extractor.js';
import { SWEBenchEvaluator } from './evaluator.js';

export class SWEBenchAdapter {
  private config: SWEBenchConfig;
  private promptBuilder: SWEBenchPromptBuilder;
  private patchExtractor: PatchExtractor;
  private evaluator: SWEBenchEvaluator;

  constructor(config: SWEBenchConfig) {
    this.config = {
      timeout: 300000,
      ...config,
    };
    this.promptBuilder = new SWEBenchPromptBuilder();
    this.patchExtractor = new PatchExtractor();
    this.evaluator = new SWEBenchEvaluator(this.config.timeout);
  }

  /**
   * Run the full SWE-bench evaluation pipeline.
   */
  async run(
    engineFactory?: (workDir: string) => Promise<{ execute: (prompt: string) => Promise<{ success: boolean; filesChanged?: Array<{ path: string; type: string; content?: string }>; cost?: { totalCost: number } }> }>,
  ): Promise<SWEBenchReport> {
    const instances = this.loadDataset();
    const results: SWEBenchResult[] = [];

    for (const instance of instances) {
      const result = await this.processInstance(instance, engineFactory);
      results.push(result);
    }

    return this.buildReport(results);
  }

  /**
   * Load and parse the JSONL dataset file.
   */
  loadDataset(): SWEBenchInstance[] {
    const content = readFileSync(this.config.dataset, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim().length > 0);

    const instances: SWEBenchInstance[] = [];
    for (const line of lines) {
      try {
        const instance = JSON.parse(line) as SWEBenchInstance;
        if (instance.instance_id && instance.repo) {
          instances.push(instance);
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Apply limit
    if (this.config.limit && this.config.limit > 0) {
      return instances.slice(0, this.config.limit);
    }

    return instances;
  }

  /**
   * Process a single SWE-bench instance.
   */
  private async processInstance(
    instance: SWEBenchInstance,
    engineFactory?: (workDir: string) => Promise<{ execute: (prompt: string) => Promise<{ success: boolean; filesChanged?: Array<{ path: string; type: string; content?: string }>; cost?: { totalCost: number } }> }>,
  ): Promise<SWEBenchResult> {
    const workDir = join(
      tmpdir(),
      `cortex-swebench-${instance.instance_id.replace(/[^a-zA-Z0-9-_]/g, '_')}-${Date.now()}`,
    );

    const startTime = Date.now();

    try {
      mkdirSync(workDir, { recursive: true });

      // Step 1: Setup repository
      this.setupRepo(instance, workDir);

      // Step 2: Build prompt
      const prompt = this.promptBuilder.build(instance, workDir);

      // Step 3: Run engine (with timeout)
      let engineResult: { success: boolean; filesChanged?: Array<{ path: string; type: string; content?: string }>; cost?: { totalCost: number } };

      if (engineFactory) {
        const engine = await engineFactory(workDir);
        engineResult = await Promise.race([
          engine.execute(prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Instance timeout')), this.config.timeout || 300000),
          ),
        ]);
      } else {
        // Dry-run mode: no engine provided
        engineResult = {
          success: false,
          filesChanged: [],
        };
      }

      // Step 4: Extract patch
      const filesChanged = (engineResult.filesChanged || []).map(fc => ({
        path: fc.path,
        type: fc.type as 'create' | 'modify' | 'delete',
        content: fc.content,
      }));
      const patch = this.patchExtractor.extract(filesChanged, workDir);

      // Step 5: Evaluate
      const evalResult = await this.evaluator.evaluate(instance, workDir);

      const duration = Date.now() - startTime;

      return {
        instance_id: instance.instance_id,
        model_name_or_path: `${this.config.provider || 'default'}/${this.config.model || 'default'}`,
        model_patch: patch,
        success: evalResult.success,
        tests_passed: evalResult.tests_passed,
        tests_total: evalResult.tests_total,
        cost: engineResult.cost?.totalCost || 0,
        duration,
        error: evalResult.error,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        instance_id: instance.instance_id,
        model_name_or_path: `${this.config.provider || 'default'}/${this.config.model || 'default'}`,
        model_patch: '',
        success: false,
        tests_passed: 0,
        tests_total: 0,
        cost: 0,
        duration,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Cleanup
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Setup the repository at the specified base commit.
   */
  private setupRepo(instance: SWEBenchInstance, workDir: string): void {
    const repoUrl = `https://github.com/${instance.repo}.git`;
    const cacheDir = this.config.repoCache
      ? join(this.config.repoCache, instance.repo.replace('/', '_'))
      : null;

    try {
      if (cacheDir && existsSync(cacheDir)) {
        // Clone from cache (faster)
        execSync(`git clone "${cacheDir}" "${workDir}" --quiet`, {
          encoding: 'utf-8',
          timeout: 60000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        // Clone from remote (shallow for speed)
        execSync(`git clone "${repoUrl}" "${workDir}" --quiet --depth 100`, {
          encoding: 'utf-8',
          timeout: 120000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Cache for next time
        if (cacheDir) {
          mkdirSync(cacheDir, { recursive: true });
          execSync(`git clone --bare "${workDir}" "${cacheDir}" --quiet`, {
            encoding: 'utf-8',
            timeout: 60000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        }
      }

      // Checkout base commit
      execSync(`git checkout ${instance.base_commit} --quiet`, {
        cwd: workDir,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(
        `Failed to setup repo ${instance.repo} at ${instance.base_commit}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Build the aggregate report from individual results.
   */
  private buildReport(results: SWEBenchResult[]): SWEBenchReport {
    const resolved = results.filter(r => r.success).length;
    const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    const summary: SWEBenchSummary = {
      total: results.length,
      resolved,
      resolutionRate: results.length > 0 ? Math.round((resolved / results.length) * 1000) / 1000 : 0,
      avgCost: results.length > 0 ? Math.round((totalCost / results.length) * 10000) / 10000 : 0,
      avgDuration: results.length > 0 ? Math.round(totalDuration / results.length) : 0,
      totalCost: Math.round(totalCost * 10000) / 10000,
    };

    return {
      model: this.config.model || 'default',
      provider: this.config.provider || 'default',
      dataset: this.config.dataset,
      timestamp: new Date().toISOString(),
      results,
      summary,
    };
  }
}
