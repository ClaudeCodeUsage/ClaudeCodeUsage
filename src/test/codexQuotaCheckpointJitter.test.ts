import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CodexParserState, createCodexParserState, parseCodexLine } from '../providers/codex/codexParser';
import { createCodexQuotaCheckpointState, retainCodexQuotaCheckpoints,
  sanitizeCodexQuotaCheckpointState, markCodexQuotaCheckpointGap } from '../providers/codex/codexQuotaCheckpoints';

const start = Date.parse('2026-10-20T00:00:00Z'), reset = start + 6 * 86400000, tolerance = 300000;
function raw(n: number, used: number, input: number, resetsAt: number, id = 'codex') {
  return JSON.stringify({ type: 'event_msg', timestamp: new Date(start + n * 1000).toISOString(), payload: {
    type: 'token_count', info: { last_token_usage: { input_tokens: input, output_tokens: 2 } },
    rate_limits: { limit_id: id, secondary: { used_percent: used, window_minutes: 10080, resets_at: resetsAt } },
  } });
}
function fixture() {
  let parser: CodexParserState = { ...createCodexParserState('a'.repeat(64)), model: 'gpt-5' };
  const state = createCodexQuotaCheckpointState(0);
  return { state, add(n: number, used: number, input: number, resetsAt: number, id = 'codex') {
    const result = parseCodexLine(raw(n, used, input, resetsAt, id), parser);
    parser = result.state; retainCodexQuotaCheckpoints(state, result, true);
    return result;
  } };
}
test('five-second reset jitter preserves deltas and retains each original observed reset', () => {
  const f = fixture(); f.add(1, 20, 500, reset); f.add(2, 30, 100, reset + 5000); f.add(3, 40, 200, reset - 5000);
  assert.deepEqual(f.state.rows.map(row => row.baseline), [true, false, false]);
  assert.deepEqual(f.state.rows.map(row => row.resetAt), [reset, reset, reset]);
  assert.deepEqual(f.state.rows.map(row => (row as any).observedResetAt), [reset, reset + 5000, reset - 5000]);
  assert.equal(f.state.rows[1].byModel['gpt-5'].inputTotal, 100);
  assert.equal(f.state.rows[2].byModel['gpt-5'].inputTotal, 300);
  assert.equal(f.state.rows[0].baselineByModel!['gpt-5'].inputTotal, 500);
});
test('tolerance is inclusive but anchored to the first reset, never chained', () => {
  for (const direction of [-1, 1]) {
    const f = fixture(); f.add(1, 20, 500, reset); f.add(2, 30, 100, reset + direction * tolerance);
    assert.equal(f.state.rows[1].baseline, false);
    f.add(3, 40, 200, reset + direction * (tolerance + 1));
    assert.equal(f.state.rows[2].baseline, true);
  }
  const f = fixture(); f.add(1, 20, 500, reset); f.add(2, 30, 100, reset + 240000); f.add(3, 40, 200, reset + 480000);
  assert.deepEqual(f.state.rows.map(row => row.baseline), [true, false, true]);
});
test('neither raw nor canonical reset boundaries can be crossed by tolerance', () => {
  const f = fixture(); f.add(1, 20, 500, start + 5000); f.add(6, 30, 100, start + 10000);
  assert.equal(f.state.rows[1].baseline, true);
  assert.equal(f.state.rows[1].resetAt, start + 10000);
  assert.deepEqual(f.state.rows[1].byModel, {});
  const expired = fixture(); expired.add(1, 20, 500, start + 10000); expired.add(6, 30, 100, start + 5000);
  assert.equal(expired.state.rows.length, 1);
  assert.equal(expired.state.pendingBoundary, true);
});
test('source switches, percentage drops and explicit gaps still split jitter-compatible resets', () => {
  const f = fixture(); f.add(1, 20, 500, reset); f.add(2, 10, 100, reset + 5000);
  assert.equal(f.state.rows[1].baseline, true);
  f.add(3, 11, 200, reset + 6000, 'spark'); f.add(4, 12, 100, reset + 7000);
  assert.equal(f.state.rows[f.state.rows.length - 1].baseline, true);
  markCodexQuotaCheckpointGap(f.state);
  f.add(5, 13, 100, reset + 8000);
  assert.equal(f.state.rows[f.state.rows.length - 1].baseline, true);
});
test('strict reload keeps the original anchor and rejects fabricated canonical or observed reset fields', () => {
  const f = fixture(); f.add(1, 20, 500, reset); f.add(2, 30, 100, reset + 240000);
  const loaded = sanitizeCodexQuotaCheckpointState(JSON.parse(JSON.stringify(f.state)))!;
  assert.ok(loaded); assert.deepEqual(loaded, f.state);
  let parser: CodexParserState = { ...createCodexParserState('a'.repeat(64)), model: 'gpt-5' };
  parser = parseCodexLine(raw(1, 20, 500, reset), parser).state;
  parser = parseCodexLine(raw(2, 30, 100, reset + 240000), parser).state;
  retainCodexQuotaCheckpoints(loaded, parseCodexLine(raw(3, 40, 200, reset + 480000), parser), true);
  assert.equal(loaded.rows[2].baseline, true);
  for (const mutate of [
    (state: any) => { delete state.rows[1].observedResetAt; },
    (state: any) => { state.rows[1].observedResetAt = reset + tolerance + 1; },
    (state: any) => { state.rows[1].resetAt = reset + 240000; },
    (state: any) => { state.segmentResetAt = reset + 240000; },
  ]) { const bad = JSON.parse(JSON.stringify(f.state)); mutate(bad); assert.equal(sanitizeCodexQuotaCheckpointState(bad), undefined); }
  const v3 = JSON.parse(JSON.stringify(f.state)); v3.version = 3;
  assert.equal(sanitizeCodexQuotaCheckpointState(v3), undefined);
});
