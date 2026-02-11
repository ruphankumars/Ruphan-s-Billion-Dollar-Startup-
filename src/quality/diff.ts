import { createTwoFilesPatch, structuredPatch, type ParsedDiff } from 'diff';
import { readFileSync } from 'fs';

export interface DiffSummary {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  patches: FilePatch[];
}

export interface FilePatch {
  filePath: string;
  linesAdded: number;
  linesRemoved: number;
  hunks: number;
}

/**
 * Create a unified diff between two strings
 */
export function createDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
): string {
  return createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: 3 },
  );
}

/**
 * Analyze a diff to get summary statistics
 */
export function analyzeDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
): FilePatch {
  const patches = structuredPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldContent,
    newContent,
  );

  let linesAdded = 0;
  let linesRemoved = 0;

  for (const hunk of patches.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) linesAdded++;
      if (line.startsWith('-')) linesRemoved++;
    }
  }

  return {
    filePath,
    linesAdded,
    linesRemoved,
    hunks: patches.hunks.length,
  };
}

/**
 * Create a summary of all changes
 */
export function summarizeChanges(patches: FilePatch[]): DiffSummary {
  return {
    filesChanged: patches.length,
    linesAdded: patches.reduce((sum, p) => sum + p.linesAdded, 0),
    linesRemoved: patches.reduce((sum, p) => sum + p.linesRemoved, 0),
    patches,
  };
}

/**
 * Format a diff summary for display
 */
export function formatDiffSummary(summary: DiffSummary): string {
  const lines = [`${summary.filesChanged} files changed, +${summary.linesAdded} -${summary.linesRemoved}`];
  for (const patch of summary.patches) {
    const icon = patch.linesRemoved === 0 ? '+' : patch.linesAdded === 0 ? '-' : '~';
    lines.push(`  ${icon} ${patch.filePath} (+${patch.linesAdded} -${patch.linesRemoved})`);
  }
  return lines.join('\n');
}
