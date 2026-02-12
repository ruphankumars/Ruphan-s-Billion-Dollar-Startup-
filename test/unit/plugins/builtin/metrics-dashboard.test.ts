/**
 * Tests for MetricsDashboardPlugin
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MetricsDashboardPlugin,
  MetricsStore,
} from '../../../../src/plugins/builtin/metrics-dashboard-plugin.js';
import { PluginRegistry } from '../../../../src/plugins/registry.js';

describe('MetricsDashboardPlugin', () => {
  describe('MetricsStore', () => {
    let store: MetricsStore;

    beforeEach(() => {
      store = new MetricsStore(100);
    });

    it('should record and retrieve entries', () => {
      store.record({
        executionId: 'test-1',
        timestamp: Date.now(),
        tokensUsed: 5000,
        costUsd: 0.015,
        durationMs: 3200,
        stagesCompleted: 8,
        agentCount: 3,
      });

      expect(store.size).toBe(1);
      expect(store.getLatest(1)[0].executionId).toBe('test-1');
    });

    it('should calculate averages correctly', () => {
      store.record({ executionId: '1', timestamp: 1, tokensUsed: 100, costUsd: 0.01, durationMs: 1000, stagesCompleted: 8, agentCount: 1 });
      store.record({ executionId: '2', timestamp: 2, tokensUsed: 200, costUsd: 0.02, durationMs: 2000, stagesCompleted: 8, agentCount: 1 });
      store.record({ executionId: '3', timestamp: 3, tokensUsed: 300, costUsd: 0.03, durationMs: 3000, stagesCompleted: 8, agentCount: 1 });

      const avg = store.getAverages();
      expect(avg.avgTokens).toBe(200);
      expect(avg.avgCost).toBe(0.02);
      expect(avg.avgDuration).toBe(2000);
    });

    it('should respect max entries limit', () => {
      const smallStore = new MetricsStore(3);
      for (let i = 0; i < 5; i++) {
        smallStore.record({ executionId: `${i}`, timestamp: i, tokensUsed: i * 100, costUsd: 0, durationMs: 0, stagesCompleted: 8, agentCount: 1 });
      }
      expect(smallStore.size).toBe(3);
      expect(smallStore.getLatest(1)[0].executionId).toBe('4');
    });

    it('should handle empty store', () => {
      const avg = store.getAverages();
      expect(avg.avgTokens).toBe(0);
      expect(avg.avgCost).toBe(0);
      expect(avg.avgDuration).toBe(0);
      expect(store.getLatest(5)).toHaveLength(0);
    });

    it('should clear all entries', () => {
      store.record({ executionId: '1', timestamp: 1, tokensUsed: 100, costUsd: 0.01, durationMs: 1000, stagesCompleted: 8, agentCount: 1 });
      expect(store.size).toBe(1);
      store.clear();
      expect(store.size).toBe(0);
    });
  });

  describe('Plugin Registration', () => {
    it('should register tools and gates via PluginRegistry', async () => {
      const registry = new PluginRegistry();
      await registry.load(MetricsDashboardPlugin);

      expect(registry.isLoaded('cortexos-metrics-dashboard')).toBe(true);

      const tools = registry.getTools();
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('metrics_snapshot');
      expect(toolNames).toContain('metrics_history');

      const gates = registry.getGates();
      expect(gates.has('performance-budget')).toBe(true);
    });

    it('should execute metrics_snapshot tool', async () => {
      const registry = new PluginRegistry();
      await registry.load(MetricsDashboardPlugin);

      const tool = registry.getTool('metrics_snapshot');
      expect(tool).toBeDefined();

      const result = await tool!.execute({ count: 5 }, { workingDir: '/tmp', executionId: 'test' });
      expect(result.success).toBe(true);

      const data = JSON.parse(result.output);
      expect(data.totalRecorded).toBe(0);
      expect(data.recentExecutions).toHaveLength(0);
    });

    it('should execute metrics_history tool', async () => {
      const registry = new PluginRegistry();
      await registry.load(MetricsDashboardPlugin);

      const tool = registry.getTool('metrics_history');
      expect(tool).toBeDefined();

      const result = await tool!.execute({ format: 'summary' }, { workingDir: '/tmp', executionId: 'test' });
      expect(result.success).toBe(true);

      const data = JSON.parse(result.output);
      expect(data.executionCount).toBe(0);
    });
  });
});
