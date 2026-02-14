/**
 * Slack Surface — CortexOS Slack Bot Integration
 *
 * Provides full Slack bot integration: event handling, slash commands,
 * interactive payloads, and rich message formatting via Block Kit.
 *
 * @example
 * ```typescript
 * import { SlackBot, SlackBlocks } from 'cortexos/surfaces/slack';
 *
 * const bot = new SlackBot({
 *   botToken: process.env.SLACK_BOT_TOKEN!,
 *   signingSecret: process.env.SLACK_SIGNING_SECRET!,
 *   port: 3301,
 * });
 *
 * bot.on('surface:slack:message', async (data) => {
 *   const blocks = SlackBlocks.taskProgress({
 *     id: 'task_1',
 *     title: 'Processing request',
 *     status: 'running',
 *     progress: 50,
 *   });
 *   await bot.sendMessage(data.channel, 'Working on it...', blocks);
 * });
 *
 * await bot.start();
 * ```
 */

export { SlackBot } from './slack-bot.js';
export { SlackBlocks } from './slack-blocks.js';
export type {
  ExecutionResultData,
  AgentStatusData,
  CostSummaryData,
  QualityReportData,
  TaskProgressData,
} from './slack-blocks.js';
export type {
  SlackBotConfig,
  SlackEvent,
  SlackSlashCommand,
  SlackInteraction,
  SlackBlock,
  SlackBotStats,
} from './types.js';
