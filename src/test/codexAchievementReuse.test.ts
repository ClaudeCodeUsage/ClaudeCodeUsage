import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as revision from '../codexAchievementRevision';
import { codexAchievementCalendarProjection } from '../achievementCalendar';
import { codexAchievementMoneyScopes } from '../achievementMoneyScopes';
import { snapshotFixture } from './codexFixtures';
import { CODEX_PERIOD_LINEAGE_VERSION } from '../providers/codex/codexPeriodIndex';

const fence = { indexed: true, calendarComplete: true, timeZone: 'UTC' };
function fixture() {
  const files = snapshotFixture().files.slice(0, 2);
  for (const file of files) {
    Object.assign(file.period!, { indexedThrough: 100, lineageVersion: CODEX_PERIOD_LINEAGE_VERSION, lineagePrefixEvents: 0 });
    file.achievementPeriodWitness = { size: 100, offset: 100, expectedPrefixEvents: 0, timeZone: 'UTC' };
  }
  return files;
}
const capture = (files: ReturnType<typeof fixture>, previous?: ReturnType<typeof fixture>) =>
  revision.immutableCodexAchievementFiles(files, previous);
const project = (files: ReturnType<typeof fixture>, indexed = true, complete = true, zone = 'UTC') =>
  codexAchievementCalendarProjection(files, zone, indexed, complete);
const money = (files: ReturnType<typeof fixture>, dayEvidence = project(files).evidence) =>
  codexAchievementMoneyScopes({ files, complete: true, dayEvidence, backend: 'openai', asOfDay: '2026-08-03' });

test('producer capture detaches and freezes all proof fields; identical complete input reuses identity', () => {
  const source = fixture(), files = capture(source);
  assert.notEqual(files, source);
  assert.equal(capture(structuredClone(source), files), files);
  source[0].byEffort.high.cacheWriteInput = -1;
  assert.notEqual(files[0].byEffort.high.cacheWriteInput, -1);
  assert.throws(() => { files[0].achievementPeriodWitness!.offset--; }, TypeError);
  assert.throws(() => { files[0].period!.days['2026-07-20'].total.inputTotal--; }, TypeError);
  assert.throws(() => { files.push(files[0]); }, TypeError);
  assert.notEqual(capture(source, files), files, 'unchanged totals cannot authorize reuse');
});

test('immutable capture preserves invalid numeric distinctions and declines mutable internal state or accessors', () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, -1, '0', false]) {
    const source = fixture();
    (source[0].byEffort.high as any).cacheWriteInput = value;
    const files = capture(source);
    assert.equal(revision.codexAchievementProofRevision(files, fence), revision.codexAchievementProofRevision(source, fence));
  }
  for (const extra of [new Map(), new Date(), () => 1]) {
    const source = fixture(); (source[0] as any).extra = extra;
    assert.equal(capture(source), source);
    assert.equal(revision.isImmutableCodexAchievementFiles(source), false);
  }
  const accessor = fixture();
  Object.defineProperty(accessor[0].total, 'inputTotal', { enumerable: true, get: () => 1 });
  assert.equal(capture(accessor), accessor);
  const source = fixture();
  Object.defineProperty(source[0].byModel, '__proto__', { value: { inputTotal: 0, outputTotal: 0 }, enumerable: true });
  const files = capture(source);
  assert.equal(Object.getPrototypeOf(files[0].byModel), Object.prototype);
  assert.ok(Object.prototype.hasOwnProperty.call(files[0].byModel, '__proto__'));
});

test('immutable census evaluates revision and calendar once, including MoneyScopes binding', (t) => {
  const files = capture(fixture());
  let hashes = 0;
  const original = crypto.createHash;
  t.mock.method(crypto, 'createHash', (...args: Parameters<typeof original>) => { hashes++; return original(...args); });
  const digest = revision.codexAchievementProofRevision(files, fence);
  const first = project(files);
  const value = money(files, first.evidence);
  assert.equal(first.evidence.complete, true);
  assert.ok(value.completedMondayWeekPeak! > 0);
  assert.equal(project(files), first);
  assert.equal(revision.codexAchievementProofRevision(files, fence), digest);
  assert.equal(hashes, 1, 'calendar and money must reuse the host revision');
  assert.throws(() => { first.evidence.days[0].processed++; }, TypeError);
  assert.throws(() => { first.completeDateFiles.pop(); }, TypeError);
  const forged = structuredClone(first.evidence); forged.days[0].processed++;
  assert.equal(money(files, forged).completedMondayWeekPeak, undefined);
  assert.equal(money(files).completedMondayWeekPeak, value.completedMondayWeekPeak);
});

test('independent coverage and timezone fences cannot hit a cached complete proof', () => {
  const files = capture(fixture()), first = project(files);
  assert.equal(project(files, false).evidence.complete, false);
  assert.equal(project(files, true, false).evidence.scope, 'verified-subset');
  assert.deepEqual(project(files, true, true, 'Asia/Shanghai').evidence.days, []);
  assert.deepEqual(project(files), first);
  assert.notEqual(revision.codexAchievementProofRevision(files, { ...fence, indexed: false }), first.evidence.sourceRevision);
});

test('mutable and merely shallow-frozen censuses are never cached by reference', () => {
  for (const shallow of [false, true]) {
    const files = fixture(); if (shallow) Object.freeze(files);
    const first = project(files), digest = revision.codexAchievementProofRevision(files, fence);
    files[0].period!.indexedThrough--;
    assert.notEqual(revision.codexAchievementProofRevision(files, fence), digest);
    assert.notDeepEqual(project(files), first);
    assert.equal(money(files, first.evidence).completedMondayWeekPeak, undefined);
  }
});

test('every proof-only mutation retires producer reuse even with equal display totals', () => {
  const files = capture(fixture()), before = project(files).evidence;
  const mutations: Array<(files: ReturnType<typeof fixture>) => void> = [
    f => { f[0].period!.indexedThrough--; },
    f => { f[0].achievementPeriodWitness!.size++; },
    f => { f[0].achievementPeriodWitness!.offset--; },
    f => { f[0].achievementPeriodWitness!.expectedPrefixEvents++; },
    f => { f[0].achievementPeriodWitness!.timeZone = 'Asia/Shanghai'; },
    f => { delete f[0].achievementPeriodWitness; },
    f => { f[0].period!.lineageVersion = f[0].period!.lineageVersion! - 1; },
    f => { f[0].period!.lineagePrefixEvents = f[0].period!.lineagePrefixEvents! + 1; },
    f => { f[0].session.parentSessionKey = f[1].session.sessionKey; f[0].session.role = 'subagent'; },
    f => { f.push(structuredClone(f[0])); },
    f => { f[0].byEffort.high.cacheWriteInput = -1; },
    f => { const tokens = f[0].period!.days['2026-07-20'].byModel['gpt-5.6-sol']; tokens.cachedInput = tokens.cachedInput! - 1; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(files); mutate(changed);
    const next = capture(changed, files);
    assert.notEqual(next, files);
    assert.notEqual(revision.codexAchievementProofRevision(next, fence), before.sourceRevision);
    assert.equal(money(next, before).completedMondayWeekPeak, undefined);
  }
});
