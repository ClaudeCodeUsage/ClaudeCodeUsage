import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import { createEmptyCodexIndex, updateCodexIndex, saveCodexIndexAtomic, loadCodexIndex,
  isCodexUsageContributionCurrent, CodexIndexCancelledError } from '../providers/codex/codexIndex';
import { classifyCodexSessionDuplicates } from '../providers/codex/codexDedup';
import { canonicalCodexOutputHours } from '../providers/codex/codexHourProof';
import { codexOriginBaselineReady } from '../providers/codex/codexAchievementOrigin';

const native = typeof zlib.createZstdDecompress === 'function';
const options = { salt: 'compressed-fixture-salt', timeZone: 'UTC', asOfDay: '2026-07-22',
  budget: { maxFilePasses: 1000, maxBytes: 64 * 1024 * 1024 } };
function log(id: string, padding = ''): Buffer {
  return Buffer.from([
    { timestamp: '2026-07-20T00:00:00Z', type: 'session_meta', payload: { id, cwd: '/anonymous/fixture', source: 'cli' } },
    { timestamp: '2026-07-20T00:00:01Z', type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } },
    ...(padding ? [{ type: 'fixture-padding', padding }] : []),
    { timestamp: '2026-07-20T00:00:02Z', type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 30,
        reasoning_output_tokens: 10, total_tokens: 130 } } } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
}
/** Standards-valid raw blocks work even when the test runner cannot encode Zstd. */
function frame(bytes: Buffer): Buffer {
  const header = Buffer.alloc(9); header.writeUInt32LE(0xfd2fb528, 0); header[4] = 0xa0;
  header.writeUInt32LE(bytes.length, 5);
  const parts: Buffer[] = [header];
  if (!bytes.length) parts.push(Buffer.from([1, 0, 0]));
  for (let offset = 0; offset < bytes.length; offset += 128 * 1024) {
    const block = bytes.subarray(offset, offset + 128 * 1024), last = offset + block.length === bytes.length;
    const h = Buffer.alloc(3); h.writeUIntLE((block.length << 3) | Number(last), 0, 3); parts.push(h, block);
  }
  return Buffer.concat(parts);
}
async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'ccu-compressed-index-'));
  try { await mkdir(path.join(home, 'sessions')); await mkdir(path.join(home, 'archived_sessions')); await run(home); }
  finally { await rm(home, { recursive: true, force: true }); }
}

test('compressed imports reproduce the plain complete index without source mutations', { skip: !native }, async () => {
  await withHome(async home => {
    const plain = path.join(home, 'sessions', 'rollout-one.jsonl'), bytes = log('root-one');
    await writeFile(plain, bytes);
    const before = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(home, options.salt), options);
    const packed = frame(bytes); await writeFile(plain + '.zst', packed); await unlink(plain);
    const manifest = await scanCodexManifest(home, options.salt);
    assert.equal(manifest.files.length, 1, 'compressed sources remain in the current census');
    assert.equal(manifest.files[0].size, bytes.length);
    const restored = await updateCodexIndex(before.index, manifest, {
      ...options, achievementUsageWindow: { after: Date.parse('2026-07-19'), through: Date.parse('2026-07-23') },
    });
    assert.equal(restored.failedFiles, 0); assert.equal(restored.index.coverage.complete, true);
    assert.deepEqual(restored.index.aggregate.total, before.index.aggregate.total);
    assert.equal(restored.index.aggregate.total.inputTotal + restored.index.aggregate.total.outputTotal, 130);
    assert.equal(Object.keys(restored.index.files).length, 1);
    assert.equal(restored.achievementUsageDelta, undefined, 'representation conversion is historical, never a live receipt');
    const contribution = Object.values(restored.index.files)[0] as any;
    assert.equal(contribution.compression, 'zstd'); assert.equal(contribution.compressionVerified, true);
    const indexPath = path.join(home, 'derived-index.json'); await saveCodexIndexAtomic(indexPath, restored.index);
    const loaded = await loadCodexIndex(indexPath, 'UTC');
    assert.equal((Object.values(loaded.files)[0] as any).compressionVerified, true);
    const warm = await updateCodexIndex(loaded, await scanCodexManifest(home, options.salt), options);
    assert.equal(warm.bodyReads, 0); assert.equal(warm.failedFiles, 0);
    assert.deepEqual(warm.index.aggregate.total, restored.index.aggregate.total);
    assert.deepEqual(await readFile(plain + '.zst'), packed);
  });
});

test('four active/archive plain/compressed representations count once across conversion and restart', { skip: !native }, async () => {
  await withHome(async home => {
    const bytes = log('one-shared-session');
    const active = path.join(home, 'sessions', 'rollout-copy.jsonl'), archive = path.join(home, 'archived_sessions', 'rollout-copy.jsonl');
    for (const name of [active, archive]) { await writeFile(name, bytes); await writeFile(name + '.zst', frame(bytes)); }
    let index = createEmptyCodexIndex('UTC');
    for (const remove of [undefined, active, archive]) {
      if (remove) await unlink(remove);
      const manifest = await scanCodexManifest(home, options.salt); assert.equal(manifest.files.length, 2);
      const result = await updateCodexIndex(index, manifest, options); index = result.index;
      assert.equal(result.failedFiles, 0); assert.equal(index.coverage.complete, true);
      assert.equal(classifyCodexSessionDuplicates(index.files).canonicalFileKeys.size, 1);
      assert.equal(index.aggregate.total.inputTotal + index.aggregate.total.outputTotal, 130);
      const target = path.join(home, 'derived-index.json'); await saveCodexIndexAtomic(target, index); index = await loadCodexIndex(target);
    }
  });
});

test('a saved compressed draft cannot inherit complete source authority merely from offset equality', () => {
  const draft = { compression: 'zstd', compressionVerified: undefined, qualityFlags: [] } as any;
  assert.equal(isCodexUsageContributionCurrent(draft), false);
  assert.equal(isCodexUsageContributionCurrent({ ...draft, compressionVerified: true }), true);
  assert.equal(isCodexUsageContributionCurrent({ qualityFlags: [] } as any), true, 'legacy plain semantics remain unchanged');
});

test('corrupt or trailing compressed data never commits a complete source', { skip: !native }, async () => {
  for (const kind of ['truncated', 'trailing', 'second-frame'] as const) await withHome(async home => {
    const packed = frame(log('broken-one'));
    const bytes = kind === 'truncated' ? packed.subarray(0, packed.length - 3)
      : Buffer.concat([packed, kind === 'trailing' ? Buffer.from('junk') : packed]);
    const source = path.join(home, 'sessions', 'broken.jsonl.zst'); await writeFile(source, bytes);
    const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(home, options.salt), options);
    assert.ok(result.failedFiles > 0, kind); assert.equal(result.index.coverage.complete, false, kind);
    assert.equal(result.index.aggregate.total.inputTotal + result.index.aggregate.total.outputTotal, 0, kind);
    assert.equal(result.achievementUsageDelta, undefined); assert.deepEqual(await readFile(source), bytes);
  });
});

test('cancelled compressed indexing persists only unverified drafts and resumes once', { skip: !native }, async () => {
  await withHome(async home => {
    const source = path.join(home, 'sessions', 'resume.jsonl.zst');
    const payload = Buffer.concat(Array.from({ length: 400 }, (_, i) => log('resume-root', 'x'.repeat(4096))));
    await writeFile(source, frame(payload));
    const manifest = await scanCodexManifest(home, options.salt), target = path.join(home, 'derived-index.json');
    let cancel = false, saved = false;
    await assert.rejects(updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      ...options, shouldCancel: () => cancel,
      scheduling: { checkpointEveryMs: 0, checkpointEveryBytes: 0, checkpointEveryFilePasses: 1 },
      onCheckpoint: async index => { await saveCodexIndexAtomic(target, index); saved = true; },
      onProgress: progress => { if (progress.indexedBytes > 0) cancel = true; },
    }), CodexIndexCancelledError);
    assert.equal(saved, true);
    const draft = await loadCodexIndex(target); assert.equal(draft.coverage.complete, false);
    for (const file of Object.values(draft.files)) if (!(file as any).compressionVerified) assert.equal(isCodexUsageContributionCurrent(file), false);
    const resumed = await updateCodexIndex(draft, manifest, options);
    assert.equal(resumed.failedFiles, 0); assert.equal(resumed.index.coverage.complete, true);
    assert.equal(resumed.index.aggregate.total.inputTotal + resumed.index.aggregate.total.outputTotal, 130);
    const warm = await updateCodexIndex(resumed.index, manifest, options); assert.equal(warm.bodyReads, 0);
  });
});

test('a valid empty compressed source cannot starve later historical files', { skip: !native }, async () => {
  await withHome(async home => {
    await writeFile(path.join(home, 'sessions', 'normal.jsonl.zst'), frame(log('not-empty')));
    await writeFile(path.join(home, 'sessions', 'empty.jsonl.zst'), frame(Buffer.alloc(0)));
    const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(home, options.salt), options);
    assert.equal(result.failedFiles, 0); assert.equal(result.index.coverage.complete, true);
    assert.equal(Object.keys(result.index.files).length, 2);
    assert.equal(result.index.aggregate.total.inputTotal + result.index.aggregate.total.outputTotal, 130);
  });
});

test('cancellation at decoded EOF must revalidate after durable reload, not grant from cursor equality', { skip: !native }, async () => {
  await withHome(async home => {
    await writeFile(path.join(home, 'sessions', 'last-chunk.jsonl.zst'), frame(log('last-chunk')));
    const manifest = await scanCodexManifest(home, options.salt), target = path.join(home, 'derived-index.json');
    let cancel = false;
    await assert.rejects(updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { ...options,
      shouldCancel: () => cancel,
      scheduling: { checkpointEveryMs: 0, checkpointEveryBytes: 0, checkpointEveryFilePasses: 1 },
      onCheckpoint: async index => saveCodexIndexAtomic(target, index),
      onProgress: progress => { if (progress.indexedBytes === progress.totalBytes && progress.totalBytes > 0) cancel = true; },
    }), CodexIndexCancelledError);
    const draft = await loadCodexIndex(target); assert.equal(draft.coverage.complete, false);
    assert.equal(Object.values(draft.files)[0]?.offset, manifest.files[0].size);
    assert.equal(isCodexUsageContributionCurrent(Object.values(draft.files)[0]), false);
    const result = await updateCodexIndex(draft, manifest, options);
    assert.ok(result.bodyReads > 0); assert.equal(result.index.coverage.complete, true);
    assert.equal(result.index.aggregate.total.inputTotal + result.index.aggregate.total.outputTotal, 130);
  });
});

test('one bounded compressed file can exceed a soft refresh budget without permanent resume starvation', { skip: !native }, async () => {
  await withHome(async home => {
    const payload = Buffer.concat(Array.from({ length: 400 }, () => log('budget-root', 'x'.repeat(4096))));
    await writeFile(path.join(home, 'sessions', 'large.jsonl.zst'), frame(payload));
    const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(home, options.salt), {
      ...options, budget: { maxFilePasses: 2, maxBytes: 1024 * 1024 + 1 },
    });
    assert.equal(result.failedFiles, 0); assert.equal(result.index.coverage.complete, true);
    assert.ok(result.migration.bytesRead > 1024 * 1024 + 1, 'actual decoded work includes the whole bounded frame');
    assert.equal(result.index.aggregate.total.inputTotal + result.index.aggregate.total.outputTotal, 130);
  });
});

test('immutable compressed EOF adjudicates final records without permanent tail retries', { skip: !native }, async () => {
  for (const ending of ['valid-no-newline', 'fragment', 'oversized'] as const) await withHome(async home => {
    const original = log('final-record');
    const bytes = ending === 'valid-no-newline' ? original.subarray(0, original.length - 1)
      : Buffer.concat([original, ending === 'fragment' ? Buffer.from('{"unfinished":') : Buffer.alloc(1024 * 1024 + 1, 0x78)]);
    await writeFile(path.join(home, 'sessions', 'final.jsonl.zst'), frame(bytes));
    const manifest = await scanCodexManifest(home, options.salt);
    const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, options);
    assert.equal(result.failedFiles, 0, ending); assert.equal(result.index.coverage.complete, true, ending);
    assert.equal(result.index.aggregate.total.inputTotal + result.index.aggregate.total.outputTotal, 130, ending);
    const file = Object.values(result.index.files)[0];
    assert.equal(file.offset, file.size); assert.equal(file.discardingOversizedLine, false);
    if (ending !== 'valid-no-newline') assert.ok(file.qualityFlags.includes(ending === 'fragment' ? 'invalid-json' : 'oversized-jsonl-line'));
    const warm = await updateCodexIndex(result.index, manifest, options); assert.equal(warm.bodyReads, 0, ending);
  });
});

test('independent hour and origin consumers reject unverified compressed EOF claims', () => {
  const file: any = { compression: 'zstd', size: 10, offset: 10, discardingOversizedLine: false,
    identityChecked: true, qualityFlags: [], lineage: { appliedPrefixEvents: 0, desiredPrefixEvents: 0 },
    hourProof: { version: 1, indexedThrough: 10, prefixEvents: 0, hours: [500000] } };
  assert.equal(canonicalCodexOutputHours({ one: file }, new Set(['one']), true).complete, false);
  assert.equal(codexOriginBaselineReady({ coverage: { complete: true, indexedFiles: 1, totalFiles: 1 }, files: { one: file } } as any), false);
});
