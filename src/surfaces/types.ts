/**
 * Surface Types — Nerve System Adapter Framework
 */

import type { EventEmitter } from 'node:events';

/** All surface types CortexOS can project through */
export type SurfaceType =
  | 'github'
  | 'slack'
  | 'discord'
  | 'mcp-server'
  | 'rest-api'
  | 'dashboard'
  | 'vscode';

/** Lifecycle interface all surfaces must implement */
export interface Surface extends EventEmitter {
  readonly id: string;
  readonly type: SurfaceType;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getStats(): SurfaceStats;
}

export interface SurfaceStats {
  type: SurfaceType;
  isRunning: boolean;
  eventsReceived: number;
  eventsProcessed: number;
  errors: number;
  uptime: number;
}

export interface SurfaceManagerConfig {
  surfaces: SurfaceConfig[];
  autoStart?: boolean;
}

export interface SurfaceConfig {
  type: SurfaceType;
  enabled: boolean;
  config: Record<string, unknown>;
}

// ── GitHub Types ──

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  port?: number;
  hostname?: string;
}

export interface GitHubWebhookPayload {
  action: string;
  sender: { login: string; id: number };
  repository?: { full_name: string; owner: { login: string }; name: string };
  installation?: { id: number };
  [key: string]: unknown;
}

export interface PRPayload extends GitHubWebhookPayload {
  action: 'opened' | 'synchronize' | 'closed' | 'reopened' | 'edited';
  number: number;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
    diff_url: string;
    user: { login: string };
    state: string;
    draft: boolean;
  };
}

export interface IssuePayload extends GitHubWebhookPayload {
  action: 'opened' | 'edited' | 'closed' | 'reopened' | 'labeled' | 'unlabeled';
  issue: {
    number: number;
    title: string;
    body: string | null;
    labels: Array<{ name: string }>;
    user: { login: string };
    state: string;
  };
}

export interface IssueCommentPayload extends GitHubWebhookPayload {
  action: 'created' | 'edited' | 'deleted';
  issue: { number: number; pull_request?: unknown };
  comment: {
    id: number;
    body: string;
    user: { login: string };
  };
}

export interface PushPayload extends GitHubWebhookPayload {
  ref: string;
  before: string;
  after: string;
  commits: Array<{
    id: string;
    message: string;
    author: { name: string; email: string };
    added: string[];
    removed: string[];
    modified: string[];
  }>;
}

export interface GitHubAppStats extends SurfaceStats {
  webhooksReceived: number;
  prsAnalyzed: number;
  issuesTriaged: number;
  commentsPosted: number;
}

// ── Slack Types ──

export interface SlackBotConfig {
  botToken: string;
  signingSecret: string;
  appToken?: string;
  port?: number;
  hostname?: string;
}

export interface SlackEvent {
  type: string;
  user?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  [key: string]: unknown;
}

export interface SlackSlashCommand {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name: string;
  team_id: string;
  response_url: string;
  trigger_id: string;
}

export interface SlackInteraction {
  type: 'block_actions' | 'view_submission' | 'shortcut';
  trigger_id: string;
  user: { id: string; name: string };
  actions?: Array<{ action_id: string; value?: string; type: string }>;
  view?: Record<string, unknown>;
  response_url?: string;
}

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: unknown[];
  accessory?: unknown;
  block_id?: string;
  fields?: Array<{ type: string; text: string }>;
  [key: string]: unknown;
}

export interface SlackBotStats extends SurfaceStats {
  messagesReceived: number;
  commandsProcessed: number;
  interactionsHandled: number;
  messagesSent: number;
}

// ── Discord Types ──

export interface DiscordBotConfig {
  botToken: string;
  applicationId: string;
  publicKey: string;
  port?: number;
  hostname?: string;
}

export interface DiscordInteraction {
  id: string;
  type: number;
  data?: {
    id: string;
    name: string;
    options?: Array<{ name: string; type: number; value: unknown }>;
  };
  guild_id?: string;
  channel_id?: string;
  member?: { user: { id: string; username: string } };
  user?: { id: string; username: string };
  token: string;
}

export interface DiscordBotStats extends SurfaceStats {
  interactionsReceived: number;
  commandsProcessed: number;
  messagesSent: number;
}

// ── Surface Events ──

export type SurfaceEventType =
  | 'surface:started'
  | 'surface:stopped'
  | 'surface:error'
  | 'surface:github:webhook'
  | 'surface:github:pr:analyzed'
  | 'surface:github:issue:triaged'
  | 'surface:github:comment:posted'
  | 'surface:slack:message'
  | 'surface:slack:command'
  | 'surface:slack:interaction'
  | 'surface:discord:interaction'
  | 'surface:discord:command'
  | 'surface:discord:message';
