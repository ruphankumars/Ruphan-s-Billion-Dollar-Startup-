/**
 * SleepReportGenerator — Periodic "overnight" report generation
 *
 * Produces comprehensive reports summarizing file changes, critic findings,
 * execution results, and confidence scores over a time period.
 * Outputs in both structured (JSON) and human-readable (Markdown) formats.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import * as crypto from 'node:crypto';
import type {
  FileEvent,
  CriticReport,
  CriticIssue,
  ConfidenceScore,
  SleepReport,
  SleepReportSection,
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface SleepReportOptions {
  /** Report detail level. Default: 'detailed' */
  templateStyle?: 'detailed' | 'summary';
}

interface SleepReportData {
  period: { start: number; end: number };
  fileEvents: FileEvent[];
  criticReports: CriticReport[];
  executionResults?: Array<{
    prompt: string;
    success: boolean;
    duration: number;
    cost?: number;
  }>;
  confidence?: ConfidenceScore;
}

// ═══════════════════════════════════════════════════════════════
// SLEEP REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════

export class SleepReportGenerator {
  private templateStyle: 'detailed' | 'summary';

  constructor(options?: SleepReportOptions) {
    this.templateStyle = options?.templateStyle ?? 'detailed';
  }

  // ─────────────────────────────────────────────────────────
  // MAIN GENERATION
  // ─────────────────────────────────────────────────────────

  /**
   * Generate a complete sleep report from accumulated data.
   */
  generate(data: SleepReportData): SleepReport {
    const reportId = crypto.randomUUID();
    const now = Date.now();

    // Count unique files changed
    const uniqueFiles = new Set(data.fileEvents.map((e) => e.path));
    const filesChanged = uniqueFiles.size;

    // Count critics and issues
    const criticsRun = data.criticReports.length;
    const issuesFound = data.criticReports.reduce((sum, r) => sum + r.issues.length, 0);

    // Build confidence score (use provided or synthesize from critics)
    const confidence = data.confidence ?? this.synthesizeConfidence(data.criticReports);

    // Generate recommendations
    const recommendations = this.generateRecommendations(data.criticReports, data.fileEvents);

    // Build sections
    const sections = this.buildSections(data);

    // Generate summary
    const summary = this.buildSummary(data, filesChanged, criticsRun, issuesFound);

    return {
      id: reportId,
      generatedAt: now,
      period: data.period,
      summary,
      filesChanged,
      criticsRun,
      issuesFound,
      confidence,
      recommendations,
      sections,
    };
  }

  // ─────────────────────────────────────────────────────────
  // FORMAT — Markdown
  // ─────────────────────────────────────────────────────────

  /**
   * Format a sleep report as a human-readable Markdown document.
   */
  formatMarkdown(report: SleepReport): string {
    const lines: string[] = [];

    // Header
    lines.push('# CortexOS Sleep Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date(report.generatedAt).toISOString()}`);
    lines.push(`**Period:** ${new Date(report.period.start).toISOString()} to ${new Date(report.period.end).toISOString()}`);
    lines.push(`**Report ID:** ${report.id}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(report.summary);
    lines.push('');

    // Key Metrics
    lines.push('## Key Metrics');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Files Changed | ${report.filesChanged} |`);
    lines.push(`| Critics Run | ${report.criticsRun} |`);
    lines.push(`| Issues Found | ${report.issuesFound} |`);
    lines.push(`| Overall Confidence | ${(report.confidence.overall * 100).toFixed(1)}% |`);
    lines.push('');

    // Confidence Breakdown
    if (report.confidence.factors.length > 0) {
      lines.push('## Confidence Breakdown');
      lines.push('');
      lines.push(`| Factor | Weight | Score | Reason |`);
      lines.push(`|--------|--------|-------|--------|`);
      for (const factor of report.confidence.factors) {
        lines.push(`| ${factor.name} | ${(factor.weight * 100).toFixed(0)}% | ${(factor.score * 100).toFixed(1)}% | ${factor.reason} |`);
      }
      lines.push('');
    }

    // Sections
    for (const section of report.sections) {
      const severityBadge = section.severity
        ? ` [${section.severity.toUpperCase()}]`
        : '';
      lines.push(`## ${section.title}${severityBadge}`);
      lines.push('');
      lines.push(section.content);
      lines.push('');
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('## Recommendations');
      lines.push('');
      for (const rec of report.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push('');
    }

    // Footer
    lines.push('---');
    lines.push('*Generated by CortexOS Ambient Engine*');

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────
  // FORMAT — JSON
  // ─────────────────────────────────────────────────────────

  /**
   * Format a sleep report as a JSON string.
   */
  formatJSON(report: SleepReport): string {
    return JSON.stringify(report, null, 2);
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS — Summarization
  // ─────────────────────────────────────────────────────────

  /**
   * Summarize file change events into a human-readable string.
   */
  summarizeChanges(events: FileEvent[]): string {
    if (events.length === 0) {
      return 'No file changes detected during this period.';
    }

    const created = events.filter((e) => e.type === 'create').length;
    const modified = events.filter((e) => e.type === 'modify').length;
    const deleted = events.filter((e) => e.type === 'delete').length;
    const renamed = events.filter((e) => e.type === 'rename').length;

    const parts: string[] = [];
    if (created > 0) parts.push(`${created} created`);
    if (modified > 0) parts.push(`${modified} modified`);
    if (deleted > 0) parts.push(`${deleted} deleted`);
    if (renamed > 0) parts.push(`${renamed} renamed`);

    // Group by file extension
    const extCounts = new Map<string, number>();
    for (const event of events) {
      const ext = this.getExtension(event.path);
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
    }

    const topExts = [...extCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => `${ext} (${count})`)
      .join(', ');

    return `${events.length} file event(s): ${parts.join(', ')}. Top file types: ${topExts}.`;
  }

  /**
   * Summarize critic reports into a human-readable string.
   */
  summarizeCritics(reports: CriticReport[]): string {
    if (reports.length === 0) {
      return 'No critic reviews were performed during this period.';
    }

    const passed = reports.filter((r) => r.verdict === 'pass').length;
    const warned = reports.filter((r) => r.verdict === 'warn').length;
    const failed = reports.filter((r) => r.verdict === 'fail').length;
    const totalIssues = reports.reduce((sum, r) => sum + r.issues.length, 0);

    // Issue severity breakdown
    const allIssues = reports.flatMap((r) => r.issues);
    const critical = allIssues.filter((i) => i.severity === 'critical').length;
    const high = allIssues.filter((i) => i.severity === 'high').length;
    const medium = allIssues.filter((i) => i.severity === 'medium').length;
    const low = allIssues.filter((i) => i.severity === 'low').length;

    const verdictSummary = [
      passed > 0 ? `${passed} passed` : null,
      warned > 0 ? `${warned} warned` : null,
      failed > 0 ? `${failed} failed` : null,
    ].filter(Boolean).join(', ');

    const issueSummary = [
      critical > 0 ? `${critical} critical` : null,
      high > 0 ? `${high} high` : null,
      medium > 0 ? `${medium} medium` : null,
      low > 0 ? `${low} low` : null,
    ].filter(Boolean).join(', ');

    return `${reports.length} review(s) performed: ${verdictSummary}. ${totalIssues} issue(s) found (${issueSummary || 'none'}).`;
  }

  /**
   * Generate actionable recommendations from critic reports and file events.
   */
  generateRecommendations(reports: CriticReport[], events: FileEvent[]): string[] {
    const recommendations: string[] = [];
    const allIssues = reports.flatMap((r) => r.issues);

    // Security recommendations
    const securityIssues = allIssues.filter((i) => i.category === 'security');
    if (securityIssues.length > 0) {
      recommendations.push(
        `Address ${securityIssues.length} security issue(s) immediately. Hardcoded secrets and credentials should be moved to environment variables.`,
      );
    }

    // Critical issues
    const criticalIssues = allIssues.filter((i) => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      const files = [...new Set(criticalIssues.map((i) => i.file).filter(Boolean))];
      recommendations.push(
        `${criticalIssues.length} critical issue(s) require immediate attention in: ${files.join(', ') || 'multiple files'}.`,
      );
    }

    // Quality recommendations
    const qualityIssues = allIssues.filter((i) => i.category === 'quality');
    const todoCount = qualityIssues.filter((i) => i.message.startsWith('TODO') || i.message.startsWith('FIXME')).length;
    if (todoCount > 5) {
      recommendations.push(
        `${todoCount} TODO/FIXME comments found. Consider creating tracking issues and addressing the backlog.`,
      );
    }

    // Complexity recommendations
    const complexityIssues = qualityIssues.filter(
      (i) => i.message.includes('nesting depth') || i.message.includes('lines long') || i.message.includes('parameters'),
    );
    if (complexityIssues.length > 3) {
      recommendations.push(
        'Multiple code complexity issues detected. Schedule a refactoring session to reduce function length and nesting depth.',
      );
    }

    // High churn recommendations
    const fileChangeCount = new Map<string, number>();
    for (const event of events) {
      fileChangeCount.set(event.path, (fileChangeCount.get(event.path) ?? 0) + 1);
    }
    const highChurnFiles = [...fileChangeCount.entries()]
      .filter(([, count]) => count > 5)
      .map(([path]) => path);
    if (highChurnFiles.length > 0) {
      recommendations.push(
        `${highChurnFiles.length} file(s) with high change frequency detected. These "hot files" may benefit from decomposition.`,
      );
    }

    // Performance recommendations
    const perfIssues = allIssues.filter((i) => i.category === 'performance');
    if (perfIssues.length > 0) {
      recommendations.push(
        `${perfIssues.length} performance issue(s) identified. Review nested loops and synchronous I/O calls.`,
      );
    }

    // Failure rate
    const failedReviews = reports.filter((r) => r.verdict === 'fail').length;
    if (failedReviews > 0 && reports.length > 0) {
      const failRate = ((failedReviews / reports.length) * 100).toFixed(0);
      recommendations.push(
        `${failRate}% of critic reviews failed. Investigate common failure patterns and consider adding pre-commit checks.`,
      );
    }

    // No issues found
    if (allIssues.length === 0 && events.length > 0) {
      recommendations.push(
        'All changes passed static analysis with no issues. Keep up the good work!',
      );
    }

    return recommendations;
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Building sections
  // ─────────────────────────────────────────────────────────

  private buildSections(data: SleepReportData): SleepReportSection[] {
    const sections: SleepReportSection[] = [];

    // File Changes section
    sections.push({
      title: 'File Changes',
      content: this.buildFileChangesContent(data.fileEvents),
      severity: 'info',
    });

    // Critic Results section
    if (data.criticReports.length > 0) {
      const allIssues = data.criticReports.flatMap((r) => r.issues);
      const hasCritical = allIssues.some((i) => i.severity === 'critical');
      const hasHigh = allIssues.some((i) => i.severity === 'high');

      sections.push({
        title: 'Critic Results',
        content: this.buildCriticContent(data.criticReports),
        severity: hasCritical ? 'critical' : hasHigh ? 'warning' : 'info',
      });
    }

    // Issue Details (detailed mode only)
    if (this.templateStyle === 'detailed') {
      const allIssues = data.criticReports.flatMap((r) => r.issues);
      if (allIssues.length > 0) {
        sections.push({
          title: 'Issue Details',
          content: this.buildIssueDetailsContent(allIssues),
          severity: allIssues.some((i) => i.severity === 'critical') ? 'critical' : 'info',
        });
      }
    }

    // Execution Results section
    if (data.executionResults && data.executionResults.length > 0) {
      sections.push({
        title: 'Execution Results',
        content: this.buildExecutionContent(data.executionResults),
        severity: data.executionResults.some((r) => !r.success) ? 'warning' : 'info',
      });
    }

    return sections;
  }

  private buildFileChangesContent(events: FileEvent[]): string {
    if (events.length === 0) {
      return 'No file changes detected during this period.';
    }

    const lines: string[] = [];
    lines.push(this.summarizeChanges(events));
    lines.push('');

    if (this.templateStyle === 'detailed') {
      // Group events by type
      const grouped = new Map<string, FileEvent[]>();
      for (const event of events) {
        const group = grouped.get(event.type) ?? [];
        group.push(event);
        grouped.set(event.type, group);
      }

      for (const [type, typeEvents] of grouped) {
        lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}d Files`);
        lines.push('');

        // Show up to 20 files per type
        const shown = typeEvents.slice(0, 20);
        for (const event of shown) {
          const time = new Date(event.timestamp).toISOString().substring(11, 19);
          const size = event.size !== undefined ? ` (${this.formatBytes(event.size)})` : '';
          lines.push(`- \`${event.path}\` at ${time}${size}`);
        }
        if (typeEvents.length > 20) {
          lines.push(`- ... and ${typeEvents.length - 20} more`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private buildCriticContent(reports: CriticReport[]): string {
    const lines: string[] = [];
    lines.push(this.summarizeCritics(reports));
    lines.push('');

    if (this.templateStyle === 'detailed') {
      // Average confidence
      const avgConfidence = reports.reduce((sum, r) => sum + r.confidence, 0) / reports.length;
      lines.push(`**Average Confidence:** ${(avgConfidence * 100).toFixed(1)}%`);

      // Average review time
      const avgDuration = reports.reduce((sum, r) => sum + r.duration, 0) / reports.length;
      lines.push(`**Average Review Time:** ${avgDuration.toFixed(0)}ms`);
      lines.push('');

      // Per-report summary (up to 10)
      const shown = reports.slice(0, 10);
      for (const report of shown) {
        const verdictEmoji = report.verdict === 'pass' ? 'PASS' : report.verdict === 'warn' ? 'WARN' : 'FAIL';
        lines.push(
          `- **[${verdictEmoji}]** Report \`${report.id.substring(0, 8)}\` — ${report.issues.length} issue(s), confidence ${(report.confidence * 100).toFixed(0)}%, ${report.duration}ms`,
        );
      }
      if (reports.length > 10) {
        lines.push(`- ... and ${reports.length - 10} more reviews`);
      }
    }

    return lines.join('\n');
  }

  private buildIssueDetailsContent(issues: CriticIssue[]): string {
    const lines: string[] = [];

    // Group by severity
    const bySeverity = new Map<string, CriticIssue[]>();
    for (const issue of issues) {
      const group = bySeverity.get(issue.severity) ?? [];
      group.push(issue);
      bySeverity.set(issue.severity, group);
    }

    const severityOrder: CriticIssue['severity'][] = ['critical', 'high', 'medium', 'low'];

    for (const severity of severityOrder) {
      const group = bySeverity.get(severity);
      if (!group || group.length === 0) continue;

      lines.push(`### ${severity.toUpperCase()} (${group.length})`);
      lines.push('');

      const shown = group.slice(0, 15);
      for (const issue of shown) {
        const location = issue.file
          ? issue.line
            ? `\`${issue.file}:${issue.line}\``
            : `\`${issue.file}\``
          : '';
        lines.push(`- **[${issue.category}]** ${issue.message}${location ? ` — ${location}` : ''}`);
        if (issue.suggestedFix) {
          lines.push(`  - Fix: ${issue.suggestedFix}`);
        }
      }
      if (group.length > 15) {
        lines.push(`- ... and ${group.length - 15} more ${severity} issues`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private buildExecutionContent(
    results: Array<{ prompt: string; success: boolean; duration: number; cost?: number }>,
  ): string {
    const lines: string[] = [];

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    const totalCost = results.reduce((sum, r) => sum + (r.cost ?? 0), 0);

    lines.push(`${results.length} execution(s): ${successful} succeeded, ${failed} failed.`);
    lines.push(`**Total Duration:** ${this.formatDuration(totalDuration)}`);
    if (totalCost > 0) {
      lines.push(`**Total Cost:** $${totalCost.toFixed(4)}`);
    }
    lines.push('');

    if (this.templateStyle === 'detailed') {
      const shown = results.slice(0, 10);
      for (const result of shown) {
        const status = result.success ? 'OK' : 'FAIL';
        const promptPreview = result.prompt.substring(0, 60).replace(/\n/g, ' ');
        const cost = result.cost !== undefined ? ` ($${result.cost.toFixed(4)})` : '';
        lines.push(
          `- **[${status}]** "${promptPreview}${result.prompt.length > 60 ? '...' : ''}" — ${this.formatDuration(result.duration)}${cost}`,
        );
      }
      if (results.length > 10) {
        lines.push(`- ... and ${results.length - 10} more executions`);
      }
    }

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Summary building
  // ─────────────────────────────────────────────────────────

  private buildSummary(
    data: SleepReportData,
    filesChanged: number,
    criticsRun: number,
    issuesFound: number,
  ): string {
    const periodHours = (data.period.end - data.period.start) / (1000 * 60 * 60);
    const confidence = data.confidence ?? this.synthesizeConfidence(data.criticReports);

    const parts: string[] = [];
    parts.push(`Over the past ${periodHours.toFixed(1)} hours:`);
    parts.push(`${filesChanged} file(s) changed, ${criticsRun} critic review(s) performed, ${issuesFound} issue(s) found.`);

    if (confidence.overall >= 0.8) {
      parts.push('Overall confidence is high. The codebase is in good shape.');
    } else if (confidence.overall >= 0.5) {
      parts.push('Overall confidence is moderate. Some issues should be addressed.');
    } else {
      parts.push('Overall confidence is low. Significant issues require attention.');
    }

    if (data.executionResults) {
      const successRate = data.executionResults.length > 0
        ? (data.executionResults.filter((r) => r.success).length / data.executionResults.length) * 100
        : 0;
      parts.push(`Execution success rate: ${successRate.toFixed(0)}%.`);
    }

    return parts.join(' ');
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Utilities
  // ─────────────────────────────────────────────────────────

  private synthesizeConfidence(reports: CriticReport[]): ConfidenceScore {
    if (reports.length === 0) {
      return {
        overall: 0.5,
        breakdown: {},
        factors: [{
          name: 'noData',
          weight: 1.0,
          score: 0.5,
          reason: 'No critic data available for confidence calculation.',
        }],
      };
    }

    const avgConfidence = reports.reduce((sum, r) => sum + r.confidence, 0) / reports.length;
    const passRate = reports.filter((r) => r.verdict === 'pass').length / reports.length;

    return {
      overall: avgConfidence * 0.6 + passRate * 0.4,
      breakdown: {
        avgCriticConfidence: avgConfidence,
        passRate,
      },
      factors: [
        {
          name: 'avgCriticConfidence',
          weight: 0.6,
          score: avgConfidence,
          reason: `Average critic confidence: ${(avgConfidence * 100).toFixed(1)}%.`,
        },
        {
          name: 'passRate',
          weight: 0.4,
          score: passRate,
          reason: `${(passRate * 100).toFixed(0)}% of critic reviews passed.`,
        },
      ],
    };
  }

  private getExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1 || lastDot === filePath.length - 1) return '(no ext)';
    return filePath.substring(lastDot);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }
}
