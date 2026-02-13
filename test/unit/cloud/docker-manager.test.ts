/**
 * DockerManager — Unit Tests
 *
 * Tests Docker container lifecycle management with mocked child_process.execFile.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock child_process before imports using vi.hoisted ───────────
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

import { DockerManager } from '../../../src/cloud/docker-manager.js';

// ── Helpers ────────────────────────────────────────────────────

/** Default mock: callback resolves with (null, 'mock-output', '') */
function setupExecSuccess(stdout = 'mock-output') {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, stdout, '');
    },
  );
}

/** Mock that calls back with an error */
function setupExecFailure(message = 'command not found') {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error(message), '', message);
    },
  );
}

// ── Test suite ─────────────────────────────────────────────────

describe('DockerManager', () => {
  let dm: DockerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    setupExecSuccess();
    dm = new DockerManager();
  });

  // ── isAvailable ────────────────────────────────────────────

  describe('isAvailable', () => {
    it('returns true when docker responds', async () => {
      setupExecSuccess('24.0.7');
      const result = await dm.isAvailable();

      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        'docker',
        ['version', '--format', '{{.Server.Version}}'],
        expect.objectContaining({ timeout: 30_000 }),
        expect.any(Function),
      );
    });

    it('returns false when docker not found', async () => {
      setupExecFailure('command not found: docker');
      const result = await dm.isAvailable();

      expect(result).toBe(false);
    });
  });

  // ── pullImage ──────────────────────────────────────────────

  describe('pullImage', () => {
    it('calls docker pull with the image name', async () => {
      await dm.pullImage('node:20-slim');

      expect(mockExecFile).toHaveBeenCalledWith(
        'docker',
        ['pull', 'node:20-slim'],
        expect.objectContaining({ timeout: 120_000 }),
        expect.any(Function),
      );
    });
  });

  // ── imageExists ────────────────────────────────────────────

  describe('imageExists', () => {
    it('returns true when the image exists locally', async () => {
      setupExecSuccess('image-info');
      const result = await dm.imageExists('node:20-slim');

      expect(result).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        'docker',
        ['image', 'inspect', 'node:20-slim'],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('returns false when the image does not exist', async () => {
      setupExecFailure('No such image');
      const result = await dm.imageExists('nonexistent:latest');

      expect(result).toBe(false);
    });
  });

  // ── createContainer ────────────────────────────────────────

  describe('createContainer', () => {
    it('builds correct docker args with resource limits, env, and mounts', async () => {
      setupExecSuccess('abc123def456\n');

      const info = await dm.createContainer({
        environment: {
          id: 'node20',
          name: 'Node.js 20',
          description: 'Node.js 20 LTS',
          image: 'node:20-slim',
          defaultCmd: ['node'],
          env: { NODE_ENV: 'development' },
          resourceLimits: {
            cpus: 2,
            memoryMb: 2048,
            networkEnabled: false,
          },
        },
        env: { CUSTOM_VAR: 'hello' },
        mounts: [
          {
            hostPath: '/host/project',
            containerPath: '/app',
            readonly: true,
          },
        ],
        workdir: '/app',
      });

      expect(info).toBeDefined();
      expect(info.status).toBe('creating');
      expect(info.environmentId).toBe('node20');
      expect(info.containerId).toBe('abc123def456');

      // Verify the docker create args
      const callArgs = mockExecFile.mock.calls[0][1] as string[];

      expect(callArgs[0]).toBe('create');
      // Resource limits
      expect(callArgs).toContain('--cpus');
      expect(callArgs).toContain('2');
      expect(callArgs).toContain('--memory');
      expect(callArgs).toContain('2048m');
      expect(callArgs).toContain('--network');
      expect(callArgs).toContain('none');
      // Environment variables
      expect(callArgs).toContain('-e');
      expect(callArgs).toContain('NODE_ENV=development');
      expect(callArgs).toContain('CUSTOM_VAR=hello');
      // Mounts
      expect(callArgs).toContain('-v');
      expect(callArgs).toContain('/host/project:/app:ro');
      // Workdir
      expect(callArgs).toContain('-w');
      expect(callArgs).toContain('/app');
      // Image
      expect(callArgs).toContain('node:20-slim');
      // Default command appended since no explicit command
      expect(callArgs).toContain('node');
    });
  });

  // ── startContainer ─────────────────────────────────────────

  describe('startContainer', () => {
    it('starts the container and updates status', async () => {
      setupExecSuccess('container-id-12\n');
      const info = await dm.createContainer({
        environment: {
          id: 'test',
          name: 'Test',
          description: 'test env',
          image: 'alpine:latest',
        },
      });

      setupExecSuccess('');
      await dm.startContainer(info.id);

      expect(mockExecFile).toHaveBeenLastCalledWith(
        'docker',
        ['start', info.containerId],
        expect.any(Object),
        expect.any(Function),
      );

      const updated = dm.getContainer(info.id);
      expect(updated?.status).toBe('running');
      expect(updated?.startedAt).toBeGreaterThan(0);
    });
  });

  // ── stopContainer ──────────────────────────────────────────

  describe('stopContainer', () => {
    it('stops the container and updates status', async () => {
      setupExecSuccess('container-id-12\n');
      const info = await dm.createContainer({
        environment: {
          id: 'test',
          name: 'Test',
          description: 'test env',
          image: 'alpine:latest',
        },
      });

      setupExecSuccess('');
      await dm.startContainer(info.id);

      setupExecSuccess('');
      await dm.stopContainer(info.id);

      expect(mockExecFile).toHaveBeenLastCalledWith(
        'docker',
        ['stop', '-t', '10', info.containerId],
        expect.any(Object),
        expect.any(Function),
      );

      const updated = dm.getContainer(info.id);
      expect(updated?.status).toBe('stopped');
    });
  });

  // ── removeContainer ────────────────────────────────────────

  describe('removeContainer', () => {
    it('removes the container and deletes it from internal map', async () => {
      setupExecSuccess('container-id-12\n');
      const info = await dm.createContainer({
        environment: {
          id: 'test',
          name: 'Test',
          description: 'test env',
          image: 'alpine:latest',
        },
      });

      setupExecSuccess('');
      await dm.removeContainer(info.id);

      expect(mockExecFile).toHaveBeenLastCalledWith(
        'docker',
        ['rm', info.containerId],
        expect.any(Object),
        expect.any(Function),
      );

      expect(dm.getContainer(info.id)).toBeUndefined();
    });
  });

  // ── getContainerLogs ───────────────────────────────────────

  describe('getContainerLogs', () => {
    it('fetches logs for the container', async () => {
      setupExecSuccess('container-id-12\n');
      const info = await dm.createContainer({
        environment: {
          id: 'test',
          name: 'Test',
          description: 'test env',
          image: 'alpine:latest',
        },
      });

      setupExecSuccess('line1\nline2\nline3\n');
      const logs = await dm.getContainerLogs(info.id, { tail: 50 });

      expect(logs).toBe('line1\nline2\nline3\n');
      expect(mockExecFile).toHaveBeenLastCalledWith(
        'docker',
        ['logs', '--tail', '50', info.containerId],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  // ── waitForContainer ───────────────────────────────────────

  describe('waitForContainer', () => {
    it('returns exit code when container finishes', async () => {
      setupExecSuccess('container-id-12\n');
      const info = await dm.createContainer({
        environment: {
          id: 'test',
          name: 'Test',
          description: 'test env',
          image: 'alpine:latest',
        },
      });

      setupExecSuccess('0\n');
      const result = await dm.waitForContainer(info.id);

      expect(result.exitCode).toBe(0);
      expect(result.status).toBe('completed');

      expect(mockExecFile).toHaveBeenLastCalledWith(
        'docker',
        ['wait', info.containerId],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  // ── getContainers ──────────────────────────────────────────

  describe('getContainers', () => {
    it('lists all managed containers', async () => {
      setupExecSuccess('container-a-12\n');
      await dm.createContainer({
        environment: {
          id: 'env1',
          name: 'Env 1',
          description: 'first',
          image: 'alpine:latest',
        },
      });

      setupExecSuccess('container-b-12\n');
      await dm.createContainer({
        environment: {
          id: 'env2',
          name: 'Env 2',
          description: 'second',
          image: 'node:20-slim',
        },
      });

      const containers = dm.getContainers();
      expect(containers).toHaveLength(2);
      expect(containers[0].environmentId).toBe('env1');
      expect(containers[1].environmentId).toBe('env2');
    });
  });

  // ── cleanup ────────────────────────────────────────────────

  describe('cleanup', () => {
    it('removes all containers', async () => {
      setupExecSuccess('container-a-12\n');
      await dm.createContainer({
        environment: {
          id: 'env1',
          name: 'Env 1',
          description: 'first',
          image: 'alpine:latest',
        },
      });

      setupExecSuccess('container-b-12\n');
      await dm.createContainer({
        environment: {
          id: 'env2',
          name: 'Env 2',
          description: 'second',
          image: 'node:20-slim',
        },
      });

      expect(dm.getContainers()).toHaveLength(2);

      setupExecSuccess('');
      await dm.cleanup();

      expect(dm.getContainers()).toHaveLength(0);
    });
  });
});
