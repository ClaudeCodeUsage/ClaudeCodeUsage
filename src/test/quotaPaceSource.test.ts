import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { adaptClaudeQuotaPace, adaptCodexQuotaPace } from '../quotaPaceAdapters';
import { normalizeQuotaWindows } from '../quotaWindows';

// Deliberately runtime-loaded so the red run proves the source is absent.
const source = (): any => require('../quotaPaceSource');
const WEEK = 7 * 24 * 60 * 60_000;
const START = Date.parse('2026-10-01T00:00:00Z');
const RESET = START + WEEK;
const T = START + WEEK / 4;
const ACCOUNT = `acct_${'a'.repeat(32)}`;
const OTHER_ACCOUNT = `acct_${'b'.repeat(32)}`;
const iso = (time: number): string => new Date(time).toISOString();
const row = (percent: any = 29, reset = RESET): any => ({ kind: 'weekly_all', group: 'weekly', percent, resets_at: iso(reset) });
const raw = (percent: any = 29, reset = RESET): any => ({ limits: [row(percent, reset)] });
const legacy = (percent: any = 29, reset = RESET): any => ({ seven_day: { utilization: percent, resets_at: iso(reset) } });
const project = (owner: any, usage: any = raw(), observedAt: any = T, fingerprint: any = ACCOUNT): any =>
  owner.project({ enabled: true, usage, observedAt, verifiedAccountFingerprint: fingerprint });
const adapted = (snapshot: any, now = T): any[] => adaptClaudeQuotaPace({ enabled: true, now, snapshot });
const owner = (): any => new (source().ClaudeQuotaPaceSource)();

test('original Claude observation projects 29/25 = 116%, with numeric/enum DTO only', () => {
  const snapshot = project(owner());
  assert.equal(snapshot.accountWindowTrust, 'trusted');
  assert.equal(snapshot.source, 'observed');
  assert.equal(snapshot.observedAt, T);
  const result: any = adapted(snapshot)[0].result;
  assert.equal(result.status, 'ready');
  assert.ok(Math.abs(result.forecastPercent - 116) < 1e-10);
  assert.equal(result.referencePercent, 25);
  assert.deepEqual(Object.keys(snapshot).sort(), ['accountWindowTrust', 'observedAt', 'source', 'windows']);
  assert.deepEqual(Object.keys(snapshot.windows[0]).sort(), ['kind', 'periodMs', 'resetAt', 'slot', 'usedPercent']);
  assert.ok(!JSON.stringify(snapshot).includes(ACCOUNT));
});

test('same raw response retains its first original timestamp, even after another response', () => {
  const state = owner();
  const usage = raw();
  const first = project(state, usage);
  assert.equal(project(state, usage, T + 10 * 60_000).observedAt, T);
  assert.equal(adapted(first, T + 30 * 60_000)[0].result.status, 'ready');
  assert.equal(adapted(project(state, usage, T + 31 * 60_000), T + 31 * 60_000)[0].result.reason, 'stale-observation');
  project(state, raw(30), T + 60_000);
  const replay = project(state, usage, T + 120_000);
  assert.equal(replay.observedAt, T);
  assert.equal(replay.accountWindowTrust, 'discontinuous');
});

test('cold start suppresses forecasting until exactly six hours and expired rows never become zero', () => {
  for (const elapsed of [0, 6 * 60 * 60_000 - 1, 6 * 60 * 60_000]) {
    const time = START + elapsed;
    assert.equal(adapted(project(owner(), raw(), time), time)[0].result.status,
      elapsed < 6 * 60 * 60_000 ? 'insufficient-sample' : 'ready');
  }
  const snapshot = project(owner(), raw(99));
  assert.equal(adapted(snapshot, RESET)[0].result.reason, 'reset-passed');
  assert.equal(snapshot.windows[0].usedPercent, 99);
});

test('OFF touches no source getters and preserves the existing latch and time state', () => {
  const state = owner();
  project(state);
  project(state, raw(28), T + 60_000);
  const trap: any = { enabled: false };
  for (const key of ['usage', 'observedAt', 'verifiedAccountFingerprint', 'snapshot']) {
    Object.defineProperty(trap, key, { get(): never { throw new Error(`OFF read ${key}`); } });
  }
  assert.equal(state.project(trap), null);
  assert.equal(source().projectCodexQuotaPaceSource(trap), null);
  const unseen = raw(31);
  assert.equal(state.project({ enabled: false, usage: unseen, observedAt: T + 2 * 60_000 }), null);
  assert.equal(project(state, unseen, T + 3 * 60_000).observedAt, T + 3 * 60_000);
  assert.equal(project(state, raw(32), T + 4 * 60_000).accountWindowTrust, 'discontinuous');
});

test('generic and legacy weekly rows retain sorted normalized slots including session', () => {
  const usage: any = { limits: [
    { ...row(40), kind: 'weekly_scoped', scope: { model: { id: 'model-opus', display_name: 'Opus' } } },
    row(),
    { kind: 'session', percent: 12, resets_at: iso(T + 60_000) },
    { ...row(50), kind: 'weekly_scoped', scope: { surface: 'code' } },
  ] };
  const snapshot = project(owner(), usage);
  assert.equal(snapshot.accountWindowTrust, 'trusted');
  assert.deepEqual(adapted(snapshot).map(x => [x.slot, x.kind]), [[1, 'weekly_all'], [2, 'weekly_scoped'], [3, 'weekly_scoped']]);
  assert.deepEqual(normalizeQuotaWindows(usage).map(x => x.utilization), snapshot.windows.map((x: any) => x.usedPercent));
  const old = legacy(29.25);
  old.five_hour = { utilization: 4, resets_at: iso(T + 60_000) };
  old.seven_day_opus = { utilization: 40, resets_at: iso(RESET) };
  old.seven_day_sonnet = { utilization: 50, resets_at: iso(RESET) };
  const oldSnapshot = project(owner(), old);
  assert.equal(oldSnapshot.accountWindowTrust, 'trusted');
  assert.deepEqual(adapted(oldSnapshot).map(x => [x.slot, x.kind]), [[1, 'weekly_all'], [2, 'weekly_scoped'], [3, 'weekly_scoped']]);
  assert.equal(oldSnapshot.windows[1].usedPercent, 29.25);
});

test('raw invalid percentages cannot fall through normalization into trustworthy zero', () => {
  for (const value of [null, '29', '', NaN, Infinity, -1, 101, undefined]) {
    for (const usage of [raw(value), legacy(value)]) {
      // Default fixture parameters otherwise turn undefined into valid 29.
      if (usage.limits) usage.limits[0].percent = value;
      else usage.seven_day.utilization = value;
      const snapshot = project(owner(), usage);
      assert.ok(Number.isNaN(snapshot.windows[0].usedPercent));
      assert.notEqual(snapshot.accountWindowTrust, 'trusted');
      assert.equal(adapted(snapshot)[0].result.status, 'unavailable');
    }
  }
  for (const value of [0, 100]) assert.equal(project(owner(), raw(value)).accountWindowTrust, 'trusted');
});

test('unknown generic kinds, missing resets, duplicates and missing scopes fail closed', () => {
  const cases: any[] = [
    { limits: [{ ...row(), kind: 'future_weekly' }] },
    { limits: [{ ...row(), resets_at: null }] },
    { limits: [{ ...row(), resets_at: 'not-a-date' }] },
    { limits: [row(), row(40)] },
    { limits: [{ ...row(), kind: 'weekly_scoped' }] },
    { limits: [0, null] },
    { limits: [undefined] },
    { limits: [{ ...row(), kind: 'weekly_scoped', scope: { surface: 'code' } },
      { ...row(40), kind: 'weekly_scoped', scope: { surface: 'code' } }] },
    // Display normalizer's legacy fallback cannot establish source authority.
    { ...legacy(), limits: [{ kind: 'future_unknown', percent: 99 }] },
  ];
  for (const usage of cases) {
    const snapshot = project(owner(), usage);
    assert.notEqual(snapshot.accountWindowTrust, 'trusted');
    assert.ok(adapted(snapshot).every(x => x.result.status === 'unavailable'));
  }
});

test('only verified HMAC input can establish account trust, never token, ID or profile path', () => {
  for (const fingerprint of [null, undefined, '', 'raw-account-id', '/profile', 'oauth-token']) {
    assert.notEqual(project(owner(), raw(), T, fingerprint === undefined ? null : fingerprint).accountWindowTrust, 'trusted');
  }
});

test('decline latch survives repaint, higher new response and OFF; ordinary rollover recovers', () => {
  const state = owner();
  project(state, raw(40));
  const dropped = raw(20);
  assert.equal(project(state, dropped, T + 60_000).accountWindowTrust, 'discontinuous');
  assert.equal(project(state, dropped, T + 120_000).accountWindowTrust, 'discontinuous');
  assert.equal(project(state, raw(41), T + 180_000).accountWindowTrust, 'discontinuous');
  const next = project(state, raw(1, RESET + WEEK), RESET + 7 * 60 * 60_000);
  assert.equal(next.accountWindowTrust, 'trusted');
  assert.equal(adapted(next, next.observedAt)[0].result.status, 'ready');
});

test('same-identity early resets and drops retain the original good anchor', () => {
  const mutations = [
    (state: any): void => { project(state, raw(30, RESET + 60_000), T + 60_000); },
    (state: any): void => { project(state, raw(30, RESET + WEEK), T + 60_000); },
    (state: any): void => { project(state, raw(null), T + 60_000); },
    (state: any): void => { project(state, raw(30), T - 60_000); },
    (state: any): void => { project(state, raw(30), T); },
    (state: any): void => { project(state, raw(30), T + 60_000, null); },
  ];
  for (const mutate of mutations) {
    const state = owner();
    project(state);
    mutate(state);
    assert.equal(project(state, raw(35), T + 120_000).accountWindowTrust, 'discontinuous');
    assert.equal(project(state, raw(1, RESET + 2 * WEEK), RESET + WEEK + 60_000).accountWindowTrust, 'discontinuous');
    assert.equal(project(state, raw(1, RESET + WEEK), RESET + 60_000).accountWindowTrust, 'trusted');
  }
  const state = owner();
  const scoped = (id: string, reset = RESET): any => ({ limits: [row(29, reset),
    { ...row(30, reset), kind: 'weekly_scoped', scope: { model: { id, display_name: 'Same label' } } }] });
  project(state, scoped('scope-a'));
  assert.equal(project(state, scoped('scope-b'), T + 60_000).accountWindowTrust, 'discontinuous');
  assert.equal(project(state, scoped('scope-b'), T + 120_000).accountWindowTrust, 'discontinuous');
});

test('a verified changed account remains discontinuous until its own ordinary rollover', () => {
  const state = owner();
  project(state, raw(40));
  const pendingReset = RESET + 2 * 60 * 60_000;
  const changed = raw(20, pendingReset);
  assert.equal(project(state, changed, T + 60_000, OTHER_ACCOUNT).accountWindowTrust, 'discontinuous');
  assert.equal(project(state, changed, T + 120_000, OTHER_ACCOUNT).accountWindowTrust, 'discontinuous');
  assert.equal(project(state, raw(30, pendingReset), T + 180_000, OTHER_ACCOUNT).accountWindowTrust, 'discontinuous');
  assert.equal(project(state, raw(1, pendingReset + WEEK), pendingReset - 1, OTHER_ACCOUNT).accountWindowTrust, 'discontinuous');
  const recovered = project(state, raw(1, pendingReset + WEEK), pendingReset, OTHER_ACCOUNT);
  assert.equal(recovered.accountWindowTrust, 'trusted');
  assert.equal(adapted(recovered, pendingReset)[0].result.status, 'insufficient-sample');
  assert.equal(project(state, raw(2, pendingReset + WEEK), pendingReset + 7 * 60 * 60_000, OTHER_ACCOUNT).accountWindowTrust, 'trusted');
});

test('a verified generic/legacy source change recovers only after the new source rollover', () => {
  for (const [oldSource, newSource] of [[raw, legacy], [legacy, raw]]) {
    const state = owner();
    project(state, oldSource(40));
    assert.equal(project(state, newSource(20), T + 60_000).accountWindowTrust, 'discontinuous');
    assert.equal(project(state, newSource(30), T + 120_000).accountWindowTrust, 'discontinuous');
    const recovered = project(state, newSource(1, RESET + WEEK), RESET + 7 * 60 * 60_000);
    assert.equal(recovered.accountWindowTrust, 'trusted');
    assert.equal(adapted(recovered, recovered.observedAt)[0].result.status, 'ready');
  }
});

test('changed scoped identity and row additions/removals recover after the pending rowset rolls over', () => {
  const scoped = (ids: readonly string[], percent: number, reset: number): any => ({ limits: [row(percent, reset),
    ...ids.map(id => ({ ...row(percent, reset), kind: 'weekly_scoped', scope: { model: { id, display_name: 'Same label' } } }))] });
  for (const [oldIds, newIds] of [[['a'], ['b']], [[], ['b']], [['a', 'b'], ['b']]]) {
    const state = owner();
    project(state, scoped(oldIds, 40, RESET));
    assert.equal(project(state, scoped(newIds, 20, RESET), T + 60_000).accountWindowTrust, 'discontinuous');
    assert.equal(project(state, scoped(newIds, 30, RESET), T + 120_000).accountWindowTrust, 'discontinuous');
    const recovered = project(state, scoped(newIds, 1, RESET + WEEK), RESET + 7 * 60 * 60_000);
    assert.equal(recovered.accountWindowTrust, 'trusted');
    assert.ok(adapted(recovered, recovered.observedAt).every(entry => entry.result.status === 'ready'));
  }
});

test('pending-identity drop/early reset cannot rebase its recovery anchor', () => {
  for (const changedSource of [raw, legacy]) {
    for (const changedAccount of [ACCOUNT, OTHER_ACCOUNT]) {
      if (changedSource === raw && changedAccount === ACCOUNT) continue;
      const state = owner();
      project(state, raw(40));
      project(state, changedSource(30), T + 60_000, changedAccount);
      const driftReset = RESET + 60_000;
      assert.equal(project(state, changedSource(20, driftReset), T + 120_000, changedAccount).accountWindowTrust, 'discontinuous');
      assert.equal(project(state, changedSource(31, driftReset), T + 180_000, changedAccount).accountWindowTrust, 'discontinuous');
      assert.equal(project(state, changedSource(1, driftReset + WEEK), driftReset + 60_000, changedAccount).accountWindowTrust, 'discontinuous');
      assert.equal(project(state, changedSource(1, RESET + WEEK), RESET + 7 * 60 * 60_000, changedAccount).accountWindowTrust, 'trusted');
    }
  }
});

test('OFF preserves pending identity and cannot seed or rebase pending recovery', () => {
  const state = owner();
  project(state);
  project(state, raw(30), T + 60_000, OTHER_ACCOUNT);
  const trap: any = { enabled: false };
  for (const key of ['usage', 'observedAt', 'verifiedAccountFingerprint']) {
    Object.defineProperty(trap, key, { get(): never { throw new Error(`OFF pending read ${key}`); } });
  }
  assert.equal(state.project(trap), null);
  assert.equal(state.project({ enabled: false, usage: raw(1, RESET + 60_000),
    observedAt: T + 120_000, verifiedAccountFingerprint: OTHER_ACCOUNT }), null);
  assert.equal(project(state, raw(1, RESET + WEEK), RESET, OTHER_ACCOUNT).accountWindowTrust, 'trusted');
  const unseeded = owner();
  project(unseeded);
  unseeded.project({ enabled: false, usage: raw(30), observedAt: T + 60_000, verifiedAccountFingerprint: OTHER_ACCOUNT });
  assert.equal(project(unseeded, raw(1, RESET + WEEK), RESET, OTHER_ACCOUNT).accountWindowTrust, 'discontinuous');
});

test('malformed or unverified changed sources cannot seed rollover recovery', () => {
  for (const [usage, account] of [[raw(null), OTHER_ACCOUNT], [legacy(null), ACCOUNT], [legacy(), null]]) {
    const state = owner();
    project(state);
    assert.equal(project(state, usage, T + 60_000, account).accountWindowTrust, 'discontinuous');
    const next = usage.limits ? raw(1, RESET + WEEK) : legacy(1, RESET + WEEK);
    assert.equal(project(state, next, RESET, account ?? ACCOUNT).accountWindowTrust, 'discontinuous');
  }
});

test('projection is bounded before getters beyond sixteen and does not read secrets or own clock', () => {
  const oversized: any[] = Array(17);
  Object.defineProperty(oversized, 16, { get(): never { throw new Error('unbounded read'); } });
  const usage: any = { limits: oversized };
  for (const key of ['accessToken', 'accountId', 'spend', 'extra_usage', 'seven_day']) {
    Object.defineProperty(usage, key, { get(): never { throw new Error(`unrelated read ${key}`); } });
  }
  const clock = Date.now;
  Date.now = (): never => { throw new Error('source has no clock'); };
  try {
    const snapshot = project(owner(), usage);
    assert.equal(snapshot.accountWindowTrust, 'ambiguous');
    assert.ok(snapshot.windows.length <= 16);
    assert.equal(project(owner()).accountWindowTrust, 'trusted');
  } finally { Date.now = clock; }
});

test('returned DTO mutation cannot change internal continuity', () => {
  const state = owner();
  const snapshot = project(state, raw(40));
  try { snapshot.windows[0].usedPercent = 0; } catch { /* frozen DTO is also acceptable */ }
  try { snapshot.accountWindowTrust = 'unknown'; } catch { /* likewise */ }
  assert.equal(project(state, raw(30), T + 60_000).accountWindowTrust, 'discontinuous');
});

test('Codex projects numeric weekly slots with unknown trust, ignoring limit/path/account guesses', () => {
  const snapshot: any = { provider: 'codex', source: 'local-log', confidence: 'last-observed',
    observedAt: T, limitId: 'same-account?', windows: [
      { usedPercent: 8, windowMinutes: 300, resetsAt: T + 60_000 },
      { usedPercent: 29, windowMinutes: 10080, resetsAt: RESET },
    ] };
  for (const key of ['limitId', 'limitName', 'accountFingerprint', 'path', 'credits']) {
    Object.defineProperty(snapshot, key, { get(): never { throw new Error(`identity guess ${key}`); }, configurable: true });
  }
  const projected = source().projectCodexQuotaPaceSource({ enabled: true, snapshot });
  assert.equal(projected.observedAt, T);
  assert.equal(projected.accountWindowTrust, 'unknown');
  assert.deepEqual(projected.windows.map((x: any) => [x.slot, x.kind, x.periodMs]), [[0, 'other', 300 * 60_000], [1, 'weekly_all', WEEK]]);
  assert.equal(adaptCodexQuotaPace({ enabled: true, now: T, snapshot: projected })[0].result.status, 'unavailable');
  snapshot.windows[1].usedPercent = '29';
  assert.ok(Number.isNaN(source().projectCodexQuotaPaceSource({ enabled: true, snapshot }).windows[1].usedPercent));
  snapshot.windows = Array(17);
  assert.ok(source().projectCodexQuotaPaceSource({ enabled: true, snapshot }).windows.length <= 16);
});
