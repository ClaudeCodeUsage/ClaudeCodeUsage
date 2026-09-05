import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CodexIndexClientLike,
  CodexProvider,
} from '../providers/codex/codexProvider';
import {
  CodexFileContribution,
  CodexIndexProgress,
  CodexIndexV1,
  createEmptyCodexIndex,
} from '../providers/codex/codexIndex';
import { CodexWorkerResult } from '../providers/codex/codexWorkerProtocol';
import { pseudonymousIdentityKey } from '../providers/codex/codexIdentity';

function contribution(
  fileKey = 'anonymous-file-key',
  sourceArea?: 'sessions' | 'archive',
): CodexFileContribution {
  return {
    fileKey,
    ...(sourceArea ? { sourceArea } : {}),
    size: 100,
    mtimeMs: 1,
    offset: 100,
    discardingOversizedLine: false,
    parserState: {
      schemaVersion: 3,
      fileKey,
      sessionKey: 'anonymous-session-key',
      role: 'root',
      qualityFlags: ['unknown-event'],
    },
    aggregate: {
      total: { inputTotal: 80, cachedInput: 50, outputTotal: 20 },
      byDay: {
        '2026-07-20': { inputTotal: 80, cachedInput: 50, outputTotal: 20 },
      },
      byModel: {
        'gpt-5.6-sol': { inputTotal: 80, cachedInput: 50, outputTotal: 20 },
      },
      byEffort: {
        high: { inputTotal: 80, cachedInput: 50, outputTotal: 20 },
      },
      session: {
        sessionKey: 'anonymous-session-key',
        role: 'root',
        startedAt: Date.parse('2026-07-20T00:00:00.000Z'),
        endedAt: Date.parse('2026-07-20T00:05:00.000Z'),
      },
      structural: {
        patchCalls: 1,
        toolCalls: 2,
        postPatchToolCalls: 1,
        compactCount: 0,
        taskCompleteCount: 1,
      },
    },
    limit: {
      provider: 'codex',
      observedAt: Date.parse('2026-07-20T00:05:00.000Z'),
      source: 'local-log',
      confidence: 'last-observed',
      windows: [{ label: 'primary', usedPercent: 42 }],
    },
    qualityFlags: ['unknown-event'],
  };
}

function duplicateIndex(ambiguous: boolean): CodexIndexV1 {
  const index = createEmptyCodexIndex();
  const active = contribution('active-key', 'sessions');
  const archive = contribution('archive-key', 'archive');
  active.qualityFlags = ['active-only'];
  archive.qualityFlags = ['archive-only'];
  if (ambiguous) {
    archive.aggregate.total.outputTotal = 21;
  }
  index.files = {
    [active.fileKey]: active,
    [archive.fileKey]: archive,
  };
  index.aggregate = {
    total: {
      inputTotal: 160,
      cachedInput: 100,
      outputTotal: ambiguous ? 41 : 40,
    },
    byDay: {},
    byModel: {},
    byEffort: {},
  };
  index.coverage = {
    indexedFiles: 2,
    totalFiles: 2,
    indexedBytes: 200,
    totalBytes: 200,
    complete: true,
    identity: {
      exactDuplicateFiles: ambiguous ? 0 : 1,
      ambiguousSessionGroups: ambiguous ? 1 : 0,
      complete: !ambiguous,
    },
    period: createEmptyCodexIndex('UTC').coverage.period,
    today: createEmptyCodexIndex('UTC').coverage.today,
  };
  return index;
}

function partialIndex(): CodexIndexV1 {
  const index = createEmptyCodexIndex();
  const file = contribution();
  index.files[file.fileKey] = file;
  index.aggregate = {
    total: { ...file.aggregate.total },
    byDay: { ...file.aggregate.byDay },
    byModel: { ...file.aggregate.byModel },
    byEffort: { ...file.aggregate.byEffort },
  };
  index.coverage = {
    indexedFiles: 1,
    totalFiles: 2,
    indexedBytes: 100,
    totalBytes: 150,
    complete: false,
    identity: {
      exactDuplicateFiles: 0,
      ambiguousSessionGroups: 0,
      complete: true,
    },
    period: createEmptyCodexIndex('UTC').coverage.period,
    today: createEmptyCodexIndex('UTC').coverage.today,
  };
  return index;
}

class FakeClient implements CodexIndexClientLike {
  disposed = 0;
  calls = 0;
  readonly inputs: Array<{
    codexHome: string;
    indexPath: string;
    salt: string;
    timeZone: string;
    profile?: 'background' | 'foreground';
  }> = [];
  constructor(
    private readonly responses: Array<CodexWorkerResult | Error>,
    private readonly progress?: CodexIndexProgress,
  ) {}

  async refresh(input: {
    codexHome: string;
    indexPath: string;
    salt: string;
    timeZone: string;
    profile?: 'background' | 'foreground';
  }, onProgress?: (progress: CodexIndexProgress) => void): Promise<CodexWorkerResult> {
    this.calls += 1;
    this.inputs.push(input);
    if (this.progress) {
      onProgress?.(this.progress);
    }
    const next = this.responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (!next) {
      throw new Error('missing fake response');
    }
    return next;
  }

  dispose(): void {
    this.disposed += 1;
  }
}

function workerResult(index = partialIndex()): CodexWorkerResult {
  return {
    index,
    indexChanged: true,
    bodyReads: 1,
    failedFiles: 1,
    metadataMs: 2,
    parseMs: 3,
    migration: {
      filePasses: 1,
      bytesRead: 100,
      pending: !index.coverage.period.allTime.complete,
    },
  };
}

test('disabled or unavailable providers do not create a worker client', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-off-'));
  try {
    let factoryCalls = 0;
    const factory = (): CodexIndexClientLike => {
      factoryCalls += 1;
      return new FakeClient([]);
    };
    const disabled = new CodexProvider(
      {
        enabled: false,
        codexHome: root,
        indexPath: 'unused',
        salt: 'salt',
        timeZone: 'Asia/Hong_Kong',
      },
      factory,
    );
    const unavailable = new CodexProvider(
      {
        enabled: true,
        codexHome: root,
        indexPath: 'unused',
        salt: 'salt',
        timeZone: 'Asia/Hong_Kong',
      },
      factory,
    );

    assert.equal(await disabled.isAvailable(), false);
    assert.equal((await disabled.refresh()).outcome, 'unavailable');
    assert.equal(await unavailable.isAvailable(), false);
    assert.equal((await unavailable.refresh()).outcome, 'unavailable');
    assert.equal(factoryCalls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a persisted checkpoint hydrates a usable snapshot before the worker refresh', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-checkpoint-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const indexPath = path.join(root, 'codex-index-v1.json');
    const checkpoint = partialIndex();
    const unreconciled = contribution('unreconciled-file-key');
    unreconciled.aggregate.total.inputTotal = 9_999;
    unreconciled.lineage = {
      fingerprintBlocks: [],
      pendingFingerprints: ['0'.repeat(32)],
      tokenEvents: 1,
      desiredPrefixEvents: 1,
      appliedPrefixEvents: 0,
    };
    checkpoint.files[unreconciled.fileKey] = unreconciled;
    await writeFile(indexPath, JSON.stringify(checkpoint), 'utf8');
    const client = new FakeClient([]);
    const provider = new CodexProvider(
      {
        enabled: true,
        codexHome: root,
        indexPath,
        salt: 'salt',
        timeZone: 'Asia/Hong_Kong',
      },
      () => client,
    );

    const snapshot = await provider.loadPersistedSnapshot();

    assert.ok(snapshot);
    assert.equal(snapshot.total.inputTotal, 80);
    assert.equal(snapshot.coverage.indexedFiles, 1);
    assert.equal(snapshot.coverage.totalFiles, 2);
    assert.equal(snapshot.files.length, 1);
    assert.deepEqual(provider.snapshot(), snapshot);
    assert.equal(client.calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a partial refresh exposes aggregates, quality, and last observed limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-on-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const result = workerResult();
    (result as any).indexRecovery = { reason: 'invalid-json' };
    const sessionKey = pseudonymousIdentityKey('salt', 'raw-session-title');
    const file = Object.values(result.index.files)[0];
    file.parserState.sessionKey = sessionKey;
    file.aggregate.session.sessionKey = sessionKey;
    await writeFile(
      path.join(root, 'session_index.jsonl'),
      `${JSON.stringify({ id: 'raw-session-title', thread_name: '真实 Session 标题' })}\n`,
      'utf8',
    );
    const client = new FakeClient([result]);
    const provider = new CodexProvider(
      {
        enabled: true,
        codexHome: root,
        indexPath: 'index',
        salt: 'salt',
        timeZone: 'Asia/Hong_Kong',
      },
      () => client,
    );

    const refreshed = await provider.refresh('foreground');

    assert.equal(refreshed.outcome, 'partial');
    assert.equal(refreshed.snapshot.total.inputTotal, 80);
    assert.deepEqual(refreshed.snapshot.qualityFlags, { 'unknown-event': 1 });
    assert.equal(refreshed.snapshot.files.length, 1);
    assert.equal(
      refreshed.snapshot.files[0].session.sessionTitle,
      '真实 Session 标题',
    );
    assert.equal(refreshed.snapshot.limit?.windows[0].usedPercent, 42);
    assert.equal(refreshed.snapshot.limits.length, 1);
    assert.deepEqual(provider.snapshot(), refreshed.snapshot);
    assert.equal(client.inputs[0].timeZone, 'Asia/Hong_Kong');
    assert.equal(client.inputs[0].profile, 'foreground');
    assert.deepEqual((refreshed.diagnostic as any).indexRecovery, {
      reason: 'invalid-json',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('provider forwards live worker progress to the dashboard caller', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-progress-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const progress: CodexIndexProgress = {
      scannedFiles: 12,
      totalFiles: 40,
      indexedBytes: 1_024,
      totalBytes: 4_096,
      period: createEmptyCodexIndex('UTC').coverage.period,
    };
    const client = new FakeClient([workerResult()], progress);
    const provider = new CodexProvider(
      {
        enabled: true,
        codexHome: root,
        indexPath: 'index',
        salt: 'salt',
        timeZone: 'UTC',
      },
      () => client,
    );
    const observed: CodexIndexProgress[] = [];

    const refreshed = await provider.refresh('foreground', (next) => {
      observed.push(next);
    });

    assert.deepEqual(observed, [progress]);
    assert.deepEqual(refreshed.progress, progress);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stale rebuild contributions stay out of usage while their quality and latest limit remain visible', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-rebuild-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const index = createEmptyCodexIndex('UTC');
    const current = contribution('current-key');
    current.parserState.sessionKey = 'current-session';
    current.parserState.qualityFlags = [];
    current.aggregate.session.sessionKey = 'current-session';
    current.qualityFlags = [];
    const stale = contribution('stale-key');
    stale.parserState.sessionKey = 'stale-session';
    stale.parserState.qualityFlags = ['stale-reset-required'];
    stale.aggregate.session.sessionKey = 'stale-session';
    stale.aggregate.total = {
      inputTotal: 8_000_000,
      cachedInput: 7_500_000,
      outputTotal: 2_000_000,
    };
    stale.qualityFlags = ['stale-reset-required'];
    stale.limit = {
      provider: 'codex',
      observedAt: Date.parse('2026-07-20T00:10:00.000Z'),
      source: 'local-log',
      confidence: 'last-observed',
      windows: [{ label: 'primary', usedPercent: 91 }],
    };
    const retainedPrefix = contribution('retained-prefix-key');
    retainedPrefix.parserState.sessionKey = 'retained-prefix-session';
    retainedPrefix.aggregate.session.sessionKey = 'retained-prefix-session';
    retainedPrefix.aggregate.total = {
      inputTotal: 40,
      cachedInput: 30,
      outputTotal: 10,
    };
    retainedPrefix.qualityFlags = ['stale-file'];
    index.files = {
      [current.fileKey]: current,
      [stale.fileKey]: stale,
      [retainedPrefix.fileKey]: retainedPrefix,
    };
    index.coverage.totalFiles = 3;
    index.coverage.totalBytes = 300;
    index.coverage.complete = false;
    const provider = new CodexProvider(
      {
        enabled: true,
        codexHome: root,
        indexPath: 'index',
        salt: 'salt',
        timeZone: 'UTC',
      },
      () => new FakeClient([{ ...workerResult(index), failedFiles: 0 }]),
    );

    const refreshed = await provider.refresh();

    assert.equal(refreshed.outcome, 'partial');
    assert.equal(refreshed.snapshot.total.inputTotal, 120);
    assert.equal(refreshed.snapshot.total.outputTotal, 30);
    assert.equal(refreshed.snapshot.files.length, 2);
    assert.equal(
      refreshed.snapshot.files[0].session.sessionKey,
      'current-session',
    );
    assert.deepEqual(refreshed.snapshot.qualityFlags, {
      'stale-file': 1,
      'stale-reset-required': 1,
    });
    assert.equal(refreshed.snapshot.limit?.windows[0].usedPercent, 91);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('provider snapshots promote exact period slices for scoped consumers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-period-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const index = duplicateIndex(false);
    const file = index.files['active-key'];
    file.aggregate.period = {
      timeZone: 'UTC',
      indexedThrough: file.offset,
      days: {
        '2026-07-20': {
          total: { inputTotal: 8, cachedInput: 5, outputTotal: 2, reasoningOutput: 1 },
          byModel: {
            'gpt-5.6-sol': { inputTotal: 8, cachedInput: 5, outputTotal: 2, reasoningOutput: 1 },
          },
          byEffort: {
            high: { inputTotal: 8, cachedInput: 5, outputTotal: 2, reasoningOutput: 1 },
          },
          structural: {
            patchCalls: 1,
            toolCalls: 2,
            postPatchToolCalls: 1,
            compactCount: 0,
            taskCompleteCount: 1,
          },
          firstObservedAt: Date.parse('2026-07-20T00:00:00.000Z'),
          lastObservedAt: Date.parse('2026-07-20T00:05:00.000Z'),
        },
      },
    };
    file.aggregate.today = {
      day: '2026-07-20',
      timeZone: 'UTC',
      indexedThrough: file.offset,
      hours: {
        '00': {
          total: { inputTotal: 8, cachedInput: 5, outputTotal: 2, reasoningOutput: 1 },
          byModel: {
            'gpt-5.6-sol': { inputTotal: 8, cachedInput: 5, outputTotal: 2, reasoningOutput: 1 },
          },
        },
      },
    };
    index.coverage.today = {
      timeZone: 'UTC',
      day: '2026-07-20',
      indexedFiles: 1,
      totalFiles: 1,
      indexedBytes: file.offset,
      totalBytes: file.offset,
      complete: false,
    };
    const provider = new CodexProvider(
      {
        enabled: true,
        codexHome: root,
        indexPath: 'index',
        salt: 'salt',
        timeZone: 'UTC',
      },
      () => new FakeClient([{ ...workerResult(index), failedFiles: 0 }]),
    );

    const refreshed = await provider.refresh();

    assert.deepEqual(refreshed.snapshot.files[0].period, file.aggregate.period);
    assert.deepEqual(refreshed.snapshot.files[0].today, file.aggregate.today);
    assert.deepEqual(refreshed.snapshot.todayCoverage, index.coverage.today);
    assert.equal(refreshed.snapshot.todayPartial, true);
    assert.equal(
      refreshed.snapshot.weeklyValueInputs?.usage[0].intervalStart,
      Date.parse('2026-07-20T00:00:00.000Z'),
    );
    assert.equal(
      refreshed.snapshot.weeklyValueInputs?.usage[0].intervalEnd,
      Date.parse('2026-07-20T00:05:00.000Z'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a worker failure retains the last verified provider snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-stale-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const client = new FakeClient([
      { ...workerResult(), failedFiles: 0 },
      new Error('/private/path must not be returned'),
    ]);
    const provider = new CodexProvider(
      {
        enabled: true,
        codexHome: root,
        indexPath: 'index',
        salt: 'salt',
        timeZone: 'Asia/Hong_Kong',
      },
      () => client,
    );
    const verified = await provider.refresh();
    const failed = await provider.refresh();

    assert.equal(verified.snapshot.total.inputTotal, 80);
    assert.equal(failed.outcome, 'error');
    assert.equal(failed.snapshot.total.inputTotal, 80);
    assert.doesNotMatch(JSON.stringify(failed), /private\/path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an exact archive copy is absent from a successful provider snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-dedup-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const client = new FakeClient([
      { ...workerResult(duplicateIndex(false)), failedFiles: 0 },
    ]);
    const provider = new CodexProvider(
      {
        enabled: true,
        codexHome: root,
        indexPath: 'index',
        salt: 'salt',
        timeZone: 'Asia/Hong_Kong',
      },
      () => client,
    );

    const refreshed = await provider.refresh();

    assert.equal(refreshed.outcome, 'success');
    assert.equal(refreshed.snapshot.files.length, 1);
    assert.deepEqual(refreshed.snapshot.qualityFlags, { 'active-only': 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an ambiguous active/archive group remains visible and makes outcome partial', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-ambiguous-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const client = new FakeClient([
      { ...workerResult(duplicateIndex(true)), failedFiles: 0 },
    ]);
    const provider = new CodexProvider(
      {
        enabled: true,
        codexHome: root,
        indexPath: 'index',
        salt: 'salt',
        timeZone: 'Asia/Hong_Kong',
      },
      () => client,
    );

    const refreshed = await provider.refresh();

    assert.equal(refreshed.outcome, 'partial');
    assert.equal(refreshed.snapshot.files.length, 2);
    assert.equal(refreshed.snapshot.total.outputTotal, 41);
    assert.deepEqual(refreshed.snapshot.qualityFlags, {
      'active-only': 1,
      'archive-only': 1,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('incomplete base, identity, or required period coverage is partial', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-coverage-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const cases = [
      {
        name: 'base',
        mutate(index: CodexIndexV1): void {
          index.coverage.complete = false;
        },
      },
      {
        name: 'identity',
        mutate(index: CodexIndexV1): void {
          index.coverage.identity.complete = false;
        },
      },
      ...(['last7Days', 'last30Days', 'allTime'] as const).map((range) => ({
        name: range,
        mutate(index: CodexIndexV1): void {
          index.coverage.period[range].complete = false;
        },
      })),
    ];

    for (const coverageCase of cases) {
      const index = duplicateIndex(false);
      coverageCase.mutate(index);
      const provider = new CodexProvider(
        {
          enabled: true,
          codexHome: root,
          indexPath: 'index',
          salt: 'salt',
          timeZone: 'Asia/Hong_Kong',
        },
        () => new FakeClient([
          { ...workerResult(index), failedFiles: 0 },
        ]),
      );

      assert.equal(
        (await provider.refresh()).outcome,
        'partial',
        coverageCase.name,
      );
      provider.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
