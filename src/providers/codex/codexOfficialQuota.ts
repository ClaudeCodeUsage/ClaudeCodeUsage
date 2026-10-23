import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { CodexAccountScopeCache } from './codexAccountScope';
import { CodexQuotaWebSocket } from './codexQuotaWebSocket';

export interface CodexOfficialQuotaWindow {
  windowDurationMins: number | null;
  usedPercent: number;
  /** Unix milliseconds; null is unavailable, never zero. */
  resetAt: number | null;
}
const PLAN_TYPES = ['free', 'go', 'plus', 'pro', 'prolite', 'promax', 'team',
  'self_serve_business_prolite', 'self_serve_business_usage_based', 'business', 'ent26',
  'enterprise_cbp_automation', 'enterprise_cbp_usage_based', 'enterprise', 'edu', 'edu_plus', 'edu_pro', 'unknown'] as const;
export type CodexOfficialPlanType = typeof PLAN_TYPES[number];
const REACHED_TYPES = ['rate_limit_reached', 'workspace_owner_credits_depleted', 'workspace_member_credits_depleted',
  'workspace_owner_usage_limit_reached', 'workspace_member_usage_limit_reached'] as const;
export type CodexOfficialRateLimitReachedType = typeof REACHED_TYPES[number];
const CREDIT_STATUSES = ['available', 'redeeming', 'redeemed', 'unknown'] as const;
const RESET_TYPES = ['codexRateLimits', 'unknown'] as const;
export interface CodexOfficialResetCredit {
  /** Machine/source/account-scoped HMAC; the opaque backend ID is never retained. */
  creditKey: string;
  status: typeof CREDIT_STATUSES[number];
  resetType: typeof RESET_TYPES[number];
  /** Unix milliseconds. */
  grantedAt: number;
  expiresAt?: number | null;
}
export interface CodexOfficialResetCreditsSummary {
  /** Authoritative backend count, independent of a possibly capped details list. */
  availableCount: number;
  /** Absent: unavailable/invalid; null: count only; []: fetched empty. */
  credits?: CodexOfficialResetCredit[] | null;
}
export interface CodexOfficialQuotaSnapshot {
  accountScopeKey: string;
  sourceScopeKey: string;
  observedAt: number;
  requestedAt: number;
  resetAt: number;
  usedPercent: number;
  windows?: { primary?: CodexOfficialQuotaWindow; secondary?: CodexOfficialQuotaWindow };
  ordinaryUsageAllowed?: boolean | null;
  planType?: CodexOfficialPlanType | null;
  rateLimitReachedType?: CodexOfficialRateLimitReachedType | null;
  spendControlReached?: boolean | null;
  rateLimitResetCredits?: CodexOfficialResetCreditsSummary | null;
}
export interface CodexOfficialQuotaParseOptions {
  source: string;
  machineSalt: string;
  requestedAt: number;
  observedAt: number;
}
export interface CodexOfficialQuotaOptions {
  binary: string;
  source: string;
  machineSalt: string;
  signal?: AbortSignal;
  now?: () => number;
  timeoutMs?: number;
  /** Test-only process injection; production always uses the exact proxy command below. */
  dependencies?: {
    spawn(binary: string, args: string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams;
  };
}
export const CODEX_OFFICIAL_QUOTA_MAX_BYTES = 256 * 1024;
export const CODEX_OFFICIAL_QUOTA_TIMEOUT_MS = 10_000;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function has(value: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }
function field(value: Record<string, unknown>, key: string): unknown { return has(value, key) ? value[key] : undefined; }
// Optional evidence comes only from own data properties. Getters/proxies cannot
// turn a failed optional proof into a positive signal or erase a valid count.
function optionalField(value: object, key: string): unknown {
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}
function enumValue<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === 'string' && values.includes(value as T) ? value as T : undefined;
}
function timestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 &&
    Number.isSafeInteger(value * 1000) && value * 1000 <= 8_640_000_000_000_000 ? value * 1000 : undefined;
}
function resetCredits(value: unknown, machineSalt: string, accountScopeKey: string):
    CodexOfficialResetCreditsSummary | null | undefined {
  if (value === null) return null;
  if (!object(value)) return undefined;
  const count = optionalField(value, 'availableCount');
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return undefined;
  const summary: CodexOfficialResetCreditsSummary = { availableCount: count };
  const rows = optionalField(value, 'credits');
  if (rows === null) return { ...summary, credits: null };
  if (!Array.isArray(rows)) return summary;
  const length = optionalField(rows, 'length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > 128) return summary;
  const credits: CodexOfficialResetCredit[] = [], keys = new Set<string>();
  try {
    for (let i = 0; i < length; i++) {
      const row = optionalField(rows, String(i));
      if (!object(row)) return summary;
      const id = optionalField(row, 'id');
      const status = enumValue(optionalField(row, 'status'), CREDIT_STATUSES);
      const resetType = enumValue(optionalField(row, 'resetType'), RESET_TYPES);
      const grantedAt = timestamp(optionalField(row, 'grantedAt'));
      const expiry = optionalField(row, 'expiresAt');
      const expiresAt = expiry === null ? null : timestamp(expiry);
      if (typeof id !== 'string' || id.length === 0 || id.length > 512 || id.trim() !== id ||
          /[\p{Cc}\p{Cf}\p{Cs}]/u.test(id) || status === undefined || resetType === undefined ||
          grantedAt === undefined || (expiry !== undefined && expiresAt === undefined)) return summary;
      const creditKey = createHmac('sha256', machineSalt)
        .update(JSON.stringify(['codex-official-reset-credit-v1', accountScopeKey, id])).digest('hex');
      if (keys.has(creditKey)) return summary;
      keys.add(creditKey);
      credits.push({ creditKey, status, resetType, grantedAt,
        ...(expiresAt !== undefined ? { expiresAt } : {}) });
    }
    return { ...summary, credits };
  } catch { return summary; }
}

/** Parse ONLY the rateLimits RPC result. Unknown fields/credentials are never inspected.
 * The account key scopes the backend usage snapshot, not current authentication
 * in another app or ownership of local logs.
 */
export function parseCodexOfficialQuota(
  value: unknown, options: CodexOfficialQuotaParseOptions,
): CodexOfficialQuotaSnapshot | null {
  try {
    if (!object(value) || has(value, 'error')) return null;
    let selected: unknown;
    if (has(value, 'rateLimitsByLimitId')) {
      const map = value.rateLimitsByLimitId;
      if (!object(map) || !has(map, 'codex')) return null;
      selected = map.codex;
    } else selected = field(value, 'rateLimits');
    if (!object(selected)) return null;
    const limitId = field(selected, 'limitId');
    if (limitId !== undefined && limitId !== 'codex') return null;
    let weekly: { usedPercent: number; resetAt: number } | undefined;
    const windows: NonNullable<CodexOfficialQuotaSnapshot['windows']> = {};
    for (const key of ['primary', 'secondary'] as const) {
      const window = field(selected, key);
      if (window === null || window === undefined) continue;
      if (!object(window)) return null;
      const duration = field(window, 'windowDurationMins');
      if (duration !== undefined && duration !== null &&
          (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration <= 0)) return null;
      const percent = field(window, 'usedPercent'), reset = field(window, 'resetsAt');
      const resetAt = reset == null ? null : timestamp(reset);
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100 ||
          resetAt === undefined || resetAt === 0) return null;
      windows[key] = { windowDurationMins: typeof duration === 'number' ? duration : null, usedPercent: percent, resetAt };
      if (duration !== 10080) continue;
      if (resetAt === null || resetAt <= options.observedAt) return null;
      const next = { usedPercent: percent, resetAt };
      if (weekly && (weekly.usedPercent !== next.usedPercent || weekly.resetAt !== next.resetAt)) return null;
      weekly = next;
    }
    if (!weekly) return null;
    // Installed 0.163 GetAccountRateLimitsResponse declares optional accountId
    // only on the root result. A nested accountId is an unknown, unread field.
    const accountId = field(value, 'accountId');
    const cache = new CodexAccountScopeCache(options.machineSalt);
    const generation = cache.begin(true, options.source, options.requestedAt);
    if (generation === null) return null;
    const scope = cache.observe(true, options.source, { accountId }, options.observedAt, generation);
    if (!scope) return null;
    const ordinary = optionalField(value, 'ordinaryUsageAllowed');
    const plan = optionalField(selected, 'planType');
    const planType = plan === null ? null : enumValue(plan, PLAN_TYPES);
    const reached = optionalField(selected, 'rateLimitReachedType');
    const rateLimitReachedType = reached === null ? null : enumValue(reached, REACHED_TYPES);
    const spend = optionalField(selected, 'spendControlReached');
    const rateLimitResetCredits = resetCredits(optionalField(value, 'rateLimitResetCredits'),
      options.machineSalt, scope.accountScopeKey);
    return { accountScopeKey: scope.accountScopeKey, sourceScopeKey: scope.sourceScopeKey,
      observedAt: options.observedAt, requestedAt: options.requestedAt,
      resetAt: weekly.resetAt, usedPercent: weekly.usedPercent, windows,
      ...(ordinary === null || typeof ordinary === 'boolean' ? { ordinaryUsageAllowed: ordinary } : {}),
      ...(planType !== undefined ? { planType } : {}),
      ...(rateLimitReachedType !== undefined ? { rateLimitReachedType } : {}),
      ...(spend === null || typeof spend === 'boolean' ? { spendControlReached: spend } : {}),
      ...(rateLimitResetCredits !== undefined ? { rateLimitResetCredits } : {}) };
  } catch { return null; }
}

/** Only the existing daemon's transparent WebSocket proxy is supported. */
export async function readCodexOfficialQuota(options: CodexOfficialQuotaOptions): Promise<CodexOfficialQuotaSnapshot | null> {
  let ownedChild: ChildProcessWithoutNullStreams | undefined;
  try {
    const timeoutMs = options.timeoutMs ?? CODEX_OFFICIAL_QUOTA_TIMEOUT_MS;
    if (options.signal?.aborted || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
        timeoutMs > CODEX_OFFICIAL_QUOTA_TIMEOUT_MS || typeof options.binary !== 'string' ||
        options.binary.length === 0 || options.binary.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(options.binary)) return null;
    const now = options.now ?? Date.now, requestedAt = now();
    // Validate source/salt/time before any child exists. The host owns cross-request generations.
    if (new CodexAccountScopeCache(options.machineSalt).begin(true, options.source, requestedAt) === null) return null;
    const env: NodeJS.ProcessEnv = { CODEX_HOME: options.source };
    // Explicit platform paths only; do not read or copy credential environment variables.
    for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP',
      'XDG_RUNTIME_DIR', 'LOCALAPPDATA', 'APPDATA']) {
      const value = process.env[key]; if (value !== undefined) env[key] = value;
    }
    const child = (options.dependencies?.spawn ?? spawn)(options.binary, ['app-server', 'proxy'], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env,
    });
    ownedChild = child;
    return await new Promise<CodexOfficialQuotaSnapshot | null>(resolve => {
      let stopped = false, settled = false, closed = false, killed = false;
      let candidate: CodexOfficialQuotaSnapshot | null = null;
      let bytes = 0, stage: 'upgrade' | 'initialize' | 'quota' = 'upgrade';
      let socket: CodexQuotaWebSocket | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (value: CodexOfficialQuotaSnapshot | null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', aborted);
        socket?.dispose();
        child.stdout.removeListener('data', stdout);
        child.stderr.removeListener('data', stderr);
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
        resolve(value);
      };
      const stop = (value: CodexOfficialQuotaSnapshot | null) => {
        if (stopped) return;
        stopped = true; candidate = value; socket?.dispose();
        if (closed) { settle(candidate); return; }
        try {
          if (!killed) { killed = true; if (!child.kill('SIGKILL')) { settle(null); return; } }
        } catch { settle(null); }
      };
      const aborted = () => { candidate = null; stop(null); };
      const count = (chunk: unknown): chunk is Buffer => {
        if (!Buffer.isBuffer(chunk)) { stop(null); return false; }
        bytes += chunk.length;
        if (bytes > CODEX_OFFICIAL_QUOTA_MAX_BYTES) { stop(null); return false; }
        return true;
      };
      const stdout = (chunk: unknown) => { if (!stopped && count(chunk)) socket?.push(chunk); };
      const stderr = (chunk: unknown) => { if (!stopped) count(chunk); }; // discard immediately
      const write = (data: Buffer) => { if (!stopped) { try { child.stdin.write(data); } catch { stop(null); } } };
      const send = (value: object) => socket!.sendText(JSON.stringify(value));
      socket = new CodexQuotaWebSocket({
        onSend: write, onFailure: () => stop(null),
        onOpen: () => {
          stage = 'initialize';
          send({ id: 1, method: 'initialize', params: {
            clientInfo: { name: 'claude-code-usage', version: '1' }, capabilities: { experimentalApi: false },
          } });
        },
        onText: text => {
          try {
            const message: unknown = JSON.parse(text);
            if (!object(message) || has(message, 'error')) { stop(null); return; }
            if (!has(message, 'id')) return; // discard notifications, never acknowledge server requests
            if (!has(message, 'result')) { stop(null); return; }
            if (stage === 'initialize' && message.id === 1 && object(message.result)) {
              stage = 'quota'; send({ method: 'initialized' });
              send({ id: 2, method: 'account/rateLimits/read', params: {} });
            } else if (stage === 'quota' && message.id === 2) {
              stop(parseCodexOfficialQuota(message.result, {
                source: options.source, machineSalt: options.machineSalt, requestedAt, observedAt: now(),
              }));
            } else stop(null);
          } catch { stop(null); }
        },
      });
      child.stdout.on('data', stdout); child.stderr.on('data', stderr);
      child.stdout.on('end', () => { if (!stopped) stop(null); });
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', () => stop(null));
      child.on('error', () => { stop(null); if (child.pid === undefined) settle(null); });
      child.once('close', () => { closed = true; if (!stopped) stop(null); settle(candidate); });
      timer = setTimeout(() => { candidate = null; stop(null); settle(null); }, timeoutMs);
      options.signal?.addEventListener('abort', aborted, { once: true });
      if (options.signal?.aborted) aborted(); else write(socket.request);
    });
  } catch {
    try { ownedChild?.kill('SIGKILL'); } catch { /* Never expose transport errors. */ }
    return null;
  }
}
