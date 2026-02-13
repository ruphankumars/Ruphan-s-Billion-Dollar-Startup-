/**
 * Scheduling & Automation System — Types
 *
 * Defines skills, schedules, webhooks, event triggers,
 * and automation run records.
 */

import type { WorkflowDefinition, WorkflowRunResult } from '../core/workflow-dsl.js';

// ═══════════════════════════════════════════════════════════════
// SKILLS
// ═══════════════════════════════════════════════════════════════

export interface Skill {
  id: string;
  name: string;
  description: string;
  workflow: WorkflowDefinition;
  defaultInputs?: Record<string, unknown>;
  tags?: string[];
  version?: string;
  createdAt: number;
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// SCHEDULES
// ═══════════════════════════════════════════════════════════════

export interface Schedule {
  id: string;
  skillId: string;
  cron: string;              // Standard 5-field cron expression
  enabled: boolean;
  inputs?: Record<string, unknown>;
  timezone?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// WEBHOOKS
// ═══════════════════════════════════════════════════════════════

export interface WebhookConfig {
  id: string;
  skillId: string;
  path: string;              // e.g., "/hooks/deploy-review"
  secret?: string;           // HMAC secret for verification
  inputMapping?: Record<string, string>;  // Map webhook payload to skill inputs
  enabled: boolean;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// EVENT TRIGGERS
// ═══════════════════════════════════════════════════════════════

export interface EventTriggerConfig {
  id: string;
  skillId: string;
  eventType: string;         // CortexOS event type
  condition?: string;        // Expression to evaluate on event data
  inputs?: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// RUN RECORDS
// ═══════════════════════════════════════════════════════════════

export type TriggerSource = 'cron' | 'webhook' | 'event' | 'api' | 'cli';

export interface AutomationRunRecord {
  id: string;
  skillId: string;
  skillName: string;
  triggeredBy: TriggerSource;
  triggerDetails: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  result?: WorkflowRunResult;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// AUTOMATION ENGINE CONFIG
// ═══════════════════════════════════════════════════════════════

export interface AutomationConfig {
  enabled: boolean;
  skillsDir?: string;
  schedulePersistPath?: string;
  webhookPort: number;
  webhookSecret?: string;
  maxConcurrentRuns: number;
}
