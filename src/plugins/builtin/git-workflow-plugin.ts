/**
 * Git Workflow Plugin — Advanced git operations and commit message generation.
 *
 * Provides:
 * - `git_smart_commit` tool: Generate conventional commit messages from staged changes
 * - `git_branch_summary` tool: Summarize branch state, ahead/behind, conflicts
 * - `git_changelog` tool: Generate changelog from commit range
 * - Pre-verify middleware: Validates no sensitive files committed
 */

import { execSync } from 'child_process';
import type { CortexPlugin, PluginContext } from '../registry.js';
import type { Tool, ToolResult, ToolContext } from '../../tools/types.js';

// ===== Git Helpers =====

function runGit(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.split(' ')[0]} failed: ${msg}`);
  }
}

interface CommitInfo {
  hash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  files: string[];
}

function parseCommitLog(raw: string): CommitInfo[] {
  const commits: CommitInfo[] = [];
  const entries = raw.split('\n---COMMIT_SEPARATOR---\n').filter(e => e.trim());

  for (const entry of entries) {
    const lines = entry.split('\n');
    if (lines.length < 3) continue;

    const [hash, author, date, ...rest] = lines;
    const messageLines: string[] = [];
    const files: string[] = [];

    let inFiles = false;
    for (const line of rest) {
      if (line === '---FILES---') { inFiles = true; continue; }
      if (inFiles) { if (line.trim()) files.push(line.trim()); }
      else messageLines.push(line);
    }

    const subject = messageLines[0] || '';
    const body = messageLines.slice(1).join('\n').trim();

    commits.push({ hash, author, date, subject, body, files });
  }

  return commits;
}

// ===== Conventional Commit Classifier =====

function classifyChanges(diff: string, files: string[]): { type: string; scope: string | null } {
  // Classify by files changed
  const hasTests = files.some(f => f.includes('test') || f.includes('spec'));
  const hasDocs = files.some(f => f.endsWith('.md') || f.includes('docs/'));
  const hasCI = files.some(f => f.includes('.github/') || f.includes('ci'));
  const hasSrc = files.some(f => f.startsWith('src/'));

  // Classify by diff content
  const isFixLikely = /fix|bug|patch|error|crash|issue/i.test(diff);
  const isRefactor = /refactor|rename|restructure|cleanup/i.test(diff);
  const hasNewExports = /^\+export/m.test(diff);

  // Determine scope from common directories
  let scope: string | null = null;
  const srcFiles = files.filter(f => f.startsWith('src/'));
  if (srcFiles.length > 0) {
    const dirs = srcFiles.map(f => f.split('/')[1]).filter(Boolean);
    const uniqueDirs = [...new Set(dirs)];
    if (uniqueDirs.length === 1) scope = uniqueDirs[0];
  }

  // Determine type
  let type = 'feat';
  if (hasTests && !hasSrc) type = 'test';
  else if (hasDocs && !hasSrc) type = 'docs';
  else if (hasCI) type = 'ci';
  else if (isFixLikely) type = 'fix';
  else if (isRefactor && !hasNewExports) type = 'refactor';

  return { type, scope };
}

// ===== Sensitive File Detection =====

const SENSITIVE_PATTERNS = [
  /\.env$/,
  /\.env\.\w+$/,
  /credentials\.json$/,
  /serviceAccountKey\.json$/,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
  /\.secret/,
  /token\.json$/,
  /\.npmrc$/,
  /\.pypirc$/,
];

function detectSensitiveFiles(files: string[]): string[] {
  return files.filter(f => SENSITIVE_PATTERNS.some(p => p.test(f)));
}

// ===== Tools =====

function createSmartCommitTool(): Tool {
  return {
    name: 'git_smart_commit',
    description: 'Generate a conventional commit message based on staged changes. Analyzes diff to classify type (feat/fix/refactor/test/docs/ci) and scope.',
    parameters: {
      type: 'object',
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'If true, only generate the message without committing (default: true)',
        },
      },
      required: [],
    },
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const dryRun = args.dryRun !== false;
      const cwd = context.workingDir;

      try {
        const diff = runGit('diff --cached --stat', cwd);
        if (!diff.trim()) {
          return { success: false, output: '', error: 'No staged changes found. Run `git add` first.' };
        }

        const stagedFiles = runGit('diff --cached --name-only', cwd).split('\n').filter(Boolean);
        const fullDiff = runGit('diff --cached', cwd);

        // Check for sensitive files
        const sensitive = detectSensitiveFiles(stagedFiles);
        if (sensitive.length > 0) {
          return {
            success: false,
            output: '',
            error: `Sensitive files detected in staged changes: ${sensitive.join(', ')}. Unstage them before committing.`,
          };
        }

        const { type, scope } = classifyChanges(fullDiff, stagedFiles);
        const scopePart = scope ? `(${scope})` : '';

        // Build summary from diff stat
        const statsLines = diff.split('\n').filter(l => l.includes('|'));
        const fileCount = statsLines.length;
        const summary = fileCount === 1
          ? `update ${stagedFiles[0].split('/').pop()}`
          : `update ${fileCount} files`;

        const message = `${type}${scopePart}: ${summary}`;

        if (dryRun) {
          return {
            success: true,
            output: JSON.stringify({
              message,
              type,
              scope,
              filesChanged: stagedFiles.length,
              sensitiveFilesDetected: 0,
            }, null, 2),
          };
        }

        runGit(`commit -m "${message}"`, cwd);
        return {
          success: true,
          output: JSON.stringify({ message, committed: true }, null, 2),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function createBranchSummaryTool(): Tool {
  return {
    name: 'git_branch_summary',
    description: 'Get detailed summary of current branch: name, ahead/behind, recent commits, uncommitted changes, conflicts',
    parameters: {
      type: 'object',
      properties: {
        compareTo: {
          type: 'string',
          description: 'Branch to compare against (default: main)',
        },
      },
      required: [],
    },
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const cwd = context.workingDir;
      const compareTo = (args.compareTo as string) || 'main';

      try {
        const branch = runGit('branch --show-current', cwd) || 'detached HEAD';
        const status = runGit('status --porcelain', cwd);

        let ahead = 0;
        let behind = 0;
        try {
          const abStr = runGit(`rev-list --left-right --count ${compareTo}...HEAD`, cwd);
          const parts = abStr.split(/\s+/);
          behind = parseInt(parts[0]) || 0;
          ahead = parseInt(parts[1]) || 0;
        } catch { /* no upstream or invalid ref */ }

        const uncommitted = status.split('\n').filter(Boolean);
        const modified = uncommitted.filter(l => l.startsWith(' M') || l.startsWith('M ')).length;
        const untracked = uncommitted.filter(l => l.startsWith('??')).length;
        const staged = uncommitted.filter(l => /^[AMDR]/.test(l)).length;

        let recentCommits: string[] = [];
        try {
          recentCommits = runGit('log --oneline -5', cwd).split('\n').filter(Boolean);
        } catch { /* empty repo */ }

        return {
          success: true,
          output: JSON.stringify({
            branch,
            compareTo,
            ahead,
            behind,
            uncommittedChanges: { modified, untracked, staged, total: uncommitted.length },
            recentCommits,
          }, null, 2),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function createChangelogTool(): Tool {
  return {
    name: 'git_changelog',
    description: 'Generate a structured changelog from a commit range, grouped by type (feat/fix/refactor/etc)',
    parameters: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Starting commit/tag (default: last tag or first commit)',
        },
        to: {
          type: 'string',
          description: 'Ending commit/tag (default: HEAD)',
        },
      },
      required: [],
    },
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const cwd = context.workingDir;
      let from = args.from as string | undefined;
      const to = (args.to as string) || 'HEAD';

      if (!from) {
        try {
          from = runGit('describe --tags --abbrev=0', cwd);
        } catch {
          // No tags — use root commit
          from = runGit('rev-list --max-parents=0 HEAD', cwd).split('\n')[0];
        }
      }

      try {
        const format = '%H%n%an%n%ad%n%s%n%b%n---FILES---%n---COMMIT_SEPARATOR---';
        const raw = runGit(`log ${from}..${to} --format="${format}" --name-only --date=short`, cwd);
        const commits = parseCommitLog(raw);

        // Group by conventional commit type
        const groups: Record<string, CommitInfo[]> = {};
        for (const commit of commits) {
          const match = commit.subject.match(/^(\w+)(?:\([^)]*\))?:\s/);
          const type = match ? match[1] : 'other';
          if (!groups[type]) groups[type] = [];
          groups[type].push(commit);
        }

        // Build markdown
        const typeLabels: Record<string, string> = {
          feat: 'Features',
          fix: 'Bug Fixes',
          refactor: 'Refactoring',
          test: 'Tests',
          docs: 'Documentation',
          ci: 'CI/CD',
          chore: 'Chores',
          other: 'Other',
        };

        const sections: string[] = [];
        for (const [type, items] of Object.entries(groups)) {
          const label = typeLabels[type] || type;
          const bullets = items.map(c => `- ${c.subject} (${c.hash.slice(0, 7)})`).join('\n');
          sections.push(`### ${label}\n${bullets}`);
        }

        const changelog = sections.join('\n\n');

        return {
          success: true,
          output: JSON.stringify({
            range: `${from}..${to}`,
            commitCount: commits.length,
            changelog,
          }, null, 2),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

// ===== Plugin =====

export const GitWorkflowPlugin: CortexPlugin = {
  name: 'cortexos-git-workflow',
  version: '1.0.0',
  description: 'Smart git operations: conventional commits, branch analysis, changelog generation',
  author: 'CortexOS',

  register(ctx: PluginContext): void {
    ctx.registerTool(createSmartCommitTool());
    ctx.registerTool(createBranchSummaryTool());
    ctx.registerTool(createChangelogTool());

    // Pre-verify middleware: block sensitive files
    ctx.registerMiddleware('pre-verify', (data: unknown) => {
      const execData = data as { filesChanged?: string[] } | undefined;
      if (execData?.filesChanged) {
        const sensitive = detectSensitiveFiles(execData.filesChanged);
        if (sensitive.length > 0) {
          throw new Error(
            `Sensitive files detected in changes: ${sensitive.join(', ')}. ` +
            'These should not be committed to version control.',
          );
        }
      }
      return data;
    });
  },
};

export { classifyChanges, detectSensitiveFiles, type CommitInfo };
