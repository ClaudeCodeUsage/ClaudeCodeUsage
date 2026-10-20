import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createCodexParserState, parseCodexLine, CodexParserState } from '../providers/codex/codexParser';
import { CodexUsageRecordPairGuard } from '../providers/codex/codexUsageRecordPair';
import { createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex, CodexIndexV1, CodexIndexCancelledError } from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { CODEX_MAX_JSONL_LINE_BYTES } from '../providers/codex/codexJsonlScanner';

const T = Date.parse('2026-10-21T03:00Z'), R = T + 6 * 86400000, THREAD = '10000000-0000-4000-8000-000000000001';
const salt = 'synthetic-record-pair', json = (v: unknown) => JSON.stringify(v) + '\n';
const hash = (s: string) => createHash('sha256').update(salt + s).digest('hex');
const vector = (input = 100) => ({ input_tokens: input, cached_input_tokens: 20, cache_write_input_tokens: 0,
  output_tokens: 5, reasoning_output_tokens: 2, total_tokens: input + 5 });
function record(at = T + 1000) {
  return { type: 'token_usage_record', ordinal: 10, timestamp: new Date(at).toISOString(), payload: {
    thread_id: THREAD, turn_id: 'PRIVATE-turn', session_id: 'DIFFERENT-PRIVATE-session',
    root_turn_id: 'PRIVATE-root-turn', response_id: 'PRIVATE-response', usage: vector(),
    turn_token_usage: vector(400), thread_token_usage: vector(900),
  } };
}
function middle(at = T + 1001) {
  return { type: 'response_item', ordinal: 11, timestamp: new Date(at).toISOString(),
    payload: { type: 'message', role: 'assistant', content: [] } };
}
function count(n = 2, at = T + 1002) {
  return { type: 'event_msg', ordinal: 3 * n + 6, timestamp: new Date(at).toISOString(), payload: { type: 'token_count',
    info: { last_token_usage: { ...vector(), total_tokens: 99999 }, total_token_usage: vector(n * 100) },
    rate_limits: { limit_id: 'codex', secondary: { used_percent: 20 + n, window_minutes: 10080, resets_at: R } },
  } };
}
function state(): CodexParserState {
  return { ...createCodexParserState('1'.repeat(64)), identityLocked: true, sessionKey: hash(THREAD), model: 'gpt-5' };
}
function parsedGuard(lines: unknown[], ordinals = lines.map((_, i) => i + 1)) {
  const guard = new CodexUsageRecordPairGuard(); let s = state();
  const out = lines.map((value, i) => {
    const p = parseCodexLine(JSON.stringify(value), s, hash, ordinals[i]); s = p.state;
    return { parsed: p, decision: guard.observe(ordinals[i], p.usageRecordPair) };
  });
  return { guard, out };
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-record-pair-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', `rollout-${THREAD}.jsonl`);
  await writeFile(file, json({ type: 'session_meta', payload: { id: THREAD } }) +
    json({ type: 'turn_context', payload: { model: 'gpt-5' } }) + json(count(1, T + 10)) +
    json({ type: 'unsupported-old-record' }));
  const options = { salt, timeZone: 'UTC', now: () => T + 10000, allowHistoricalBackfill: false, allowAchievementHourProof: false };
  const refresh = async (i: CodexIndexV1, extra = {}) => updateCodexIndex(i, await scanCodexManifest(root, salt), { ...options, ...extra });
  const first = (await refresh(createEmptyCodexIndex('UTC'))).index;
  return { file, refresh, first, key: Object.keys(first.files)[0] };
}

test('strict observed record/response/new-count pair ignores absolute cumulative mismatch and last context total', () => {
  const { guard, out } = parsedGuard([record(), middle(), count()]);
  assert.equal(out[0].parsed.forwardCalibrationIncomplete, true);
  assert.ok(out[0].parsed.state.qualityFlags.includes('unknown-event'));
  assert.equal(out[0].decision.waiveRecordFailure, true);
  assert.equal(out[2].decision.unsafe, false); assert.equal(guard.complete, true);
  assert.deepEqual(out[2].decision.bounds, { from: T + 1000, through: T + 1002 });
  assert.equal(out[2].parsed.events[0].tokens.inputTotal, 100);
  assert.equal(out[2].parsed.lineageTokenKey?.includes('99999'), true);
  assert.doesNotMatch(JSON.stringify(out.map(x => x.parsed.usageRecordPair)), /PRIVATE|DIFFERENT|thread_id|response_id/);
});

test('runtime markers never change primary parser state, counters, signatures, lineage keys or quality flags', () => {
  let a = state(), b = state();
  for (const [ordinal, value] of [record(), middle(), count()].entries()) {
    const ordinary = parseCodexLine(JSON.stringify(value), a, hash);
    const marked = parseCodexLine(JSON.stringify(value), b, hash, ordinal + 1);
    const { usageRecordPair: _marker, ...primary } = marked;
    assert.deepEqual(primary, ordinary); a = ordinary.state; b = marked.state;
  }
  assert.equal(b.schemaVersion, 4); assert.doesNotMatch(JSON.stringify(b), /PRIVATE|DIFFERENT|usageRecordPair/);
});

test('malformed record vectors, nonzero cache-write, identity, metadata and model variants cannot waive failures', () => {
  for (const kind of ['cache-write', 'bad-total', 'bad-subset', 'fraction', 'missing', 'cumulative', 'identity', 'metadata', 'model',
    'missing-ordinal', 'fraction-ordinal', 'unsafe-ordinal'] as const) {
    const r = record();
    if (kind === 'cache-write') r.payload.usage.cache_write_input_tokens = 1;
    if (kind === 'bad-total') r.payload.usage.total_tokens++;
    if (kind === 'bad-subset') r.payload.usage.cached_input_tokens = 101;
    if (kind === 'fraction') r.payload.usage.output_tokens = .5;
    if (kind === 'missing') delete (r.payload.usage as any).reasoning_output_tokens;
    if (kind === 'cumulative') r.payload.thread_token_usage.total_tokens++;
    if (kind === 'identity') r.payload.thread_id = r.payload.session_id;
    if (kind === 'metadata') Object.assign(r.payload, { extra_usage: vector() });
    if (kind === 'model') Object.assign(r.payload, { model: 'gpt-5-mini' });
    if (kind === 'missing-ordinal') delete (r as any).ordinal;
    if (kind === 'fraction-ordinal') r.ordinal = 10.5;
    if (kind === 'unsafe-ordinal') r.ordinal = Number.MAX_SAFE_INTEGER + 1;
    assert.equal(parsedGuard([r, middle(), count()]).out[0].decision.waiveRecordFailure, false, kind);
  }
  const unlocked = parseCodexLine(JSON.stringify(record()), { ...state(), identityLocked: false }, hash, 1);
  assert.equal(unlocked.usageRecordPair, undefined);
});

test('ordinal/model/time gaps, malformed middle, repeated records and EOF/skip fail closed', () => {
  for (const kind of ['ordinal', 'raw-middle-ordinal', 'raw-count-ordinal', 'missing-count-ordinal', 'middle', 'middle-type',
    'time', 'reversal', 'repeat', 'missing', 'boundary'] as const) {
    const r = record(), m = middle(), c = count();
    if (kind === 'middle') (m as any).payload = null;
    if (kind === 'middle-type') m.payload.type = 'unsupported_item';
    if (kind === 'time') c.timestamp = new Date(T + 6001).toISOString();
    if (kind === 'reversal') m.timestamp = new Date(T + 999).toISOString();
    if (kind === 'raw-middle-ordinal') m.ordinal++;
    if (kind === 'raw-count-ordinal') c.ordinal++;
    if (kind === 'missing-count-ordinal') delete (c as any).ordinal;
    const lines = kind === 'repeat' ? [r, r, m, c] : kind === 'missing' ? [r, c] :
      kind === 'boundary' ? [r, { type: 'event_msg', payload: { type: 'task_started' } }, c] : [r, m, c];
    const p = parsedGuard(lines, kind === 'ordinal' ? [1, 3, 4] : undefined);
    assert.equal(p.guard.complete, false, kind);
  }
  const pending = parsedGuard([record(), middle()]); assert.equal(pending.guard.complete, false);
  pending.guard.invalidate(); assert.equal(pending.guard.complete, false);
  const modelChange = parsedGuard([record(), { type: 'turn_context', payload: { model: 'gpt-5-mini' } }, count()]);
  assert.equal(modelChange.guard.complete, false);
});

test('each supported response kind is shallowly validated and raw ordinals cannot be replayed across pairs', () => {
  for (const payload of [
    { type: 'message', role: 'assistant', content: [] },
    { type: 'reasoning', summary: [] },
    { type: 'function_call', name: 'apply_patch', arguments: '{}', call_id: 'PRIVATE-call' },
  ]) {
    const response = { ...middle(), payload };
    assert.equal(parsedGuard([record(), response, count()]).guard.complete, true);
  }
  const nextCount = count(3); nextCount.ordinal = 12;
  assert.equal(parsedGuard([record(), middle(), count(), record(), middle(), nextCount]).guard.complete, false);
});

test('production scanner admits exactly matched metadata without extra primary USD and uses the earlier record timestamp', async t => {
  const f = await fixture(t), before = f.first.files[f.key];
  await appendFile(f.file, [record(), middle(), count()].map(json).join(''));
  const result = await f.refresh(normalizeCodexIndex(f.first)!);
  const file = result.index.files[f.key];
  assert.equal(result.bodyReads, 1); assert.equal(file.calibrationAppend?.complete, true);
  assert.equal(file.calibrationAppend?.minUsageAt, T + 1000); assert.equal(file.calibrationAppend?.maxUsageAt, T + 1002);
  assert.equal(file.aggregate.total.inputTotal - before.aggregate.total.inputTotal, 100);
  assert.equal(file.aggregate.total.outputTotal - before.aggregate.total.outputTotal, 5);
  assert.deepEqual(file.qualityFlags, before.qualityFlags);
  assert.equal(file.lineage!.tokenEvents - before.lineage!.tokenEvents, 1);
  assert.doesNotMatch(JSON.stringify(normalizeCodexIndex(JSON.parse(JSON.stringify(result.index)))), /PRIVATE|DIFFERENT|usageRecordPair/);
});

test('scanner leaves unmatched/split/replayed/oversized pairs incomplete without prefix recovery', async t => {
  for (const kind of ['split', 'replay', 'oversized', 'blank', 'extra-record', 'after-order', 'unsafe-earlier'] as const) {
    const f = await fixture(t);
    let lines = [record(), middle(), count()].map(json).join('');
    if (kind === 'split') lines = [record(), middle()].map(json).join('');
    if (kind === 'replay') lines = [record(), middle(), count(1, T + 1002)].map(json).join('');
    if (kind === 'oversized') lines = json(record()) + 'x'.repeat(CODEX_MAX_JSONL_LINE_BYTES + 1) + '\n' + json(middle()) + json(count());
    if (kind === 'blank') lines = json(record()) + '\n' + json(middle()) + json(count());
    if (kind === 'extra-record') lines += json(record(T + 2000));
    if (kind === 'after-order') lines = [count(), middle(), record()].map(json).join('');
    if (kind === 'unsafe-earlier') lines = json({ type: 'unsupported-current-record' }) + lines;
    await appendFile(f.file, lines);
    const result = await f.refresh(f.first);
    assert.equal(result.index.files[f.key].calibrationAppend?.complete, false, kind);
    assert.equal(result.bodyReads, 1, kind);
  }
});

test('pending cancellation snapshots contain no pair state and resume cannot finish the pair by replaying a prefix', async t => {
  const f = await fixture(t), chunks = [record(), middle(), count()].map(value => Buffer.from(json(value)));
  await appendFile(f.file, Buffer.concat(chunks));
  let stop = false, saved: CodexIndexV1 | undefined;
  await assert.rejects(f.refresh(f.first, { shouldCancel: () => stop,
    io: { async *read() { for (const chunk of chunks) yield chunk; } },
    scheduling: { checkpointEveryMs: 0 },
    onCheckpoint: async (i: CodexIndexV1) => {
      const file = i.files[f.key];
      if (file.calibrationAppend && file.offset === f.first.files[f.key].offset + chunks[0].length) {
        saved = structuredClone(i); stop = true;
      }
    },
  }), CodexIndexCancelledError);
  assert.ok(saved); assert.equal(saved.files[f.key].calibrationAppend?.complete, false);
  assert.doesNotMatch(JSON.stringify(normalizeCodexIndex(saved)), /usageRecordPair|PRIVATE|DIFFERENT/);
  const resumed = await f.refresh(normalizeCodexIndex(saved)!);
  assert.equal(resumed.index.files[f.key].calibrationAppend?.complete, false);
  assert.equal(resumed.migration.bytesRead, chunks[1].length + chunks[2].length);
  assert.equal(resumed.index.files[f.key].aggregate.total.inputTotal - f.first.files[f.key].aggregate.total.inputTotal, 100);
});

test('ordinary token counts without raw ordinals keep the legacy forward path when no pair is pending', async t => {
  const f = await fixture(t), plain = count(); delete (plain as any).ordinal;
  await appendFile(f.file, json(plain));
  const after = await f.refresh(f.first);
  assert.equal(after.index.files[f.key].calibrationAppend?.complete, true);
});
