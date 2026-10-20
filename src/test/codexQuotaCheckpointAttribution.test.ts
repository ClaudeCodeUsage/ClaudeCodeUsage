import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexParserState, createCodexParserState, parseCodexLine } from '../providers/codex/codexParser';
import { createCodexQuotaCheckpointState, retainCodexQuotaCheckpoints } from '../providers/codex/codexQuotaCheckpoints';

const start = Date.parse('2026-10-20T00:00:00Z');
const valid = { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 2 };
function line(n: number, total: number, last: unknown, cumulativeCached = 0) {
  return JSON.stringify({ type: 'event_msg', timestamp: new Date(start + n * 1000).toISOString(), payload: {
    type: 'token_count', info: { total_token_usage: { input_tokens: total, cached_input_tokens: cumulativeCached,
      output_tokens: total / 10 }, ...(last !== undefined ? { last_token_usage: last } : {}) },
    rate_limits: { limit_id: 'codex', secondary: { used_percent: 10 + n * 10,
      window_minutes: 10080, resets_at: start + 604800000 } },
  } });
}
function initial(): CodexParserState {
  return parseCodexLine(line(1, 10000, { ...valid, input_tokens: 500, cached_input_tokens: 100 }),
    { ...createCodexParserState('a'.repeat(64)), model: 'gpt-5' }).state;
}
test('valid last requests remain paired below cumulative high-water without changing primary warnings or counters', () => {
  let parser: CodexParserState = { ...createCodexParserState('a'.repeat(64)), model: 'gpt-5' };
  const checkpoints = createCodexQuotaCheckpointState(0);
  for (const [n, total, input] of [[1, 10000, 500], [2, 1000, 100], [3, 1200, 200]]) {
    const parsed = parseCodexLine(line(n, total, { ...valid, input_tokens: input }), parser);
    parser = parsed.state;
    assert.equal(!!parsed.quotaPairingIncomplete, false);
    assert.equal(parsed.events[0].tokens.inputTotal, input);
    if (n > 1) {
      assert.ok(parser.qualityFlags.includes('counter-regression'));
      assert.equal(parsed.events[0].confidence, 'partial');
    }
    assert.equal(parser.highWater!.inputTokens, 10000);
    retainCodexQuotaCheckpoints(checkpoints, parsed, true);
  }
  assert.deepEqual(checkpoints.rows.map(row => row.baseline), [true, false, false]);
  assert.equal(checkpoints.rows[2].byModel['gpt-5'].inputTotal, 300);
  assert.equal(checkpoints.rows[0].baselineByModel!['gpt-5'].inputTotal, 500);
  assert.equal(checkpoints.ranges.length, 0);
});
test('malformed optional request cost components are calibration-incomplete while primary normalization is preserved', async t => {
  const cases: Array<[string, Record<string, unknown>, number, number]> = [
    ['cached above input', { cached_input_tokens: 101 }, 100, 2],
    ['reasoning above output', { reasoning_output_tokens: 11 }, 20, 10],
    ['cached string', { cached_input_tokens: 'invalid' }, 0, 2],
    ['cached null', { cached_input_tokens: null }, 0, 2],
    ['cached negative', { cached_input_tokens: -1 }, 0, 2],
    ['alias invalid with preferred valid', { cache_read_input_tokens: 'invalid' }, 20, 2],
    ['conflicting aliases', { cache_read_input_tokens: 21 }, 20, 2],
    ['alias fractional', { cache_read_input_tokens: 1.5 }, 20, 2],
    ['alias unsafe', { cache_read_input_tokens: Number.MAX_SAFE_INTEGER + 1 }, 20, 2],
    ['invalid alias without preferred field', { cached_input_tokens: undefined, cache_read_input_tokens: 'invalid' }, 0, 2],
    ['alias above input without preferred field', { cached_input_tokens: undefined, cache_read_input_tokens: 101 }, 100, 2],
    ['reasoning string', { reasoning_output_tokens: 'invalid' }, 20, 0],
    ['reasoning null', { reasoning_output_tokens: null }, 20, 0],
    ['reasoning negative', { reasoning_output_tokens: -1 }, 20, 0],
    ['reasoning unsafe', { reasoning_output_tokens: Number.MAX_SAFE_INTEGER + 1 }, 20, 0],
  ];
  for (const [name, overrides, cached, reasoning] of cases) await t.test(name, () => {
    const result = parseCodexLine(line(2, 11000, { ...valid, ...overrides }), initial());
    assert.equal(result.events[0].tokens.inputTotal, 100);
    assert.equal(result.events[0].tokens.cachedInput, cached);
    assert.equal(result.events[0].tokens.reasoningOutput, reasoning);
    assert.equal(result.state.highWater!.inputTokens, 11000);
    assert.equal(!!result.quotaPairingIncomplete, true);
  });
});
test('unsafe processed sums reject calibration without rewriting primary request totals', () => {
  const result = parseCodexLine(line(2, 11000, { input_tokens: Number.MAX_SAFE_INTEGER,
    output_tokens: 1, cached_input_tokens: 0, reasoning_output_tokens: 0 }), initial());
  assert.equal(result.events[0].tokens.inputTotal, Number.MAX_SAFE_INTEGER);
  assert.equal(result.events[0].tokens.sourceTotal, Number.MAX_SAFE_INTEGER + 1);
  assert.equal(!!result.quotaPairingIncomplete, true);
});
test('last context total remains independent, omitted cost fields and matching valid aliases remain accepted', () => {
  for (const last of [
    { ...valid, total_tokens: 300000 },
    { input_tokens: 100, output_tokens: 10 },
    { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 20 },
    { ...valid, cache_read_input_tokens: 20 },
  ]) {
    const result = parseCodexLine(line(2, 1000, last), initial());
    assert.equal(!!result.quotaPairingIncomplete, false);
    assert.equal(result.events[0].tokens.sourceTotal, 110);
  }
});
test('cumulative-only regression, clamped component deltas and malformed present last objects stay incomplete', () => {
  const previous = parseCodexLine(line(1, 10000, valid, 1000),
    { ...createCodexParserState('a'.repeat(64)), model: 'gpt-5' }).state;
  for (const text of [line(2, 1000, undefined), line(2, 11000, undefined, 10000),
    line(2, 11000, { ...valid, input_tokens: -1 })]) {
    assert.equal(!!parseCodexLine(text, previous).quotaPairingIncomplete, true);
  }
});
test('replayed valid last snapshots remain deduplicated even below the old high-water', () => {
  const first = parseCodexLine(line(2, 1000, valid), initial());
  const duplicate = parseCodexLine(line(3, 1000, valid), first.state);
  assert.equal(duplicate.events.length, 0);
  assert.equal(duplicate.lineageTokenKey, first.lineageTokenKey);
  assert.ok(duplicate.state.qualityFlags.includes('counter-regression'));
  assert.equal(!!duplicate.quotaPairingIncomplete, false);
});
