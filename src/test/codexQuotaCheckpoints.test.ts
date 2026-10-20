import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexParserState, createCodexParserState, parseCodexLine } from '../providers/codex/codexParser';
import { createCodexQuotaCheckpointState, retainCodexQuotaCheckpoints,
  CODEX_QUOTA_CHECKPOINT_LIMIT, CODEX_QUOTA_CHECKPOINT_VERSION, sanitizeCodexQuotaCheckpointState,
  boundCodexQuotaCheckpointStates, CODEX_QUOTA_CHECKPOINT_INDEX_BYTES,
  CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT, CODEX_QUOTA_CHECKPOINT_SNAPSHOT_BYTES } from '../providers/codex/codexQuotaCheckpoints';

const start = Date.parse('2026-10-01T00:00:00Z');
function line(n: number, used: number, input?: number, reset = start + 604800000, id = 'codex') {
  return JSON.stringify({ type: 'event_msg', timestamp: new Date(start + n * 1000).toISOString(),
    payload: { type: 'token_count', info: input === undefined ? null : {
      last_token_usage: { input_tokens: input, output_tokens: 2 },
    }, rate_limits: { limit_id: id, secondary: {
      used_percent: used, window_minutes: 10080, resets_at: reset,
    } } } });
}
function collector() {
  let parser: CodexParserState = { ...createCodexParserState('a'.repeat(64)), model: 'gpt-5' };
  const state = createCodexQuotaCheckpointState(0);
  return { state, add(text: string, admit = true) {
    const parsed = parseCodexLine(text, parser); parser = parsed.state;
    retainCodexQuotaCheckpoints(state, parsed, admit);
    return parsed;
  } };
}
test('tokenless quota establishes a numeric baseline and baseline request tokens never leak', () => {
  const c = collector();
  c.add(line(1, 10)); c.add(line(2, 11, 100));
  assert.equal(c.state.rows.length, 2);
  assert.deepEqual(c.state.rows[0].byModel, {});
  assert.equal(c.state.rows[0].baseline, true);
  assert.deepEqual((c.state.rows[0] as any).baselineByModel, {});
  assert.equal(c.state.rows[1].byModel['gpt-5'].inputTotal, 100);
  const d = collector(); d.add(line(1, 10, 900)); d.add(line(2, 11, 100));
  assert.equal((d.state.rows[0] as any).baselineByModel['gpt-5'].inputTotal, 900);
  assert.deepEqual(d.state.rows[0].byModel, {});
  assert.equal(Object.prototype.hasOwnProperty.call(d.state.rows[1], 'baselineByModel'), false);
  assert.equal(d.state.rows[1].byModel['gpt-5'].inputTotal, 100);
  assert.equal(d.state.rows[1].from, start + 1000);
});
test('reset, foreign limit and copied prefix boundaries cannot bridge token usage', () => {
  const c = collector();
  c.add(line(1, 10, 900), false); c.add(line(2, 11, 100)); c.add(line(3, 12, 50));
  c.add(line(4, 13, 800, start + 700000000));
  c.add(line(5, 14, 700, start + 700000000, 'spark'));
  c.add(line(6, 15, 600, start + 700000000)); c.add(line(7, 16, 20, start + 700000000));
  assert.deepEqual(c.state.rows.map(r => r.baseline), [true, false, true, true, false]);
  assert.equal(c.state.rows[c.state.rows.length - 1].byModel['gpt-5'].inputTotal, 20);
  assert.equal(c.state.rows[1].byModel['gpt-5'].inputTotal, 50);
  assert.equal((c.state.rows[0] as any).baselineByModel['gpt-5'].inputTotal, 100);
});

test('baseline request counts survive fixed-field reload independently of cumulative usage', () => {
  const c = collector(); c.add(line(1, 10, 900)); c.add(line(2, 11, 100));
  const raw = JSON.parse(JSON.stringify(c.state));
  raw.rows[0].baselineByModel['gpt-5'].prompt = 'PRIVATE';
  const clean = sanitizeCodexQuotaCheckpointState(raw)!;
  assert.equal(clean.version, CODEX_QUOTA_CHECKPOINT_VERSION);
  assert.equal((clean.rows[0] as any).baselineByModel['gpt-5'].inputTotal, 900);
  assert.deepEqual(clean.rows[0].byModel, {});
  assert.equal(clean.rows[1].byModel['gpt-5'].inputTotal, 100);
  assert.doesNotMatch(JSON.stringify(clean), /PRIVATE|prompt/);
  raw.version = 1; assert.equal(sanitizeCodexQuotaCheckpointState(raw), undefined);
});
test('unchanged percentages retain first and latest points without overflowing long sessions', () => {
  const c = collector();
  for (let i = 1; i <= CODEX_QUOTA_CHECKPOINT_LIMIT * 3; i++) c.add(line(i, 10, 1));
  assert.equal(c.state.rows.length, 2);
  assert.equal(c.state.rows[0].baseline, true);
  assert.equal(c.state.rows[1].byModel['gpt-5'].inputTotal, CODEX_QUOTA_CHECKPOINT_LIMIT * 3 - 1);
  assert.equal(c.state.overflow, false);
  assert.equal(c.state.complete, true);
});
test('old episode eviction is explicit and a later segment remains usable', () => {
  const c = collector();
  for (let i = 1; i <= CODEX_QUOTA_CHECKPOINT_LIMIT + 10; i++) c.add(line(i, 10, 1, start + 604800000 + i * 600001));
  assert.ok(c.state.rows.length <= CODEX_QUOTA_CHECKPOINT_LIMIT);
  assert.equal(c.state.overflow, true);
  assert.equal(c.state.complete, false);
  c.add(line(CODEX_QUOTA_CHECKPOINT_LIMIT + 11, 11, 7, start + 604800000 + (CODEX_QUOTA_CHECKPOINT_LIMIT + 10) * 600001));
  assert.equal(c.state.rows[c.state.rows.length - 1].complete, true);
  assert.equal(c.state.rows[c.state.rows.length - 1].byModel['gpt-5'].inputTotal, 7);
});

test('a tokenless baseline cannot admit an unknown first cumulative amount as a delta', () => {
  const c = collector(); c.add(line(1, 10));
  const raw = JSON.parse(line(2, 11, 900));
  raw.payload.info.total_token_usage = raw.payload.info.last_token_usage;
  delete raw.payload.info.last_token_usage;
  c.add(JSON.stringify(raw));
  assert.equal(c.state.rows[1].baseline, true);
  assert.deepEqual(c.state.rows[1].byModel, {});
  assert.equal(c.state.rows[1].complete, false);
  c.add(line(3, 12, 30)); c.add(line(4, 13, 20));
  assert.equal(c.state.rows[c.state.rows.length - 1].complete, true);
  assert.equal(c.state.rows[c.state.rows.length - 1].byModel['gpt-5'].inputTotal, 20);
});

test('tokens between observations retain their actual model and numeric subsets', () => {
  const c = collector(); c.add(line(1, 10, 999));
  c.add(JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5-mini' } }));
  const raw = JSON.parse(line(2, 11, 50)); delete raw.payload.rate_limits;
  raw.payload.info.last_token_usage.cached_input_tokens = 20;
  c.add(JSON.stringify(raw));
  c.add(JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5' } }));
  c.add(line(3, 12, 100));
  const last = c.state.rows[c.state.rows.length - 1];
  assert.equal(last.byModel['gpt-5-mini'].inputTotal, 50);
  assert.equal(last.byModel['gpt-5-mini'].cachedInput, 20);
  assert.equal(last.byModel['gpt-5'].inputTotal, 100);
  assert.equal(last.complete, true);
});

test('reload strips foreign fields and rejects incompatible or unsafe numeric evidence', () => {
  const c = collector(); c.add(line(1, 10)); c.add(line(2, 11, 100));
  const raw = JSON.parse(JSON.stringify(c.state));
  raw.prompt = 'PRIVATE'; raw.rows[0].sourceKey = '/private/raw/path';
  raw.rows[1].byModel['gpt-5'].response = 'PRIVATE';
  const clean = sanitizeCodexQuotaCheckpointState(raw)!;
  assert.ok(clean);
  assert.doesNotMatch(JSON.stringify(clean), /PRIVATE|sourceKey|private\/raw/);
  raw.version = 99; assert.equal(sanitizeCodexQuotaCheckpointState(raw), undefined);
  raw.version = CODEX_QUOTA_CHECKPOINT_VERSION; raw.rows[1].byModel['gpt-5'].inputTotal = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(sanitizeCodexQuotaCheckpointState(raw), undefined);
});

test('an unsupported source with no numeric window still splits continuity', () => {
  const c = collector(); c.add(line(1, 10)); c.add(line(2, 11, 100));
  const other = JSON.parse(line(3, 12, 999, start + 604800000, 'spark'));
  other.payload.rate_limits.secondary = null;
  c.add(JSON.stringify(other)); c.add(line(4, 12, 500)); c.add(line(5, 13, 20));
  const latest = c.state.rows[c.state.rows.length - 1];
  assert.equal(latest.from, start + 4000);
  assert.equal(latest.byModel['gpt-5'].inputTotal, 20);
});

test('reload refuses a broken cumulative segment instead of inventing a baseline join', () => {
  const c = collector(); c.add(line(1, 10)); c.add(line(2, 11, 100));
  const raw = JSON.parse(JSON.stringify(c.state));
  raw.rows[1].from += 1;
  assert.equal(sanitizeCodexQuotaCheckpointState(raw), undefined);
  raw.rows = [];
  assert.equal(sanitizeCodexQuotaCheckpointState(raw), undefined);
});

test('baseline model vectors reject unsafe labels, numbers and non-baseline attachment', () => {
  const c = collector(); c.add(line(1, 10, 900)); c.add(line(2, 11, 100));
  const valid = JSON.parse(JSON.stringify(c.state));
  const bad = JSON.parse(JSON.stringify(valid));
  bad.rows[0].baselineByModel = { '/private/model': valid.rows[0].baselineByModel['gpt-5'] };
  assert.equal(sanitizeCodexQuotaCheckpointState(bad), undefined);
  const badNumber = JSON.parse(JSON.stringify(valid));
  badNumber.rows[0].baselineByModel['gpt-5'].inputTotal = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(sanitizeCodexQuotaCheckpointState(badNumber), undefined);
  const misplaced = JSON.parse(JSON.stringify(valid));
  misplaced.rows[1].baselineByModel = {};
  assert.equal(sanitizeCodexQuotaCheckpointState(misplaced), undefined);
  const missing = JSON.parse(JSON.stringify(valid));
  delete missing.rows[0].baselineByModel;
  assert.equal(sanitizeCodexQuotaCheckpointState(missing), undefined);
});

test('index payload budget evicts old episodes without poisoning a recent retained segment', () => {
  const c = collector();
  for (let n = 1; n <= 512; n++) c.add(line(n, 10 + n / 1000, 1));
  const states = Array.from({ length: 100 }, (_, index) => {
    const state = JSON.parse(JSON.stringify(c.state)) as typeof c.state;
    for (const row of state.rows) { row.from += index * 1000000; row.through += index * 1000000; }
    return state;
  });
  boundCodexQuotaCheckpointStates(states, 8 * 1024 * 1024);
  const payloadBytes = states.reduce((sum, state) => sum + (state.rows.length
    ? Buffer.byteLength(JSON.stringify([state.rows, state.byModel])) : 0), 0);
  assert.ok(payloadBytes <= CODEX_QUOTA_CHECKPOINT_INDEX_BYTES);
  assert.ok(states.some(state => state.overflow && !state.complete));
  assert.equal(states[99].rows[states[99].rows.length - 1].complete, true);
  assert.equal(states[99].rows[0].baseline, true);
});

test('default checkpoint budgets cover replay02 evidence with room for version-two baseline vectors', () => {
  assert.ok(CODEX_QUOTA_CHECKPOINT_INDEX_BYTES >= 32 * 1024 * 1024);
  assert.ok(CODEX_QUOTA_CHECKPOINT_SNAPSHOT_LIMIT >= 65536);
  assert.ok(CODEX_QUOTA_CHECKPOINT_SNAPSHOT_BYTES >= 32 * 1024 * 1024);
});
