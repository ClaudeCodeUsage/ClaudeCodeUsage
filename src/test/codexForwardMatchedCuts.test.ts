import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex } from '../providers/codex/codexIndex';
import { createCodexParserState } from '../providers/codex/codexParser';
import { buildCodexForwardCalibration, CodexForwardCalibration } from '../providers/codex/codexForwardCalibration';

const T = Date.parse('2026-10-22T01:00Z'), K = '1'.repeat(64), J = '2'.repeat(64), R = T + 604800000;
const tokens = (n: number) => ({ inputTotal: n, cachedInput: 0, outputTotal: 0, reasoningOutput: 0 });
const book = { schemaVersion: 1, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .01, cachedInput: .001, output: .02 }] };
const envelope = { from: T + 7000, through: T + 300000, resetAt: R, percentFrom: 36, percentThrough: 40 };
const project = (...args: unknown[]) => require('../providers/codex/codexForwardMatchedCuts').projectCodexForwardMatchedCuts(...args);
function fixture(amounts = [100, 100, 1000, 1000], mutate?: (file: any) => void,
  peer?: 'normal' | 'straddle' | 'removed') {
  const index = createEmptyCodexIndex('UTC');
  const initial = tokens(100);
  index.files[K] = { fileKey: K, sourceArea: 'sessions', size: 100, offset: 100, mtimeMs: T - 1000,
    dev: 1, ino: 2, identityChecked: true, discardingOversizedLine: false, qualityFlags: [],
    parserState: { ...createCodexParserState(K), identityLocked: true, model: 'gpt-5' },
    lineage: { fingerprintBlocks: [], pendingFingerprints: ['0'.repeat(32)], tokenEvents: 1,
      desiredPrefixEvents: 0, appliedPrefixEvents: 0 },
    aggregate: { total: initial, byModel: { 'gpt-5': initial }, byDay: {}, byEffort: {},
      session: { sessionKey: K, role: 'root', startedAt: T - 2000, endedAt: T - 1000 },
      structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } } };
  if (peer) {
    const other = structuredClone(index.files[K]); other.fileKey = J; other.ino = 3;
    other.parserState = { ...createCodexParserState(J), identityLocked: true, model: 'gpt-5' };
    other.aggregate.session.sessionKey = J; index.files[J] = other;
  }
  index.coverage.totalFiles = index.coverage.indexedFiles = Object.keys(index.files).length;
  const before = buildCodexForwardCalibration(index, true, new Set(Object.keys(index.files)), new Set(), T, {})!;
  const next = normalizeCodexIndex(index)!, f = next.files[K];
  const dates = [T + 3000, T + 20000, T + 100000, T + 200000];
  const slices = dates.map((at, i) => ({ from: at, through: at, model: 'gpt-5', tokens: tokens(amounts[i]),
    quota: { observedAt: at, resetAt: R, usedPercent: 36 + i } }));
  f.size = f.offset = 500; f.mtimeMs = dates[3];
  f.aggregate.total = tokens(100 + amounts.reduce((a, b) => a + b, 0));
  f.aggregate.byModel = { 'gpt-5': f.aggregate.total }; f.aggregate.session.endedAt = dates[3];
  f.lineage!.tokenEvents = 5;
  f.lineage!.pendingFingerprints = Array.from({ length: 5 }, (_, i) => i.toString(16).padStart(32, '0'));
  f.calibrationAppend = { beforeOffset: 100, throughOffset: 500, minUsageAt: dates[0],
    maxUsageAt: dates[3], complete: true, slices } as any;
  if (peer === 'removed') delete next.files[J];
  else if (peer) {
    const other = next.files[J], from = T + (peer === 'straddle' ? 19000 : 100000);
    const through = T + (peer === 'straddle' ? 21000 : 100000);
    other.size = other.offset = 200; other.mtimeMs = through; other.aggregate.session.endedAt = through;
    other.aggregate.total = tokens(600); other.aggregate.byModel = { 'gpt-5': tokens(600) };
    other.lineage!.tokenEvents = 2; other.lineage!.pendingFingerprints.push('1'.repeat(32));
    other.calibrationAppend = { beforeOffset: 100, throughOffset: 200, minUsageAt: from, maxUsageAt: through,
      complete: true, slices: [{ from, through, model: 'gpt-5', tokens: tokens(500) }] };
  }
  mutate?.(f);
  next.coverage.totalFiles = next.coverage.indexedFiles = Object.keys(next.files).length;
  const after = buildCodexForwardCalibration(next, true, new Set(Object.keys(next.files)), new Set(), T + 290000, {}, before)!;
  return { before, after, file: f, next, slices };
}

test('producer carries only immutable bounded numeric slices in live append witnesses', () => {
  const f = fixture(), row = (f.after.sources[0].appendWindow as any).slices;
  assert.equal(row?.length, 4);
  assert.ok(Object.isFrozen(row) && row.every((x: any) => Object.isFrozen(x) && Object.isFrozen(x.tokens)));
  f.slices[0].tokens.inputTotal = 9999;
  assert.equal(row[0].tokens.inputTotal, 100);
  assert.equal(normalizeCodexIndex(f.next)!.files[K].calibrationAppend, undefined);
});

test('one pair of account-wide cut percentages covers every changed source, including those without quota rows', () => {
  const normal = fixture(undefined, undefined, 'normal');
  const result = project(normal.before, normal.after, envelope, book);
  assert.equal(result.deltaUsd, 25); assert.equal(result.deltaPercent, 2);
  assert.equal(result.totalTokens, 2500); assert.equal(result.linkedSources, 2);
  for (const peer of ['straddle', 'removed'] as const) {
    const f = fixture(undefined, undefined, peer);
    assert.equal(project(f.before, f.after, envelope, book), undefined, peer);
  }
  const missingPrefix = fixture(undefined, f => { f.calibrationAppend.beforeOffset = 200; });
  assert.equal(project(missingPrefix.before, missingPrefix.after, envelope, book), undefined);
});

test('evicted latest-window detail cannot bypass the shared numeric history byte cap', () => {
  const f = fixture(), index = createEmptyCodexIndex('UTC');
  for (let n = 1; n <= 16; n++) {
    const key = n.toString(16).padStart(64, '0'), file = structuredClone(f.file);
    file.fileKey = key; file.ino = n;
    file.parserState = { ...createCodexParserState(key), identityLocked: true, model: 'gpt-5' };
    file.aggregate.session.sessionKey = key;
    const slices = Array.from({ length: 128 }, (_, i) => ({ from: T + 1000 + i, through: T + 1000 + i,
      model: 'gpt-5', tokens: tokens(1), quota: { observedAt: T + 1000 + i, resetAt: R, usedPercent: 37 } }));
    file.calibrationAppend = { beforeOffset: 100, throughOffset: file.offset, minUsageAt: slices[0].from,
      maxUsageAt: slices[127].through, complete: true, slices };
    file.aggregate.total = tokens(128); file.aggregate.byModel = { 'gpt-5': tokens(128) };
    file.aggregate.session.endedAt = slices[127].through;
    index.files[key] = file;
  }
  index.coverage.totalFiles = index.coverage.indexedFiles = 16;
  const proof = buildCodexForwardCalibration(index, true, new Set(Object.keys(index.files)), new Set(), T + 290000, {})!;
  assert.ok(proof);
  const detail = new Set(proof.sources.flatMap(s => [...(s.appendWindows ?? []), ...(s.appendWindow ? [s.appendWindow] : [])])
    .filter(w => w.slices !== undefined));
  const bytes = [...detail].reduce((sum, w) => sum + Buffer.byteLength(JSON.stringify(w)), 0);
  assert.ok(bytes <= 256 * 1024, String(bytes));
  for (const s of proof.sources) if (s.appendWindow?.slices) assert.ok(s.appendWindows?.includes(s.appendWindow));
});

test('local matched cuts use their own numerator and percentage delta inside an official envelope', () => {
  const { before, after } = fixture(), interval = project(before, after, envelope, book);
  assert.deepEqual(interval, { from: T + 20000, through: T + 200000, percentFrom: 37, percentThrough: 39,
    deltaPercent: 2, deltaUsd: 20, pricedTokens: 2000, totalTokens: 2000, linkedSources: 1,
    officialEnvelope: { ...envelope } });
  assert.equal(interval.deltaUsd / (interval.deltaPercent / 100), 1000);
  assert.notEqual(interval.deltaUsd / ((envelope.percentThrough - envelope.percentFrom) / 100), 1000);
});

test('same total and temporal bounds do not identify the dollar allocation between cuts', () => {
  const a = fixture(), b = fixture([900, 100, 200, 1000]);
  assert.deepEqual(a.after.sources[0].byModel, b.after.sources[0].byModel);
  const bounds = (p: CodexForwardCalibration) => [p.sources[0].appendWindow!.minUsageAt, p.sources[0].appendWindow!.maxUsageAt];
  assert.deepEqual(bounds(a.after), bounds(b.after));
  assert.equal(project(a.before, a.after, envelope, book).deltaUsd, 20);
  assert.equal(project(b.before, b.after, envelope, book).deltaUsd, 12);
});

test('missing slices, vector disagreement, replacement, missing sources and copied proof remain unknown', () => {
  for (const kind of ['missing', 'partial', 'replacement', 'incomplete', 'time', 'unpriced'] as const) {
    const f = fixture(undefined, file => {
      if (kind === 'missing') delete file.calibrationAppend.slices;
      if (kind === 'partial') file.calibrationAppend.slices.pop();
      if (kind === 'replacement') file.ino++;
      if (kind === 'incomplete') file.calibrationAppend.complete = false;
      if (kind === 'time') file.calibrationAppend.slices[2].from = T + 1000;
    });
    assert.equal(project(f.before, f.after, envelope, kind === 'unpriced' ? { ...book, rates: [] } : book), undefined, kind);
  }
  const f = fixture();
  assert.equal(project(structuredClone(f.before), f.after, envelope, book), undefined);
  const removed = createEmptyCodexIndex('UTC');
  const absent = buildCodexForwardCalibration(removed, true, new Set(), new Set(), T + 290000, {}, f.before)!;
  assert.equal(project(f.before, absent, envelope, book), undefined);
});

test('cut-straddling requests, counter corrections, reset conflicts and insufficient points fail closed', () => {
  for (const kind of ['straddle', 'correction', 'reset', 'flat', 'conflict', 'future-proof-cut'] as const) {
    const f = fixture(undefined, file => {
      const rows = file.calibrationAppend.slices;
      if (kind === 'straddle') { rows[1].from = T + 19000; rows[1].through = T + 21000; rows[1].quota.observedAt = T + 21000;
        rows[2].from = T + 20500; }
      if (kind === 'correction') rows[2].quota.usedPercent = 35;
      if (kind === 'reset') rows[2].quota.resetAt++;
      if (kind === 'flat') rows.forEach((r: any) => r.quota.usedPercent = 37);
      if (kind === 'conflict') { rows[2].from = rows[2].through = rows[1].through; rows[2].quota.observedAt = rows[1].through; }
      if (kind === 'future-proof-cut') { rows[3].from = rows[3].through = T + 295000;
        rows[3].quota.observedAt = T + 295000; file.calibrationAppend.maxUsageAt = T + 295000; file.aggregate.session.endedAt = T + 295000; }
    });
    const result = project(f.before, f.after, envelope, book);
    if (kind === 'future-proof-cut') assert.equal(result?.through, T + 100000);
    else assert.equal(result, undefined, kind);
  }
});

test('actual scanner and normalized warm proof preserve a complete numeric tail without replay or estimator admission', async () => {
  const thread = '10000000-0000-4000-8000-000000000001';
  const vector = (input: number) => ({ input_tokens: input, cached_input_tokens: 0, output_tokens: 0,
    reasoning_output_tokens: 0, cache_write_input_tokens: 0, total_tokens: input });
  const json = (row: unknown) => JSON.stringify(row) + '\n';
  const count = (at: number, ordinal: number, n: number, total: number, percent: number) => ({ type: 'event_msg', ordinal,
    timestamp: new Date(at).toISOString(), payload: { type: 'token_count', info: {
      last_token_usage: vector(n), total_token_usage: vector(total) }, rate_limits: { limit_id: 'codex',
      secondary: { used_percent: percent, window_minutes: 10080, resets_at: R } } } });
  let body = [
    { type: 'session_meta', payload: { id: thread } }, { type: 'turn_context', payload: { model: 'gpt-5' } },
    { type: 'historical-unknown' }, count(T - 1000, 0, 100, 100, 36),
  ].map(json).join('');
  let disk = createEmptyCodexIndex('UTC'), previous: CodexForwardCalibration | undefined;
  const starts: number[] = [];
  const refresh = async (at: number) => {
    const entry = { fileKey: K, sourceArea: 'sessions' as const, size: Buffer.byteLength(body),
      mtimeMs: T + Buffer.byteLength(body), dev: 1, ino: 2 };
    const result = await updateCodexIndex(disk, { files: [{ ...entry, absolutePath: '/synthetic-not-opened.jsonl', nonPersisted: true }],
      persistable: { [K]: entry } }, { salt: 'synthetic-matched-cut', timeZone: 'UTC', now: () => at,
      allowHistoricalBackfill: false, allowAchievementHourProof: false,
      io: { async *read(_entry, start, end) { starts.push(start); yield Buffer.from(body).subarray(start, end); } } });
    assert.equal(result.failedFiles, 0);
    const proof = buildCodexForwardCalibration(result.index, true, new Set([K]), new Set(), at, {}, previous)!;
    assert.ok(proof); disk = normalizeCodexIndex(result.index)!;
    assert.equal(disk.files[K].calibrationAppend, undefined); previous = proof;
    return proof;
  };
  const before = await refresh(T); let total = 100;
  for (const [i, n] of [100, 100, 1000, 1000].entries()) {
    const at = T + [3000, 20000, 100000, 200000][i], ordinal = 1 + i * 3;
    total += n;
    body += [
      { type: 'token_usage_record', ordinal, timestamp: new Date(at - 2).toISOString(), payload: {
        thread_id: thread, session_id: 'different-session', turn_id: 'turn', root_turn_id: 'root', response_id: 'response',
        usage: vector(n), turn_token_usage: vector(total + 1), thread_token_usage: vector(total + 2) } },
      { type: 'response_item', ordinal: ordinal + 1, timestamp: new Date(at - 1).toISOString(),
        payload: { type: 'message', role: 'assistant', content: [] } },
      count(at, ordinal + 2, n, total, 36 + i),
    ].map(json).join('');
  }
  const appended = await refresh(T + 280000), warm = await refresh(T + 290000);
  assert.deepEqual(starts, [0, before.sources[0].offset]);
  assert.equal(warm.sources[0].byModel!['gpt-5'].inputTotal - before.sources[0].byModel!['gpt-5'].inputTotal, 2200);
  assert.equal((appended.sources[0].appendWindow as any).slices.length, 4);
  assert.deepEqual(warm.sources[0].appendWindow, appended.sources[0].appendWindow);
  assert.equal(project(before, warm, envelope, book)?.deltaUsd, 20);
  assert.equal(project(before, warm, envelope, book)?.deltaPercent, 2);
});
