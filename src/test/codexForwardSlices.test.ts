import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  CODEX_FORWARD_SLICES_MAX_SLICES, CODEX_FORWARD_SLICES_MAX_BYTES,
  copyCodexForwardSlices,
} from '../providers/codex/codexForwardSlices';
import {
  CodexFileContribution, CodexIndexV1, CodexIndexUpdateOptions, CodexIndexCancelledError,
  createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex,
} from '../providers/codex/codexIndex';
import type { CodexManifest } from '../providers/codex/codexManifest';
import * as codexParser from '../providers/codex/codexParser';

const T = Date.parse('2026-10-21T03:00Z'), R = T + 6 * 86400000;
const key = '1'.repeat(64), thread = '10000000-0000-4000-8000-000000000001';
const tokens = () => ({ inputTotal: 100, cachedInput: 20, outputTotal: 5, reasoningOutput: 2, sourceTotal: 105 });
const slice = (at = T) => ({ from: at, through: at, model: 'gpt-5', tokens: tokens(),
  quota: { observedAt: at, resetAt: R, usedPercent: 20 } });
const json = (v: unknown) => JSON.stringify(v) + '\n';
const vector = (n = 1) => ({ input_tokens: n * 100, cached_input_tokens: n * 20,
  cache_write_input_tokens: 0, output_tokens: n * 5, reasoning_output_tokens: n * 2, total_tokens: n * 105 });
function count(n: number, at = T + n * 1000, limitId = 'codex') {
  return { type: 'event_msg', ordinal: n * 3 + 6, timestamp: new Date(at).toISOString(), payload: {
    type: 'token_count', info: { last_token_usage: { ...vector(), total_tokens: 999999 }, total_token_usage: vector(n) },
    rate_limits: { limit_id: limitId, secondary: { used_percent: 20 + n, window_minutes: 10080, resets_at: R } },
  } };
}
const record = () => ({ type: 'token_usage_record', ordinal: 10, timestamp: new Date(T + 1998).toISOString(),
  payload: { thread_id: thread, turn_id: 'PRIVATE-turn', session_id: 'PRIVATE-session', root_turn_id: 'PRIVATE-root',
    response_id: 'PRIVATE-response', usage: vector(), turn_token_usage: vector(10), thread_token_usage: vector(100) } });
const response = () => ({ type: 'response_item', ordinal: 11, timestamp: new Date(T + 1999).toISOString(),
  payload: { type: 'message', role: 'assistant', content: [] } });

/** Entire source, manifest and reader are synthetic and stay in memory. */
async function fixture() {
  let body = Buffer.from(json({ type: 'session_meta', payload: { id: thread } }) +
    json({ type: 'turn_context', payload: { model: 'gpt-5' } }) + json(count(1)));
  let revision = 1;
  const reads: number[] = [];
  function manifest(): CodexManifest {
    const entry = { fileKey: key, sourceArea: 'sessions' as const, size: body.length, mtimeMs: revision,
      dev: 1, ino: 2 };
    return { files: [{ ...entry, absolutePath: '/synthetic-never-opened.jsonl', nonPersisted: true }],
      persistable: { [key]: entry } };
  }
  const options: CodexIndexUpdateOptions = { salt: 'synthetic-slices', timeZone: 'UTC', now: () => T + 1_000_000,
    allowHistoricalBackfill: false, allowAchievementHourProof: false,
    io: { async *read(_entry, start, end) { reads.push(start); yield body.subarray(start, end); } } };
  const refresh = (index: CodexIndexV1, extra: Partial<CodexIndexUpdateOptions> = {}) =>
    updateCodexIndex(index, manifest(), { ...options, ...extra });
  const initial = (await refresh(createEmptyCodexIndex('UTC'))).index;
  const append = (...rows: unknown[]) => { body = Buffer.concat([body, Buffer.from(rows.map(json).join(''))]); revision++; };
  return { initial, append, refresh, reads, options };
}

test('slice copier rebuilds only fixed numeric fields into deeply frozen independent objects', () => {
  const raw = slice();
  Object.assign(raw, { body: 'PRIVATE-body', id: 'PRIVATE-id' });
  Object.assign(raw.tokens, { secret: 'PRIVATE-token' });
  Object.assign(raw.quota, { provider: 'codex', account: 'PRIVATE-account' });
  const copied = copyCodexForwardSlices([raw])!;
  assert.deepEqual(copied, [slice()]);
  assert.ok(Object.isFrozen(copied) && Object.isFrozen(copied[0]) &&
    Object.isFrozen(copied[0].tokens) && Object.isFrozen(copied[0].quota));
  raw.tokens.inputTotal = 200; raw.quota.usedPercent = 50;
  assert.equal(copied[0].tokens.inputTotal, 100); assert.equal(copied[0].quota?.usedPercent, 20);
  assert.doesNotMatch(JSON.stringify(copied), /PRIVATE|body|account/);
  assert.deepEqual(copyCodexForwardSlices([]), []);
});

test('slice copier rejects unsafe, empty, fractional, inconsistent, overlapping and unsanitized evidence as a whole', () => {
  const bad: unknown[] = [null, {}, '[]', [null], Array(1)];
  for (const value of [-1, NaN, Infinity, .5, Number.MAX_SAFE_INTEGER + 1, '100']) {
    bad.push([{ ...slice(), tokens: { ...tokens(), inputTotal: value } }]);
    bad.push([{ ...slice(), from: value }]);
  }
  for (const change of [
    { inputTotal: 0, cachedInput: 0, outputTotal: 0, reasoningOutput: 0, sourceTotal: 0 },
    { cachedInput: 101 }, { reasoningOutput: 6 }, { outputTotal: -1 }, { sourceTotal: 106 },
    { cacheWriteInput: 1 }, { cacheWriteInput: NaN }, { inputTotal: Number.MAX_SAFE_INTEGER },
    { cachedInput: null }, { reasoningOutput: null },
  ]) bad.push([{ ...slice(), tokens: { ...tokens(), ...change } }]);
  for (const model of [' gpt-5', 'gpt-5 ', 'unknown', '', '/private/model', 'file:model', 'a'.repeat(121), 'gpt\n5']) {
    bad.push([{ ...slice(), model }]);
  }
  for (const change of [{ observedAt: T + 1 }, { resetAt: T }, { resetAt: .5 },
    { usedPercent: -1 }, { usedPercent: 101 }, { usedPercent: NaN }]) {
    bad.push([{ ...slice(), quota: { ...slice().quota, ...change } }]);
  }
  bad.push([{ ...slice(), from: T + 1 }], [slice(T + 1), slice(T)],
    [{ ...slice(), through: T + 2, quota: undefined }, slice(T + 1)]);
  for (const value of bad) assert.equal(copyCodexForwardSlices(value), undefined);
  assert.equal(copyCodexForwardSlices([slice(), slice()])?.length, 2, 'equal adjacent points are permitted');
  const partial = { from: T, through: T, model: 'gpt-5', tokens: { inputTotal: 1, outputTotal: 0 } };
  assert.ok(copyCodexForwardSlices([partial]));
});

test('slice copier bounds reconstructed JSON in bytes and never runs user getters or toJSON', () => {
  assert.equal(CODEX_FORWARD_SLICES_MAX_SLICES, 128);
  assert.equal(CODEX_FORWARD_SLICES_MAX_BYTES, 65536);
  assert.equal(copyCodexForwardSlices(Array.from({ length: 128 }, () => slice()))?.length, 128);
  assert.equal(copyCodexForwardSlices(Array.from({ length: 129 }, () => slice())), undefined);
  const wide = { ...slice(), model: '界'.repeat(120) };
  assert.ok(Buffer.byteLength(JSON.stringify(Array(128).fill(wide))) > 65536);
  assert.equal(copyCodexForwardSlices(Array(128).fill(wide)), undefined);
  let invoked = false;
  const accessor = Object.defineProperty(slice(), 'model', { get() { invoked = true; throw Error(); } });
  assert.equal(copyCodexForwardSlices([accessor]), undefined);
  const raw = Object.assign(slice(), { toJSON() { invoked = true; throw Error(); } });
  assert.ok(copyCodexForwardSlices([raw]));
  assert.equal(invoked, false);
});

test('existing pass captures only emitted exact positive rows, with original per-event models and matching Codex quota', async () => {
  const f = await fixture(), baseline = normalizeCodexIndex(f.initial)!;
  const tail = count(2), duplicate = count(2);
  f.append(tail, duplicate, { type: 'turn_context', payload: { model: 'gpt-5-mini' } }, count(3));
  const result = await f.refresh(baseline), file = result.index.files[key];
  assert.equal(result.bodyReads, 1); assert.equal(result.failedFiles, 0);
  assert.deepEqual(f.reads, [0, baseline.files[key].offset]);
  assert.equal(file.calibrationAppend?.complete, true);
  const slices = file.calibrationAppend?.slices;
  assert.deepEqual(slices, [
    { ...slice(T + 2000), quota: { observedAt: T + 2000, resetAt: R, usedPercent: 22 } },
    { ...slice(T + 3000), model: 'gpt-5-mini', quota: { observedAt: T + 3000, resetAt: R, usedPercent: 23 } },
  ]);
  assert.equal(file.aggregate.total.inputTotal - baseline.files[key].aggregate.total.inputTotal, 200);
  assert.equal(file.aggregate.total.outputTotal - baseline.files[key].aggregate.total.outputTotal, 10);
  assert.ok(Object.isFrozen(slices) && Object.isFrozen(slices![0].tokens));
  assert.doesNotMatch(JSON.stringify(slices), /PRIVATE|999999|thread_id|sessionKey/);
  const normalized = normalizeCodexIndex(JSON.parse(JSON.stringify(result.index)))!;
  assert.equal(normalized.files[key].calibrationAppend, undefined, 'the disk normalization DTO drops the entire runtime witness');
});

test('matched record contributes earlier bounds but never a second slice or cumulative token snapshot', async () => {
  const f = await fixture(); f.append(record(), response(), count(2));
  const file = (await f.refresh(f.initial)).index.files[key];
  assert.equal(file.calibrationAppend?.complete, true);
  assert.deepEqual(file.calibrationAppend?.slices, [{ ...slice(T + 2000), from: T + 1998,
    quota: { observedAt: T + 2000, resetAt: R, usedPercent: 22 } }]);
  assert.equal(file.aggregate.total.inputTotal, 200);
});

test('multiple primary events on one physical line omit all slices without changing legacy append admission', async t => {
  const f = await fixture(), original = codexParser.parseCodexLine;
  t.mock.method(codexParser, 'parseCodexLine', (...args: Parameters<typeof original>) => {
    const parsed = original(...args);
    return parsed.events.length ? { ...parsed, events: [...parsed.events, ...parsed.events] } : parsed;
  });
  f.append(count(2));
  const file = (await f.refresh(f.initial)).index.files[key];
  assert.equal(file.calibrationAppend?.complete, true);
  assert.equal(file.calibrationAppend?.slices, undefined);
  assert.equal(file.aggregate.total.inputTotal, 300, 'both emitted primary events still enter the aggregate');
});

test('missing, generic, foreign or ambiguous quota never becomes an attached exact Codex observation', async () => {
  for (const kind of ['missing', 'generic', 'foreign', 'ambiguous'] as const) {
    const f = await fixture(), row = count(2);
    if (kind === 'missing') delete (row.payload as any).rate_limits;
    if (kind === 'generic') delete (row.payload.rate_limits as any).limit_id;
    if (kind === 'foreign') row.payload.rate_limits.limit_id = 'codex_spark';
    if (kind === 'ambiguous') Object.assign(row.payload.rate_limits, { primary: { ...row.payload.rate_limits.secondary, used_percent: 50 } });
    f.append(row);
    const file = (await f.refresh(f.initial)).index.files[key];
    const slices = file.calibrationAppend?.slices;
    assert.equal(slices?.length, 1, kind); assert.equal(slices[0].quota, undefined, kind);
    if (kind === 'foreign') assert.equal(file.calibrationAppend?.complete, false);
  }
});

test('over-budget capture omits every slice while retaining existing completeness and all primary tokens', async () => {
  for (const kind of ['count', 'bytes'] as const) {
    const f = await fixture(), rows: unknown[] = [];
    if (kind === 'bytes') rows.push({ type: 'turn_context', payload: { model: '界'.repeat(120) } });
    const size = kind === 'count' ? 129 : 128;
    rows.push(...Array.from({ length: size }, (_, i) => count(i + 2)));
    f.append(...rows);
    const result = await f.refresh(f.initial), file = result.index.files[key];
    assert.equal(file.calibrationAppend?.complete, true, kind);
    assert.equal(file.calibrationAppend?.slices, undefined, kind);
    assert.equal(file.aggregate.total.inputTotal, 100 * (size + 1), kind);
    f.append(count(size + 2));
    const clean = (await f.refresh(normalizeCodexIndex(result.index)!)).index.files[key];
    assert.equal(clean.aggregate.total.inputTotal, 100 * (size + 2));
    assert.equal(clean.calibrationAppend?.slices?.length, 1, 'capture budget is scan-local');
  }
});

test('unmatched pairs and preexisting append failure gates remain incomplete with primary tokens unchanged', async () => {
  for (const kind of ['pending', 'broken', 'cumulative', 'unknown', 'reversed'] as const) {
    const f = await fixture(), row = count(2);
    if (kind === 'pending') f.append(record());
    if (kind === 'broken') f.append(record(), count(2));
    if (kind === 'cumulative') { delete (row.payload.info as any).last_token_usage; f.append(row); }
    if (kind === 'unknown') f.append({ type: 'unsupported-event' }, row);
    if (kind === 'reversed') f.append(count(3), row);
    const file = (await f.refresh(f.initial)).index.files[key];
    assert.equal(file.calibrationAppend?.complete, false, kind);
    assert.equal(file.aggregate.total.inputTotal, kind === 'pending' ? 100 : kind === 'reversed' ? 300 : 200, kind);
  }
});

test('cancellation exposes independent frozen slices, incomplete even at EOF; a resumed scan never recovers prior slices', async () => {
  for (const finalChunk of [false, true]) {
    const f = await fixture(), lines = [json(count(2)), json(count(3))].map(s => Buffer.from(s));
    f.append(count(2), count(3));
    let stop = false, captured: CodexFileContribution | undefined;
    await assert.rejects(f.refresh(f.initial, { shouldCancel: () => stop,
      scheduling: { checkpointEveryMs: 0 },
      io: { async *read() { if (finalChunk) yield Buffer.concat(lines); else yield* lines; } },
      onCheckpoint: async index => { captured = index.files[key]; stop = true; },
    }), CodexIndexCancelledError);
    assert.ok(captured); assert.equal(captured.calibrationAppend?.complete, false);
    const slices = captured.calibrationAppend?.slices;
    assert.equal(slices?.length, finalChunk ? 2 : 1);
    assert.ok(Object.isFrozen(slices) && Object.isFrozen(slices![0]) && Object.isFrozen(slices![0].tokens));
    const snapshot = JSON.stringify(slices);
    const disk = normalizeCodexIndex({ ...f.initial, files: { [key]: captured } })!;
    assert.equal(disk.files[key].calibrationAppend, undefined);
    f.append(count(4));
    const resumed = (await f.refresh(disk)).index.files[key];
    assert.equal(resumed.calibrationAppend?.slices?.length, finalChunk ? 1 : 2);
    assert.equal(resumed.calibrationAppend?.slices?.[0].through, T + (finalChunk ? 4000 : 3000));
    assert.equal(JSON.stringify(slices), snapshot);
  }
});
