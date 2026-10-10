import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ClaudeQuotaPaceSource } from '../quotaPaceSource';
import { adaptClaudeQuotaPace, QUOTA_PACE_WEEK_MS, type QuotaPaceAdapterSnapshot } from '../quotaPaceAdapters';
import { fingerprintForStableIdentity } from '../quotaObservationStore';
import type { ClaudeApiUsageResponse } from '../types';

// As in extensionWindowActivity.test.ts, import the actual owner behind a
// VS Code shim; never run its constructor, activation, OAuth or discovery.
function loadOwner(): typeof import('../extension') {
  const loader = require('node:module');
  const original = loader._load;
  const vscode: any = new Proxy(function () {}, {
    get: (_target, key) => key === 'then' || key === 'workspaceFolders' ? undefined : vscode,
    apply: () => vscode,
    construct: () => vscode,
  });
  loader._load = function (name: string, ...args: unknown[]): unknown {
    return name === 'vscode' ? vscode : original.call(this, name, ...args);
  };
  try { return require('../extension'); } finally { loader._load = original; }
}

const { ClaudeCodeUsageExtension } = loadOwner();
const { ClaudeApiClient, claudeQuotaIdentitySignal } = require('../claudeApiClient') as typeof import('../claudeApiClient');
const WEEK = QUOTA_PACE_WEEK_MS;
const START = Date.parse('2026-10-01T00:00:00Z');
const RESET = START + WEEK;
const T = START + WEEK / 4;
const MINUTE = 60_000;
const SALT = 'weekly-pace-owner-fixture-salt';
// Synthetic in-memory signals stand in for the client's already verified HMAC.
const SIGNAL = claudeQuotaIdentitySignal('fixture-api-machine-salt', 'fake-request-identity-a');
const OTHER_SIGNAL = claudeQuotaIdentitySignal('fixture-api-machine-salt', 'fake-request-identity-b');
const iso = (time: number): string => new Date(time).toISOString();
const raw = (percent = 29, reset = RESET): ClaudeApiUsageResponse => ({ limits: [
  { kind: 'weekly_all', group: 'weekly', percent, resets_at: iso(reset) },
] });
const legacy = (percent = 29, reset = RESET): ClaudeApiUsageResponse => ({
  seven_day: { utilization: percent, resets_at: iso(reset) },
});

function forbiddenAccess(object: any, keys: readonly string[], effects: string[]): void {
  for (const key of keys) Object.defineProperty(object, key, {
    configurable: true,
    get(): never { effects.push(key); return assert.fail(`unexpected owner activity: ${key}`); },
  });
}

function harness(enabled = true, tracking = true) {
  const extension: any = Object.create(ClaudeCodeUsageExtension.prototype);
  const settings: Record<string, unknown> = {
    showWeeklyQuotaPace: enabled, usageLimitTracking: tracking,
    showCost: true, showContext: false, statusBarMetric: 'tokens',
    showScopedWeekly: true, quotaFiveHourOnly: false, showResetInStatusBar: true,
    resetCountdownFormat: 'units', statusBarQuotaFormat: 'wk {weekly}',
    statusBarProvider: 'claude', dashboardAutoRefresh: false,
    'advice.effectiveness.enabled': false,
  };
  const effects: string[] = [];
  const visibility: unknown[][] = [], quota: any[][] = [], providers: unknown[][] = [];
  let signal: string | null = SIGNAL;
  let signalReads = 0;
  extension.disposed = false;
  extension.settings = { get: (key: string) => settings[key] };
  extension.cache = { records: [], usageLimits: raw(), usageLimitsLastUpdate: new Date(T) };
  extension.quotaFingerprintSalt = SALT;
  extension.claudeQuotaPaceSource = new ClaudeQuotaPaceSource();
  extension.apiClient = Object.create(ClaudeApiClient.prototype);
  Object.defineProperty(extension.apiClient, 'lastQuotaIdentitySignal', {
    get: () => { signalReads++; return signal; },
  });
  forbiddenAccess(extension.apiClient, ['fetchUsageLimits', 'loadCredentials', 'credentialsPath'], effects);
  extension.codexView = null;
  extension.codexInsights = null;
  extension.codexRefreshing = false;
  extension.codexHasData = false;
  extension.codexAvailable = false;
  extension.codexProgress = null;
  extension.providerRefreshStates = { claude: { failed: false }, codex: { failed: false } };
  extension.deliveredRefreshStates = {};
  extension.outputChannel = { appendLine: (line: string) => {
    effects.push('unexpected diagnostic'); assert.fail(line);
  } };
  extension.statusBar = {
    setVisibility: (...args: unknown[]) => visibility.push(args),
    updateQuota: (...args: unknown[]) => quota.push(args),
    setProvider: (provider: string) => assert.equal(provider, 'claude'),
  };
  extension.webviewProvider = {
    updateAdviceEffectivenessData: () => undefined,
    updateProviderData: (...args: unknown[]) => providers.push(args),
    updateQuota: () => undefined,
    updateQuotaPace: () => undefined,
    updateWeeklyQuotaHistory: () => undefined,
    clearClaudeSource: () => undefined,
  };
  // Tripwires stop a wrong dispatch before it can reach a real service. The
  // settings handler, getConfiguration, syncProviderUi, pace getter and client
  // memory-signal getter remain actual implementations, as do source/adapter.
  forbiddenAccess(extension, [
    'onConfigurationChanged', 'createCodexProvider', 'codexProvider',
    'refreshData', 'refreshCodexData', 'maybeFetchUsageLimits', 'startAutoRefresh',
    'startFileWatching', 'stopFileWatching', 'startCodexWatching', 'stopCodexWatching',
    'startCredentialsWatching', 'stopCredentialsWatching', 'claudeProfileContinuitySignal',
    'quotaObservationRepository', 'quotaObservationStore', 'context',
  ], effects);
  return { extension, settings, effects, visibility, quota, providers,
    setSignal: (value: string | null) => { signal = value; },
    signalReads: () => signalReads };
}

// A synchronous lease over I/O boundaries. Every patch is restored even on the
// deliberate red failures. No fixture reads any normal provider/profile state.
function withoutActivity<Result>(run: () => Result, forbidClock = false): Result {
  const restore: Array<() => void> = [];
  const effects: string[] = [];
  const trap = (object: any, key: string, label = key): void => {
    const original = object[key];
    if (typeof original !== 'function') return;
    object[key] = () => { effects.push(label); return assert.fail(`unexpected I/O: ${label}`); };
    restore.push(() => { object[key] = original; });
  };
  const fs = require('node:fs');
  for (const key of ['readFileSync', 'readFile', 'writeFileSync', 'writeFile', 'appendFile',
    'appendFileSync', 'readdirSync', 'readdir', 'existsSync', 'statSync', 'lstatSync',
    'openSync', 'open', 'watch', 'watchFile', 'createReadStream', 'createWriteStream']) trap(fs, key, `fs.${key}`);
  for (const key of ['readFile', 'writeFile', 'appendFile', 'readdir', 'stat', 'lstat', 'open', 'mkdir']) {
    trap(fs.promises, key, `fs.promises.${key}`);
  }
  for (const module of ['node:http', 'node:https', 'node:net', 'node:child_process']) {
    const boundary = require(module);
    for (const key of ['request', 'get', 'connect', 'createConnection', 'exec', 'execSync',
      'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) trap(boundary, key, `${module}.${key}`);
  }
  for (const key of ['setTimeout', 'setInterval', 'setImmediate', 'fetch']) trap(globalThis, key);
  if (forbidClock) trap(Date, 'now', 'Date.now');
  try {
    const result = run();
    assert.deepEqual(effects, [], 'even caught I/O failures count as extra activity');
    return result;
  } finally { for (const undo of restore.reverse()) undo(); }
}

function snapshot(extension: any): QuotaPaceAdapterSnapshot {
  const value = withoutActivity(() => extension.getClaudeQuotaPaceSnapshot());
  assert.ok(value, 'enabled actual extension owner must project its cached successful response');
  return value;
}

function observe(h: ReturnType<typeof harness>, usage: ClaudeApiUsageResponse, time: number,
  signal: string | null = SIGNAL): QuotaPaceAdapterSnapshot {
  h.extension.cache.usageLimits = usage;
  h.extension.cache.usageLimitsLastUpdate = new Date(time);
  h.setSignal(signal);
  return snapshot(h.extension);
}

function result(value: QuotaPaceAdapterSnapshot, now = value.observedAt!): any {
  const entries = adaptClaudeQuotaPace({ enabled: true, now, snapshot: value });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].slot, 0);
  assert.equal(entries[0].kind, 'weekly_all');
  return entries[0].result;
}

function trusted(value: QuotaPaceAdapterSnapshot): void {
  assert.equal(value.accountWindowTrust, 'trusted');
  assert.equal(result(value).status, 'ready');
}

function withheld(value: QuotaPaceAdapterSnapshot): void {
  assert.equal(value.accountWindowTrust, 'discontinuous');
  assert.deepEqual(result(value), { status: 'unavailable', reason: 'untrusted-account-window' });
}

test('actual panel pace ON/OFF dispatch only repaints cached quota and provider UI', () => {
  const h = harness();
  const cache = h.extension.cache;
  const usage = cache.usageLimits;
  const owner = h.extension.claudeQuotaPaceSource;
  for (const enabled of [true, false, true]) {
    h.settings.showWeeklyQuotaPace = enabled;
    const deliveries = h.providers.length;
    withoutActivity(() => h.extension.onSettingsChangedFromPanel('showWeeklyQuotaPace'));
    assert.deepEqual(h.visibility[h.visibility.length - 1], [true, false, true, 'tokens', true, false, true,
      'units', 'wk {weekly}', enabled], 'tenth visibility argument carries the shared pace toggle');
    assert.strictEqual(h.quota[h.quota.length - 1]?.[0], usage, 'quota repaint uses the existing raw cache');
    const pace = h.quota[h.quota.length - 1]?.[1];
    if (enabled) {
      assert.ok(pace, 'status bar receives a real numeric source snapshot');
      trusted(pace);
      assert.ok(Math.abs(result(pace).forecastPercent - 116) < 1e-10);
    } else assert.equal(pace, null, 'OFF withdraws the previously published snapshot');
    assert.equal(h.providers.length, deliveries + 1, 'actual syncProviderUi delivers while dashboard refresh is paused');
    assert.strictEqual(h.extension.cache, cache);
    assert.equal(cache.usageLimitsLastUpdate.getTime(), T);
    assert.strictEqual(h.extension.claudeQuotaPaceSource, owner, 'toggle must retain runtime continuity owner');
    assert.deepEqual(h.effects, []);
  }
  assert.equal(h.visibility.length, 3);
  assert.ok(h.quota.length >= 3, 'each toggle publishes cached quota');
});

for (const [enabled, tracking] of [[false, true], [true, false], [false, false]]) {
  test(`actual pace getter short-circuits before cache/client/clock/source when enabled=${enabled}, tracking=${tracking}`, () => {
    const h = harness(enabled, tracking);
    forbiddenAccess(h.extension, ['cache', 'apiClient', 'claudeQuotaPaceSource', 'quotaFingerprintSalt'], h.effects);
    assert.equal(withoutActivity(() => h.extension.getClaudeQuotaPaceSnapshot(), true), null);
    assert.deepEqual(h.effects, []);
    assert.equal(h.signalReads(), 0);
  });
}

test('actual owner emits 29/25 = 116% from original successful cache time and verified memory signal', () => {
  const h = harness();
  const usage = h.extension.cache.usageLimits;
  const value = snapshot(h.extension);
  trusted(value);
  assert.ok(h.signalReads() > 0, 'the client memory verification signal was consumed');
  assert.equal(value.observedAt, T);
  assert.equal(value.source, 'observed');
  assert.deepEqual(value.windows, [{ slot: 0, kind: 'weekly_all', usedPercent: 29, resetAt: RESET, periodMs: WEEK }]);
  const pace = result(value);
  assert.equal(pace.referencePercent, 25);
  assert.ok(Math.abs(pace.forecastPercent - 116) < 1e-10);
  assert.ok(Math.abs(pace.deviationPercentagePoints - 4) < 1e-10);
  assert.strictEqual(h.extension.cache.usageLimits, usage);
  assert.deepEqual(Object.keys(value).sort(), ['accountWindowTrust', 'observedAt', 'source', 'windows']);
  assert.deepEqual(Object.keys(value.windows[0]).sort(), ['kind', 'periodMs', 'resetAt', 'slot', 'usedPercent']);
  assert.deepEqual(h.effects, []);
});

test('actual owner salts the verified signal with existing stable-identity HMAC before handing it to source', () => {
  const h = harness();
  // Preseed an independently salted anchor. Trust can remain continuous only
  // if the actual extension passes this same provider-specific HMAC identity.
  h.extension.claudeQuotaPaceSource.project({ enabled: true, usage: raw(28), observedAt: T - MINUTE,
    verifiedAccountFingerprint: fingerprintForStableIdentity(SALT, 'claude', SIGNAL) });
  trusted(snapshot(h.extension));
  h.extension.quotaFingerprintSalt = 'different-fixture-salt';
  withheld(observe(h, raw(30), T + MINUTE));
});

test('actual owner cannot retimestamp the same live raw cache on repaint', () => {
  const h = harness();
  const first = snapshot(h.extension);
  const owner = h.extension.claudeQuotaPaceSource;
  const expected = result(first);
  // A zero cache time is a lifecycle retirement marker, not an ordinary repaint.
  for (const time of [T + 10 * MINUTE, T + 31 * MINUTE]) {
    h.extension.cache.usageLimitsLastUpdate = new Date(time);
    const repaint = snapshot(h.extension);
    assert.equal(repaint.observedAt, T);
    assert.deepEqual(result(repaint, T + 30 * MINUTE), expected, '30-minute inclusive limit retains original forecast');
    assert.deepEqual(result(repaint, T + 30 * MINUTE + 1), { status: 'unavailable', reason: 'stale-observation' });
    assert.equal(repaint.windows[0].usedPercent, 29);
    assert.strictEqual(h.extension.claudeQuotaPaceSource, owner);
  }
});

test('actual credential retirement withdraws old raw quota despite retained original time and verified signal', () => {
  const h = harness();
  const usage = h.extension.cache.usageLimits;
  const source = h.extension.claudeQuotaPaceSource;
  const seeded = source.project({ enabled: true, usage, observedAt: T,
    verifiedAccountFingerprint: fingerprintForStableIdentity(SALT, 'claude', SIGNAL) });
  trusted(seeded);
  h.extension.statusBar.updateQuota(usage, seeded);
  h.extension.claudeProfileGeneration = 4;
  h.extension.cache.usageLimitsFailStreak = 3;
  h.extension.cache.usageLimitsBackoffUntil = new Date(T + MINUTE);
  const refreshes: unknown[][] = [];
  // Hold the existing refresh service boundary pending. This is the same
  // bounded pattern used by extensionWindowActivity.test.ts; the lifecycle
  // handler itself is real and never launches a watcher, timer or OAuth call.
  Object.defineProperty(h.extension, 'refreshData', { configurable: true,
    value: (...args: unknown[]) => { refreshes.push(args); return Promise.resolve(); } });
  withoutActivity(() => h.extension.handleCredentialsChange());
  assert.deepEqual(refreshes, [[false, 'credentials']]);
  assert.equal(h.extension.claudeProfileGeneration, 5);
  assert.equal(h.extension.cache.usageLimitsLastUpdate.getTime(), 0);
  assert.equal(h.extension.cache.usageLimitsFailStreak, 0);
  assert.equal(h.extension.cache.usageLimitsBackoffUntil.getTime(), 0);
  const retiredUsage = h.extension.cache.usageLimits;
  assert.ok(retiredUsage === usage || retiredUsage === null, 'retirement may clear raw cache or retain it for display');
  // Neither the raw object's WeakMap timestamp nor the client's old memory
  // signal independently proves that the retired account is still current.
  assert.equal(h.extension.apiClient.getLastQuotaIdentitySignal(), SIGNAL);
  assert.equal(seeded.observedAt, T);
  assert.equal(h.quota[h.quota.length - 1][1] ?? null, null,
    'credential handler immediately withdraws the published pace while refresh is held');
  assert.equal(withoutActivity(() => h.extension.getClaudeQuotaPaceSnapshot()), null,
    'known credential retirement withdraws forecast before the new API success');
  const next = observe(h, raw(30), T + 10 * MINUTE);
  trusted(next);
  assert.equal(next.observedAt, T + 10 * MINUTE);
  assert.equal(next.windows[0].usedPercent, 30);
  assert.strictEqual(h.extension.claudeQuotaPaceSource, source, 'retirement preserves the continuity latch owner');
  assert.deepEqual(h.effects, []);
});

test('actual usage-source retirement clears cached quota and withdraws pace before any new API success', () => {
  const h = harness();
  const usage = h.extension.cache.usageLimits;
  const source = h.extension.claudeQuotaPaceSource;
  const seeded = source.project({ enabled: true, usage, observedAt: T,
    verifiedAccountFingerprint: fingerprintForStableIdentity(SALT, 'claude', SIGNAL) });
  trusted(seeded);
  h.extension.statusBar.updateUsageData = () => undefined;
  h.extension.statusBar.updateContext = () => undefined;
  withoutActivity(() => h.extension.selectClaudeUsageSource('/synthetic/weekly-pace-source-a'));
  assert.strictEqual(h.extension.cache.usageLimits, usage, 'initial source selection preserves the current cache');
  withoutActivity(() => h.extension.selectClaudeUsageSource('/synthetic/weekly-pace-source-b'));
  assert.equal(h.extension.cache.usageLimits, null, 'real source retirement clears the old raw response');
  assert.equal(h.quota[h.quota.length - 1][0], null);
  assert.equal(seeded.observedAt, T, 'old source metadata still exists but is no longer an eligible cache');
  assert.equal(withoutActivity(() => h.extension.getClaudeQuotaPaceSnapshot()), null);
  assert.strictEqual(h.extension.claudeQuotaPaceSource, source);
  assert.deepEqual(h.effects, []);
});

test('actual raw quota past its true reset is unavailable and never synthesized into zero', () => {
  const h = harness();
  const value = observe(h, raw(99), RESET - MINUTE);
  trusted(value);
  assert.deepEqual(result(value, RESET), { status: 'unavailable', reason: 'reset-passed' });
  h.extension.cache.usageLimitsLastUpdate = new Date(RESET);
  const repaint = snapshot(h.extension);
  assert.equal(repaint.observedAt, RESET - MINUTE);
  assert.equal(repaint.windows[0].usedPercent, 99);
  assert.equal(repaint.windows[0].resetAt, RESET);
  assert.deepEqual(result(repaint, RESET + MINUTE), { status: 'unavailable', reason: 'reset-passed' });
});

test('actual owner keeps unverified account unknown instead of borrowing profile/history continuity', () => {
  const h = harness();
  // These are deliberately plausible-looking but are not request verification.
  h.extension.activeClaudeQuotaFingerprint = fingerprintForStableIdentity(SALT, 'claude', SIGNAL);
  h.extension.cache.dataDirectory = '/synthetic/weekly-pace-fixture-profile';
  const value = observe(h, raw(), T, null);
  assert.equal(value.accountWindowTrust, 'unknown');
  assert.deepEqual(result(value), { status: 'unavailable', reason: 'untrusted-account-window' });
  h.setSignal(SIGNAL);
  assert.equal(snapshot(h.extension).accountWindowTrust, 'unknown', 'late signal cannot reattribute the same raw success');
  trusted(observe(h, raw(30), T + MINUTE));
  assert.deepEqual(h.effects, []);
});

test('actual owner withholds missing verified signal after trust until an ordinary rollover', () => {
  const h = harness();
  trusted(snapshot(h.extension));
  withheld(observe(h, raw(30), T + MINUTE, null));
  withheld(observe(h, raw(31), T + 2 * MINUTE));
  trusted(observe(h, raw(1, RESET + WEEK), RESET + 7 * 60 * MINUTE));
});

test('actual owner latches a usage drop across higher samples, repaint and OFF/tracking OFF', () => {
  const h = harness();
  trusted(observe(h, raw(40), T));
  const drop = raw(20);
  withheld(observe(h, drop, T + MINUTE));
  withheld(observe(h, drop, T + 2 * MINUTE));
  for (const key of ['showWeeklyQuotaPace', 'usageLimitTracking']) {
    h.settings[key] = false;
    assert.equal(withoutActivity(() => h.extension.getClaudeQuotaPaceSnapshot(), true), null);
    h.settings[key] = true;
    withheld(observe(h, raw(41), T + 3 * MINUTE));
  }
  withheld(observe(h, raw(1, RESET + 2 * WEEK), RESET + WEEK + 7 * 60 * MINUTE));
  trusted(observe(h, raw(1, RESET + WEEK), RESET + 7 * 60 * MINUTE));
});

test('actual owner withholds early reset drift and recovers only the original ordinary +7-day reset', () => {
  const h = harness();
  trusted(snapshot(h.extension));
  withheld(observe(h, raw(30, RESET + MINUTE), T + MINUTE));
  withheld(observe(h, raw(31), T + 2 * MINUTE));
  withheld(observe(h, raw(1, RESET + WEEK), RESET - 1));
  trusted(observe(h, raw(1, RESET + WEEK), RESET + 7 * 60 * MINUTE));
});

test('actual owner retains account-change pending anchor until that verified account rolls over', () => {
  const h = harness();
  trusted(observe(h, raw(40), T));
  const pendingReset = RESET + 2 * 60 * MINUTE;
  withheld(observe(h, raw(20, pendingReset), T + MINUTE, OTHER_SIGNAL));
  withheld(observe(h, raw(30, pendingReset), T + 2 * MINUTE, OTHER_SIGNAL));
  withheld(observe(h, raw(1, pendingReset + WEEK), pendingReset - 1, OTHER_SIGNAL));
  trusted(observe(h, raw(1, pendingReset + WEEK), pendingReset + 7 * 60 * MINUTE, OTHER_SIGNAL));
});

for (const [name, oldSource, newSource] of [
  ['generic to legacy', raw, legacy], ['legacy to generic', legacy, raw],
] as const) {
  test(`actual owner withholds verified ${name} substitution until the new source rolls over`, () => {
    const h = harness();
    trusted(observe(h, oldSource(40), T));
    withheld(observe(h, newSource(20), T + MINUTE));
    withheld(observe(h, newSource(30), T + 2 * MINUTE));
    trusted(observe(h, newSource(1, RESET + WEEK), RESET + 7 * 60 * MINUTE));
  });
}

test('actual owner keeps malformed raw percent unavailable instead of normalization fallback zero', () => {
  const h = harness();
  const usage = raw();
  delete usage.limits![0].percent;
  const value = observe(h, usage, T);
  assert.ok(Number.isNaN(value.windows[0].usedPercent));
  assert.equal(value.accountWindowTrust, 'unknown');
  assert.deepEqual(result(value), { status: 'unavailable', reason: 'untrusted-account-window' });
});
