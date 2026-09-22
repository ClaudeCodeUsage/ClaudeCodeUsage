// Calendar-date keys for usage bucketing, in a chosen IANA timezone
// (empty string = the system zone).
//
// Day and month bucketing MUST agree on ONE zone. The old loader mixed a UTC
// day key (toISOString()) with a *local* month boundary, so a record just after
// local midnight on the 1st (UTC still on the 30th) landed under a "30th" row
// inside the new month's view. Deriving both the day and the month key from the
// same zone here removes that split.

// Constructing an Intl.DateTimeFormat is expensive, and these helpers run once
// per ingested record: a single index pass over a large local history calls them
// millions of times. Both the zone resolution and the formatters are therefore
// memoised per zone. Every distinct key is a configured zone, so the maps stay
// at a handful of entries for the life of the process.
const resolvedZones = new Map<string, string>();
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** Returns a usable IANA zone, falling back to the system zone when necessary. */
export function resolveTimeZone(timeZone: string): string {
  const cached = resolvedZones.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en-CA', timeZone ? { timeZone } : undefined)
      .resolvedOptions()
      .timeZone || 'UTC';
  } catch {
    resolved = new Intl.DateTimeFormat('en-CA').resolvedOptions().timeZone || 'UTC';
  }
  resolvedZones.set(timeZone, resolved);
  return resolved;
}

function dayFormatter(zone: string): Intl.DateTimeFormat {
  const cached = dayFormatters.get(zone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: zone,
  });
  dayFormatters.set(zone, formatter);
  return formatter;
}

function hourFormatter(zone: string): Intl.DateTimeFormat {
  const cached = hourFormatters.get(zone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: zone,
  });
  hourFormatters.set(zone, formatter);
  return formatter;
}

function partsInZone(date: Date, timeZone: string): { y: string; m: string; d: string } {
  const parts = dayFormatter(resolveTimeZone(timeZone)).formatToParts(date);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** "YYYY-MM-DD" for a timestamp in `timeZone`; '' when the date is invalid. */
export function dayKeyInZone(date: Date, timeZone: string): string {
  if (isNaN(date.getTime())) {
    return '';
  }
  const { y, m, d } = partsInZone(date, timeZone);
  return y && m && d ? `${y}-${m}-${d}` : '';
}

/** "YYYY-MM" for a timestamp in `timeZone`; '' when the date is invalid. */
export function monthKeyInZone(date: Date, timeZone: string): string {
  const key = dayKeyInZone(date, timeZone);
  return key ? key.slice(0, 7) : '';
}

/** "00" through "23" for a timestamp in `timeZone`; '' when invalid. */
export function hourKeyInZone(date: Date, timeZone: string): string {
  if (isNaN(date.getTime())) {
    return '';
  }
  return hourFormatter(resolveTimeZone(timeZone)).formatToParts(date)
    .find((part) => part.type === 'hour')?.value ?? '';
}

/** Provider-neutral display label for a validated "00" through "23" hour key. */
export function formatHourLabel(hour: string): string {
  return /^(?:[01]\d|2[0-3])$/.test(hour) ? `${hour}:00` : '';
}

/**
 * Calendar-day keys ending on `now` in `timeZone`, ordered from oldest to newest.
 * The range walks civil dates rather than subtracting fixed-duration milliseconds.
 */
export function rollingDayKeys(now: number, timeZone: string, count: number): string[] {
  const endKey = dayKeyInZone(new Date(now), resolveTimeZone(timeZone));
  return rollingDayKeysFromDayKey(endKey, count);
}

/**
 * Civil-date keys ending at an already-resolved `YYYY-MM-DD` snapshot day.
 * Invalid or non-canonical calendar dates return an empty range.
 */
export function rollingDayKeysFromDayKey(
  endDayKey: string,
  count: number,
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDayKey) || count <= 0) {
    return [];
  }

  const [year, month, day] = endDayKey.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1, day));
  if (end.toISOString().slice(0, 10) !== endDayKey) {
    return [];
  }
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    keys.push(new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0, 10));
  }
  return keys;
}
