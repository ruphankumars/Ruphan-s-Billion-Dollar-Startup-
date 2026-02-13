import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CronScheduler } from '../../../src/automation/cron-scheduler.js';

describe('CronScheduler', () => {
  let scheduler: CronScheduler;

  beforeEach(() => {
    scheduler = new CronScheduler();
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('addSchedule creates a schedule', () => {
    // Actual API: addSchedule(skillId: string, cron: string, options?)
    const schedule = scheduler.addSchedule('test-skill', '* * * * *');

    expect(schedule).toBeDefined();
    expect(schedule.id).toBeDefined();
    expect(schedule.cron).toBe('* * * * *');
    expect(schedule.skillId).toBe('test-skill');
    expect(schedule.enabled).toBe(true);
  });

  it('addSchedule with invalid cron throws', () => {
    expect(() =>
      scheduler.addSchedule('test-skill', 'not valid cron')
    ).toThrow();
  });

  it('removeSchedule removes a schedule', () => {
    const schedule = scheduler.addSchedule('test-skill', '0 9 * * *');

    scheduler.removeSchedule(schedule.id);
    const schedules = scheduler.getSchedules();
    expect(schedules.find((s: any) => s.id === schedule.id)).toBeUndefined();
  });

  it('getSchedules returns all schedules', () => {
    scheduler.addSchedule('skill-a', '0 9 * * *');
    scheduler.addSchedule('skill-b', '0 17 * * *');

    const schedules = scheduler.getSchedules();
    expect(schedules).toHaveLength(2);
  });

  it('setEnabled enables/disables a schedule', () => {
    const schedule = scheduler.addSchedule('test-skill', '* * * * *');

    scheduler.setEnabled(schedule.id, false);
    let found = scheduler.getSchedule(schedule.id);
    expect(found!.enabled).toBe(false);

    scheduler.setEnabled(schedule.id, true);
    found = scheduler.getSchedule(schedule.id);
    expect(found!.enabled).toBe(true);
  });

  it('tick fires matching schedules', () => {
    const callback = vi.fn();
    scheduler.onFire(callback);

    scheduler.addSchedule('test-skill', '* * * * *');

    // tick() takes no arguments - it uses new Date() internally
    scheduler.tick();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: 'test-skill',
      })
    );
  });

  it('tick does not fire disabled schedules', () => {
    const callback = vi.fn();
    scheduler.onFire(callback);

    const schedule = scheduler.addSchedule('test-skill', '* * * * *');

    scheduler.setEnabled(schedule.id, false);
    scheduler.tick();
    expect(callback).not.toHaveBeenCalled();
  });

  it('start and stop lifecycle', () => {
    expect(() => scheduler.start()).not.toThrow();
    expect(scheduler.isRunning()).toBe(true);
    expect(() => scheduler.stop()).not.toThrow();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('onFire registers callback', () => {
    const callback = vi.fn();
    scheduler.onFire(callback);

    scheduler.addSchedule('test-skill', '* * * * *');

    scheduler.tick();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
