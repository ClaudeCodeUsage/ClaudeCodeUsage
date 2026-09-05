function localeOrDefault(locale: string): string {
  try {
    new Intl.NumberFormat(locale);
    return locale;
  } catch {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  }
}

function timeZoneOrDefault(timeZone: string): string | undefined {
  if (!timeZone) {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Format a duration with locale-aware numeric units and no provider semantics. */
export function formatLocalizedDuration(milliseconds: number, locale: string): string {
  const activeLocale = localeOrDefault(locale);
  let minutes = Math.round(finiteNonNegative(milliseconds) / 60_000);
  const units: string[] = [];
  const add = (value: number, unit: Intl.NumberFormatOptions['unit']): void => {
    if (value > 0 || units.length === 0) {
      units.push(new Intl.NumberFormat(activeLocale, {
        style: 'unit', unit, unitDisplay: 'long', maximumFractionDigits: 0,
      }).format(value));
    }
  };
  if (minutes >= 1_440) {
    add(Math.floor(minutes / 1_440), 'day');
    minutes %= 1_440;
  }
  if (minutes >= 60) {
    add(Math.floor(minutes / 60), 'hour');
    minutes %= 60;
  }
  add(minutes, 'minute');
  return units.join(' ');
}

/** Format a target timestamp relative to a supplied, deterministic clock. */
export function formatLocalizedRelativeTime(
  targetTimestamp: number,
  now: number,
  locale: string,
): string {
  const activeLocale = localeOrDefault(locale);
  const delta = Number.isFinite(targetTimestamp) && Number.isFinite(now)
    ? targetTimestamp - now
    : 0;
  const absolute = Math.abs(delta);
  const choices: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ];
  const [size, unit] = choices.find(([threshold]) => absolute >= threshold)
    ?? [1_000, 'second'];
  return new Intl.RelativeTimeFormat(activeLocale, { numeric: 'auto' }).format(
    Math.round(delta / size),
    unit,
  );
}

/** Format byte counts without exposing file names, paths, or source details. */
export function formatLocalizedBytes(bytes: number, locale: string): string {
  const activeLocale = localeOrDefault(locale);
  const value = finiteNonNegative(bytes);
  const units: Intl.NumberFormatOptions['unit'][] = [
    'byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte',
  ];
  let index = 0;
  let scaled = value;
  while (scaled >= 1_024 && index < units.length - 1) {
    scaled /= 1_024;
    index += 1;
  }
  return new Intl.NumberFormat(activeLocale, {
    style: 'unit',
    unit: units[index],
    unitDisplay: 'narrow',
    maximumFractionDigits: index === 0 ? 0 : 1,
  }).format(scaled);
}

export interface CodexLocalizedFormatters {
  formatDateTime: (timestamp: number) => string;
  formatDuration: (milliseconds: number) => string;
  formatRelativeTime: (targetTimestamp: number, now: number) => string;
  formatBytes: (bytes: number) => string;
}

/** Build the exact formatter bundle consumed by the production Codex renderer. */
export function createCodexLocalizedFormatters(
  locale: string,
  timeZone: string,
): CodexLocalizedFormatters {
  const activeLocale = localeOrDefault(locale);
  const activeTimeZone = timeZoneOrDefault(timeZone);
  return {
    formatDateTime: (timestamp) => new Intl.DateTimeFormat(activeLocale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(activeTimeZone ? { timeZone: activeTimeZone } : {}),
    }).format(new Date(timestamp)),
    formatDuration: (milliseconds) =>
      formatLocalizedDuration(milliseconds, activeLocale),
    formatRelativeTime: (targetTimestamp, now) =>
      formatLocalizedRelativeTime(targetTimestamp, now, activeLocale),
    formatBytes: (bytes) => formatLocalizedBytes(bytes, activeLocale),
  };
}
