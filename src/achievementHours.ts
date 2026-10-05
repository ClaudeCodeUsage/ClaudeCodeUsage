import type { ClaudeUsageRecord } from './types';

const HOUR_MS = 3_600_000;

export interface HourEvidence {
  schemaVersion: 3;
  /** Bounded proof retained after a rolling hourly window expires. */
  maxStreak: number;
}

export function parseHourEvidence(raw: unknown): HourEvidence {
  if (!raw || typeof raw !== 'object' || (raw as { schemaVersion?: unknown }).schemaVersion !== 3) {
    return { schemaVersion: 3, maxStreak: 0 };
  }
  const value = (raw as { maxStreak?: unknown }).maxStreak;
  return {
    schemaVersion: 3,
    maxStreak: typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 48
      ? value : 0,
  };
}

export function updateHourEvidence(current: HourEvidence, observed: number): HourEvidence {
  if (!Number.isSafeInteger(observed) || observed <= current.maxStreak) return current;
  return { schemaVersion: 3, maxStreak: Math.min(48, observed) };
}

export function collectClaudeOutputHours(
  records: readonly Pick<ClaudeUsageRecord, 'timestamp' | 'message'>[],
  nowMs = Date.now(),
): number[] {
  const hours = new Set<number>();
  for (const record of records) {
    const output = record.message?.usage?.output_tokens;
    const timestamp = Date.parse(record.timestamp);
    if (Number.isSafeInteger(output) && output > 0 && Number.isFinite(timestamp) &&
        timestamp > 0 && timestamp <= nowMs) {
      hours.add(Math.floor(timestamp / HOUR_MS));
    }
  }
  return [...hours].sort((a, b) => a - b);
}

interface CodexOutputHour {
  hour: string;
  output: number;
}

function partsForHour(formatter: Intl.DateTimeFormat, timestamp: number): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(timestamp)
    .filter(({ type }) => type === 'year' || type === 'month' || type === 'day' ||
      type === 'hour' || type === 'minute')
    .map(({ type, value }) => [type, value]));
}

/**
 * The existing Codex sidecar uses local civil hours, not UTC instants. Only
 * uniquely mappable whole-hour offsets are accepted; DST repeats and 30/45m
 * offsets must not manufacture a continuous absolute-hour streak.
 */
export function collectCodexOutputHours(
  rowsByDay: Record<string, readonly CodexOutputHour[]>,
  timeZone: string,
  coverageComplete: boolean,
  nowMs = Date.now(),
): number[] {
  if (!coverageComplete) return [];
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    return [];
  }
  const hours = new Set<number>();
  for (const [day, rows] of Object.entries(rowsByDay)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const utcDay = Date.parse(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(utcDay) || new Date(utcDay).toISOString().slice(0, 10) !== day) continue;
    const byLocalHour = new Map<string, number[]>();
    for (let offset = -18; offset <= 42; offset++) {
      const timestamp = utcDay + offset * HOUR_MS;
      const parts = partsForHour(formatter, timestamp);
      if (`${parts.year}-${parts.month}-${parts.day}` === day && parts.minute === '00') {
        const candidates = byLocalHour.get(parts.hour) ?? [];
        candidates.push(timestamp / HOUR_MS);
        byLocalHour.set(parts.hour, candidates);
      }
    }
    for (const { hour, output } of rows) {
      if (!/^(?:[01]\d|2[0-3])$/.test(hour) || !Number.isSafeInteger(output) || output <= 0) continue;
      const candidates = byLocalHour.get(hour) ?? [];
      if (candidates.length === 1 && (candidates[0] + 1) * HOUR_MS <= nowMs) {
        hours.add(candidates[0]);
      }
    }
  }
  return [...hours].sort((a, b) => a - b);
}

/** Adjacent absolute hour IDs, regardless of local midnight or DST. */
export function longestOutputHourStreak(input: Iterable<number>): number {
  const hours = [...new Set([...input].filter((hour) => Number.isSafeInteger(hour) && hour > 0))]
    .sort((a, b) => a - b);
  let max = 0;
  let run = 0;
  let previous = -Infinity;
  for (const hour of hours) {
    run = hour === previous + 1 ? run + 1 : 1;
    max = Math.max(max, run);
    previous = hour;
  }
  return max;
}

/** Output-positive hours, not token peaks or inferred human work time. */
export function nightOutputPeak(input: Iterable<number>, timeZone: string): boolean {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23',
    });
  } catch {
    return false;
  }
  const counts = [0, 0, 0];
  const days = new Set<string>();
  const nightDays = new Set<string>();
  for (const utcHour of new Set(input)) {
    if (!Number.isSafeInteger(utcHour) || utcHour <= 0) continue;
    const parts = partsForHour(formatter, utcHour * HOUR_MS);
    const localHour = Number(parts.hour);
    if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) continue;
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    days.add(day);
    const bin = localHour >= 22 || localHour < 6 ? 0 : localHour < 14 ? 1 : 2;
    counts[bin] += 1;
    if (bin === 0) nightDays.add(day);
  }
  return days.size >= 14 && nightDays.size >= 5 &&
    counts[0] >= Math.ceil(Math.max(counts[1], counts[2]) * 1.2);
}
