import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex, CodexIndexV1 } from '../providers/codex/codexIndex';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { buildCodexForwardCalibration, isCodexForwardAppend } from '../providers/codex/codexForwardCalibration';
import { CODEX_LINEAGE_FINGERPRINT_BYTES, CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK } from '../providers/codex/codexLineage';

const T = Date.parse('2026-10-20T02:00Z'), salt = 'synthetic-packed-forward-lineage';
function request(n: number): string {
  const input = 10 + n, cumulative = 10 * n + n * (n + 1) / 2;
  return JSON.stringify({ type: 'event_msg', timestamp: new Date(T + n * 1000).toISOString(),
    payload: { type: 'token_count', info: {
      last_token_usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
      total_token_usage: { input_tokens: cumulative, cached_input_tokens: 0, output_tokens: n,
        reasoning_output_tokens: 0, total_tokens: cumulative + n },
    }, rate_limits: { limit_id: 'codex', secondary: {
      used_percent: 5 + n / 10000, window_minutes: 10080, resets_at: T + 6 * 86400000,
    } } } }) + '\n';
}
async function fixture(t: TestContext, count: number) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-forward-packed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', 'synthetic.jsonl');
  const header = [{ type: 'session_meta', timestamp: new Date(T).toISOString(), payload: { id: 'synthetic-packed-root' } },
    { type: 'turn_context', timestamp: new Date(T).toISOString(), payload: { model: 'gpt-5' } }];
  await writeFile(file, header.map(row => JSON.stringify(row) + '\n').join('') +
    Array.from({ length: count }, (_, i) => request(i + 1)).join(''));
  const options = { salt, timeZone: 'UTC', now: () => T + 2_000_000,
    allowHistoricalBackfill: false, allowAchievementHourProof: false };
  const refresh = (previous: CodexIndexV1) => scanCodexManifest(root, salt).then(manifest => updateCodexIndex(previous, manifest, options));
  const first = await refresh(createEmptyCodexIndex('UTC'));
  return { file, refresh, first: first.index, key: Object.keys(first.index.files)[0] };
}
function source(index: CodexIndexV1) {
  const proof = buildCodexForwardCalibration(index, true, new Set(Object.keys(index.files)), new Set(), T + 3_000_000);
  assert.ok(proof); assert.equal(proof.sources.length, 1);
  return proof.sources[0];
}
const packed = (count: number) => Buffer.alloc(count * CODEX_LINEAGE_FINGERPRINT_BYTES, 1).toString('base64');

test('production scanner EOF packs one request and append two; both and normalized reload remain eligible', async t => {
  const f = await fixture(t, 1), before = f.first.files[f.key].lineage!;
  assert.equal(before.tokenEvents, 1); assert.deepEqual(before.pendingFingerprints, []);
  assert.equal(Buffer.from(before.fingerprintBlocks[0], 'base64').length, CODEX_LINEAGE_FINGERPRINT_BYTES);
  const one = source(f.first);
  assert.equal(one.eligible, true); assert.ok(one.lineage);
  const reloaded = normalizeCodexIndex(JSON.parse(JSON.stringify(f.first)))!;
  assert.equal(source(reloaded).eligible, true); assert.equal(source(reloaded).lineage?.hash, one.lineage.hash);
  await appendFile(f.file, request(2));
  const next = (await f.refresh(reloaded)).index, two = source(next);
  assert.equal(two.eligible, true); assert.equal(two.lineage?.tokenEvents, 2);
  assert.equal(isCodexForwardAppend(one, two), true);
  const again = source(normalizeCodexIndex(JSON.parse(JSON.stringify(next)))!);
  assert.equal(again.eligible, true); assert.equal(again.lineage?.hash, two.lineage?.hash);
  assert.equal(isCodexForwardAppend(one, again), true);
});

test('production 1023 to 1024 to 1025 repacking preserves ordered fingerprint prefixes', async t => {
  const f = await fixture(t, 1023), initial = source(f.first);
  assert.equal(initial.eligible, true); assert.equal(initial.lineage?.tokenEvents, 1023);
  let index = normalizeCodexIndex(JSON.parse(JSON.stringify(f.first)))!;
  await appendFile(f.file, request(1024));
  index = (await f.refresh(index)).index;
  const full = source(index), l = index.files[f.key].lineage!;
  assert.equal(full.eligible, true); assert.equal(l.fingerprintBlocks.length, 1);
  assert.equal(Buffer.from(l.fingerprintBlocks[0], 'base64').length,
    CODEX_LINEAGE_FINGERPRINTS_PER_BLOCK * CODEX_LINEAGE_FINGERPRINT_BYTES);
  assert.equal(isCodexForwardAppend(initial, full), true);
  index = normalizeCodexIndex(JSON.parse(JSON.stringify(index)))!;
  await appendFile(f.file, request(1025));
  index = (await f.refresh(index)).index;
  const partial = source(index);
  assert.equal(partial.eligible, true); assert.equal(partial.lineage?.tokenEvents, 1025);
  assert.equal(index.files[f.key].lineage!.fingerprintBlocks.length, 2);
  assert.equal(isCodexForwardAppend(full, partial), true);
  const pending = structuredClone(index), tail = pending.files[f.key].lineage!;
  tail.pendingFingerprints = [Buffer.from(tail.fingerprintBlocks.pop()!, 'base64').toString('hex')];
  const unpacked = source(pending);
  assert.equal(unpacked.eligible, true); assert.equal(unpacked.lineage?.hash, partial.lineage?.hash);
  assert.equal(isCodexForwardAppend(full, unpacked), true);
  const reordered = structuredClone(index), blocks = reordered.files[f.key].lineage!.fingerprintBlocks;
  const bytes = Buffer.from(blocks[0], 'base64'), first = Buffer.from(bytes.subarray(0, 16));
  bytes.copy(bytes, 0, 16, 32); first.copy(bytes, 16); blocks[0] = bytes.toString('base64');
  const badPrefix = source(reordered);
  assert.equal(badPrefix.eligible, true, 'a well-shaped reordered trace still needs prefix comparison');
  assert.equal(isCodexForwardAppend(full, badPrefix), false);
});

test('malformed packed sizes, partial middle blocks, pending conflicts and event counts fail closed', async t => {
  const f = await fixture(t, 1), full = packed(1024), partial = packed(1);
  const cases: Array<{ blocks: string[]; pending: string[]; count: number }> = [
    { blocks: [partial, full], pending: [], count: 1025 },
    { blocks: [partial, partial], pending: [], count: 2 },
    { blocks: [partial], pending: ['a'.repeat(32)], count: 2 },
    { blocks: [''], pending: [], count: 0 },
    { blocks: [Buffer.alloc(15).toString('base64')], pending: [], count: 1 },
    { blocks: [Buffer.alloc(17).toString('base64')], pending: [], count: 1 },
    { blocks: [packed(1025)], pending: [], count: 1025 },
    { blocks: [partial + '\n'], pending: [], count: 1 },
    { blocks: [partial.slice(0, -2) + '=='], pending: [], count: 2 },
    { blocks: [partial], pending: [], count: 2 },
    { blocks: [], pending: ['A'.repeat(32)], count: 1 },
    { blocks: [], pending: Array(1024).fill('a'.repeat(32)), count: 1024 },
  ];
  // Nonzero unused Base64 padding bits decode identically, but are not canonical.
  const noncanonical = Buffer.alloc(16).toString('base64').slice(0, -3) + 'B==';
  cases.push({ blocks: [noncanonical], pending: [], count: 1 });
  for (const [n, value] of cases.entries()) {
    const i = structuredClone(f.first), l = i.files[f.key].lineage!;
    l.fingerprintBlocks = value.blocks; l.pendingFingerprints = value.pending; l.tokenEvents = value.count;
    const s = source(i);
    assert.equal(s.eligible, false, `case ${n}`); assert.equal(s.lineage, null, `case ${n}`);
  }
});
