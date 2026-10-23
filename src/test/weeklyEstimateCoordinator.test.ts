import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WeeklyEstimateCoordinator, WeeklyEstimateDisplayEntry } from '../weeklyEstimateCoordinator';
import { WeeklyEstimateArchive, WeeklyEstimateInput } from '../weeklyEstimateArchive';
import { buildLocalWeeklyEstimates } from '../weeklyEstimate';
import * as estimateProducer from '../weeklyEstimate';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';
import type { WeeklyValueInputs } from '../weeklyValue';
import { fingerprintForStableIdentity } from '../quotaObservationStore';

const DAY = 86_400_000, RESET = 1_800_000_000_000, OBSERVED = RESET - DAY, NOW = OBSERVED + 1000;
const SALT = 'synthetic-coordinator-salt', SOURCE = 'synthetic-source-a';
const options = { sourceNamespace: SOURCE, pricingVersion: 'api-equivalent-v1', now: NOW };
function inputs(): WeeklyValueInputs {
  // Keep the existing persistence fixtures source-less: they exercise legacy rough/paired snapshots.
  return { observations: [{ provider: 'codex', seriesKey: 'raw-series-canary',
    resetAt: RESET, observedAt: OBSERVED, usedPercent: 40 }],
  usage: [{ timestamp: OBSERVED - 1000, equivalentUsd: 40, pricedTokens: 100, totalTokens: 100 }] };
}
function stored(): WeeklyEstimateInput {
  return { ...buildLocalWeeklyEstimates('codex', inputs(), { now: NOW })[0], pricingVersion: options.pricingVersion };
}
function snapshot(overrides: Partial<LocalWeeklyEstimate> = {}): LocalWeeklyEstimate {
  return { provider: 'codex', windowStart: RESET - 7 * DAY, resetAt: RESET, observedAt: OBSERVED,
    estimatedAt: NOW, usedEquivalentUsd: 40, fullEquivalentUsd: 100, unusedEquivalentUsd: 60,
    utilizationPercent: 40, pricingCoverage: 1, method: 'legacy-prefix-ratio',
    flags: ['account-unattributed', 'reconstructed'], ...overrides };
}
function roughSnapshot(overrides: Partial<LocalWeeklyEstimate> = {}): LocalWeeklyEstimate {
  return snapshot({ method: 'rough-prefix-v2', ...overrides });
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-estimate-coordinator-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, file: path.join(root, 'weekly-estimates-v1.json') };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('extra Codex accounts keep same-reset A-B-A identities, stable labels and private keys across reload', async t => {
  const { file } = await fixture(t), a = 'a'.repeat(64), b = 'b'.repeat(64);
  const empty = { usage: [], observations: [] };
  const extra = (key: string, fullEquivalentUsd = 100): LocalWeeklyEstimate => ({
    ...snapshot(), method: 'account-delta-v1', accountScopeKey: key, fullEquivalentUsd,
    // This fixture tests account isolation and persistence, not admission of an
    // incomplete/excluded numerator. Its priced and linked evidence is usable.
    unusedEquivalentUsd: fullEquivalentUsd * .6, pricingCoverage: 1,
    unlinkedEquivalentUsd: 0, linkedSourceCount: 2, flags: ['account-unattributed'],
  });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  for (const [key, number] of [[a, 1], [b, 2], [a, 1]] as const) {
    const opts = { ...options, accountEstimates: [extra(key)], activeAccountScopeKey: key };
    const pending = coordinator.project('codex', empty, opts);
    assert.doesNotMatch(JSON.stringify(pending), /accountScopeKey|[a-f0-9]{64}/);
    await coordinator.flush();
    const projection = coordinator.project('codex', empty, opts);
    assert.equal(projection.activeAccountNumber, number);
    assert.ok(projection.entries.some(row => row.accountNumber === number));
    assert.doesNotMatch(JSON.stringify(projection), /accountScopeKey|sourceKey|windowKey|[a-f0-9]{64}/);
  }
  const archived = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.equal(archived.length, 2);
  assert.deepEqual(archived.map(row => row.accountScopeKey), [a, b]);
  const restart = new WeeklyEstimateCoordinator(file, SALT);
  const opts = { ...options, activeAccountScopeKey: b };
  restart.project('codex', empty, opts); await restart.flush();
  const reloaded = restart.project('codex', empty, opts);
  assert.equal(reloaded.entries.length, 2);
  assert.deepEqual(reloaded.entries.map(row => row.accountNumber).sort(), [1, 2]);
  assert.equal(reloaded.activeAccountNumber, 2);
  assert.ok(reloaded.entries.every(row => row.unlinkedEquivalentUsd === 0 && row.linkedSourceCount === 2));
  assert.doesNotMatch(JSON.stringify(reloaded), /accountScopeKey|[a-f0-9]{64}/);
});

test('incomplete or excluded account-delta capacity is withheld and never archived as monetary evidence', async t => {
  const empty = { usage: [], observations: [] }, key = 'a'.repeat(64);
  for (const extra of [
    { pricingCoverage: .25, flags: ['partial-pricing'] },
    { unlinkedEquivalentUsd: 7 }, { flags: ['partial-history'] },
  ] as Partial<LocalWeeklyEstimate>[]) {
    const { file } = await fixture(t), coordinator = new WeeklyEstimateCoordinator(file, SALT);
    const entry = snapshot({ method: 'account-delta-v1', accountScopeKey: key, linkedSourceCount: 2, ...extra });
    const opts = { ...options, accountEstimates: [entry], activeAccountScopeKey: key };
    const before = JSON.stringify(entry), projected = coordinator.project('codex', empty, opts);
    assert.equal(projected.entries.length, 1);
    assert.equal(projected.entries[0].fullEquivalentUsd, null);
    assert.equal(projected.entries[0].unusedEquivalentUsd, null);
    await coordinator.flush();
    assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntries, 0);
    assert.equal(JSON.stringify(entry), before);
    assert.doesNotMatch(JSON.stringify(coordinator.project('codex', empty, opts)), /accountScopeKey|[a-f0-9]{64}/);
  }
});

test('frozen account prices keep their capture version while newly produced estimates use current pricing', async t => {
  const { file } = await fixture(t), key = 'a'.repeat(64), data = inputs();
  const frozen: WeeklyEstimateDisplayEntry = {
    ...snapshot({ method: 'account-delta-v1', accountScopeKey: key }), pricingVersion: 'api-v1',
  };
  const accountEstimates: readonly WeeklyEstimateDisplayEntry[] = [frozen], before = JSON.stringify(accountEstimates);
  const original = WeeklyEstimateArchive.prototype.record;
  let accountRecords = 0;
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', function(this: WeeklyEstimateArchive,
    ...args: Parameters<WeeklyEstimateArchive['record']>) {
    if (args[0].accountScopeKey === key) accountRecords++;
    return original.apply(this, args);
  });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const first = { ...options, pricingVersion: 'api-v1', accountEstimates, activeAccountScopeKey: key };
  coordinator.project('codex', data, first); await coordinator.flush();
  const archive = new WeeklyEstimateArchive(file, SALT, SOURCE);
  const saved = (await archive.load()).entries.find(entry => entry.accountScopeKey === key)!;
  assert.equal(saved.pricingVersion, 'api-v1'); assert.equal(accountRecords, 1);
  const changed = { ...first, pricingVersion: 'api-v2' };
  const updated = coordinator.project('codex', data, changed);
  assert.equal(updated.entries.find(entry => entry.accountNumber === 1)!.pricingVersion, 'api-v1');
  assert.equal(updated.entries.find(entry => entry.accountNumber === undefined)!.pricingVersion, 'api-v2');
  await coordinator.flush();
  const entries = (await archive.load()).entries, scoped = entries.filter(entry => entry.accountScopeKey === key);
  assert.deepEqual(scoped, [saved]); assert.equal(accountRecords, 1);
  assert.ok(entries.some(entry => entry.accountScopeKey === undefined && entry.pricingVersion === 'api-v2'));
  assert.equal(JSON.stringify(accountEstimates), before);
  const restart = new WeeklyEstimateCoordinator(file, SALT);
  restart.project('codex', data, changed); await restart.flush();
  assert.equal(restart.project('codex', data, changed).entries.find(entry => entry.accountNumber === 1)!.pricingVersion, 'api-v1');
  assert.equal(accountRecords, 1, 'reload acknowledges the frozen version instead of repricing it');
});

test('extra account estimates fall back to current pricing only when the capture version is absent', async t => {
  const { file } = await fixture(t), empty = { usage: [], observations: [] };
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const legacy = snapshot({ method: 'account-delta-v1', accountScopeKey: 'a'.repeat(64) });
  const invalid = { ...legacy, accountScopeKey: 'b'.repeat(64), pricingVersion: '/private/raw-version' };
  const opts = { ...options, pricingVersion: 'api-v2', accountEstimates: [legacy, invalid] };
  const projected = coordinator.project('codex', empty, opts); await coordinator.flush();
  assert.equal(projected.entries.length, 1); assert.equal(projected.entries[0].pricingVersion, 'api-v2');
  const saved = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.equal(saved.length, 1); assert.equal(saved[0].pricingVersion, 'api-v2');
});

test('active identity without calibration reserves no ordinal before B1 then A2 are persisted', async t => {
  const { file, root } = await fixture(t), a = 'a'.repeat(64), b = 'b'.repeat(64);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT), empty = { observations: [], usage: [] };
  const account = (accountScopeKey: string): WeeklyEstimateDisplayEntry => ({
    ...snapshot({ method: 'account-delta-v1', accountScopeKey, quotaEpoch: {
      startedAt: OBSERVED - 120_000, resetAnchorAt: RESET, startLowerAt: null, reason: 'initial',
    } }), pricingVersion: 'api-v1',
  });
  const identified = { ...options, activeAccountScopeKey: a };
  assert.equal(coordinator.project('codex', empty, identified).activeAccountNumber, undefined);
  await coordinator.flush();
  assert.equal(coordinator.project('codex', empty, identified).activeAccountNumber, undefined);
  assert.deepEqual(await readdir(root), [], 'identity-only display creates no persistent identity or fake estimate');
  const calibratedB = { ...options, accountEstimates: [account(b)], activeAccountScopeKey: b };
  assert.equal(coordinator.project('codex', empty, calibratedB).activeAccountNumber, 1);
  await coordinator.flush();
  assert.equal(coordinator.project('codex', empty, calibratedB).activeAccountNumber, 1);
  const backToA = { ...calibratedB, activeAccountScopeKey: a };
  assert.equal(coordinator.project('codex', empty, backToA).activeAccountNumber, undefined);
  const withheldA = { ...backToA, accountEstimates: [account(b), {
    ...account(a), fullEquivalentUsd: null, unusedEquivalentUsd: null,
  }] };
  const withheld = coordinator.project('codex', empty, withheldA); await coordinator.flush();
  // Identity-only display above still reserves nothing. A real account/epoch
  // checkpoint is now durable even before the cycle acquires a monetary fit.
  assert.equal(withheld.activeAccountNumber, 2);
  assert.equal(withheld.entries.find(entry => entry.fullEquivalentUsd === null)!.accountNumber, 2);
  const checkpointArchive = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.deepEqual(checkpointArchive.map(entry => [entry.accountScopeKey, entry.accountNumber, entry.fullEquivalentUsd]),
    [[b, 1, 100], [a, 2, null]]);
  const pendingRestart = new WeeklyEstimateCoordinator(file, SALT);
  pendingRestart.project('codex', empty, identified); await pendingRestart.flush();
  const restoredPending = pendingRestart.project('codex', empty, identified);
  assert.equal(restoredPending.activeAccountNumber, 2);
  assert.equal(restoredPending.entries.find(entry => entry.accountNumber === 2)!.fullEquivalentUsd, null);
  assert.equal(restoredPending.entries.find(entry => entry.accountNumber === 2)!.quotaEpoch?.startedAt, OBSERVED - 120_000);
  assert.doesNotMatch(JSON.stringify(restoredPending), /accountScopeKey|[a-f0-9]{64}/);
  const calibratedA = { ...backToA, accountEstimates: [account(b), account(a)] };
  coordinator.project('codex', empty, calibratedA); await coordinator.flush();
  const view = coordinator.project('codex', empty, calibratedA);
  assert.equal(view.activeAccountNumber, 2);
  assert.deepEqual(view.entries.map(entry => entry.accountNumber).sort(), [1, 2]);
  const archived = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.deepEqual(archived.filter(entry => entry.fullEquivalentUsd !== null)
    .map(entry => [entry.accountScopeKey, entry.accountNumber]), [[b, 1], [a, 2]]);
  assert.ok(archived.some(entry => entry.accountScopeKey === a && entry.accountNumber === 2 && entry.fullEquivalentUsd === null));
  assert.doesNotMatch(JSON.stringify(view), /accountScopeKey|[a-f0-9]{64}/);
});

test('pending live ordinals reconcile against canonical loaded accounts without collisions', async t => {
  const { file } = await fixture(t), a = 'a'.repeat(64), b = 'b'.repeat(64);
  const archive = new WeeklyEstimateArchive(file, SALT, SOURCE);
  await archive.record({ ...snapshot({ method: 'account-delta-v1', accountScopeKey: b }), pricingVersion: 'api-v1' });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT), empty = { observations: [], usage: [] };
  const opts = { ...options, activeAccountScopeKey: a, accountEstimates: [{
    ...snapshot({ method: 'account-delta-v1', accountScopeKey: a }), pricingVersion: 'api-v1',
  }] };
  assert.equal(coordinator.project('codex', empty, opts).activeAccountNumber, 1, 'live calibration may have a temporary pre-load ordinal');
  await coordinator.flush();
  const reconciled = coordinator.project('codex', empty, opts);
  assert.equal(reconciled.activeAccountNumber, 2);
  assert.deepEqual(reconciled.entries.map(entry => entry.accountNumber).sort(), [1, 2]);
  assert.equal(coordinator.project('codex', empty, { ...opts, activeAccountScopeKey: b }).activeAccountNumber, 1);
});

test('uncalibrated active identities stay unnumbered while bound/unbound estimates cannot overwrite each other', async t => {
  const { file } = await fixture(t), a = 'a'.repeat(64), b = 'b'.repeat(64);
  const bound = { ...roughSnapshot(), accountScopeKey: a };
  const archive = new WeeklyEstimateArchive(file, SALT, SOURCE);
  await archive.record({ ...bound, pricingVersion: options.pricingVersion });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT), data = inputs();
  const opts = { ...options, accountEstimates: [bound], activeAccountScopeKey: b };
  coordinator.project('codex', data, opts); await coordinator.flush();
  const projection = coordinator.project('codex', data, opts);
  assert.equal(projection.activeAccountNumber, undefined);
  assert.ok(projection.entries.some(row => row.accountNumber === 1));
  assert.ok(projection.entries.some(row => row.accountNumber === undefined));
  const switched = coordinator.project('codex', data, { ...opts, activeAccountScopeKey: a });
  assert.equal(switched.activeAccountNumber, 1);
  const claude = coordinator.project('claude', { usage: [], observations: [] }, opts);
  await coordinator.flush();
  assert.equal(claude.entries.length, 0);
  assert.equal(claude.activeAccountNumber, undefined);
});

test('scoped extra estimates are acknowledged without warm I/O and remain fenced after a clear race', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { file } = await fixture(t), key = 'c'.repeat(64), empty = { usage: [], observations: [] };
  const extra: LocalWeeklyEstimate = { ...roughSnapshot(), method: 'series-prefix-v1', accountScopeKey: key,
    // A write-race fixture must reach record(); incomplete admission is tested
    // separately and must not strand the entered/release synchronization.
    pricingCoverage: 1, unlinkedEquivalentUsd: 0, linkedSourceCount: 1, flags: ['account-unattributed'] };
  const opts = { ...options, accountEstimates: [extra], activeAccountScopeKey: key };
  const original = WeeklyEstimateArchive.prototype.record;
  let records = 0;
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', function(this: WeeklyEstimateArchive,
    ...args: Parameters<WeeklyEstimateArchive['record']>) { records++; return original.apply(this, args); });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', empty, opts); await coordinator.flush();
  assert.equal(records, 1);
  for (let i = 1; i <= 3; i++) {
    coordinator.project('codex', empty, { ...opts, accountEstimates: [{ ...extra }], now: NOW + i * 60_000 });
    await coordinator.flush();
  }
  assert.equal(records, 1);
  const entered = deferred(), release = deferred();
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', async function(this: WeeklyEstimateArchive,
    ...args: Parameters<WeeklyEstimateArchive['record']>) {
    entered.resolve(); await release.promise; return original.apply(this, args);
  });
  const changed = { ...opts, accountEstimates: [{ ...extra, fullEquivalentUsd: 120, unusedEquivalentUsd: 80 }] };
  coordinator.project('codex', empty, changed); await entered.promise;
  await new WeeklyEstimateCoordinator(file, SALT).clear({ allSources: true });
  release.resolve(); await coordinator.flush();
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntries, 0);
  assert.equal(coordinator.project('codex', empty, changed).entries.length, 0);
  const restart = new WeeklyEstimateCoordinator(file, SALT);
  restart.project('codex', empty, opts); await restart.flush();
  assert.equal(restart.project('codex', empty, opts).entries.length, 0);
});

test('account-only coordinator clear preserves queued other accounts and unbound samples, then fences reloads', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { file } = await fixture(t), a = 'a'.repeat(64), b = 'b'.repeat(64);
  const extra = (accountScopeKey: string): LocalWeeklyEstimate => ({ ...snapshot(), method: 'account-delta-v1', accountScopeKey });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT), data = inputs();
  const opts = { ...options, accountEstimates: [extra(a), extra(b)], activeAccountScopeKey: b };
  coordinator.project('codex', data, opts);
  const scope = { provider: 'codex' as const,
    accountFingerprint: fingerprintForStableIdentity(SALT, 'codex', 'official-account-scope-v1|' + a) };
  const cleared = await coordinator.clear(scope); await coordinator.flush();
  assert.equal(cleared.status, 'ready');
  const saved = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.equal(saved.length, 2);
  assert.ok(saved.some(row => row.accountScopeKey === b));
  assert.ok(saved.some(row => row.accountScopeKey === undefined));
  const view = coordinator.project('codex', data, opts);
  assert.equal(view.entries.length, 2); assert.equal(view.activeAccountNumber, 2);
  assert.doesNotMatch(JSON.stringify(view), /acct_[a-f0-9]{32}|accountScopeKey|[a-f0-9]{64}/);
  const restart = new WeeklyEstimateCoordinator(file, SALT);
  restart.project('codex', data, opts); await restart.flush();
  assert.equal(restart.project('codex', data, opts).entries.length, 2);
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntries, 2);
  const fresh = { ...opts, accountEstimates: [extra(b), { ...extra(a), observedAt: NOW + 1 }], now: NOW + 2 };
  restart.project('codex', data, fresh); await restart.flush();
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntries, 3);
});

test('another instance account clear fences an in-flight A writer but permits queued B under the changed generation', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { file } = await fixture(t), a = 'a'.repeat(64), b = 'b'.repeat(64);
  const entered = deferred(), release = deferred(), original = WeeklyEstimateArchive.prototype.record;
  let first = true;
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', async function(this: WeeklyEstimateArchive,
    ...args: Parameters<WeeklyEstimateArchive['record']>) {
    if (first) { first = false; entered.resolve(); await release.promise; }
    return original.apply(this, args);
  });
  const writer = new WeeklyEstimateCoordinator(file, SALT), empty = { observations: [], usage: [] };
  const opts = { ...options, accountEstimates: [a, b].map(accountScopeKey => snapshot({ method: 'account-delta-v1', accountScopeKey })) };
  writer.project('codex', empty, opts); await entered.promise;
  const clearer = new WeeklyEstimateCoordinator(file, SALT);
  await clearer.clear({ provider: 'codex',
    accountFingerprint: fingerprintForStableIdentity(SALT, 'codex', 'official-account-scope-v1|' + a) });
  release.resolve(); await writer.flush();
  const saved = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.deepEqual(saved.map(row => row.accountScopeKey), [b]);
  assert.equal(writer.project('codex', empty, opts).entries.length, 1);
});

test('extra account estimates validate optional metadata and cannot leak raw identities or invalid numbers', async t => {
  const { file } = await fixture(t), empty = { observations: [], usage: [] };
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  for (const fields of [{ accountScopeKey: 'raw-account-id' }, { accountNumber: 1 },
    { unlinkedEquivalentUsd: -1 }, { linkedSourceCount: 1.5 }]) {
    const opts = { ...options, accountEstimates: [snapshot({ method: 'account-delta-v1', ...fields })], activeAccountScopeKey: 'raw-account-id' };
    const view = coordinator.project('codex', empty, opts); await coordinator.flush();
    assert.equal(view.entries.length, 0); assert.equal(view.activeAccountNumber, undefined);
    assert.doesNotMatch(JSON.stringify(view), /raw-account-id|accountScopeKey/);
  }
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntries, 0);
});

test('project synchronously estimates, saves, and a fresh coordinator shows old as-of records without live data', async t => {
  const { file } = await fixture(t);
  let changes = 0;
  const first = new WeeklyEstimateCoordinator(file, SALT, () => { changes++; });
  const data = inputs();
  const initial = first.project('codex', data, options);
  assert.equal(initial.status, 'loading');
  assert.equal(initial.entries[0].fullEquivalentUsd, 100);
  await first.flush();
  assert.equal(changes, 1);
  const ready = first.project('codex', data, options);
  assert.equal(ready.status, 'ready');
  first.dispose();
  const second = new WeeklyEstimateCoordinator(file, SALT);
  const empty: WeeklyValueInputs = { observations: [], usage: [] };
  assert.equal(second.project('codex', empty, options).status, 'loading');
  await second.flush();
  const recovered = second.project('codex', empty, { ...options, now: NOW + DAY * 3 });
  assert.equal(recovered.entries[0].observedAt, OBSERVED);
  assert.equal(recovered.entries[0].unusedEquivalentUsd, 60);
  assert.equal(recovered.entries[0].estimatedAt, NOW);
  assert.equal(recovered.entries[0].pricingVersion, options.pricingVersion);
  assert.doesNotMatch(JSON.stringify(recovered), /sourceKey|windowKey|accountScopeKey|raw-series|raw-source|revision/);
});

test('same input references and clock minute reuse a projection without load/record or callback loops', async t => {
  const { file } = await fixture(t);
  const originalLoad = WeeklyEstimateArchive.prototype.load, originalRecord = WeeklyEstimateArchive.prototype.record;
  let loads = 0, records = 0, callbacks = 0;
  t.mock.method(WeeklyEstimateArchive.prototype, 'load', function(this: WeeklyEstimateArchive) { loads++; return originalLoad.call(this); });
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', function(this: WeeklyEstimateArchive, input: WeeklyEstimateInput) { records++; return originalRecord.call(this, input); });
  const data = inputs();
  const coordinator = new WeeklyEstimateCoordinator(file, SALT, () => { callbacks++; coordinator.project('codex', data, options); });
  const initial = coordinator.project('codex', data, options);
  assert.strictEqual(coordinator.project('codex', { ...data }, { ...options, now: NOW + 1 }), initial);
  await coordinator.flush();
  const counts = [loads, records, callbacks];
  const ready = coordinator.project('codex', data, options);
  for (let i = 0; i < 20; i++) assert.strictEqual(coordinator.project('codex', data, options), ready);
  await coordinator.flush();
  assert.deepEqual([loads, records, callbacks], counts);
  assert.deepEqual(counts, [1, 1, 1]);
  coordinator.project('codex', { ...data, usage: [...data.usage] }, options);
  await coordinator.flush();
  assert.equal(callbacks, 1, 'unchanged archive record does not trigger another render');
});

test('source change suppresses stale callbacks and excludes the previous source without deleting it', async t => {
  const { file } = await fixture(t);
  await new WeeklyEstimateArchive(file, SALT, SOURCE).record(stored());
  const entered = deferred(), release = deferred();
  const original = WeeklyEstimateArchive.prototype.load;
  let calls = 0, callbacks = 0;
  t.mock.method(WeeklyEstimateArchive.prototype, 'load', async function(this: WeeklyEstimateArchive) {
    if (++calls === 1) { entered.resolve(); await release.promise; }
    return original.call(this);
  });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT, () => { callbacks++; });
  const empty = { usage: [], observations: [] };
  coordinator.project('codex', empty, options);
  await entered.promise;
  const otherOptions = { ...options, sourceNamespace: 'synthetic-source-b' };
  assert.deepEqual(coordinator.project('codex', empty, otherOptions).entries, []);
  release.resolve();
  await coordinator.flush();
  assert.equal(callbacks, 1);
  assert.deepEqual(coordinator.project('codex', empty, otherOptions).entries, []);
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries.length, 1);
});

test('genuine null-withheld totals hold capacity without rewriting a saved snapshot or creating a used-only archive record', async t => {
  const { file } = await fixture(t);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const data = inputs();
  coordinator.project('codex', data, options);
  await coordinator.flush();
  const withheld = inputs();
  withheld.usage = [];
  const same = coordinator.project('codex', withheld, options);
  // A same-checkpoint retraction carries incomplete pricing, so its display is
  // conservative. The complete monetary snapshot on disk stays frozen.
  assert.equal(same.entries[0].fullEquivalentUsd, null);
  assert.equal(same.entries[0].unusedEquivalentUsd, null);
  assert.ok(same.entries[0].flags.includes('partial-pricing'));
  assert.ok(same.entries[0].flags.includes('stale-observation'));
  await coordinator.flush();
  const later = inputs();
  later.usage = [];
  later.observations[0].observedAt += 100;
  coordinator.project('codex', later, options);
  await coordinator.flush();
  const rows = coordinator.project('codex', later, options).entries;
  assert.ok(rows.some(row => row.observedAt === OBSERVED && row.fullEquivalentUsd === 100));
  assert.equal(rows.length, 1, 'one cycle summary selects the older eligible evidence over a newer withheld sample');
  const persisted = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.equal(persisted.length, 1);
  assert.ok(!persisted[0].flags.includes('partial-pricing'));
  assert.ok(!persisted[0].flags.includes('stale-observation'));
});

test('same-window observations retain archive history while projection selects the latest valid estimate', async t => {
  const { file } = await fixture(t);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', inputs(), options);
  await coordinator.flush();
  const next = inputs();
  next.observations[0].observedAt += 100;
  next.observations[0].usedPercent = 50;
  coordinator.project('codex', next, options);
  await coordinator.flush();
  assert.equal(coordinator.project('codex', next, options).entries.length, 1);
  const revision = { ...next, usage: [{ ...next.usage[0], equivalentUsd: 50 }] };
  coordinator.project('codex', revision, options);
  await coordinator.flush();
  const rows = coordinator.project('codex', revision, options).entries;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fullEquivalentUsd, 100);
  assert.ok((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries.length >= 2);
});

test('clear drains in-flight/queued writes, blocks new writes during clear, and clears a provider across sources', async t => {
  const { file } = await fixture(t);
  const other = new WeeklyEstimateArchive(file, SALT, 'other-home');
  await other.record(stored());
  await other.record({ ...stored(), provider: 'claude' });
  const entered = deferred(), release = deferred();
  const original = WeeklyEstimateArchive.prototype.record;
  let calls = 0;
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', async function(this: WeeklyEstimateArchive, input: WeeklyEstimateInput) {
    if (++calls === 1) { entered.resolve(); await release.promise; }
    return original.call(this, input);
  });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', inputs(), options);
  await entered.promise;
  const cleared = coordinator.clear({ provider: 'codex' });
  assert.equal(coordinator.project('codex', inputs(), options).status, 'loading');
  release.resolve();
  assert.equal((await cleared).status, 'ready');
  await coordinator.flush();
  assert.equal(calls, 1);
  assert.deepEqual((await other.load()).entries.map(row => row.provider), ['claude']);
  assert.deepEqual((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries, []);
});

test('dispose prevents queued writes and late callbacks', async t => {
  const { file, root } = await fixture(t);
  let changes = 0;
  const coordinator = new WeeklyEstimateCoordinator(file, SALT, () => { changes++; });
  coordinator.project('codex', inputs(), options);
  coordinator.dispose();
  await coordinator.flush();
  assert.deepEqual(await readdir(root), []);
  assert.equal(changes, 0);
  assert.equal(coordinator.project('codex', inputs(), options).status, 'unavailable');
});

test('archive errors return unavailable without discarding live estimates or retrying unchanged projections', async t => {
  const { file } = await fixture(t);
  await writeFile(file, '{malformed-canary');
  let changes = 0;
  const coordinator = new WeeklyEstimateCoordinator(file, SALT, () => { changes++; });
  const data = inputs();
  coordinator.project('codex', data, options);
  await coordinator.flush();
  const result = coordinator.project('codex', data, options);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.entries[0].fullEquivalentUsd, 100);
  await coordinator.flush();
  assert.equal(changes, 1);
  assert.equal(await readFile(file, 'utf8'), '{malformed-canary');
  assert.equal((await coordinator.clear({ allSources: true })).status, 'ready');
});

test('UI reduces same-cycle revisions before its cap while archive retains all snapshots and full status', async t => {
  const { file } = await fixture(t);
  const archive = new WeeklyEstimateArchive(file, SALT, SOURCE);
  for (let i = 0; i < 52; i++) await archive.record({ ...stored(), method: 'legacy-prefix-ratio', observedAt: OBSERVED + i, usedEquivalentUsd: 40 + i });
  const body = await readFile(file, 'utf8');
  await writeFile(file, body + ' '.repeat(1024 * 1024 - Buffer.byteLength(body)));
  const empty = { observations: [], usage: [] };
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', empty, options);
  await coordinator.flush();
  const result = coordinator.project('codex', empty, options);
  assert.equal(result.status, 'full');
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].observedAt, OBSERVED + 51);
  assert.equal((await archive.load()).entries.length, 52);
});

test('calibration evidence and nullable utilization reload without keys, range aliases or trust promotions', async t => {
  const { file } = await fixture(t);
  const archive = new WeeklyEstimateArchive(file, SALT, SOURCE);
  await archive.record({ ...stored(), method: 'paired-delta', usedEquivalentUsd: 20,
    calibrationStart: OBSERVED - DAY, fullRange: { lower: 90, upper: 110 }, accountScopeKey: 'a'.repeat(64),
    utilizationPercent: null });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const empty = { observations: [], usage: [] };
  coordinator.project('codex', empty, options);
  await coordinator.flush();
  const [row] = coordinator.project('codex', empty, options).entries;
  assert.deepEqual(row.fullRange, { lower: 90, upper: 110 });
  assert.equal((row as typeof row & { calibrationStart?: number }).calibrationStart, OBSERVED - DAY);
  assert.equal(row.usedEquivalentUsd, 20);
  assert.equal(row.utilizationPercent, null);
  assert.deepEqual(row.flags, stored().flags);
  assert.equal(row.pricingVersion, options.pricingVersion);
  assert.doesNotMatch(JSON.stringify(row), /sourceKey|windowKey|accountScopeKey|revision/);
});

test('a later withheld projection during loading cannot discard an earlier queued valid snapshot', async t => {
  const { file } = await fixture(t);
  const entered = deferred(), release = deferred();
  const original = WeeklyEstimateArchive.prototype.load;
  t.mock.method(WeeklyEstimateArchive.prototype, 'load', async function(this: WeeklyEstimateArchive) {
    entered.resolve(); await release.promise; return original.call(this);
  });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', inputs(), options);
  await entered.promise;
  const withheld = inputs(); withheld.usage = [];
  coordinator.project('codex', withheld, options);
  release.resolve();
  await coordinator.flush();
  const saved = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].fullEquivalentUsd, 100, 'the queued eligible snapshot still reaches disk');
  assert.equal(coordinator.project('codex', withheld, options).entries[0].fullEquivalentUsd, null,
    'incomplete same-checkpoint live evidence cannot promote the frozen monetary value');
});

test('paired projection saves and reloads the delta amount, calibration start and conditional range', async t => {
  const { file } = await fixture(t);
  const data = inputs();
  data.observations = [
    { ...data.observations[0], observedAt: OBSERVED - DAY, usedPercent: 20, windowId: 'synthetic-window', percentageErrorBound: .5 },
    { ...data.observations[0], windowId: 'synthetic-window', percentageErrorBound: .5 },
  ];
  data.usage = [
    { timestamp: OBSERVED - DAY - 100, equivalentUsd: 10, pricedTokens: 100, totalTokens: 100 },
    { timestamp: OBSERVED - 100, equivalentUsd: 30, pricedTokens: 100, totalTokens: 100 },
  ];
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const live = coordinator.project('codex', data, options).entries[0];
  assert.equal(live.usedEquivalentUsd, 30);
  assert.equal(live.calibrationStart, OBSERVED - DAY);
  assert.equal(live.fullEquivalentUsd, 150);
  await coordinator.flush();
  const second = new WeeklyEstimateCoordinator(file, SALT);
  const empty = { observations: [], usage: [] };
  second.project('codex', empty, options);
  await second.flush();
  const saved = second.project('codex', empty, options).entries[0];
  assert.equal(saved.usedEquivalentUsd, 30);
  assert.equal(saved.calibrationStart, live.calibrationStart);
  assert.deepEqual(saved.fullRange, live.fullRange);
});

test('another coordinator clear fences an already loaded in-flight writer and old observations after restart', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { file } = await fixture(t);
  const entered = deferred(), release = deferred();
  const original = WeeklyEstimateArchive.prototype.record;
  let first = true;
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', async function(this: WeeklyEstimateArchive,
    ...args: Parameters<WeeklyEstimateArchive['record']>) {
    if (first) { first = false; entered.resolve(); await release.promise; }
    return original.apply(this, args);
  });
  const writer = new WeeklyEstimateCoordinator(file, SALT);
  writer.project('codex', inputs(), options);
  await entered.promise;
  const clearer = new WeeklyEstimateCoordinator(file, SALT);
  assert.equal((await clearer.clear({ provider: 'codex' })).totalEntries, 0);
  release.resolve();
  await writer.flush();
  const archive = new WeeklyEstimateArchive(file, SALT, SOURCE);
  assert.equal((await archive.load()).totalEntries, 0);
  writer.project('codex', inputs(), { ...options, now: NOW + 60_000 });
  await writer.flush();
  assert.equal((await archive.load()).totalEntries, 0);
  const restart = new WeeklyEstimateCoordinator(file, SALT);
  const old = inputs();
  restart.project('codex', old, { ...options, now: NOW + 60_000 });
  await restart.flush();
  assert.equal((await archive.load()).totalEntries, 0);
  assert.deepEqual(restart.project('codex', old, { ...options, now: NOW + 60_000 }).entries, []);
  const fresh = inputs(); fresh.observations[0].observedAt = NOW + 1;
  restart.project('codex', fresh, { ...options, now: NOW + 2 });
  await restart.flush();
  assert.equal((await archive.load()).totalEntries, 1);
});

test('same-observation counter and boundary rough revisions retain flags without rewriting original snapshots', async t => {
  const { file } = await fixture(t);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', inputs(), options); await coordinator.flush();
  const original = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries[0];
  const counter = inputs();
  counter.observations.push({ ...counter.observations[0], usedPercent: 80 });
  const boundary = inputs();
  boundary.usage[0].intervalStart = RESET - 8 * DAY;
  boundary.usage[0].intervalEnd = OBSERVED - 1000;
  for (const [data, flag] of [[counter, 'counter-change'], [boundary, 'boundary-uncertain']] as const) {
    const [row] = coordinator.project('codex', data, options).entries;
    assert.equal(row.method, 'rough-prefix-v2');
    assert.ok(row.fullEquivalentUsd !== null && row.fullEquivalentUsd > 0);
    assert.ok(row.unusedEquivalentUsd !== null && row.unusedEquivalentUsd >= 0);
    assert.ok(row.flags.includes(flag));
    assert.equal(row.pricingVersion, options.pricingVersion);
    await coordinator.flush();
    const storedRows = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
    assert.deepEqual(storedRows[0], original);
    if (row.utilizationPercent !== original.utilizationPercent) {
      assert.equal(storedRows[storedRows.length - 1].fullEquivalentUsd, row.fullEquivalentUsd);
      assert.ok(storedRows[storedRows.length - 1].flags.includes(flag));
    } else {
      assert.equal(storedRows.filter(entry => entry.utilizationPercent === original.utilizationPercent).length, 1);
    }
  }
});

test('a provider clear does not block another provider queued under the prior generation', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { file } = await fixture(t);
  const entered = deferred(), release = deferred();
  const original = WeeklyEstimateArchive.prototype.record;
  let first = true;
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', async function(this: WeeklyEstimateArchive,
    ...args: Parameters<WeeklyEstimateArchive['record']>) {
    if (first) { first = false; entered.resolve(); await release.promise; }
    return original.apply(this, args);
  });
  const writer = new WeeklyEstimateCoordinator(file, SALT);
  const data = inputs(); data.observations[0].provider = 'claude';
  writer.project('claude', data, options); await entered.promise;
  await new WeeklyEstimateCoordinator(file, SALT).clear({ provider: 'codex' });
  release.resolve(); await writer.flush();
  assert.deepEqual((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntriesByProvider,
    { claude: 1, codex: 0 });
});

test('a separate Node process cannot resubmit pre-clear observations but can save a genuinely fresh sample', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { file } = await fixture(t);
  await new WeeklyEstimateArchive(file, SALT, SOURCE).record(stored());
  await new WeeklyEstimateCoordinator(file, SALT).clear({ allSources: true });
  const script = `
    const {WeeklyEstimateCoordinator} = require(process.argv[1]);
    const {WeeklyEstimateArchive} = require(process.argv[2]);
    const [file,salt,source,optionsJson,inputsJson] = process.argv.slice(3);
    const opts = JSON.parse(optionsJson), old = JSON.parse(inputsJson);
    (async () => {
      const coordinator = new WeeklyEstimateCoordinator(file,salt);
      coordinator.project('codex',old,{...opts,now:opts.now+60000});
      await coordinator.flush();
      const archive = new WeeklyEstimateArchive(file,salt,source);
      const before = await archive.load();
      const fresh = JSON.parse(inputsJson);
      fresh.observations[0].observedAt = opts.now+1;
      coordinator.project('codex',fresh,{...opts,now:opts.now+60000});
      await coordinator.flush();
      process.stdout.write(JSON.stringify([before.totalEntries,(await archive.load()).totalEntries]));
    })().catch(() => { process.exitCode = 1; });
  `;
  const result = execFileSync(process.execPath, ['-e', script, require.resolve('../weeklyEstimateCoordinator'),
    require.resolve('../weeklyEstimateArchive'), file, SALT, SOURCE, JSON.stringify(options), JSON.stringify(inputs())],
  { encoding: 'utf8', timeout: 10_000 });
  assert.deepEqual(JSON.parse(result), [0, 1]);
});

test('immediate provider clear preserves another provider queued before its worker starts', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { file } = await fixture(t);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const claude = inputs(); claude.observations[0].provider = 'claude';
  coordinator.project('claude', claude, options);
  coordinator.project('codex', inputs(), options);
  await coordinator.clear({ provider: 'codex' });
  await coordinator.flush();
  assert.deepEqual((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntriesByProvider,
    { claude: 1, codex: 0 });
  assert.equal(coordinator.project('claude', claude, options).entries[0].fullEquivalentUsd, 100);
});

test('source switch retires UI callbacks but drains the old source valid snapshots after a paused load', async t => {
  const { file } = await fixture(t);
  const entered = deferred(), release = deferred();
  const originalLoad = WeeklyEstimateArchive.prototype.load;
  let first = true, callbacks = 0;
  t.mock.method(WeeklyEstimateArchive.prototype, 'load', async function(this: WeeklyEstimateArchive) {
    if (first) { first = false; entered.resolve(); await release.promise; }
    return originalLoad.call(this);
  });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT, () => { callbacks++; });
  coordinator.project('codex', inputs(), options);
  await entered.promise;
  const empty = { observations: [], usage: [] };
  const otherOptions = { ...options, sourceNamespace: 'source-b' };
  coordinator.project('codex', empty, otherOptions);
  release.resolve(); await coordinator.flush();
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries.length, 1);
  assert.equal(callbacks, 1, 'only the current source can notify the UI');
  assert.deepEqual(coordinator.project('codex', empty, otherOptions).entries, []);
});

test('acknowledged semantic snapshots perform no repeated archive I/O across clock minutes', async t => {
  const { file } = await fixture(t);
  const originalLoad = WeeklyEstimateArchive.prototype.load, originalRecord = WeeklyEstimateArchive.prototype.record;
  let loads = 0, records = 0;
  t.mock.method(WeeklyEstimateArchive.prototype, 'load', function(this: WeeklyEstimateArchive) {
    loads++; return originalLoad.call(this);
  });
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', function(this: WeeklyEstimateArchive,
    ...args: Parameters<WeeklyEstimateArchive['record']>) {
    records++; return originalRecord.apply(this, args);
  });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const data = inputs();
  coordinator.project('codex', data, options); await coordinator.flush();
  const before = await readFile(file, 'utf8');
  for (let minute = 1; minute <= 3; minute++) {
    coordinator.project('codex', data, { ...options, now: NOW + minute * 60_000 });
    await coordinator.flush();
  }
  assert.deepEqual([loads, records], [1, 1]);
  const stale = coordinator.project('codex', data, { ...options, now: NOW + 7 * 3_600_000 });
  await coordinator.flush();
  assert.ok(stale.entries[0].flags.includes('stale-observation'));
  assert.deepEqual([loads, records], [1, 1], 'clock-only staleness remains display metadata');
  assert.equal(await readFile(file, 'utf8'), before);
  coordinator.project('codex', data, { ...options, pricingVersion: 'openai-v2' });
  await coordinator.flush();
  assert.equal(records, 2, 'a real pricing-version change still records');
});

test('provider clear cancels retired-source queued work and retains durable observation fences', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { file } = await fixture(t);
  const entered = deferred(), release = deferred();
  const originalLoad = WeeklyEstimateArchive.prototype.load;
  let first = true;
  t.mock.method(WeeklyEstimateArchive.prototype, 'load', async function(this: WeeklyEstimateArchive) {
    if (first) { first = false; entered.resolve(); await release.promise; }
    return originalLoad.call(this);
  });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', inputs(), options); await entered.promise;
  coordinator.project('codex', inputs(), { ...options, sourceNamespace: 'source-b' });
  const cleared = coordinator.clear({ provider: 'codex' });
  release.resolve(); await cleared; await coordinator.flush();
  const archive = new WeeklyEstimateArchive(file, SALT, SOURCE);
  assert.equal((await archive.load()).totalEntries, 0);
  assert.equal((await archive.record(stored())).outcome, 'cleared-observation');
});

test('local-history completeness changes invalidate the memo with unchanged usage and observation references', async t => {
  const { file } = await fixture(t);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const data = inputs(); data.localHistoryComplete = false;
  const usage = data.usage, observations = data.observations;
  const incomplete = coordinator.project('codex', data, options);
  assert.equal(incomplete.entries[0].method, 'rough-prefix-v2');
  assert.equal(incomplete.entries[0].fullEquivalentUsd, null);
  assert.equal(incomplete.entries[0].unusedEquivalentUsd, null);
  assert.ok(incomplete.entries[0].flags.includes('partial-history'));
  await coordinator.flush();
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntries, 0);
  data.localHistoryComplete = true;
  const complete = coordinator.project('codex', data, options);
  assert.strictEqual(data.usage, usage); assert.strictEqual(data.observations, observations);
  assert.equal(complete.entries[0].fullEquivalentUsd, 100);
  assert.ok(!complete.entries[0].flags.includes('partial-history'));
  assert.ok(complete.entries[0].flags.includes('account-unattributed'));
  await coordinator.flush();
  const rows = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].flags.includes('partial-history'));
  assert.equal(rows[0].fullEquivalentUsd, 100);
});

test('known incomplete history updates the live warning and retains the first same-percent archive snapshot', async t => {
  const { file } = await fixture(t);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const data = inputs(); data.localHistoryComplete = true;
  coordinator.project('codex', data, options); await coordinator.flush();
  const original = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries[0];
  data.localHistoryComplete = false;
  const [rough] = coordinator.project('codex', data, options).entries;
  assert.equal(rough.method, 'rough-prefix-v2');
  assert.equal(rough.fullEquivalentUsd, null);
  assert.equal(rough.unusedEquivalentUsd, null);
  assert.ok(rough.flags.includes('partial-history'));
  assert.ok(!rough.flags.includes('stale-observation'));
  await coordinator.flush();
  const saved = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], original);
  const afterRevision = await readFile(file, 'utf8');
  delete data.localHistoryComplete;
  const [legacy] = coordinator.project('codex', data, options).entries;
  assert.equal(legacy.fullEquivalentUsd, 100);
  assert.ok(!legacy.flags.includes('partial-history'));
  assert.ok(legacy.flags.includes('account-unattributed'));
  await coordinator.flush();
  assert.equal(await readFile(file, 'utf8'), afterRevision);
});

test('semantic deduplication still permits a fresh identical-valued observation after another window clears', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const { file } = await fixture(t);
  const writer = new WeeklyEstimateCoordinator(file, SALT);
  writer.project('codex', inputs(), options); await writer.flush();
  await new WeeklyEstimateCoordinator(file, SALT).clear({ provider: 'codex' });
  const fresh = inputs(); fresh.observations[0].observedAt = NOW + 1;
  writer.project('codex', fresh, { ...options, now: NOW + 2 }); await writer.flush();
  const loaded = await new WeeklyEstimateArchive(file, SALT, SOURCE).load();
  assert.equal(loaded.totalEntries, 1);
  assert.equal(loaded.entries[0].observedAt, NOW + 1);
});

test('an unchanged-valued newer observation is acknowledged even when archive keeps its original record', async t => {
  const { file } = await fixture(t);
  const original = WeeklyEstimateArchive.prototype.record;
  let records = 0;
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', function(this: WeeklyEstimateArchive,
    ...args: Parameters<WeeklyEstimateArchive['record']>) { records++; return original.apply(this, args); });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', inputs(), options); await coordinator.flush();
  const newer = inputs(); newer.observations[0].observedAt += 100;
  coordinator.project('codex', newer, options); await coordinator.flush();
  const accepted = records;
  for (let i = 1; i <= 3; i++) {
    coordinator.project('codex', newer, { ...options, now: NOW + i * 60_000 }); await coordinator.flush();
  }
  assert.equal(records, accepted);
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntries, 1);
});

test('rough admission withholds incomplete pricing/history but saves eligible boundary and counter references', async t => {
  let live = roughSnapshot();
  t.mock.method(estimateProducer, 'buildLocalWeeklyEstimates', (_provider: unknown, data: WeeklyValueInputs) => data.observations.length ? [live] : []);
  const cases: Array<[Partial<LocalWeeklyEstimate>, boolean]> = [
    [{ flags: ['partial-pricing'], pricingCoverage: .25 }, false],
    [{ flags: ['boundary-uncertain'] }, true], [{ flags: ['partial-history'] }, false], [{ flags: ['counter-change'] }, true],
    [{ flags: ['account-unattributed', 'partial-pricing', 'boundary-uncertain', 'partial-history', 'counter-change'],
      pricingCoverage: 0, unusedEquivalentUsd: 0 }, false],
  ];
  for (const [i, [change, admitted]] of cases.entries()) {
    const { file } = await fixture(t), coordinator = new WeeklyEstimateCoordinator(file, SALT);
    live = roughSnapshot({ ...change, observedAt: OBSERVED + i, utilizationPercent: 40 + i });
    const projected = coordinator.project('codex', inputs(), options);
    assert.equal(projected.entries.length, 1);
    assert.equal(projected.entries[0].observedAt, live.observedAt);
    assert.equal(projected.entries[0].fullEquivalentUsd, admitted ? 100 : null);
    assert.equal(projected.entries[0].unusedEquivalentUsd, admitted ? live.unusedEquivalentUsd : null);
    await coordinator.flush();
    const loaded = await new WeeklyEstimateArchive(file, SALT, SOURCE).load();
    assert.equal(loaded.totalEntries, admitted ? 1 : 0);
    if (admitted) {
      assert.equal(loaded.entries[0].fullEquivalentUsd, 100);
      assert.equal(loaded.entries[0].unusedEquivalentUsd, live.unusedEquivalentUsd);
      assert.deepEqual(new Set(loaded.entries[0].flags), new Set(live.flags));
    }
    const empty = { observations: [], usage: [] }, restart = new WeeklyEstimateCoordinator(file, SALT);
    restart.project('codex', empty, options); await restart.flush();
    const saved = restart.project('codex', empty, options).entries;
    assert.equal(saved.length, admitted ? 1 : 0);
    if (admitted) {
      assert.equal(saved[0].method, live.method);
      assert.equal(saved[0].pricingCoverage, 1);
      assert.equal(saved[0].unusedEquivalentUsd, live.unusedEquivalentUsd);
    }
    assert.doesNotMatch(JSON.stringify(saved), /sourceKey|windowKey|accountScopeKey|raw-series|raw-source/);
  }
});

test('rough admission preserves legacy-method guards and never records used-only or invalid numeric estimates', async t => {
  const { file } = await fixture(t);
  let live = snapshot();
  t.mock.method(estimateProducer, 'buildLocalWeeklyEstimates', () => [live]);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  for (const method of ['legacy-prefix-ratio', 'paired-delta', 'owned-window'] as const) {
    for (const flags of [['partial-pricing'], ['boundary-uncertain'], ['partial-history'], ['counter-change']] as LocalWeeklyEstimate['flags'][]) {
      live = snapshot({ method, flags });
      coordinator.project('codex', inputs(), options); await coordinator.flush();
    }
    live = snapshot({ method, pricingCoverage: .5 });
    coordinator.project('codex', inputs(), options); await coordinator.flush();
  }
  const invalid: Array<Partial<LocalWeeklyEstimate>> = [
    { fullEquivalentUsd: null, unusedEquivalentUsd: null }, { fullEquivalentUsd: 100, unusedEquivalentUsd: null },
    { fullEquivalentUsd: 0, unusedEquivalentUsd: 0 }, { fullEquivalentUsd: NaN }, { fullEquivalentUsd: Infinity },
    { unusedEquivalentUsd: -1 }, { unusedEquivalentUsd: Infinity }, { usedEquivalentUsd: -1 },
  ];
  for (const values of invalid) {
    live = roughSnapshot(values);
    coordinator.project('codex', inputs(), options); await coordinator.flush();
  }
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntries, 0);
  live = roughSnapshot({ pricingCoverage: .1, flags: ['partial-history'], unusedEquivalentUsd: 0 });
  coordinator.project('codex', inputs(), options); await coordinator.flush();
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntries, 0);
  live = roughSnapshot({ unusedEquivalentUsd: 0 });
  coordinator.project('codex', inputs(), options); await coordinator.flush();
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).totalEntries, 1);
});

test('rough semantic acknowledgements avoid clock-only I/O and retain pricing while coalescing same-percent numeric revisions', async t => {
  const { file } = await fixture(t);
  // Keep admission valid so this test continues to exercise actual writes,
  // clock-only acknowledgement, pricing revisions and frozen archive values.
  let live = roughSnapshot();
  t.mock.method(estimateProducer, 'buildLocalWeeklyEstimates', () => [live]);
  const original = WeeklyEstimateArchive.prototype.record;
  let records = 0;
  t.mock.method(WeeklyEstimateArchive.prototype, 'record', function(this: WeeklyEstimateArchive,
    ...args: Parameters<WeeklyEstimateArchive['record']>) { records++; return original.apply(this, args); });
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const data = inputs();
  coordinator.project('codex', data, options); await coordinator.flush();
  assert.equal(records, 1);
  for (let minute = 1; minute <= 3; minute++) {
    live = { ...live, estimatedAt: NOW + minute * 60_000, flags: [...live.flags.filter(flag => flag !== 'stale-observation'), 'stale-observation'] };
    coordinator.project('codex', data, { ...options, now: NOW + minute * 60_000 }); await coordinator.flush();
  }
  assert.equal(records, 1);
  coordinator.project('codex', data, { ...options, pricingVersion: 'openai-v2' }); await coordinator.flush();
  assert.equal(records, 2);
  live = { ...live, usedEquivalentUsd: 50, fullEquivalentUsd: 125, unusedEquivalentUsd: 75 };
  coordinator.project('codex', inputs(), { ...options, pricingVersion: 'openai-v2' }); await coordinator.flush();
  assert.equal(records, 3);
  const loaded = await new WeeklyEstimateArchive(file, SALT, SOURCE).load();
  assert.equal(loaded.totalEntries, 2);
  assert.deepEqual(loaded.entries.map(entry => entry.revision), [1, 2]);
  assert.equal(loaded.entries[0].fullEquivalentUsd, 100);
});

test('genuine null-withheld rough retractions preserve archive bytes and withhold incomplete display capacity', async t => {
  const { file } = await fixture(t);
  let live = roughSnapshot();
  t.mock.method(estimateProducer, 'buildLocalWeeklyEstimates', () => [live]);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', inputs(), options); await coordinator.flush();
  const before = await readFile(file, 'utf8');
  for (const flag of ['boundary-uncertain', 'partial-pricing', 'partial-history', 'counter-change'] as const) {
    live = roughSnapshot({ fullEquivalentUsd: null, unusedEquivalentUsd: null, flags: [flag] });
    const [retained] = coordinator.project('codex', inputs(), options).entries;
    const incomplete = flag === 'partial-pricing' || flag === 'partial-history';
    assert.equal(retained.fullEquivalentUsd, incomplete ? null : 100);
    assert.equal(retained.unusedEquivalentUsd, incomplete ? null : 60);
    assert.equal(retained.observedAt, OBSERVED);
    assert.ok(retained.flags.includes(flag));
    assert.ok(retained.flags.includes('stale-observation'));
    await coordinator.flush();
    assert.equal(await readFile(file, 'utf8'), before);
  }
});
