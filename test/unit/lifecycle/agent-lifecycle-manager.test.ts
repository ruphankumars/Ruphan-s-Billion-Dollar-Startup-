import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentLifecycleManager } from '../../../src/lifecycle/agent-lifecycle-manager.js';

/** Helper to build a minimal agent manifest input. */
function makeAgentInput(overrides?: Record<string, unknown>) {
  return {
    name: 'test-agent',
    version: '1.0.0',
    description: 'A test agent',
    author: 'tester',
    capabilities: ['code-gen', 'review'],
    requiredTools: ['git'],
    requiredProviders: ['anthropic'],
    configSchema: {},
    tags: ['test'],
    ...overrides,
  };
}

describe('AgentLifecycleManager', () => {
  let manager: AgentLifecycleManager;

  beforeEach(() => {
    manager = new AgentLifecycleManager({ healthCheckIntervalMs: 0 });
  });

  afterEach(() => {
    manager.stop();
  });

  // ── Constructor ────────────────────────────────────────────

  describe('constructor', () => {
    it('should create an instance with default config', () => {
      const m = new AgentLifecycleManager();
      expect(m).toBeInstanceOf(AgentLifecycleManager);
      expect(m.isRunning()).toBe(false);
    });

    it('should accept custom config overrides', () => {
      const m = new AgentLifecycleManager({ maxAgents: 5 });
      m.start();
      for (let i = 0; i < 5; i++) {
        m.registerAgent(makeAgentInput({ name: `agent-${i}` }));
      }
      expect(() => m.registerAgent(makeAgentInput({ name: 'agent-overflow' }))).toThrow(
        'Maximum agent limit reached',
      );
      m.stop();
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should start and report running', () => {
      expect(manager.isRunning()).toBe(false);
      manager.start();
      expect(manager.isRunning()).toBe(true);
    });

    it('should stop and report not running', () => {
      manager.start();
      manager.stop();
      expect(manager.isRunning()).toBe(false);
    });

    it('should emit lifecycle events on start and stop', () => {
      const startSpy = vi.fn();
      const stopSpy = vi.fn();
      manager.on('lifecycle:manager:started', startSpy);
      manager.on('lifecycle:manager:stopped', stopSpy);

      manager.start();
      expect(startSpy).toHaveBeenCalledTimes(1);

      manager.stop();
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Agent Registration ─────────────────────────────────────

  describe('registerAgent', () => {
    it('should register an agent in draft phase', () => {
      manager.start();
      const agent = manager.registerAgent(makeAgentInput());
      expect(agent.id).toMatch(/^agent_/);
      expect(agent.phase).toBe('draft');
      expect(agent.name).toBe('test-agent');
      expect(agent.version).toBe('1.0.0');
      expect(agent.previousVersions).toEqual([]);
      expect(agent.createdAt).toBeGreaterThan(0);
    });

    it('should throw when exceeding max agents', () => {
      const m = new AgentLifecycleManager({ maxAgents: 1, healthCheckIntervalMs: 0 });
      m.start();
      m.registerAgent(makeAgentInput());
      expect(() => m.registerAgent(makeAgentInput())).toThrow('Maximum agent limit reached');
      m.stop();
    });
  });

  // ── Phase Transitions ──────────────────────────────────────

  describe('phase transitions', () => {
    let agentId: string;

    beforeEach(() => {
      manager.start();
      const agent = manager.registerAgent(makeAgentInput());
      agentId = agent.id;
    });

    it('should publish a draft agent', () => {
      const published = manager.publishAgent(agentId);
      expect(published.phase).toBe('published');
    });

    it('should throw when publishing a non-draft agent', () => {
      manager.publishAgent(agentId);
      expect(() => manager.publishAgent(agentId)).toThrow("expected phase 'draft'");
    });

    it('should deploy a published agent', () => {
      manager.publishAgent(agentId);
      const deployment = manager.deployAgent(agentId, 'staging');
      expect(deployment.id).toMatch(/^deploy_/);
      expect(deployment.agentId).toBe(agentId);
      expect(deployment.environment).toBe('staging');
      expect(deployment.status).toBe('deploying');

      const agent = manager.getAgent(agentId);
      expect(agent!.phase).toBe('deployed');
    });

    it('should throw when deploying a draft agent', () => {
      expect(() => manager.deployAgent(agentId, 'production')).toThrow(
        "expected phase 'published' or 'paused'",
      );
    });

    it('should start a deployed agent', () => {
      manager.publishAgent(agentId);
      const deployment = manager.deployAgent(agentId, 'production');
      const started = manager.startAgent(deployment.id);

      expect(started.status).toBe('active');
      const agent = manager.getAgent(agentId);
      expect(agent!.phase).toBe('running');
    });

    it('should throw when starting an already active deployment', () => {
      manager.publishAgent(agentId);
      const deployment = manager.deployAgent(agentId, 'production');
      manager.startAgent(deployment.id);
      expect(() => manager.startAgent(deployment.id)).toThrow("expected status 'deploying'");
    });

    it('should pause a running agent', () => {
      manager.publishAgent(agentId);
      const deployment = manager.deployAgent(agentId, 'production');
      manager.startAgent(deployment.id);

      const paused = manager.pauseAgent(agentId);
      expect(paused.phase).toBe('paused');
    });

    it('should throw when pausing a non-running agent', () => {
      expect(() => manager.pauseAgent(agentId)).toThrow("expected phase 'running'");
    });

    it('should retire an agent and mark active deployments as failed', () => {
      manager.publishAgent(agentId);
      const deployment = manager.deployAgent(agentId, 'staging');
      manager.startAgent(deployment.id);

      const retired = manager.retireAgent(agentId);
      expect(retired.phase).toBe('retired');

      const dep = manager.getDeployment(deployment.id);
      expect(dep!.status).toBe('failed');
    });

    it('should throw when retiring an already retired agent', () => {
      manager.retireAgent(agentId);
      expect(() => manager.retireAgent(agentId)).toThrow('already retired');
    });
  });

  // ── Rollback & Versioning ──────────────────────────────────

  describe('rollback and versioning', () => {
    let agentId: string;

    beforeEach(() => {
      manager.start();
      const agent = manager.registerAgent(makeAgentInput());
      agentId = agent.id;
    });

    it('should update version and track previous versions', () => {
      const updated = manager.updateVersion(agentId, '2.0.0', 'Major update');
      expect(updated.version).toBe('2.0.0');
      expect(updated.previousVersions).toContain('1.0.0');
    });

    it('should rollback to the previous version', () => {
      manager.updateVersion(agentId, '2.0.0');
      manager.publishAgent(agentId);
      const deployment = manager.deployAgent(agentId, 'production');
      manager.startAgent(deployment.id);

      const rollbackDeployment = manager.rollbackAgent(agentId);
      expect(rollbackDeployment.agentVersion).toBe('1.0.0');
      expect(rollbackDeployment.status).toBe('active');
      expect(rollbackDeployment.rollbackFrom).toBe(deployment.id);

      const agent = manager.getAgent(agentId);
      expect(agent!.version).toBe('1.0.0');
      expect(agent!.phase).toBe('running');
    });

    it('should throw when rolling back with no previous versions', () => {
      expect(() => manager.rollbackAgent(agentId)).toThrow('no previous versions');
    });

    it('should increment totalRollbacks in stats', () => {
      manager.updateVersion(agentId, '2.0.0');
      manager.publishAgent(agentId);
      const deployment = manager.deployAgent(agentId, 'production');
      manager.startAgent(deployment.id);
      manager.rollbackAgent(agentId);

      const stats = manager.getStats();
      expect(stats.totalRollbacks).toBe(1);
    });
  });

  // ── Health Checks ──────────────────────────────────────────

  describe('runHealthCheck', () => {
    it('should pass health check for active running agent', () => {
      manager.start();
      const agent = manager.registerAgent(makeAgentInput());
      manager.publishAgent(agent.id);
      const deployment = manager.deployAgent(agent.id, 'production');
      manager.startAgent(deployment.id);

      const check = manager.runHealthCheck(deployment.id);
      expect(check.passed).toBe(true);
      expect(check.name).toBe('basic-liveness');
      expect(check.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should fail health check for non-active deployment', () => {
      manager.start();
      const agent = manager.registerAgent(makeAgentInput());
      manager.publishAgent(agent.id);
      const deployment = manager.deployAgent(agent.id, 'production');
      // Do not start -- deployment status is "deploying"

      const check = manager.runHealthCheck(deployment.id);
      expect(check.passed).toBe(false);
    });

    it('should throw for non-existent deployment', () => {
      manager.start();
      expect(() => manager.runHealthCheck('deploy_fake')).toThrow('Deployment not found');
    });
  });

  // ── Metrics ────────────────────────────────────────────────

  describe('recordMetrics / getMetrics', () => {
    it('should record and retrieve metrics for an agent', () => {
      manager.start();
      const agent = manager.registerAgent(makeAgentInput());

      const now = Date.now();
      manager.recordMetrics(agent.id, {
        agentId: agent.id,
        tasksCompleted: 10,
        tasksFailed: 1,
        avgDurationMs: 500,
        avgQuality: 0.9,
        totalTokens: 5000,
        totalCost: 0.5,
        uptimePercent: 99.5,
        slaCompliance: 0.95,
        periodStart: now - 60000,
        periodEnd: now,
      });

      const metrics = manager.getMetrics(agent.id);
      expect(metrics.length).toBe(1);
      expect(metrics[0].tasksCompleted).toBe(10);
      expect(metrics[0].slaCompliance).toBe(0.95);
    });

    it('should throw when recording metrics for non-existent agent', () => {
      manager.start();
      expect(() =>
        manager.recordMetrics('fake-id', {
          agentId: 'fake-id',
          tasksCompleted: 0,
          tasksFailed: 0,
          avgDurationMs: 0,
          avgQuality: 0,
          totalTokens: 0,
          totalCost: 0,
          uptimePercent: 0,
          slaCompliance: 0,
          periodStart: 0,
          periodEnd: 0,
        }),
      ).toThrow('Agent not found');
    });
  });

  // ── Queries ────────────────────────────────────────────────

  describe('queries', () => {
    it('should get agent by ID', () => {
      manager.start();
      const agent = manager.registerAgent(makeAgentInput());
      expect(manager.getAgent(agent.id)).toBeDefined();
      expect(manager.getAgent('nonexistent')).toBeUndefined();
    });

    it('should list agents filtered by phase', () => {
      manager.start();
      manager.registerAgent(makeAgentInput({ name: 'a1' }));
      const a2 = manager.registerAgent(makeAgentInput({ name: 'a2' }));
      manager.publishAgent(a2.id);

      const drafts = manager.listAgents({ phase: 'draft' });
      expect(drafts.length).toBe(1);

      const published = manager.listAgents({ phase: 'published' });
      expect(published.length).toBe(1);
    });

    it('should list deployments for an agent', () => {
      manager.start();
      const agent = manager.registerAgent(makeAgentInput());
      manager.publishAgent(agent.id);
      manager.deployAgent(agent.id, 'staging');

      const deployments = manager.listDeployments(agent.id);
      expect(deployments.length).toBe(1);
    });
  });

  // ── Stats ──────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      const stats = manager.getStats();
      expect(stats.totalAgents).toBe(0);
      expect(stats.totalDeployments).toBe(0);
      expect(stats.activeDeployments).toBe(0);
      expect(stats.totalRollbacks).toBe(0);
      expect(stats.avgSlaCompliance).toBe(0);
    });

    it('should track agents by phase', () => {
      manager.start();
      const a1 = manager.registerAgent(makeAgentInput({ name: 'a1' }));
      manager.registerAgent(makeAgentInput({ name: 'a2' }));
      manager.publishAgent(a1.id);

      const stats = manager.getStats();
      expect(stats.totalAgents).toBe(2);
      expect(stats.byPhase.draft).toBe(1);
      expect(stats.byPhase.published).toBe(1);
    });

    it('should track active deployments', () => {
      manager.start();
      const agent = manager.registerAgent(makeAgentInput());
      manager.publishAgent(agent.id);
      const dep = manager.deployAgent(agent.id, 'production');
      manager.startAgent(dep.id);

      const stats = manager.getStats();
      expect(stats.totalDeployments).toBe(1);
      expect(stats.activeDeployments).toBe(1);
    });
  });

  // ── Error Cases ────────────────────────────────────────────

  describe('error cases', () => {
    it('should throw when operating on a non-existent agent', () => {
      manager.start();
      expect(() => manager.publishAgent('nope')).toThrow('Agent not found');
      expect(() => manager.deployAgent('nope', 'staging')).toThrow('Agent not found');
      expect(() => manager.pauseAgent('nope')).toThrow('Agent not found');
      expect(() => manager.retireAgent('nope')).toThrow('Agent not found');
      expect(() => manager.rollbackAgent('nope')).toThrow('Agent not found');
      expect(() => manager.updateVersion('nope', '2.0.0')).toThrow('Agent not found');
    });
  });
});
