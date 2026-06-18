/**
 * Minimal Cron expression parser.
 *
 * Supported format: minute hour day month weekday (5 fields)
 * - `*`      any value
 * - `,`      list, e.g. 1,3,5
 * - `-`      range, e.g. 1-5
 * - `/`      step, e.g. * /15 (only valid with *)
 *
 * Common examples:
 * - `0 9 * * *`   daily at 9:00
 * - `0 * * * *`   every hour
 * - `0 9 * * 1`   every Monday at 9:00
 * - `0 9 1 * *`   1st of every month at 9:00
 */

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  day: [1, 31],
  month: [1, 12],
  weekday: [0, 6],
} as const;

type CronField = keyof typeof RANGES;

function parseField(text: string, field: CronField): number[] {
  const [min, max] = RANGES[field];
  const values = new Set<number>();

  for (const part of text.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes('/')) {
      const [base, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      if (!step || step < 1) continue;
      const start = base === '*' ? min : parseInt(base, 10);
      for (let i = start; i <= max; i += step) values.add(i);
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map((s) => parseInt(s, 10));
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        for (let i = Math.max(min, a); i <= Math.min(max, b); i++) values.add(i);
      }
    } else {
      const n = parseInt(part, 10);
      if (!Number.isNaN(n) && n >= min && n <= max) values.add(n);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

function parseCron(expression: string): Record<CronField, number[]> | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, day, month, weekday] = parts;
  return {
    minute: parseField(minute, 'minute'),
    hour: parseField(hour, 'hour'),
    day: parseField(day, 'day'),
    month: parseField(month, 'month'),
    weekday: parseField(weekday, 'weekday'),
  };
}

/**
 * Compute the next trigger time from `from`.
 * Returns null if the expression is invalid or no future time is found.
 */
export function getNextCronTime(expression: string, from = new Date()): Date | null {
  const cron = parseCron(expression);
  if (!cron) return null;

  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 4 years ahead to avoid infinite loops
  const limit = new Date(candidate);
  limit.setFullYear(limit.getFullYear() + 4);

  while (candidate <= limit) {
    const m = candidate.getMinutes();
    const h = candidate.getHours();
    const d = candidate.getDate();
    const M = candidate.getMonth() + 1;
    const w = candidate.getDay();

    if (
      cron.minute.includes(m) &&
      cron.hour.includes(h) &&
      cron.day.includes(d) &&
      cron.month.includes(M) &&
      cron.weekday.includes(w)
    ) {
      return new Date(candidate);
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

/**
 * Validate whether a Cron expression is legal.
 */
export function isValidCron(expression: string): boolean {
  return getNextCronTime(expression) !== null;
}

/**
 * Return a human-readable description of a Cron expression.
 */
export function describeCron(expression: string): string {
  const cron = parseCron(expression);
  if (!cron) return 'Invalid expression';

  const m = cron.minute;
  const h = cron.hour;
  const d = cron.day;
  const M = cron.month;
  const w = cron.weekday;

  // Daily at a fixed time
  if (m.length === 1 && h.length === 1 && d.length === 31 && M.length === 12 && w.length === 7) {
    return `Daily at ${String(h[0]).padStart(2, '0')}:${String(m[0]).padStart(2, '0')}`;
  }

  // Weekly at a fixed time
  if (m.length === 1 && h.length === 1 && d.length === 31 && M.length === 12 && w.length === 1) {
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `Weekly on ${weekdays[w[0]]} at ${String(h[0]).padStart(2, '0')}:${String(m[0]).padStart(2, '0')}`;
  }

  // Monthly at a fixed time
  if (m.length === 1 && h.length === 1 && d.length === 1 && M.length === 12 && w.length === 7) {
    return `Monthly on day ${d[0]} at ${String(h[0]).padStart(2, '0')}:${String(m[0]).padStart(2, '0')}`;
  }

  // Every hour
  if (m.length === 1 && h.length === 24 && d.length === 31 && M.length === 12 && w.length === 7) {
    return `Hourly at minute ${m[0]}`;
  }

  return `Custom: ${expression}`;
}
