/**
 * Cron Scheduler — Schedule-Based Skill Execution
 *
 * Checks all schedules on a 60-second tick interval and fires
 * matching skills. Persists schedules to disk for durability.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseCron, matchesCron, getNextMatch } from './cron-parser.js';
import type { Schedule } from './types.js';

export type ScheduleHandler = (schedule: Schedule) => void | Promise<void>;

export class CronScheduler {
  private schedules: Map<string, Schedule> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private handler: ScheduleHandler | null = null;
  private persistPath: string | null = null;
  private tickIntervalMs: number;

  constructor(options: { persistPath?: string; tickIntervalMs?: number } = {}) {
    this.persistPath = options.persistPath ?? null;
    this.tickIntervalMs = options.tickIntervalMs ?? 60000; // 60s default

    if (this.persistPath) {
      this.loadFromDisk();
    }
  }

  /** Set the handler called when a schedule fires */
  onFire(handler: ScheduleHandler): void {
    this.handler = handler;
  }

  /** Add a new schedule */
  addSchedule(skillId: string, cron: string, options?: {
    inputs?: Record<string, unknown>;
    enabled?: boolean;
    timezone?: string;
  }): Schedule {
    // Validate cron expression
    const fields = parseCron(cron);

    const schedule: Schedule = {
      id: `sched_${randomUUID().slice(0, 8)}`,
      skillId,
      cron,
      enabled: options?.enabled ?? true,
      inputs: options?.inputs,
      timezone: options?.timezone,
      runCount: 0,
      nextRunAt: getNextMatch(fields, new Date()).getTime(),
      createdAt: Date.now(),
    };

    this.schedules.set(schedule.id, schedule);
    this.persist();
    return schedule;
  }

  /** Remove a schedule */
  removeSchedule(id: string): boolean {
    const removed = this.schedules.delete(id);
    if (removed) this.persist();
    return removed;
  }

  /** Enable/disable a schedule */
  setEnabled(id: string, enabled: boolean): void {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new Error(`Schedule "${id}" not found`);
    schedule.enabled = enabled;
    if (enabled) {
      schedule.nextRunAt = getNextMatch(parseCron(schedule.cron), new Date()).getTime();
    }
    this.persist();
  }

  /** Get all schedules */
  getSchedules(): Schedule[] {
    return Array.from(this.schedules.values());
  }

  /** Get a specific schedule */
  getSchedule(id: string): Schedule | undefined {
    return this.schedules.get(id);
  }

  /** Start the scheduler tick loop */
  start(): void {
    if (this.timer) return; // Already running

    this.timer = setInterval(() => {
      this.tick();
    }, this.tickIntervalMs);

    // Prevent the timer from blocking Node.js exit
    if (this.timer.unref) this.timer.unref();
  }

  /** Stop the scheduler */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Check if the scheduler is running */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Manually trigger a tick (for testing) */
  tick(): void {
    const now = new Date();

    for (const schedule of this.schedules.values()) {
      if (!schedule.enabled) continue;

      try {
        const fields = parseCron(schedule.cron);
        if (matchesCron(fields, now)) {
          // Fire the schedule
          schedule.lastRunAt = now.getTime();
          schedule.runCount++;
          schedule.nextRunAt = getNextMatch(fields, now).getTime();

          if (this.handler) {
            try {
              const result = this.handler(schedule);
              if (result instanceof Promise) {
                result.catch(() => {}); // Fire and forget
              }
            } catch {
              // Handler errors don't stop the scheduler
            }
          }
        }
      } catch {
        // Invalid cron expression — skip
      }
    }

    this.persist();
  }

  // ─── Persistence ──────────────────────────────────────────

  private persist(): void {
    if (!this.persistPath) return;

    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const data = Array.from(this.schedules.values());
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Persistence errors are non-fatal
    }
  }

  private loadFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;

    try {
      const raw = readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(raw) as Schedule[];
      for (const schedule of data) {
        if (schedule.id && schedule.skillId && schedule.cron) {
          this.schedules.set(schedule.id, schedule);
        }
      }
    } catch {
      // Invalid file — start fresh
    }
  }
}
