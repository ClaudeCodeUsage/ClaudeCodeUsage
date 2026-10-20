import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createEmptyCodexIndex, CodexFileContribution, CodexIndexV1 } from '../providers/codex/codexIndex';
import { createCodexParserState } from '../providers/codex/codexParser';
import { createCodexQuotaCheckpointState } from '../providers/codex/codexQuotaCheckpoints';
import { buildCodexCalibrationCensus, isCodexCalibrationCensus, CODEX_CALIBRATION_CENSUS_MAX_SOURCES,
  CodexCalibrationCensus } from '../providers/codex/codexCalibrationCensus';
import { CodexAccountEstimator, OfficialQuotaSample } from '../codexAccountEstimate';
import type { WeeklyValueInputs } from '../weeklyValue';

const T = Date.parse('2026-10-20T02:00Z'), M = 60_000, R = T + 6 * 86_400_000;
const G = '1'.repeat(64), O = '2'.repeat(64), A = 'a'.repeat(64), S = 'c'.repeat(64);
const book = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .01, cachedInput: .001, output: .1 }] };
const tokens = (output: number) => ({ inputTotal: 0, cachedInput: 0, outputTotal: output, reasoningOutput: 0, sourceTotal: output });
function file(key: string, t: number, p: number, output: number, uncertain = false): CodexFileContribution {
  const from = uncertain ? T - 30 * M : T - M, through = uncertain ? T - 20 * M : t - 1000;
  const size = uncertain ? 1000 : 1000 + output;
  const state = createCodexQuotaCheckpointState(0);
  Object.assign(state, { indexedThrough: size, segment: 1, segmentResetAt: R, source: 1,
    pendingBoundary: uncertain, complete: !uncertain, segmentComplete: !uncertain,
    activityFrom: from, activityThrough: through, lastEventAt: through,
    observedTokens: tokens(output), byModel: { 'gpt-5': tokens(output) },
    ...(uncertain ? { pendingGapFrom: through, pendingGapUnknown: true } : {}) });
  state.rows = [{ segment: 1, from, through: from, resetAt: R, usedPercent: 10, baseline: true,
    byModel: {}, baselineByModel: {}, complete: !uncertain },
  { segment: 1, from, through, resetAt: R, usedPercent: p, baseline: false,
    byModel: { 'gpt-5': tokens(output) }, complete: !uncertain }];
  return { fileKey: key, sourceArea: 'sessions', size, offset: size, mtimeMs: through, dev: 1, ino: key === G ? 11 : 22,
    discardingOversizedLine: false, parserState: { ...createCodexParserState(key), model: 'gpt-5' },
    quotaCheckpoints: state, qualityFlags: [], identityChecked: true,
    aggregate: { total: tokens(output), byModel: { 'gpt-5': tokens(output) }, byDay: {}, byEffort: {},
      session: { sessionKey: key, role: 'root', startedAt: from, endedAt: through },
      structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } } };
}
function index(t = T, p = 20, output = 1000): CodexIndexV1 {
  const i = createEmptyCodexIndex('UTC'); i.files = { [G]: file(G, t, p, output), [O]: file(O, T, 10, 9000, true) };
  i.coverage.totalFiles = i.coverage.indexedFiles = 2;
  i.coverage.totalBytes = i.coverage.indexedBytes = i.files[G].size + i.files[O].size;
  return i;
}
function census(i: CodexIndexV1, at = T - 100, canonical = new Set(Object.keys(i.files)), ambiguous = new Set<string>()) {
  return buildCodexCalibrationCensus(i, true, canonical, ambiguous, at);
}
function sample(t: number, p: number, account = A): OfficialQuotaSample {
  return { accountScopeKey: account, sourceScopeKey: S, observedAt: t, requestedAt: t - 10, resetAt: R, usedPercent: p,
    quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' } };
}
function inputs(i: CodexIndexV1, proof = census(i)): WeeklyValueInputs & { codexCalibrationCensus?: CodexCalibrationCensus } {
  return { localHistoryComplete: true, calibrationPricebook: book, observations: [], usage: [],
    calibrationSourceScope: { verified: true, excludedSourceKeys: [O] },
    codexQuotaCheckpointsComplete: false,
    codexQuotaIncompleteRanges: [{ from: T - 20 * M, through: Number.MAX_SAFE_INTEGER }],
    codexQuotaCheckpoints: Object.values(i.files).flatMap(f => (f.quotaCheckpoints?.rows ?? []).map(r => ({ ...r, sourceKey: f.fileKey }))),
    codexCalibrationCensus: proof };
}
function next(t = T + M, p = 30, output = 1200) {
  const i = index(t, p, output); return { i, input: inputs(i, census(i, t - 100)) };
}
function appendMetadata(i: CodexIndexV1, key: string, at: number): void {
  const f = i.files[key]; f.size += 100; f.offset = f.size; f.mtimeMs = at;
  f.quotaCheckpoints!.indexedThrough = f.size; f.quotaCheckpoints!.activityThrough = at;
  f.aggregate.session.endedAt = at;
  f.parserState.model = 'gpt-5-mini'; // A turn_context changes future attribution, not admitted token counts.
}
test('producer issues detached immutable all-source proof, never serialized authority or raw labels', () => {
  const i = index(); i.files[O].parserState.projectName = 'PRIVATE-CANARY';
  const proof = census(i)!; assert.ok(proof); assert.ok(isCodexCalibrationCensus(proof));
  assert.equal(proof.sources.length, 2); assert.equal(proof.verifiedAt, T - 100);
  assert.ok(proof.sources.find(s => s.sourceKey === O)!.uncertain);
  assert.equal(proof.sources.find(s => s.sourceKey === O)!.ranges![0].through, Number.MAX_SAFE_INTEGER);
  assert.ok(Object.isFrozen(proof) && Object.isFrozen(proof.sources) && proof.sources.every(Object.isFrozen));
  assert.ok(!JSON.stringify(proof).includes('PRIVATE-CANARY'));
  assert.equal(isCodexCalibrationCensus(JSON.parse(JSON.stringify(proof))), false);
  assert.equal(isCodexCalibrationCensus(Object.freeze({ ...proof })), false);
  const frozen = JSON.stringify(proof); i.files[O].size++;
  assert.equal(JSON.stringify(proof), frozen);
  assert.equal(census(i, T + M), proof, 'one index object cannot reissue a later verification timestamp');
});
test('producer includes noncanonical and ambiguous files and refuses unverified or unread census', () => {
  const i = index(), proof = census(i, T - 100, new Set([G]), new Set([O]))!;
  assert.equal(proof.sources.length, 2); assert.equal(proof.sources.find(s => s.sourceKey === O)!.eligible, false);
  for (const mode of ['manifest', 'unread', 'stale', 'compressed', 'coverage', 'lineage'] as const) {
    const bad = index();
    if (mode === 'unread') bad.files[O].offset--;
    if (mode === 'stale') bad.files[O].qualityFlags.push('stale-file');
    if (mode === 'compressed') bad.files[O].compression = 'zstd';
    if (mode === 'coverage') bad.coverage.totalFiles++;
    if (mode === 'lineage') bad.files[O].lineage = { fingerprintBlocks: [], pendingFingerprints: [], tokenEvents: 1,
      desiredPrefixEvents: 1, appliedPrefixEvents: 0 };
    assert.equal(buildCodexCalibrationCensus(bad, mode !== 'manifest', new Set([G, O]), new Set(), T), undefined, mode);
  }
});
test('source-count and hashing byte budgets fail closed rather than issue partial proof', () => {
  const large = index(), shared = large.files[O]; large.files = {};
  for (let n = 0; n <= CODEX_CALIBRATION_CENSUS_MAX_SOURCES; n++) large.files[n.toString(16).padStart(64, '0')] = shared;
  large.coverage.totalFiles = large.coverage.indexedFiles = Object.keys(large.files).length;
  assert.equal(census(large), undefined);
  const oversized = index(); oversized.files[O].parserState.model = 'x'.repeat(1024 * 1024 + 1);
  assert.equal(census(oversized), undefined);
});
test('fresh verified source snapshots recover an exact delta despite an unchanged historical open tail', () => {
  const e = new CodexAccountEstimator(), base = index();
  assert.equal(e.observe(sample(T, 20), inputs(base), 'v1'), undefined);
  const n = next(); const x = e.observe(sample(T + M, 30), n.input, 'v1')!;
  assert.ok(x); assert.equal(x.usedEquivalentUsd, 20); assert.equal(x.fullEquivalentUsd, 200);
  assert.equal(x.calibrationEvidence!.interval.linkedSources, 1);
  assert.equal(x.calibrationEvidence!.interval.excludedSources, 1);
  const later = next(T + 2 * M, 40, 1400);
  assert.equal(e.observe(sample(T + 2 * M, 40), later.input, 'v1')!.usedEquivalentUsd, 40);
});
test('old objects, reissued cached indexes, serialized proof, future verification and stale verification never waive a tail', () => {
  for (const mode of ['same-object', 'reissued-index', 'serialized', 'future-verification', 'before-baseline', 'too-old'] as const) {
    const e = new CodexAccountEstimator(), i = index(), original = census(i)!;
    e.observe(sample(T, 20), inputs(i, original), 'v1');
    const at = mode === 'too-old' ? T + 10 * M : T + M, n = index(at, 30, 1200);
    const proof = mode === 'same-object' ? original : mode === 'reissued-index' ? census(i, at - 100) :
      mode === 'serialized' ? JSON.parse(JSON.stringify(census(n, at - 100))) :
      census(n, mode === 'future-verification' ? at + 1 : mode === 'too-old' ? T + 1 : T - 1);
    assert.equal(e.observe(sample(at, 30), inputs(n, proof), 'v1'), undefined, mode);
  }
});
test('every mutation of an unresolved source withholds the whole interval, even if known totals did not grow', () => {
  for (const mode of ['append', 'replacement', 'truncate', 'parser', 'checkpoint', 'lineage', 'ambiguity', 'canonical', 'new', 'removed'] as const) {
    const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(index()), 'v1');
    const n = index(T + M, 30, 1200), old = n.files[O], canonical = new Set([G, O]), ambiguous = new Set<string>();
    if (mode === 'append') { old.size++; old.offset++; old.quotaCheckpoints!.indexedThrough++; old.mtimeMs++; }
    if (mode === 'replacement') old.ino = 99;
    if (mode === 'truncate') { old.size--; old.offset--; old.quotaCheckpoints!.indexedThrough--; }
    if (mode === 'parser') old.parserState.schemaVersion = 3;
    if (mode === 'checkpoint') old.quotaCheckpoints!.version = 1 as any;
    if (mode === 'lineage') { old.lineage = { fingerprintBlocks: [], pendingFingerprints: [], tokenEvents: 1,
      desiredPrefixEvents: 1, appliedPrefixEvents: 1 }; old.quotaCheckpoints!.prefixEvents = 1; }
    if (mode === 'ambiguity') ambiguous.add(O);
    if (mode === 'canonical') canonical.delete(O);
    if (mode === 'new') { const k = '3'.repeat(64); n.files[k] = file(k, T, 10, 0, true); canonical.add(k); n.coverage.totalFiles++; n.coverage.indexedFiles++; }
    if (mode === 'removed') { delete n.files[O]; canonical.delete(O); n.coverage.totalFiles--; n.coverage.indexedFiles--; }
    assert.equal(e.observe(sample(T + M, 30), inputs(n, census(n, T + M - 100, canonical, ambiguous)), 'v1'), undefined, mode);
  }
});
test('known future activity blocks the static-source waiver, including newly eligible checkpoints', () => {
  const e = new CodexAccountEstimator(), first = index();
  first.files[O].quotaCheckpoints!.activityThrough = T + 2 * M;
  first.files[O].aggregate.session.endedAt = T + 2 * M;
  e.observe(sample(T, 20), inputs(first), 'v1');
  const n = index(T + M, 30, 1200);
  n.files[O] = first.files[O];
  assert.equal(e.observe(sample(T + M, 30), inputs(n, census(n, T + M - 100)), 'v1'), undefined);
});
test('a changed clean source omitted from checkpoint projection cannot disappear from the numerator', () => {
  const H = '3'.repeat(64), e = new CodexAccountEstimator();
  const make = (t: number, p: number, output: number) => {
    const i = index(t, p, output); i.files[H] = file(H, t, p, output * 2); i.files[H].ino = 33;
    i.coverage.totalFiles = i.coverage.indexedFiles = 3;
    const input = inputs(i, census(i, t - 100));
    input.codexQuotaCheckpoints = input.codexQuotaCheckpoints!.filter(row => row.sourceKey !== H);
    return input;
  };
  e.observe(sample(T, 20), make(T, 20, 1000), 'v1');
  assert.equal(e.observe(sample(T + M, 30), make(T + M, 30, 1200), 'v1'), undefined);
});
test('a fully paired active increment followed by parsed nonusage metadata remains admissible', () => {
  const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(index()), 'v1');
  const i = index(T + M, 30, 1200); appendMetadata(i, G, T + M - 500);
  const proof = census(i, T + M - 100)!;
  assert.equal(proof.sources.find(s => s.sourceKey === G)!.uncertain, false);
  const x = e.observe(sample(T + M, 30), inputs(i, proof), 'v1')!;
  assert.ok(x); assert.equal(x.usedEquivalentUsd, 20); assert.equal(x.fullEquivalentUsd, 200);
});
test('a known-complete metadata-only append contributes zero while another source supplies the paired USD', () => {
  const H = '3'.repeat(64), e = new CodexAccountEstimator();
  const make = (t: number, p: number, output: number, metadata: boolean) => {
    const i = index(t, p, output); i.files[H] = file(H, T, 20, 2000); i.files[H].ino = 33;
    i.coverage.totalFiles = i.coverage.indexedFiles = 3;
    if (metadata) appendMetadata(i, H, t - 500);
    return inputs(i, census(i, t - 100));
  };
  e.observe(sample(T, 20), make(T, 20, 1000, false), 'v1');
  const x = e.observe(sample(T + M, 30), make(T + M, 30, 1200, true), 'v1')!;
  assert.ok(x); assert.equal(x.usedEquivalentUsd, 20);
  assert.equal(x.calibrationEvidence!.interval.linkedSources, 1);
});
test('metadata changes cannot waive an uncertain tail, parse gap, or known future activity', () => {
  for (const mode of ['uncertain-tail', 'parse-gap', 'future'] as const) {
    const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(index()), 'v1');
    const i = index(T + M, 30, 1200), key = mode === 'uncertain-tail' ? O : G;
    appendMetadata(i, key, mode === 'future' ? T + 2 * M : T + M - 500);
    if (mode === 'parse-gap') Object.assign(i.files[G].quotaCheckpoints!,
      { complete: false, segmentComplete: false, pendingGapFrom: T + M - 1000, pendingGapUnknown: true });
    assert.equal(e.observe(sample(T + M, 30), inputs(i, census(i, T + M - 100)), 'v1'), undefined, mode);
  }
});
test('source/rate/index/account/clear fences survive the incremental-census path', () => {
  for (const mode of ['rate', 'generation', 'source', 'account', 'clear'] as const) {
    const e = new CodexAccountEstimator(); e.observe(sample(T, 20), inputs(index()), 'v1');
    const n = next(); assert.ok(e.observe(sample(T + M, 30), n.input, 'v1'));
    const later = next(T + 2 * M, 40, 1400), s = sample(T + 2 * M, 40);
    if (mode === 'generation') { later.i.indexGeneration = 2; later.input.codexCalibrationCensus = census({ ...later.i }, T + 2 * M - 100); }
    if (mode === 'rate') later.input.calibrationPricebook = { ...book, rates: [{ ...book.rates[0], output: .2 }] };
    if (mode === 'source') s.sourceScopeKey = 'd'.repeat(64);
    if (mode === 'account') s.accountScopeKey = 'b'.repeat(64);
    if (mode === 'clear') e.invalidateThrough(A, T + M + 1);
    assert.equal(e.observe(s, later.input, 'v1'), undefined, mode);
  }
});
