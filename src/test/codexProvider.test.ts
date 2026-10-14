import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  saveCodexIndexAtomic,
} from '../providers/codex/codexIndex';
import { CODEX_PERIOD_LINEAGE_VERSION } from '../providers/codex/codexPeriodIndex';
import { CodexWorkerResult } from '../providers/codex/codexWorkerProtocol';
import { CodexWorkerError } from '../providers/codex/codexIndexClient';
import { pseudonymousIdentityKey } from '../providers/codex/codexIdentity';
import { buildCodexUsageView } from '../providers/codex/codexUsage';

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
      schemaVersion: 4,
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

function calendarWitnessIndex(prefixEvents = 0): CodexIndexV1 {
  const index = partialIndex();
  const file = Object.values(index.files)[0];
  file.lineage = {
    fingerprintBlocks: [], pendingFingerprints: [], tokenEvents: prefixEvents,
    desiredPrefixEvents: prefixEvents, appliedPrefixEvents: prefixEvents,
  };
  file.aggregate.period = {
    timeZone: 'UTC', indexedThrough: file.offset,
    lineageVersion: CODEX_PERIOD_LINEAGE_VERSION, lineagePrefixEvents: prefixEvents,
    days: {
      '2026-07-20': {
        total: { ...file.aggregate.total }, byModel: structuredClone(file.aggregate.byModel),
        byEffort: structuredClone(file.aggregate.byEffort), structural: { ...file.aggregate.structural },
      },
    },
  };
  Object.assign(index.coverage, {
    complete: true, indexedFiles: 1, totalFiles: 1, indexedBytes: file.offset, totalBytes: file.size,
  });
  return index;
}

test('provider reuses only an immutable equal current census, independently of unchanged worker hints', async (t) => {
  const index = calendarWitnessIndex();
  const responses = Array.from({ length: 5 }, () => ({ ...workerResult(index), failedFiles: 0, bodyReads: 0, indexChanged: false }));
  const client = new FakeClient(responses);
  const provider = new CodexProvider({ enabled: true, codexHome: '/synthetic-not-read',
    indexPath: '/synthetic-not-read/index', salt: 'public-fixture', timeZone: 'UTC' }, () => client);
  t.mock.method(provider, 'isAvailable', async () => true);
  t.mock.method((provider as any).sessionTitleCache, 'load', async () => new Map());
  const first = (await provider.refresh()).snapshot;
  const warm = (await provider.refresh()).snapshot;
  assert.equal(warm.files, first.files);
  assert.ok(Object.isFrozen(first.files[0].period!.days));
  const file = Object.values(index.files)[0];
  file.offset--; // No body-read/indexChanged hint, and display totals still equal.
  const stale = (await provider.refresh()).snapshot;
  assert.notEqual(stale.files, first.files);
  assert.equal(stale.files[0].achievementPeriodWitness, undefined);
  assert.equal(first.files[0].achievementPeriodWitness!.offset, 100);
  file.offset++;
  provider.setAchievementHourProofEnabled(false);
  const off = (await provider.refresh()).snapshot;
  assert.equal(Object.isFrozen(off.files), false, 'OFF adds no immutable achievement capture');
  provider.setAchievementHourProofEnabled(true);
  const enabled = (await provider.refresh()).snapshot;
  assert.notEqual(enabled.files, off.files);
  assert.ok(Object.isFrozen(enabled.files));
  await provider.dispose();
});

test('calendar witness comes from a verified settled source, survives warm zero-body refresh, and stays runtime-only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-provider-calendar-witness-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    const index = calendarWitnessIndex(2);
    const file = Object.values(index.files)[0];
    const indexPath = path.join(root, 'index.json');
    await saveCodexIndexAtomic(indexPath, index);
    const before = JSON.stringify(index);
    const client = new FakeClient([
      { ...workerResult(index), failedFiles: 0 },
      { ...workerResult(index), failedFiles: 0, bodyReads: 0, indexChanged: false },
      new CodexWorkerError('cancelled', 'synthetic cancellation'),
      { ...workerResult(index), failedFiles: 0, bodyReads: 0 },
    ]);
    const provider = new CodexProvider({
      enabled: true, codexHome: root, indexPath, salt: 'salt', timeZone: 'UTC',
    }, () => client);
    const cached = await provider.loadPersistedSnapshot();
    assert.equal(cached?.currentManifestVerified, false);
    assert.equal(cached?.files[0].achievementPeriodWitness, undefined);
    const verified = await provider.refresh();
    const expected = { size: file.size, offset: file.offset, expectedPrefixEvents: 2, timeZone: 'UTC' };
    assert.deepEqual(verified.snapshot.files[0].achievementPeriodWitness, expected);
    assert.equal(JSON.stringify(index), before, 'snapshot publication must not mutate the worker index');
    assert.equal(Object.prototype.hasOwnProperty.call(file.aggregate, 'achievementPeriodWitness'), false);
    const projectedIndex = structuredClone(index);
    projectedIndex.files[file.fileKey].aggregate = verified.snapshot.files[0];
    await saveCodexIndexAtomic(indexPath, projectedIndex);
    assert.equal((await readFile(indexPath, 'utf8')).includes('achievementPeriodWitness'), false,
      'the existing persisted DTO must omit even an attached runtime projection');
    const warm = await provider.refresh();
    assert.equal(warm.diagnostic?.bodyReads, 0);
    assert.deepEqual(warm.snapshot.files[0].achievementPeriodWitness, expected);
    const displayOnly = await provider.loadPersistedSnapshot();
    assert.equal(displayOnly?.currentManifestVerified, false);
    assert.equal(displayOnly?.files[0].achievementPeriodWitness, undefined);
    const failed = await provider.refresh();
    assert.equal(failed.snapshot.currentManifestVerified, false);
    assert.equal(failed.snapshot.files[0].achievementPeriodWitness, undefined);
    assert.deepEqual(failed.snapshot.files[0].period, file.aggregate.period);
    assert.deepEqual(verified.snapshot.files[0].achievementPeriodWitness, expected, 'published snapshots stay immutable');
    const recovered = await provider.refresh();
    assert.deepEqual(recovered.snapshot.files[0].achievementPeriodWitness, expected);
    await provider.dispose();
    assert.equal(provider.snapshot()?.files[0].achievementPeriodWitness, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('calendar witness fails closed on independent source and period fences without filtering display files', async (t) => {
  const cases: Array<[string, (index: CodexIndexV1, file: CodexFileContribution) => void]> = [
    ['incomplete source coverage', (index) => { index.coverage.complete = false; }],
    ['stale reset', (_index, file) => { file.qualityFlags.push('stale-reset-required'); }],
    ['lineage reconciliation', (_index, file) => {
      file.lineageReconciliation = {
        offset: 0, discardingOversizedLine: false, prefixEvents: 0, tokenEventsSeen: 0,
        parserState: file.parserState, aggregate: file.aggregate, qualityFlags: [],
      };
    }],
    ['unapplied prefix', (_index, file) => { file.lineage!.desiredPrefixEvents = 1; }],
    ['oversized discard', (_index, file) => { file.discardingOversizedLine = true; }],
    ['unread tail', (_index, file) => { file.size++; }],
    ['cursor beyond source', (_index, file) => { file.size--; }],
    ['negative cursor', (_index, file) => { file.size = file.offset = file.aggregate.period!.indexedThrough = -1; }],
    ['fractional cursor', (_index, file) => { file.size = file.offset = file.aggregate.period!.indexedThrough = 0.5; }],
    ['unsafe cursor', (_index, file) => { file.size = file.offset = file.aggregate.period!.indexedThrough = Number.MAX_SAFE_INTEGER + 1; }],
    ['nonfinite cursor', (_index, file) => { file.size = file.offset = file.aggregate.period!.indexedThrough = Infinity; }],
    ['negative expected prefix', (_index, file) => { file.lineage!.desiredPrefixEvents = file.lineage!.appliedPrefixEvents = -1; }],
    ['fractional expected prefix', (_index, file) => { file.lineage!.desiredPrefixEvents = file.lineage!.appliedPrefixEvents = 0.5; }],
    ['unsafe expected prefix', (_index, file) => { file.lineage!.desiredPrefixEvents = file.lineage!.appliedPrefixEvents = Number.MAX_SAFE_INTEGER + 1; file.aggregate.period!.lineagePrefixEvents = Number.MAX_SAFE_INTEGER + 1; }],
    ['active period migration', (_index, file) => {
      file.periodMigration = {
        offset: file.offset, discardingOversizedLine: false, timeZone: 'UTC',
        prefixEvents: 0, tokenEventsSeen: 0, parserState: file.parserState, days: {}, qualityFlags: [],
      };
    }],
    ['missing period', (_index, file) => { delete file.aggregate.period; }],
    ['legacy readable period', (_index, file) => { delete file.aggregate.period!.lineageVersion; delete file.aggregate.period!.lineagePrefixEvents; }],
    ['old lineage version', (_index, file) => { file.aggregate.period!.lineageVersion = CODEX_PERIOD_LINEAGE_VERSION + 1; }],
    ['period prefix mismatch', (_index, file) => { file.aggregate.period!.lineagePrefixEvents = 1; }],
    ['period timezone mismatch', (_index, file) => { file.aggregate.period!.timeZone = 'Asia/Shanghai'; }],
    ['period cursor behind', (_index, file) => { file.aggregate.period!.indexedThrough--; }],
    ['period cursor ahead', (_index, file) => { file.aggregate.period!.indexedThrough++; }],
    ['period exceeds aggregate', (_index, file) => { file.aggregate.period!.days['2026-07-20'].total.inputTotal++; }],
    ['invalid period tokens', (_index, file) => { file.aggregate.period!.days['2026-07-20'].total.inputTotal = NaN; }],
    ['model exceeds day', (_index, file) => { file.aggregate.period!.days['2026-07-20'].byModel['gpt-5.6-sol'].inputTotal++; }],
    ['effort exceeds day', (_index, file) => { file.aggregate.period!.days['2026-07-20'].byEffort.high.outputTotal++; }],
  ];
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-provider-calendar-fences-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    for (const [label, mutate] of cases) {
      await t.test(label, async () => {
        const index = calendarWitnessIndex();
        const file = Object.values(index.files)[0];
        mutate(index, file);
        // Even a forged incoming aggregate witness must not bypass validation.
        file.aggregate.achievementPeriodWitness = { size: 100, offset: 100, expectedPrefixEvents: 0, timeZone: 'UTC' };
        const provider = new CodexProvider({
          enabled: true, codexHome: root, indexPath: path.join(root, 'index.json'), salt: 'salt', timeZone: 'UTC',
        }, () => new FakeClient([{ ...workerResult(index), failedFiles: 0 }]));
        const result = await provider.refresh();
        assert.equal(result.snapshot.currentManifestVerified, true);
        assert.ok(result.snapshot.files.every((aggregate) => aggregate.achievementPeriodWitness === undefined));
        const excluded = ['stale reset', 'lineage reconciliation', 'unapplied prefix'].includes(label);
        assert.equal(result.snapshot.files.length, excluded ? 0 : 1, 'only existing usage filtering may exclude files');
        if (label === 'legacy readable period') {
          assert.deepEqual(result.snapshot.files[0].period, file.aggregate.period, 'trusted legacy slices remain visible');
        }
        await provider.dispose();
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('calendar witness is per-file evidence while canonical contributions are withheld', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-provider-calendar-subtotal-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    const index = calendarWitnessIndex();
    const withheld = contribution('withheld-file');
    withheld.aggregate.session.sessionKey = withheld.parserState.sessionKey = 'withheld-session';
    withheld.qualityFlags.push('stale-reset-required');
    index.files[withheld.fileKey] = withheld;
    Object.assign(index.coverage, { indexedFiles: 2, totalFiles: 2, indexedBytes: 200, totalBytes: 200 });
    index.coverage.identity.complete = false;
    index.coverage.period.allTime.complete = false;
    const provider = new CodexProvider({
      enabled: true, codexHome: root, indexPath: path.join(root, 'index.json'), salt: 'salt', timeZone: 'UTC',
    }, () => new FakeClient([{ ...workerResult(index), failedFiles: 0 }]));
    const result = await provider.refresh();
    assert.equal(result.snapshot.coverage.complete, true, 'source-index coverage is not a calendar census');
    assert.equal(result.snapshot.coverage.identity.complete, false);
    assert.equal(result.snapshot.coverage.period.allTime.complete, false);
    assert.equal(result.snapshot.files.length, 1, 'retain the existing usage contribution exclusion');
    assert.deepEqual(result.snapshot.files[0].achievementPeriodWitness,
      { size: 100, offset: 100, expectedPrefixEvents: 0, timeZone: 'UTC' });
    await provider.dispose();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('facade copies the accepted usage window and exposes only matching successful producer proof', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-provider-origin-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    const window = { after: 100, through: 200 };
    const delta = { ...window, provider: 'codex' as const, processed: 100, output: 20,
      cacheRead: 30, families: { astra: 100, sol: 0, luna: 0 } };
    let captured: any;
    const provider = new CodexProvider({ enabled: true, codexHome: root, indexPath: 'unused', salt: 'salt', timeZone: 'UTC' }, () => ({
      refresh: async input => { captured = input; window.through = 300;
        const index = partialIndex(); index.coverage.complete = true;
        return { ...workerResult(index), failedFiles: 0, achievementUsageDelta: delta }; }, dispose: () => undefined,
    }));
    const result = await (provider.refresh as any)('background', undefined, true, window);
    assert.deepEqual(captured.achievementUsageWindow, { after: 100, through: 200 });
    assert.deepEqual(result.achievementUsageDelta, delta);
    assert.notEqual(result.achievementUsageDelta, delta);
    assert.equal((await (provider.refresh as any)('background', undefined, true, window)).achievementUsageDelta, undefined);
    await provider.dispose();
  } finally { await rm(root, { recursive: true, force: true }); }
});

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

test('hour proof stays closed on cached hydration until a worker verifies the manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-hour-cache-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const indexPath = path.join(root, 'index.json');
    const index = partialIndex();
    const file = Object.values(index.files)[0];
    file.identityChecked = true;
    file.lineage = {
      fingerprintBlocks: [], pendingFingerprints: [], tokenEvents: 0,
      appliedPrefixEvents: 0, desiredPrefixEvents: 0,
    };
    file.hourProof = {
      version: 1, indexedThrough: file.offset, prefixEvents: 0,
      hours: [Date.parse('2026-07-20T00:00:00.000Z') / 3_600_000],
    };
    index.coverage.complete = true;
    index.coverage.indexedFiles = 1;
    index.coverage.totalFiles = 1;
    index.coverage.indexedBytes = file.offset;
    index.coverage.totalBytes = file.size;
    await writeFile(indexPath, JSON.stringify(index), 'utf8');
    const provider = new CodexProvider({
      enabled: true, codexHome: root, indexPath, salt: 'salt', timeZone: 'UTC',
    }, () => new FakeClient([
      workerResult(index),
      new CodexWorkerError('cancelled', '/private/worker cancellation details'),
      workerResult(index),
    ]));
    const cached = await provider.loadPersistedSnapshot();
    assert.equal(cached?.outputHourProof?.complete, false);
    assert.deepEqual(cached?.outputHourProof?.hours, []);
    assert.equal(cached?.currentManifestVerified, false);
    assert.equal(buildCodexUsageView(cached!).currentManifestVerified, false);
    const verified = await provider.refresh();
    assert.equal(verified.snapshot.outputHourProof?.complete, true);
    assert.equal(verified.snapshot.outputHourProof?.hours.length, 1);
    assert.equal(verified.snapshot.currentManifestVerified, true);
    assert.equal(buildCodexUsageView(verified.snapshot).currentManifestVerified, true);
    const interrupted = await provider.refresh();
    assert.equal(interrupted.snapshot.total.inputTotal, verified.snapshot.total.inputTotal);
    assert.equal(interrupted.snapshot.currentManifestVerified, false);
    assert.equal(interrupted.snapshot.outputHourProof?.complete, false);
    assert.deepEqual(interrupted.snapshot.outputHourProof?.hours, []);
    assert.equal(provider.snapshot()?.currentManifestVerified, false);
    assert.equal((await provider.loadPersistedSnapshot())?.currentManifestVerified, false);
    assert.equal(verified.snapshot.currentManifestVerified, true, 'do not mutate an earlier published snapshot');
    const recovered = await provider.refresh();
    assert.equal(recovered.snapshot.currentManifestVerified, true);
    assert.equal(recovered.snapshot.outputHourProof?.complete, true);
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

test('a delayed post-reset current poll does not hide cached pre-reset evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-quota-rollover-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const index = duplicateIndex(false);
    const file = index.files['active-key'];
    const resetAt = Date.parse('2026-08-31T03:00:00.000Z');
    file.limits = {
      codex: {
        provider: 'codex',
        limitId: 'codex',
        observedAt: resetAt + 30 * 60 * 1000,
        source: 'local-log',
        confidence: 'last-observed',
        windows: [{
          label: 'secondary',
          usedPercent: 1,
          windowMinutes: 7 * 24 * 60,
          resetsAt: resetAt,
        }],
      },
    };
    index.quotaHistory = [{
      provider: 'codex',
      seriesKey: 'codex',
      observedAt: resetAt - 30 * 60 * 1000,
      resetAt,
      usedPercent: 96,
    }];
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
    const observations = refreshed.snapshot.weeklyValueInputs?.observations ?? [];

    assert.deepEqual(
      observations.map((item) => [item.observedAt, item.usedPercent]),
      [
        [resetAt + 30 * 60 * 1000, 1],
        [resetAt - 30 * 60 * 1000, 96],
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an invalid period sidecar cannot create a false weekly priced estimate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-period-guard-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const index = duplicateIndex(false);
    const file = index.files['active-key'];
    file.aggregate.period = {
      timeZone: 'UTC',
      indexedThrough: file.offset,
      days: {
        '2026-07-20': {
          total: { inputTotal: 10_000_000_000, outputTotal: 5_000_000_000 },
          byModel: {
            'gpt-5.6-sol': {
              inputTotal: 10_000_000_000,
              outputTotal: 5_000_000_000,
            },
          },
          byEffort: {},
          structural: file.aggregate.structural,
        },
      },
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

    assert.equal(refreshed.snapshot.total.inputTotal, 80);
    assert.deepEqual(refreshed.snapshot.weeklyValueInputs?.usage, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a period with a mismatched lineage marker stays hidden during rebuild', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-period-marker-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    const index = duplicateIndex(false);
    const file = index.files['active-key'];
    file.lineage = {
      fingerprintBlocks: [],
      pendingFingerprints: [],
      tokenEvents: 0,
      desiredPrefixEvents: 0,
      appliedPrefixEvents: 0,
    };
    file.aggregate.period = {
      timeZone: 'UTC',
      indexedThrough: file.offset,
      lineageVersion: 1,
      lineagePrefixEvents: 1,
      days: {
        '2026-07-20': {
          total: { ...file.aggregate.total },
          byModel: { ...file.aggregate.byModel },
          byEffort: { ...file.aggregate.byEffort },
          structural: file.aggregate.structural,
        },
      },
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

    assert.equal(refreshed.snapshot.files[0].period, undefined);
    assert.deepEqual(refreshed.snapshot.weeklyValueInputs?.usage, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('worker failure diagnostics preserve only allowlisted error codes, never raw errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-error-code-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    for (const [code, expected] of [['busy', 'busy'], ['cancelled', 'cancelled'],
      ['worker-failed', 'worker-failed'], ['/private/secret', 'refresh-failed']]) {
      const provider = new CodexProvider({ enabled: true, codexHome: root,
        indexPath: 'index', salt: 'salt', timeZone: 'UTC' },
      () => new FakeClient([new CodexWorkerError(code, '/private/credential') ]));
      try {
        const result = await provider.refresh();
        assert.equal((result.diagnostic as any)?.errorCode, expected);
        assert.doesNotMatch(JSON.stringify(result), /private|secret|credential/);
      } finally { await provider.dispose(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
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
    assert.equal(failed.failureCode, 'refresh-failed');
    assert.equal(failed.snapshot.total.inputTotal, 80);
    assert.equal(failed.snapshot.currentManifestVerified, false,
      'cached totals remain visible, but a failed current scan cannot prove new achievements');
    assert.equal(verified.snapshot.currentManifestVerified, true);
    assert.doesNotMatch(JSON.stringify(failed), /private\/path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('worker errors expose only an allowlisted category, never the error message', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-safe-failure-'));
  try {
    await mkdir(path.join(root, 'sessions'), { recursive: true });
    for (const code of ['cancelled', 'busy', 'worker-failed', 'disposed', 'refresh-failed', '/private/secret-code']) {
      const provider = new CodexProvider({
        enabled: true, codexHome: root, indexPath: 'index', salt: 'salt', timeZone: 'UTC',
      }, () => new FakeClient([new CodexWorkerError(code, '/private/credentials token=secret-value')]));
      const failed = await provider.refresh();
      assert.equal(failed.failureCode, code.startsWith('/') ? 'refresh-failed' : code);
      assert.doesNotMatch(JSON.stringify(failed), /private|credentials|secret-value|secret-code/);
      assert.equal(failed.snapshot.currentManifestVerified, false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unavailable and disposed providers keep cached totals without current achievement proof', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-proof-lifecycle-'));
  try {
    const sessions = path.join(root, 'sessions');
    const pausedSessions = path.join(root, 'paused-sessions');
    await mkdir(sessions, { recursive: true });
    const client = new FakeClient([workerResult(), workerResult()]);
    const provider = new CodexProvider({
      enabled: true, codexHome: root, indexPath: 'index', salt: 'salt', timeZone: 'UTC',
    }, () => client);
    const verified = await provider.refresh();
    await rename(sessions, pausedSessions);
    const unavailable = await provider.refresh();
    assert.equal(unavailable.outcome, 'unavailable');
    assert.equal(unavailable.snapshot.total.inputTotal, verified.snapshot.total.inputTotal);
    assert.equal(unavailable.snapshot.currentManifestVerified, false);
    assert.equal(buildCodexUsageView(unavailable.snapshot).currentManifestVerified, false);
    assert.equal(verified.snapshot.currentManifestVerified, true);
    await rename(pausedSessions, sessions);
    const recovered = await provider.refresh();
    assert.equal(recovered.snapshot.currentManifestVerified, true);
    await provider.dispose();
    const disposed = await provider.refresh();
    assert.equal(disposed.outcome, 'unavailable');
    assert.equal(disposed.snapshot.currentManifestVerified, false);
    assert.equal(disposed.snapshot.total.inputTotal, verified.snapshot.total.inputTotal);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cached hydration cannot reopen proof when a previously unavailable directory returns', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-restored-cache-'));
  try {
    const sessions = path.join(root, 'sessions');
    const paused = path.join(root, 'paused-sessions');
    await mkdir(sessions);
    const provider = new CodexProvider({
      enabled: true, codexHome: root, indexPath: 'index', salt: 'salt', timeZone: 'UTC',
    }, () => new FakeClient([workerResult()]));
    const verified = await provider.refresh();
    await rename(sessions, paused);
    assert.equal(await provider.isAvailable(), false,
      'the extension can observe unavailability without calling provider.refresh');
    await rename(paused, sessions);
    const cached = await provider.loadPersistedSnapshot();
    assert.equal(cached?.total.inputTotal, verified.snapshot.total.inputTotal);
    assert.equal(cached?.currentManifestVerified, false);
    assert.equal(cached?.outputHourProof?.complete, false);
    assert.deepEqual(cached?.outputHourProof?.hours, []);
    assert.equal(verified.snapshot.currentManifestVerified, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('disposal during the title await cannot republish current proof or revive its cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-provider-title-retirement-'));
  let finishTitles!: () => void;
  const titlesHeld = new Promise<void>(resolve => { finishTitles = resolve; });
  try {
    await mkdir(path.join(root, 'sessions'));
    const provider = new CodexProvider({
      enabled: true, codexHome: root, indexPath: 'index', salt: 'salt', timeZone: 'UTC',
    }, () => new FakeClient([workerResult(), workerResult()]));
    const verified = await provider.refresh();
    let titleLoadStarted!: () => void;
    const titleStarted = new Promise<void>(resolve => { titleLoadStarted = resolve; });
    const cache = {
      populated: false,
      clear: () => { cache.populated = false; },
      load: async () => {
        titleLoadStarted();
        await titlesHeld;
        cache.populated = true;
        return new Map<string, string>();
      },
    };
    (provider as any).sessionTitleCache = cache;
    const pending = provider.refresh();
    await titleStarted;
    await provider.dispose();
    finishTitles();
    const retired = await pending;
    assert.equal(retired.outcome, 'unavailable');
    assert.equal(retired.snapshot.currentManifestVerified, false);
    assert.equal(provider.snapshot()?.currentManifestVerified, false);
    assert.equal(retired.snapshot.total.inputTotal, verified.snapshot.total.inputTotal);
    assert.equal(verified.snapshot.currentManifestVerified, true);
    assert.equal(cache.populated, false);
  } finally {
    finishTitles();
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
