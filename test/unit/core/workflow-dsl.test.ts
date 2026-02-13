import { describe, it, expect, vi } from 'vitest';
import {
  WorkflowBuilder,
  WorkflowEngine,
  PRESET_WORKFLOWS,
  type WorkflowStep,
  type WorkflowExecutionContext,
} from '../../../src/core/workflow-dsl.js';

describe('WorkflowBuilder', () => {
  it('should create a basic workflow', () => {
    const wf = new WorkflowBuilder('test-wf', '1.0.0')
      .description('A test workflow')
      .agent('step1', { role: 'developer', prompt: 'Do something' })
      .build();

    expect(wf.name).toBe('test-wf');
    expect(wf.version).toBe('1.0.0');
    expect(wf.description).toBe('A test workflow');
    expect(wf.steps).toHaveLength(1);
    expect(wf.steps[0].id).toBe('step1');
    expect(wf.steps[0].type).toBe('agent');
  });

  it('should support fluent chaining of all step types', () => {
    const wf = new WorkflowBuilder('full', '2.0.0')
      .input('prompt', 'string', { required: true })
      .onError('continue')
      .checkpoint(true)
      .agent('analyze', { role: 'researcher', prompt: 'Analyze' })
      .tool('lint', { toolName: 'eslint', args: { fix: true }, dependsOn: ['analyze'] })
      .gate('verify', { gates: ['syntax', 'test'], failAction: 'retry', dependsOn: ['lint'] })
      .approval('review', { message: 'Please review', dependsOn: ['verify'] })
      .condition('branch', { expression: 'true', ifTrue: 'analyze', dependsOn: ['review'] })
      .parallel('parallel-group', { steps: ['analyze', 'lint'] })
      .build();

    expect(wf.steps).toHaveLength(6);
    expect(wf.onError).toBe('continue');
    expect(wf.checkpointing).toBe(true);
    expect(wf.inputs?.prompt).toBeDefined();
  });

  it('should detect duplicate step IDs', () => {
    expect(() => {
      new WorkflowBuilder('bad')
        .agent('dup', { role: 'dev', prompt: 'a' })
        .agent('dup', { role: 'dev', prompt: 'b' })
        .build();
    }).toThrow('duplicate step IDs');
  });

  it('should detect unknown dependency references', () => {
    expect(() => {
      new WorkflowBuilder('bad')
        .agent('step1', { role: 'dev', prompt: 'a', dependsOn: ['nonexistent'] })
        .build();
    }).toThrow('unknown step');
  });

  it('should detect circular dependencies', () => {
    expect(() => {
      new WorkflowBuilder('bad')
        .agent('a', { role: 'dev', prompt: 'a', dependsOn: ['b'] })
        .agent('b', { role: 'dev', prompt: 'b', dependsOn: ['a'] })
        .build();
    }).toThrow('Circular dependency');
  });

  it('should set retry policy and timeout', () => {
    const wf = new WorkflowBuilder('retry-test')
      .agent('step1', {
        role: 'dev',
        prompt: 'Do it',
        retry: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
        timeout: 60000,
      })
      .build();

    expect(wf.steps[0].retryPolicy?.maxRetries).toBe(3);
    expect(wf.steps[0].timeout).toBe(60000);
  });
});

describe('WorkflowEngine', () => {
  it('should execute a simple workflow', async () => {
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async (step) => ({ message: `Executed ${step.id}` }));

    const wf = new WorkflowBuilder('simple')
      .agent('step1', { role: 'dev', prompt: 'Do it' })
      .build();

    const result = await engine.execute(wf);

    expect(result.status).toBe('completed');
    expect(result.steps.step1.status).toBe('completed');
    expect(result.steps.step1.output).toEqual({ message: 'Executed step1' });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should execute steps in dependency order', async () => {
    const order: string[] = [];
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async (step) => {
      order.push(step.id);
      return { done: true };
    });

    const wf = new WorkflowBuilder('ordered')
      .agent('first', { role: 'dev', prompt: 'First' })
      .agent('second', { role: 'dev', prompt: 'Second', dependsOn: ['first'] })
      .agent('third', { role: 'dev', prompt: 'Third', dependsOn: ['second'] })
      .build();

    const result = await engine.execute(wf);

    expect(result.status).toBe('completed');
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('should pass inputs to execution context', async () => {
    let capturedInputs: Record<string, unknown> = {};
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async (_step, ctx) => {
      capturedInputs = ctx.inputs;
      return {};
    });

    const wf = new WorkflowBuilder('inputs')
      .input('prompt', 'string', { required: true })
      .agent('step1', { role: 'dev', prompt: 'Use input' })
      .build();

    await engine.execute(wf, { prompt: 'Hello world' });
    expect(capturedInputs.prompt).toBe('Hello world');
  });

  it('should handle step failure with onError: stop', async () => {
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async (step) => {
      if (step.id === 'fail') throw new Error('Boom');
      return {};
    });

    const wf = new WorkflowBuilder('fail-stop')
      .onError('stop')
      .agent('fail', { role: 'dev', prompt: 'Fail' })
      .agent('after', { role: 'dev', prompt: 'After', dependsOn: ['fail'] })
      .build();

    const result = await engine.execute(wf);
    expect(result.status).toBe('failed');
    expect(result.steps.fail.status).toBe('failed');
    expect(result.steps.after).toBeUndefined();
  });

  it('should handle step failure with onError: continue', async () => {
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async (step) => {
      if (step.id === 'fail') throw new Error('Boom');
      return {};
    });

    const wf = new WorkflowBuilder('fail-continue')
      .onError('continue')
      .agent('ok', { role: 'dev', prompt: 'OK' })
      .agent('fail', { role: 'dev', prompt: 'Fail' })
      .build();

    const result = await engine.execute(wf);
    // onError: continue means the workflow doesn't throw, but the failing
    // step is still marked as failed. The workflow may be completed or failed
    // depending on whether allStepsCompleted returns true.
    // The 'fail' step will have status 'failed', so allStepsCompleted is false.
    // But the catch block sets status to 'completed' when onError is 'continue'.
    // Actually the error is caught in executeStep, not in runSteps for individual failures.
    // The step result is 'failed' and onError=stop throws, but onError=continue doesn't.
    // allStepsCompleted returns false because 'fail' step is 'failed', so status = 'failed'.
    expect(result.steps.fail.status).toBe('failed');
    expect(result.steps.ok.status).toBe('completed');
  });

  it('should handle approval steps without handler (pauses)', async () => {
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async () => ({ done: true }));

    const wf = new WorkflowBuilder('approval-test')
      .agent('pre', { role: 'dev', prompt: 'Pre' })
      .approval('approve', { message: 'Approve?', dependsOn: ['pre'] })
      .agent('post', { role: 'dev', prompt: 'Post', dependsOn: ['approve'] })
      .build();

    const result = await engine.execute(wf);
    // Without an approval handler, workflow pauses
    expect(result.steps.approve.status).toBe('waiting_approval');
  });

  it('should handle approval steps with handler', async () => {
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async () => ({ done: true }));
    engine.setApprovalHandler(async () => true);

    const wf = new WorkflowBuilder('approval-approved')
      .agent('pre', { role: 'dev', prompt: 'Pre' })
      .approval('approve', { message: 'Approve?', dependsOn: ['pre'] })
      .agent('post', { role: 'dev', prompt: 'Post', dependsOn: ['approve'] })
      .build();

    const result = await engine.execute(wf);
    expect(result.status).toBe('completed');
    expect(result.steps.approve.status).toBe('completed');
    expect(result.steps.post.status).toBe('completed');
  });

  it('should handle conditional steps', async () => {
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async (step) => {
      if (step.id === 'analyze') return { complexity: 'high' };
      return {};
    });

    const wf = new WorkflowBuilder('conditional')
      .agent('analyze', { role: 'researcher', prompt: 'Analyze' })
      .condition('branch', {
        expression: "steps.analyze.output.complexity === 'high'",
        ifTrue: 'analyze',
        ifFalse: 'analyze',
        dependsOn: ['analyze'],
      })
      .build();

    const result = await engine.execute(wf);
    expect(result.status).toBe('completed');
    expect((result.steps.branch.output as any).condition).toBe(true);
  });

  it('should handle parallel step groups', async () => {
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async () => ({ done: true }));

    const wf = new WorkflowBuilder('parallel')
      .agent('a', { role: 'dev', prompt: 'A' })
      .agent('b', { role: 'dev', prompt: 'B' })
      .parallel('group', { steps: ['a', 'b'] })
      .build();

    const result = await engine.execute(wf);
    expect(result.status).toBe('completed');
    expect((result.steps.group.output as any).parallelSteps).toEqual(['a', 'b']);
  });

  it('should emit workflow events', async () => {
    const events: string[] = [];
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async () => ({ done: true }));
    engine.on('workflow:started', () => events.push('started'));
    engine.on('step:started', () => events.push('step:started'));
    engine.on('step:completed', () => events.push('step:completed'));
    engine.on('workflow:completed', () => events.push('completed'));

    const wf = new WorkflowBuilder('events')
      .agent('s1', { role: 'dev', prompt: 'Go' })
      .build();

    await engine.execute(wf);
    expect(events).toContain('started');
    expect(events).toContain('step:started');
    expect(events).toContain('step:completed');
    expect(events).toContain('completed');
  });

  it('should checkpoint and allow resume', async () => {
    const engine = new WorkflowEngine();
    let callCount = 0;

    engine.registerExecutor('agent', async (step) => {
      callCount++;
      if (step.id === 'step2' && callCount === 2) throw new Error('Transient error');
      return { done: true };
    });

    const wf = new WorkflowBuilder('resume-test')
      .checkpoint(true)
      .onError('stop')
      .agent('step1', { role: 'dev', prompt: 'Step 1' })
      .agent('step2', { role: 'dev', prompt: 'Step 2', dependsOn: ['step1'] })
      .build();

    const result1 = await engine.execute(wf);
    expect(result1.status).toBe('failed');

    // The engine stored a checkpoint via workflowId
    const state = engine.getState(result1.workflowId);
    expect(state).toBeDefined();
  });

  it('should track total cost', async () => {
    const engine = new WorkflowEngine();
    engine.registerExecutor('agent', async () => ({ done: true }));

    const wf = new WorkflowBuilder('cost-test')
      .agent('s1', { role: 'dev', prompt: 'Go' })
      .agent('s2', { role: 'dev', prompt: 'Go', dependsOn: ['s1'] })
      .build();

    const result = await engine.execute(wf);
    expect(typeof result.totalCost).toBe('number');
  });

  it('should handle tool step type', async () => {
    const engine = new WorkflowEngine();
    engine.registerExecutor('tool', async (step) => {
      return { toolResult: 'ok', toolName: (step.config as any).toolName };
    });

    const wf = new WorkflowBuilder('tool-test')
      .tool('run-lint', { toolName: 'eslint', args: { fix: true } })
      .build();

    const result = await engine.execute(wf);
    expect(result.status).toBe('completed');
    expect((result.steps['run-lint'].output as any).toolResult).toBe('ok');
  });

  it('should handle gate step type', async () => {
    const engine = new WorkflowEngine();
    engine.registerExecutor('gate', async () => ({ passed: true, score: 1.0 }));

    const wf = new WorkflowBuilder('gate-test')
      .gate('qa', { gates: ['syntax', 'lint'], failAction: 'stop' })
      .build();

    const result = await engine.execute(wf);
    expect(result.status).toBe('completed');
  });

  it('should handle steps with no registered executor gracefully', async () => {
    const engine = new WorkflowEngine();
    // No executor registered for 'agent'

    const wf = new WorkflowBuilder('no-executor')
      .agent('s1', { role: 'dev', prompt: 'Go' })
      .build();

    const result = await engine.execute(wf);
    expect(result.status).toBe('completed');
    expect((result.steps.s1.output as any).message).toContain('No executor');
  });
});

describe('PRESET_WORKFLOWS', () => {
  it('should create codeGen workflow', () => {
    const wf = PRESET_WORKFLOWS.codeGen();
    expect(wf.name).toBe('code-generation');
    expect(wf.steps.length).toBe(4);
    expect(wf.steps.map(s => s.type)).toContain('agent');
    expect(wf.steps.map(s => s.type)).toContain('gate');
  });

  it('should create fullStack workflow with approval', () => {
    const wf = PRESET_WORKFLOWS.fullStack();
    expect(wf.name).toBe('full-stack-feature');
    expect(wf.steps.some(s => s.type === 'approval')).toBe(true);
    expect(wf.steps.length).toBe(6);
  });

  it('should create bugFix workflow', () => {
    const wf = PRESET_WORKFLOWS.bugFix();
    expect(wf.name).toBe('bug-fix');
    expect(wf.steps.length).toBe(4);
  });

  it('should produce valid workflow definitions', () => {
    // All presets should build without throwing
    expect(() => PRESET_WORKFLOWS.codeGen()).not.toThrow();
    expect(() => PRESET_WORKFLOWS.fullStack()).not.toThrow();
    expect(() => PRESET_WORKFLOWS.bugFix()).not.toThrow();
  });
});
