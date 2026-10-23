import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createEmptyCodexIndex, normalizeCodexIndex, updateCodexIndex } from '../providers/codex/codexIndex';
const K = '1'.repeat(64), V = 'a'.repeat(64), T = Date.parse('2026-10-23T02:00Z');
const body = [ { type: 'session_meta', payload: { id: 'synthetic-volume' } },
  { type: 'turn_context', payload: { model: 'gpt-5' } },
  { type: 'event_msg', timestamp: new Date(T - 1000).toISOString(), payload: { type: 'token_count',
    info: { last_token_usage: { input_tokens: 50, output_tokens: 1 } } } },
].map(x => JSON.stringify(x) + '\n').join('');
const entry = (dev = 1, volumeKey: string | undefined = V) => ({ fileKey: K, sourceArea: 'sessions' as const,
  size: Buffer.byteLength(body), mtimeMs: T, dev, ino: 4, ...(volumeKey ? { volumeKey } : {}) });
const manifest = (e: ReturnType<typeof entry>) => ({ files: [{ ...e, absolutePath: '/synthetic-not-opened.jsonl', nonPersisted: true as const }], persistable: { [K]: e } });
const options = { salt: 'synthetic-volume', timeZone: 'UTC', now: () => T,
  allowHistoricalBackfill: false, allowAchievementHourProof: false };
async function seed() { return (await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest(entry()), {
  ...options, io: { async *read() { yield Buffer.from(body); } },
})).index; }
test('volume provenance survives normalized P1 and permits metadata-only device renumbering', async () => {
  const old = normalizeCodexIndex(await seed())!;
  assert.equal((old.files[K] as any).volumeKey, V);
  let reads = 0;
  const result = await updateCodexIndex(old, manifest(entry(2)), { ...options,
    io: { async *read() { reads++; yield Buffer.from(body); } } });
  assert.equal(reads, 0); assert.equal(result.bodyReads, 0); assert.equal(result.indexChanged, true);
  assert.equal(result.index.files[K].dev, 2); assert.equal((result.index.files[K] as any).volumeKey, V);
  assert.deepEqual(result.index.files[K].aggregate.total, old.files[K].aggregate.total);
  assert.deepEqual(result.index.files[K].qualityFlags, old.files[K].qualityFlags);
  assert.equal(normalizeCodexIndex(result.index)!.files[K].dev, 2);
});
test('legacy cache may learn volume only on already-matching device/inode; changed device still rescans', async () => {
  for (const dev of [1, 2]) {
    const old = normalizeCodexIndex(await seed())!; delete (old.files[K] as any).volumeKey;
    let reads = 0;
    const result = await updateCodexIndex(old, manifest(entry(dev)), { ...options,
      io: { async *read(_e, start, end) { reads++; if (dev === 2) assert.equal(start, 0); yield Buffer.from(body).subarray(start, end); } } });
    assert.equal(reads, dev === 1 ? 0 : 1); assert.equal((result.index.files[K] as any).volumeKey, V);
  }
});
test('different volume or inode still forces validation; invalid volume text is never retained', async () => {
  for (const kind of ['volume', 'inode']) {
    const old = normalizeCodexIndex(await seed())!, e = entry();
    if (kind === 'volume') e.volumeKey = 'b'.repeat(64); else e.ino = 9;
    const result = await updateCodexIndex(old, manifest(e), { ...options,
      io: { async *read(_e, start, end) { assert.equal(start, 0); yield Buffer.from(body).subarray(start, end); } } });
    assert.equal(result.bodyReads, 1);
  }
  const raw = await seed(); (raw.files[K] as any).volumeKey = '/private/forbidden';
  assert.equal((normalizeCodexIndex(raw)!.files[K] as any).volumeKey, undefined);
});
test('a same-volume move cannot stamp rewritten or truncated bytes onto old totals', async () => {
  for (const n of [90, 5]) {
    const old = normalizeCodexIndex(await seed())!, nextBody = body.replace('"input_tokens":50', '"input_tokens":' + n);
    const key = '2'.repeat(64), e = { ...entry(2), fileKey: key, sourceArea: 'archive' as const,
      size: Buffer.byteLength(nextBody), mtimeMs: T + 1 };
    let reads = 0;
    const result = await updateCodexIndex(old, { files: [{ ...e, absolutePath: '/synthetic-archive-not-opened.jsonl', nonPersisted: true }],
      persistable: { [key]: e } }, { ...options, io: { async *read(_entry, start, end) {
        reads++; assert.equal(start, 0); yield Buffer.from(nextBody).subarray(start, end);
      } } });
    assert.equal(reads, 1); assert.equal(result.index.files[K], undefined);
    assert.equal(result.index.files[key].aggregate.total.inputTotal, n);
  }
});
