/**
 * Built-in CortexOS Plugins — Ship out-of-the-box ecosystem functionality.
 *
 * These plugins demonstrate the plugin system while providing real value:
 * - Metrics Dashboard: Runtime metrics, cost tracking, performance budgets
 * - Code Complexity: Cyclomatic complexity analysis and quality gates
 * - Git Workflow: Smart commits, branch analysis, changelog generation
 * - Dependency Audit: Security scanning, license checking, dependency graphs
 * - Documentation Gen: Auto-doc generation, coverage analysis, doc standards
 */

export { MetricsDashboardPlugin, MetricsStore, type MetricEntry, type BudgetGateConfig } from './metrics-dashboard-plugin.js';
export { CodeComplexityPlugin, analyzeComplexity, type ComplexityResult, type FunctionComplexity } from './code-complexity-plugin.js';
export { GitWorkflowPlugin, classifyChanges, detectSensitiveFiles, type CommitInfo } from './git-workflow-plugin.js';
export { DependencyAuditPlugin, auditDependencies, parsePackageJson, classifyLicense, type AuditFinding, type PackageInfo } from './dependency-audit-plugin.js';
export { DocumentationGenPlugin, analyzeDocCoverage, generateDocs, type DocEntry, type DocCoverage } from './documentation-gen-plugin.js';

import { MetricsDashboardPlugin } from './metrics-dashboard-plugin.js';
import { CodeComplexityPlugin } from './code-complexity-plugin.js';
import { GitWorkflowPlugin } from './git-workflow-plugin.js';
import { DependencyAuditPlugin } from './dependency-audit-plugin.js';
import { DocumentationGenPlugin } from './documentation-gen-plugin.js';
import type { CortexPlugin } from '../registry.js';

/**
 * Get all built-in plugins in recommended load order.
 */
export function getBuiltinPlugins(): CortexPlugin[] {
  return [
    MetricsDashboardPlugin,
    CodeComplexityPlugin,
    GitWorkflowPlugin,
    DependencyAuditPlugin,
    DocumentationGenPlugin,
  ];
}

/**
 * Get a specific built-in plugin by name.
 */
export function getBuiltinPlugin(name: string): CortexPlugin | undefined {
  const all = getBuiltinPlugins();
  return all.find(p => p.name === name);
}

/**
 * List metadata for all built-in plugins.
 */
export function listBuiltinPlugins(): Array<{ name: string; version: string; description: string }> {
  return getBuiltinPlugins().map(p => ({
    name: p.name,
    version: p.version,
    description: p.description || '',
  }));
}
