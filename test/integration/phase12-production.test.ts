/**
 * Phase 12 Integration: Production-Hardening Features
 *
 * Tests the Phase 12 features working together in realistic scenarios:
 * - Streaming pipeline with event bridge
 * - Graceful degradation paths
 * - Concurrent safety under load
 * - Error chains through pipeline stages
 * - Config migration from old formats
 * - Plugin sandboxing with real plugins
 * - Memory eviction under pressure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Core
import { EventBus } from '../../src/core/events.js';
import { ChainableError, ErrorAggregator } from '../../src/core/error-chain.js';
import { ConfigMigrator, diffConfigs, validateConfig } from '../../src/core/config-migration.js';
import { AsyncMutex, AsyncRWLock, AsyncSemaphore } from '../../src/core/mutex.js';
import { GracefulDegradation } from '../../src/core/graceful.js';
import { StreamController, StreamBridge, createStreamPipeline, formatSSE } from '../../src/core/streaming.js';

// Plugins
import { PluginSandbox } from '../../src/plugins/sandbox.js';

// Memory
import { MemoryEvictor } from '../../src/memory/eviction.js';

describe('Phase 12 — Production Hardening Integration', () => {
  describe('Streaming Pipeline End-to-End', () => {
    it('should stream full pipeline lifecycle events', () => {
      const eventBus = new EventBus();
      const { stream, bridge } = createStreamPipeline(eventBus);
      const events: any[] = [];
      stream.subscribe(e => events.push(e));

      // Simulate a full pipeline run
      eventBus.emit('engine:start', { prompt: 'Add auth middleware' });
      eventBus.emit('stage:start', { stage: 'recall' });
      eventBus.emit('stage:complete', { stage: 'recall', memories: 3 });
      eventBus.emit('stage:start', { stage: 'analyze' });
      eventBus.emit('stage:complete', { stage: 'analyze' });
      eventBus.emit('stage:start', { stage: 'execute' });
      eventBus.emit('agent:start', { taskId: 'task-1', role: 'developer' });
      eventBus.emit('agent:complete', { taskId: 'task-1', success: true });
      eventBus.emit('stage:complete', { stage: 'execute' });
      eventBus.emit('quality:gate', { gate: 'syntax', passed: true });
      eventBus.emit('engine:complete', { success: true });

      expect(events.length).toBe(11);
      expect(events[0].type).toBe('pipeline:start');
      expect(events[events.length - 1].type).toBe('pipeline:complete');

      // Verify SSE formatting
      const sse = formatSSE(events[0]);
      expect(sse).toContain('event: pipeline:start');
      expect(sse).toContain('id: 0');

      bridge.disconnect();
      stream.close();
    });

    it('should stream errors in pipeline', () => {
      const eventBus = new EventBus();
      const { stream, bridge } = createStreamPipeline(eventBus);
      const events: any[] = [];
      stream.subscribe(e => events.push(e));

      eventBus.emit('engine:start', {});
      eventBus.emit('engine:error', { error: 'Provider timeout' });

      expect(events.some(e => e.type === 'pipeline:error')).toBe(true);

      bridge.disconnect();
      stream.close();
    });
  });

  describe('Graceful Degradation Scenarios', () => {
    it('should degrade gracefully with no providers', () => {
      const gd = new GracefulDegradation();
      gd.checkProvider('anthropic', false);
      gd.checkProvider('openai', false);
      gd.checkMemory(true);

      const report = gd.getReport();
      expect(report.level).toBe('minimal');
      expect(report.warnings.length).toBe(2);
    });

    it('should report degraded with partial dependencies', () => {
      const gd = new GracefulDegradation();
      gd.checkProvider('anthropic', true);
      gd.checkMemory(true);
      gd.checkGateDependency('lint', 'eslint', false);
      gd.checkGateDependency('type-check', 'tsc', true);
      gd.checkOptionalDep('web-tree-sitter', false);
      gd.checkWorktrees(false);

      const report = gd.getReport();
      expect(report.level).toBe('degraded');
      expect(report.available).toContain('provider:anthropic');
      expect(report.available).toContain('memory');
      expect(report.unavailable).toContain('gate:lint');
      expect(report.unavailable).toContain('dep:web-tree-sitter');
    });
  });

  describe('Concurrent Safety Under Load', () => {
    it('should protect shared counter with mutex', async () => {
      const mutex = new AsyncMutex();
      let counter = 0;

      // 10 concurrent increments
      await Promise.all(
        Array.from({ length: 10 }, () =>
          mutex.withLock(async () => {
            const current = counter;
            await new Promise(r => setTimeout(r, 1)); // Simulate async work
            counter = current + 1;
          })
        ),
      );

      expect(counter).toBe(10); // All increments applied correctly
    });

    it('should allow concurrent reads with RWLock', async () => {
      const lock = new AsyncRWLock();
      const log: string[] = [];

      // 5 concurrent readers
      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          lock.withRead(async () => {
            log.push(`read-${i}`);
            await new Promise(r => setTimeout(r, 1));
          })
        ),
      );

      expect(log.length).toBe(5);
    });

    it('should bound concurrency with semaphore', async () => {
      const sem = new AsyncSemaphore(3);
      let maxConcurrent = 0;
      let current = 0;

      await Promise.all(
        Array.from({ length: 10 }, () =>
          sem.withPermit(async () => {
            current++;
            maxConcurrent = Math.max(maxConcurrent, current);
            await new Promise(r => setTimeout(r, 5));
            current--;
          })
        ),
      );

      expect(maxConcurrent).toBeLessThanOrEqual(3);
      expect(current).toBe(0);
    });
  });

  describe('Error Chains Through Pipeline', () => {
    it('should chain errors across multiple stages', () => {
      // Simulate: network error → provider error → pipeline error
      const networkError = new Error('ECONNREFUSED');
      const providerError = ChainableError.wrap(
        networkError,
        'Anthropic API call failed',
        'PROVIDER_ERR',
        { stage: 'execute', provider: 'anthropic' },
      );
      const pipelineError = ChainableError.wrap(
        providerError,
        'Pipeline stage failed',
        'PIPELINE_ERR',
        { stage: 'execute', component: 'engine' },
      );

      const chain = pipelineError.getChain();
      expect(chain.length).toBe(3);
      expect(chain[0].code).toBe('PIPELINE_ERR');
      expect(chain[1].code).toBe('PROVIDER_ERR');
      expect(chain[2].code).toBe('UNKNOWN');

      // Root cause
      expect(pipelineError.getRootCause()).toBe(networkError);

      // Debug string should be informative
      const debug = pipelineError.toDebugString();
      expect(debug).toContain('Pipeline stage failed');
      expect(debug).toContain('Anthropic API');
      expect(debug).toContain('Caused by');
    });

    it('should aggregate errors from parallel agent execution', () => {
      const agg = new ErrorAggregator();

      // 3 agents fail with different errors
      agg.add(new ChainableError('Agent 1: rate limited', 'RATE_LIMIT', { stage: 'execute', agentId: 'agent-1' }));
      agg.add(new ChainableError('Agent 2: timeout', 'TIMEOUT', { stage: 'execute', agentId: 'agent-2' }));
      agg.add(new ChainableError('Agent 3: rate limited', 'RATE_LIMIT', { stage: 'execute', agentId: 'agent-3' }));

      const summary = agg.getSummary();
      expect(summary.total).toBe(3);
      expect(summary.byCode.RATE_LIMIT).toBe(2);
      expect(summary.byCode.TIMEOUT).toBe(1);
      expect(summary.byStage.execute).toBe(3);
    });
  });

  describe('Config Migration End-to-End', () => {
    it('should migrate full legacy config to modern format', () => {
      const migrator = new ConfigMigrator();
      const legacyConfig = {
        provider: 'openai',
        maxBudget: 5.0,
        memoryEnabled: true,
      };

      const { config, applied } = migrator.migrate(legacyConfig, '0.1.0');

      expect(config.providers).toEqual({ default: 'openai' });
      expect(config.provider).toBeUndefined();
      expect((config.cost as any).budgetPerRun).toBe(5.0);
      expect(config.maxBudget).toBeUndefined();
      expect(config.memory).toEqual({ enabled: true });
      expect(applied.length).toBeGreaterThanOrEqual(1);
    });

    it('should diff before and after migration', () => {
      const before = { provider: 'openai', maxBudget: 5 };
      const after = {
        providers: { default: 'openai' },
        cost: { budgetPerRun: 5, budgetPerDay: 50 },
        quality: { gates: ['syntax', 'lint'], autoFix: true, maxRetries: 3 },
        reasoning: { enabled: false },
        embeddings: { provider: 'local' },
        dashboard: { port: 3100 },
        memory: { enabled: true },
      };

      const diff = diffConfigs(before, after);
      expect(diff.removed).toContain('provider');
      expect(diff.removed).toContain('maxBudget');
      expect(diff.added.length).toBeGreaterThan(0);
    });

    it('should validate config and produce diagnostics', () => {
      const diagnostics = validateConfig({
        provider: 'anthropic', // Deprecated
        providers: { default: 'anthropic' }, // Missing API key
        cost: { budgetPerRun: 100, budgetPerDay: 10 }, // Budget mismatch
        agents: { maxParallel: 16 }, // High parallelism
      });

      expect(diagnostics.length).toBeGreaterThanOrEqual(3);
      expect(diagnostics.some(d => d.severity === 'error')).toBe(true);
      expect(diagnostics.some(d => d.severity === 'warning')).toBe(true);
    });
  });

  describe('Plugin Sandboxing with Real Scenarios', () => {
    it('should sandbox a plugin that tries to register too many tools', () => {
      const sandbox = new PluginSandbox({}, { maxTools: 3 });

      // Plugin tries to register 5 tools
      for (let i = 0; i < 5; i++) {
        sandbox.canRegisterTool('greedy-plugin');
      }

      const violations = sandbox.getPluginViolations('greedy-plugin');
      expect(violations.length).toBe(2); // 2 over the limit
      expect(violations[0].type).toBe('limit');
    });

    it('should prevent unauthorized capability usage', () => {
      const sandbox = new PluginSandbox({
        registerTools: true,
        registerProviders: false,
        registerMiddleware: false,
        fileSystemAccess: false,
        networkAccess: false,
      });

      // Plugin tries various operations
      expect(sandbox.canRegisterTool('restricted-plugin')).toBe(true);
      expect(sandbox.canRegisterProvider('restricted-plugin')).toBe(false);
      expect(sandbox.canRegisterMiddleware('restricted-plugin', 'pre-execute')).toBe(false);
      expect(sandbox.canAccessFileSystem('restricted-plugin')).toBe(false);
      expect(sandbox.canAccessNetwork('restricted-plugin')).toBe(false);

      const violations = sandbox.getPluginViolations('restricted-plugin');
      expect(violations.length).toBe(4);
      expect(violations.every(v => v.type === 'capability')).toBe(true);
    });

    it('should isolate plugin counters', () => {
      const sandbox = new PluginSandbox({}, { maxTools: 2 });

      sandbox.canRegisterTool('plugin-a');
      sandbox.canRegisterTool('plugin-a');
      expect(sandbox.canRegisterTool('plugin-a')).toBe(false); // plugin-a at limit

      // plugin-b should have its own counter
      expect(sandbox.canRegisterTool('plugin-b')).toBe(true);
      expect(sandbox.canRegisterTool('plugin-b')).toBe(true);
      expect(sandbox.canRegisterTool('plugin-b')).toBe(false); // plugin-b at limit
    });
  });

  describe('Memory Eviction Under Pressure', () => {
    it('should evict oldest memories using LRU policy', async () => {
      const memories = Array.from({ length: 20 }, (_, i) => ({
        id: `mem-${i}`,
        embedding: [],
        metadata: {
          importance: 0.5,
          accessedAt: new Date(Date.now() - (20 - i) * 60 * 60 * 1000).toISOString(),
          accessCount: 1,
          decayFactor: 1.0,
          type: 'semantic',
          content: `Memory ${i}`,
        },
      }));

      const data = new Map(memories.map(m => [m.id, m]));
      const store = {
        count: vi.fn(async () => data.size),
        delete: vi.fn(async (id: string) => { data.delete(id); }),
        getAll: vi.fn(async () => [...data.values()]),
        getStorageSize: vi.fn(async () => 1024),
        search: vi.fn(async () => []),
        add: vi.fn(async () => {}),
        clear: vi.fn(async () => data.clear()),
        close: vi.fn(async () => {}),
      };

      const evictor = new MemoryEvictor({
        maxMemories: 15,
        policy: 'lru',
        evictBatchSize: 5,
      });

      const result = await evictor.evictIfNeeded(store as any);
      expect(result).not.toBeNull();
      expect(result!.evicted).toBe(5);
      expect(result!.memoriesBefore).toBe(20);
    });

    it('should protect important memories during eviction', async () => {
      const memories = [
        // Important memories (should be protected)
        { id: 'important-1', embedding: [], metadata: { importance: 0.95, accessedAt: new Date(Date.now() - 720 * 60 * 60 * 1000).toISOString(), accessCount: 1, decayFactor: 1.0 } },
        { id: 'important-2', embedding: [], metadata: { importance: 0.92, accessedAt: new Date(Date.now() - 720 * 60 * 60 * 1000).toISOString(), accessCount: 1, decayFactor: 1.0 } },
        // Expendable memories
        { id: 'expendable-1', embedding: [], metadata: { importance: 0.3, accessedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), accessCount: 1, decayFactor: 1.0 } },
        { id: 'expendable-2', embedding: [], metadata: { importance: 0.2, accessedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), accessCount: 1, decayFactor: 1.0 } },
      ];

      const data = new Map(memories.map(m => [m.id, m]));
      const store = {
        count: vi.fn(async () => data.size),
        delete: vi.fn(async (id: string) => { data.delete(id); }),
        getAll: vi.fn(async () => [...data.values()]),
        getStorageSize: vi.fn(async () => 0),
        search: vi.fn(async () => []),
        add: vi.fn(async () => {}),
        clear: vi.fn(async () => data.clear()),
        close: vi.fn(async () => {}),
      };

      const evictor = new MemoryEvictor({
        maxMemories: 2,
        policy: 'hybrid',
        evictBatchSize: 2,
        protectedImportanceThreshold: 0.9,
      });

      const result = await evictor.evictIfNeeded(store as any);
      expect(result).not.toBeNull();
      expect(result!.evicted).toBe(2);

      // Important memories should survive
      expect(data.has('important-1')).toBe(true);
      expect(data.has('important-2')).toBe(true);
      expect(data.has('expendable-1')).toBe(false);
      expect(data.has('expendable-2')).toBe(false);
    });
  });

  describe('Cross-Feature Integration', () => {
    it('should use mutex to protect config migration', async () => {
      const mutex = new AsyncMutex();
      const migrator = new ConfigMigrator();

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          mutex.withLock(() => {
            const { config } = migrator.migrate({ provider: 'openai', id: i }, '0.1.0');
            return config;
          })
        ),
      );

      expect(results.length).toBe(5);
      results.forEach(config => {
        expect(config.providers).toEqual({ default: 'openai' });
      });
    });

    it('should aggregate errors from sandboxed plugin loading', () => {
      const sandbox = new PluginSandbox({
        registerTools: true,
        registerProviders: false,
      });
      const agg = new ErrorAggregator();

      // Simulate loading multiple plugins
      const plugins = ['plugin-a', 'plugin-b', 'plugin-c'];
      for (const name of plugins) {
        sandbox.canRegisterTool(name);
        if (!sandbox.canRegisterProvider(name)) {
          agg.add(new ChainableError(
            `Plugin "${name}" denied provider registration`,
            'SANDBOX_VIOLATION',
            { component: 'plugin-sandbox' },
          ));
        }
      }

      expect(agg.count).toBe(3);
      expect(sandbox.getViolations().length).toBe(3);
    });

    it('should stream degradation report', () => {
      const eventBus = new EventBus();
      const stream = new StreamController();
      const received: any[] = [];
      stream.subscribe(e => received.push(e));

      // Build degradation report and emit it
      const gd = new GracefulDegradation();
      gd.checkProvider('anthropic', true);
      gd.checkMemory(false);
      gd.checkOptionalDep('eslint', false);

      const report = gd.getReport();
      stream.emit('stage:progress', {
        type: 'degradation-report',
        report,
      });

      expect(received.length).toBe(1);
      expect(received[0].data.report.level).toBe('degraded');

      stream.close();
    });
  });
});
