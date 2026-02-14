/**
 * GitHub Surface — CortexOS GitHub App Integration
 *
 * Provides full GitHub App integration: webhook handling, PR analysis,
 * issue triage, and comment posting via the GitHub REST API.
 *
 * @example
 * ```typescript
 * import { GitHubApp, PRAnalyzer } from 'cortexos/surfaces/github';
 *
 * const app = new GitHubApp({
 *   appId: process.env.GITHUB_APP_ID!,
 *   privateKey: process.env.GITHUB_PRIVATE_KEY!,
 *   webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
 *   port: 3300,
 * });
 *
 * app.on('surface:github:pr:analyzed', (data) => {
 *   console.log(`PR #${data.number} scored ${data.score}/100`);
 * });
 *
 * await app.start();
 * ```
 */

export { GitHubApp } from './github-app.js';
export { PRAnalyzer } from './pr-analyzer.js';
export type { PRAnalysis, PRIssue, PRSuggestion, PRMetrics, PRInput } from './pr-analyzer.js';
export type {
  GitHubAppConfig,
  GitHubWebhookPayload,
  PRPayload,
  IssuePayload,
  IssueCommentPayload,
  PushPayload,
  GitHubAppStats,
} from './types.js';
