import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CodexIndexClient,
  CodexWorkerError,
  CodexWorkerLike,
} from '../providers/codex/codexIndexClient';
import {
  CODEX_REFRESH_BACKFILL_MAX_BYTES,
  CODEX_REFRESH_BACKFILL_MAX_FILE_PASSES,
  CODEX_REFRESH_BACKGROUND_MAX_BYTES,
  CODEX_REFRESH_BACKGROUND_MAX_FILE_PASSES,
  CODEX_REFRESH_FOREGROUND_MAX_BYTES,
  CODEX_REFRESH_FOREGROUND_MAX_FILE_PASSES,
  CodexIndexProgress,
  CodexIndexV1,
  createEmptyCodexIndex,
  loadCodexIndex,
} from '../providers/codex/codexIndex';
import { runCodexWorkerRefresh } from '../providers/codex/codexIndexWorker';
import { recommendedCodexBackfillWorkers } from '../providers/codex/codexFilePassPool';
import {
  CodexWorkerMessage,
  CodexWorkerRequest,
  CodexWorkerResult,
} from '../providers/codex/codexWorkerProtocol';

const SALT = 'test-machine-salt';

test('cold-backfill worker count scales with the machine but remains bounded', () => {
  assert.equal(recommendedCodexBackfillWorkers(1), 1);
  assert.equal(recommendedCodexBackfillWorkers(2), 1);
  assert.equal(recommendedCodexBackfillWorkers(4), 2);
  assert.equal(recommendedCodexBackfillWorkers(8), 4);
  assert.equal(recommendedCodexBackfillWorkers(16), 6);
  assert.equal(recommendedCodexBackfillWorkers(128), 6);
});

class FakeWorker extends EventEmitter implements CodexWorkerLike {
  readonly requests: CodexWorkerRequest[] = [];
  terminated = 0;

  postMessage(request: CodexWorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): Promise<number> {
    this.terminated += 1;
    return Promise.resolve(0);
  }

  emitMessage(message: CodexWorkerMessage): void {
    this.emit('message', message);
  }
}

const request = {
  codexHome: '/private/runtime-only-codex-home',
  indexPath: '/private/global-storage/codex-index-v1.json',
  salt: 'runtime-only-salt',
  timeZone: 'Asia/Hong_Kong',
};

function result(): CodexWorkerResult {
  return {
    index: createEmptyCodexIndex(request.timeZone),
    indexChanged: false,
    bodyReads: 0,
    failedFiles: 0,
    metadataMs: 1,
    parseMs: 2,
    migration: {
      filePasses: 0,
      bytesRead: 0,
      pending: false,
    },
  };
}

test('concurrent refreshes share one worker run and report progress', async () => {
  const worker = new FakeWorker();
  const seen: CodexIndexProgress[] = [];
  const client = new CodexIndexClient(() => worker);

  const first = client.refresh(request, (progress) => seen.push(progress));
  const second = client.refresh(request, (progress) => seen.push(progress));
  const refresh = worker.requests[0];
  assert.equal(refresh.type, 'refresh');
  if (refresh.type !== 'refresh') {
    throw new Error('expected refresh');
  }
  assert.equal(worker.requests.filter((item) => item.type === 'refresh').length, 1);
  assert.equal(refresh.timeZone, 'Asia/Hong_Kong');
  assert.match(refresh.indexPath, /codex-index-v1\.json$/);

  const expectedPeriodCoverage = createEmptyCodexIndex(
    'Asia/Hong_Kong',
  ).coverage.period;
  const progress: CodexIndexProgress = {
    scannedFiles: 1,
    totalFiles: 2,
    indexedBytes: 10,
    totalBytes: 20,
    period: expectedPeriodCoverage,
  };

  worker.emitMessage({
    type: 'progress',
    requestId: refresh.requestId,
    progress,
  });
  worker.emitMessage({
    type: 'result',
    requestId: refresh.requestId,
    result: result(),
  });

  assert.deepEqual(await first, result());
  assert.deepEqual(await second, result());
  assert.equal(seen.length, 2);
  assert.strictEqual(seen[0], seen[1]);
  assert.deepEqual(seen[0].period, expectedPeriodCoverage);
});

test('a foreground refresh arriving during background work queues one accelerated follow-up', async () => {
  const worker = new FakeWorker();
  const client = new CodexIndexClient(() => worker);
  const background = client.refresh({ ...request, profile: 'background' });
  const foreground = client.refresh({ ...request, profile: 'foreground' });
  assert.equal(worker.requests.length, 1);

  const first = worker.requests[0];
  assert.equal(first.type, 'refresh');
  if (first.type !== 'refresh') throw new Error('expected refresh');
  worker.emitMessage({ type: 'result', requestId: first.requestId, result: result() });
  await background;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(worker.requests.length, 2);
  const second = worker.requests[1];
  assert.equal(second.type, 'refresh');
  if (second.type !== 'refresh') throw new Error('expected refresh');
  assert.equal(second.profile, 'foreground');
  worker.emitMessage({ type: 'result', requestId: second.requestId, result: result() });
  await foreground;
  client.dispose();
});

test('cancel sends exactly one message for the active request', async () => {
  const worker = new FakeWorker();
  const client = new CodexIndexClient(() => worker);
  const pending = client.refresh(request);
  const refresh = worker.requests[0];
  if (refresh.type !== 'refresh') {
    throw new Error('expected refresh');
  }

  client.cancel();
  client.cancel();

  assert.deepEqual(worker.requests.slice(1), [
    { type: 'cancel', requestId: refresh.requestId },
  ]);
  worker.emitMessage({
    type: 'error',
    requestId: refresh.requestId,
    error: { code: 'cancelled', message: 'Codex indexing was cancelled' },
  });
  await assert.rejects(pending, (error: unknown) => {
    return error instanceof CodexWorkerError && error.code === 'cancelled';
  });
});

test('a worker error rejects all shared callers with a typed safe error', async () => {
  const worker = new FakeWorker();
  const client = new CodexIndexClient(() => worker);
  const first = client.refresh(request);
  const second = client.refresh(request);
  const refresh = worker.requests[0];
  if (refresh.type !== 'refresh') {
    throw new Error('expected refresh');
  }

  worker.emitMessage({
    type: 'error',
    requestId: refresh.requestId,
    error: { code: 'index-read-failed', message: 'Codex index is unavailable' },
  });

  for (const pending of [first, second]) {
    await assert.rejects(pending, (error: unknown) => {
      return (
        error instanceof CodexWorkerError &&
        error.code === 'index-read-failed' &&
        !error.message.includes('/private/')
      );
    });
  }
});

test('dispose terminates the worker and rejects later refreshes', async () => {
  const worker = new FakeWorker();
  const client = new CodexIndexClient(() => worker);
  const pending = client.refresh(request);

  client.dispose();

  assert.equal(worker.terminated, 1);
  await assert.rejects(pending, { code: 'disposed' });
  await assert.rejects(client.refresh(request), { code: 'disposed' });
});

test('the compiled worker keeps a safe project basename without raw identifiers or paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-worker-'));
  const client = new CodexIndexClient();
  try {
    const sessions = path.join(root, 'sessions');
    const indexPath = path.join(root, 'cache', 'index.json');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'rollout-private-name.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-07-20T00:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'private-session-id', cwd: '/private/raw-project' },
        }),
        JSON.stringify({
          timestamp: '2026-07-20T00:01:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 75,
                cached_input_tokens: 50,
                output_tokens: 25,
                reasoning_output_tokens: 10,
                total_tokens: 100,
              },
            },
          },
        }),
        '',
      ].join('\n'),
      'utf8',
    );

    const indexed = await client.refresh({
      codexHome: root,
      indexPath,
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
    });

    assert.equal(indexed.index.aggregate.total.inputTotal, 75);
    assert.equal(indexed.index.coverage.complete, true);
    assert.equal(indexed.index.coverage.period.timeZone, 'Asia/Hong_Kong');
    const returned = JSON.stringify(indexed);
    const persisted = await readFile(indexPath, 'utf8');
    assert.match(returned, /"projectName":"raw-project"/);
    assert.match(persisted, /"projectDirectoryName":"raw-project"/);
    assert.doesNotMatch(
      returned,
      /private-session-id|rollout-private-name|\.jsonl|\/private\/raw-project/,
    );
    assert.doesNotMatch(
      persisted,
      /private-session-id|rollout-private-name|\.jsonl|\/private\/raw-project/,
    );
  } finally {
    client.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('worker cancellation persists a resumable atomic checkpoint', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-worker-resume-'));
  const client = new CodexIndexClient();
  try {
    const sessions = path.join(root, 'sessions');
    const indexPath = path.join(root, 'cache', 'codex-index-v1.json');
    const sessionPath = path.join(sessions, 'large-session.jsonl');
    await mkdir(sessions, { recursive: true });
    const tokenLines = Array.from({ length: 12_000 }, (_, index) =>
      JSON.stringify({
        timestamp: '2026-07-20T00:01:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: index + 1,
              cached_input_tokens: 0,
              output_tokens: index + 1,
              reasoning_output_tokens: 0,
              total_tokens: (index + 1) * 2,
            },
          },
        },
      }),
    );
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          timestamp: '2026-07-20T00:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'raw-resume-session' },
        }),
        ...tokenLines,
        '',
      ].join('\n'),
      'utf8',
    );
    const input = {
      codexHome: root,
      indexPath,
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
    };
    await client.refresh(input);

    const legacy = JSON.parse(await readFile(indexPath, 'utf8')) as {
      files: Record<string, {
        aggregate: { period?: unknown };
        periodMigration?: unknown;
      }>;
    };
    for (const contribution of Object.values(legacy.files)) {
      delete contribution.aggregate.period;
      delete contribution.periodMigration;
    }
    await writeFile(indexPath, JSON.stringify(legacy), 'utf8');

    let cancelSent = false;
    const cancelledRefresh = client.refresh(input, (progress) => {
      if (!cancelSent && progress.period.allTime.migratedBytes > 0) {
        cancelSent = true;
        client.cancel();
      }
    });
    await assert.rejects(cancelledRefresh, (error: unknown) =>
      error instanceof CodexWorkerError && error.code === 'cancelled',
    );

    const checkpoint = await loadCodexIndex(indexPath, input.timeZone);
    const saved = Object.values(checkpoint.files)[0];
    assert.ok((saved.periodMigration?.offset ?? 0) > 0);
    assert.equal(saved.aggregate.period, undefined);

    const resumed = await client.refresh(input);
    assert.equal(resumed.index.coverage.period.allTime.complete, true);
    assert.equal(resumed.migration.pending, false);
  } finally {
    client.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('unchanged worker refresh skips the final atomic index write', async () => {
  const savedIndex = createEmptyCodexIndex(request.timeZone);
  const messages: CodexWorkerMessage[] = [];
  let saves = 0;

  await runCodexWorkerRefresh(
    { type: 'refresh', requestId: 'warm-noop', ...request },
    {
      isCancelled: () => false,
      post: (message: CodexWorkerMessage) => messages.push(message),
      acquireCodexIndexLease: async () => ({
        release: async () => undefined,
      }),
      loadCodexIndex: async () => savedIndex,
      scanCodexManifest: async () => ({ files: [], persistable: {} }),
      updateCodexIndex: async () => ({
        index: savedIndex,
        indexChanged: false,
        bodyReads: 0,
        failedFiles: 0,
        migration: { filePasses: 0, bytesRead: 0, pending: false },
      }),
      saveCodexIndexAtomic: async () => { saves += 1; },
    },
  );

  assert.equal(saves, 0);
  const resultMessage = messages.find((message) => message.type === 'result');
  assert.ok(resultMessage && resultMessage.type === 'result');
  assert.equal((resultMessage.result as any).indexChanged, false);
});

test('a refresh already saved by its final checkpoint skips the duplicate final write', async () => {
  const savedIndex = createEmptyCodexIndex(request.timeZone);
  let saves = 0;

  await runCodexWorkerRefresh(
    { type: 'refresh', requestId: 'checkpointed-final', ...request },
    {
      isCancelled: () => false,
      post: () => undefined,
      acquireCodexIndexLease: async () => ({ release: async () => undefined }),
      loadCodexIndex: async () => savedIndex,
      scanCodexManifest: async () => ({ files: [], persistable: {} }),
      updateCodexIndex: async (_previous, _manifest, options) => {
        await options.onCheckpoint?.(savedIndex);
        return {
          index: savedIndex,
          indexChanged: true,
          bodyReads: 1,
          failedFiles: 0,
          migration: { filePasses: 1, bytesRead: 10, pending: false },
        };
      },
      saveCodexIndexAtomic: async () => { saves += 1; },
    },
  );

  assert.equal(saves, 1);
});

test('worker keeps background refresh bounded and accelerates only the foreground profile', async () => {
  const savedIndex = createEmptyCodexIndex(request.timeZone);
  const budgets: Array<{ maxFilePasses: number; maxBytes: number }> = [];
  for (const profile of ['background', 'foreground'] as const) {
    await runCodexWorkerRefresh(
      { type: 'refresh', requestId: `budget-${profile}`, ...request, profile },
      {
        isCancelled: () => false,
        post: () => undefined,
        acquireCodexIndexLease: async () => ({ release: async () => undefined }),
        loadCodexIndex: async () => savedIndex,
        scanCodexManifest: async () => ({ files: [], persistable: {} }),
        updateCodexIndex: async (_previous, _manifest, options) => {
          budgets.push(options.budget!);
          return {
            index: savedIndex,
            indexChanged: false,
            bodyReads: 0,
            failedFiles: 0,
            migration: { filePasses: 0, bytesRead: 0, pending: false },
          };
        },
        saveCodexIndexAtomic: async () => undefined,
      },
    );
  }
  assert.deepEqual(budgets, [
    {
      maxFilePasses: CODEX_REFRESH_BACKGROUND_MAX_FILE_PASSES,
      maxBytes: CODEX_REFRESH_BACKGROUND_MAX_BYTES,
    },
    {
      maxFilePasses: CODEX_REFRESH_FOREGROUND_MAX_FILE_PASSES,
      maxBytes: CODEX_REFRESH_FOREGROUND_MAX_BYTES,
    },
  ]);
  assert.ok(CODEX_REFRESH_FOREGROUND_MAX_BYTES > CODEX_REFRESH_BACKGROUND_MAX_BYTES);
  assert.equal(CODEX_REFRESH_BACKGROUND_MAX_FILE_PASSES, 64);
  assert.equal(CODEX_REFRESH_BACKGROUND_MAX_BYTES, 128 * 1024 * 1024);
  assert.equal(CODEX_REFRESH_FOREGROUND_MAX_FILE_PASSES, 512);
  assert.equal(CODEX_REFRESH_FOREGROUND_MAX_BYTES, 2 * 1024 * 1024 * 1024);
});

test('worker gives first-time and incomplete backfills one streaming pass before returning to steady budgets', async () => {
  const firstIndex = createEmptyCodexIndex(request.timeZone);
  const incompleteIndex = createEmptyCodexIndex(request.timeZone);
  incompleteIndex.coverage.complete = false;
  incompleteIndex.coverage.period.allTime.complete = false;
  const manifest = {
    files: [{
      fileKey: 'first-log',
      absolutePath: '/private/runtime-only-codex-home/sessions/first.jsonl',
      nonPersisted: true as const,
      sourceArea: 'sessions' as const,
      size: 14 * 1024 * 1024 * 1024,
      mtimeMs: 1,
    }],
    persistable: {
      'first-log': {
        fileKey: 'first-log',
        sourceArea: 'sessions' as const,
        size: 14 * 1024 * 1024 * 1024,
        mtimeMs: 1,
      },
    },
  };
  const budgets: Array<{ maxFilePasses: number; maxBytes: number }> = [];
  for (const previous of [firstIndex, incompleteIndex]) {
    await runCodexWorkerRefresh(
      { type: 'refresh', requestId: `backfill-${budgets.length}`, ...request },
      {
        isCancelled: () => false,
        post: () => undefined,
        acquireCodexIndexLease: async () => ({ release: async () => undefined }),
        loadCodexIndex: async () => previous,
        scanCodexManifest: async () => manifest,
        updateCodexIndex: async (_previous, _manifest, options) => {
          budgets.push(options.budget!);
          return {
            index: previous,
            indexChanged: false,
            bodyReads: 0,
            failedFiles: 0,
            migration: { filePasses: 0, bytesRead: 0, pending: true },
          };
        },
        saveCodexIndexAtomic: async () => undefined,
      },
    );
  }

  assert.deepEqual(budgets, [
    {
      maxFilePasses: CODEX_REFRESH_BACKFILL_MAX_FILE_PASSES,
      maxBytes: CODEX_REFRESH_BACKFILL_MAX_BYTES,
    },
    {
      maxFilePasses: CODEX_REFRESH_BACKFILL_MAX_FILE_PASSES,
      maxBytes: CODEX_REFRESH_BACKFILL_MAX_BYTES,
    },
  ]);
  assert.equal(CODEX_REFRESH_BACKFILL_MAX_FILE_PASSES, 16_384);
  assert.equal(CODEX_REFRESH_BACKFILL_MAX_BYTES, 64 * 1024 * 1024 * 1024);
});

test('worker enables and disposes the multi-file pool only for an expedited backfill', async () => {
  const firstIndex = createEmptyCodexIndex(request.timeZone);
  const manifest = {
    files: [{
      fileKey: 'first-log',
      absolutePath: '/private/runtime-only-codex-home/sessions/first.jsonl',
      nonPersisted: true as const,
      sourceArea: 'sessions' as const,
      size: 100,
      mtimeMs: 1,
    }],
    persistable: {
      'first-log': {
        fileKey: 'first-log',
        sourceArea: 'sessions' as const,
        size: 100,
        mtimeMs: 1,
      },
    },
  };
  let created = 0;
  let disposed = 0;
  let receivedBatchRunner = false;

  await runCodexWorkerRefresh(
    { type: 'refresh', requestId: 'parallel-backfill', ...request },
    {
      isCancelled: () => false,
      post: () => undefined,
      acquireCodexIndexLease: async () => ({ release: async () => undefined }),
      loadCodexIndex: async () => firstIndex,
      scanCodexManifest: async () => manifest,
      createCodexFilePassPool: () => {
        created += 1;
        return {
          run: async () => undefined,
          dispose: async () => { disposed += 1; },
        };
      },
      updateCodexIndex: async (_previous, _manifest, options) => {
        receivedBatchRunner = options.filePassBatch !== undefined;
        return {
          index: firstIndex,
          indexChanged: false,
          bodyReads: 0,
          failedFiles: 0,
          migration: { filePasses: 0, bytesRead: 0, pending: true },
        };
      },
      saveCodexIndexAtomic: async () => undefined,
    },
  );

  assert.equal(created, 1);
  assert.equal(disposed, 1);
  assert.equal(receivedBatchRunner, true);
});

test('worker lease encloses index load, manifest scan, and refresh', async () => {
  const savedIndex = createEmptyCodexIndex(request.timeZone);
  const events: string[] = [];

  await runCodexWorkerRefresh(
    { type: 'refresh', requestId: 'leased-refresh', ...request },
    {
      isCancelled: () => false,
      post: () => undefined,
      acquireCodexIndexLease: async () => {
        events.push('acquire');
        return {
          release: async () => { events.push('release'); },
        };
      },
      loadCodexIndex: async () => {
        events.push('load');
        return savedIndex;
      },
      scanCodexManifest: async () => {
        events.push('scan');
        return { files: [], persistable: {} };
      },
      updateCodexIndex: async () => {
        events.push('update');
        return {
          index: savedIndex,
          indexChanged: false,
          bodyReads: 0,
          failedFiles: 0,
          migration: { filePasses: 0, bytesRead: 0, pending: false },
        };
      },
      saveCodexIndexAtomic: async () => {
        events.push('save');
      },
    },
  );

  assert.equal(events[0], 'acquire');
  assert.ok(events.indexOf('load') > events.indexOf('acquire'));
  assert.ok(events.indexOf('scan') > events.indexOf('acquire'));
  assert.ok(events.indexOf('update') > events.indexOf('scan'));
  assert.equal(events[events.length - 1], 'release');
});

test('cancel during the final atomic save returns cancelled after preserving the save', async () => {
  const savedIndex = createEmptyCodexIndex(request.timeZone);
  const messages: CodexWorkerMessage[] = [];
  let cancelled = false;
  let releaseSave!: () => void;
  let markSaveStarted!: () => void;
  const saveStarted = new Promise<void>((resolve) => {
    markSaveStarted = resolve;
  });
  const saveReleased = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let persisted: CodexIndexV1 | undefined;

  const running = runCodexWorkerRefresh(
    { type: 'refresh', requestId: 'final-save-race', ...request },
    {
      isCancelled: () => cancelled,
      post: (message: CodexWorkerMessage) => messages.push(message),
      acquireCodexIndexLease: async () => ({
        release: async () => undefined,
      }),
      loadCodexIndex: async () => savedIndex,
      scanCodexManifest: async () => ({ files: [], persistable: {} }),
      updateCodexIndex: async () => ({
        index: savedIndex,
        indexChanged: true,
        bodyReads: 0,
        failedFiles: 0,
        migration: { filePasses: 0, bytesRead: 0, pending: false },
      }),
      saveCodexIndexAtomic: async (
        _indexPath: string,
        index: CodexIndexV1,
      ) => {
        persisted = index;
        markSaveStarted();
        await saveReleased;
      },
    },
  );

  await saveStarted;
  cancelled = true;
  releaseSave();
  await running;

  assert.deepEqual(persisted, savedIndex);
  assert.deepEqual(messages, [{
    type: 'error',
    requestId: 'final-save-race',
    error: {
      code: 'cancelled',
      message: 'Codex indexing was cancelled',
    },
  }]);
});

test('worker result reports a safe corrupt-index recovery reason', async () => {
  const savedIndex = createEmptyCodexIndex(request.timeZone);
  const messages: CodexWorkerMessage[] = [];
  let saves = 0;

  await runCodexWorkerRefresh(
    { type: 'refresh', requestId: 'index-recovery', ...request },
    {
      isCancelled: () => false,
      post: (message: CodexWorkerMessage) => messages.push(message),
      acquireCodexIndexLease: async () => ({
        release: async () => undefined,
      }),
      loadCodexIndex: async (_path, _timeZone, onRecovery) => {
        onRecovery?.({ reason: 'invalid-json' });
        return savedIndex;
      },
      scanCodexManifest: async () => ({ files: [], persistable: {} }),
      updateCodexIndex: async () => ({
        index: savedIndex,
        indexChanged: false,
        bodyReads: 0,
        failedFiles: 0,
        migration: { filePasses: 0, bytesRead: 0, pending: false },
      }),
      saveCodexIndexAtomic: async () => { saves += 1; },
    },
  );

  const resultMessage = messages.find((message) => message.type === 'result');
  assert.ok(resultMessage && resultMessage.type === 'result');
  assert.deepEqual((resultMessage.result as any).indexRecovery, {
    reason: 'invalid-json',
  });
  assert.equal(saves, 1);
});
