import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createEmptyCodexIndex, updateCodexIndex, saveCodexIndexAtomic, loadCodexIndex,
  normalizeCodexIndex, CodexIndexCancelledError, codexFilePassFailureCode, type CodexIndexV3 } from '../providers/codex/codexIndex';
import { scanCodexManifest, type CodexManifest } from '../providers/codex/codexManifest';
import { CodexFilePassPool } from '../providers/codex/codexFilePassPool';
import { CodexZstdError, supportsCodexZstd, type CodexZstdErrorCode } from '../providers/codex/codexZstd';
import * as fsPromises from 'node:fs/promises';

const options = { salt: 'terminal-fixture', timeZone: 'UTC', now: () => Date.parse('2026-07-22T12:00:00Z') };
const body = Buffer.from([
  { type: 'session_meta', payload: { id: 'terminal-fixture-session', source: 'cli' } },
  { type: 'event_msg', timestamp: '2026-07-20T00:00:00Z', payload: { type: 'token_count', info: {
    total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } } },
].map(row => JSON.stringify(row)).join('\n') + '\n');
function frame(content = body): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0xfd2fb528); header[4] = 0xa0; header.writeUInt32LE(content.length, 5);
  header.writeUIntLE((content.length << 3) | 1, 9, 3);
  return Buffer.concat([header, content]);
}
async function fixture(run: (home: string, source: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'ccu-terminal-'));
  try {
    await mkdir(path.join(home, 'sessions'));
    const source = path.join(home, 'sessions', 'private-fixture.jsonl.zst');
    await writeFile(source, Buffer.concat([frame(), Buffer.from('private-trailing-payload')]));
    await run(home, source);
  } finally { await rm(home, { recursive: true, force: true }); }
}
function failure(index: CodexIndexV3): any { return Object.values(index.files).find(row => row.compression)?.compressionFailure; }
async function assertStable(index: CodexIndexV3, manifest: CodexManifest): Promise<void> {
  let writes = 0;
  const next = await updateCodexIndex(index, manifest, { ...options,
    onCheckpoint: async () => { writes++; }, io: { async *read() { throw Error('must not read'); } } });
  assert.equal(next.bodyReads, 0); assert.equal(next.indexChanged, false); assert.equal(writes, 0);
  assert.equal(next.migration.pending, false); assert.ok(next.failedFiles > 0);
  assert.equal(next.index.coverage.complete, false); assert.equal(next.achievementUsageDelta, undefined);
}

test('terminal codec failure survives restart without body reads, writes or pending migration', { skip: !supportsCodexZstd() }, async () => {
  await fixture(async (home, source) => {
    const manifest = await scanCodexManifest(home, options.salt), original = await readFile(source);
    const first = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, options);
    assert.equal(first.failedFiles, 1); assert.equal(first.bodyReads, 1);
    assert.deepEqual(failure(first.index), { version: 1, code: 'trailing-data' });
    assert.equal(first.index.coverage.totalFiles, 1); assert.equal(first.index.coverage.indexedFiles, 0);
    assert.equal(first.index.aggregate.total.inputTotal, 0); assert.equal(first.migration.pending, false);
    const row = Object.values(first.index.files)[0];
    assert.equal(row.offset, 0); assert.equal(row.compressionVerified, undefined);
    assert.equal(row.aggregate.period, undefined); assert.equal(row.hourProof, undefined);
    const target = path.join(home, 'index.json'); await saveCodexIndexAtomic(target, first.index);
    const serialized = await readFile(target, 'utf8');
    assert.doesNotMatch(serialized, /private-trailing-payload|private-fixture|terminal-fixture-session/);
    const loaded = await loadCodexIndex(target);
    assert.deepEqual(failure(loaded), failure(first.index));
    await assertStable(loaded, manifest);
    assert.deepEqual(await readFile(source), original);
  });
});

test('changed compressed fingerprint or plain representation retries the same key', { skip: !supportsCodexZstd() }, async () => {
  for (const representation of ['compressed', 'plain']) await fixture(async (home, source) => {
    const manifest = await scanCodexManifest(home, options.salt);
    const first = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, options);
    if (representation === 'plain') { await writeFile(source.slice(0, -4), body); await unlink(source); }
    else await writeFile(source, frame());
    const changed = await scanCodexManifest(home, options.salt);
    assert.equal(changed.files[0].fileKey, manifest.files[0].fileKey);
    const next = await updateCodexIndex(first.index, changed, options);
    assert.ok(next.bodyReads > 0); assert.equal(next.failedFiles, 0); assert.equal(failure(next.index), undefined);
    assert.equal(next.index.aggregate.total.inputTotal, 100); assert.equal(next.index.coverage.complete, true);
  });
});

test('a native filesystem EIO during compressed body reading remains retryable after save/reload', { skip: !supportsCodexZstd() }, async () => {
  await fixture(async (home, source) => {
    await writeFile(source, frame());
    const manifest = await scanCodexManifest(home, options.salt);
    const realOpen = fsPromises.open;
    let injected = false;
    (fsPromises as any).open = async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await realOpen(...args);
      if (args[0] === source) {
        const realRead = handle.read.bind(handle);
        (handle as any).read = async (...readArgs: any[]) => {
          if (!injected && readArgs[3] === 9) {
            injected = true;
            throw Object.assign(new Error('private transient filesystem failure'), { code: 'EIO' });
          }
          return (realRead as any)(...readArgs);
        };
      }
      return handle;
    };
    let failed;
    try { failed = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, options); }
    finally { (fsPromises as any).open = realOpen; }
    assert.equal(injected, true); assert.equal(failed.failedFiles, 1);
    assert.equal(failure(failed.index), undefined, 'transient I/O is not source corruption');
    const target = path.join(home, 'index.json'); await saveCodexIndexAtomic(target, failed.index);
    const restored = await loadCodexIndex(target);
    const retried = await updateCodexIndex(restored, manifest, options);
    assert.equal(retried.bodyReads, 1); assert.equal(retried.failedFiles, 0);
    assert.equal(retried.index.aggregate.total.inputTotal, 100);
    assert.equal(retried.index.coverage.complete, true);
  });
});

test('unverified compressed quota observations never enter durable global history', { skip: !supportsCodexZstd() }, async () => {
  await fixture(async (home, source) => {
    const quotaLine = JSON.stringify({ type: 'event_msg', timestamp: '2026-07-20T00:01:00Z', payload: {
      type: 'token_count', info: { total_token_usage: { input_tokens: 101, output_tokens: 21, total_tokens: 122 } },
      rate_limits: { limit_id: 'codex', secondary: { used_percent: 73, window_minutes: 10080, resets_at: 1785110400 } },
    } });
    // Stay below one raw-block ceiling but span decoded chunks, exposing draft
    // recomputation before the invalid frame tail is encountered.
    const content = Buffer.from(body.toString() + quotaLine + '\n' + '{"type":"noop"}\n'.repeat(6000));
    await writeFile(source, Buffer.concat([frame(content), Buffer.from('invalid-tail')]));
    const manifest = await scanCodexManifest(home, options.salt);
    const rejected = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { ...options,
      scheduling: { checkpointEveryBytes: 1 }, onCheckpoint: async () => undefined });
    assert.equal(rejected.failedFiles, 1); assert.equal(failure(rejected.index).code, 'trailing-data');
    assert.deepEqual(rejected.index.quotaHistory ?? [], [], 'rejected source cannot seed retained quota history');
    const target = path.join(home, 'index.json'); await saveCodexIndexAtomic(target, rejected.index);
    assert.deepEqual((await loadCodexIndex(target)).quotaHistory ?? [], []);
    await writeFile(source, frame(content));
    const repaired = await updateCodexIndex(rejected.index, await scanCodexManifest(home, options.salt), options);
    assert.equal(repaired.failedFiles, 0);
    assert.equal(repaired.index.quotaHistory?.[0].usedPercent, 73, 'verified EOF promotes the observation');
  });
});

for (const code of ['malformed', 'truncated', 'trailing-data', 'size-mismatch', 'decode-failed', 'size-limit', 'dictionary', 'reserved', 'unknown-size',
  'io-error', 'source-changed', 'aborted', 'codec-unavailable', 'replay-limit', 'invalid-range', 'invalid-options'] as CodexZstdErrorCode[]) {
  test(`codec ${code} only stops retry for deterministic source failures`, async () => {
    await fixture(async home => {
      const manifest = await scanCodexManifest(home, options.salt);
      const first = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { ...options,
        io: { async *read() { yield body; throw new CodexZstdError(code); } } });
      const terminal = ['malformed', 'truncated', 'trailing-data', 'size-mismatch', 'decode-failed', 'size-limit', 'dictionary', 'reserved', 'unknown-size'].includes(code);
      assert.equal(Boolean(failure(first.index)), terminal);
      assert.equal(first.index.aggregate.total.inputTotal, 0);
      if (terminal) await assertStable(normalizeCodexIndex(first.index)!, manifest);
      else {
        const next = await updateCodexIndex(first.index, manifest, { ...options,
          io: { async *read() { yield body; } } });
        assert.ok(next.bodyReads > 0); assert.equal(next.index.coverage.complete, true);
      }
    });
  });
}

test('cancellation checkpoints a retryable draft, never a terminal failure', async () => {
  await fixture(async home => {
    const manifest = await scanCodexManifest(home, options.salt);
    let cancel = false, saved = createEmptyCodexIndex('UTC');
    await assert.rejects(updateCodexIndex(saved, manifest, { ...options,
      io: { async *read() { yield body; } }, shouldCancel: () => cancel,
      onProgress: () => { cancel = true; }, onCheckpoint: async index => { saved = normalizeCodexIndex(index)!; },
    }), CodexIndexCancelledError);
    assert.equal(failure(saved), undefined);
    const next = await updateCodexIndex(saved, manifest, { ...options, io: { async *read() { yield body; } } });
    assert.ok(next.bodyReads > 0); assert.equal(next.index.coverage.complete, true);
  });
});

test('sanitization keeps only a versioned enum and fingerprint, rejecting bad drafts and unknown failure versions', async () => {
  await fixture(async home => {
    const manifest = await scanCodexManifest(home, options.salt), entry = manifest.files[0];
    const first = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { ...options,
      io: { async *read() { yield body; throw new CodexZstdError('decode-failed'); } } });
    const dirty = structuredClone(first.index) as any;
    Object.assign(dirty.files[entry.fileKey], { offset: entry.size, compressionVerified: true,
      hourProof: { version: 1, hours: [123], indexedThrough: entry.size },
      parserState: { ...dirty.files[entry.fileKey].parserState, inputTotal: 999, privateText: 'private-payload' } });
    dirty.files[entry.fileKey].aggregate.total.inputTotal = 999;
    dirty.files[entry.fileKey].compressionFailure.message = 'private-path-and-error';
    const clean = normalizeCodexIndex(dirty)!;
    assert.equal(clean.files[entry.fileKey].offset, 0);
    assert.equal(clean.files[entry.fileKey].aggregate.total.inputTotal, 0);
    assert.equal(clean.files[entry.fileKey].hourProof, undefined);
    assert.equal(clean.files[entry.fileKey].compressionVerified, undefined);
    assert.deepEqual(failure(clean), { version: 1, code: 'decode-failed' });
    assert.doesNotMatch(JSON.stringify(clean), /private-payload|private-path-and-error/);
    for (const invalid of [{ version: 2, code: 'decode-failed' }, { version: 1, code: 'private-error' },
      { version: 1, code: 'io-error' }]) {
      dirty.files[entry.fileKey].compressionFailure = invalid;
      const loaded = normalizeCodexIndex(dirty)!;
      assert.equal(failure(loaded), undefined); assert.equal(loaded.files[entry.fileKey].compressionVerified, undefined);
      const retried = await updateCodexIndex(loaded, manifest, { ...options, io: { async *read() { yield body; } } });
      assert.ok(retried.bodyReads > 0); assert.equal(retried.index.aggregate.total.inputTotal, 100);
    }
  });
});

test('ctime-only and inode-only compressed replacement invalidates terminal state despite unchanged sizes and mtime', async () => {
  await fixture(async home => {
    const manifest = await scanCodexManifest(home, options.salt);
    const first = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { ...options,
      io: { async *read() { throw new CodexZstdError('malformed'); } } });
    for (const field of ['storageCtimeMs', 'ino'] as const) {
      const changed = structuredClone(manifest), entry = changed.files[0];
      entry[field] = (entry[field] ?? 0) + 1; changed.persistable[entry.fileKey][field] = entry[field];
      const retried = await updateCodexIndex(first.index, changed, { ...options, io: { async *read() { yield body; } } });
      assert.ok(retried.bodyReads > 0); assert.equal(failure(retried.index), undefined);
      assert.equal(retried.index.aggregate.total.inputTotal, 100);
    }
  });
});

test('pool unknown and transient error codes cannot create terminal metadata or copy private fields', async () => {
  await fixture(async home => {
    await writeFile(path.join(home, 'sessions', 'second.jsonl.zst'), frame());
    const manifest = await scanCodexManifest(home, options.salt);
    for (const code of ['io-error', 'source-changed', 'aborted', 'private-path-and-error']) {
      const first = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { ...options,
        filePassBatch: async (tasks, apply) => {
          for (const task of tasks) await apply({ taskId: task.taskId, ok: false,
            failureCode: code, message: 'private-message', stack: 'private-stack' } as any);
        } });
      assert.equal(failure(first.index), undefined);
      assert.doesNotMatch(JSON.stringify(first.index), /private-message|private-stack|private-path-and-error/);
      const next = await updateCodexIndex(first.index, manifest, { ...options, io: { async *read() { yield body; } } });
      assert.equal(next.bodyReads, 2);
    }
    assert.equal(codexFilePassFailureCode({ code: 'malformed', message: 'private-path' }), undefined);
    assert.equal(codexFilePassFailureCode(new Error('private-path')), undefined);
    const malformed = new CodexZstdError('malformed');
    (malformed as any).code = 'private-error';
    assert.equal(codexFilePassFailureCode(malformed), undefined);
  });
});

test('pool carries only safe typed failure codes while healthy files and date/zone refreshes proceed', { skip: !supportsCodexZstd() }, async () => {
  await fixture(async home => {
    await writeFile(path.join(home, 'sessions', 'healthy.jsonl'), body);
    const manifest = await scanCodexManifest(home, options.salt), pool = new CodexFilePassPool(2);
    let first;
    try { first = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { ...options, filePassBatch: pool.run }); }
    finally { await pool.dispose(); }
    assert.equal(first.failedFiles, 1); assert.equal(first.index.aggregate.total.inputTotal, 100);
    assert.deepEqual(failure(first.index), { version: 1, code: 'trailing-data' });
    await assertStable(normalizeCodexIndex(first.index)!, manifest);
    const next = await updateCodexIndex(first.index, manifest, { ...options, timeZone: 'Asia/Shanghai',
      now: () => Date.parse('2026-07-23T12:00:00Z') });
    assert.equal(next.indexChanged, true); assert.equal(next.index.coverage.period.timeZone, 'Asia/Shanghai');
    assert.equal(next.index.coverage.period.asOfDay, '2026-07-23');
    assert.equal(next.index.aggregate.total.inputTotal, 100); assert.equal(next.failedFiles, 1);
    const entry = manifest.files.find(row => row.compression)!;
    const worker = new Worker(path.join(__dirname, '../providers/codex/codexFilePassWorker.js'));
    try {
      const reply = once(worker, 'message');
      worker.postMessage({ type: 'run', sequence: 1, task: { taskId: 'safe-task', kind: 'main', entry,
        contribution: Object.values(first.index.files).find(row => row.compression), salt: options.salt,
        timeZone: 'UTC', asOfDay: '2026-07-22', endExclusive: entry.size } });
      const [message] = await reply;
      assert.deepEqual(message.outcome, { taskId: 'safe-task', ok: false, failureCode: 'trailing-data' });
      assert.doesNotMatch(JSON.stringify(message), /private|payload|absolutePath|stack/);
    } finally { await worker.terminate(); }
  });
});
