/**
 * Local-only display conversion for USD-denominated estimates.
 *
 * Pricing, aggregation, sorting, and persistence continue to use USD. The
 * selected currency resolves to one bundled reference-rate snapshot: there is
 * no exchange-rate transport and no user-editable multiplier.
 */

export type DisplayCurrencyCode =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'JPY'
  | 'CNY'
  | 'HKD'
  | 'KRW'
  | 'IDR'
  | 'BRL'
  | 'AUD'
  | 'CAD'
  | 'CHF'
  | 'INR'
  | 'SGD';

export interface CurrencyDisplayPreference {
  code: DisplayCurrencyCode;
  label: string;
  unitsPerUsd: number;
  converted: boolean;
  referenceDate: string;
}

interface CurrencyPreset {
  code: DisplayCurrencyCode;
  symbol: string;
  unitsPerUsd: number;
}

// ECB euro reference rates published for 2026-09-09, converted from currency
// units per EUR to currency units per USD. USD stays the invariant source unit.
export const CURRENCY_REFERENCE_DATE = '2026-09-09';

const PRESETS: readonly CurrencyPreset[] = [
  { code: 'USD', symbol: '$', unitsPerUsd: 1 },
  { code: 'EUR', symbol: '€', unitsPerUsd: 0.85822176 },
  { code: 'GBP', symbol: '£', unitsPerUsd: 0.73719533 },
  { code: 'JPY', symbol: '¥', unitsPerUsd: 153.26982492 },
  { code: 'CNY', symbol: '¥', unitsPerUsd: 6.70777549 },
  { code: 'HKD', symbol: 'HK$', unitsPerUsd: 7.84225884 },
  { code: 'KRW', symbol: '₩', unitsPerUsd: 1336.19979403 },
  { code: 'IDR', symbol: 'Rp', unitsPerUsd: 17475.79814624 },
  { code: 'BRL', symbol: 'R$', unitsPerUsd: 5.08891177 },
  { code: 'AUD', symbol: 'A$', unitsPerUsd: 1.38414006 },
  { code: 'CAD', symbol: 'C$', unitsPerUsd: 1.37684518 },
  { code: 'CHF', symbol: 'CHF', unitsPerUsd: 0.80707175 },
  { code: 'INR', symbol: '₹', unitsPerUsd: 95.1102815 },
  { code: 'SGD', symbol: 'S$', unitsPerUsd: 1.26338826 },
] as const;

export const DISPLAY_CURRENCY_CODES: DisplayCurrencyCode[] = PRESETS.map(
  (preset) => preset.code,
);

export const DISPLAY_CURRENCY_LABELS: string[] = PRESETS.map(
  (preset) => `${preset.code} (${preset.symbol})`,
);

const PRESETS_BY_CODE = new Map<DisplayCurrencyCode, CurrencyPreset>(
  PRESETS.map((preset) => [preset.code, preset]),
);

// Compatibility with values stored by the early 2.3.2 test build. Ambiguous
// yen/yuan symbols are deliberately omitted; their ISO codes remain accepted.
const LEGACY_SYMBOL_CODES = new Map<string, DisplayCurrencyCode>([
  ['$', 'USD'],
  ['US$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['HK$', 'HKD'],
  ['₩', 'KRW'],
  ['RP', 'IDR'],
  ['R$', 'BRL'],
  ['A$', 'AUD'],
  ['C$', 'CAD'],
  ['₹', 'INR'],
  ['S$', 'SGD'],
]);

export function normalizeDisplayCurrencyCode(raw: unknown): DisplayCurrencyCode {
  if (typeof raw !== 'string') return 'USD';
  const normalized = raw.trim().toUpperCase();
  if (PRESETS_BY_CODE.has(normalized as DisplayCurrencyCode)) {
    return normalized as DisplayCurrencyCode;
  }
  return LEGACY_SYMBOL_CODES.get(normalized) ?? 'USD';
}

export function resolveCurrencyDisplay(raw: unknown): CurrencyDisplayPreference {
  const code = normalizeDisplayCurrencyCode(raw);
  const preset = PRESETS_BY_CODE.get(code) ?? PRESETS[0];
  return {
    code,
    label: code === 'USD' ? '$' : code,
    unitsPerUsd: preset.unitsPerUsd,
    converted: code !== 'USD',
    referenceDate: CURRENCY_REFERENCE_DATE,
  };
}

function normalizedDecimalPlaces(value: number): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(4, Math.floor(value)))
    : 2;
}

/** The invariant source representation, unaffected by display preferences. */
export function formatUsdBaseline(amountUsd: number, decimalPlaces = 2): string {
  if (!Number.isFinite(amountUsd)) return '—';
  return `$${amountUsd.toFixed(normalizedDecimalPlaces(decimalPlaces))}`;
}

/** Format one USD estimate using the selected bundled display preset. */
export function formatUsdForDisplay(
  amountUsd: number,
  currency: unknown,
  decimalPlaces = 2,
): string {
  if (!Number.isFinite(amountUsd)) return '—';
  const preference = resolveCurrencyDisplay(currency);
  const amount = (amountUsd * preference.unitsPerUsd)
    .toFixed(normalizedDecimalPlaces(decimalPlaces));
  if (!preference.converted) return `$${amount}`;
  return `≈${preference.label} ${amount}`;
}

/** Compact artifacts only: convert full-precision USD once, then localize whole
 * display units. A positive amount below one unit never becomes a false zero.
 * Existing decimal/card formatters and all pricing calculations are unchanged.
 */
export function formatUsdWholeForDisplay(amountUsd: number, currency: unknown, locale: string): string {
  const preference = resolveCurrencyDisplay(currency);
  const converted = amountUsd * preference.unitsPerUsd;
  if (!Number.isFinite(converted) || converted < 0 || converted > Number.MAX_SAFE_INTEGER) return '—';
  const small = converted > 0 && converted < 1;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(small ? 1 : converted);
  const amount = preference.converted ? `≈${preference.label} ${number}` : `$${number}`;
  return small ? `<${amount}` : amount;
}
