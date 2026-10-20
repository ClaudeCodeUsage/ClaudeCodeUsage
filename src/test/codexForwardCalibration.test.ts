import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createEmptyCodexIndex, normalizeCodexIndex, CodexIndexV1, CodexFileContribution } from '../providers/codex/codexIndex';
import { createCodexParserState } from '../providers/codex/codexParser';
import { createCodexQuotaCheckpointState } from '../providers/codex/codexQuotaCheckpoints';
import { CodexProvider } from '../providers/codex/codexProvider';
import { buildCodexForwardCalibration, isCodexForwardCalibration, isCodexForwardAppend,
  CODEX_FORWARD_CALIBRATION_MAX_SOURCES, CODEX_FORWARD_CALIBRATION_MAX_BYTES } from '../providers/codex/codexForwardCalibration';

const T = Date.parse('2026-10-20T02:00Z'), K = '1'.repeat(64), H = '2'.repeat(64);
const tokens = (n: number) => ({ inputTotal: n, cachedInput: 0, outputTotal: n, reasoningOutput: 0 });
function file(key = K, n = 1): CodexFileContribution {
  return { fileKey: key, sourceArea: 'sessions', size: 100 * n, offset: 100 * n, mtimeMs: T + n,
    dev: 1, ino: key === K ? 11 : 12, identityChecked: true, discardingOversizedLine: false,
    parserState: { ...createCodexParserState(key), identityLocked: true, model: 'gpt-5' },
    lineage: { fingerprintBlocks: [], pendingFingerprints: Array.from({ length: n }, (_, i) => i.toString(16).padStart(32, '0')),
      tokenEvents: n, desiredPrefixEvents: 0, appliedPrefixEvents: 0 }, qualityFlags: [],
    aggregate: { total: tokens(n), byModel: { 'gpt-5': tokens(n) }, byDay: {}, byEffort: {},
      session: { sessionKey: key, role: 'root', startedAt: T - 1000, endedAt: T + n },
      structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } },
    quotaHistory: [{ provider: 'codex', seriesKey: 'codex', observedAt: T + n, resetAt: T + 86400000, usedPercent: 20 + n }] };
}
function index(n = 1): CodexIndexV1 {
  const i = createEmptyCodexIndex('UTC'); i.files = { [K]: file(K, n) };
  i.coverage.totalFiles = i.coverage.indexedFiles = 1;
  i.coverage.period.allTime.complete = false;
  return i;
}
const build = (i: CodexIndexV1, at = T + 100, canonical = new Set(Object.keys(i.files)), ambiguous = new Set<string>()) =>
  buildCodexForwardCalibration(i, true, canonical, ambiguous, at);

test('forward proof needs no period or quota sidecar and copies only immutable numeric evidence', () => {
  const i = index(); i.files[K].parserState.projectName = 'PRIVATE-CANARY';
  const p = build(i)!;
  assert.ok(isCodexForwardCalibration(p)); assert.equal(p.schemaVersion, 1);
  assert.equal(p.sources[0].eligible, true); assert.equal(p.sources[0].uncertain, false);
  assert.equal(p.sources[0].byModel!['gpt-5'].outputTotal, 1);
  assert.equal(p.sources[0].quotaWitness?.usedPercent, 21);
  assert.equal(p.sources[0].usageFrom, T - 1000);
  assert.equal(p.sources[0].usageThrough, T + 1);
  assert.equal(p.sources[0].activityThrough, null, 'primary aggregates omit some nonusage activity');
  assert.equal(p.sources[0].incrementFrom, null, 'latest usage is not the earliest appended request');
  assert.doesNotMatch(JSON.stringify(p), /PRIVATE-CANARY|sessionKey|projectName/);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.sources) && Object.isFrozen(p.sources[0].byModel!['gpt-5']));
  const old = JSON.stringify(p); i.files[K].aggregate.byModel['gpt-5'].outputTotal++;
  assert.equal(JSON.stringify(p), old);
  assert.equal(isCodexForwardCalibration(JSON.parse(old)), false);
  assert.equal(isCodexForwardCalibration(Object.freeze({ ...p })), false);
});
test('one verification bound cannot renew authority; a distinct actual verification may issue a fresh proof', () => {
  const i = index(), p = build(i)!;
  assert.equal(build(i, T + 1000), p);
  const bound = {}, next = buildCodexForwardCalibration(i, true, new Set([K]), new Set(), T + 200, bound)!;
  assert.notEqual(next, p); assert.equal(next.verifiedAt, T + 200);
  assert.equal(buildCodexForwardCalibration(i, true, new Set([K]), new Set(), T + 300, bound), next);
  assert.equal(buildCodexForwardCalibration(i, false, new Set([K]), new Set(), T + 400, bound), undefined);
});
test('all physical sources remain explicit when noncanonical, ambiguous, unfinished or invalid', () => {
  for (const mode of ['noncanonical', 'ambiguous', 'unfinished', 'lineage', 'numeric', 'unknown-model', 'stale', 'compressed'] as const) {
    const i = index(); i.files[H] = file(H); i.coverage.totalFiles = 2;
    const f = i.files[H], canonical = new Set([K, H]), ambiguous = new Set<string>();
    if (mode === 'noncanonical') canonical.delete(H);
    if (mode === 'ambiguous') ambiguous.add(H);
    if (mode === 'unfinished') f.offset--;
    if (mode === 'lineage') f.lineage!.desiredPrefixEvents = 1;
    if (mode === 'numeric') f.aggregate.byModel['gpt-5'].cachedInput = 5;
    if (mode === 'unknown-model') f.aggregate.byModel = {};
    if (mode === 'stale') f.qualityFlags.push('stale-file');
    if (mode === 'compressed') f.compression = 'zstd';
    const p = build(i, T + 100, canonical, ambiguous)!;
    assert.equal(p.sources.length, 2, mode);
    assert.equal(p.sources[1].eligible, false, mode); assert.equal(p.sources[1].uncertain, true, mode);
    assert.equal(isCodexForwardAppend(p.sources[1], build(index(2))!.sources[0]), false);
  }
});
test('append proof checks retained fingerprint prefix, physical ownership, counters and uncertainty', () => {
  const before = build(index())!.sources[0], after = build(index(2))!.sources[0];
  assert.equal(isCodexForwardAppend(before, after), true);
  assert.equal(isCodexForwardAppend({ ...before }, after), false);
  for (const mode of ['replace', 'prefix', 'rewrite', 'regress', 'uncertain', 'same-size'] as const) {
    const i = index(2), f = i.files[K];
    if (mode === 'replace') f.ino = 99;
    if (mode === 'prefix') f.lineage!.desiredPrefixEvents = f.lineage!.appliedPrefixEvents = 1;
    if (mode === 'rewrite') f.lineage!.pendingFingerprints[0] = 'f'.repeat(32);
    if (mode === 'regress') f.aggregate.total = f.aggregate.byModel['gpt-5'] = tokens(0);
    if (mode === 'uncertain') f.qualityFlags.push('invalid-event-timestamp');
    if (mode === 'same-size') f.size = f.offset = 100;
    assert.equal(isCodexForwardAppend(before, build(i)!.sources[0]), false, mode);
  }
});
test('malformed or oversized census fails closed instead of dropping sources', () => {
  const i = index(); i.coverage.totalFiles = 2; assert.equal(build(i), undefined);
  const large = index(); large.files = {};
  for (let n = 0; n <= CODEX_FORWARD_CALIBRATION_MAX_SOURCES; n++) large.files[n.toString(16).padStart(64, '0')] = file();
  large.coverage.totalFiles = Object.keys(large.files).length; assert.equal(build(large), undefined);
  const invalid = index(); invalid.files[K].lineage!.pendingFingerprints = ['not-a-fingerprint'];
  assert.equal(build(invalid)!.sources[0].eligible, false);
});

test('changes to unavailable numeric or malformed lineage evidence never look like a static exclusion', () => {
  const first = index(), next = index();
  first.files[K].aggregate.byModel['gpt-5'].cachedInput = 9;
  next.files[K].aggregate.byModel['gpt-5'].cachedInput = 10;
  const a = build(first)!.sources[0], b = build(next)!.sources[0];
  assert.equal(a.byModel, null); assert.equal(b.byModel, null); assert.notEqual(a.revision, b.revision);
  const one = index(), two = index();
  one.files[K].lineage!.pendingFingerprints = ['bad-one']; two.files[K].lineage!.pendingFingerprints = ['bad-two'];
  assert.notEqual(build(one)!.sources[0].revision, build(two)!.sources[0].revision);
  for (const field of ['size', 'offset', 'mtimeMs'] as const) {
    const before = index(2), after = index(2);
    before.files[K].qualityFlags.push('historical-uncertainty');
    after.files[K].qualityFlags.push('historical-uncertainty');
    if (field === 'offset') after.files[K].offset--;
    else after.files[K][field]++;
    assert.notEqual(build(before)!.sources[0].revision, build(after)!.sources[0].revision, field);
  }
});

test('conflicting latest local quota facts cannot create a matching witness', () => {
  const i = index(); i.files[K].quotaHistory!.push({ ...i.files[K].quotaHistory![0], usedPercent: 90 });
  assert.equal(build(i)!.sources[0].quotaWitness, null);
});

test('historical sidecars are never traversed and cannot affect forward proof size, revision or continuity', () => {
  const clean = build(index(2))!;
  const i = index(2);
  Object.defineProperty(i.files[K], 'quotaCheckpoints', { get() { throw new Error('historical-sidecar-read'); } });
  const withoutRead = build(i)!;
  assert.deepEqual(withoutRead, clean);
  const large = index(2), state = createCodexQuotaCheckpointState(0);
  Object.assign(state, { historicalPayload: 'x'.repeat(9 * 1024 * 1024) });
  large.files[K].quotaCheckpoints = state;
  const compact = build(large)!;
  assert.ok(compact); assert.deepEqual(compact, clean);
  assert.equal(compact.sources[0].checkpoints, null);
  assert.equal(compact.sources[0].incompleteRanges, null);
  const legacy = index(2); legacy.files[K].quotaCheckpoints = { ...state, version: 4 } as any;
  assert.deepEqual(build(legacy), clean, 'sidecar version alone cannot alter primary revision');
  const draft = index(2), f = draft.files[K];
  f.lineageReconciliation = { offset: 100, discardingOversizedLine: false, prefixEvents: 0,
    tokenEventsSeen: 1, parserState: f.parserState, aggregate: f.aggregate, qualityFlags: [] };
  const before = build(structuredClone(draft))!;
  Object.defineProperty(f.lineageReconciliation, 'quotaCheckpoints', {
    get() { throw new Error('nested-historical-sidecar-read'); },
  });
  assert.deepEqual(build(draft), before, 'reconciliation revision contains only primary evidence');
});

test('a 7534-source synthetic primary census fits the 8 MiB proof bound without history payloads', t => {
  const i = index(); i.files = {};
  for (let n = 0; n < 7534; n++) {
    const key = n.toString(16).padStart(64, '0'); i.files[key] = file(key);
  }
  i.coverage.totalFiles = i.coverage.indexedFiles = 7534;
  const proof = build(i)!;
  assert.ok(proof); assert.equal(proof.sources.length, 7534);
  const bytes = Buffer.byteLength(JSON.stringify(proof));
  assert.ok(bytes <= CODEX_FORWARD_CALIBRATION_MAX_BYTES);
  t.diagnostic(`syntheticSources=7534 proofBytes=${bytes} maxProofBytes=${CODEX_FORWARD_CALIBRATION_MAX_BYTES}`);
});

test('scan append windows are copied strictly, never inferred from primary latest timestamps', () => {
  const scan = { beforeOffset: 100, throughOffset: 200, minUsageAt: T + 1, maxUsageAt: T + 2, complete: true };
  const attach = (i: CodexIndexV1, raw: unknown) => Object.assign(i.files[K], { calibrationAppend: raw });
  const i = index(2); attach(i, scan);
  const source = build(i)!.sources[0];
  assert.deepEqual(source.appendWindow, { beforeOffset: 100, throughOffset: 200,
    minUsageAt: T + 1, maxUsageAt: T + 2, complete: true });
  assert.ok(Object.isFrozen(source.appendWindow));
  scan.minUsageAt = T - 1000; assert.equal(source.appendWindow!.minUsageAt, T + 1);
  for (const raw of [undefined, { ...scan, throughOffset: 199 }, { ...scan, beforeOffset: 200 },
    { ...scan, minUsageAt: null }, { ...scan, minUsageAt: T + 3 }, { ...scan, maxUsageAt: NaN }]) {
    const next = index(2); attach(next, raw); assert.equal(build(next)!.sources[0].appendWindow, undefined);
  }
  const gap = index(2); attach(gap, { ...scan, complete: false });
  assert.equal(build(gap)!.sources[0].appendWindow?.complete, false);
  const unfinished = index(2); unfinished.files[K].offset = 199;
  attach(unfinished, { ...scan, throughOffset: 199 });
  assert.equal(build(unfinished)!.sources[0].appendWindow?.complete, false);
  const metadata = index(2); attach(metadata, { ...scan, minUsageAt: null, maxUsageAt: null });
  assert.equal(build(metadata)!.sources[0].appendWindow?.minUsageAt, null);
});

test('worker transport retains live numeric windows but normalized disk data cannot restore append authority', () => {
  const i = index(2);
  i.files[K].calibrationAppend = { beforeOffset: 100, throughOffset: 200,
    minUsageAt: T + 1, maxUsageAt: T + 2, complete: true };
  const transported = structuredClone(i), proof = build(transported)!;
  assert.equal(proof.sources[0].appendWindow?.complete, true);
  assert.equal(isCodexForwardCalibration(structuredClone(proof)), false);
  const normalized = normalizeCodexIndex(JSON.parse(JSON.stringify(transported)))!;
  assert.equal(normalized.files[K].calibrationAppend, undefined);
  const freshBaseline = build(normalized)!;
  assert.ok(isCodexForwardCalibration(freshBaseline));
  assert.equal(freshBaseline.sources[0].appendWindow, undefined);
  assert.equal(freshBaseline.sources[0].incrementFrom, null);
});

test('provider publishes fresh forward proof without all-time history and withdraws display/failure authority', async t => {
  const i = index(); let fail = false, failedFiles = 0, now = T + 100;
  const provider = new CodexProvider({ enabled: true, codexHome: '/synthetic/not-read', salt: 'synthetic',
    timeZone: 'UTC', indexPath: '/synthetic/not-written', allowAchievementHourProof: false }, () => ({
      refresh: async () => {
        if (fail) throw new Error('synthetic-failure');
        now += 100;
        return { index: i, indexChanged: false, bodyReads: 0, failedFiles, metadataMs: 0,
          parseMs: 0, migration: { filePasses: 0, bytesRead: 0, pending: false } };
      }, dispose() {},
    }));
  t.after(() => provider.dispose());
  t.mock.method(Date, 'now', () => now);
  t.mock.method(provider, 'isAvailable', async () => true);
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
  const first = await provider.refresh(), p = first.snapshot.weeklyValueInputs!.codexForwardCalibration!;
  assert.ok(isCodexForwardCalibration(p)); assert.equal(p.verifiedAt, T + 100);
  assert.equal(first.snapshot.weeklyValueInputs!.codexCalibrationCensus, undefined);
  const next = await provider.refresh();
  assert.notEqual(next.snapshot.weeklyValueInputs!.codexForwardCalibration, p);
  assert.equal((await provider.loadPersistedSnapshot())!.weeklyValueInputs!.codexForwardCalibration, undefined);
  failedFiles = 1;
  assert.equal((await provider.refresh()).snapshot.weeklyValueInputs!.codexForwardCalibration, undefined);
  fail = true;
  assert.equal((await provider.refresh()).snapshot.weeklyValueInputs!.codexForwardCalibration, undefined);
});
