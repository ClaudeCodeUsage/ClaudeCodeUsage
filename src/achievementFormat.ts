/** Achievement-only presentation: integer labels never round up to a goal. */
export function formatAchievementInteger(value: number, locale = 'en'): string {
  const integer = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return integer.toLocaleString(locale, { maximumFractionDigits: 0 });
}

export function formatAchievementCompact(value: number, locale = 'en'): string {
  const integer = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  for (const [scale, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']] as const) {
    if (integer >= scale) return formatAchievementInteger(Math.floor(integer / scale), locale) + suffix;
  }
  return formatAchievementInteger(integer, locale);
}
