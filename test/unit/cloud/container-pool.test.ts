/**
 * ContainerPool — Unit Tests
 *
 * Tests task submission, cancellation, querying, statistics, and shutdown.
 * Uses a real DockerManager instance with methods stubbed via vi.spyOn.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContainerPool } from '../../../src/cloud/container-pool.js';
import { DockerManager } from '../../../src/cloud/docker-manager.js';
import { EnvironmentRegistry } from '../../../src/cloud/environment-registry.js';

// ── Helpers ────────────────────────────────────────────────────

function createMockDockerManager(): DockerManager {
  const dm = new DockerManager();

  vi.spyOn(dm, 'isAvailable').mockResolvedValue(true);

  vi.spyOn(dm, 'createContainer').mockResolvedValue({
    id: 'ctx_mock1234',
    containerId: 'abcdef123456',
    environmentId: 'node20',
    status: 'creating',
    createdAt: Date.now(),
  });

  vi.spyOn(dm, 'startContainer').mockResolvedValue(undefined);
  vi.spyOn(dm, 'stopContainer').mockResolvedValue(undefined);
  vi.spyOn(dm, 'removeContainer').mockResolvedValue(undefined);
  vi.spyOn(dm, 'getContainerLogs').mockResolvedValue('task output\n');
  vi.spyOn(dm, 'cleanup').mockResolvedValue(undefined);

  // waitForContainer resolves immediately with exit code 0
  vi.spyOn(dm, 'waitForContainer').mockResolvedValue({
    exitCode: 0,
    status: 'completed',
  });

  return dm;
}

function createPool(
  overrides: Partial<{
    maxContainers: number;
    docker: DockerManager;
    environments: EnvironmentRegistry;
  }> = {},
): ContainerPool {
  const docker = overrides.docker ?? createMockDockerManager();
  const environments = overrides.environments ?? new EnvironmentRegistry();

  return new ContainerPool({
    maxContainers: overrides.maxContainers ?? 5,
    defaultEnvironment: 'node20',
    containerTimeout: 60_000,
    docker,
    environments,
  });
}

// ── Test suite ─────────────────────────────────────────────────

describe('ContainerPool', () => {
  let pool: ContainerPool;
  let docker: DockerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    docker = createMockDockerManager();
    pool = createPool({ docker });
  });

  // ── submit ─────────────────────────────────────────────────

  describe('submit', () => {
    it('creates a task with queued status', async () => {
      // Set maxContainers to 0 so the task stays queued
      const limitedPool = createPool({ maxContainers: 0, docker });
      const task = await limitedPool.submit({ prompt: 'test prompt' });

      expect(task).toBeDefined();
      expect(task.id).toMatch(/^cloud_/);
      expect(task.prompt).toBe('test prompt');
      expect(task.status).toBe('queued');
      expect(task.environmentId).toBe('node20');
      expect(task.createdAt).toBeGreaterThan(0);
    });

    it('with available capacity starts execution', async () => {
      const task = await pool.submit({ prompt: 'run this' });

      expect(task).toBeDefined();
      expect(task.id).toMatch(/^cloud_/);

      // Give the async executeTask a tick to start
      await vi.waitFor(() => {
        expect(docker.createContainer).toHaveBeenCalled();
      });

      expect(docker.startContainer).toHaveBeenCalled();
    });
  });

  // ── cancel ─────────────────────────────────────────────────

  describe('cancel', () => {
    it('cancels a queued task', async () => {
      const limitedPool = createPool({ maxContainers: 0, docker });
      const task = await limitedPool.submit({ prompt: 'will be cancelled' });

      expect(task.status).toBe('queued');

      const cancelled = await limitedPool.cancel(task.id);

      expect(cancelled).toBe(true);

      const updated = limitedPool.getTask(task.id);
      expect(updated?.status).toBe('cancelled');
    });

    it('returns false for non-existent task', async () => {
      const result = await pool.cancel('nonexistent-id');
      expect(result).toBe(false);
    });
  });

  // ── getTask ────────────────────────────────────────────────

  describe('getTask', () => {
    it('returns task by ID', async () => {
      const limitedPool = createPool({ maxContainers: 0, docker });
      const task = await limitedPool.submit({ prompt: 'find me' });

      const found = limitedPool.getTask(task.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(task.id);
      expect(found!.prompt).toBe('find me');
    });

    it('returns undefined for unknown ID', () => {
      expect(pool.getTask('nonexistent')).toBeUndefined();
    });
  });

  // ── getTasks ───────────────────────────────────────────────

  describe('getTasks', () => {
    it('returns all tasks', async () => {
      const limitedPool = createPool({ maxContainers: 0, docker });
      await limitedPool.submit({ prompt: 'task 1' });
      await limitedPool.submit({ prompt: 'task 2' });
      await limitedPool.submit({ prompt: 'task 3' });

      const tasks = limitedPool.getTasks();

      expect(tasks).toHaveLength(3);
    });

    it('filters by status', async () => {
      const limitedPool = createPool({ maxContainers: 0, docker });
      const task1 = await limitedPool.submit({ prompt: 'queued task' });
      const task2 = await limitedPool.submit({ prompt: 'will cancel' });

      await limitedPool.cancel(task2.id);

      const queuedTasks = limitedPool.getTasks({ status: 'queued' });
      expect(queuedTasks).toHaveLength(1);
      expect(queuedTasks[0].id).toBe(task1.id);

      const cancelledTasks = limitedPool.getTasks({ status: 'cancelled' });
      expect(cancelledTasks).toHaveLength(1);
      expect(cancelledTasks[0].id).toBe(task2.id);
    });
  });

  // ── getStats ───────────────────────────────────────────────

  describe('getStats', () => {
    it('returns pool statistics', async () => {
      const limitedPool = createPool({ maxContainers: 0, docker });
      await limitedPool.submit({ prompt: 'stat task 1' });
      await limitedPool.submit({ prompt: 'stat task 2' });

      const stats = limitedPool.getStats();

      expect(stats).toEqual({
        activeContainers: 0,
        maxContainers: 0,
        queuedTasks: 2,
        totalTasks: 2,
        completedTasks: 0,
        failedTasks: 0,
      });
    });
  });

  // ── shutdown ───────────────────────────────────────────────

  describe('shutdown', () => {
    it('cancels queued tasks and cleans up containers', async () => {
      const limitedPool = createPool({ maxContainers: 0, docker });
      await limitedPool.submit({ prompt: 'queued 1' });
      await limitedPool.submit({ prompt: 'queued 2' });

      expect(limitedPool.getTasks({ status: 'queued' })).toHaveLength(2);

      await limitedPool.shutdown();

      // All queued tasks should now be cancelled
      const queued = limitedPool.getTasks({ status: 'queued' });
      expect(queued).toHaveLength(0);

      const cancelled = limitedPool.getTasks({ status: 'cancelled' });
      expect(cancelled).toHaveLength(2);

      // Docker cleanup should have been called
      expect(docker.cleanup).toHaveBeenCalledWith(true);
    });
  });

  // ── maxContainers limit ────────────────────────────────────

  describe('pool respects maxContainers limit', () => {
    it('queues tasks when maxContainers is reached', async () => {
      // Create a pool that never finishes executing (waitForContainer hangs)
      const slowDocker = createMockDockerManager();
      vi.spyOn(slowDocker, 'waitForContainer').mockReturnValue(
        new Promise(() => {
          // Never resolves -- simulates a long-running container
        }),
      );

      const smallPool = createPool({ maxContainers: 1, docker: slowDocker });

      // First task should start executing (uses the 1 slot)
      const task1 = await smallPool.submit({ prompt: 'first task' });

      // Give async execution a tick
      await new Promise((r) => setTimeout(r, 10));

      // Second task should be queued since maxContainers=1 and slot is occupied
      const task2 = await smallPool.submit({ prompt: 'second task' });

      // task2 should remain queued
      const stats = smallPool.getStats();
      expect(stats.activeContainers).toBe(1);
      expect(stats.queuedTasks).toBe(1);

      const queuedTasks = smallPool.getTasks({ status: 'queued' });
      expect(queuedTasks).toHaveLength(1);
      expect(queuedTasks[0].id).toBe(task2.id);
    });
  });
});
