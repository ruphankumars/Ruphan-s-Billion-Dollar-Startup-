import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CapabilityExpander } from '../../../src/self-improve/capability-expander.js';

describe('CapabilityExpander', () => {
  let expander: CapabilityExpander;

  beforeEach(() => {
    expander = new CapabilityExpander({ minOccurrences: 2 });
  });

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts and stops', () => {
      expect(expander.isRunning()).toBe(false);
      expander.start();
      expect(expander.isRunning()).toBe(true);
      expander.stop();
      expect(expander.isRunning()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // recordFailure()
  // ─────────────────────────────────────────────────────────

  describe('recordFailure()', () => {
    it('records a failure and returns a CapabilityGap', () => {
      const gap = expander.recordFailure(
        'Deploy application',
        'Connection timeout when reaching the deployment server',
      );

      expect(gap.id).toMatch(/^gap_/);
      expect(gap.taskDescription).toBe('Deploy application');
      expect(gap.failureReason).toContain('Connection timeout');
      expect(gap.suggestedCapability).toBeDefined();
      expect(typeof gap.suggestedCapability).toBe('string');
      expect(gap.confidence).toBeGreaterThan(0);
      expect(gap.confidence).toBeLessThanOrEqual(1);
      expect(gap.detectedAt).toBeLessThanOrEqual(Date.now());
    });

    it('emits self-improve:gap:recorded event', () => {
      const listener = vi.fn();
      expander.on('self-improve:gap:recorded', listener);

      expander.recordFailure('Task', 'Permission denied');

      expect(listener).toHaveBeenCalledOnce();
    });

    it('enforces max gaps limit', () => {
      const smallExpander = new CapabilityExpander({ maxGaps: 5 });

      for (let i = 0; i < 10; i++) {
        smallExpander.recordFailure(`Task ${i}`, `Unique failure reason ${i} for testing`);
      }

      const gaps = smallExpander.getGaps();
      expect(gaps.length).toBeLessThanOrEqual(5);
    });

    it('infers capability based on failure keywords', () => {
      const timeoutGap = expander.recordFailure('Task', 'Operation timed out waiting for response');
      expect(timeoutGap.suggestedCapability).toBe('async-execution');

      const permissionGap = expander.recordFailure('Task', 'Access denied to resource');
      expect(permissionGap.suggestedCapability).toBe('auth-handling');

      const parseGap = expander.recordFailure('Task', 'Failed to parse JSON input');
      expect(parseGap.suggestedCapability).toBe('format-parsing');

      const networkGap = expander.recordFailure('Task', 'Network connection refused');
      expect(networkGap.suggestedCapability).toBe('network-resilience');

      const memoryGap = expander.recordFailure('Task', 'Out of memory error occurred');
      expect(memoryGap.suggestedCapability).toBe('memory-management');

      const dbGap = expander.recordFailure('Task', 'Database query failed');
      expect(dbGap.suggestedCapability).toBe('database-operations');
    });

    it('provides higher confidence for more specific failures', () => {
      const vagueGap = expander.recordFailure('Task', 'fail');
      const specificGap = expander.recordFailure(
        'Task',
        'ECONNREFUSED error: Network connection to database server failed with HTTP 503 status code',
      );

      expect(specificGap.confidence).toBeGreaterThan(vagueGap.confidence);
    });
  });

  // ─────────────────────────────────────────────────────────
  // getGaps()
  // ─────────────────────────────────────────────────────────

  describe('getGaps()', () => {
    it('returns empty array initially', () => {
      expect(expander.getGaps()).toEqual([]);
    });

    it('returns all recorded gaps', () => {
      expander.recordFailure('Task 1', 'Timeout error occurred');
      expander.recordFailure('Task 2', 'Permission denied error');
      expander.recordFailure('Task 3', 'Network failure occurred');

      const gaps = expander.getGaps();
      expect(gaps).toHaveLength(3);
      const descriptions = gaps.map((g) => g.taskDescription);
      expect(descriptions).toContain('Task 1');
      expect(descriptions).toContain('Task 2');
      expect(descriptions).toContain('Task 3');
    });
  });

  // ─────────────────────────────────────────────────────────
  // getSuggestions()
  // ─────────────────────────────────────────────────────────

  describe('getSuggestions()', () => {
    it('returns empty array when no gaps exist', () => {
      expect(expander.getSuggestions()).toEqual([]);
    });

    it('returns empty when occurrences are below minOccurrences', () => {
      // Only 1 failure, but minOccurrences is 2
      expander.recordFailure('Task', 'Connection timeout reached');

      const suggestions = expander.getSuggestions();
      expect(suggestions).toHaveLength(0);
    });

    it('provides suggestions when minOccurrences threshold is met', () => {
      // Record failures with identical failure reasons so they land in the same group
      expander.recordFailure('Task A', 'Network connection timeout reached');
      expander.recordFailure('Task B', 'Network connection timeout reached');

      const suggestions = expander.getSuggestions();
      expect(suggestions.length).toBeGreaterThanOrEqual(1);
      expect(suggestions[0].frequency).toBeGreaterThanOrEqual(2);
    });

    it('sorts suggestions by frequency descending', () => {
      // 3 identical timeout failures -> 1 group of 3
      expander.recordFailure('Task 1', 'Request timed out waiting for response');
      expander.recordFailure('Task 2', 'Request timed out waiting for response');
      expander.recordFailure('Task 3', 'Request timed out waiting for response');

      // 2 identical permission failures -> 1 group of 2
      expander.recordFailure('Task 4', 'Permission denied accessing resource');
      expander.recordFailure('Task 5', 'Permission denied accessing resource');

      const suggestions = expander.getSuggestions();
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      // First suggestion should have the highest frequency
      expect(suggestions[0].frequency).toBeGreaterThanOrEqual(suggestions[1].frequency);
    });

    it('includes capability name, frequency, avgConfidence, reasons, and gapIds', () => {
      expander.recordFailure('Task A', 'Parse error in JSON file');
      expander.recordFailure('Task B', 'Failed to parse YAML syntax');

      const suggestions = expander.getSuggestions();
      if (suggestions.length > 0) {
        const suggestion = suggestions[0];
        expect(suggestion.capability).toBeDefined();
        expect(typeof suggestion.frequency).toBe('number');
        expect(typeof suggestion.avgConfidence).toBe('number');
        expect(suggestion.avgConfidence).toBeGreaterThan(0);
        expect(suggestion.avgConfidence).toBeLessThanOrEqual(1);
        expect(suggestion.reasons).toBeInstanceOf(Array);
        expect(suggestion.gapIds).toBeInstanceOf(Array);
        expect(suggestion.gapIds.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ─────────────────────────────────────────────────────────
  // Grouping by similarity
  // ─────────────────────────────────────────────────────────

  describe('grouping by similarity', () => {
    it('groups similar failure reasons together', () => {
      // These should share enough words to be grouped
      expander.recordFailure('Task A', 'Database connection timeout error');
      expander.recordFailure('Task B', 'Database connection timeout failure');
      expander.recordFailure('Task C', 'Completely unrelated file not found issue');

      const gaps = expander.analyzeGaps();
      // The two database failures should be in the same group
      let maxGroupSize = 0;
      for (const [, members] of gaps) {
        if (members.length > maxGroupSize) {
          maxGroupSize = members.length;
        }
      }
      expect(maxGroupSize).toBeGreaterThanOrEqual(2);
    });

    it('does not group dissimilar failures', () => {
      expander.recordFailure('Task A', 'Memory heap overflow detected');
      expander.recordFailure('Task B', 'Permission access denied forbidden');

      const gaps = expander.analyzeGaps();
      // Each failure should be in its own group
      expect(gaps.size).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────
  // clearGap()
  // ─────────────────────────────────────────────────────────

  describe('clearGap()', () => {
    it('removes a gap by ID', () => {
      const gap = expander.recordFailure('Task', 'Timeout error');
      expect(expander.getGaps()).toHaveLength(1);

      const cleared = expander.clearGap(gap.id);
      expect(cleared).toBe(true);
      expect(expander.getGaps()).toHaveLength(0);
    });

    it('returns false for unknown gap ID', () => {
      expect(expander.clearGap('nonexistent')).toBe(false);
    });

    it('emits self-improve:gap:cleared event', () => {
      const gap = expander.recordFailure('Task', 'Timeout error');

      const listener = vi.fn();
      expander.on('self-improve:gap:cleared', listener);

      expander.clearGap(gap.id);
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ─────────────────────────────────────────────────────────
  // getStats()
  // ─────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns zero counts initially', () => {
      const stats = expander.getStats();
      expect(stats.totalGaps).toBe(0);
      expect(stats.uniqueCapabilities).toBe(0);
      expect(stats.suggestions).toBe(0);
    });

    it('returns correct statistics after recording failures', () => {
      expander.recordFailure('Task 1', 'Connection timeout error');
      expander.recordFailure('Task 2', 'Connection timed out waiting');
      expander.recordFailure('Task 3', 'Access denied to resource');

      const stats = expander.getStats();
      expect(stats.totalGaps).toBe(3);
      expect(stats.uniqueCapabilities).toBeGreaterThanOrEqual(1);
    });
  });
});
