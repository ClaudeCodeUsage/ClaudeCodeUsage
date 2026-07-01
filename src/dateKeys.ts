// Calendar-date keys for usage bucketing, in a chosen IANA timezone
// (empty string = the system zone).
//
// Day and month bucketing MUST agree on ONE zone. The old loader mixed a UTC
// day key (toISOString()) with a *local* month boundary, so a record just after
// local midnight on the 1st (UTC still on the 30th) landed under a "30th" row
// inside the new month's view. Deriving both the day and the month key from the
// same zone here removes that split.

function partsInZone(date: Date, timeZone: string): { y: string; m: string; d: string } {
  const base: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
  let fmt: Intl.DateTimeFormat;
  try {
    // en-CA formats as YYYY-MM-DD; an invalid user-typed zone throws → fall back.
    fmt = new Intl.DateTimeFormat('en-CA', timeZone ? { ...base, timeZone } : base);
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', base);
  }
  const parts = fmt.formatToParts(date);
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
