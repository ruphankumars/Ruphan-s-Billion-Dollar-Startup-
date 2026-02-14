/**
 * SemanticScheduler — Unit Tests
 *
 * Tests semantic task scheduling: lifecycle, keyword-based classification,
 * task scheduling/dequeuing, resource profiles, queue management,
 * fair-share rebalancing, and statistics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SemanticScheduler } from '../../../src/scheduler/semantic-scheduler.js';

describe('SemanticScheduler', () => {
  let scheduler: SemanticScheduler;

  beforeEach(() => {
    scheduler = new SemanticScheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('creates scheduler with default config', () => {
      expect(scheduler.isRunning()).toBe(false);
      expect(scheduler.getStats().totalScheduled).toBe(0);
    });

    it('merges partial config', () => {
      const custom = new SemanticScheduler({ maxQueueSize: 10 });
      expect(custom.isRunning()).toBe(false);
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('start / stop lifecycle', () => {
    it('starts and emits started event', () => {
      const handler = vi.fn();
      scheduler.on('scheduler:started', handler);
      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('stops and emits stopped event', () => {
      const handler = vi.fn();
      scheduler.on('scheduler:stopped', handler);
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('double start is idempotent', () => {
      const handler = vi.fn();
      scheduler.on('scheduler:started', handler);
      scheduler.start();
      scheduler.start();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Classification ─────────────────────────────────────────

  describe('classifyTask', () => {
    it('classifies code review descriptions', () => {
      expect(scheduler.classifyTask('Review this pull request for bugs')).toBe('code-review');
    });

    it('classifies code generation descriptions', () => {
      expect(scheduler.classifyTask('Generate a REST API scaffold')).toBe('code-generation');
    });

    it('classifies debugging descriptions', () => {
      expect(scheduler.classifyTask('Debug this crash exception')).toBe('debugging');
    });

    it('classifies testing descriptions', () => {
      expect(scheduler.classifyTask('Write unit test specs with coverage')).toBe('testing');
    });

    it('classifies documentation descriptions', () => {
      expect(scheduler.classifyTask('Document the API with jsdoc comments')).toBe('documentation');
    });

    it('classifies research descriptions', () => {
      expect(scheduler.classifyTask('Research and investigate best practices')).toBe('research');
    });

    it('classifies translation descriptions', () => {
      expect(scheduler.classifyTask('Translate this to French and localize')).toBe('translation');
    });

    it('classifies summarization descriptions', () => {
      expect(scheduler.classifyTask('Summarize this report into a brief digest')).toBe('summarization');
    });

    it('returns custom for unrecognized descriptions', () => {
      expect(scheduler.classifyTask('xyzzy foobar baz')).toBe('custom');
    });
  });

  // ── Scheduling ─────────────────────────────────────────────

  describe('schedule', () => {
    it('schedules a task and returns it with generated id and queued status', () => {
      const task = scheduler.schedule({
        description: 'Review code changes',
        semanticType: 'code-review',
        priority: 5,
        estimatedTokens: 2000,
        estimatedDuration: 30000,
        requiredCapabilities: [],
      });

      expect(task.id).toMatch(/^task-/);
      expect(task.status).toBe('queued');
      expect(task.semanticType).toBe('code-review');
      expect(task.assignedResources).toBeDefined();
    });

    it('auto-classifies when semanticType is not provided', () => {
      const task = scheduler.schedule({
        description: 'Debug this crash',
        semanticType: '' as any,
        priority: 5,
        estimatedTokens: 1000,
        estimatedDuration: 10000,
        requiredCapabilities: [],
      });

      expect(task.semanticType).toBe('debugging');
    });

    it('sorts queue by priority (highest first)', () => {
      scheduler.schedule({
        description: 'low',
        semanticType: 'custom',
        priority: 1,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      scheduler.schedule({
        description: 'high',
        semanticType: 'custom',
        priority: 10,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });

      const queue = scheduler.getQueue();
      expect(queue.tasks[0].priority).toBe(10);
      expect(queue.tasks[1].priority).toBe(1);
    });

    it('throws when queue is full', () => {
      const small = new SemanticScheduler({ maxQueueSize: 2 });

      small.schedule({
        description: 'a',
        semanticType: 'custom',
        priority: 1,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      small.schedule({
        description: 'b',
        semanticType: 'custom',
        priority: 1,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });

      expect(() =>
        small.schedule({
          description: 'c',
          semanticType: 'custom',
          priority: 1,
          estimatedTokens: 100,
          estimatedDuration: 1000,
          requiredCapabilities: [],
        }),
      ).toThrow(/Queue is full/);
    });

    it('assigns resource profile matching the semantic type', () => {
      const task = scheduler.schedule({
        description: 'generate code',
        semanticType: 'code-generation',
        priority: 5,
        estimatedTokens: 4000,
        estimatedDuration: 60000,
        requiredCapabilities: [],
      });

      expect(task.assignedResources!.modelTier).toBe('premium');
      expect(task.assignedResources!.memoryMb).toBe(1024);
    });
  });

  // ── Dequeue ────────────────────────────────────────────────

  describe('dequeue', () => {
    it('returns null when queue is empty', () => {
      expect(scheduler.dequeue()).toBeNull();
    });

    it('dequeues highest-priority task and sets status to running', () => {
      scheduler.schedule({
        description: 'low',
        semanticType: 'custom',
        priority: 1,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      scheduler.schedule({
        description: 'high',
        semanticType: 'custom',
        priority: 10,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });

      const task = scheduler.dequeue();
      expect(task).not.toBeNull();
      expect(task!.priority).toBe(10);
      expect(task!.status).toBe('running');
    });

    it('tracks running tasks', () => {
      scheduler.schedule({
        description: 'a',
        semanticType: 'custom',
        priority: 5,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });

      scheduler.dequeue();
      expect(scheduler.getRunningTasks()).toHaveLength(1);
    });

    it('emits task:dequeued event', () => {
      const handler = vi.fn();
      scheduler.on('scheduler:task:dequeued', handler);

      scheduler.schedule({
        description: 'a',
        semanticType: 'custom',
        priority: 5,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      scheduler.dequeue();

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── Complete Task ──────────────────────────────────────────

  describe('completeTask', () => {
    it('marks task completed and moves to history', () => {
      scheduler.schedule({
        description: 'work',
        semanticType: 'custom',
        priority: 5,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      const task = scheduler.dequeue()!;
      const completed = scheduler.completeTask(task.id, true);

      expect(completed.status).toBe('completed');
      expect(scheduler.getRunningTasks()).toHaveLength(0);
    });

    it('marks task failed', () => {
      scheduler.schedule({
        description: 'failing',
        semanticType: 'custom',
        priority: 5,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      const task = scheduler.dequeue()!;
      const failed = scheduler.completeTask(task.id, false);

      expect(failed.status).toBe('failed');
    });

    it('throws for non-existent running task', () => {
      expect(() => scheduler.completeTask('ghost', true)).toThrow(/not found/);
    });
  });

  // ── Resource Profiles ──────────────────────────────────────

  describe('getResourceProfile / setResourceProfile', () => {
    it('returns default profile for a semantic type', () => {
      const profile = scheduler.getResourceProfile('code-generation');
      expect(profile.modelTier).toBe('premium');
      expect(profile.memoryMb).toBe(1024);
      expect(profile.maxTokens).toBe(8000);
    });

    it('sets a custom resource profile', () => {
      scheduler.setResourceProfile('custom', {
        cpuWeight: 0.9,
        memoryMb: 4096,
        gpuShare: 0.5,
        modelTier: 'premium',
        maxTokens: 16000,
        maxDuration: 300000,
      });

      const profile = scheduler.getResourceProfile('custom');
      expect(profile.memoryMb).toBe(4096);
      expect(profile.maxTokens).toBe(16000);
    });
  });

  // ── Queue Management / Rebalance ───────────────────────────

  describe('getQueue / rebalance', () => {
    it('getQueue returns total estimated cost and duration', () => {
      scheduler.schedule({
        description: 'a',
        semanticType: 'custom',
        priority: 5,
        estimatedTokens: 2000,
        estimatedDuration: 30000,
        requiredCapabilities: [],
      });

      const queue = scheduler.getQueue();
      expect(queue.tasks).toHaveLength(1);
      expect(queue.totalEstimatedDuration).toBe(30000);
      expect(queue.totalEstimatedCost).toBeGreaterThan(0);
    });

    it('rebalance re-sorts queue and emits event', () => {
      const handler = vi.fn();
      scheduler.on('scheduler:rebalanced', handler);

      scheduler.schedule({
        description: 'a',
        semanticType: 'custom',
        priority: 3,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      scheduler.schedule({
        description: 'b',
        semanticType: 'custom',
        priority: 7,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });

      scheduler.rebalance();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('rebalance with fairShare disabled just sorts by priority', () => {
      const noFair = new SemanticScheduler({ fairShareEnabled: false });
      noFair.schedule({
        description: 'low',
        semanticType: 'custom',
        priority: 1,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      noFair.schedule({
        description: 'high',
        semanticType: 'custom',
        priority: 10,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });

      noFair.rebalance();
      const queue = noFair.getQueue();
      expect(queue.tasks[0].priority).toBe(10);
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns zeroed stats initially', () => {
      const stats = scheduler.getStats();
      expect(stats.totalScheduled).toBe(0);
      expect(stats.totalCompleted).toBe(0);
      expect(stats.totalFailed).toBe(0);
      expect(stats.avgWaitTime).toBe(0);
      expect(stats.avgExecutionTime).toBe(0);
      expect(stats.resourceUtilization).toBe(0);
      expect(stats.queueDepth).toBe(0);
    });

    it('tracks totalScheduled', () => {
      scheduler.schedule({
        description: 'a',
        semanticType: 'custom',
        priority: 5,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      expect(scheduler.getStats().totalScheduled).toBe(1);
    });

    it('tracks queueDepth separately from running', () => {
      scheduler.schedule({
        description: 'a',
        semanticType: 'custom',
        priority: 5,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      scheduler.schedule({
        description: 'b',
        semanticType: 'custom',
        priority: 3,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });

      scheduler.dequeue(); // One moves to running

      expect(scheduler.getStats().queueDepth).toBe(1);
    });

    it('tracks completed and failed counts', () => {
      scheduler.schedule({
        description: 'pass',
        semanticType: 'custom',
        priority: 5,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });
      scheduler.schedule({
        description: 'fail',
        semanticType: 'custom',
        priority: 3,
        estimatedTokens: 100,
        estimatedDuration: 1000,
        requiredCapabilities: [],
      });

      const t1 = scheduler.dequeue()!;
      scheduler.completeTask(t1.id, true);
      const t2 = scheduler.dequeue()!;
      scheduler.completeTask(t2.id, false);

      const stats = scheduler.getStats();
      expect(stats.totalCompleted).toBe(1);
      expect(stats.totalFailed).toBe(1);
    });
  });
});
