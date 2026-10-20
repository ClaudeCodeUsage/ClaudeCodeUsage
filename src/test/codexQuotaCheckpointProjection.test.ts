import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createCodexQuotaCheckpointState, projectCodexQuotaCheckpointSegments,
  boundCodexQuotaCheckpointStates, CODEX_QUOTA_CHECKPOINT_INDEX_BYTES,
  CODEX_QUOTA_CHECKPOINT_SNAPSHOT_BYTES } from '../providers/codex/codexQuotaCheckpoints';

const now = Date.parse('2026-10-20T00:00:00Z'), week = 7 * 86400000;
function stateFor(source: number, count: number) {
  const state = createCodexQuotaCheckpointState(0);
  const from = now - (source % 12) * week + source;
  state.segment = 1; state.source = 1; state.pendingBoundary = false;
  state.rows = Array.from({ length: count }, (_, n): typeof state.rows[number] => ({ segment: 1, from,
    through: from + n * 1000, resetAt: now - (source % 12) * week + week,
    usedPercent: 10 + n, baseline: n === 0, complete: true,
    byModel: n === 0 ? {} : { 'gpt-5': { inputTotal: n * 100, outputTotal: n * 2,
      cachedInput: n * 20, reasoningOutput: n, sourceTotal: n * 102 } },
    ...(n === 0 ? { baselineByModel: { 'gpt-5': { inputTotal: 100, outputTotal: 2,
      cachedInput: 20, reasoningOutput: 1, sourceTotal: 102 } } } : {}),
  }));
  state.byModel = { ...state.rows[count - 1].byModel };
  state.lastEventAt = state.rows[count - 1].through;
  return state;
}

test('replay02-sized numeric corpus retains all 7483 sources and 47899 version-two points across 12 windows', () => {
  const states = Array.from({ length: 7483 }, (_, i) => stateFor(i, i < 3001 ? 7 : 6));
  boundCodexQuotaCheckpointStates(states);
  assert.ok(states.every(state => state.complete && !state.overflow));
  const stateBytes = states.reduce((sum, state) => sum + Buffer.byteLength(JSON.stringify([state.rows, state.byModel])), 0);
  assert.ok(stateBytes <= CODEX_QUOTA_CHECKPOINT_INDEX_BYTES);
  const projection = projectCodexQuotaCheckpointSegments(states.map((state, i) => ({
    sourceKey: i.toString(16).padStart(64, '0'), rows: state.rows, eligible: true,
  })));
  assert.equal(projection.checkpoints.length, 47899);
  assert.equal(new Set(projection.checkpoints.map(row => row.sourceKey)).size, 7483);
  assert.equal(new Set(projection.checkpoints.map(row => row.resetAt)).size, 12);
  assert.equal(projection.complete, true);
  assert.deepEqual(projection.omittedResets, []);
  assert.ok(Buffer.byteLength(JSON.stringify(projection.checkpoints)) <= CODEX_QUOTA_CHECKPOINT_SNAPSHOT_BYTES);
  assert.ok(projection.checkpoints.filter(row => row.baseline).every(row => row.baselineByModel!['gpt-5'].inputTotal === 100));
});

test('real row or byte pressure keeps whole recent intervals and reports omitted window anchors', () => {
  const segments = Array.from({ length: 3 }, (_, i) => ({ sourceKey: String(i).repeat(64),
    rows: stateFor(i, 6).rows, eligible: true }));
  const selected = projectCodexQuotaCheckpointSegments(segments, { maxRows: 4, maxBytes: 1024 * 1024 });
  assert.equal(selected.checkpoints.length, 4);
  assert.equal(selected.complete, false);
  assert.deepEqual(selected.omittedResets, [segments[2].rows[0].resetAt]);
  assert.ok(selected.checkpoints.filter(row => row.baseline).every(row =>
    row.baselineByModel!['gpt-5'].inputTotal === 100 && Object.keys(row.byModel).length === 0));
  const refused = projectCodexQuotaCheckpointSegments(segments, { maxRows: 65536, maxBytes: 1 });
  assert.equal(refused.checkpoints.length, 0);
  assert.equal(refused.complete, false);
  assert.equal(refused.omittedResets.length, 3);
});
