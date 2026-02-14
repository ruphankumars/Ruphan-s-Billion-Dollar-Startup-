import { describe, it, expect, beforeEach } from 'vitest';
import { DivergenceAnalyzer } from '../../../src/time-travel/diff-analyzer.js';
import type { DecisionRecord, Divergence } from '../../../src/time-travel/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: overrides.id ?? 'dec_1',
    sessionId: overrides.sessionId ?? 's1',
    timestamp: overrides.timestamp ?? Date.now(),
    stage: overrides.stage ?? 'plan',
    decision: overrides.decision ?? 'action A',
    alternatives: overrides.alternatives ?? [],
    context: overrides.context ?? {
      prompt: 'test',
      availableTools: ['tool_a'],
      memoryState: {},
      agentState: {},
      environmentSnapshot: {},
    },
    outcome: overrides.outcome,
    parentId: overrides.parentId,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('DivergenceAnalyzer', () => {
  let analyzer: DivergenceAnalyzer;

  beforeEach(() => {
    analyzer = new DivergenceAnalyzer();
  });

  // ─── analyze ──────────────────────────────────────────────────

  describe('analyze', () => {
    it('should return no divergences when sequences are identical', () => {
      const original = [
        makeRecord({ id: 'o1', decision: 'A' }),
        makeRecord({ id: 'o2', decision: 'B' }),
      ];
      const replayed = [
        makeRecord({ id: 'r1', decision: 'A' }),
        makeRecord({ id: 'r2', decision: 'B' }),
      ];

      const divergences = analyzer.analyze(original, replayed);
      expect(divergences).toHaveLength(0);
    });

    it('should detect divergences when decisions differ', () => {
      const original = [
        makeRecord({ id: 'o1', decision: 'A' }),
        makeRecord({ id: 'o2', decision: 'B' }),
      ];
      const replayed = [
        makeRecord({ id: 'r1', decision: 'A' }),
        makeRecord({ id: 'r2', decision: 'C' }),
      ];

      const divergences = analyzer.analyze(original, replayed);
      expect(divergences).toHaveLength(1);
      expect(divergences[0].originalDecision).toBe('B');
      expect(divergences[0].replayedDecision).toBe('C');
    });

    it('should report missing decisions in replay', () => {
      const original = [
        makeRecord({ id: 'o1', decision: 'A' }),
        makeRecord({ id: 'o2', decision: 'B' }),
        makeRecord({ id: 'o3', decision: 'C' }),
      ];
      const replayed = [
        makeRecord({ id: 'r1', decision: 'A' }),
      ];

      const divergences = analyzer.analyze(original, replayed);
      expect(divergences).toHaveLength(2);
      expect(divergences[0].replayedDecision).toBe('(missing)');
      expect(divergences[1].replayedDecision).toBe('(missing)');
    });

    it('should report extra decisions in replay', () => {
      const original = [
        makeRecord({ id: 'o1', decision: 'A' }),
      ];
      const replayed = [
        makeRecord({ id: 'r1', decision: 'A' }),
        makeRecord({ id: 'r2', decision: 'B' }),
      ];

      const divergences = analyzer.analyze(original, replayed);
      expect(divergences).toHaveLength(1);
      expect(divergences[0].originalDecision).toBe('(missing)');
      expect(divergences[0].replayedDecision).toBe('B');
    });

    it('should handle empty sequences', () => {
      expect(analyzer.analyze([], [])).toEqual([]);
    });

    it('should handle one empty and one non-empty', () => {
      const original = [makeRecord({ id: 'o1', decision: 'A' })];
      const divergences = analyzer.analyze(original, []);
      expect(divergences).toHaveLength(1);
    });
  });

  // ─── classifyDivergence ───────────────────────────────────────

  describe('classifyDivergence', () => {
    it('should return "none" for identical decisions', () => {
      const orig = makeRecord({ decision: 'A' });
      const rep = makeRecord({ decision: 'A' });

      expect(analyzer.classifyDivergence(orig, rep)).toBe('none');
    });

    it('should return "critical" for critical stages', () => {
      const criticalStages = ['execute', 'deploy', 'commit', 'merge', 'delete', 'rollback'];

      for (const stage of criticalStages) {
        const orig = makeRecord({ stage, decision: 'A' });
        const rep = makeRecord({ stage, decision: 'B' });
        expect(analyzer.classifyDivergence(orig, rep)).toBe('critical');
      }
    });

    it('should return "major" for major stages', () => {
      const majorStages = ['plan', 'decompose', 'verify', 'test', 'build'];

      for (const stage of majorStages) {
        const orig = makeRecord({ stage, decision: 'A' });
        const rep = makeRecord({ stage, decision: 'B' });
        expect(analyzer.classifyDivergence(orig, rep)).toBe('major');
      }
    });

    it('should return "major" when outcome success differs', () => {
      const orig = makeRecord({
        stage: 'observe',
        decision: 'A',
        outcome: { success: true, result: 'ok', filesChanged: [], tokensUsed: 0, duration: 0 },
      });
      const rep = makeRecord({
        stage: 'observe',
        decision: 'B',
        outcome: { success: false, result: 'fail', filesChanged: [], tokensUsed: 0, duration: 0 },
      });

      expect(analyzer.classifyDivergence(orig, rep)).toBe('major');
    });

    it('should return "minor" for file change differences', () => {
      const orig = makeRecord({
        stage: 'observe',
        decision: 'A',
        outcome: { success: true, result: 'ok', filesChanged: ['a.ts'], tokensUsed: 0, duration: 0 },
      });
      const rep = makeRecord({
        stage: 'observe',
        decision: 'B',
        outcome: { success: true, result: 'ok', filesChanged: ['a.ts', 'b.ts'], tokensUsed: 0, duration: 0 },
      });

      expect(analyzer.classifyDivergence(orig, rep)).toBe('minor');
    });

    it('should return "minor" for default non-critical stages', () => {
      const orig = makeRecord({ stage: 'observe', decision: 'A' });
      const rep = makeRecord({ stage: 'observe', decision: 'B' });

      expect(analyzer.classifyDivergence(orig, rep)).toBe('minor');
    });
  });

  // ─── generateReport ──────────────────────────────────────────

  describe('generateReport', () => {
    it('should generate a report with no divergences', () => {
      const report = analyzer.generateReport([]);
      expect(report).toContain('No divergences detected');
    });

    it('should generate a report with divergence details', () => {
      const divergences: Divergence[] = [
        {
          decisionId: 'd1',
          stage: 'execute',
          originalDecision: 'run tests',
          replayedDecision: 'skip tests',
          reason: 'user override',
          impact: 'critical',
        },
        {
          decisionId: 'd2',
          stage: 'plan',
          originalDecision: 'plan A',
          replayedDecision: 'plan B',
          reason: 'context change',
          impact: 'major',
        },
      ];

      const report = analyzer.generateReport(divergences);
      expect(report).toContain('# Divergence Report');
      expect(report).toContain('**Total divergences:** 2');
      expect(report).toContain('## Impact Summary');
      expect(report).toContain('Critical');
      expect(report).toContain('## Root Cause');
      expect(report).toContain('## Divergences');
      expect(report).toContain('run tests');
      expect(report).toContain('skip tests');
    });

    it('should include impact summary table', () => {
      const divergences: Divergence[] = [
        { decisionId: 'd1', stage: 'execute', originalDecision: 'A', replayedDecision: 'B', reason: 'test', impact: 'critical' },
        { decisionId: 'd2', stage: 'plan', originalDecision: 'C', replayedDecision: 'D', reason: 'test', impact: 'minor' },
      ];

      const report = analyzer.generateReport(divergences);
      expect(report).toContain('| Critical | 1 |');
      expect(report).toContain('| Minor    | 1 |');
    });
  });

  // ─── findRootCause ────────────────────────────────────────────

  describe('findRootCause', () => {
    it('should return null for empty divergences', () => {
      expect(analyzer.findRootCause([])).toBeNull();
    });

    it('should return the first divergence if all have same impact', () => {
      const divergences: Divergence[] = [
        { decisionId: 'd1', stage: 'plan', originalDecision: 'A', replayedDecision: 'B', reason: '', impact: 'minor' },
        { decisionId: 'd2', stage: 'plan', originalDecision: 'C', replayedDecision: 'D', reason: '', impact: 'minor' },
      ];

      const root = analyzer.findRootCause(divergences);
      expect(root).not.toBeNull();
      expect(root!.decisionId).toBe('d1');
    });

    it('should return the first higher-impact divergence as root cause', () => {
      const divergences: Divergence[] = [
        { decisionId: 'd1', stage: 'plan', originalDecision: 'A', replayedDecision: 'B', reason: '', impact: 'minor' },
        { decisionId: 'd2', stage: 'execute', originalDecision: 'C', replayedDecision: 'D', reason: '', impact: 'critical' },
        { decisionId: 'd3', stage: 'deploy', originalDecision: 'E', replayedDecision: 'F', reason: '', impact: 'critical' },
      ];

      const root = analyzer.findRootCause(divergences);
      expect(root).not.toBeNull();
      expect(root!.decisionId).toBe('d2');
    });
  });

  // ─── getImpactSummary ─────────────────────────────────────────

  describe('getImpactSummary', () => {
    it('should count divergences by impact level', () => {
      const divergences: Divergence[] = [
        { decisionId: 'd1', stage: '', originalDecision: '', replayedDecision: '', reason: '', impact: 'critical' },
        { decisionId: 'd2', stage: '', originalDecision: '', replayedDecision: '', reason: '', impact: 'critical' },
        { decisionId: 'd3', stage: '', originalDecision: '', replayedDecision: '', reason: '', impact: 'major' },
        { decisionId: 'd4', stage: '', originalDecision: '', replayedDecision: '', reason: '', impact: 'minor' },
        { decisionId: 'd5', stage: '', originalDecision: '', replayedDecision: '', reason: '', impact: 'none' },
      ];

      const summary = analyzer.getImpactSummary(divergences);
      expect(summary.critical).toBe(2);
      expect(summary.major).toBe(1);
      expect(summary.minor).toBe(1);
      expect(summary.none).toBe(1);
    });

    it('should return all zeros for empty array', () => {
      const summary = analyzer.getImpactSummary([]);
      expect(summary).toEqual({ none: 0, minor: 0, major: 0, critical: 0 });
    });
  });
});
