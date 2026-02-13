/**
 * Cron Expression Parser — Pure TypeScript
 *
 * Parses standard 5-field cron expressions (minute hour day month weekday).
 * Zero dependencies.
 *
 * Supports:
 * - Numbers: 5, 10, 30
 * - Ranges: 1-5, 10-20
 * - Steps: *​/5, 1-10/2
 * - Lists: 1,3,5,7
 * - Wildcards: *
 * - Day names: MON-FRI, SUN
 * - Month names: JAN-DEC
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface CronFields {
  minute: Set<number>;    // 0-59
  hour: Set<number>;      // 0-23
  dayOfMonth: Set<number>; // 1-31
  month: Set<number>;     // 1-12
  dayOfWeek: Set<number>; // 0-6 (0 = Sunday)
}

export interface CronValidation {
  valid: boolean;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DAY_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const FIELD_RANGES: Array<{ name: string; min: number; max: number }> = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 6 },
];

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Parse a cron expression into field sets
 */
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minute: parseField(parts[0], FIELD_RANGES[0]),
    hour: parseField(parts[1], FIELD_RANGES[1]),
    dayOfMonth: parseField(parts[2], FIELD_RANGES[2]),
    month: parseField(parts[3], FIELD_RANGES[3], MONTH_NAMES),
    dayOfWeek: parseField(parts[4], FIELD_RANGES[4], DAY_NAMES),
  };
}

/**
 * Check if a cron expression matches a given date
 */
export function matchesCron(fields: CronFields, date: Date): boolean {
  return (
    fields.minute.has(date.getMinutes()) &&
    fields.hour.has(date.getHours()) &&
    fields.dayOfMonth.has(date.getDate()) &&
    fields.month.has(date.getMonth() + 1) &&
    fields.dayOfWeek.has(date.getDay())
  );
}

/**
 * Get the next date that matches a cron expression after the given date
 */
export function getNextMatch(fields: CronFields, after: Date): Date {
  const next = new Date(after.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  // Search forward up to 366 days
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    if (matchesCron(fields, next)) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  throw new Error('No matching date found within 366 days');
}

/**
 * Validate a cron expression
 */
export function validateCron(expression: string): CronValidation {
  try {
    parseCron(expression);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get a human-readable description of a cron expression
 */
export function describeCron(expression: string): string {
  try {
    const fields = parseCron(expression);
    const parts: string[] = [];

    if (fields.minute.size === 60) {
      parts.push('every minute');
    } else if (fields.minute.size === 1) {
      const min = [...fields.minute][0];
      parts.push(`at minute ${min}`);
    }

    if (fields.hour.size === 24) {
      parts.push('every hour');
    } else if (fields.hour.size === 1) {
      const hour = [...fields.hour][0];
      parts.push(`at ${hour}:00`);
    }

    if (fields.dayOfWeek.size < 7) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = [...fields.dayOfWeek].map(d => dayNames[d]).join(', ');
      parts.push(`on ${days}`);
    }

    return parts.join(' ') || expression;
  } catch {
    return expression;
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL PARSING
// ═══════════════════════════════════════════════════════════════

function parseField(
  field: string,
  range: { name: string; min: number; max: number },
  names?: Record<string, number>
): Set<number> {
  const values = new Set<number>();

  // Handle comma-separated lists
  const segments = field.split(',');

  for (const segment of segments) {
    // Replace named values
    let s = segment.toUpperCase();
    if (names) {
      for (const [name, val] of Object.entries(names)) {
        s = s.replace(name, String(val));
      }
    }

    // Handle step: */5 or 1-10/2
    const stepMatch = s.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const [, base, stepStr] = stepMatch;
      const step = parseInt(stepStr, 10);
      const baseValues = expandRange(base, range);
      const sorted = [...baseValues].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i += step) {
        values.add(sorted[i]);
      }
      continue;
    }

    // Handle range: 1-5
    const rangeMatch = s.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = Math.max(start, range.min); i <= Math.min(end, range.max); i++) {
        values.add(i);
      }
      continue;
    }

    // Handle wildcard: *
    if (s === '*') {
      for (let i = range.min; i <= range.max; i++) {
        values.add(i);
      }
      continue;
    }

    // Handle single number
    const num = parseInt(s, 10);
    if (!isNaN(num) && num >= range.min && num <= range.max) {
      values.add(num);
      continue;
    }

    throw new Error(`Invalid cron field "${field}" for ${range.name}: unexpected "${segment}"`);
  }

  if (values.size === 0) {
    throw new Error(`Invalid cron field "${field}" for ${range.name}: no valid values`);
  }

  return values;
}

function expandRange(expr: string, range: { min: number; max: number }): Set<number> {
  const values = new Set<number>();

  if (expr === '*') {
    for (let i = range.min; i <= range.max; i++) {
      values.add(i);
    }
    return values;
  }

  const rangeMatch = expr.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    for (let i = Math.max(start, range.min); i <= Math.min(end, range.max); i++) {
      values.add(i);
    }
    return values;
  }

  const num = parseInt(expr, 10);
  if (!isNaN(num)) {
    values.add(num);
    return values;
  }

  // Fallback to full range
  for (let i = range.min; i <= range.max; i++) {
    values.add(i);
  }
  return values;
}
