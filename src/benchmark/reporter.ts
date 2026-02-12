/**
 * Benchmark Reporter — Formats benchmark results for display and export.
 *
 * Supports ASCII table output for terminals, JSON export for files,
 * and brief summary output for CI/CD pipelines.
 */

import type { BenchmarkReport, BenchmarkResult } from './types.js';

export class BenchmarkReporter {
  /** Format report as an ASCII table for terminal display */
  formatTable(report: BenchmarkReport): string {
    const lines: string[] = [];
    const sep = '─'.repeat(90);

    lines.push(`\n  CortexOS Benchmark Report`);
    lines.push(`  Provider: ${report.provider}  |  Model: ${report.model}`);
    lines.push(`  ${report.timestamp}`);
    lines.push(`  ${sep}`);

    // Header
    lines.push(
      `  ${'Task'.padEnd(30)} ${'Status'.padEnd(8)} ${'Time'.padEnd(10)} ${'Quality'.padEnd(9)} ${'Cost'.padEnd(10)}`,
    );
    lines.push(`  ${sep}`);

    // Results
    for (const result of report.results) {
      const status = result.success ? ' PASS' : ' FAIL';
      const time = `${(result.timeMs / 1000).toFixed(1)}s`;
      const quality = `${(result.qualityScore * 100).toFixed(0)}%`;
      const cost = `$${result.cost.toFixed(4)}`;

      lines.push(
        `  ${result.taskId.padEnd(30)} ${status.padEnd(8)} ${time.padEnd(10)} ${quality.padEnd(9)} ${cost.padEnd(10)}`,
      );
    }

    lines.push(`  ${sep}`);

    // Summary
    const s = report.summary;
    lines.push(`  Summary: ${s.passed}/${s.totalTasks} passed (${(s.successRate * 100).toFixed(0)}%)`);
    lines.push(`  Avg Time: ${(s.avgTimeMs / 1000).toFixed(1)}s  |  Total Cost: $${s.totalCost.toFixed(4)}  |  Avg Quality: ${(s.avgQuality * 100).toFixed(0)}%`);

    // Category breakdown
    if (Object.keys(report.categories).length > 0) {
      lines.push(`\n  Category Breakdown:`);
      for (const [cat, data] of Object.entries(report.categories)) {
        const rate = data.total > 0 ? Math.round((data.passed / data.total) * 100) : 0;
        lines.push(`    ${cat.padEnd(15)} ${data.passed}/${data.total} (${rate}%)  avg ${(data.avgTimeMs / 1000).toFixed(1)}s`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  /** Format report as JSON string for file export */
  formatJSON(report: BenchmarkReport): string {
    return JSON.stringify(report, null, 2);
  }

  /** Format a brief summary (for CI output) */
  formatSummary(report: BenchmarkReport): string {
    const s = report.summary;
    return [
      `CortexOS Benchmark: ${s.passed}/${s.totalTasks} passed (${(s.successRate * 100).toFixed(0)}%)`,
      `Provider: ${report.provider} | Model: ${report.model}`,
      `Avg Time: ${(s.avgTimeMs / 1000).toFixed(1)}s | Cost: $${s.totalCost.toFixed(4)} | Quality: ${(s.avgQuality * 100).toFixed(0)}%`,
    ].join('\n');
  }

  /** Format a single result as a one-liner */
  formatResult(result: BenchmarkResult): string {
    const status = result.success ? 'PASS' : 'FAIL';
    return `[${status}] ${result.taskId} — ${(result.timeMs / 1000).toFixed(1)}s, quality: ${(result.qualityScore * 100).toFixed(0)}%${result.error ? ` (${result.error})` : ''}`;
  }
}
