/**
 * Smart Diff Generation
 * Generates human-readable diffs and change summaries
 */

export interface FileDiff {
  path: string;
  type: 'added' | 'modified' | 'deleted';
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

/**
 * Generate a unified diff between two strings
 */
export function generateDiff(oldContent: string, newContent: string, filePath: string): FileDiff {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  if (oldContent === '') {
    return {
      path: filePath,
      type: 'added',
      hunks: [{
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: newLines.length,
        lines: newLines.map((line, i) => ({
          type: 'add' as const,
          content: line,
          newLineNum: i + 1,
        })),
      }],
      additions: newLines.length,
      deletions: 0,
    };
  }

  if (newContent === '') {
    return {
      path: filePath,
      type: 'deleted',
      hunks: [{
        oldStart: 1,
        oldLines: oldLines.length,
        newStart: 0,
        newLines: 0,
        lines: oldLines.map((line, i) => ({
          type: 'remove' as const,
          content: line,
          oldLineNum: i + 1,
        })),
      }],
      additions: 0,
      deletions: oldLines.length,
    };
  }

  // Simple LCS-based diff
  const hunks = computeHunks(oldLines, newLines);
  const additions = hunks.reduce((sum, h) => sum + h.lines.filter(l => l.type === 'add').length, 0);
  const deletions = hunks.reduce((sum, h) => sum + h.lines.filter(l => l.type === 'remove').length, 0);

  return {
    path: filePath,
    type: 'modified',
    hunks,
    additions,
    deletions,
  };
}

/**
 * Compute diff hunks using a simplified approach
 */
function computeHunks(oldLines: string[], newLines: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    // Find next difference
    if (oldIdx < oldLines.length && newIdx < newLines.length && oldLines[oldIdx] === newLines[newIdx]) {
      oldIdx++;
      newIdx++;
      continue;
    }

    // Found a difference — collect the hunk
    const hunkOldStart = oldIdx + 1;
    const hunkNewStart = newIdx + 1;
    const lines: DiffLine[] = [];

    // Add context lines before (up to 3)
    const contextBefore = Math.min(3, oldIdx);
    for (let c = contextBefore; c > 0; c--) {
      lines.push({
        type: 'context',
        content: oldLines[oldIdx - c],
        oldLineNum: oldIdx - c + 1,
        newLineNum: newIdx - c + 1,
      });
    }

    // Collect differing lines
    while (
      (oldIdx < oldLines.length || newIdx < newLines.length) &&
      (oldIdx >= oldLines.length || newIdx >= newLines.length || oldLines[oldIdx] !== newLines[newIdx])
    ) {
      if (oldIdx < oldLines.length && (newIdx >= newLines.length || !newLines.includes(oldLines[oldIdx]))) {
        lines.push({
          type: 'remove',
          content: oldLines[oldIdx],
          oldLineNum: oldIdx + 1,
        });
        oldIdx++;
      } else if (newIdx < newLines.length) {
        lines.push({
          type: 'add',
          content: newLines[newIdx],
          newLineNum: newIdx + 1,
        });
        newIdx++;
      } else {
        break;
      }

      // Safety limit per hunk
      if (lines.length > 100) break;
    }

    // Add context lines after (up to 3)
    const contextAfter = Math.min(3, Math.min(oldLines.length - oldIdx, newLines.length - newIdx));
    for (let c = 0; c < contextAfter; c++) {
      if (oldLines[oldIdx + c] === newLines[newIdx + c]) {
        lines.push({
          type: 'context',
          content: oldLines[oldIdx + c],
          oldLineNum: oldIdx + c + 1,
          newLineNum: newIdx + c + 1,
        });
      }
    }

    if (lines.length > 0) {
      hunks.push({
        oldStart: hunkOldStart - contextBefore,
        oldLines: lines.filter(l => l.type !== 'add').length,
        newStart: hunkNewStart - contextBefore,
        newLines: lines.filter(l => l.type !== 'remove').length,
        lines,
      });
    }
  }

  return hunks;
}

/**
 * Format a diff for display
 */
export function formatDiff(diff: FileDiff): string {
  const lines: string[] = [];

  lines.push(`--- a/${diff.path}`);
  lines.push(`+++ b/${diff.path}`);

  for (const hunk of diff.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
      lines.push(`${prefix}${line.content}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate a summary of changes
 */
export function summarizeChanges(diffs: FileDiff[]): string {
  const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0);
  const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0);
  const added = diffs.filter(d => d.type === 'added').length;
  const modified = diffs.filter(d => d.type === 'modified').length;
  const deleted = diffs.filter(d => d.type === 'deleted').length;

  const parts: string[] = [];
  parts.push(`${diffs.length} files changed`);
  if (added > 0) parts.push(`${added} added`);
  if (modified > 0) parts.push(`${modified} modified`);
  if (deleted > 0) parts.push(`${deleted} deleted`);
  parts.push(`(+${totalAdditions} -${totalDeletions} lines)`);

  return parts.join(', ');
}
