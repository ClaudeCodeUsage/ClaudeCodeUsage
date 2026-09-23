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
  const date = new Date(Date.UTC(year, month - 1, monthly ? 1 : day, 12));
  const options: Intl.DateTimeFormatOptions = monthly
    ? { year: 'numeric', month: 'long' }
    : dailyOptions;
  return usageDateFormatter(locale, { ...options, timeZone: 'UTC' }).format(date);
}

// The dashboard formats one label per table row and chart point, and
// toLocaleDateString constructs a fresh Intl.DateTimeFormat on every call (the
// same cost #99 removed from dateKeys). Formatters are memoised per locale and
// options; the dashboard only ever asks for a handful of combinations.
const usageDateFormatters = new Map<string, Intl.DateTimeFormat>();

function usageDateFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = usageDateFormatters.get(key);
  if (cached) {
    return cached;
  }
  // toLocaleDateString always renders a date: with no date field requested it
  // defaults to numeric year, month and day. Intl.DateTimeFormat only does so
  // when no time field is requested either, so apply the default explicitly.
  const hasDateField = options.weekday !== undefined || options.year !== undefined ||
    options.month !== undefined || options.day !== undefined ||
    options.dateStyle !== undefined;
  const formatter = new Intl.DateTimeFormat(
    locale,
    hasDateField ? options : { ...options, year: 'numeric', month: 'numeric', day: 'numeric' },
  );
  usageDateFormatters.set(key, formatter);
  return formatter;
}
