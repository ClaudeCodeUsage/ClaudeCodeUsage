import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { WeeklyEstimateCoordinator } from '../weeklyEstimateCoordinator';
import { WeeklyEstimateArchive, WeeklyEstimateInput } from '../weeklyEstimateArchive';
import { buildLocalWeeklyEstimates } from '../weeklyEstimate';
import type { WeeklyValueInputs } from '../weeklyValue';

const DAY = 86_400_000, RESET = 1_800_000_000_000, OBSERVED = RESET - DAY, NOW = OBSERVED + 1000;
const SALT = 'synthetic-coordinator-salt', SOURCE = 'synthetic-source-a';
const options = { sourceNamespace: SOURCE, pricingVersion: 'api-equivalent-v1', now: NOW };
function inputs(): WeeklyValueInputs {
  return { observations: [{ provider: 'codex', seriesKey: 'raw-series-canary', sourceKey: 'raw-source-canary',
    resetAt: RESET, observedAt: OBSERVED, usedPercent: 40 }],
  usage: [{ timestamp: OBSERVED - 1000, equivalentUsd: 40, pricedTokens: 100, totalTokens: 100 }] };
}
function stored(): WeeklyEstimateInput {
  return { ...buildLocalWeeklyEstimates('codex', inputs(), { now: NOW })[0], pricingVersion: options.pricingVersion };
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

test('withheld live totals never replace a saved valid snapshot, and only valid full estimates are recorded', async t => {
  const { file } = await fixture(t);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  const data = inputs();
  coordinator.project('codex', data, options);
  await coordinator.flush();
  const withheld = inputs();
  withheld.usage[0].pricedTokens = 50;
  const same = coordinator.project('codex', withheld, options);
  assert.equal(same.entries[0].fullEquivalentUsd, 100);
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
  assert.ok(rows.some(row => row.observedAt === OBSERVED + 100 && row.fullEquivalentUsd === null));
  const persisted = (await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries;
  assert.equal(persisted.length, 1);
  assert.ok(!persisted[0].flags.includes('partial-pricing'));
  assert.ok(!persisted[0].flags.includes('stale-observation'));
});

test('same-window observations retain old snapshots while exact tuples select the latest valid estimate', async t => {
  const { file } = await fixture(t);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', inputs(), options);
  await coordinator.flush();
  const next = inputs();
  next.observations[0].observedAt += 100;
  next.observations[0].usedPercent = 50;
  coordinator.project('codex', next, options);
  await coordinator.flush();
  assert.equal(coordinator.project('codex', next, options).entries.length, 2);
  const revision = { ...next, usage: [{ ...next.usage[0], equivalentUsd: 50 }] };
  coordinator.project('codex', revision, options);
  await coordinator.flush();
  const rows = coordinator.project('codex', revision, options).entries;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fullEquivalentUsd, 100);
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

test('UI keeps the latest 48 archived snapshots and exposes full status', async t => {
  const { file } = await fixture(t);
  const archive = new WeeklyEstimateArchive(file, SALT, SOURCE);
  for (let i = 0; i < 52; i++) await archive.record({ ...stored(), observedAt: OBSERVED + i, usedEquivalentUsd: 40 + i });
  const body = await readFile(file, 'utf8');
  await writeFile(file, body + ' '.repeat(1024 * 1024 - Buffer.byteLength(body)));
  const empty = { observations: [], usage: [] };
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', empty, options);
  await coordinator.flush();
  const result = coordinator.project('codex', empty, options);
  assert.equal(result.status, 'full');
  assert.equal(result.entries.length, 48);
  assert.equal(result.entries[0].observedAt, OBSERVED + 51);
  assert.equal(result.entries[47].observedAt, OBSERVED + 4);
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
  assert.equal((await new WeeklyEstimateArchive(file, SALT, SOURCE).load()).entries.length, 1);
  assert.equal(coordinator.project('codex', withheld, options).entries[0].fullEquivalentUsd, 100);
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

test('same-observation counter and boundary retractions union display flags without rewriting saved history', async t => {
  const { file } = await fixture(t);
  const coordinator = new WeeklyEstimateCoordinator(file, SALT);
  coordinator.project('codex', inputs(), options); await coordinator.flush();
  const before = await readFile(file, 'utf8');
  const counter = inputs();
  counter.observations.push({ ...counter.observations[0], usedPercent: 80 });
  const boundary = inputs();
  boundary.usage[0].intervalStart = RESET - 8 * DAY;
  boundary.usage[0].intervalEnd = OBSERVED - 1000;
  for (const [data, flag] of [[counter, 'counter-change'], [boundary, 'boundary-uncertain']] as const) {
    const [row] = coordinator.project('codex', data, options).entries;
    assert.equal(row.fullEquivalentUsd, 100);
    assert.ok(row.flags.includes(flag)); assert.ok(row.flags.includes('stale-observation'));
    assert.equal(row.pricingVersion, options.pricingVersion);
    await coordinator.flush();
    assert.equal(await readFile(file, 'utf8'), before);
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
