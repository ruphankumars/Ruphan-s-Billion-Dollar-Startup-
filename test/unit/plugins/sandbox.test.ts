import { describe, it, expect, vi } from 'vitest';
import { PluginSandbox } from '../../../src/plugins/sandbox.js';

describe('PluginSandbox', () => {
  it('should allow tool registration by default', () => {
    const sandbox = new PluginSandbox();
    expect(sandbox.canRegisterTool('test-plugin')).toBe(true);
  });

  it('should deny tool registration when capability disabled', () => {
    const sandbox = new PluginSandbox({ registerTools: false });
    expect(sandbox.canRegisterTool('test-plugin')).toBe(false);
    expect(sandbox.hasViolations('test-plugin')).toBe(true);
  });

  it('should enforce tool limit per plugin', () => {
    const sandbox = new PluginSandbox({}, { maxTools: 2 });

    expect(sandbox.canRegisterTool('p1')).toBe(true);
    expect(sandbox.canRegisterTool('p1')).toBe(true);
    expect(sandbox.canRegisterTool('p1')).toBe(false); // Over limit

    // Different plugin should have its own counter
    expect(sandbox.canRegisterTool('p2')).toBe(true);
  });

  it('should deny provider registration by default', () => {
    const sandbox = new PluginSandbox();
    expect(sandbox.canRegisterProvider('test-plugin')).toBe(false);
    expect(sandbox.hasViolations('test-plugin')).toBe(true);
  });

  it('should allow provider registration when enabled', () => {
    const sandbox = new PluginSandbox({ registerProviders: true });
    expect(sandbox.canRegisterProvider('test-plugin')).toBe(true);
  });

  it('should enforce provider limit', () => {
    const sandbox = new PluginSandbox(
      { registerProviders: true },
      { maxProviders: 1 },
    );
    expect(sandbox.canRegisterProvider('p1')).toBe(true);
    expect(sandbox.canRegisterProvider('p1')).toBe(false);
  });

  it('should handle gate registration', () => {
    const sandbox = new PluginSandbox({}, { maxGates: 2 });
    expect(sandbox.canRegisterGate('p1')).toBe(true);
    expect(sandbox.canRegisterGate('p1')).toBe(true);
    expect(sandbox.canRegisterGate('p1')).toBe(false);
  });

  it('should deny gate registration when capability disabled', () => {
    const sandbox = new PluginSandbox({ registerGates: false });
    expect(sandbox.canRegisterGate('p1')).toBe(false);
  });

  it('should handle middleware registration', () => {
    const sandbox = new PluginSandbox(
      { registerMiddleware: true },
      { maxMiddlewarePerType: 2 },
    );
    expect(sandbox.canRegisterMiddleware('p1', 'pre-execute')).toBe(true);
    expect(sandbox.canRegisterMiddleware('p1', 'pre-execute')).toBe(true);
    expect(sandbox.canRegisterMiddleware('p1', 'pre-execute')).toBe(false);

    // Different type should have its own counter
    expect(sandbox.canRegisterMiddleware('p1', 'post-execute')).toBe(true);
  });

  it('should deny middleware by default', () => {
    const sandbox = new PluginSandbox();
    expect(sandbox.canRegisterMiddleware('p1', 'pre-execute')).toBe(false);
  });

  it('should check filesystem access', () => {
    const sandbox = new PluginSandbox({ fileSystemAccess: false });
    expect(sandbox.canAccessFileSystem('p1')).toBe(false);

    const sandbox2 = new PluginSandbox({ fileSystemAccess: true });
    expect(sandbox2.canAccessFileSystem('p1')).toBe(true);
  });

  it('should check network access', () => {
    const sandbox = new PluginSandbox({ networkAccess: false });
    expect(sandbox.canAccessNetwork('p1')).toBe(false);

    const sandbox2 = new PluginSandbox({ networkAccess: true });
    expect(sandbox2.canAccessNetwork('p1')).toBe(true);
  });

  it('should enforce registration timeout', async () => {
    const sandbox = new PluginSandbox({}, { registrationTimeoutMs: 50 });

    await expect(
      sandbox.withTimeout('slow-plugin', () => new Promise(r => setTimeout(r, 200)))
    ).rejects.toThrow('timed out');

    expect(sandbox.hasViolations('slow-plugin')).toBe(true);
  });

  it('should not timeout fast registration', async () => {
    const sandbox = new PluginSandbox({}, { registrationTimeoutMs: 1000 });
    const result = await sandbox.withTimeout('fast-plugin', async () => 'done');
    expect(result).toBe('done');
    expect(sandbox.hasViolations('fast-plugin')).toBe(false);
  });

  it('should collect violations', () => {
    const sandbox = new PluginSandbox({ registerTools: false, registerProviders: false });

    sandbox.canRegisterTool('p1');
    sandbox.canRegisterProvider('p1');
    sandbox.canRegisterTool('p2');

    const all = sandbox.getViolations();
    expect(all.length).toBe(3);

    const p1Violations = sandbox.getPluginViolations('p1');
    expect(p1Violations.length).toBe(2);
  });

  it('should reset plugin counters', () => {
    const sandbox = new PluginSandbox({}, { maxTools: 1 });
    sandbox.canRegisterTool('p1');
    expect(sandbox.canRegisterTool('p1')).toBe(false); // Limit reached

    sandbox.resetPlugin('p1');
    expect(sandbox.canRegisterTool('p1')).toBe(true); // Reset
  });

  it('should return capabilities and limits', () => {
    const sandbox = new PluginSandbox({ networkAccess: true }, { maxTools: 5 });
    const caps = sandbox.getCapabilities();
    const limits = sandbox.getLimits();

    expect(caps.networkAccess).toBe(true);
    expect(limits.maxTools).toBe(5);
  });

  it('should clear violations', () => {
    const sandbox = new PluginSandbox({ registerTools: false });
    sandbox.canRegisterTool('p1');
    expect(sandbox.getViolations().length).toBe(1);

    sandbox.clearViolations();
    expect(sandbox.getViolations().length).toBe(0);
  });
});
