import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutomationEngine } from '../../../src/automation/automation-engine.js';

describe('AutomationEngine', () => {
  let engine: AutomationEngine;

  beforeEach(() => {
    engine = new AutomationEngine();
  });

  afterEach(async () => {
    await engine.stop();
  });

  it('constructor initializes all subsystems', () => {
    expect(engine).toBeDefined();
    expect(engine.scheduler).toBeDefined();
    // The property is `skills`, not `skillRegistry`
    expect(engine.skills).toBeDefined();
    expect(engine.webhooks).toBeDefined();
    expect(engine.eventTriggers).toBeDefined();
  });

  it('executeSkill returns failed record for unknown skill', async () => {
    // executeSkill(skillId, inputs?, triggeredBy?, triggerDetails?)
    const result = await engine.executeSkill('nonexistent-skill');
    expect(result).toBeDefined();
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });

  it('executeSkill with max concurrent runs exceeded', async () => {
    // Register a skill. The engine has no workflow engine set, so it will
    // complete immediately as a "dry run". We use maxConcurrentRuns from config.
    const engine2 = new AutomationEngine({ maxConcurrentRuns: 1 });

    engine2.skills.register({
      id: 'slow-skill',
      name: 'Slow Skill',
      description: 'A slow skill for testing concurrency',
      tags: [],
      workflow: { id: 'wf', version: '1.0.0', steps: [] } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Set a workflow engine that blocks
    let resolveFirst: () => void;
    const firstPromise = new Promise<void>((resolve) => { resolveFirst = resolve; });
    engine2.setWorkflowEngine({
      execute: () => firstPromise.then(() => ({ status: 'completed' })),
    } as any);

    // Start first execution (don't await — it blocks)
    const firstRun = engine2.executeSkill('slow-skill');

    // Wait a tick so the first run is in-flight
    await new Promise((r) => setTimeout(r, 10));

    // Try second execution immediately — should be rejected
    const secondResult = await engine2.executeSkill('slow-skill');
    expect(secondResult.status).toBe('failed');
    expect(secondResult.error).toMatch(/concurrent/i);

    // Clean up
    resolveFirst!();
    await firstRun;
    await engine2.stop();
  });

  it('executeSkill completes in dry run (no workflow engine)', async () => {
    engine.skills.register({
      id: 'dry-run-skill',
      name: 'Dry Run Skill',
      description: 'Test dry run',
      tags: [],
      workflow: { id: 'wf', version: '1.0.0', steps: [] } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Without a workflow engine set, executeSkill completes as a dry run
    const result = await engine.executeSkill('dry-run-skill');
    expect(result).toBeDefined();
    expect(result.status).toBe('completed');
  });

  it('getRunHistory returns records', async () => {
    engine.skills.register({
      id: 'history-skill',
      name: 'History Skill',
      description: 'Test history',
      tags: [],
      workflow: { id: 'wf', version: '1.0.0', steps: [] } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await engine.executeSkill('history-skill');
    await engine.executeSkill('nonexistent-skill');

    const history = engine.getRunHistory();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('getRunHistory filters by status', async () => {
    engine.skills.register({
      id: 'filter-skill',
      name: 'Filter Skill',
      description: 'Test filtering',
      tags: [],
      workflow: { id: 'wf', version: '1.0.0', steps: [] } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await engine.executeSkill('filter-skill');
    await engine.executeSkill('nonexistent-skill');

    const failed = engine.getRunHistory({ status: 'failed' });
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed.every((r: any) => r.status === 'failed')).toBe(true);
  });

  it('getRunHistory filters by triggeredBy', async () => {
    engine.skills.register({
      id: 'trigger-skill',
      name: 'Trigger Skill',
      description: 'Test trigger filter',
      tags: [],
      workflow: { id: 'wf', version: '1.0.0', steps: [] } as any,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // executeSkill(skillId, inputs, triggeredBy, triggerDetails)
    await engine.executeSkill('trigger-skill', {}, 'cron', 'test-cron');
    await engine.executeSkill('trigger-skill', {}, 'api', 'test-api');

    const cronRuns = engine.getRunHistory({ triggeredBy: 'cron' });
    expect(cronRuns.length).toBeGreaterThanOrEqual(1);
    expect(cronRuns.every((r: any) => r.triggeredBy === 'cron')).toBe(true);
  });

  it('getActiveRuns returns count', async () => {
    const count = engine.getActiveRuns();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('on registers event listener', () => {
    const listener = vi.fn();
    engine.on('run:started', listener);

    // The listener should be registered without error
    expect(listener).not.toHaveBeenCalled();
  });

  it('start/stop lifecycle', async () => {
    await expect(engine.start()).resolves.not.toThrow();
    await expect(engine.stop()).resolves.not.toThrow();
  });
});
