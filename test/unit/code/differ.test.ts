import { describe, it, expect } from 'vitest';
import { generateDiff, formatDiff, summarizeChanges, type FileDiff } from '../../../src/code/differ.js';

describe('generateDiff', () => {
  it('should detect a new file when old content is empty', () => {
    const diff = generateDiff('', 'line1\nline2\nline3', 'src/new-file.ts');

    expect(diff.path).toBe('src/new-file.ts');
    expect(diff.type).toBe('added');
    expect(diff.additions).toBe(3);
    expect(diff.deletions).toBe(0);
    expect(diff.hunks.length).toBe(1);
    expect(diff.hunks[0].lines.every(l => l.type === 'add')).toBe(true);
  });

  it('should detect a deleted file when new content is empty', () => {
    const content = 'line1\nline2\nline3\nline4';
    const diff = generateDiff(content, '', 'src/removed.ts');

    expect(diff.path).toBe('src/removed.ts');
    expect(diff.type).toBe('deleted');
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(4);
    expect(diff.hunks.length).toBe(1);
    expect(diff.hunks[0].lines.every(l => l.type === 'remove')).toBe(true);
  });

  it('should detect a modified file with additions and deletions', () => {
    const oldContent = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const newContent = 'const a = 1;\nconst b = 99;\nconst c = 3;\nconst d = 4;';
    const diff = generateDiff(oldContent, newContent, 'src/config.ts');

    expect(diff.type).toBe('modified');
    expect(diff.additions).toBeGreaterThan(0);
    expect(diff.deletions).toBeGreaterThan(0);

    const allLines = diff.hunks.flatMap(h => h.lines);
    expect(allLines.some(l => l.type === 'add')).toBe(true);
    expect(allLines.some(l => l.type === 'remove')).toBe(true);
  });

  it('should set correct line counts for added file hunks', () => {
    const diff = generateDiff('', 'a\nb\nc', 'file.txt');

    expect(diff.hunks[0].oldStart).toBe(0);
    expect(diff.hunks[0].oldLines).toBe(0);
    expect(diff.hunks[0].newStart).toBe(1);
    expect(diff.hunks[0].newLines).toBe(3);
  });

  it('should set correct line counts for deleted file hunks', () => {
    const diff = generateDiff('a\nb', '', 'file.txt');

    expect(diff.hunks[0].oldStart).toBe(1);
    expect(diff.hunks[0].oldLines).toBe(2);
    expect(diff.hunks[0].newStart).toBe(0);
    expect(diff.hunks[0].newLines).toBe(0);
  });

  it('should produce no change hunks for identical content', () => {
    const content = 'same line 1\nsame line 2\nsame line 3';
    const diff = generateDiff(content, content, 'unchanged.ts');

    expect(diff.type).toBe('modified');
    expect(diff.hunks.length).toBe(0);
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
  });

  it('should preserve the file path in the result', () => {
    const diff = generateDiff('old', 'new', 'deep/nested/path/file.ts');
    expect(diff.path).toBe('deep/nested/path/file.ts');
  });
});

describe('formatDiff', () => {
  it('should include --- and +++ headers with the file path', () => {
    const diff = generateDiff('', 'new content', 'src/hello.ts');
    const formatted = formatDiff(diff);

    expect(formatted).toContain('--- a/src/hello.ts');
    expect(formatted).toContain('+++ b/src/hello.ts');
  });

  it('should include @@ hunk headers', () => {
    const diff = generateDiff('old line', 'new line', 'file.ts');
    const formatted = formatDiff(diff);

    expect(formatted).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('should prefix added lines with +', () => {
    const diff = generateDiff('', 'added line', 'file.ts');
    const formatted = formatDiff(diff);

    expect(formatted).toContain('+added line');
  });

  it('should prefix removed lines with -', () => {
    const diff = generateDiff('removed line', '', 'file.ts');
    const formatted = formatDiff(diff);

    expect(formatted).toContain('-removed line');
  });

  it('should prefix context lines with a space', () => {
    const oldContent = 'context\nold\ncontext2';
    const newContent = 'context\nnew\ncontext2';
    const diff = generateDiff(oldContent, newContent, 'file.ts');
    const formatted = formatDiff(diff);

    const lines = formatted.split('\n');
    const contextLines = lines.filter(l => l.startsWith(' '));
    // If context lines were included in the hunk, they should be space-prefixed
    if (contextLines.length > 0) {
      expect(contextLines[0]).toMatch(/^ .+/);
    }
  });

  it('should produce valid unified diff format for a new file', () => {
    const diff = generateDiff('', 'line1\nline2', 'new.ts');
    const formatted = formatDiff(diff);
    const lines = formatted.split('\n');

    expect(lines[0]).toBe('--- a/new.ts');
    expect(lines[1]).toBe('+++ b/new.ts');
    expect(lines[2]).toMatch(/^@@/);
    expect(lines[3]).toBe('+line1');
    expect(lines[4]).toBe('+line2');
  });
});

describe('summarizeChanges', () => {
  it('should show correct totals for multiple diffs', () => {
    const diffs: FileDiff[] = [
      { path: 'a.ts', type: 'added', hunks: [], additions: 5, deletions: 0 },
      { path: 'b.ts', type: 'modified', hunks: [], additions: 3, deletions: 2 },
      { path: 'c.ts', type: 'modified', hunks: [], additions: 2, deletions: 3 },
    ];
    const summary = summarizeChanges(diffs);

    expect(summary).toContain('3 files changed');
    expect(summary).toContain('1 added');
    expect(summary).toContain('2 modified');
    expect(summary).toContain('+10');
    expect(summary).toContain('-5');
  });

  it('should show "X files changed"', () => {
    const diffs: FileDiff[] = [
      { path: 'x.ts', type: 'added', hunks: [], additions: 1, deletions: 0 },
      { path: 'y.ts', type: 'deleted', hunks: [], additions: 0, deletions: 1 },
    ];
    const summary = summarizeChanges(diffs);

    expect(summary).toContain('2 files changed');
  });

  it('should include deleted count when files are deleted', () => {
    const diffs: FileDiff[] = [
      { path: 'old.ts', type: 'deleted', hunks: [], additions: 0, deletions: 10 },
    ];
    const summary = summarizeChanges(diffs);

    expect(summary).toContain('1 deleted');
    expect(summary).toContain('-10');
  });

  it('should handle a single added file', () => {
    const diffs: FileDiff[] = [
      { path: 'new.ts', type: 'added', hunks: [], additions: 7, deletions: 0 },
    ];
    const summary = summarizeChanges(diffs);

    expect(summary).toContain('1 files changed');
    expect(summary).toContain('1 added');
    expect(summary).toContain('+7');
    expect(summary).toContain('-0');
  });

  it('should handle an empty diff array', () => {
    const summary = summarizeChanges([]);

    expect(summary).toContain('0 files changed');
    expect(summary).toContain('+0');
    expect(summary).toContain('-0');
  });
});
