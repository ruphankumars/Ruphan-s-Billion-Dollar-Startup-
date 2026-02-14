/**
 * CortexOS Surfaces — Multi-Platform Nerve System
 *
 * Surface adapters project CortexOS capabilities through external platforms.
 * Each surface implements a common lifecycle (start/stop/isRunning/getStats)
 * and emits events following the `surface:type:action` pattern.
 *
 * The SurfaceManager orchestrates all surfaces, providing bulk lifecycle
 * management, event broadcasting, and aggregate statistics.
 *
 * @example
 * ```typescript
 * import { SurfaceManager, GitHubApp, SlackBot, DiscordBot } from 'cortexos/surfaces';
 *
 * const manager = new SurfaceManager();
 *
 * manager.registerSurface(new GitHubApp({
 *   appId: process.env.GITHUB_APP_ID!,
 *   privateKey: process.env.GITHUB_PRIVATE_KEY!,
 *   webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
 * }));
 *
 * manager.registerSurface(new SlackBot({
 *   botToken: process.env.SLACK_BOT_TOKEN!,
 *   signingSecret: process.env.SLACK_SIGNING_SECRET!,
 * }));
 *
 * manager.registerSurface(new DiscordBot({
 *   botToken: process.env.DISCORD_BOT_TOKEN!,
 *   applicationId: process.env.DISCORD_APP_ID!,
 *   publicKey: process.env.DISCORD_PUBLIC_KEY!,
 * }));
 *
 * await manager.startAll();
 * console.log(manager.getStats());
 * ```
 */

// Surface Manager
export { SurfaceManager } from './surface-manager.js';
export type { SurfaceManagerStats } from './surface-manager.js';

// GitHub Surface
export { GitHubApp } from './github/github-app.js';
export { PRAnalyzer } from './github/pr-analyzer.js';
export type { PRAnalysis, PRIssue, PRSuggestion, PRMetrics, PRInput } from './github/pr-analyzer.js';

// Slack Surface
export { SlackBot } from './slack/slack-bot.js';
export { SlackBlocks } from './slack/slack-blocks.js';
export type {
  ExecutionResultData,
  AgentStatusData,
  CostSummaryData,
  QualityReportData,
  TaskProgressData,
} from './slack/slack-blocks.js';

// Discord Surface
export { DiscordBot } from './discord/discord-bot.js';
export type { DiscordCommandOption, DiscordCommandDefinition } from './discord/discord-bot.js';

// Shared Types
export type {
  SurfaceType,
  Surface,
  SurfaceStats,
  SurfaceManagerConfig,
  SurfaceConfig,
  SurfaceEventType,
  // GitHub
  GitHubAppConfig,
  GitHubWebhookPayload,
  PRPayload,
  IssuePayload,
  IssueCommentPayload,
  PushPayload,
  GitHubAppStats,
  // Slack
  SlackBotConfig,
  SlackEvent,
  SlackSlashCommand,
  SlackInteraction,
  SlackBlock,
  SlackBotStats,
  // Discord
  DiscordBotConfig,
  DiscordInteraction,
  DiscordBotStats,
} from './types.js';
