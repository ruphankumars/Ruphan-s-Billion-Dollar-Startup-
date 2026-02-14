/**
 * Discord Surface — CortexOS Discord Bot Integration
 *
 * Provides full Discord bot integration: slash commands via the
 * Interactions endpoint, Ed25519 verification, and REST API communication.
 *
 * @example
 * ```typescript
 * import { DiscordBot } from 'cortexos/surfaces/discord';
 *
 * const bot = new DiscordBot({
 *   botToken: process.env.DISCORD_BOT_TOKEN!,
 *   applicationId: process.env.DISCORD_APP_ID!,
 *   publicKey: process.env.DISCORD_PUBLIC_KEY!,
 *   port: 3302,
 * });
 *
 * // Register a slash command
 * await bot.registerCommand('cortex', 'Interact with CortexOS', [
 *   { name: 'prompt', description: 'What to ask CortexOS', type: 3, required: true },
 * ]);
 *
 * bot.on('surface:discord:command', (data) => {
 *   console.log(`Command /${data.command} from ${data.user}`);
 * });
 *
 * await bot.start();
 * ```
 */

export { DiscordBot } from './discord-bot.js';
export type { DiscordCommandOption, DiscordCommandDefinition } from './discord-bot.js';
export type {
  DiscordBotConfig,
  DiscordInteraction,
  DiscordBotStats,
} from './types.js';
