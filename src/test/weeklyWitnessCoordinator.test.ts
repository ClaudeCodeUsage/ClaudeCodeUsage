import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildCodexWitnessCycles, CodexWitnessCycle, CodexWitnessSource } from '../codexWitnessCycles';
import { WeeklyEstimateCoordinator } from '../weeklyEstimateCoordinator';
import { WeeklyEstimateArchive, WeeklyEstimateInput } from '../weeklyEstimateArchive';
import { WeeklyValueInputs } from '../weeklyValue';
import * as oldProducer from '../codexWindowEstimate';
import type { LocalWeeklyEstimate } from '../weeklyEstimate';

const T = 1_800_000_000_000, R = T + 604_800_000;
const book = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'known', input: .01, cachedInput: .001, output: .02 }] };
const vector = (n: number) => ({ inputTotal: n, cachedInput: 0, outputTotal: 0, reasoningOutput: 0 });
function receipt(partial = false, percentage = 50): CodexWitnessCycle {
  return buildCodexWitnessCycles([{ rows: [
    { segment: 0, from: T, through: T, resetAt: R, usedPercent: 0, baseline: true,
      baselineByModel: { known: vector(10) }, byModel: {}, complete: true },
    { segment: 0, from: T, through: T + 2000, resetAt: R, usedPercent: percentage, baseline: false,
      byModel: partial ? { known: vector(90), unknown: vector(20) } : { known: vector(90) }, complete: !partial },
  ], primaryByModel: partial ? { known: vector(100), unknown: vector(20) } : { known: vector(100) },
  hasUnknownGap: partial }], book, { now: T + 3000 })[0];
}
const coverage = { unplacedSources: 1, unlocatedPrimaryUsd: 3, unlocatedUnpricedTokens: 2, rejectedSources: 0 };
const options = { sourceNamespace: 'synthetic-witness-home', pricingVersion: 'api-equivalent-v1', now: T + 3000 };
const inputs = (cycles: CodexWitnessCycle[]): WeeklyValueInputs => ({ usage: [], observations: [],
  codexWitnessCycles: cycles, codexWitnessCoverage: coverage, codexQuotaCheckpoints: [] });
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ccu-witness-coordinator-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'weekly-estimates-v1.json');
  return { file, coordinator: new WeeklyEstimateCoordinator(file, 'fixture-salt'),
    archive: new WeeklyEstimateArchive(file, 'fixture-salt', options.sourceNamespace) };
}

test('witness numeric source bypasses old reconstruction and preserves partial anonymous USD and capacity', async t => {
  const { coordinator, archive } = await fixture(t), cycle = receipt(true);
  const spy = t.mock.method(oldProducer, 'buildCodexWindowEstimates', () => { throw new Error('old producer called'); });
  const data = inputs([cycle]);
  const projection = coordinator.project('codex', data, options);
  assert.equal(spy.mock.callCount(), 0);
  assert.equal(projection.entries.length, 1);
  const entry = projection.entries[0];
  assert.equal(entry.method, 'request-witness-v1');
  assert.equal(entry.observedAt, cycle.through);
  assert.equal(entry.windowStart, cycle.from);
  assert.equal(entry.usedEquivalentUsd, 1);
  assert.equal(entry.fullEquivalentUsd, cycle.referenceCapacityUsd);
  assert.equal(entry.unusedEquivalentUsd, cycle.referenceCapacityUsd! * .5);
  assert.equal(entry.pricingCoverage, 100 / 120);
  assert.equal(entry.accountNumber, undefined);
  assert.equal(entry.quotaCycle?.endAt, cycle.cycleEndAt);
  assert.deepEqual((projection as unknown as { codexWitnessCoverage: unknown }).codexWitnessCoverage, coverage);
  assert.doesNotMatch(JSON.stringify(projection), /localWindowKey|accountScopeKey|sourceKey/);
  await coordinator.flush();
  const saved = await archive.load();
  assert.equal(saved.entries.length, 1);
  assert.deepEqual(saved.entries[0].witnessCycle, cycle);
});

test('usage-only witness receipts survive restart without gaining an active account', async t => {
  const { coordinator, archive, file } = await fixture(t), data = inputs([receipt(true, 2)]);
  coordinator.project('codex', data, options); await coordinator.flush();
  assert.equal((await archive.load()).entries.length, 1);
  const restarted = new WeeklyEstimateCoordinator(file, 'fixture-salt');
  const opts = { ...options, now: R + 1000, activeAccountScopeKey: 'a'.repeat(64) };
  restarted.project('codex', inputs([]), opts); await restarted.flush();
  const result = restarted.project('codex', inputs([]), opts);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].usedEquivalentUsd, 1);
  assert.equal(result.entries[0].fullEquivalentUsd, null);
  assert.equal(result.entries[0].accountNumber, undefined);
  assert.equal(result.entries[0].quotaCycle?.closed, true);
  assert.equal(result.activeAccountNumber, undefined);
});

test('witness clear fences reject a later endpoint whose sum starts before clearing', async t => {
  const { coordinator, archive } = await fixture(t), cycle = receipt();
  const clock = t.mock.method(Date, 'now', () => T + 1000);
  await archive.clear({ provider: 'codex' });
  clock.mock.restore();
  const data = inputs([cycle]);
  coordinator.project('codex', data, options); await coordinator.flush();
  assert.equal(coordinator.project('codex', data, options).entries.length, 0);
  assert.equal((await archive.load()).entries.length, 0);
});

test('archive validates witness numeric consistency and strips caller fields', async t => {
  const { coordinator, archive } = await fixture(t);
  coordinator.project('codex', inputs([receipt()]), options); await coordinator.flush();
  const saved = (await archive.load()).entries[0];
  assert.ok(saved, 'witness receipt persisted');
  for (const patch of [ { usedEquivalentUsd: 99 }, { fullEquivalentUsd: 99 }, { utilizationPercent: 99 },
    { observedAt: T + 1000 }, { windowStart: T - 1 }, { accountScopeKey: 'a'.repeat(64) },
    { witnessCycle: undefined }, { method: 'rough-prefix-v2' } ]) {
    assert.equal((await archive.record({ ...saved, ...patch } as WeeklyEstimateInput)).outcome, 'invalid');
  }
  const injected = { ...saved, witnessCycle: { ...saved.witnessCycle!, secret: 'caller-canary' } };
  const result = await archive.record(injected);
  assert.equal(result.outcome, 'unchanged');
  assert.doesNotMatch(JSON.stringify(result), /caller-canary/);
});

test('declared witness mode hides rough legacy chart fallback without rewriting its archive', async t => {
  const { coordinator, archive, file } = await fixture(t);
  const legacy: WeeklyEstimateInput = { provider: 'codex', windowStart: T - 604_800_000, resetAt: T,
    observedAt: T - 1000, estimatedAt: T, usedEquivalentUsd: 10, fullEquivalentUsd: 20, unusedEquivalentUsd: 10,
    utilizationPercent: 50, pricingCoverage: .5, method: 'rough-prefix-v2', pricingVersion: 'v1', flags: ['partial-pricing'] };
  assert.equal((await archive.record(legacy)).outcome, 'recorded');
  const before = await readFile(file, 'utf8');
  coordinator.project('codex', inputs([]), options); await coordinator.flush();
  assert.deepEqual(coordinator.project('codex', inputs([]), options).entries, []);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal((await archive.load()).entries[0].method, 'rough-prefix-v2');
});

test('official same-episode placeholders cannot hide witness USD or duplicate the cycle', async t => {
  const { coordinator } = await fixture(t), cycle = receipt(true);
  const placeholder: LocalWeeklyEstimate = { provider: 'codex', windowStart: T, resetAt: R,
    observedAt: T + 2500, estimatedAt: T + 2500, method: 'account-delta-v1',
    usedEquivalentUsd: 0, fullEquivalentUsd: null, unusedEquivalentUsd: null, utilizationPercent: 60,
    pricingCoverage: 0, flags: ['account-unattributed'], accountScopeKey: 'a'.repeat(64),
    quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' } };
  const opts = { ...options, accountEstimates: [placeholder] };
  const data = inputs([cycle]);
  assert.equal(coordinator.project('codex', data, opts).entries.length, 1);
  await coordinator.flush();
  const result = coordinator.project('codex', data, opts);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].usedEquivalentUsd, 1);
  assert.equal(result.entries[0].utilizationPercent, 50);
  assert.equal(result.entries[0].accountNumber, undefined);
  assert.equal(result.unassignedCyclesOmitted, undefined);
});
test('an initial official placeholder before the first local request does not add an empty monetary row', async t => {
 const {coordinator}=await fixture(t),cycle=receipt(true);
 const placeholder:LocalWeeklyEstimate={provider:'codex',windowStart:T-1000,resetAt:R,observedAt:T-500,
  estimatedAt:T,method:'account-delta-v1',usedEquivalentUsd:0,fullEquivalentUsd:null,unusedEquivalentUsd:null,
  utilizationPercent:0,pricingCoverage:0,flags:['account-unattributed'],accountScopeKey:'a'.repeat(64),
  quotaEpoch:{startedAt:T-1000,resetAnchorAt:R,startLowerAt:null,reason:'initial'}};
 const projection=coordinator.project('codex',inputs([cycle]),{...options,accountEstimates:[placeholder]});
 assert.equal(projection.entries.length,1);assert.ok(projection.entries[0].witnessCycle);
});
test('a stronger frozen amount retains its as-of time but adopts a later observed close boundary',async t=>{
 const {coordinator,file}=await fixture(t),cycle=receipt(true),data=inputs([cycle]);
 coordinator.project('codex',data,options);await coordinator.flush();
 const compacted={...cycle,from:T+500,knownUsd:.8,knownTokens:80,unpricedTokens:10,pricingCoverage:80/90,
  deltaUsd:.7,referenceCapacityUsd:1.4,cycleEndAt:T+4000,cycleEndLowerAt:T+3000,closed:true,requestedThrough:T+5000};
 const result=coordinator.project('codex',inputs([compacted]),{...options,now:T+5000});
 assert.equal(result.entries.length,1);assert.equal(result.entries[0].usedEquivalentUsd,cycle.knownUsd);
 assert.equal(result.entries[0].observedAt,cycle.through);
 assert.equal(result.entries[0].witnessCycle?.cycleEndAt,R,'frozen receipt is not rewritten');
 assert.equal(result.entries[0].quotaCycle?.endAt,T+4000);assert.equal(result.entries[0].quotaCycle?.closed,true);
 await coordinator.flush();
 const restarted=new WeeklyEstimateCoordinator(file,'fixture-salt'),opts={...options,now:T+6000};
 restarted.project('codex',inputs([]),opts);await restarted.flush();
 const retained=restarted.project('codex',inputs([]),opts).entries[0];
 assert.equal(retained.usedEquivalentUsd,cycle.knownUsd);assert.equal(retained.quotaCycle?.endAt,T+4000);
});
test('compaction can reduce the subtotal without moving the global first endpoint',async t=>{
 const {coordinator}=await fixture(t),cycle=receipt(true);
 coordinator.project('codex',inputs([cycle]),options);await coordinator.flush();
 const reduced={...cycle,knownUsd:.8,knownTokens:80,unpricedTokens:10,pricingCoverage:80/90,
  deltaUsd:.7,referenceCapacityUsd:1.4,requestedThrough:T+5000};
 const result=coordinator.project('codex',inputs([reduced]),{...options,now:T+5000});
 assert.equal(result.entries[0].usedEquivalentUsd,cycle.knownUsd);
 assert.equal(result.entries[0].witnessCycle?.requestedThrough,cycle.requestedThrough);
});

test('warm requested-asof changes cause no new archive I/O or revisions', async t => {
  const { coordinator, archive, file } = await fixture(t), cycle = receipt();
  coordinator.project('codex', inputs([cycle]), options); await coordinator.flush();
  const before = await readFile(file, 'utf8');
  const writes = t.mock.method(WeeklyEstimateArchive.prototype, 'record');
  const later = { ...cycle, requestedThrough: T + 120_000 };
  coordinator.project('codex', inputs([later]), { ...options, now: T + 120_000 }); await coordinator.flush();
  assert.equal(writes.mock.callCount(), 0);
  assert.equal(await readFile(file, 'utf8'), before);
  assert.equal((await archive.record({ ...(await archive.load()).entries[0],
    witnessCycle: later, estimatedAt: T + 120_000 })).outcome, 'unchanged');
});

test('checkpoint compaction keeps the initial episode key and stronger frozen receipt across restart', async t => {
  const { coordinator, archive, file } = await fixture(t), original = receipt();
  coordinator.project('codex', inputs([original]), options); await coordinator.flush();
  const [compacted] = buildCodexWitnessCycles([{ rows: [
    { segment: 0, from: T + 1000, through: T + 1000, resetAt: R, usedPercent: 20, baseline: true,
      baselineByModel: { known: vector(20) }, byModel: {}, complete: true },
    { segment: 0, from: T + 1000, through: T + 4000, resetAt: R, usedPercent: 50, baseline: false,
      byModel: { known: vector(30) }, complete: true },
  ], primaryByModel: { known: vector(50) } }], book, { now: T + 5000 });
  const opts = { ...options, now: T + 5000 }, data = inputs([compacted]);
  assert.equal(compacted.cycleStartAt, null);
  const result = coordinator.project('codex', data, opts);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].usedEquivalentUsd, original.knownUsd);
  assert.equal(result.entries[0].observedAt, original.through);
  await coordinator.flush();
  const saved = (await archive.load()).entries;
  assert.equal(saved.length, 2);
  assert.equal(saved[0].localWindowKey, saved[1].localWindowKey);
  assert.deepEqual(saved.map(x => x.revision), [1, 2]);
  const restarted = new WeeklyEstimateCoordinator(file, 'fixture-salt');
  restarted.project('codex', data, opts); await restarted.flush();
  const restored = restarted.project('codex', data, opts);
  assert.equal(restored.entries.length, 1);
  assert.equal(restored.entries[0].usedEquivalentUsd, original.knownUsd);
});

test('same reset with an explicit new episode keeps two rows and actual early-reset bounds', async t => {
  const { coordinator, archive } = await fixture(t);
  const row = (start: number, at: number, p: number, n: number, baseline: boolean, segment: number): CodexWitnessSource['rows'][number] => ({
    segment, from: T + start, through: T + at, resetAt: R, usedPercent: p, baseline, complete: true,
    byModel: baseline ? {} : { known: vector(n) }, ...(baseline ? { baselineByModel: { known: vector(n) } } : {}) });
  const cycles = buildCodexWitnessCycles([{ rows: [row(0, 0, 80, 100, true, 0), row(0, 1000, 90, 100, false, 0),
    row(2000, 2000, 0, 20, true, 1), row(2000, 3000, 20, 200, false, 1)],
  primaryByModel: { known: vector(420) } }], book, { now: T + 4000 });
  const opts = { ...options, now: T + 4000 }, data = inputs(cycles);
  const result = coordinator.project('codex', data, opts);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map(e => e.usedEquivalentUsd).sort(), [2, 2.2]);
  const first = result.entries.find(e => e.observedAt === T + 1000)!;
  assert.equal(first.quotaCycle?.endAt, T + 2000);
  assert.equal(first.quotaCycle?.closed, true);
  await coordinator.flush();
  assert.equal(new Set((await archive.load()).entries.map(e => e.localWindowKey)).size, 2);
});

test('witness archive disk validation rejects changed evidence and enforces the earliest clear fence', async t => {
  const { coordinator, archive, file } = await fixture(t);
  coordinator.project('codex', inputs([receipt()]), options); await coordinator.flush();
  const document = JSON.parse(await readFile(file, 'utf8'));
  for (const mutate of [
    (doc: typeof document) => { doc.entries[0].witnessCycle.knownUsd += 1; },
    (doc: typeof document) => { doc.entries[0].witnessCycle.pricebook = {}; },
    (doc: typeof document) => { doc.clearFences = [{ provider: 'codex', observedThrough: T + 1000 }]; },
  ]) {
    const bad = structuredClone(document); mutate(bad);
    await writeFile(file, JSON.stringify(bad));
    assert.equal((await archive.load()).status, 'invalid');
  }
  await writeFile(file, JSON.stringify(document));
  const saved = (await archive.load()).entries[0];
  const clock = t.mock.method(Date, 'now', () => T + 1000);
  await archive.clear({ provider: 'codex' }); clock.mock.restore();
  assert.equal((await archive.record(saved)).outcome, 'cleared-observation');
});

test('coverage-only declaration bypasses legacy reconstruction without manufacturing a numeric cycle', async t => {
  const { coordinator } = await fixture(t);
  const spy = t.mock.method(oldProducer, 'buildCodexWindowEstimates', () => { throw new Error('old producer called'); });
  const result = coordinator.project('codex', { usage: [], observations: [], codexQuotaCheckpoints: [],
    codexWitnessCoverage: coverage }, options);
  assert.equal(spy.mock.callCount(), 0);
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.codexWitnessCoverage, coverage);
  await coordinator.flush();
});
