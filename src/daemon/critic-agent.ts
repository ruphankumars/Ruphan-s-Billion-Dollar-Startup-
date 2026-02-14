/**
 * CriticAgent — Self-verification agent for code review
 *
 * Combines static analysis (no LLM needed) with structured review to produce
 * CriticReports. Static methods detect hardcoded secrets, large files,
 * TODO/FIXME comments, and code complexity issues.
 *
 * Zero npm dependencies — uses only Node.js built-ins.
 */

import { EventEmitter } from 'node:events';
import * as crypto from 'node:crypto';
import type { CriticReport, CriticIssue } from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface CriticAgentOptions {
  /** Maximum concurrent reviews. Default: 3 */
  maxConcurrent?: number;
  /** Timeout per review in ms. Default: 60000 */
  timeout?: number;
}

interface ReviewContext {
  files: Array<{ path: string; content: string; diff?: string }>;
  prompt?: string;
  taskId?: string;
}

// ═══════════════════════════════════════════════════════════════
// SECRET DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════

const SECRET_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, name: 'OpenAI/Stripe secret key' },
  { pattern: /sk-proj-[a-zA-Z0-9_-]{20,}/g, name: 'OpenAI project key' },
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, name: 'Anthropic API key' },
  { pattern: /AKIA[0-9A-Z]{16}/g, name: 'AWS Access Key ID' },
  { pattern: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP)?\s*PRIVATE KEY-----/g, name: 'Private key' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, name: 'GitHub personal access token' },
  { pattern: /gho_[a-zA-Z0-9]{36}/g, name: 'GitHub OAuth token' },
  { pattern: /github_pat_[a-zA-Z0-9_]{22,}/g, name: 'GitHub fine-grained PAT' },
  { pattern: /xox[bpoas]-[a-zA-Z0-9-]+/g, name: 'Slack token' },
  { pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, name: 'JWT token' },
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi, name: 'Hardcoded password' },
  { pattern: /(?:secret|api_key|apikey|api_secret|access_token)\s*[:=]\s*['"][^'"]{4,}['"]/gi, name: 'Hardcoded secret/API key' },
  { pattern: /(?:mongodb(?:\+srv)?:\/\/)[^\s'"]+/g, name: 'MongoDB connection string' },
  { pattern: /(?:postgres(?:ql)?:\/\/)[^\s'"]+/g, name: 'PostgreSQL connection string' },
  { pattern: /(?:mysql:\/\/)[^\s'"]+/g, name: 'MySQL connection string' },
  { pattern: /(?:redis:\/\/)[^\s'"]+/g, name: 'Redis connection string' },
];

// ═══════════════════════════════════════════════════════════════
// COMPLEXITY THRESHOLDS
// ═══════════════════════════════════════════════════════════════

const MAX_NESTING_DEPTH = 4;
const MAX_FUNCTION_LINES = 100;
const MAX_PARAMETERS = 5;
const DEFAULT_LARGE_FILE_THRESHOLD = 10000; // lines

// ═══════════════════════════════════════════════════════════════
// CRITIC AGENT
// ═══════════════════════════════════════════════════════════════

export class CriticAgent extends EventEmitter {
  private maxConcurrent: number;
  private timeout: number;
  private activeReviews = 0;
  private reviewCount = 0;
  private totalConfidence = 0;

  constructor(options?: CriticAgentOptions) {
    super();
    this.maxConcurrent = options?.maxConcurrent ?? 3;
    this.timeout = options?.timeout ?? 60000;
  }

  // ─────────────────────────────────────────────────────────
  // CORE REVIEW
  // ─────────────────────────────────────────────────────────

  /**
   * Perform a comprehensive review of the given files.
   * Combines all static analysis methods and produces a CriticReport.
   */
  async review(context: ReviewContext): Promise<CriticReport> {
    const startTime = Date.now();
    const reportId = crypto.randomUUID();

    // Wait if at concurrency limit
    while (this.activeReviews >= this.maxConcurrent) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.activeReviews++;

    try {
      const allIssues: CriticIssue[] = [];

      // Run all static analysis in parallel
      const [securityIssues, qualityIssues, performanceIssues] = await Promise.all([
        this.securityReview(context.files),
        this.qualityReview(context.files),
        this.performanceReview(context.files),
      ]);

      allIssues.push(...securityIssues, ...qualityIssues, ...performanceIssues);

      // Compute verdict based on issues
      const verdict = this.computeVerdict(allIssues);
      const confidence = this.computeConfidence(allIssues, context.files);

      // Generate suggestions
      const suggestions = this.generateSuggestions(allIssues);

      const duration = Date.now() - startTime;

      const report: CriticReport = {
        id: reportId,
        taskId: context.taskId,
        timestamp: Date.now(),
        verdict,
        confidence,
        issues: allIssues,
        suggestions,
        duration,
      };

      this.reviewCount++;
      this.totalConfidence += confidence;

      this.emit('review:complete', report);
      return report;
    } finally {
      this.activeReviews--;
    }
  }

  // ─────────────────────────────────────────────────────────
  // SPECIALIZED REVIEWS
  // ─────────────────────────────────────────────────────────

  /**
   * Security-focused review: secrets, credentials, injection risks.
   */
  async securityReview(files: Array<{ path: string; content: string }>): Promise<CriticIssue[]> {
    const issues: CriticIssue[] = [];

    for (const file of files) {
      issues.push(...CriticAgent.detectHardcodedSecrets(file.content, file.path));
    }

    return issues;
  }

  /**
   * Code quality review: TODOs, complexity, large files, style issues.
   */
  async qualityReview(files: Array<{ path: string; content: string }>): Promise<CriticIssue[]> {
    const issues: CriticIssue[] = [];

    for (const file of files) {
      issues.push(...CriticAgent.detectTodoFixme(file.content, file.path));
      issues.push(...CriticAgent.detectComplexity(file.content, file.path));
    }

    issues.push(...CriticAgent.detectLargeFiles(files));

    return issues;
  }

  /**
   * Performance-focused review: large files, complexity hotspots.
   */
  async performanceReview(files: Array<{ path: string; content: string }>): Promise<CriticIssue[]> {
    const issues: CriticIssue[] = [];

    for (const file of files) {
      // Detect deeply nested loops (potential O(n^k) complexity)
      const nestedLoops = this.detectNestedLoops(file.content, file.path);
      issues.push(...nestedLoops);

      // Detect synchronous I/O calls in async contexts
      const syncIO = this.detectSyncIOCalls(file.content, file.path);
      issues.push(...syncIO);
    }

    return issues;
  }

  // ─────────────────────────────────────────────────────────
  // STATIC ANALYSIS — No LLM needed
  // ─────────────────────────────────────────────────────────

  /**
   * Detect hardcoded secrets, API keys, passwords, tokens, and private keys
   * using regex pattern matching.
   */
  static detectHardcodedSecrets(content: string, filePath: string): CriticIssue[] {
    const issues: CriticIssue[] = [];
    const lines = content.split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      // Skip comments that are clearly documentation
      const trimmed = line.trim();
      if (trimmed.startsWith('//') && (trimmed.includes('example') || trimmed.includes('placeholder') || trimmed.includes('TODO'))) {
        continue;
      }

      for (const { pattern, name } of SECRET_PATTERNS) {
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;

        if (pattern.test(line)) {
          issues.push({
            severity: 'critical',
            category: 'security',
            message: `Potential ${name} detected`,
            file: filePath,
            line: lineIndex + 1,
            suggestedFix: `Move this value to an environment variable or secrets manager. Use process.env.YOUR_KEY_NAME instead of hardcoding.`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Detect files that exceed a threshold line count.
   * Default threshold: 10000 lines.
   */
  static detectLargeFiles(
    files: Array<{ path: string; content: string }>,
    threshold: number = DEFAULT_LARGE_FILE_THRESHOLD,
  ): CriticIssue[] {
    const issues: CriticIssue[] = [];

    for (const file of files) {
      const lineCount = file.content.split('\n').length;

      if (lineCount > threshold) {
        issues.push({
          severity: 'medium',
          category: 'quality',
          message: `File has ${lineCount} lines, exceeding the threshold of ${threshold}. Consider splitting into smaller modules.`,
          file: file.path,
          suggestedFix: `Break this file into smaller, focused modules. Group related functions/classes into separate files.`,
        });
      }
    }

    return issues;
  }

  /**
   * Find TODO, FIXME, HACK, and XXX comments in code.
   */
  static detectTodoFixme(content: string, filePath: string): CriticIssue[] {
    const issues: CriticIssue[] = [];
    const lines = content.split('\n');

    const todoPattern = /\b(TODO|FIXME|HACK|XXX)\b\s*:?\s*(.*)/gi;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      todoPattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = todoPattern.exec(line)) !== null) {
        const tag = match[1].toUpperCase();
        const description = match[2]?.trim() || '(no description)';

        const severity: CriticIssue['severity'] =
          tag === 'FIXME' || tag === 'HACK' ? 'medium' :
          tag === 'XXX' ? 'high' :
          'low';

        issues.push({
          severity,
          category: 'quality',
          message: `${tag}: ${description}`,
          file: filePath,
          line: lineIndex + 1,
          suggestedFix: tag === 'FIXME' || tag === 'HACK'
            ? 'Address this issue before merging to production.'
            : 'Consider resolving or creating a tracking issue.',
        });
      }
    }

    return issues;
  }

  /**
   * Detect code complexity issues:
   * - Deeply nested blocks (if/for/while depth > 4)
   * - Long functions (> 100 lines)
   * - Functions with too many parameters (> 5)
   */
  static detectComplexity(content: string, filePath: string): CriticIssue[] {
    const issues: CriticIssue[] = [];
    const lines = content.split('\n');

    // Track nesting depth
    let currentDepth = 0;
    let maxDepthInCurrentScope = 0;
    let maxDepthLine = 0;

    // Track function boundaries
    let functionStartLine = -1;
    let functionName = '';
    let braceDepthAtFunctionStart = 0;
    let inFunction = false;

    // Function detection patterns
    const functionPattern = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>|(\w+)\s*\([^)]*\)\s*{|(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w[^{]*)?\s*{)/;
    const paramPattern = /\(([^)]*)\)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments and strings (basic heuristic)
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue;
      }

      // Count braces for nesting depth
      for (const char of line) {
        if (char === '{') {
          currentDepth++;
          if (currentDepth > maxDepthInCurrentScope) {
            maxDepthInCurrentScope = currentDepth;
            maxDepthLine = i + 1;
          }
        } else if (char === '}') {
          // Check if we're closing a function
          if (inFunction && currentDepth === braceDepthAtFunctionStart + 1) {
            const functionLength = i - functionStartLine;
            if (functionLength > MAX_FUNCTION_LINES) {
              issues.push({
                severity: 'medium',
                category: 'quality',
                message: `Function '${functionName || 'anonymous'}' is ${functionLength} lines long (max recommended: ${MAX_FUNCTION_LINES}).`,
                file: filePath,
                line: functionStartLine + 1,
                suggestedFix: 'Break this function into smaller, focused helper functions.',
              });
            }
            inFunction = false;
          }
          currentDepth = Math.max(0, currentDepth - 1);
        }
      }

      // Detect function declarations
      const funcMatch = functionPattern.exec(trimmed);
      if (funcMatch) {
        const name = funcMatch[1] || funcMatch[2] || funcMatch[3] || funcMatch[4] || 'anonymous';
        functionStartLine = i;
        functionName = name;
        braceDepthAtFunctionStart = currentDepth - 1; // The { was already counted above
        inFunction = true;

        // Check parameter count
        const paramMatch = paramPattern.exec(trimmed);
        if (paramMatch && paramMatch[1]) {
          const params = paramMatch[1]
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p.length > 0 && p !== '');
          if (params.length > MAX_PARAMETERS) {
            issues.push({
              severity: 'low',
              category: 'quality',
              message: `Function '${name}' has ${params.length} parameters (max recommended: ${MAX_PARAMETERS}).`,
              file: filePath,
              line: i + 1,
              suggestedFix: 'Consider grouping related parameters into an options object.',
            });
          }
        }
      }
    }

    // Report deep nesting
    if (maxDepthInCurrentScope > MAX_NESTING_DEPTH) {
      issues.push({
        severity: 'medium',
        category: 'quality',
        message: `Maximum nesting depth of ${maxDepthInCurrentScope} detected (max recommended: ${MAX_NESTING_DEPTH}).`,
        file: filePath,
        line: maxDepthLine,
        suggestedFix: 'Reduce nesting by using early returns, guard clauses, or extracting nested logic into helper functions.',
      });
    }

    return issues;
  }

  // ─────────────────────────────────────────────────────────
  // STATS
  // ─────────────────────────────────────────────────────────

  /**
   * Get total number of reviews performed.
   */
  getReviewCount(): number {
    return this.reviewCount;
  }

  /**
   * Get the average confidence across all reviews.
   */
  getAverageConfidence(): number {
    if (this.reviewCount === 0) return 0;
    return this.totalConfidence / this.reviewCount;
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Performance checks
  // ─────────────────────────────────────────────────────────

  private detectNestedLoops(content: string, filePath: string): CriticIssue[] {
    const issues: CriticIssue[] = [];
    const lines = content.split('\n');

    const loopPattern = /\b(for|while|do)\b/;
    let loopDepth = 0;
    let maxLoopDepth = 0;
    let maxLoopDepthLine = 0;
    let braceStack = 0;
    const loopBraceStarts: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      // Detect loop start
      if (loopPattern.test(trimmed)) {
        loopDepth++;
        if (loopDepth > maxLoopDepth) {
          maxLoopDepth = loopDepth;
          maxLoopDepthLine = i + 1;
        }
        // Track brace depth where loop started
        loopBraceStarts.push(braceStack);
      }

      for (const char of line) {
        if (char === '{') {
          braceStack++;
        } else if (char === '}') {
          braceStack = Math.max(0, braceStack - 1);
          // Check if we're closing a loop scope
          if (loopBraceStarts.length > 0 && braceStack <= loopBraceStarts[loopBraceStarts.length - 1]) {
            loopBraceStarts.pop();
            loopDepth = Math.max(0, loopDepth - 1);
          }
        }
      }
    }

    if (maxLoopDepth >= 3) {
      issues.push({
        severity: 'medium',
        category: 'performance',
        message: `Detected ${maxLoopDepth} levels of nested loops, which may indicate O(n^${maxLoopDepth}) time complexity.`,
        file: filePath,
        line: maxLoopDepthLine,
        suggestedFix: 'Consider using hash maps, memoization, or restructuring the algorithm to reduce loop nesting.',
      });
    }

    return issues;
  }

  private detectSyncIOCalls(content: string, filePath: string): CriticIssue[] {
    const issues: CriticIssue[] = [];
    const lines = content.split('\n');

    const syncIOPatterns = [
      { pattern: /\bfs\.readFileSync\b/, name: 'fs.readFileSync' },
      { pattern: /\bfs\.writeFileSync\b/, name: 'fs.writeFileSync' },
      { pattern: /\bfs\.readdirSync\b/, name: 'fs.readdirSync' },
      { pattern: /\bfs\.statSync\b/, name: 'fs.statSync' },
      { pattern: /\bfs\.existsSync\b/, name: 'fs.existsSync' },
      { pattern: /\bfs\.mkdirSync\b/, name: 'fs.mkdirSync' },
      { pattern: /\bfs\.unlinkSync\b/, name: 'fs.unlinkSync' },
      { pattern: /\bfs\.copyFileSync\b/, name: 'fs.copyFileSync' },
      { pattern: /\bchild_process\.execSync\b/, name: 'child_process.execSync' },
      { pattern: /\bexecSync\b/, name: 'execSync' },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      for (const { pattern, name } of syncIOPatterns) {
        if (pattern.test(line)) {
          issues.push({
            severity: 'low',
            category: 'performance',
            message: `Synchronous I/O call '${name}' detected. Consider using the async equivalent.`,
            file: filePath,
            line: i + 1,
            suggestedFix: `Replace '${name}' with its async equivalent (e.g., fs.promises.readFile instead of fs.readFileSync).`,
          });
        }
      }
    }

    return issues;
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — Verdict & confidence computation
  // ─────────────────────────────────────────────────────────

  private computeVerdict(issues: CriticIssue[]): 'pass' | 'warn' | 'fail' {
    const criticalCount = issues.filter((i) => i.severity === 'critical').length;
    const highCount = issues.filter((i) => i.severity === 'high').length;
    const mediumCount = issues.filter((i) => i.severity === 'medium').length;

    if (criticalCount > 0) return 'fail';
    if (highCount > 2 || (highCount > 0 && mediumCount > 3)) return 'fail';
    if (highCount > 0 || mediumCount > 2) return 'warn';
    if (mediumCount > 0) return 'warn';

    return 'pass';
  }

  private computeConfidence(
    issues: CriticIssue[],
    files: Array<{ path: string; content: string }>,
  ): number {
    // Base confidence starts at 1.0
    let confidence = 1.0;

    // Deductions by severity
    const criticalCount = issues.filter((i) => i.severity === 'critical').length;
    const highCount = issues.filter((i) => i.severity === 'high').length;
    const mediumCount = issues.filter((i) => i.severity === 'medium').length;
    const lowCount = issues.filter((i) => i.severity === 'low').length;

    confidence -= criticalCount * 0.25;
    confidence -= highCount * 0.15;
    confidence -= mediumCount * 0.05;
    confidence -= lowCount * 0.01;

    // Bonus for small, focused changes
    const totalLines = files.reduce((sum, f) => sum + f.content.split('\n').length, 0);
    if (totalLines < 50) confidence += 0.05;

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, confidence));
  }

  private generateSuggestions(issues: CriticIssue[]): string[] {
    const suggestions: string[] = [];
    const categories = new Set(issues.map((i) => i.category));
    const severities = new Set(issues.map((i) => i.severity));

    if (severities.has('critical')) {
      suggestions.push('Address all critical issues before merging. These represent security or correctness risks.');
    }

    if (categories.has('security')) {
      const securityCount = issues.filter((i) => i.category === 'security').length;
      suggestions.push(`Found ${securityCount} security issue(s). Review for hardcoded credentials and consider using environment variables.`);
    }

    if (categories.has('quality')) {
      const qualityCount = issues.filter((i) => i.category === 'quality').length;
      suggestions.push(`Found ${qualityCount} code quality issue(s). Consider refactoring complex functions and resolving TODO comments.`);
    }

    if (categories.has('performance')) {
      suggestions.push('Performance issues detected. Review nested loops and synchronous I/O operations.');
    }

    if (issues.length === 0) {
      suggestions.push('Code looks clean. No issues detected by static analysis.');
    }

    // Collect unique suggestedFix values from critical/high issues
    const fixSuggestions = issues
      .filter((i) => (i.severity === 'critical' || i.severity === 'high') && i.suggestedFix)
      .map((i) => i.suggestedFix!)
      .filter((fix, idx, arr) => arr.indexOf(fix) === idx)
      .slice(0, 3);

    suggestions.push(...fixSuggestions);

    return suggestions;
  }
}
