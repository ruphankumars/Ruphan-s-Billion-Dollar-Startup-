/**
 * DivergenceAnalyzer — Decision Divergence Analysis
 *
 * Compares original and replayed decision sequences, classifies
 * divergences by impact level, and generates human-readable reports.
 *
 * Part of CortexOS Time-Travel Debugging Module
 */

import type { DecisionRecord, Divergence } from './types.js';

// ═══════════════════════════════════════════════════════════════
// IMPACT WEIGHTS
// ═══════════════════════════════════════════════════════════════

/** Keywords that indicate high-impact stages. */
const CRITICAL_STAGES = new Set([
  'execute', 'deploy', 'commit', 'merge', 'delete', 'rollback',
]);

const MAJOR_STAGES = new Set([
  'plan', 'decompose', 'verify', 'test', 'build',
]);

// ═══════════════════════════════════════════════════════════════
// DIVERGENCE ANALYZER
// ═══════════════════════════════════════════════════════════════

export class DivergenceAnalyzer {
  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  /**
   * Compare two decision sequences (original vs replayed) and return
   * divergences where the `decision` field differs.
   *
   * Decisions are paired by index — the assumption is that replays
   * follow the same sequential ordering as the original. If the
   * replayed sequence is shorter than the original, trailing original
   * decisions are reported as divergences with `replayedDecision` set
   * to "(missing)".
   */
  analyze(
    original: DecisionRecord[],
    replayed: DecisionRecord[],
  ): Divergence[] {
    const divergences: Divergence[] = [];
    const maxLen = Math.max(original.length, replayed.length);

    for (let i = 0; i < maxLen; i++) {
      const orig = original[i];
      const rep = replayed[i];

      if (!orig && rep) {
        // Extra decisions in replay
        divergences.push({
          decisionId: rep.id,
          stage: rep.stage,
          originalDecision: '(missing)',
          replayedDecision: rep.decision,
          reason: 'Extra decision in replay that was not in original',
          impact: this.classifyDivergence(
            { stage: rep.stage, decision: '' } as DecisionRecord,
            rep,
          ),
        });
        continue;
      }

      if (orig && !rep) {
        // Missing decisions in replay
        divergences.push({
          decisionId: orig.id,
          stage: orig.stage,
          originalDecision: orig.decision,
          replayedDecision: '(missing)',
          reason: 'Decision from original not present in replay',
          impact: 'major',
        });
        continue;
      }

      if (orig && rep && orig.decision !== rep.decision) {
        divergences.push({
          decisionId: orig.id,
          stage: orig.stage,
          originalDecision: orig.decision,
          replayedDecision: rep.decision,
          reason: this.inferReason(orig, rep),
          impact: this.classifyDivergence(orig, rep),
        });
      }
    }

    return divergences;
  }

  // ---------------------------------------------------------------------------
  // Classification
  // ---------------------------------------------------------------------------

  /**
   * Classify the impact of a divergence between an original and a replayed
   * decision. Takes into account the stage and the degree of difference.
   */
  classifyDivergence(
    original: DecisionRecord,
    replayed: DecisionRecord,
  ): Divergence['impact'] {
    const stage = (original.stage || replayed.stage).toLowerCase();

    // Same decision = no impact
    if (original.decision === replayed.decision) {
      return 'none';
    }

    // Critical stages always produce critical divergences
    if (CRITICAL_STAGES.has(stage)) {
      return 'critical';
    }

    // Major stages
    if (MAJOR_STAGES.has(stage)) {
      return 'major';
    }

    // Check outcome difference
    const origSuccess = original.outcome?.success;
    const repSuccess = replayed.outcome?.success;
    if (origSuccess !== undefined && repSuccess !== undefined && origSuccess !== repSuccess) {
      return 'major';
    }

    // Check files changed difference
    const origFiles = new Set(original.outcome?.filesChanged ?? []);
    const repFiles = new Set(replayed.outcome?.filesChanged ?? []);
    if (origFiles.size !== repFiles.size) {
      return 'minor';
    }
    for (const f of origFiles) {
      if (!repFiles.has(f)) {
        return 'minor';
      }
    }

    return 'minor';
  }

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  /**
   * Generate a human-readable markdown report from an array of divergences.
   */
  generateReport(divergences: Divergence[]): string {
    if (divergences.length === 0) {
      return '# Divergence Report\n\nNo divergences detected. Original and replay are identical.\n';
    }

    const lines: string[] = [
      '# Divergence Report',
      '',
      `**Total divergences:** ${divergences.length}`,
      '',
      '## Impact Summary',
      '',
    ];

    const summary = this.getImpactSummary(divergences);
    lines.push(`| Impact   | Count |`);
    lines.push(`|----------|-------|`);
    lines.push(`| Critical | ${summary.critical} |`);
    lines.push(`| Major    | ${summary.major} |`);
    lines.push(`| Minor    | ${summary.minor} |`);
    lines.push(`| None     | ${summary.none} |`);
    lines.push('');

    // Root cause
    const rootCause = this.findRootCause(divergences);
    if (rootCause) {
      lines.push('## Root Cause');
      lines.push('');
      lines.push(
        `The first divergence occurred at decision \`${rootCause.decisionId}\` ` +
        `in stage **${rootCause.stage}**.`,
      );
      lines.push('');
      lines.push(`- **Original:** ${rootCause.originalDecision}`);
      lines.push(`- **Replayed:** ${rootCause.replayedDecision}`);
      lines.push(`- **Reason:** ${rootCause.reason}`);
      lines.push(`- **Impact:** ${rootCause.impact}`);
      lines.push('');
    }

    // Detailed list
    lines.push('## Divergences');
    lines.push('');

    for (let i = 0; i < divergences.length; i++) {
      const d = divergences[i];
      lines.push(`### ${i + 1}. ${d.stage} — ${d.impact.toUpperCase()}`);
      lines.push('');
      lines.push(`- **Decision ID:** \`${d.decisionId}\``);
      lines.push(`- **Original:** ${d.originalDecision}`);
      lines.push(`- **Replayed:** ${d.replayedDecision}`);
      lines.push(`- **Reason:** ${d.reason}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Root cause
  // ---------------------------------------------------------------------------

  /**
   * Find the root cause — the first divergence that caused downstream effects.
   * Currently returns the first divergence with the highest impact level.
   */
  findRootCause(divergences: Divergence[]): Divergence | null {
    if (divergences.length === 0) return null;

    const impactOrder: Record<Divergence['impact'], number> = {
      critical: 4,
      major: 3,
      minor: 2,
      none: 1,
    };

    // Find the first divergence with the highest impact
    let root = divergences[0];
    for (const d of divergences) {
      if (impactOrder[d.impact] > impactOrder[root.impact]) {
        root = d;
        break; // We want the *first* high-impact divergence
      }
    }

    return root;
  }

  // ---------------------------------------------------------------------------
  // Impact summary
  // ---------------------------------------------------------------------------

  /** Summarise divergences by impact level. */
  getImpactSummary(
    divergences: Divergence[],
  ): { none: number; minor: number; major: number; critical: number } {
    const summary = { none: 0, minor: 0, major: 0, critical: 0 };
    for (const d of divergences) {
      summary[d.impact]++;
    }
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Infer a human-readable reason for a divergence. */
  private inferReason(
    original: DecisionRecord,
    replayed: DecisionRecord,
  ): string {
    // Check if context changed
    const origTools = JSON.stringify(original.context.availableTools);
    const repTools = JSON.stringify(replayed.context.availableTools);
    if (origTools !== repTools) {
      return 'Available tools differ between original and replay';
    }

    const origMemory = JSON.stringify(original.context.memoryState);
    const repMemory = JSON.stringify(replayed.context.memoryState);
    if (origMemory !== repMemory) {
      return 'Memory state differs between original and replay';
    }

    const origEnv = JSON.stringify(original.context.environmentSnapshot);
    const repEnv = JSON.stringify(replayed.context.environmentSnapshot);
    if (origEnv !== repEnv) {
      return 'Environment snapshot differs between original and replay';
    }

    if (original.context.prompt !== replayed.context.prompt) {
      return 'Prompt differs between original and replay';
    }

    return 'Decision changed without detectable context difference (possible non-determinism)';
  }
}
