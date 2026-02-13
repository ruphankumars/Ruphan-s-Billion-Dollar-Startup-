/**
 * Automation Engine — Top-Level Orchestrator
 *
 * Ties together SkillRegistry, CronScheduler, WebhookServer,
 * and EventTriggerManager into a unified automation system.
 */

import { randomUUID } from 'node:crypto';
import { SkillRegistry } from './skill-registry.js';
import { CronScheduler } from './cron-scheduler.js';
import { WebhookServer } from './webhook-server.js';
import { EventTriggerManager, type EventBusLike } from './event-trigger.js';
import type { AutomationRunRecord, AutomationConfig, TriggerSource, Schedule, WebhookConfig } from './types.js';
import type { WorkflowEngine, WorkflowRunResult } from '../core/workflow-dsl.js';

// ═══════════════════════════════════════════════════════════════
// AUTOMATION ENGINE
// ═══════════════════════════════════════════════════════════════

export class AutomationEngine {
  readonly skills: SkillRegistry;
  readonly scheduler: CronScheduler;
  readonly webhooks: WebhookServer;
  readonly eventTriggers: EventTriggerManager;

  private workflowEngine: WorkflowEngine | null = null;
  private runHistory: AutomationRunRecord[] = [];
  private activeRuns: number = 0;
  private maxConcurrentRuns: number;
  private listeners: Map<string, Array<(record: AutomationRunRecord) => void>> = new Map();

  constructor(config: Partial<AutomationConfig> = {}) {
    this.maxConcurrentRuns = config.maxConcurrentRuns ?? 2;

    // Initialize subsystems
    this.skills = new SkillRegistry();
    this.scheduler = new CronScheduler({
      persistPath: config.schedulePersistPath,
    });
    this.webhooks = new WebhookServer({
      port: config.webhookPort ?? 3101,
      secret: config.webhookSecret,
    });
    this.eventTriggers = new EventTriggerManager();

    // Load skills from directory if specified
    if (config.skillsDir) {
      this.skills.loadFromDir(config.skillsDir);
    }

    // Wire up handlers
    this.scheduler.onFire((schedule) => {
      this.executeSkill(schedule.skillId, schedule.inputs ?? {}, 'cron', `schedule:${schedule.id}`);
    });

    this.webhooks.onWebhook((webhookConfig, payload) => {
      const inputs = typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)._mapped as Record<string, unknown> ?? payload as Record<string, unknown>
        : {};
      this.executeSkill(webhookConfig.skillId, inputs, 'webhook', `webhook:${webhookConfig.id}`);
    });

    this.eventTriggers.onTrigger((triggerConfig, eventData) => {
      const inputs = { ...triggerConfig.inputs, _event: eventData };
      this.executeSkill(triggerConfig.skillId, inputs, 'event', `event:${triggerConfig.id}`);
    });
  }

  /** Set the workflow engine for executing skills */
  setWorkflowEngine(engine: WorkflowEngine): void {
    this.workflowEngine = engine;
  }

  /** Set the event bus for event triggers */
  setEventBus(bus: EventBusLike): void {
    this.eventTriggers.setEventBus(bus);
  }

  /** Execute a skill by ID */
  async executeSkill(
    skillId: string,
    inputs: Record<string, unknown> = {},
    triggeredBy: TriggerSource = 'api',
    triggerDetails: string = ''
  ): Promise<AutomationRunRecord> {
    const skill = this.skills.get(skillId) ?? this.skills.getByName(skillId);
    if (!skill) {
      const record = this.createRunRecord(skillId, 'unknown', triggeredBy, triggerDetails);
      record.status = 'failed';
      record.error = `Skill "${skillId}" not found`;
      record.completedAt = Date.now();
      this.runHistory.push(record);
      return record;
    }

    // Check concurrent limit
    if (this.activeRuns >= this.maxConcurrentRuns) {
      const record = this.createRunRecord(skill.id, skill.name, triggeredBy, triggerDetails);
      record.status = 'failed';
      record.error = 'Max concurrent runs exceeded';
      record.completedAt = Date.now();
      this.runHistory.push(record);
      return record;
    }

    const record = this.createRunRecord(skill.id, skill.name, triggeredBy, triggerDetails);
    this.runHistory.push(record);
    this.activeRuns++;

    this.emit('run:started', record);

    try {
      const mergedInputs = { ...skill.defaultInputs, ...inputs };

      if (this.workflowEngine) {
        const result = await this.workflowEngine.execute(skill.workflow, mergedInputs);
        record.status = result.status === 'completed' ? 'completed' : 'failed';
        record.result = result;
      } else {
        // No workflow engine — mark as completed (dry run)
        record.status = 'completed';
      }
    } catch (err) {
      record.status = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
    } finally {
      record.completedAt = Date.now();
      this.activeRuns--;
      this.emit('run:completed', record);
    }

    return record;
  }

  /** Get run history with optional filters */
  getRunHistory(filter?: {
    skillId?: string;
    status?: string;
    triggeredBy?: TriggerSource;
    limit?: number;
  }): AutomationRunRecord[] {
    let records = [...this.runHistory];

    if (filter?.skillId) {
      records = records.filter(r => r.skillId === filter.skillId);
    }
    if (filter?.status) {
      records = records.filter(r => r.status === filter.status);
    }
    if (filter?.triggeredBy) {
      records = records.filter(r => r.triggeredBy === filter.triggeredBy);
    }

    records.sort((a, b) => b.startedAt - a.startedAt);

    if (filter?.limit) {
      records = records.slice(0, filter.limit);
    }

    return records;
  }

  /** Get active run count */
  getActiveRuns(): number {
    return this.activeRuns;
  }

  /** Start all automation subsystems */
  async start(): Promise<void> {
    this.scheduler.start();

    try {
      await this.webhooks.start();
    } catch {
      // Webhook server start is non-fatal (port may be in use)
    }
  }

  /** Stop all automation subsystems */
  async stop(): Promise<void> {
    this.scheduler.stop();
    await this.webhooks.stop();
    this.eventTriggers.shutdown();
  }

  /** Listen to automation events */
  on(event: string, listener: (record: AutomationRunRecord) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(listener);
  }

  // ─── Internal ─────────────────────────────────────────────

  private createRunRecord(
    skillId: string,
    skillName: string,
    triggeredBy: TriggerSource,
    triggerDetails: string
  ): AutomationRunRecord {
    return {
      id: `run_${randomUUID().slice(0, 8)}`,
      skillId,
      skillName,
      triggeredBy,
      triggerDetails,
      status: 'running',
      startedAt: Date.now(),
    };
  }

  private emit(event: string, record: AutomationRunRecord): void {
    const listeners = this.listeners.get(event) || [];
    for (const listener of listeners) {
      try { listener(record); } catch { /* ignore */ }
    }
  }
}
