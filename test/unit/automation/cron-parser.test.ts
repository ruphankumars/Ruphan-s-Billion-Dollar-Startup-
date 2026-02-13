import { describe, it, expect } from 'vitest';
import {
  parseCron,
  matchesCron,
  getNextMatch,
  validateCron,
  describeCron,
} from '../../../src/automation/cron-parser.js';

describe('parseCron', () => {
  it('parses all-fields wildcard (* * * * *)', () => {
    const result = parseCron('* * * * *');
    expect(result).toBeDefined();
    // parseCron returns CronFields with Set<number> values, not raw strings
    expect(result.minute).toBeInstanceOf(Set);
    expect(result.minute.size).toBe(60); // 0-59
    expect(result.hour).toBeInstanceOf(Set);
    expect(result.hour.size).toBe(24); // 0-23
    expect(result.dayOfMonth).toBeInstanceOf(Set);
    expect(result.dayOfMonth.size).toBe(31); // 1-31
    expect(result.month).toBeInstanceOf(Set);
    expect(result.month.size).toBe(12); // 1-12
    expect(result.dayOfWeek).toBeInstanceOf(Set);
    expect(result.dayOfWeek.size).toBe(7); // 0-6
  });

  it('parses weekday 9am (0 9 * * 1-5)', () => {
    const result = parseCron('0 9 * * 1-5');
    expect(result.minute).toEqual(new Set([0]));
    expect(result.hour).toEqual(new Set([9]));
    expect(result.dayOfMonth.size).toBe(31);
    expect(result.month.size).toBe(12);
    expect(result.dayOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('parses every 15 minutes (*/15 * * * *)', () => {
    const result = parseCron('*/15 * * * *');
    expect(result.minute).toEqual(new Set([0, 15, 30, 45]));
    expect(result.hour.size).toBe(24);
  });

  it('parses midnight Jan 1st (0 0 1 1 *)', () => {
    const result = parseCron('0 0 1 1 *');
    expect(result.minute).toEqual(new Set([0]));
    expect(result.hour).toEqual(new Set([0]));
    expect(result.dayOfMonth).toEqual(new Set([1]));
    expect(result.month).toEqual(new Set([1]));
    expect(result.dayOfWeek.size).toBe(7);
  });

  it('parses list values (5,10,15 * * * *)', () => {
    const result = parseCron('5,10,15 * * * *');
    expect(result.minute).toEqual(new Set([5, 10, 15]));
  });

  it('throws for invalid expression with too few fields', () => {
    expect(() => parseCron('* * *')).toThrow();
  });

  it('throws for invalid range', () => {
    expect(() => parseCron('60 * * * *')).toThrow();
  });

  it('handles day names (MON, WED, FRI)', () => {
    const result = parseCron('0 9 * * MON,WED,FRI');
    expect(result).toBeDefined();
    expect(result.dayOfWeek).toBeDefined();
    expect(result.dayOfWeek.has(1)).toBe(true); // MON
    expect(result.dayOfWeek.has(3)).toBe(true); // WED
    expect(result.dayOfWeek.has(5)).toBe(true); // FRI
  });
});

describe('matchesCron', () => {
  it('matches wildcard for any date', () => {
    const parsed = parseCron('* * * * *');
    const now = new Date();
    expect(matchesCron(parsed, now)).toBe(true);
  });

  it('matches specific minute and hour', () => {
    const parsed = parseCron('30 14 * * *');
    const date = new Date(2026, 1, 13, 14, 30, 0); // Feb 13, 2026 at 14:30
    expect(matchesCron(parsed, date)).toBe(true);
  });

  it('matches day of week (Monday = 1)', () => {
    const parsed = parseCron('0 9 * * 1');
    // Find a Monday
    const monday = new Date(2026, 1, 16, 9, 0, 0); // Feb 16, 2026 is Monday
    expect(matchesCron(parsed, monday)).toBe(true);
  });

  it('does not match wrong minute', () => {
    const parsed = parseCron('30 14 * * *');
    const date = new Date(2026, 1, 13, 14, 15, 0); // 14:15 not 14:30
    expect(matchesCron(parsed, date)).toBe(false);
  });
});

describe('getNextMatch', () => {
  it('finds next occurrence', () => {
    const parsed = parseCron('0 9 * * *');
    const from = new Date(2026, 1, 13, 10, 0, 0); // After 9am today
    // getNextMatch returns a Date (throws if none found within 366 days)
    const next = getNextMatch(parsed, from);
    expect(next).toBeDefined();
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it('skips weekends for 0 9 * * 1-5', () => {
    const parsed = parseCron('0 9 * * 1-5');
    // Saturday Feb 14, 2026
    const saturday = new Date(2026, 1, 14, 10, 0, 0);
    const next = getNextMatch(parsed, saturday);
    expect(next).toBeDefined();
    const day = next.getDay();
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(5);
  });

  it('throws if no match in range (e.g. Feb 31)', () => {
    // Feb 31 never exists, but getNextMatch searches up to 366 days,
    // so it will throw since day 31 + month 2 can never align.
    const parsed = parseCron('0 0 31 2 *');
    const from = new Date(2026, 1, 1, 0, 0, 0);
    expect(() => getNextMatch(parsed, from)).toThrow();
  });
});

describe('validateCron', () => {
  it('returns valid for * * * * *', () => {
    const result = validateCron('* * * * *');
    expect(result.valid).toBe(true);
  });

  it('returns invalid for bad expression', () => {
    const result = validateCron('not a cron');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns invalid for empty string', () => {
    const result = validateCron('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('describeCron', () => {
  it('returns human-readable description', () => {
    const desc = describeCron('* * * * *');
    expect(typeof desc).toBe('string');
    expect(desc.length).toBeGreaterThan(0);
  });

  it('handles weekday schedule (0 9 * * 1-5)', () => {
    const desc = describeCron('0 9 * * 1-5');
    const lower = desc.toLowerCase();
    const containsWeekday =
      lower.includes('weekday') ||
      lower.includes('monday') ||
      lower.includes('friday') ||
      lower.includes('mon') ||
      lower.includes('fri');
    expect(containsWeekday).toBe(true);
  });
});
