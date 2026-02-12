/**
 * Graceful Degradation — Engine resilience when components are missing.
 *
 * Provides fallback behaviors when:
 * - No LLM providers are configured
 * - Memory system is unavailable
 * - Quality gates fail to load
 * - Dependencies are missing (tree-sitter, eslint, etc.)
 * - Config is incomplete
 */

import { getLogger } from './logger.js';

const logger = getLogger();

export interface DegradationReport {
  level: 'full' | 'degraded' | 'minimal';
  available: string[];
  unavailable: string[];
  warnings: string[];
}

export interface ComponentStatus {
  name: string;
  available: boolean;
  reason?: string;
  fallback?: string;
}

/**
 * GracefulDegradation checks component availability and reports
 * what the engine can and cannot do.
 */
export class GracefulDegradation {
  private components: ComponentStatus[] = [];

  /**
   * Check if a provider is available
   */
  checkProvider(providerName: string, available: boolean): void {
    this.components.push({
      name: `provider:${providerName}`,
      available,
      reason: available ? undefined : `Provider "${providerName}" not configured or API key missing`,
      fallback: 'Inline execution with echo responses',
    });
  }

  /**
   * Check if memory system is available
   */
  checkMemory(enabled: boolean, dbPath?: string): void {
    this.components.push({
      name: 'memory',
      available: enabled,
      reason: enabled ? undefined : 'Memory disabled in config or database path inaccessible',
      fallback: 'No memory recall/store; fresh context each run',
    });
  }

  /**
   * Check if a quality gate dependency is available
   */
  checkGateDependency(gate: string, binary: string, available: boolean): void {
    this.components.push({
      name: `gate:${gate}`,
      available,
      reason: available ? undefined : `"${binary}" not found in PATH`,
      fallback: `Gate "${gate}" will be skipped`,
    });
  }

  /**
   * Check if an optional dependency is available
   */
  checkOptionalDep(name: string, available: boolean): void {
    this.components.push({
      name: `dep:${name}`,
      available,
      reason: available ? undefined : `Optional dependency "${name}" not installed`,
      fallback: `Fallback to built-in implementation`,
    });
  }

  /**
   * Check if git worktrees are available
   */
  checkWorktrees(available: boolean): void {
    this.components.push({
      name: 'worktrees',
      available,
      reason: available ? undefined : 'Not a git repository or git not available',
      fallback: 'Agent isolation via in-memory file tracking',
    });
  }

  /**
   * Generate degradation report
   */
  getReport(): DegradationReport {
    const available = this.components.filter(c => c.available).map(c => c.name);
    const unavailable = this.components.filter(c => !c.available).map(c => c.name);
    const warnings = this.components
      .filter(c => !c.available)
      .map(c => `${c.name}: ${c.reason} → ${c.fallback}`);

    const hasProvider = this.components.some(c => c.name.startsWith('provider:') && c.available);
    const hasMemory = this.components.some(c => c.name === 'memory' && c.available);

    let level: 'full' | 'degraded' | 'minimal';
    if (hasProvider && hasMemory && unavailable.length === 0) {
      level = 'full';
    } else if (hasProvider) {
      level = 'degraded';
    } else {
      level = 'minimal';
    }

    return { level, available, unavailable, warnings };
  }

  /**
   * Log the degradation report
   */
  logReport(): void {
    const report = this.getReport();

    if (report.level === 'full') {
      logger.info('All components available — running at full capacity');
      return;
    }

    if (report.level === 'minimal') {
      logger.warn(
        { unavailable: report.unavailable },
        'No LLM providers available — running in minimal mode',
      );
    } else {
      logger.info(
        { unavailable: report.unavailable },
        `Running in degraded mode (${report.unavailable.length} components unavailable)`,
      );
    }

    for (const warning of report.warnings) {
      logger.debug(warning);
    }
  }

  /**
   * Get all component statuses
   */
  getComponents(): ComponentStatus[] {
    return [...this.components];
  }

  /**
   * Check if a specific component is available
   */
  isAvailable(name: string): boolean {
    const component = this.components.find(c => c.name === name);
    return component?.available ?? false;
  }

  /**
   * Probe system for common optional dependencies
   */
  static probeSystem(): GracefulDegradation {
    const gd = new GracefulDegradation();

    // Check common binaries
    const binaries: Array<{ name: string; dep: string }> = [
      { name: 'eslint', dep: 'eslint' },
      { name: 'tsc', dep: 'typescript' },
      { name: 'git', dep: 'git' },
    ];

    for (const bin of binaries) {
      try {
        const { execSync } = require('child_process');
        execSync(`which ${bin.name}`, { stdio: 'ignore' });
        gd.checkOptionalDep(bin.dep, true);
      } catch {
        gd.checkOptionalDep(bin.dep, false);
      }
    }

    return gd;
  }
}
