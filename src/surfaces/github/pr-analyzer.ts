/**
 * PR Analyzer — Heuristic Pull Request Analysis Engine
 *
 * Provides lightweight, zero-dependency PR analysis using heuristic rules:
 * file extension patterns, change size thresholds, naming conventions,
 * and structural change detection.
 *
 * Designed to work without LLM calls — fast enough for synchronous
 * webhook processing. For deeper analysis, pipe results through the
 * CortexOS reasoning engine via the task handler.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface PRInput {
  title: string;
  body: string;
  diff: string;
  files: string[];
  headRef: string;
  baseRef: string;
  author: string;
  isDraft: boolean;
}

export interface PRAnalysis {
  overallScore: number; // 0-100
  summary: string;
  issues: PRIssue[];
  suggestions: PRSuggestion[];
  metrics: PRMetrics;
  categories: string[];
}

export interface PRIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
}

export interface PRSuggestion {
  type: 'improvement' | 'best-practice' | 'style';
  message: string;
  file?: string;
}

export interface PRMetrics {
  totalFiles: number;
  linesAdded: number;
  linesRemoved: number;
  totalChanges: number;
  testFilesChanged: number;
  configFilesChanged: number;
  documentationChanged: boolean;
  hasTests: boolean;
  changeSize: 'xs' | 'small' | 'medium' | 'large' | 'xl';
}

// ═══════════════════════════════════════════════════════════════
// FILE CLASSIFICATION PATTERNS
// ═══════════════════════════════════════════════════════════════

const TEST_PATTERNS = [
  /\.test\.\w+$/,
  /\.spec\.\w+$/,
  /_test\.\w+$/,
  /test\/.*\.\w+$/,
  /tests\/.*\.\w+$/,
  /__tests__\/.*\.\w+$/,
];

const CONFIG_PATTERNS = [
  /\.config\.\w+$/,
  /\.env/,
  /tsconfig/,
  /package\.json$/,
  /Dockerfile$/,
  /docker-compose/,
  /\.yml$/,
  /\.yaml$/,
  /\.toml$/,
  /\.ini$/,
  /\.rc$/,
  /eslint/,
  /prettier/,
  /babel/,
  /webpack/,
  /vite\.config/,
  /rollup/,
  /jest\.config/,
  /vitest\.config/,
];

const DOC_PATTERNS = [
  /\.md$/,
  /\.mdx$/,
  /\.txt$/,
  /\.rst$/,
  /README/i,
  /CHANGELOG/i,
  /CONTRIBUTING/i,
  /LICENSE/i,
  /docs\//,
];

const BINARY_PATTERNS = [
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.ico$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
  /\.pdf$/,
  /\.zip$/,
  /\.tar$/,
  /\.gz$/,
];

const SENSITIVE_PATTERNS = [
  /\.env\.production/,
  /\.env\.local/,
  /secret/i,
  /credentials/i,
  /privatekey/i,
  /\.pem$/,
  /\.key$/,
];

// Change size thresholds (total lines changed)
const SIZE_THRESHOLDS = {
  xs: 10,
  small: 50,
  medium: 200,
  large: 500,
} as const;

// ═══════════════════════════════════════════════════════════════
// PR ANALYZER
// ═══════════════════════════════════════════════════════════════

export class PRAnalyzer {

  /**
   * Perform full heuristic analysis on a PR.
   */
  analyzePR(input: PRInput): PRAnalysis {
    const issues: PRIssue[] = [];
    const suggestions: PRSuggestion[] = [];

    // Calculate metrics
    const metrics = this.calculateMetrics(input);

    // Run analysis rules
    this.checkPRSize(metrics, issues, suggestions);
    this.checkTestCoverage(input, metrics, issues, suggestions);
    this.checkSensitiveFiles(input, issues);
    this.checkDocumentation(input, metrics, suggestions);
    this.checkTitleAndDescription(input, issues, suggestions);
    this.checkBranchNaming(input, suggestions);
    this.checkDraftStatus(input, suggestions);
    this.checkDiffPatterns(input, issues, suggestions);

    // Calculate overall score
    const overallScore = this.calculateScore(metrics, issues, suggestions);

    // Determine categories
    const categories = this.categorizeChanges(input);

    // Generate summary
    const summary = this.generateSummary(metrics, issues, suggestions, categories);

    return {
      overallScore,
      summary,
      issues,
      suggestions,
      metrics,
      categories,
    };
  }

  /**
   * Generate a formatted review comment for GitHub.
   */
  generateReviewComment(analysis: PRAnalysis): string {
    const lines: string[] = [];

    // Header with score
    const scoreEmoji = analysis.overallScore >= 80 ? '&#9989;' :
      analysis.overallScore >= 60 ? '&#9888;&#65039;' : '&#10060;';
    lines.push(`## ${scoreEmoji} CortexOS PR Analysis — Score: ${analysis.overallScore}/100`);
    lines.push('');
    lines.push(analysis.summary);
    lines.push('');

    // Metrics
    lines.push('### Metrics');
    lines.push(`- **Files changed:** ${analysis.metrics.totalFiles}`);
    lines.push(`- **Lines added:** +${analysis.metrics.linesAdded}`);
    lines.push(`- **Lines removed:** -${analysis.metrics.linesRemoved}`);
    lines.push(`- **Change size:** ${analysis.metrics.changeSize}`);
    lines.push(`- **Has tests:** ${analysis.metrics.hasTests ? 'Yes' : 'No'}`);
    lines.push(`- **Documentation updated:** ${analysis.metrics.documentationChanged ? 'Yes' : 'No'}`);
    lines.push('');

    // Issues
    if (analysis.issues.length > 0) {
      lines.push('### Issues');
      for (const issue of analysis.issues) {
        const icon = issue.severity === 'error' ? '&#128308;' :
          issue.severity === 'warning' ? '&#128992;' : '&#128309;';
        const location = issue.file ? ` \`${issue.file}\`${issue.line ? `:${issue.line}` : ''}` : '';
        lines.push(`- ${icon} **${issue.severity}:** ${issue.message}${location}`);
      }
      lines.push('');
    }

    // Suggestions
    if (analysis.suggestions.length > 0) {
      lines.push('### Suggestions');
      for (const suggestion of analysis.suggestions) {
        const location = suggestion.file ? ` \`${suggestion.file}\`` : '';
        lines.push(`- **${suggestion.type}:** ${suggestion.message}${location}`);
      }
      lines.push('');
    }

    // Categories
    if (analysis.categories.length > 0) {
      lines.push(`### Categories: ${analysis.categories.map((c) => `\`${c}\``).join(' ')}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('*Analyzed by [CortexOS](https://cortexos.dev) Surface Adapter*');

    return lines.join('\n');
  }

  /**
   * Suggest labels based on PR content analysis.
   */
  suggestLabels(input: PRInput): string[] {
    const labels: Set<string> = new Set();
    const categories = this.categorizeChanges(input);

    // Map categories to labels
    for (const category of categories) {
      switch (category) {
        case 'bug-fix':
          labels.add('bug');
          break;
        case 'feature':
          labels.add('feature');
          labels.add('enhancement');
          break;
        case 'documentation':
          labels.add('documentation');
          break;
        case 'tests':
          labels.add('tests');
          break;
        case 'refactor':
          labels.add('refactor');
          break;
        case 'ci-cd':
          labels.add('ci/cd');
          break;
        case 'dependencies':
          labels.add('dependencies');
          break;
        case 'config':
          labels.add('configuration');
          break;
        case 'security':
          labels.add('security');
          break;
        case 'performance':
          labels.add('performance');
          break;
      }
    }

    // Size-based labels
    const metrics = this.calculateMetrics(input);
    if (metrics.changeSize === 'xs' || metrics.changeSize === 'small') {
      labels.add('size/small');
    } else if (metrics.changeSize === 'large' || metrics.changeSize === 'xl') {
      labels.add('size/large');
    }

    return [...labels];
  }

  // ─── Metrics Calculation ───────────────────────────────────

  private calculateMetrics(input: PRInput): PRMetrics {
    const { diff, files } = input;

    let linesAdded = 0;
    let linesRemoved = 0;

    // Parse diff for line counts
    const diffLines = diff.split('\n');
    for (const line of diffLines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        linesAdded++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        linesRemoved++;
      }
    }

    const totalChanges = linesAdded + linesRemoved;

    // Classify files
    const testFilesChanged = files.filter((f) => TEST_PATTERNS.some((p) => p.test(f))).length;
    const configFilesChanged = files.filter((f) => CONFIG_PATTERNS.some((p) => p.test(f))).length;
    const documentationChanged = files.some((f) => DOC_PATTERNS.some((p) => p.test(f)));
    const hasTests = testFilesChanged > 0;

    // Determine change size
    let changeSize: PRMetrics['changeSize'];
    if (totalChanges <= SIZE_THRESHOLDS.xs) changeSize = 'xs';
    else if (totalChanges <= SIZE_THRESHOLDS.small) changeSize = 'small';
    else if (totalChanges <= SIZE_THRESHOLDS.medium) changeSize = 'medium';
    else if (totalChanges <= SIZE_THRESHOLDS.large) changeSize = 'large';
    else changeSize = 'xl';

    return {
      totalFiles: files.length,
      linesAdded,
      linesRemoved,
      totalChanges,
      testFilesChanged,
      configFilesChanged,
      documentationChanged,
      hasTests,
      changeSize,
    };
  }

  // ─── Analysis Rules ────────────────────────────────────────

  private checkPRSize(
    metrics: PRMetrics,
    issues: PRIssue[],
    suggestions: PRSuggestion[],
  ): void {
    if (metrics.changeSize === 'xl') {
      issues.push({
        severity: 'warning',
        message: `Very large PR with ${metrics.totalChanges} lines changed across ${metrics.totalFiles} files. Consider breaking into smaller PRs.`,
      });
    } else if (metrics.changeSize === 'large') {
      suggestions.push({
        type: 'best-practice',
        message: `Large PR with ${metrics.totalChanges} lines changed. Smaller PRs are easier to review.`,
      });
    }

    if (metrics.totalFiles > 20) {
      issues.push({
        severity: 'warning',
        message: `${metrics.totalFiles} files changed. PRs touching many files are harder to review and more likely to cause conflicts.`,
      });
    }
  }

  private checkTestCoverage(
    input: PRInput,
    metrics: PRMetrics,
    issues: PRIssue[],
    suggestions: PRSuggestion[],
  ): void {
    // Non-trivial changes without tests
    const sourceFiles = input.files.filter((f) =>
      !TEST_PATTERNS.some((p) => p.test(f)) &&
      !CONFIG_PATTERNS.some((p) => p.test(f)) &&
      !DOC_PATTERNS.some((p) => p.test(f)) &&
      !BINARY_PATTERNS.some((p) => p.test(f)),
    );

    if (sourceFiles.length > 0 && !metrics.hasTests && metrics.totalChanges > SIZE_THRESHOLDS.xs) {
      issues.push({
        severity: 'warning',
        message: 'Source files changed but no test files were updated. Consider adding tests for the changes.',
      });
    }

    // Check test-to-source ratio for large PRs
    if (metrics.totalFiles > 5 && metrics.testFilesChanged > 0) {
      const testRatio = metrics.testFilesChanged / sourceFiles.length;
      if (testRatio < 0.3 && sourceFiles.length > 3) {
        suggestions.push({
          type: 'best-practice',
          message: `Test coverage appears low (${metrics.testFilesChanged} test files for ${sourceFiles.length} source files).`,
        });
      }
    }
  }

  private checkSensitiveFiles(
    input: PRInput,
    issues: PRIssue[],
  ): void {
    for (const file of input.files) {
      if (SENSITIVE_PATTERNS.some((p) => p.test(file))) {
        issues.push({
          severity: 'error',
          message: `Potentially sensitive file changed. Verify no secrets are being committed.`,
          file,
        });
      }
    }
  }

  private checkDocumentation(
    input: PRInput,
    metrics: PRMetrics,
    suggestions: PRSuggestion[],
  ): void {
    // Suggest documentation for large changes
    if (
      !metrics.documentationChanged &&
      metrics.changeSize !== 'xs' &&
      metrics.changeSize !== 'small' &&
      input.files.some((f) => /\.(ts|js|py|go|rs|java)$/.test(f))
    ) {
      suggestions.push({
        type: 'best-practice',
        message: 'Consider updating documentation to reflect these changes.',
      });
    }
  }

  private checkTitleAndDescription(
    input: PRInput,
    issues: PRIssue[],
    suggestions: PRSuggestion[],
  ): void {
    // Check title quality
    if (input.title.length < 10) {
      issues.push({
        severity: 'warning',
        message: 'PR title is very short. Use a descriptive title that summarizes the changes.',
      });
    }

    if (input.title.length > 100) {
      suggestions.push({
        type: 'style',
        message: 'PR title is quite long. Consider keeping it under 72 characters.',
      });
    }

    // Check for WIP indicators
    if (/^(WIP|wip|draft|DRAFT)[\s:]/i.test(input.title)) {
      suggestions.push({
        type: 'improvement',
        message: 'PR appears to be work-in-progress. Mark it as a draft instead.',
      });
    }

    // Check description
    if (!input.body || input.body.trim().length < 20) {
      issues.push({
        severity: 'warning',
        message: 'PR description is missing or too short. Add context about what changed and why.',
      });
    }
  }

  private checkBranchNaming(
    input: PRInput,
    suggestions: PRSuggestion[],
  ): void {
    const branch = input.headRef;

    // Check for conventional branch naming
    const conventionalPattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\//;
    if (!conventionalPattern.test(branch) && !branch.includes('/')) {
      suggestions.push({
        type: 'style',
        message: `Branch name "${branch}" does not follow conventional naming (e.g., feat/..., fix/...).`,
      });
    }
  }

  private checkDraftStatus(
    input: PRInput,
    suggestions: PRSuggestion[],
  ): void {
    if (input.isDraft) {
      suggestions.push({
        type: 'improvement',
        message: 'This is a draft PR. Mark as ready for review when complete.',
      });
    }
  }

  private checkDiffPatterns(
    input: PRInput,
    issues: PRIssue[],
    suggestions: PRSuggestion[],
  ): void {
    const { diff } = input;

    // Check for console.log / debugger statements
    const debugPatterns = [
      { pattern: /^\+.*console\.log\(/gm, message: 'console.log() statement found — consider removing before merge.' },
      { pattern: /^\+.*debugger/gm, message: 'debugger statement found — should be removed before merge.' },
      { pattern: /^\+.*TODO(?!:)/gm, message: 'TODO comment without description found.' },
      { pattern: /^\+.*FIXME/gm, message: 'FIXME comment found — should be resolved before merge.' },
      { pattern: /^\+.*HACK/gm, message: 'HACK comment found — consider a proper solution.' },
    ];

    for (const { pattern, message } of debugPatterns) {
      const matches = diff.match(pattern);
      if (matches && matches.length > 0) {
        issues.push({
          severity: 'warning',
          message: `${message} (${matches.length} occurrence${matches.length > 1 ? 's' : ''})`,
        });
      }
    }

    // Check for large single-file changes
    const fileChanges = new Map<string, number>();
    let currentFile = '';
    for (const line of diff.split('\n')) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/b\/(.+)$/);
        if (match) currentFile = match[1];
      } else if (
        currentFile &&
        ((line.startsWith('+') && !line.startsWith('+++')) ||
          (line.startsWith('-') && !line.startsWith('---')))
      ) {
        fileChanges.set(currentFile, (fileChanges.get(currentFile) ?? 0) + 1);
      }
    }

    for (const [file, changes] of fileChanges) {
      if (changes > 300) {
        suggestions.push({
          type: 'improvement',
          message: `${changes} lines changed — consider breaking this file's changes into smaller commits.`,
          file,
        });
      }
    }
  }

  // ─── Scoring ───────────────────────────────────────────────

  private calculateScore(
    metrics: PRMetrics,
    issues: PRIssue[],
    _suggestions: PRSuggestion[],
  ): number {
    let score = 100;

    // Deduct for issues
    for (const issue of issues) {
      switch (issue.severity) {
        case 'error':
          score -= 15;
          break;
        case 'warning':
          score -= 8;
          break;
        case 'info':
          score -= 2;
          break;
      }
    }

    // Deduct for size
    if (metrics.changeSize === 'xl') score -= 10;
    else if (metrics.changeSize === 'large') score -= 5;

    // Bonus for tests
    if (metrics.hasTests) score += 5;

    // Bonus for documentation
    if (metrics.documentationChanged) score += 3;

    return Math.max(0, Math.min(100, score));
  }

  // ─── Categorization ────────────────────────────────────────

  private categorizeChanges(input: PRInput): string[] {
    const categories: Set<string> = new Set();
    const { title, body, files, headRef } = input;
    const titleLower = title.toLowerCase();
    const bodyLower = (body || '').toLowerCase();
    const branchLower = headRef.toLowerCase();

    // Branch-based categorization
    if (/^fix\/|\/fix[-_]/i.test(headRef) || /\bfix\b|\bbug\b|\bhotfix\b/.test(branchLower)) {
      categories.add('bug-fix');
    }
    if (/^feat\/|\/feat[-_]/i.test(headRef) || /\bfeat\b|\bfeature\b/.test(branchLower)) {
      categories.add('feature');
    }
    if (/^docs\/|\/docs[-_]/i.test(headRef)) {
      categories.add('documentation');
    }
    if (/^refactor\/|\/refactor[-_]/i.test(headRef)) {
      categories.add('refactor');
    }
    if (/^test\/|\/test[-_]/i.test(headRef)) {
      categories.add('tests');
    }
    if (/^ci\/|\/ci[-_]/i.test(headRef)) {
      categories.add('ci-cd');
    }
    if (/^perf\/|\/perf[-_]/i.test(headRef)) {
      categories.add('performance');
    }

    // Title-based categorization
    if (/\bfix(es|ed)?\b|\bbug\b|\bresolv(e|es|ed)\b/.test(titleLower)) {
      categories.add('bug-fix');
    }
    if (/\b(add|implement|introduce|create)\b/.test(titleLower) && !categories.has('bug-fix')) {
      categories.add('feature');
    }
    if (/\brefactor\b|\bclean\s*up\b|\brestructur/.test(titleLower)) {
      categories.add('refactor');
    }
    if (/\bdoc(s|umentation)?\b|\breadme\b/.test(titleLower)) {
      categories.add('documentation');
    }
    if (/\btest(s|ing)?\b/.test(titleLower)) {
      categories.add('tests');
    }
    if (/\bsecurity\b|\bvuln\b|\bcve\b/.test(titleLower) || /\bsecurity\b/.test(bodyLower)) {
      categories.add('security');
    }
    if (/\bperf(ormance)?\b|\boptimiz(e|ation)\b|\bspeed\b/.test(titleLower)) {
      categories.add('performance');
    }

    // File-based categorization
    if (files.some((f) => DOC_PATTERNS.some((p) => p.test(f)))) {
      categories.add('documentation');
    }
    if (files.some((f) => TEST_PATTERNS.some((p) => p.test(f)))) {
      categories.add('tests');
    }
    if (files.some((f) => /package\.json$|go\.sum$|Cargo\.lock$|yarn\.lock$|pnpm-lock\.yaml$/.test(f))) {
      categories.add('dependencies');
    }
    if (files.some((f) => /\.github\/|Jenkinsfile|\.gitlab-ci|Dockerfile|docker-compose/.test(f))) {
      categories.add('ci-cd');
    }
    if (files.some((f) => CONFIG_PATTERNS.some((p) => p.test(f))) && !categories.has('feature')) {
      categories.add('config');
    }

    // Default: if no categories detected
    if (categories.size === 0) {
      categories.add('maintenance');
    }

    return [...categories];
  }

  // ─── Summary Generation ────────────────────────────────────

  private generateSummary(
    metrics: PRMetrics,
    issues: PRIssue[],
    suggestions: PRSuggestion[],
    categories: string[],
  ): string {
    const parts: string[] = [];

    // Change overview
    parts.push(
      `This ${metrics.changeSize} PR modifies ${metrics.totalFiles} file${metrics.totalFiles !== 1 ? 's' : ''} ` +
      `(+${metrics.linesAdded}/-${metrics.linesRemoved} lines).`,
    );

    // Category summary
    if (categories.length > 0) {
      parts.push(`Categorized as: ${categories.join(', ')}.`);
    }

    // Issue summary
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;
    if (errors > 0 || warnings > 0) {
      const issueParts: string[] = [];
      if (errors > 0) issueParts.push(`${errors} error${errors !== 1 ? 's' : ''}`);
      if (warnings > 0) issueParts.push(`${warnings} warning${warnings !== 1 ? 's' : ''}`);
      parts.push(`Found ${issueParts.join(' and ')}.`);
    }

    // Suggestions count
    if (suggestions.length > 0) {
      parts.push(`${suggestions.length} suggestion${suggestions.length !== 1 ? 's' : ''} for improvement.`);
    }

    return parts.join(' ');
  }
}
