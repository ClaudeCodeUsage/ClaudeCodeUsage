import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex, CodexIndexV1 } from '../providers/codex/codexIndex';
import { createCodexParserState } from '../providers/codex/codexParser';
import { buildCodexForwardCalibration, CodexForwardCalibration, CodexForwardCalibrationSource,
  CodexForwardAppendWindow } from '../providers/codex/codexForwardCalibration';
import { CodexProvider } from '../providers/codex/codexProvider';
import { CodexAccountEstimator } from '../codexAccountEstimate';
import type { WeeklyValueInputs } from '../weeklyValue';

const T = Date.parse('2026-10-20T06:00Z'), M = 60_000, R = T + 604_799_000;
const K = '1'.repeat(64);
// Deliberately use primary state without historical calendar or quota sidecars.
function primary(n: number, key = K): CodexIndexV1 {
  const index = createEmptyCodexIndex('UTC'), at = T + n * 1000;
  const counts = { inputTotal: n, cachedInput: 0, cacheWriteInput: 0, outputTotal: n, reasoningOutput: 0, sourceTotal: 2 * n };
  index.files[key] = { fileKey: key, sourceArea: 'sessions', size: n * 100, offset: n * 100,
    mtimeMs: at, dev: 1, ino: 2, identityChecked: true, discardingOversizedLine: false, qualityFlags: [],
    parserState: { ...createCodexParserState(key), identityLocked: true, model: 'gpt-5' },
    lineage: { fingerprintBlocks: [], pendingFingerprints: Array.from({ length: n }, (_, i) => i.toString(16).padStart(32, '0')),
      tokenEvents: n, desiredPrefixEvents: 0, appliedPrefixEvents: 0 },
    aggregate: { total: counts, byModel: { 'gpt-5': counts }, byDay: {}, byEffort: {},
      session: { sessionKey: key, role: 'root', startedAt: T, endedAt: at },
      structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } },
    quotaHistory: [{ provider: 'codex', seriesKey: 'codex', observedAt: at, resetAt: R, usedPercent: n }],
    ...(n > 1 ? { calibrationAppend: { beforeOffset: (n - 1) * 100, throughOffset: n * 100,
      minUsageAt: at, maxUsageAt: at, complete: true } } : {}) };
  index.coverage.totalFiles = index.coverage.indexedFiles = 1;
  return index;
}
const build = (index: CodexIndexV1, previous?: unknown, at = T + M, bound = {}) => buildCodexForwardCalibration(index, true,
  new Set(Object.keys(index.files)), new Set(), at, bound, previous)!;
const windows = (source: CodexForwardCalibrationSource): readonly CodexForwardAppendWindow[] =>
  source.appendWindows ?? [];

test('trusted runtime windows bridge normalized warm reloads and retain separate watcher appends', () => {
  const first = build(primary(1)), second = build(primary(2), first), third = build(primary(3), second);
  const warm = build(normalizeCodexIndex(primary(3))!, third, T + 2 * M);
  assert.deepEqual(windows(warm.sources[0]).map(w => [w.beforeOffset, w.throughOffset]), [[100, 200], [200, 300]]);
  assert.deepEqual(warm.sources[0].appendWindow, third.sources[0].appendWindow);
  assert.ok(Object.isFrozen(windows(warm.sources[0])) && windows(warm.sources[0]).every(Object.isFrozen));
  assert.equal(warm.verifiedAt, T + 2 * M);
  assert.notEqual(warm, third);
});

test('copied proofs, unknown changes, replacement, eligibility and generation changes cannot carry history', () => {
  const old = build(primary(2));
  for (const previous of [undefined, { ...old }, structuredClone(old), JSON.parse(JSON.stringify(old))]) {
    assert.equal(windows(build(normalizeCodexIndex(primary(2))!, previous).sources[0]).length, 0);
  }
  for (const kind of ['unknown', 'replacement', 'generation', 'ineligible', 'gap', 'incomplete'] as const) {
    const index = primary(3), file = index.files[K];
    if (kind === 'unknown') delete file.calibrationAppend;
    if (kind === 'replacement') file.ino = 99;
    if (kind === 'generation') index.indexGeneration!++;
    if (kind === 'ineligible') file.qualityFlags.push('invalid-json');
    if (kind === 'gap') file.calibrationAppend!.beforeOffset = 250;
    if (kind === 'incomplete') file.calibrationAppend!.complete = false;
    assert.ok(!windows(build(index, old).sources[0]).some(w => w.beforeOffset === 100), kind);
  }
  const rebound = {}, index = primary(2), once = build(index, old, T + M, rebound);
  assert.equal(build(index, once, T + 2 * M, rebound), once, 'one verification cannot renew age');
});

test('window history keeps only a bounded suffix per source and bounds the global census', () => {
  let proof = build(primary(1));
  for (let n = 2; n <= 40; n++) proof = build(primary(n), proof);
  assert.equal(windows(proof.sources[0]).length, 32);
  assert.equal(windows(proof.sources[0])[0].beforeOffset, 800);
  assert.equal(windows(proof.sources[0])[31].throughOffset, 4000);
  // 160 independent sources exceed the global history budget of 512 windows.
  let previous: CodexForwardCalibration | undefined;
  for (let n = 1; n <= 34; n++) {
    const index = createEmptyCodexIndex('UTC');
    for (let i = 1; i <= 160; i++) {
      const key = i.toString(16).padStart(64, '0');
      index.files[key] = primary(n, key).files[key];
    }
    index.coverage.totalFiles = index.coverage.indexedFiles = 160;
    previous = build(index, previous);
  }
  assert.ok(previous!.sources.reduce((sum, source) => sum + windows(source).length, 0) <= 512);
  assert.ok(previous!.sources.reduce((sum, source) => sum + Buffer.byteLength(JSON.stringify(windows(source))), 0) <= 256 * 1024);
});

test('cross-scan reversals and metadata windows with changed dollars cannot bridge', () => {
  const previous = build(primary(2));
  for (const at of [T + 1000, T + 2000]) {
    const index = primary(3);
    index.files[K].calibrationAppend!.minUsageAt = index.files[K].calibrationAppend!.maxUsageAt = at;
    const source = build(index, previous).sources[0];
    assert.equal(windows(source).length, 0);
    assert.equal(source.appendWindow!.complete, false);
  }
  const metadata = primary(3), file = metadata.files[K], old = primary(2).files[K];
  file.calibrationAppend!.minUsageAt = file.calibrationAppend!.maxUsageAt = null;
  assert.equal(windows(build(metadata, previous).sources[0]).length, 0, 'null timestamps do not excuse changed usage');
  file.aggregate = structuredClone(old.aggregate); file.parserState = structuredClone(old.parserState);
  file.lineage = structuredClone(old.lineage);
  const source = build(metadata, previous).sources[0];
  assert.equal(windows(source).length, 2, 'known metadata-only append extends the exact offset chain');
  assert.equal(windows(source)[1].minUsageAt, null);
});

test('provider carries scanner windows across worker-equivalent reloads through three official brackets', async t => {
  let now = T + M, body = JSON.stringify({ type: 'session_meta', payload: { id: 'synthetic' } }) + '\n' +
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5' } }) + '\n';
  let disk = createEmptyCodexIndex('UTC'), reads = 0;
  const add = (at: number, percent: number, input: number) => { body += JSON.stringify({ type: 'event_msg',
    timestamp: new Date(at).toISOString(), payload: { type: 'token_count', info: { last_token_usage: {
      input_tokens: input, output_tokens: 0 } }, rate_limits: { limit_id: 'codex', secondary: {
      used_percent: percent, window_minutes: 10080, resets_at: R } } } }) + '\n'; };
  const provider = new CodexProvider({ enabled: true, codexHome: '/synthetic/not-read',
    indexPath: '/synthetic/not-written', salt: 'synthetic', timeZone: 'UTC', allowAchievementHourProof: false }, () => ({
    refresh: async () => {
      const entry = { fileKey: K, sourceArea: 'sessions' as const, size: Buffer.byteLength(body),
        mtimeMs: T + Buffer.byteLength(body), dev: 1, ino: 2 };
      const result = await updateCodexIndex(normalizeCodexIndex(disk)!, {
        files: [{ ...entry, absolutePath: '/synthetic/not-read', nonPersisted: true }], persistable: { [K]: entry },
      }, { salt: 'synthetic', timeZone: 'UTC', now: () => now, allowHistoricalBackfill: false,
        allowAchievementHourProof: false, io: { async *read(_entry, start, end) {
          reads++;
          if (reads > 1) assert.ok(start > 0, 'subsequent scans never replay the old primary prefix');
          yield Buffer.from(body).subarray(start, end);
        } } });
      // Simulate an existing primary cache awaiting historical calendar work.
      // Forward collection must not depend on reconstructing that projection.
      delete result.index.files[K].aggregate.period;
      result.index.coverage.period.allTime.complete = false;
      disk = normalizeCodexIndex(result.index)!;
      assert.equal(disk.files[K].calibrationAppend, undefined, 'P1 contains no append authority');
      return structuredClone({ ...result, metadataMs: 0, parseMs: 0 });
    }, dispose() {},
  }));
  t.after(() => provider.dispose());
  t.mock.method(Date, 'now', () => now);
  t.mock.method(provider, 'isAvailable', async () => true);
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
  add(now - 1000, 10, 1000);
  const firstSnapshot = (await provider.refresh()).snapshot;
  const first = firstSnapshot.weeklyValueInputs!.codexForwardCalibration!;
  assert.equal(first.sources[0].eligible, true, 'real scanner uses a packed partial lineage block');
  assert.equal(firstSnapshot.coverage.period.allTime.complete, false);
  assert.ok(firstSnapshot.weeklyValueInputs!.calibrationPricebook!.rates.some(rate => rate.model === 'gpt-5'));
  const estimator = new CodexAccountEstimator();
  const observe = (percent: number, inputs: WeeklyValueInputs) => estimator.observe({
    accountScopeKey: 'a'.repeat(64), sourceScopeKey: 'b'.repeat(64), requestedAt: now + 100, observedAt: now + 200,
    usedPercent: percent, resetAt: R,
    quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' },
  }, inputs, 'synthetic');
  assert.equal(observe(10, firstSnapshot.weeklyValueInputs!), undefined);
  const official = [first];
  for (const percent of [20, 30]) {
    now += 20_000; add(now - 1000, percent - 5, 2000); await provider.refresh();
    now += 20_000; add(now - 1000, percent, 3000); await provider.refresh();
    now += 20_000;
    const beforeReads = reads;
    const inputs = (await provider.refresh()).snapshot.weeklyValueInputs!;
    const warm = inputs.codexForwardCalibration!;
    assert.equal(reads, beforeReads, 'official-bracket warm refresh reads no body');
    const baseline = official[official.length - 1].sources[0].offset;
    const chain = windows(warm.sources[0]).filter(w => w.beforeOffset >= baseline);
    assert.equal(chain.length, 2);
    assert.equal(chain[0].beforeOffset, baseline);
    assert.equal(chain[0].throughOffset, chain[1].beforeOffset);
    assert.equal(chain[1].throughOffset, warm.sources[0].offset);
    assert.ok(chain.every(w => w.complete && w.minUsageAt! > official[official.length - 1].verifiedAt + 200 &&
      w.maxUsageAt! <= warm.verifiedAt + 100), 'all usage fits the prior official completion / current request bracket');
    official.push(warm);
    const estimate = observe(percent, inputs);
    if (percent === 20) assert.equal(estimate, undefined, 'discard the arbitrary initial percentage span');
    else {
      const rate = inputs.calibrationPricebook!.rates.find(rate => rate.model === 'gpt-5')!.input;
      assert.ok(estimate && Math.abs(estimate.fullEquivalentUsd! - 5000 * rate / .1) < 1e-10);
      assert.equal(estimate.calibrationEvidence!.accumulated.deltaPercent, 10);
      assert.equal(estimate.calibrationEvidence!.accumulated.totalTokens, 5000);
      assert.equal(estimate.calibrationEvidence!.collectionMode, 'forward-matched-cut-v1');
      assert.equal(estimate.calibrationEvidence!.methodVersion, 2);
      assert.equal(estimate.calibrationEvidence!.matchedCut!.percentThrough - estimate.calibrationEvidence!.matchedCut!.percentFrom, 10);
    }
  }
  assert.equal(official.length, 3);
  assert.equal(windows(official[2].sources[0]).length, 4, 'old chain remains selectable after an official sample');
});
