export function shortUsageDate(dateString: string, monthly = false): string {
  const [year, month, day] = dateString.split('-').map(Number);
  if (monthly) {
    return `${year}/${String(month).padStart(2, '0')}`;
  }
  return `${month}/${day}`;
}

export function formatUsageDate(
  dateString: string,
  locale: string,
  dailyOptions: Intl.DateTimeFormatOptions,
  monthly = false,
): string {
  // Usage keys are already bucketed in the configured zone. Render the key
  // itself in UTC so negative offsets cannot roll it into the previous day or
  // month (#54), and use an explicit monthly flag so July 1 remains a day.
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const options: Intl.DateTimeFormatOptions = monthly
    ? { year: 'numeric', month: 'long' }
    : dailyOptions;
  return date.toLocaleDateString(locale, { ...options, timeZone: 'UTC' });
}
