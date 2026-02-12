import { describe, it, expect } from 'vitest';
import { GracefulDegradation } from '../../../src/core/graceful.js';

describe('GracefulDegradation', () => {
  it('should report full capacity when all components available', () => {
    const gd = new GracefulDegradation();
    gd.checkProvider('anthropic', true);
    gd.checkMemory(true);
    gd.checkWorktrees(true);

    const report = gd.getReport();
    expect(report.level).toBe('full');
    expect(report.available.length).toBe(3);
    expect(report.unavailable.length).toBe(0);
  });

  it('should report degraded when some components missing', () => {
    const gd = new GracefulDegradation();
    gd.checkProvider('anthropic', true);
    gd.checkMemory(false);
    gd.checkWorktrees(false);

    const report = gd.getReport();
    expect(report.level).toBe('degraded');
    expect(report.available.length).toBe(1);
    expect(report.unavailable.length).toBe(2);
  });

  it('should report minimal when no providers available', () => {
    const gd = new GracefulDegradation();
    gd.checkProvider('anthropic', false);
    gd.checkMemory(false);

    const report = gd.getReport();
    expect(report.level).toBe('minimal');
  });

  it('should generate warnings with fallback info', () => {
    const gd = new GracefulDegradation();
    gd.checkProvider('anthropic', false);
    gd.checkGateDependency('lint', 'eslint', false);

    const report = gd.getReport();
    expect(report.warnings.length).toBe(2);
    expect(report.warnings[0]).toContain('provider:anthropic');
    expect(report.warnings[1]).toContain('gate:lint');
  });

  it('should track optional dependencies', () => {
    const gd = new GracefulDegradation();
    gd.checkOptionalDep('web-tree-sitter', true);
    gd.checkOptionalDep('eslint', false);

    const components = gd.getComponents();
    expect(components.length).toBe(2);
    expect(components[0].available).toBe(true);
    expect(components[1].available).toBe(false);
    expect(components[1].fallback).toContain('built-in');
  });

  it('should check specific component availability', () => {
    const gd = new GracefulDegradation();
    gd.checkProvider('anthropic', true);
    gd.checkMemory(false);

    expect(gd.isAvailable('provider:anthropic')).toBe(true);
    expect(gd.isAvailable('memory')).toBe(false);
    expect(gd.isAvailable('nonexistent')).toBe(false);
  });

  it('should handle worktree check', () => {
    const gd = new GracefulDegradation();
    gd.checkWorktrees(false);

    const components = gd.getComponents();
    expect(components[0].name).toBe('worktrees');
    expect(components[0].available).toBe(false);
    expect(components[0].reason).toContain('git');
  });

  it('should handle gate dependency check', () => {
    const gd = new GracefulDegradation();
    gd.checkGateDependency('type-check', 'tsc', true);
    gd.checkGateDependency('lint', 'eslint', false);

    expect(gd.isAvailable('gate:type-check')).toBe(true);
    expect(gd.isAvailable('gate:lint')).toBe(false);
  });

  it('should produce empty report for no checks', () => {
    const gd = new GracefulDegradation();
    const report = gd.getReport();
    // No providers = minimal
    expect(report.level).toBe('minimal');
    expect(report.available.length).toBe(0);
  });
});
