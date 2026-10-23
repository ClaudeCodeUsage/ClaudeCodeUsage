/** Bounded, account-free evidence embedded in the existing P2 observation. */
export interface CodexOfficialQuotaFacts {
  schemaVersion: 1;
  requestedAt: number;
  ordinaryUsageAllowed?: boolean | null;
  windows?: { primary?: CodexOfficialQuotaWindowFacts; secondary?: CodexOfficialQuotaWindowFacts };
  rateLimitResetCredits?: CodexOfficialResetCreditsFacts | null;
}

export interface CodexOfficialQuotaWindowFacts {
  windowDurationMins: number | null;
  usedPercent: number;
  resetAt: number | null;
}

export interface CodexOfficialResetCreditFacts {
  creditKey: string;
  status: 'available' | 'redeeming' | 'redeemed' | 'unknown';
  resetType: 'codexRateLimits' | 'unknown';
  grantedAt: number;
  expiresAt?: number | null;
}

export interface CodexOfficialResetCreditsFacts {
  availableCount: number;
  /** Missing: unavailable/invalid; null: count only; []: fetched empty. */
  credits?: CodexOfficialResetCreditFacts[] | null;
}

export const CODEX_OFFICIAL_FACTS_MAX_CREDITS = 128;
const FACT_KEYS = ['schemaVersion', 'requestedAt', 'ordinaryUsageAllowed', 'windows', 'rateLimitResetCredits'];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Never invoke getters, including those on optional evidence or list entries. */
function field(value: object, key: string): unknown {
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}

function has(value: object, key: string): boolean {
  try { return Object.prototype.hasOwnProperty.call(value, key); } catch { return false; }
}

function exact(value: object, allowed: readonly string[]): boolean {
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key) &&
    Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

function credit(value: unknown, strict: boolean): CodexOfficialResetCreditFacts | undefined {
  if (!object(value) || (strict && !exact(value, ['creditKey', 'status', 'resetType', 'grantedAt', 'expiresAt']))) return;
  const creditKey = field(value, 'creditKey'), status = field(value, 'status');
  const resetType = field(value, 'resetType'), grantedAt = field(value, 'grantedAt'), expiresAt = field(value, 'expiresAt');
  if (typeof creditKey !== 'string' || !/^[a-f0-9]{64}$/.test(creditKey) ||
    (status !== 'available' && status !== 'redeeming' && status !== 'redeemed' && status !== 'unknown') ||
    (resetType !== 'codexRateLimits' && resetType !== 'unknown') || !timestamp(grantedAt) ||
    (expiresAt !== undefined && expiresAt !== null && !timestamp(expiresAt)) ||
    (strict && has(value, 'expiresAt') && expiresAt === undefined)) return;
  return { creditKey, status, resetType, grantedAt, ...(expiresAt !== undefined ? { expiresAt } : {}) };
}

function resetCredits(value: unknown, strict: boolean): CodexOfficialResetCreditsFacts | null | undefined {
  if (value === null) return null;
  if (!object(value) || (strict && !exact(value, ['availableCount', 'credits']))) return;
  const availableCount = field(value, 'availableCount');
  if (typeof availableCount !== 'number' || !Number.isSafeInteger(availableCount) || availableCount < 0) return;
  const summary: CodexOfficialResetCreditsFacts = { availableCount };
  const rows = field(value, 'credits');
  if (rows === null) return { ...summary, credits: null };
  if (!has(value, 'credits')) return summary;
  const invalidList = (): CodexOfficialResetCreditsFacts | undefined => strict ? undefined : summary;
  if (!Array.isArray(rows)) return invalidList();
  const length = field(rows, 'length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 ||
    length > CODEX_OFFICIAL_FACTS_MAX_CREDITS ||
    (strict && !exact(rows, ['length', ...Array.from({ length }, (_, i) => String(i))]))) return invalidList();
  const credits: CodexOfficialResetCreditFacts[] = [], keys = new Set<string>();
  for (let i = 0; i < length; i++) {
    const entry = credit(field(rows, String(i)), strict);
    if (!entry || keys.has(entry.creditKey)) return invalidList();
    keys.add(entry.creditKey);
    credits.push(entry);
  }
  return { ...summary, credits };
}

function window(value: unknown, strict: boolean): CodexOfficialQuotaWindowFacts | undefined {
  if (!object(value) || (strict && !exact(value, ['windowDurationMins', 'usedPercent', 'resetAt']))) return;
  const windowDurationMins = field(value, 'windowDurationMins'), usedPercent = field(value, 'usedPercent');
  const resetAt = field(value, 'resetAt');
  if (!(windowDurationMins === null || typeof windowDurationMins === 'number' &&
      Number.isSafeInteger(windowDurationMins) && windowDurationMins > 0) ||
    typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100 ||
    !(resetAt === null || timestamp(resetAt) && resetAt > 0)) return;
  return { windowDurationMins, usedPercent, resetAt };
}

function windows(value: unknown, strict: boolean): CodexOfficialQuotaFacts['windows'] {
  if (!object(value) || (strict && !exact(value, ['primary', 'secondary']))) return;
  const result: NonNullable<CodexOfficialQuotaFacts['windows']> = {};
  for (const key of ['primary', 'secondary'] as const) {
    if (!has(value, key)) continue;
    const parsed = window(field(value, key), strict);
    if (!parsed) { if (strict) return; else continue; }
    result[key] = parsed;
  }
  return result;
}

function copy(value: unknown, strict: boolean): CodexOfficialQuotaFacts | undefined {
  if (!object(value) || (strict && (!exact(value, FACT_KEYS) || field(value, 'schemaVersion') !== 1))) return;
  if (has(value, 'schemaVersion') && field(value, 'schemaVersion') !== 1) return;
  const requestedAt = field(value, 'requestedAt');
  if (!timestamp(requestedAt) || requestedAt <= 0) return;
  const result: CodexOfficialQuotaFacts = { schemaVersion: 1, requestedAt };
  if (has(value, 'ordinaryUsageAllowed')) {
    const ordinary = field(value, 'ordinaryUsageAllowed');
    if (ordinary === null || typeof ordinary === 'boolean') result.ordinaryUsageAllowed = ordinary;
    else if (strict) return;
  }
  if (has(value, 'windows')) {
    const parsed = windows(field(value, 'windows'), strict);
    if (parsed !== undefined) result.windows = parsed;
    else if (strict) return;
  }
  if (has(value, 'rateLimitResetCredits')) {
    const parsed = resetCredits(field(value, 'rateLimitResetCredits'), strict);
    if (parsed !== undefined) result.rateLimitResetCredits = parsed;
    else if (strict) return;
  }
  return result;
}

/** Copy known sanitized sample/facts fields only. Unknown fields are never read.
 * Invalid optional evidence is unavailable; it cannot erase an independent count. */
export function copyCodexOfficialQuotaFacts(value: unknown): CodexOfficialQuotaFacts | undefined {
  try { return copy(value, false); } catch { return undefined; }
}

/** Persisted facts use an exact allowlist, never runtime-style lossy recovery. */
export function parseCodexOfficialQuotaFacts(value: unknown): CodexOfficialQuotaFacts | null {
  try { return copy(value, true) ?? null; } catch { return null; }
}

/** Request time changes on every poll. Compaction may also ignore routine usage
 * changes so they cannot crowd out credit/status/availability transitions. */
export function codexOfficialQuotaFactsEvidenceKey(
  value: CodexOfficialQuotaFacts | undefined,
  options: { omitWindowUsage?: boolean } = {},
): string {
  if (!value) return '';
  const { requestedAt: _requestedAt, ...evidence } = value;
  if (options.omitWindowUsage && evidence.windows) {
    evidence.windows = { ...evidence.windows };
    for (const key of ['primary', 'secondary'] as const) {
      const current = evidence.windows[key];
      if (current) evidence.windows[key] = { ...current, usedPercent: 0 };
    }
  }
  if (evidence.rateLimitResetCredits?.credits) {
    evidence.rateLimitResetCredits = { ...evidence.rateLimitResetCredits,
      credits: [...evidence.rateLimitResetCredits.credits].sort((a, b) => a.creditKey.localeCompare(b.creditKey)) };
  }
  return JSON.stringify(evidence);
}
