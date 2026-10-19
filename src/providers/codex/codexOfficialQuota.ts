import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { CodexAccountScopeCache } from './codexAccountScope';
import { CodexQuotaWebSocket } from './codexQuotaWebSocket';

export interface CodexOfficialQuotaSnapshot {
  accountScopeKey: string;
  sourceScopeKey: string;
  observedAt: number;
  requestedAt: number;
  resetAt: number;
  usedPercent: number;
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
    for (const key of ['primary', 'secondary']) {
      const window = field(selected, key);
      if (window === null || window === undefined) continue;
      if (!object(window)) return null;
      const duration = field(window, 'windowDurationMins');
      if (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration <= 0) return null;
      if (duration !== 10080) continue;
      const percent = field(window, 'usedPercent'), reset = field(window, 'resetsAt');
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100 ||
          typeof reset !== 'number' || !Number.isSafeInteger(reset) || reset <= 0 ||
          !Number.isSafeInteger(reset * 1000) || reset * 1000 > 8_640_000_000_000_000 ||
          reset * 1000 <= options.observedAt) return null;
      const next = { usedPercent: percent, resetAt: reset * 1000 };
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
    return { accountScopeKey: scope.accountScopeKey, sourceScopeKey: scope.sourceScopeKey,
      observedAt: options.observedAt, requestedAt: options.requestedAt,
      resetAt: weekly.resetAt, usedPercent: weekly.usedPercent };
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
