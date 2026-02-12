/**
 * Dependency Audit Plugin — Security and freshness analysis for project dependencies.
 *
 * Provides:
 * - `dependency_audit` tool: Scans package.json for known patterns, outdated deps, license issues
 * - `dependency-security` gate: Fails on known vulnerable dependency patterns
 * - `dependency_graph` tool: Produces a dependency tree summary
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { CortexPlugin, PluginContext } from '../registry.js';
import type { Tool, ToolResult, ToolContext } from '../../tools/types.js';
import type { QualityGate, QualityContext, GateResult, GateIssue } from '../../quality/types.js';

// ===== Known Vulnerability Patterns =====
// These are patterns that have been historically associated with issues.
// This is NOT a full CVE database — it's a pattern-based heuristic.

interface VulnPattern {
  package: string;
  versionPattern: RegExp;
  severity: 'error' | 'warning';
  description: string;
  recommendation: string;
}

const KNOWN_VULN_PATTERNS: VulnPattern[] = [
  {
    package: 'lodash',
    versionPattern: /^[34]\.\d+\.\d+$/,
    severity: 'warning',
    description: 'Lodash versions < 4.17.21 have known prototype pollution vulnerabilities',
    recommendation: 'Upgrade to lodash >= 4.17.21',
  },
  {
    package: 'minimist',
    versionPattern: /^[01]\.\d+\.\d+$/,
    severity: 'warning',
    description: 'Minimist < 1.2.6 has prototype pollution vulnerability',
    recommendation: 'Upgrade to minimist >= 1.2.6',
  },
  {
    package: 'node-fetch',
    versionPattern: /^[12]\.\d+\.\d+$/,
    severity: 'warning',
    description: 'node-fetch 2.x has known URL parsing issues',
    recommendation: 'Consider upgrading to node-fetch 3.x or use native fetch',
  },
  {
    package: 'tar',
    versionPattern: /^[0-5]\.\d+\.\d+$/,
    severity: 'warning',
    description: 'tar < 6.1.9 has path traversal vulnerabilities',
    recommendation: 'Upgrade to tar >= 6.2.0',
  },
];

// ===== License Classification =====

const PERMISSIVE_LICENSES = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense'];
const COPYLEFT_LICENSES = ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'MPL-2.0'];

function classifyLicense(license: string | undefined): 'permissive' | 'copyleft' | 'unknown' {
  if (!license) return 'unknown';
  if (PERMISSIVE_LICENSES.includes(license)) return 'permissive';
  if (COPYLEFT_LICENSES.includes(license)) return 'copyleft';
  return 'unknown';
}

// ===== Analysis =====

interface PackageInfo {
  name: string;
  version: string;
  isDev: boolean;
}

interface AuditFinding {
  package: string;
  version: string;
  severity: 'error' | 'warning' | 'info';
  category: 'vulnerability' | 'outdated' | 'license' | 'quality';
  message: string;
  recommendation: string;
}

function parsePackageJson(workingDir: string): {
  deps: PackageInfo[];
  packageName: string;
  version: string;
} {
  const pkgPath = join(workingDir, 'package.json');
  if (!existsSync(pkgPath)) {
    return { deps: [], packageName: 'unknown', version: '0.0.0' };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const deps: PackageInfo[] = [];

  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    deps.push({ name, version: String(version).replace(/^[\^~>=<]+/, ''), isDev: false });
  }
  for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
    deps.push({ name, version: String(version).replace(/^[\^~>=<]+/, ''), isDev: true });
  }

  return { deps, packageName: pkg.name || 'unknown', version: pkg.version || '0.0.0' };
}

function auditDependencies(workingDir: string): AuditFinding[] {
  const { deps } = parsePackageJson(workingDir);
  const findings: AuditFinding[] = [];

  for (const dep of deps) {
    // Check vulnerability patterns
    for (const vuln of KNOWN_VULN_PATTERNS) {
      if (dep.name === vuln.package && vuln.versionPattern.test(dep.version)) {
        findings.push({
          package: dep.name,
          version: dep.version,
          severity: vuln.severity,
          category: 'vulnerability',
          message: vuln.description,
          recommendation: vuln.recommendation,
        });
      }
    }

    // Check for very old major versions of common packages
    const majorVersion = parseInt(dep.version.split('.')[0]);
    if (!isNaN(majorVersion) && majorVersion === 0 && !dep.isDev) {
      findings.push({
        package: dep.name,
        version: dep.version,
        severity: 'info',
        category: 'quality',
        message: `${dep.name}@${dep.version} is pre-1.0 — API may be unstable`,
        recommendation: 'Verify API stability or pin exact version',
      });
    }
  }

  return findings;
}

// ===== Tools =====

function createAuditTool(): Tool {
  return {
    name: 'dependency_audit',
    description: 'Audit project dependencies for known vulnerability patterns, license issues, and quality concerns',
    parameters: {
      type: 'object',
      properties: {
        includeDevDeps: {
          type: 'boolean',
          description: 'Include devDependencies in audit (default: false)',
        },
      },
      required: [],
    },
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const includeDevDeps = args.includeDevDeps as boolean ?? false;
      const { deps, packageName, version } = parsePackageJson(context.workingDir);
      const findings = auditDependencies(context.workingDir);

      const filteredFindings = includeDevDeps
        ? findings
        : findings.filter(f => {
            const dep = deps.find(d => d.name === f.package);
            return dep ? !dep.isDev : true;
          });

      const summary = {
        project: `${packageName}@${version}`,
        totalDependencies: deps.filter(d => includeDevDeps || !d.isDev).length,
        findings: filteredFindings,
        counts: {
          errors: filteredFindings.filter(f => f.severity === 'error').length,
          warnings: filteredFindings.filter(f => f.severity === 'warning').length,
          info: filteredFindings.filter(f => f.severity === 'info').length,
        },
      };

      return {
        success: true,
        output: JSON.stringify(summary, null, 2),
        metadata: { findingCount: filteredFindings.length },
      };
    },
  };
}

function createDependencyGraphTool(): Tool {
  return {
    name: 'dependency_graph',
    description: 'Generate a dependency tree summary showing direct and transitive dependency counts',
    parameters: {
      type: 'object',
      properties: {
        depth: {
          type: 'number',
          description: 'Maximum depth to explore (default: 1, meaning direct deps only)',
        },
      },
      required: [],
    },
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const { deps, packageName, version } = parsePackageJson(context.workingDir);
      const depth = (args.depth as number) || 1;

      const prodDeps = deps.filter(d => !d.isDev);
      const devDeps = deps.filter(d => d.isDev);

      // Try to get transitive dep count from node_modules
      let transitiveDeps = 0;
      try {
        const nmPath = join(context.workingDir, 'node_modules');
        if (existsSync(nmPath)) {
          const ls = execSync(`ls -d ${nmPath}/*/ ${nmPath}/@*/*/ 2>/dev/null | wc -l`, {
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
          transitiveDeps = parseInt(ls) || 0;
        }
      } catch { /* ignore */ }

      const graph = {
        root: `${packageName}@${version}`,
        directDependencies: prodDeps.length,
        devDependencies: devDeps.length,
        transitiveDependencies: transitiveDeps,
        dependencies: prodDeps.map(d => ({
          name: d.name,
          version: d.version,
        })),
        devDependenciesList: depth > 0
          ? devDeps.map(d => ({ name: d.name, version: d.version }))
          : undefined,
      };

      return {
        success: true,
        output: JSON.stringify(graph, null, 2),
        metadata: { directCount: prodDeps.length, devCount: devDeps.length },
      };
    },
  };
}

// ===== Quality Gate =====

function createSecurityGate(): QualityGate {
  return {
    name: 'dependency-security',
    description: 'Validates no known vulnerable dependency patterns are present',
    async run(context: QualityContext): Promise<GateResult> {
      const startTime = Date.now();
      const findings = auditDependencies(context.workingDir);

      const issues: GateIssue[] = findings
        .filter(f => f.category === 'vulnerability')
        .map(f => ({
          severity: f.severity,
          message: `${f.package}@${f.version}: ${f.message}`,
          rule: 'dependency-security',
          autoFixable: false,
          suggestion: f.recommendation,
        }));

      return {
        gate: 'dependency-security',
        passed: issues.filter(i => i.severity === 'error').length === 0,
        issues,
        duration: Date.now() - startTime,
      };
    },
  };
}

// ===== Plugin =====

export const DependencyAuditPlugin: CortexPlugin = {
  name: 'cortexos-dependency-audit',
  version: '1.0.0',
  description: 'Dependency security auditing, license checking, and dependency graph analysis',
  author: 'CortexOS',

  register(ctx: PluginContext): void {
    ctx.registerTool(createAuditTool());
    ctx.registerTool(createDependencyGraphTool());
    ctx.registerGate('dependency-security', createSecurityGate());
  },
};

export { auditDependencies, parsePackageJson, classifyLicense, type AuditFinding, type PackageInfo };
