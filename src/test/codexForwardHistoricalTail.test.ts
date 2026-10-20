import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex, CodexIndexV1 } from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { defaultCodexJsonlReader, CODEX_MAX_JSONL_LINE_BYTES } from '../providers/codex/codexJsonlScanner';
import { buildCodexForwardCalibration, isCodexForwardAppend, CodexForwardCalibration } from '../providers/codex/codexForwardCalibration';
import { createCodexParserState, parseCodexLine, isCodexForwardHistoricalQualityFlag } from '../providers/codex/codexParser';
import { CodexForwardAccountEstimator } from '../codexForwardAccountEstimate';

const T = Date.parse('2026-10-20T02:00Z'), R = T + 6 * 86400000, salt = 'synthetic-historical-tail';
const json = (value: object) => JSON.stringify(value) + '\n';
function request(n: number, p = 10 + n * 10): string {
  return json({ type: 'event_msg', timestamp: new Date(T + (2 * n - 1) * 1000).toISOString(), payload: {
    type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 1 },
      total_token_usage: { input_tokens: 100 * n, cached_input_tokens: 0, output_tokens: n } },
    rate_limits: { limit_id: 'codex', secondary: { used_percent: p, window_minutes: 10080, resets_at: R } },
  } });
}
const gaps = {
  unknown: json({ type: 'unknown_future_event', timestamp: new Date(T).toISOString() }),
  json: 'invalid-json\n',
  oversized: json({ type: 'world_state', padding: 'x'.repeat(CODEX_MAX_JSONL_LINE_BYTES + 1) }),
  payload: json({ type: 'event_msg', payload: null }),
  context: json({ type: 'turn_context', payload: null }),
};
async function fixture(t: TestContext, prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-forward-historical-tail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', 'synthetic.jsonl');
  const header = json({ type: 'session_meta', payload: { id: 'synthetic-historical-tail-root' } }) +
    json({ type: 'turn_context', payload: { model: 'gpt-5' } });
  await writeFile(file, header + prefix + request(1));
  const options = { salt, timeZone: 'UTC', now: () => T + 10000, allowHistoricalBackfill: false, allowAchievementHourProof: false };
  const refresh = (previous: CodexIndexV1) => scanCodexManifest(root, salt).then(manifest => updateCodexIndex(previous, manifest, options));
  const first = await refresh(createEmptyCodexIndex('UTC'));
  return { file, options, refresh, first: first.index, key: Object.keys(first.index.files)[0], scan: () => scanCodexManifest(root, salt) };
}
function proof(index: CodexIndexV1, n = 1, previous?: CodexForwardCalibration) {
  return buildCodexForwardCalibration(index, true, new Set(Object.keys(index.files)), new Set(), T + n * 2000 - 300, {}, previous)!;
}
const sample = (n: number) => ({ accountScopeKey: 'a'.repeat(64), sourceScopeKey: 'b'.repeat(64),
  requestedAt: T + n * 2000 - 100, observedAt: T + n * 2000, resetAt: R, usedPercent: 10 + n * 10,
  quotaEpoch: { startedAt: T, resetAnchorAt: R, startLowerAt: null, reason: 'initial' as const } });
const book = { schemaVersion: 1 as const, parserVersion: 4, periodVersion: 1,
  rates: [{ model: 'gpt-5', input: .01, cachedInput: .001, output: .1 }] };

test('old unknown/invalid/oversized prefixes permit only later clean exact tail calibration without replay', async t => {
  for (const prefix of [gaps.unknown, gaps.json, gaps.oversized, gaps.payload, gaps.context]) {
    const f = await fixture(t, prefix), before = f.first.files[f.key];
    assert.ok(before.qualityFlags.length > 0);
    let index = normalizeCodexIndex(JSON.parse(JSON.stringify(f.first)))!;
    let p = proof(index), estimator = new CodexForwardAccountEstimator();
    assert.equal(p.sources[0].eligible, true);
    assert.equal(estimator.observe(sample(1), p, book), undefined);
    for (const n of [2, 3]) {
      const fromOffset = index.files[f.key].offset, tail = request(n), starts: number[] = [];
      await appendFile(f.file, tail);
      const next = await updateCodexIndex(index, await f.scan(), { ...f.options, io: {
        read(entry, start, end, control) { starts.push(start); return defaultCodexJsonlReader.read(entry, start, end, control); },
      } });
      assert.deepEqual(starts, [fromOffset]); assert.equal(next.migration.bytesRead, Buffer.byteLength(tail));
      assert.equal(next.index.files[f.key].calibrationAppend?.complete, true);
      const after = proof(next.index, n, p);
      assert.equal(isCodexForwardAppend(p.sources[0], after.sources[0]), true);
      const result = estimator.observe(sample(n), after, book);
      if (n === 2) assert.equal(result, undefined, 'first clean step aligns the future-only cohort');
      else { assert.equal(result?.usedEquivalentUsd, 1.1); assert.equal(result.calibrationEvidence?.accumulated.intervals, 1); }
      assert.deepEqual(next.index.files[f.key].qualityFlags, before.qualityFlags, 'history flags remain truthful');
      index = normalizeCodexIndex(JSON.parse(JSON.stringify(next.index)))!; p = after;
    }
  }
});

test('repeated bad tail events remain incomplete even when their sticky flag already exists', async t => {
  for (const bad of Object.values(gaps)) {
    const f = await fixture(t, Object.values(gaps).join(''));
    const before = f.first.files[f.key], prior = proof(f.first);
    await appendFile(f.file, bad + request(2));
    const next = (await f.refresh(f.first)).index, after = proof(next, 2, prior);
    assert.deepEqual(next.files[f.key].qualityFlags, before.qualityFlags);
    assert.equal(next.files[f.key].calibrationAppend?.complete, false);
    assert.equal(after.sources[0].appendWindow?.complete, false);
    assert.equal(after.sources[0].appendWindows?.length ?? 0, 0);
    const estimator = new CodexForwardAccountEstimator();
    estimator.observe(sample(1), prior, book);
    assert.equal(estimator.observe(sample(2), after, book), undefined);
    // A new baseline AFTER this gap can still collect the following clean tail.
    await appendFile(f.file, request(3));
    const clean = (await f.refresh(next)).index;
    assert.equal(clean.files[f.key].calibrationAppend?.complete, true);
    assert.equal(proof(clean, 3, after).sources[0].eligible, true);
  }
});

test('fatal primary/identity flags and unknown classifications never become historical exemptions', async t => {
  const f = await fixture(t, gaps.unknown);
  for (const flag of ['missing-parent', 'stale-file', 'stale-reset-required', 'identity-conflict',
    'invalid-session-meta', 'missing-pseudonymizer', 'truncated-jsonl', 'replaced-jsonl', 'future-unreviewed-quality']) {
    for (const where of ['file', 'parser'] as const) {
      const i = structuredClone(f.first), row = i.files[f.key];
      (where === 'file' ? row.qualityFlags : row.parserState.qualityFlags).push(flag);
      assert.equal(proof(i).sources[0].eligible, false, `${where}:${flag}`);
    }
  }
  for (const flag of ['unknown-event', 'invalid-json', 'oversized-jsonl-line', 'invalid-event-payload',
    'missing-token-info', 'invalid-token-count', 'invalid-event-timestamp', 'invalid-turn-context',
    'counter-regression', 'component-delta-clamped']) {
    assert.equal(isCodexForwardHistoricalQualityFlag(flag), true, flag);
    const i = structuredClone(f.first), row = i.files[f.key];
    row.qualityFlags.push(flag); row.parserState.qualityFlags.push(flag);
    assert.equal(proof(i).sources[0].eligible, true, `historical:${flag}`);
  }
});

test('cumulative/missing-last, reversed timestamps, invalid usage and parent boundaries remain closed', async t => {
  for (const kind of ['cumulative', 'invalid-time', 'regression', 'reversed', 'parent', 'invalid-count',
    'session-boundary', 'malformed-response'] as const) {
    const f = await fixture(t, gaps.unknown), raw = JSON.parse(request(2));
    let tail: string;
    if (kind === 'cumulative') delete raw.payload.info.last_token_usage;
    if (kind === 'invalid-time') raw.timestamp = 'invalid';
    if (kind === 'regression') raw.payload.info.total_token_usage.input_tokens = 1;
    if (kind === 'invalid-count') raw.payload.info.last_token_usage.input_tokens = -1;
    tail = JSON.stringify(raw) + '\n';
    if (kind === 'reversed') tail = request(3) + request(2);
    if (kind === 'parent') tail = json({ type: 'event_msg', payload: { type: 'task_started' } }) + tail;
    if (kind === 'session-boundary') tail = json({ type: 'session_meta', payload: { id: 'different-synthetic-session' } }) + tail;
    if (kind === 'malformed-response') tail = json({ type: 'response_item', payload: null }) + tail;
    await appendFile(f.file, tail);
    assert.equal((await f.refresh(f.first)).index.files[f.key].calibrationAppend?.complete, false, kind);
  }
});

test('parser reports each unsafe occurrence independently of sticky diagnostic deduplication', () => {
  for (const line of [gaps.unknown, gaps.payload, gaps.context, gaps.json,
    json({ type: 'session_meta', payload: null }), json({ type: 'event_msg', payload: { type: 'token_count' } })]) {
    let state = createCodexParserState('1'.repeat(64));
    for (let n = 0; n < 2; n++) {
      const parsed = parseCodexLine(line, state);
      assert.equal(parsed.forwardCalibrationIncomplete, true);
      state = parsed.state;
    }
  }
});

test('counter regressions remain unsafe on every occurrence while exact primary last usage stays unchanged', () => {
  let state = createCodexParserState('1'.repeat(64));
  state = parseCodexLine(request(5), state).state;
  for (const n of [1, 2]) {
    const raw = JSON.parse(request(n));
    raw.payload.info.total_token_usage.input_tokens = 1;
    const parsed = parseCodexLine(JSON.stringify(raw), state);
    assert.equal(parsed.forwardCalibrationIncomplete, true);
    assert.equal(parsed.events[0]?.tokens.inputTotal, 100);
    assert.equal(parsed.events[0]?.tokens.outputTotal, 1);
    assert.ok(parsed.state.qualityFlags.includes('counter-regression'));
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.state, 'forwardCalibrationIncomplete'), false);
    state = parsed.state;
  }
});
