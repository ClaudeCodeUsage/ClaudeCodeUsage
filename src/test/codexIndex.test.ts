import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CodexIndexCancelledError,
  CodexIndexBudgetError,
  CodexFileContribution,
  CodexFilePassBatchRunner,
  CodexIndexIo,
  CodexIndexUpdateOptions,
  CODEX_REFRESH_MIN_BYTES,
  createEmptyCodexIndex,
  codexHourProofSnapshot,
  isReadableCodexPeriod,
  loadCodexIndex,
  runCodexFilePass,
  saveCodexIndexAtomic,
  updateCodexIndex as updateCodexIndexRaw,
} from '../providers/codex/codexIndex';
import {
  CodexManifest,
  CodexRuntimeManifestEntry,
  scanCodexManifest,
} from '../providers/codex/codexManifest';
import {
  CodexFilePassPool,
  CodexFilePassWorkerLike,
} from '../providers/codex/codexFilePassPool';
import { pseudonymousIdentityKey } from '../providers/codex/codexIdentity';
import { parseCodexLine } from '../providers/codex/codexParser';
import { codexAchievementDayEvidence } from '../achievementCalendar';
import { CODEX_PERIOD_LINEAGE_VERSION } from '../providers/codex/codexPeriodIndex';

const SALT = 'test-machine-salt';

async function corruptIndexBackups(root: string): Promise<string[]> {
  return (await readdir(root))
    .filter((name) => /^codex-index\.corrupt-\d+-\d+\.json$/.test(name))
    .sort();
}

test('corrupt index trailing data is preserved and rebuilt from an empty index', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-corrupt-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const originalIndex = createEmptyCodexIndex('UTC');
    const original = `${JSON.stringify(originalIndex)},"cachedInput":1}`;
    const recoveries: Array<{ reason: string }> = [];
    await writeFile(indexPath, original, 'utf8');

    const loaded = await (loadCodexIndex as any)(
      indexPath,
      'Asia/Hong_Kong',
      (event: { reason: string }) => recoveries.push(event),
    );

    assert.equal(loaded.schemaVersion, 3);
    assert.notEqual(loaded.indexGeneration, originalIndex.indexGeneration);
    assert.equal(loaded.coverage.period.timeZone, 'Asia/Hong_Kong');
    assert.deepEqual(recoveries, [{ reason: 'invalid-json' }]);
    await assert.rejects(readFile(indexPath, 'utf8'), { code: 'ENOENT' });
    const backups = await corruptIndexBackups(root);
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(root, backups[0]), 'utf8'), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unsupported index schema is quarantined with its distinct recovery reason', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-schema-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const original = JSON.stringify({ schemaVersion: 99, files: {} });
    const recoveries: Array<{ reason: string }> = [];
    await writeFile(indexPath, original, 'utf8');

    const loaded = await (loadCodexIndex as any)(
      indexPath,
      'UTC',
      (event: { reason: string }) => recoveries.push(event),
    );

    assert.equal(loaded.schemaVersion, 3);
    assert.ok((loaded.indexGeneration ?? 0) > 1);
    assert.deepEqual(recoveries, [{ reason: 'unsupported-schema' }]);
    const backups = await corruptIndexBackups(root);
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(root, backups[0]), 'utf8'), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('valid and missing indexes do not report recovery while I/O errors still fail', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-boundary-'));
  try {
    const validPath = path.join(root, 'codex-index.json');
    const missingPath = path.join(root, 'missing-index.json');
    const directoryPath = path.join(root, 'directory-index.json');
    const recoveries: Array<{ reason: string }> = [];
    await writeFile(validPath, JSON.stringify(createEmptyCodexIndex('UTC')), 'utf8');
    await mkdir(directoryPath);

    await (loadCodexIndex as any)(validPath, 'UTC', (event: { reason: string }) => recoveries.push(event));
    await (loadCodexIndex as any)(missingPath, 'UTC', (event: { reason: string }) => recoveries.push(event));
    await assert.rejects(
      (loadCodexIndex as any)(directoryPath, 'UTC', (event: { reason: string }) => recoveries.push(event)),
    );

    assert.deepEqual(recoveries, []);
    assert.deepEqual(await corruptIndexBackups(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('timezone migration advances the independent index generation', async () => {
  const initial = createEmptyCodexIndex('UTC');
  assert.equal(initial.indexGeneration, 1);
  const updated = await updateCodexIndexRaw(initial, persistableManifest([]), {
    salt: SALT,
    timeZone: 'Asia/Hong_Kong',
    now: () => Date.parse('2026-08-30T00:00:00.000Z'),
  });
  assert.equal(updated.index.indexGeneration, 2);
  const warm = await updateCodexIndexRaw(updated.index, persistableManifest([]), {
    salt: SALT,
    timeZone: 'Asia/Hong_Kong',
    now: () => Date.parse('2026-08-30T00:00:00.000Z'),
  });
  assert.equal(warm.index.indexGeneration, 2);
});

test('concurrent atomic saves use independent temporary files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-concurrent-save-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const indexes = Array.from({ length: 8 }, (_, inputTotal) => {
      const index = createEmptyCodexIndex('UTC');
      index.aggregate.total.inputTotal = inputTotal;
      return index;
    });

    await Promise.all(
      indexes.map((index) => saveCodexIndexAtomic(indexPath, index)),
    );

    const persisted = JSON.parse(await readFile(indexPath, 'utf8')) as {
      aggregate: { total: { inputTotal: number } };
    };
    assert.ok(
      indexes.some(
        (index) =>
          index.aggregate.total.inputTotal ===
          persisted.aggregate.total.inputTotal,
      ),
    );
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes('.tmp-')),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('schema-3 reload preserves only bounded pseudonymous replay evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-replay-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const fileKey = pseudonymousIdentityKey(SALT, 'replay-file');
    const sourceKey = pseudonymousIdentityKey(SALT, 'rate-limit:codex');
    const signature = 't:100:80:10:4:110|l:20:15:3:1:999';
    const index = createEmptyCodexIndex('UTC');
    const contribution = dedupContribution(fileKey, 'sessions');
    contribution.parserState = {
      schemaVersion: 4,
      fileKey,
      sessionKey: fileKey,
      role: 'root',
      highWater: {
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 10,
        reasoningOutputTokens: 4,
        totalTokens: 110,
      },
      snapshotSignaturesBySource: {
        ...Object.fromEntries(
          Array.from({ length: 34 }, (_, index) => [
            pseudonymousIdentityKey(SALT, `rate-limit:lane-${index}`),
            `t:${index}:0:0:0:${index}|l:0:0:0:0:${index}`,
          ]),
        ),
        'raw-account@example.invalid': signature,
        [pseudonymousIdentityKey(SALT, 'rate-limit:invalid')]:
          't:/private/path|l:secret',
        [sourceKey]: signature,
      },
      previousSnapshotSignature: signature,
      qualityFlags: [],
    };
    index.files[fileKey] = contribution;

    await saveCodexIndexAtomic(indexPath, index);
    const loaded = await loadCodexIndex(indexPath, 'UTC');
    const replayState = loaded.files[fileKey].parserState;
    const savedSources = Object.keys(replayState.snapshotSignaturesBySource ?? {});

    assert.equal(replayState.schemaVersion, 4);
    assert.equal(savedSources.length, 32);
    assert.ok(savedSources.includes(sourceKey));
    assert.equal(savedSources.includes('raw-account@example.invalid'), false);
    assert.equal(
      replayState.snapshotSignaturesBySource?.[
        pseudonymousIdentityKey(SALT, 'rate-limit:invalid')
      ],
      undefined,
    );
    assert.equal(replayState.previousSnapshotSignature, signature);

    const replay = parseCodexLine(
      JSON.stringify({
        timestamp: '2026-07-20T00:02:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 80,
              output_tokens: 10,
              reasoning_output_tokens: 4,
              total_tokens: 110,
            },
            last_token_usage: {
              input_tokens: 20,
              cached_input_tokens: 15,
              output_tokens: 3,
              reasoning_output_tokens: 1,
              total_tokens: 999,
            },
          },
          rate_limits: { limit_id: 'codex' },
        },
      }),
      replayState,
      (raw) => pseudonymousIdentityKey(SALT, raw),
    );
    assert.equal(replay.events.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('schema-3 index with v2.3.0 parser semantics requests one rescan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-token-migration-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const fileKey = pseudonymousIdentityKey(SALT, 'legacy-token-file');
    const index = createEmptyCodexIndex('UTC');
    const contribution = dedupContribution(fileKey, 'sessions');
    contribution.parserState = {
      ...contribution.parserState,
      schemaVersion: 3,
      fileKey,
      sessionKey: fileKey,
    };
    index.files[fileKey] = contribution;
    index.aggregate.total = {
      inputTotal: 100,
      cachedInput: 50,
      outputTotal: 20,
      reasoningOutput: 10,
      sourceTotal: 120,
    };
    index.coverage.indexedFiles = 1;
    index.coverage.totalFiles = 1;
    index.coverage.indexedBytes = 100;
    index.coverage.totalBytes = 100;
    index.coverage.complete = true;
    await writeFile(indexPath, JSON.stringify(index), 'utf8');

    const loaded = await loadCodexIndex(indexPath, 'UTC');

    assert.equal(loaded.aggregate.total.inputTotal, 0);
    assert.equal(loaded.coverage.indexedFiles, 0);
    assert.equal(loaded.coverage.indexedBytes, 0);
    assert.equal(loaded.coverage.complete, false);
    assert.ok(
      loaded.files[fileKey].qualityFlags.includes('stale-reset-required'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('token semantics rescan preserves completed files across a partial checkpoint reload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-token-resume-'));
  try {
    const sessions = path.join(root, 'sessions');
    const indexPath = path.join(root, 'codex-index.json');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'older.jsonl'),
      completeSession('older', 100, 20),
      'utf8',
    );
    await writeFile(
      path.join(sessions, 'newer.jsonl'),
      completeSession('newer', 300, 60),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    for (const entry of manifest.files) {
      const isNewer = path.basename(entry.absolutePath) === 'newer.jsonl';
      entry.mtimeMs = isNewer ? 2 : 1;
      manifest.persistable[entry.fileKey].mtimeMs = entry.mtimeMs;
    }
    const current = await updateCodexIndex(
      createEmptyCodexIndex('UTC'),
      manifest,
      { salt: SALT, timeZone: 'UTC' },
    );
    const legacy = structuredClone(current.index);
    for (const contribution of Object.values(legacy.files)) {
      contribution.parserState = {
        ...contribution.parserState,
        schemaVersion: 3,
      };
    }
    await writeFile(indexPath, JSON.stringify(legacy), 'utf8');

    const reset = await loadCodexIndex(indexPath, 'UTC');
    const firstPass = await updateCodexIndex(reset, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      budget: { maxFilePasses: 1, maxBytes: CODEX_REFRESH_MIN_BYTES },
    });
    const completedBeforeReload = Object.values(firstPass.index.files).filter(
      (contribution) =>
        !contribution.qualityFlags.includes('stale-reset-required'),
    );
    assert.equal(completedBeforeReload.length, 1);
    assert.equal(firstPass.index.aggregate.total.inputTotal, 300);
    assert.equal(firstPass.index.coverage.indexedFiles, 1);
    await saveCodexIndexAtomic(indexPath, firstPass.index);

    const resumed = await loadCodexIndex(indexPath, 'UTC');
    assert.equal(resumed.aggregate.total.inputTotal, 300);
    assert.equal(resumed.coverage.indexedFiles, 1);
    assert.equal(
      Object.values(resumed.files).filter((contribution) =>
        contribution.qualityFlags.includes('stale-reset-required')
      ).length,
      1,
    );

    const secondPass = await updateCodexIndex(resumed, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      budget: { maxFilePasses: 1, maxBytes: CODEX_REFRESH_MIN_BYTES },
    });
    assert.equal(secondPass.index.aggregate.total.inputTotal, 400);
    assert.equal(secondPass.index.coverage.indexedFiles, 2);
    assert.equal(secondPass.index.coverage.complete, true);
    assert.equal(
      Object.values(secondPass.index.files).some((contribution) =>
        contribution.qualityFlags.includes('stale-reset-required')
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('index reload replaces invalid legacy session identity and drops raw parent and project keys', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-identity-sanitize-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const fileKey = pseudonymousIdentityKey(SALT, 'verified-file');
    const empty = createEmptyCodexIndex('UTC');
    await writeFile(indexPath, JSON.stringify({
      ...empty,
      files: {
        [fileKey]: {
          fileKey,
          sourceArea: 'sessions',
          size: 1,
          mtimeMs: 1,
          offset: 1,
          discardingOversizedLine: false,
          parserState: {
            schemaVersion: 1,
            fileKey,
            sessionKey: 'raw-session-id',
            parentSessionKey: '/Users/private/parent.jsonl',
            projectKey: 'https://example.invalid/private.git',
            role: 'subagent',
            qualityFlags: [],
          },
          aggregate: {
            total: { inputTotal: 1, outputTotal: 1 },
            byDay: {},
            byModel: {},
            byEffort: {},
            session: {
              sessionKey: 'raw-session-id',
              parentSessionKey: '/Users/private/parent.jsonl',
              projectKey: 'https://example.invalid/private.git',
              role: 'subagent',
            },
            structural: {
              patchCalls: 0,
              toolCalls: 0,
              postPatchToolCalls: 0,
              compactCount: 0,
              taskCompleteCount: 0,
            },
          },
          qualityFlags: [],
        },
      },
    }), 'utf8');

    const loaded = await loadCodexIndex(indexPath, 'UTC');
    const contribution = loaded.files[fileKey];
    assert.equal(contribution.parserState.sessionKey, fileKey);
    assert.equal(contribution.aggregate.session.sessionKey, fileKey);
    assert.equal(contribution.parserState.parentSessionKey, undefined);
    assert.equal(contribution.aggregate.session.parentSessionKey, undefined);
    assert.equal(contribution.parserState.projectKey, undefined);
    assert.equal(contribution.aggregate.session.projectKey, undefined);
    assert.doesNotMatch(JSON.stringify(loaded), /raw-session|\/Users\/private|example\.invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('index load and save fail closed for unsafe metadata labels and bucket keys', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-label-sanitize-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const fileKey = pseudonymousIdentityKey(SALT, 'label-file');
    const sessionKey = pseudonymousIdentityKey(SALT, 'label-session');
    const unsafe = {
      posix: '/Users/alice/Secret',
      windows: 'C:\\Users\\alice\\Secret',
      unc: '\\\\server\\share\\Secret',
      url: 'https://example.invalid/private',
      fileUrl: 'file:///Users/alice/Secret',
      sshUrl: 'ssh://example.invalid/private',
      control: `agent\u0000secret`,
      format: `agent\u200dsecret`,
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      uuidV7: '019f6e61-0bf5-7a72-b6c1-2ace56bdd928',
      sessionKey: 'b'.repeat(64),
    };
    const tokens = { inputTotal: 10, outputTotal: 2 };
    const collisionTokens = { inputTotal: 3, outputTotal: 1 };
    const explicitUnknownTokens = { inputTotal: 5, outputTotal: 1 };
    const index = createEmptyCodexIndex('UTC');
    index.files[fileKey] = {
      fileKey,
      sourceArea: 'sessions',
      size: 100,
      mtimeMs: 1,
      offset: 100,
      discardingOversizedLine: false,
      parserState: {
        schemaVersion: 4,
        fileKey,
        sessionKey,
        agentNickname: unsafe.posix,
        model: unsafe.windows,
        effort: unsafe.url,
        role: 'root',
        qualityFlags: [],
      },
      aggregate: {
        total: tokens,
        byDay: {},
        byModel: {
          'gpt-5.6-sol': tokens,
          'claude-opus-4-20250514': tokens,
          [unsafe.posix]: tokens,
          [unsafe.url]: tokens,
          [unsafe.uuid]: tokens,
          [unsafe.uuidV7]: tokens,
          ' gpt-5.6-sol ': collisionTokens,
        },
        byEffort: {
          xhigh: tokens,
          [unsafe.windows]: tokens,
          [unsafe.sessionKey]: tokens,
          ' xhigh ': collisionTokens,
          unknown: explicitUnknownTokens,
        },
        session: {
          sessionKey,
          agentNickname: unsafe.control,
          role: 'root',
        },
        structural: {
          patchCalls: 0,
          toolCalls: 0,
          postPatchToolCalls: 0,
          compactCount: 0,
          taskCompleteCount: 0,
        },
        period: {
          timeZone: 'UTC',
          indexedThrough: 100,
          days: {
            '2026-07-20': {
              total: tokens,
              byModel: {
                'gpt-5.6-sol': tokens,
                [unsafe.fileUrl]: tokens,
                [unsafe.format]: tokens,
                ' gpt-5.6-sol ': collisionTokens,
                unknown: explicitUnknownTokens,
              },
              byEffort: {
                xhigh: tokens,
                [unsafe.unc]: tokens,
                [unsafe.sshUrl]: tokens,
                ' xhigh ': collisionTokens,
              },
              structural: {
                patchCalls: 0,
                toolCalls: 0,
                postPatchToolCalls: 0,
                compactCount: 0,
                taskCompleteCount: 0,
              },
            },
          },
        },
      },
      qualityFlags: [],
    };
    index.aggregate.byModel = {
      'gpt-5.6-sol': tokens,
      [unsafe.posix]: tokens,
      [unsafe.url]: tokens,
      ' gpt-5.6-sol ': collisionTokens,
      unknown: explicitUnknownTokens,
    };
    index.aggregate.byEffort = {
      xhigh: tokens,
      [unsafe.windows]: tokens,
      [unsafe.uuid]: tokens,
      ' xhigh ': collisionTokens,
    };

    await saveCodexIndexAtomic(indexPath, index);
    const persisted = await readFile(indexPath, 'utf8');
    assert.doesNotMatch(
      persisted,
      /Users|alice|Secret|example\.invalid|550e8400|b{64}|u0000|u200d/,
    );
    const saved = JSON.parse(persisted) as typeof index;
    assert.equal(saved.files[fileKey].parserState.agentNickname, undefined);
    assert.equal(saved.files[fileKey].parserState.model, undefined);
    assert.equal(saved.files[fileKey].parserState.effort, undefined);
    assert.equal(saved.files[fileKey].aggregate.session.agentNickname, undefined);
    assert.deepEqual(Object.keys(saved.files[fileKey].aggregate.byModel).sort(), [
      'claude-opus-4-20250514',
      'gpt-5.6-sol',
      'unknown',
    ]);
    assert.equal(saved.files[fileKey].aggregate.byModel['gpt-5.6-sol'].inputTotal, 13);
    assert.equal(saved.files[fileKey].aggregate.byModel.unknown.inputTotal, 40);
    assert.deepEqual(Object.keys(saved.files[fileKey].aggregate.byEffort).sort(), [
      'unknown',
      'xhigh',
    ]);
    assert.equal(saved.files[fileKey].aggregate.byEffort.xhigh.inputTotal, 13);
    assert.equal(saved.files[fileKey].aggregate.byEffort.unknown.inputTotal, 25);
    assert.deepEqual(Object.keys(saved.aggregate.byModel).sort(), [
      'gpt-5.6-sol',
      'unknown',
    ]);
    assert.equal(saved.aggregate.byModel['gpt-5.6-sol'].inputTotal, 13);
    assert.equal(saved.aggregate.byModel.unknown.inputTotal, 25);
    assert.deepEqual(Object.keys(saved.aggregate.byEffort).sort(), ['unknown', 'xhigh']);
    assert.equal(saved.aggregate.byEffort.xhigh.inputTotal, 13);
    assert.equal(saved.aggregate.byEffort.unknown.inputTotal, 20);
    assert.deepEqual(
      Object.keys(
        saved.files[fileKey].aggregate.period!.days['2026-07-20'].byModel,
      ).sort(),
      ['gpt-5.6-sol', 'unknown'],
    );
    assert.equal(
      saved.files[fileKey].aggregate.period!.days['2026-07-20']
        .byModel['gpt-5.6-sol'].inputTotal,
      13,
    );
    assert.equal(
      saved.files[fileKey].aggregate.period!.days['2026-07-20']
        .byModel.unknown.inputTotal,
      25,
    );
    assert.deepEqual(
      Object.keys(
        saved.files[fileKey].aggregate.period!.days['2026-07-20'].byEffort,
      ).sort(),
      ['unknown', 'xhigh'],
    );
    assert.equal(
      saved.files[fileKey].aggregate.period!.days['2026-07-20']
        .byEffort.xhigh.inputTotal,
      13,
    );
    assert.equal(
      saved.files[fileKey].aggregate.period!.days['2026-07-20']
        .byEffort.unknown.inputTotal,
      20,
    );

    const unsafeOnDisk = structuredClone(index);
    unsafeOnDisk.files[fileKey].parserState.agentNickname = unsafe.posix;
    unsafeOnDisk.files[fileKey].parserState.model = unsafe.fileUrl;
    unsafeOnDisk.files[fileKey].parserState.effort = unsafe.sessionKey;
    unsafeOnDisk.files[fileKey].aggregate.session.agentNickname = unsafe.uuid;
    await writeFile(indexPath, JSON.stringify(unsafeOnDisk), 'utf8');
    const loaded = await loadCodexIndex(indexPath, 'UTC');
    const loadedJson = JSON.stringify(loaded);
    assert.doesNotMatch(
      loadedJson,
      /Users|alice|Secret|example\.invalid|550e8400|b{64}|u0000|u200d/,
    );
    assert.equal(loaded.files[fileKey].parserState.agentNickname, undefined);
    assert.equal(loaded.files[fileKey].parserState.model, undefined);
    assert.equal(loaded.files[fileKey].parserState.effort, undefined);
    assert.equal(loaded.files[fileKey].aggregate.session.agentNickname, undefined);
    assert.deepEqual(Object.keys(loaded.files[fileKey].aggregate.byModel).sort(), [
      'claude-opus-4-20250514',
      'gpt-5.6-sol',
      'unknown',
    ]);
    assert.equal(loaded.files[fileKey].aggregate.byModel['gpt-5.6-sol'].inputTotal, 13);
    assert.equal(loaded.files[fileKey].aggregate.byModel.unknown.inputTotal, 40);
    assert.deepEqual(Object.keys(loaded.files[fileKey].aggregate.byEffort).sort(), [
      'unknown',
      'xhigh',
    ]);
    assert.equal(loaded.files[fileKey].aggregate.byEffort.xhigh.inputTotal, 13);
    assert.equal(loaded.files[fileKey].aggregate.byEffort.unknown.inputTotal, 25);
    assert.equal(loaded.aggregate.byModel['gpt-5.6-sol'].inputTotal, 13);
    assert.equal(loaded.aggregate.byModel.unknown.inputTotal, 25);
    assert.equal(loaded.aggregate.byEffort.xhigh.inputTotal, 13);
    assert.equal(loaded.aggregate.byEffort.unknown.inputTotal, 20);
    assert.equal(
      loaded.files[fileKey].aggregate.period!.days['2026-07-20']
        .byModel.unknown.inputTotal,
      25,
    );
    assert.equal(
      loaded.files[fileKey].aggregate.period!.days['2026-07-20']
        .byEffort.unknown.inputTotal,
      20,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function updateCodexIndex(
  previous: Parameters<typeof updateCodexIndexRaw>[0],
  manifest: Parameters<typeof updateCodexIndexRaw>[1],
  options: Partial<CodexIndexUpdateOptions> & Pick<CodexIndexUpdateOptions, 'salt'>,
): ReturnType<typeof updateCodexIndexRaw> {
  return updateCodexIndexRaw(previous, manifest, {
    ...options,
    timeZone: options.timeZone ?? 'UTC',
  });
}

test('disabled achievements leave a complete legacy usage index warm without extra history reads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-proof-disabled-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions);
    await writeFile(path.join(sessions, 'history.jsonl'),
      `${sessionLine('disabled-proof')}\n${contextLine()}\n${tokenLine(100, 50, '2026-07-20T00:10:00.000Z')}\n`, 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { salt: SALT });
    const legacy = structuredClone(cold.index);
    for (const row of Object.values(legacy.files)) delete row.hourProof;
    const disabled = await updateCodexIndex(legacy, manifest, {
      salt: SALT, allowAchievementHourProof: false,
    } as any);
    assert.equal(disabled.bodyReads, 0, 'OFF must not run achievement-only history migration');
    assert.equal(disabled.indexChanged, false);
    assert.equal(disabled.index, legacy, 'numeric checkpoint and generation remain intact');
    const enabled = await updateCodexIndex(disabled.index, manifest, {
      salt: SALT, allowAchievementHourProof: true,
    } as any);
    assert.equal(codexHourProofSnapshot(enabled.index).complete, true);
    assert.deepEqual(enabled.index.aggregate.total, cold.index.aggregate.total);
    const warm = await updateCodexIndex(enabled.index, manifest, { salt: SALT });
    assert.equal(warm.bodyReads, 0);
    assert.equal(warm.indexChanged, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const batched of [false, true]) test(`legacy calendar proof recovers one file per refresh and stays warm (${batched ? 'batch' : 'sequential'})`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-calendar-legacy-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions);
    for (let i = 0; i < 3; i++) {
      await writeFile(path.join(sessions, `${i}.jsonl`), completeSession(`calendar-${i}`, 100 + i, 10), 'utf8');
    }
    const manifest = await scanCodexManifest(root, SALT);
    const now = () => Date.parse('2026-08-30T00:00:00.000Z');
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { salt: SALT, now });
    const legacy = structuredClone(cold.index);
    for (const row of Object.values(legacy.files)) {
      const period = row.aggregate.period!;
      delete period.lineageVersion;
      delete period.lineagePrefixEvents;
      // Aggregate-size compatibility cannot prove these dates. Recovery must
      // replay bodies rather than blessing otherwise plausible legacy buckets.
      period.days = { '2026-07-19': period.days['2026-07-20'] };
    }
    const evidence = (index: typeof legacy) => codexAchievementDayEvidence(
      Object.values(index.files).map(row => row.aggregate), 'UTC', index.coverage.period.allTime.complete,
    );
    assert.equal(legacy.coverage.complete, true);
    assert.equal(legacy.coverage.period.allTime.complete, true);
    assert.equal(evidence(legacy).complete, false);
    const disabled = await updateCodexIndex(legacy, manifest, { salt: SALT, now, allowAchievementHourProof: false });
    assert.equal(disabled.index, legacy);
    assert.equal(disabled.bodyReads, 0);
    assert.equal(disabled.migration.pending, false);
    assert.ok(Object.values(disabled.index.files).every(row => isReadableCodexPeriod(row, 'UTC')));

    const budget = { maxFilePasses: 1, maxBytes: CODEX_REFRESH_MIN_BYTES };
    const taskKinds: string[] = [];
    const filePassBatch: CodexFilePassBatchRunner | undefined = batched ? async (tasks, onOutcome) => {
      assert.equal(tasks.length, 1, 'the batch must share the global file-pass budget');
      for (const task of tasks) {
        taskKinds.push(task.kind);
        await onOutcome(await runCodexFilePass(task));
      }
    } : undefined;
    const noBudget = await updateCodexIndex(disabled.index, manifest, {
      salt: SALT, now, budget: { ...budget, maxFilePasses: 0 },
    });
    assert.equal(noBudget.bodyReads, 0);
    assert.equal(noBudget.migration.pending, true);
    assert.equal(noBudget.index.coverage.period.allTime.complete, false);
    assert.ok(Object.values(noBudget.index.files).every(row => row.aggregate.period?.lineageVersion === undefined));
    let index = noBudget.index;
    const indexPath = path.join(root, 'index.json');
    for (let i = 1; i <= 3; i++) {
      const result = await updateCodexIndex(index, manifest, { salt: SALT, now, budget, filePassBatch });
      assert.equal(result.failedFiles, 0);
      assert.equal(result.bodyReads, 1);
      assert.equal(result.migration.filePasses, 1);
      assert.ok(result.migration.bytesRead <= budget.maxBytes);
      assert.equal(result.migration.pending, i < 3);
      assert.equal(result.index.coverage.period.allTime.migratedFiles, i);
      assert.equal(result.index.coverage.period.allTime.complete, i === 3);
      assert.equal(evidence(result.index).complete, i === 3);
      assert.deepEqual(result.index.aggregate.total, cold.index.aggregate.total);
      assert.equal(result.index.indexGeneration, cold.index.indexGeneration);
      assert.equal(Object.values(result.index.files).filter(row =>
        row.aggregate.period?.lineageVersion === CODEX_PERIOD_LINEAGE_VERSION).length, i);
      await saveCodexIndexAtomic(indexPath, result.index);
      index = await loadCodexIndex(indexPath, 'UTC');
    }
    assert.deepEqual(evidence(index), evidence(cold.index), 'dates come from source proof');
    if (batched) assert.deepEqual(taskKinds, ['period', 'period']);
    for (let i = 0; i < 2; i++) {
      const io = trackingIo();
      const warm = await updateCodexIndex(index, manifest, { salt: SALT, now, budget, io, filePassBatch });
      assert.equal(warm.index, index);
      assert.equal(warm.indexChanged, false);
      assert.equal(warm.bodyReads, 0);
      assert.equal(io.bodyReads.size, 0);
      assert.equal(warm.migration.pending, false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy calendar proof is never stamped by blocked or failed history reads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-calendar-failure-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    await writeFile(path.join(root, 'sessions', 'history.jsonl'), completeSession('calendar-failure', 100, 10), 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const now = () => Date.parse('2026-08-30T00:00:00.000Z');
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { salt: SALT, now });
    const legacy = structuredClone(cold.index);
    const key = manifest.files[0].fileKey;
    delete legacy.files[key].aggregate.period!.lineageVersion;
    delete legacy.files[key].aggregate.period!.lineagePrefixEvents;
    const blocked = await updateCodexIndex(legacy, manifest, { salt: SALT, now, allowHistoricalBackfill: false });
    assert.equal(blocked.bodyReads, 0);
    assert.equal(blocked.index.files[key].aggregate.period!.lineageVersion, undefined);
    const failed = await updateCodexIndex(legacy, manifest, {
      salt: SALT, now, io: { async *read() { throw new Error('synthetic proof read failure'); } },
    });
    assert.equal(failed.failedFiles, 1);
    assert.equal(failed.migration.pending, true);
    assert.equal(failed.index.coverage.period.allTime.complete, false);
    assert.equal(failed.index.files[key].aggregate.period!.lineageVersion, undefined);
    assert.deepEqual(failed.index.aggregate.total, cold.index.aggregate.total);
    const recovered = await updateCodexIndex(failed.index, manifest, { salt: SALT, now });
    assert.deepEqual(recovered.index.files[key].aggregate.period, cold.index.files[key].aggregate.period);
    assert.equal(recovered.migration.pending, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy calendar proof only revalidates canonical active/archive copies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-calendar-copy-'));
  try {
    for (const area of ['sessions', 'archived_sessions']) {
      await mkdir(path.join(root, area));
      await writeFile(path.join(root, area, 'copy.jsonl'), completeSession('calendar-copy', 100, 10), 'utf8');
    }
    const manifest = await scanCodexManifest(root, SALT);
    const now = () => Date.parse('2026-08-30T00:00:00.000Z');
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { salt: SALT, now });
    assert.equal(cold.index.coverage.period.allTime.totalFiles, 1);
    const legacy = structuredClone(cold.index);
    for (const row of Object.values(legacy.files)) {
      delete row.aggregate.period!.lineageVersion;
      delete row.aggregate.period!.lineagePrefixEvents;
    }
    const io = trackingIo();
    const recovered = await updateCodexIndex(legacy, manifest, {
      salt: SALT, now, io, budget: { maxFilePasses: 1, maxBytes: CODEX_REFRESH_MIN_BYTES },
    });
    const canonical = manifest.files.find(row => row.sourceArea === 'sessions')!;
    assert.deepEqual(io.fileKeysRead, [canonical.fileKey]);
    assert.equal(recovered.index.coverage.period.allTime.complete, true);
    assert.equal(recovered.migration.pending, false);
    assert.deepEqual(recovered.index.aggregate.total, cold.index.aggregate.total);
    const warm = await updateCodexIndex(recovered.index, manifest, { salt: SALT, now });
    assert.equal(warm.bodyReads, 0);
    assert.equal(warm.indexChanged, false, 'an excluded copy cannot restart proof recovery');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy calendar proof cancellation resumes its persisted body cursor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-calendar-cancel-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    const body = `${sessionLine('calendar-cancel')}\n${contextLine()}\n` + Array.from(
      { length: 11_000 }, (_, i) => tokenLine(i + 1, i + 1, '2026-07-20T00:01:00.000Z'),
    ).join('\n') + '\n';
    await writeFile(path.join(root, 'sessions', 'history.jsonl'), body, 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const now = () => Date.parse('2026-08-30T00:00:00.000Z');
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { salt: SALT, now });
    const legacy = structuredClone(cold.index);
    const key = manifest.files[0].fileKey;
    delete legacy.files[key].aggregate.period!.lineageVersion;
    delete legacy.files[key].aggregate.period!.lineagePrefixEvents;
    const indexPath = path.join(root, 'index.json');
    let cancelled = false;
    await assert.rejects(updateCodexIndex(legacy, manifest, {
      salt: SALT, now, budget: { maxFilePasses: 1, maxBytes: CODEX_REFRESH_MIN_BYTES },
      shouldCancel: () => cancelled,
      onProgress: progress => { if (progress.period.allTime.migratedBytes > 0) cancelled = true; },
      onCheckpoint: async index => { await saveCodexIndexAtomic(indexPath, index); },
    }), CodexIndexCancelledError);
    const saved = await loadCodexIndex(indexPath, 'UTC');
    const offset = saved.files[key].periodMigration!.offset;
    assert.ok(offset > 0 && offset < manifest.files[0].size);
    assert.equal(saved.files[key].aggregate.period?.lineageVersion, undefined);
    assert.ok(isReadableCodexPeriod(saved.files[key], 'UTC'), 'compatible display slices survive a partial proof pass');
    assert.equal(saved.coverage.period.allTime.complete, false);
    assert.deepEqual(saved.aggregate.total, cold.index.aggregate.total);
    const io = trackingIo();
    const resumed = await updateCodexIndex(saved, manifest, { salt: SALT, now, io });
    assert.equal(io.readOffsets[0], offset);
    assert.ok(resumed.migration.bytesRead < Buffer.byteLength(body));
    assert.deepEqual(resumed.index.files[key].aggregate.period, cold.index.files[key].aggregate.period);
    assert.equal(resumed.index.coverage.period.allTime.complete, true);
    assert.equal(resumed.migration.pending, false);
    const warm = await updateCodexIndex(resumed.index, manifest, { salt: SALT, now });
    assert.equal(warm.bodyReads, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UTC output proof backfills legacy history, resumes, and keeps warm body reads at zero', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-hour-proof-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    const indexPath = path.join(root, 'index.json');
    const filePath = path.join(sessions, 'history.jsonl');
    const body = `${sessionLine('proof')}\n${contextLine()}\n${Array.from(
      { length: 11_000 },
      (_, i) => tokenLine(i + 1, i + 1,
        `2026-07-20T${String(Math.floor(i / 60) % 24).padStart(2, '0')}:00:00.000Z`),
    ).join('\n')}\n`;
    await writeFile(filePath, body, 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { salt: SALT });
    const key = manifest.files[0].fileKey;
    const legacy = structuredClone(cold.index);
    delete legacy.files[key].hourProof;
    const budget = { maxFilePasses: 16, maxBytes: CODEX_REFRESH_MIN_BYTES };
    const partial = await updateCodexIndex(legacy, manifest, { salt: SALT, budget });
    assert.ok((partial.index.files[key].hourProofMigration?.offset ?? 0) > 0);
    assert.equal(codexHourProofSnapshot(partial.index).complete, false);
    await saveCodexIndexAtomic(indexPath, partial.index);
    let resumed = await loadCodexIndex(indexPath, 'UTC');
    const archive = path.join(root, 'archived_sessions');
    await mkdir(archive);
    await rename(filePath, path.join(archive, 'history.jsonl'));
    const archivedManifest = await scanCodexManifest(root, SALT);
    const archivedKey = archivedManifest.files[0].fileKey;
    const moved = await updateCodexIndex(resumed, archivedManifest, {
      salt: SALT, budget: { maxFilePasses: 0, maxBytes: CODEX_REFRESH_MIN_BYTES },
    });
    assert.notEqual(archivedKey, key);
    assert.equal(moved.index.files[archivedKey].hourProofMigration?.parserState.fileKey, archivedKey);
    assert.equal(moved.index.files[archivedKey].hourProofMigration?.offset,
      resumed.files[key].hourProofMigration?.offset);
    await saveCodexIndexAtomic(indexPath, moved.index);
    resumed = await loadCodexIndex(indexPath, 'UTC');
    assert.ok(resumed.files[archivedKey].hourProofMigration, 'archive move keeps the resumable proof');
    let iterations = 0;
    while (!codexHourProofSnapshot(resumed).complete && iterations++ < 20) {
      resumed = (await updateCodexIndex(resumed, archivedManifest, { salt: SALT, budget })).index;
    }
    const proof = codexHourProofSnapshot(resumed);
    assert.equal(proof.complete, true);
    assert.ok(proof.hours.length >= 12);
    await saveCodexIndexAtomic(indexPath, resumed);
    resumed = await loadCodexIndex(indexPath, 'UTC');
    assert.deepEqual(codexHourProofSnapshot(resumed), proof);
    const warm = await updateCodexIndex(resumed, archivedManifest, { salt: SALT });
    assert.equal(warm.bodyReads, 0);
    assert.equal(warm.indexChanged, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy hour proof advances even when another session appends on refresh', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-hour-progress-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    const older = path.join(sessions, 'older.jsonl');
    const active = path.join(sessions, 'active.jsonl');
    await writeFile(older, `${sessionLine('older-proof')}\n${contextLine()}\n` +
      `${tokenLine(1, 1, '2026-07-20T00:10:00.000Z')}\n`, 'utf8');
    await writeFile(active, `${sessionLine('active-proof')}\n${contextLine()}\n` +
      `${tokenLine(1, 1, '2026-07-20T01:10:00.000Z')}\n`, 'utf8');
    let manifest = await scanCodexManifest(root, SALT);
    const index = (await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { salt: SALT })).index;
    const olderKey = manifest.files.find((entry) => entry.absolutePath === older)!.fileKey;
    delete index.files[olderKey].hourProof;
    await appendFile(active, `${tokenLine(2, 2, '2026-07-20T02:10:00.000Z')}\n`);
    manifest = await scanCodexManifest(root, SALT);
    const updated = await updateCodexIndex(index, manifest, {
      salt: SALT, budget: { maxFilePasses: 2, maxBytes: CODEX_REFRESH_MIN_BYTES },
    });
    assert.equal(updated.index.files[olderKey].hourProof?.indexedThrough,
      updated.index.files[olderKey].offset,
    'a routine append must not indefinitely postpone an unrelated legacy proof');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('UTC output proof updates on append and drops removed or replaced files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-hour-change-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    const filePath = path.join(sessions, 'session.jsonl');
    await writeFile(filePath, `${sessionLine('proof-change')}\n${contextLine()}\n` +
      `${tokenLine(1, 1, '2026-07-20T00:10:00.000Z')}\n`, 'utf8');
    let manifest = await scanCodexManifest(root, SALT);
    let index = (await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, { salt: SALT })).index;
    assert.equal(codexHourProofSnapshot(index).complete, true);
    assert.equal(codexHourProofSnapshot(index).hours.length, 1);
    assert.deepEqual(codexHourProofSnapshot(index,
      Date.parse('2026-07-20T00:30:00.000Z')).hours, []);
    assert.equal(codexHourProofSnapshot(index,
      Date.parse('2026-07-20T01:00:00.000Z')).hours.length, 1);
    await appendFile(filePath, `${tokenLine(2, 2, '2026-07-20T01:10:00.000Z')}\n`);
    manifest = await scanCodexManifest(root, SALT);
    index = (await updateCodexIndex(index, manifest, { salt: SALT })).index;
    assert.equal(codexHourProofSnapshot(index).complete, true);
    assert.equal(codexHourProofSnapshot(index).hours.length, 2);
    await writeFile(filePath, `${sessionLine('proof-replacement')}\n${contextLine()}\n` +
      `${tokenLine(3, 3, '2026-07-21T04:10:00.000Z')}\n`, 'utf8');
    manifest = await scanCodexManifest(root, SALT);
    index = (await updateCodexIndex(index, manifest, { salt: SALT })).index;
    assert.deepEqual(codexHourProofSnapshot(index).hours,
      [Date.parse('2026-07-21T04:00:00.000Z') / 3_600_000]);
    await rm(filePath);
    manifest = await scanCodexManifest(root, SALT);
    index = (await updateCodexIndex(index, manifest, { salt: SALT })).index;
    assert.deepEqual(codexHourProofSnapshot(index).hours, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unknown or malformed persisted hour proof is discarded without leaking fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-hour-invalid-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(path.join(sessions, 'session.jsonl'),
      `${sessionLine('proof-invalid')}\n${contextLine()}\n` +
      `${tokenLine(1, 1, '2026-07-20T00:10:00.000Z')}\n`, 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const index = (await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest,
      { salt: SALT })).index;
    const key = manifest.files[0].fileKey;
    const indexPath = path.join(root, 'index.json');
    index.files[key].hourProof = { ...index.files[key].hourProof!, version: 99,
      path: 'must-not-persist' } as any;
    index.files[key].hourProofMigration = {
      version: 1, offset: index.files[key].offset, prefixEvents: 0,
      tokenEventsSeen: 0, discardingOversizedLine: false,
      parserState: index.files[key].parserState,
      hours: [2, 1], rawSessionId: 'must-not-persist',
    } as any;
    await saveCodexIndexAtomic(indexPath, index);
    const stored = await readFile(indexPath, 'utf8');
    assert.doesNotMatch(stored, /must-not-persist/);
    const loaded = await loadCodexIndex(indexPath, 'UTC');
    assert.equal(loaded.files[key].hourProof, undefined);
    assert.equal(loaded.files[key].hourProofMigration, undefined);
    assert.equal(codexHourProofSnapshot(loaded).complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancelled hour proof migration resumes from a durable safe cursor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-hour-cancel-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    const body = `${sessionLine('proof-cancel')}\n${contextLine()}\n` +
      `${tokenLine(1, 1, '2026-07-20T00:10:00.000Z')}\n`.repeat(3_000);
    await writeFile(path.join(sessions, 'session.jsonl'), body, 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const legacy = (await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest,
      { salt: SALT })).index;
    const key = manifest.files[0].fileKey;
    delete legacy.files[key].hourProof;
    const checkpointPath = path.join(root, 'checkpoint.json');
    let cancelled = false;
    await assert.rejects(updateCodexIndex(legacy, manifest, {
      salt: SALT,
      scheduling: { checkpointEveryBytes: 1 },
      shouldCancel: () => cancelled,
      onCheckpoint: async (index) => {
        if ((index.files[key].hourProofMigration?.offset ?? 0) > 0) {
          await saveCodexIndexAtomic(checkpointPath, index);
          cancelled = true;
        }
      },
    }), CodexIndexCancelledError);
    const saved = await loadCodexIndex(checkpointPath, 'UTC');
    assert.ok((saved.files[key].hourProofMigration?.offset ?? 0) > 0);
    assert.equal(codexHourProofSnapshot(saved).complete, false);
    const resumed = await updateCodexIndex(saved, manifest, { salt: SALT });
    assert.equal(codexHourProofSnapshot(resumed.index).complete, true);
    assert.ok(resumed.migration.bytesRead < body.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function sessionLine(id: string): string {
  return JSON.stringify({
    timestamp: '2026-07-20T00:00:00.000Z',
    type: 'session_meta',
    payload: {
      id,
      cwd: '/private/example-project',
      agent_nickname: 'Locke',
      git: {
        repository_url: 'https://github.com/example/ExampleProject.git',
      },
    },
  });
}

test('Codex tail-origin uses normal parser deltas after verified lineage, never cached or reasoning twice', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-tail-origin-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions);
    const log = path.join(sessions, 'usage.jsonl');
    await writeFile(log, `${sessionLine('tail-origin')}\n${contextLine('gpt-6.1-astra')}\n${tokenLine(500_000_000, 100_000_000, '2026-07-20T00:10:00Z')}\n`);
    const window = { after: Date.parse('2026-07-20T01:00:00Z'), through: Date.parse('2026-07-20T02:00:00Z') };
    const opts = { salt: SALT, now: () => window.through, achievementUsageWindow: window } as any;
    let baseline = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(root, SALT), opts);
    assert.equal((baseline as any).achievementUsageDelta, undefined, 'cold input is history');
    for (let i = 0; baseline.migration.pending && i < 6; i++) baseline = await updateCodexIndex(baseline.index, await scanCodexManifest(root, SALT), opts);
    assert.equal(baseline.index.coverage.complete, true);
    const warm = await updateCodexIndex(baseline.index, await scanCodexManifest(root, SALT), opts);
    assert.equal(warm.bodyReads, 0);
    await appendFile(log, `${tokenLine(5_500_000_000, 1_100_000_000, '2026-07-20T01:30:00Z')}\n`);
    const appended = await updateCodexIndex(baseline.index, await scanCodexManifest(root, SALT), opts);
    assert.deepEqual((appended as any).achievementUsageDelta, {
      provider: 'codex', ...window, processed: 6_000_000_000, output: 1_000_000_000,
      cacheRead: 2_500_000_000, families: { astra: 6_000_000_000, sol: 0, luna: 0 },
    });
    assert.equal(appended.index.aggregate.total.inputTotal + appended.index.aggregate.total.outputTotal, 6_600_000_000);
    assert.equal(JSON.stringify(appended.index).includes('achievementUsage'), false, 'proof is not a checkpoint field');
    assert.equal((await updateCodexIndex(appended.index, await scanCodexManifest(root, SALT), opts) as any).achievementUsageDelta, undefined, 'warm polls never replay proof');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Codex mixed historical import and fresh tail only certify the independent appended portion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-tail-mixed-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    const log = path.join(root, 'sessions', 'live.jsonl');
    await writeFile(log, `${sessionLine('live')}\n${contextLine('gpt-6.1-astra')}\n${tokenLine(100, 20, '2026-07-20T00:10:00Z')}\n`);
    const window = { after: Date.parse('2026-07-20T01:00:00Z'), through: Date.parse('2026-07-20T02:00:00Z') };
    const opts = { salt: SALT, now: () => window.through, achievementUsageWindow: window } as any;
    let baseline = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(root, SALT), opts);
    for (let i = 0; baseline.migration.pending && i < 6; i++) baseline = await updateCodexIndex(baseline.index, await scanCodexManifest(root, SALT), opts);
    await appendFile(log, `${tokenLine(200, 40, '2026-07-20T00:30:00Z')}\n${tokenLine(300, 60, '2026-07-20T01:30:00Z')}\n`);
    await writeFile(path.join(root, 'sessions', 'import.jsonl'), `${sessionLine('import')}\n${contextLine('gpt-6.1-astra')}\n${tokenLine(9_000_000_000, 0, '2026-07-20T01:30:00Z')}\n`);
    const result = await updateCodexIndex(baseline.index, await scanCodexManifest(root, SALT), opts);
    assert.equal((result as any).achievementUsageDelta?.processed, 120);
    assert.equal((result as any).achievementUsageDelta?.families.astra, 120);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const scenario of ['old-event', 'future-event', 'replay', 'replacement', 'incomplete-baseline',
  'timezone', 'invalid-window', 'regression', 'identity-conflict', 'partial-tail'] as const) {
  test(`Codex usage origin withholds ${scenario} without resetting usage semantics`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-origin-guard-'));
    try {
      await mkdir(path.join(root, 'sessions'));
      const log = path.join(root, 'sessions', 'live.jsonl');
      const header = `${sessionLine('guard')}\n${contextLine('gpt-6.1-astra')}\n`;
      const original = `${tokenLine(100, 20, '2026-07-20T00:10:00Z')}\n`;
      await writeFile(log, header + original);
      const window = { after: Date.parse('2026-07-20T01:00:00Z'), through: Date.parse('2026-07-20T02:00:00Z') };
      const opts: any = { salt: SALT, now: () => window.through, achievementUsageWindow: window };
      let baseline = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(root, SALT), opts);
      for (let i = 0; baseline.migration.pending && i < 6; i++) baseline = await updateCodexIndex(baseline.index, await scanCodexManifest(root, SALT), opts);
      const before = structuredClone(baseline.index);
      const key = Object.keys(before.files)[0];
      if (scenario === 'replacement') {
        await rename(log, path.join(root, 'old.outside-allowlist'));
        await writeFile(log, header + original);
      }
      if (scenario === 'incomplete-baseline') before.files[key].offset -= 1;
      if (scenario === 'timezone') opts.timeZone = 'Asia/Shanghai';
      if (scenario === 'invalid-window') opts.achievementUsageWindow = { after: window.through, through: window.after };
      if (scenario === 'identity-conflict') await writeFile(path.join(root, 'sessions', 'conflict.jsonl'), header + `${tokenLine(900, 90, '2026-07-20T00:30:00Z')}\n`);
      const timestamp = scenario === 'old-event' ? '2026-07-20T00:30:00Z'
        : scenario === 'future-event' ? '2026-07-20T03:00:00Z' : '2026-07-20T01:30:00Z';
      const tail = scenario === 'replay' ? original
        : `${tokenLine(scenario === 'regression' ? 10 : 200, scenario === 'regression' ? 2 : 40, timestamp)}${scenario === 'partial-tail' ? '' : '\n'}`;
      await appendFile(log, scenario === 'partial-tail' ? tail.slice(0, -10) : tail);
      const result = await updateCodexIndex(before, await scanCodexManifest(root, SALT), opts);
      assert.equal((result as any).achievementUsageDelta, undefined, scenario);
      assert.equal(JSON.stringify(result.index).includes('achievementUsage'), false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test('real file-pass workers retain sound new Astra tokens beside an unrelated ambiguous session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-origin-pool-'));
  const pool = new CodexFilePassPool();
  try {
    await mkdir(path.join(root, 'sessions'));
    const window = { after: Date.parse('2026-07-20T01:00:00Z'), through: Date.parse('2026-07-20T02:00:00Z') };
    for (const [name, id, input, output] of [['sound', 'sound', 500_000_000, 100_000_000], ['other', 'other', 100, 0],
      ['conflict-one', 'conflict', 20, 0], ['conflict-two', 'conflict', 30, 0]] as const) {
      await writeFile(path.join(root, 'sessions', `${name}.jsonl`), `${sessionLine(id)}\n${contextLine('gpt-6.1-astra')}\n${tokenLine(input, output, '2026-07-20T00:10:00Z')}\n`);
    }
    const opts: any = { salt: SALT, now: () => window.through, achievementUsageWindow: window };
    let baseline = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(root, SALT), opts);
    for (let i = 0; baseline.migration.pending && i < 6; i++) baseline = await updateCodexIndex(baseline.index, await scanCodexManifest(root, SALT), opts);
    assert.equal(baseline.index.coverage.identity.complete, false);
    await appendFile(path.join(root, 'sessions', 'sound.jsonl'), `${tokenLine(5_500_000_000, 1_100_000_000, '2026-07-20T01:30:00Z')}\n`);
    await appendFile(path.join(root, 'sessions', 'conflict-one.jsonl'), `${tokenLine(9_000_000_000, 0, '2026-07-20T01:30:00Z')}\n`);
    const result = await updateCodexIndex(baseline.index, await scanCodexManifest(root, SALT), { ...opts, filePassBatch: pool.run });
    assert.equal((result as any).achievementUsageDelta?.processed, 6_000_000_000);
    assert.equal((result as any).achievementUsageDelta?.families.astra, 6_000_000_000);
  } finally { await pool.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('Codex copied child history and unsettled lineage cannot masquerade as live tail origin', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-origin-fork-'));
  try {
    await mkdir(path.join(root, 'sessions'));
    const window = { after: Date.parse('2026-07-20T01:00:00Z'), through: Date.parse('2026-07-20T02:00:00Z') };
    const opts: any = { salt: SALT, now: () => window.through, achievementUsageWindow: window };
    const parentLog = path.join(root, 'sessions', 'parent.jsonl');
    await writeFile(parentLog, `${sessionLine('parent')}\n${contextLine('gpt-6.1-astra')}\n${tokenLine(100, 20, '2026-07-20T00:10:00Z')}\n`);
    let baseline = await updateCodexIndex(createEmptyCodexIndex('UTC'), await scanCodexManifest(root, SALT), opts);
    for (let i = 0; baseline.migration.pending && i < 6; i++) baseline = await updateCodexIndex(baseline.index, await scanCodexManifest(root, SALT), opts);
    const copied = `${tokenLine(200, 40, '2026-07-20T01:30:00Z')}\n`;
    await writeFile(path.join(root, 'sessions', 'child.jsonl'), `${childSessionLine('child', 'parent')}\n${contextLine('gpt-6.1-astra')}\n${copied}`);
    const imported = await updateCodexIndex(baseline.index, await scanCodexManifest(root, SALT), opts);
    assert.equal((imported as any).achievementUsageDelta, undefined);
    const unsettled = structuredClone(baseline.index);
    const row = Object.values(unsettled.files)[0];
    row.lineage!.desiredPrefixEvents = 1;
    await appendFile(parentLog, copied);
    const result = await updateCodexIndex(unsettled, await scanCodexManifest(root, SALT), opts);
    assert.equal((result as any).achievementUsageDelta, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function childSessionLine(id: string, parentId: string): string {
  return JSON.stringify({
    timestamp: '2026-07-20T00:00:00.000Z',
    type: 'session_meta',
    payload: {
      id,
      cwd: '/private/example-project',
      source: {
        subagent: {
          thread_spawn: { parent_thread_id: parentId },
        },
      },
    },
  });
}

function contextLine(model = 'gpt-5.6-sol', effort = 'high'): string {
  return JSON.stringify({
    timestamp: '2026-07-20T00:00:01.000Z',
    type: 'turn_context',
    payload: { model, effort },
  });
}

function tokenLine(input: number, output: number, timestamp: string): string {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: Math.floor(input / 2),
          output_tokens: output,
          reasoning_output_tokens: Math.floor(output / 2),
          total_tokens: input + output,
        },
      },
    },
  });
}

function tokenLineWithWeeklyLimit(
  input: number,
  output: number,
  timestamp: string,
  resetAt: string,
  usedPercent: number,
): string {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: Math.floor(input / 2),
          output_tokens: output,
          reasoning_output_tokens: Math.floor(output / 2),
          total_tokens: input + output,
        },
      },
      rate_limits: {
        limit_id: 'codex',
        secondary: {
          used_percent: usedPercent,
          window_minutes: 7 * 24 * 60,
          resets_at: resetAt,
        },
      },
    },
  });
}

function structuralLine(
  timestamp: string,
  type: 'event_msg' | 'response_item',
  payload: Record<string, string>,
): string {
  return JSON.stringify({ timestamp, type, payload });
}

function completeSession(id: string, input: number, output: number): string {
  return [
    sessionLine(id),
    contextLine(),
    tokenLine(input, output, '2026-07-20T00:01:00.000Z'),
    '',
  ].join('\n');
}

interface TrackingIo extends CodexIndexIo {
  bodyReads: Map<string, number>;
  readOffsets: number[];
  fileKeysRead: string[];
}

function trackingIo(): TrackingIo {
  const bodyReads = new Map<string, number>();
  const readOffsets: number[] = [];
  const fileKeysRead: string[] = [];
  return {
    bodyReads,
    readOffsets,
    fileKeysRead,
    async *read(entry, start, endExclusive) {
      bodyReads.set(entry.fileKey, (bodyReads.get(entry.fileKey) ?? 0) + 1);
      readOffsets.push(start);
      fileKeysRead.push(entry.fileKey);
      const body = await readFile(entry.absolutePath);
      yield body.subarray(start, endExclusive);
    },
  };
}

function chunkingIo(chunkBytes: number): CodexIndexIo {
  return {
    async *read(entry, start, endExclusive) {
      const body = await readFile(entry.absolutePath);
      for (let offset = start; offset < endExclusive; offset += chunkBytes) {
        yield body.subarray(offset, Math.min(offset + chunkBytes, endExclusive));
      }
    },
  };
}

test('weekly quota history retains separate resets after the source file is removed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-quota-history-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'quota-history.jsonl'),
      [
        sessionLine('quota-history'),
        contextLine(),
        tokenLineWithWeeklyLimit(
          100,
          20,
          '2026-08-28T08:00:00.000Z',
          '2026-08-28T11:00:00.000Z',
          18,
        ),
        tokenLineWithWeeklyLimit(
          200,
          40,
          '2026-08-30T04:00:00.000Z',
          '2026-08-30T07:00:00.000Z',
          42,
        ),
        '',
      ].join('\n'),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const now = Date.parse('2026-08-31T12:00:00.000Z');
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
    });

    assert.deepEqual(
      cold.index.quotaHistory?.map(({ resetAt, usedPercent }) => ({ resetAt, usedPercent })),
      [
        { resetAt: Date.parse('2026-08-28T11:00:00.000Z'), usedPercent: 18 },
        { resetAt: Date.parse('2026-08-30T07:00:00.000Z'), usedPercent: 42 },
      ],
    );

    await saveCodexIndexAtomic(indexPath, {
      ...cold.index,
      quotaHistory: cold.index.quotaHistory?.map((observation) => ({
        ...observation,
        account: 'must-not-persist',
      })) as any,
    });
    const reloaded = await loadCodexIndex(indexPath, 'UTC');
    assert.deepEqual(
      reloaded.quotaHistory?.map(({ resetAt, usedPercent }) => ({ resetAt, usedPercent })),
      [
        { resetAt: Date.parse('2026-08-28T11:00:00.000Z'), usedPercent: 18 },
        { resetAt: Date.parse('2026-08-30T07:00:00.000Z'), usedPercent: 42 },
      ],
    );
    assert.doesNotMatch(await readFile(indexPath, 'utf8'), /must-not-persist/);

    const removed = await updateCodexIndex(
      reloaded,
      persistableManifest([]),
      { salt: SALT, timeZone: 'UTC', now: () => now },
    );
    assert.equal(removed.bodyReads, 0);
    assert.deepEqual(
      removed.index.quotaHistory?.map(({ resetAt, usedPercent }) => ({ resetAt, usedPercent })),
      [
        { resetAt: Date.parse('2026-08-28T11:00:00.000Z'), usedPercent: 18 },
        { resetAt: Date.parse('2026-08-30T07:00:00.000Z'), usedPercent: 42 },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy indexed quota projections seed reset history once without rereading bodies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-quota-seed-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'quota-seed.jsonl'),
      [
        sessionLine('quota-seed'),
        contextLine(),
        tokenLineWithWeeklyLimit(
          100,
          20,
          '2026-08-30T04:00:00.000Z',
          '2026-08-30T07:00:00.000Z',
          42,
        ),
        '',
      ].join('\n'),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const now = Date.parse('2026-08-31T12:00:00.000Z');
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
    });
    const legacy = structuredClone(cold.index);
    delete legacy.quotaHistory;
    for (const contribution of Object.values(legacy.files)) {
      // Model an older complete schema-3 index: it has the last observed
      // limit projection, but predates the neutral reset-history cache.
      delete contribution.quotaHistory;
    }

    const io = trackingIo();
    const seeded = await updateCodexIndex(legacy, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
      io,
    });

    assert.equal(seeded.bodyReads, 0);
    assert.equal(io.bodyReads.size, 0);
    assert.deepEqual(
      seeded.index.quotaHistory?.map(({ resetAt, usedPercent }) => ({ resetAt, usedPercent })),
      [{ resetAt: Date.parse('2026-08-30T07:00:00.000Z'), usedPercent: 42 }],
    );
    assert.equal(seeded.indexChanged, true);

    const warmIo = trackingIo();
    const warm = await updateCodexIndex(seeded.index, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
      io: warmIo,
    });
    assert.equal(warm.indexChanged, false);
    assert.equal(warm.bodyReads, 0);
    assert.equal(warmIo.bodyReads.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fully indexed unchanged corpus returns a warm no-op without body reads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-noop-'));
  try {
    const refreshNow = Date.parse('2026-07-22T12:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'unchanged.jsonl'),
      completeSession('unchanged', 100, 20),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => refreshNow,
    });
    const io = trackingIo();
    let checkpoints = 0;

    const warm = await updateCodexIndex(cold.index, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => refreshNow,
      io,
      onCheckpoint: async () => { checkpoints += 1; },
    });

    assert.equal(warm.indexChanged, false);
    assert.strictEqual(warm.index, cold.index);
    assert.equal(warm.bodyReads, 0);
    assert.equal(warm.failedFiles, 0);
    assert.equal(warm.migration.pending, false);
    assert.equal(io.bodyReads.size, 0);
    assert.equal(checkpoints, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cold and append scans maintain a sparse exact current-day hourly sidecar', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-today-'));
  try {
    const now = Date.parse('2026-07-21T04:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    const logPath = path.join(sessions, 'today.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(logPath, [
      sessionLine('today'),
      contextLine(),
      tokenLine(100, 20, '2026-07-20T16:05:00.000Z'),
      '',
    ].join('\n'), 'utf8');
    const firstManifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('Asia/Hong_Kong'), firstManifest, {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      now: () => now,
    });
    const key = firstManifest.files[0].fileKey;
    const coldOffset = cold.index.files[key].offset;

    assert.equal(cold.index.schemaVersion, 3);
    assert.equal(cold.index.files[key].aggregate.today?.day, '2026-07-21');
    assert.equal(cold.index.files[key].aggregate.today?.timeZone, 'Asia/Hong_Kong');
    assert.equal(cold.index.files[key].aggregate.today?.indexedThrough, coldOffset);
    assert.equal(cold.index.files[key].aggregate.today?.hours['00'].total.inputTotal, 100);
    assert.equal(cold.index.files[key].aggregate.today?.hours['00'].byModel['gpt-5.6-sol'].outputTotal, 20);
    assert.equal(cold.index.coverage.today.complete, true);

    await appendFile(
      logPath,
      `${tokenLine(150, 30, '2026-07-20T18:10:00.000Z')}\n`,
      'utf8',
    );
    const io = trackingIo();
    const warm = await updateCodexIndex(cold.index, await scanCodexManifest(root, SALT), {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      now: () => now,
      io,
    });

    assert.deepEqual(io.readOffsets, [coldOffset]);
    assert.equal(warm.index.files[key].aggregate.today?.hours['00'].total.inputTotal, 100);
    assert.equal(warm.index.files[key].aggregate.today?.hours['02'].total.inputTotal, 50);
    assert.equal(warm.index.files[key].aggregate.today?.indexedThrough, warm.index.files[key].offset);
    assert.equal(warm.index.coverage.today.complete, true);

    const indexPath = path.join(root, 'cache', 'codex-index.json');
    const caller = structuredClone(warm.index) as any;
    caller.files[key].aggregate.today.rawPath = 'today-secret-path';
    caller.files[key].aggregate.today.hours['02'].total.promptBody = 'today-secret-total';
    caller.files[key].aggregate.today.hours['02'].byModel['gpt-5.6-sol'].commandBody =
      'today-secret-model';
    caller.files[key].aggregate.today.hours['02'].byEffort = {
      ultra: { inputTotal: 999, rawResponse: 'today-secret-effort' },
    };
    caller.files[key].aggregate.today.hours.notAnHour = {
      total: { inputTotal: 999, rawResponse: 'today-secret-hour' },
      byModel: {},
    };
    caller.files[key].aggregate.today.days['2026-07-21']['02'].total.promptBody =
      'rolling-secret-total';
    caller.files[key].aggregate.today.days.notADay = {
      '02': {
        total: { inputTotal: 999, rawResponse: 'rolling-secret-day' },
        byModel: {},
      },
    };
    await saveCodexIndexAtomic(indexPath, caller);
    const persisted = await readFile(indexPath, 'utf8');
    assert.doesNotMatch(persisted, /today-secret|rolling-secret/);
    const reloaded = await loadCodexIndex(indexPath, 'Asia/Hong_Kong');
    assert.equal(reloaded.files[key].aggregate.today?.day, '2026-07-21');
    assert.equal(reloaded.files[key].aggregate.today?.windowDays, 30);
    assert.deepEqual(Object.keys(reloaded.files[key].aggregate.today!.hours), ['00', '02']);
    assert.deepEqual(
      Object.keys(reloaded.files[key].aggregate.today?.days ?? {}),
      ['2026-07-21'],
    );
    assert.equal(reloaded.files[key].aggregate.today?.hours['02'].total.inputTotal, 50);
    assert.equal((reloaded.files[key].aggregate.today?.hours['02'] as any).byEffort, undefined);
    const reloadIo = trackingIo();
    const warmReload = await updateCodexIndex(reloaded, await scanCodexManifest(root, SALT), {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      now: () => now,
      io: reloadIo,
    });
    assert.equal(warmReload.bodyReads, 0);
    assert.equal(reloadIo.bodyReads.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rolling hourly sidecar keeps 30 configured-zone days and evicts day 31 without rereading JSONL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-rolling-hours-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'rolling-hours.jsonl'),
      [
        tokenLine(100, 20, '2026-06-30T08:05:00.000Z'),
        tokenLine(200, 40, '2026-07-01T09:05:00.000Z'),
        tokenLine(300, 60, '2026-07-15T10:05:00.000Z'),
        tokenLine(400, 80, '2026-07-30T11:05:00.000Z'),
        '',
      ].join('\n'),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const first = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => Date.parse('2026-07-30T12:00:00.000Z'),
    });
    const key = manifest.files[0].fileKey;
    const sidecar = first.index.files[key].aggregate.today!;

    assert.equal(sidecar.windowDays, 30);
    assert.deepEqual(Object.keys(sidecar.days ?? {}).sort(), [
      '2026-07-01',
      '2026-07-15',
      '2026-07-30',
    ]);
    assert.equal(sidecar.days?.['2026-07-01']['09'].total.inputTotal, 100);
    assert.equal(sidecar.days?.['2026-07-30']['11'].total.outputTotal, 20);
    assert.equal(sidecar.days?.['2026-06-30'], undefined);
    assert.equal(first.index.coverage.hourly?.complete, true);

    const io = trackingIo();
    const rolled = await updateCodexIndex(first.index, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => Date.parse('2026-07-31T12:00:00.000Z'),
      io,
    });
    const rolledSidecar = rolled.index.files[key].aggregate.today!;

    assert.equal(rolled.bodyReads, 0);
    assert.equal(io.bodyReads.size, 0);
    assert.equal(rolledSidecar.day, '2026-07-31');
    assert.deepEqual(Object.keys(rolledSidecar.days ?? {}).sort(), [
      '2026-07-15',
      '2026-07-30',
    ]);
    assert.deepEqual(rolledSidecar.hours, {});
    assert.equal(rolled.index.coverage.hourly?.asOfDay, '2026-07-31');
    assert.equal(rolled.index.coverage.hourly?.complete, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy one-day schema-3 sidecars receive one targeted rolling migration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-rolling-legacy-'));
  try {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'legacy-hours.jsonl'),
      [
        tokenLine(100, 20, '2026-07-05T08:00:00.000Z'),
        tokenLine(200, 40, '2026-07-20T09:00:00.000Z'),
        '',
      ].join('\n'),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const current = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
    });
    const key = manifest.files[0].fileKey;
    const legacy = structuredClone(current.index) as any;
    const modern = legacy.files[key].aggregate.today;
    legacy.files[key].aggregate.today = {
      day: modern.day,
      timeZone: modern.timeZone,
      indexedThrough: modern.indexedThrough,
      hours: modern.hours,
    };
    delete legacy.coverage.hourly;
    const io = trackingIo();

    const migrated = await updateCodexIndex(legacy, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
      io,
    });

    assert.deepEqual(io.fileKeysRead, [key]);
    assert.equal(migrated.index.files[key].aggregate.today?.windowDays, 30);
    assert.deepEqual(
      Object.keys(migrated.index.files[key].aggregate.today?.days ?? {}).sort(),
      ['2026-07-05', '2026-07-20'],
    );
    assert.equal(migrated.index.coverage.hourly?.complete, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an old schema-3 index targets canonical files that intersect the rolling hour window', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-today-targeted-'));
  try {
    const today = Date.parse('2026-07-21T04:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    const archive = path.join(root, 'archived_sessions');
    await mkdir(sessions, { recursive: true });
    await mkdir(archive, { recursive: true });
    const todayBody = [
      sessionLine('shared-today'),
      tokenLine(100, 20, '2026-07-20T18:05:00.000Z'),
      '',
    ].join('\n');
    await writeFile(path.join(sessions, 'today.jsonl'), todayBody, 'utf8');
    await writeFile(path.join(archive, 'today-copy.jsonl'), todayBody, 'utf8');
    await writeFile(
      path.join(sessions, 'old.jsonl'),
      `${tokenLine(300, 60, '2026-07-19T18:05:00.000Z')}\n`,
      'utf8',
    );
    await writeFile(
      path.join(sessions, 'outside-window.jsonl'),
      `${tokenLine(400, 80, '2026-06-01T18:05:00.000Z')}\n`,
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('Asia/Hong_Kong'), manifest, {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      now: () => today,
    });
    const oldIndex = structuredClone(cold.index);
    for (const file of Object.values(oldIndex.files)) {
      delete file.aggregate.today;
    }
    delete (oldIndex.coverage as any).today;
    const io = trackingIo();

    const rebuilt = await updateCodexIndex(oldIndex, manifest, {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      now: () => today,
      io,
    });
    const todayKeys = manifest.files.filter((entry) =>
      cold.index.files[entry.fileKey].aggregate.period?.days['2026-07-21']
    ).map((entry) => entry.fileKey);
    const todayKey = todayKeys.find((key) => io.bodyReads.has(key))!;
    const recentKey = manifest.files.find((entry) =>
      cold.index.files[entry.fileKey].aggregate.period?.days['2026-07-20']
    )!.fileKey;
    const outsideKey = manifest.files.find((entry) =>
      cold.index.files[entry.fileKey].aggregate.period?.days['2026-06-02']
    )!.fileKey;

    assert.equal(rebuilt.index.schemaVersion, 3);
    assert.deepEqual(new Set(io.fileKeysRead), new Set([todayKey, recentKey]));
    assert.equal(todayKeys.length, 2);
    assert.equal(todayKeys.filter((key) => io.bodyReads.has(key)).length, 1);
    assert.equal(io.bodyReads.has(recentKey), true);
    assert.equal(io.bodyReads.has(outsideKey), false);
    assert.equal(rebuilt.index.files[todayKey].aggregate.today?.hours['02'].total.inputTotal, 100);
    assert.equal(
      rebuilt.index.files[recentKey].aggregate.today?.days?.['2026-07-20']['02']
        .total.inputTotal,
      300,
    );
    assert.equal(rebuilt.index.coverage.hourly?.indexedFiles, 2);
    assert.equal(rebuilt.index.coverage.hourly?.totalFiles, 2);
    assert.equal(rebuilt.index.coverage.hourly?.complete, true);
    assert.deepEqual(rebuilt.index.coverage.today, {
      timeZone: 'Asia/Hong_Kong',
      day: '2026-07-21',
      indexedFiles: 1,
      totalFiles: 1,
      indexedBytes: manifest.files.find((entry) => entry.fileKey === todayKey)!.size,
      totalBytes: manifest.files.find((entry) => entry.fileKey === todayKey)!.size,
      complete: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('targeted today backfill excludes the verified copied lineage prefix', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-today-lineage-'));
  try {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    const copied = tokenLine(100, 20, '2026-07-20T01:00:00.000Z');
    await writeFile(
      path.join(sessions, 'parent.jsonl'),
      [sessionLine('parent-hourly'), contextLine(), copied, ''].join('\n'),
      'utf8',
    );
    await writeFile(
      path.join(sessions, 'child.jsonl'),
      [
        childSessionLine('child-hourly', 'parent-hourly'),
        contextLine(),
        copied,
        tokenLine(150, 30, '2026-07-20T02:00:00.000Z'),
        '',
      ].join('\n'),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
    });
    const child = Object.values(cold.index.files).find(
      (file) => file.aggregate.session.role === 'subagent',
    )!;

    assert.equal(child.lineage?.desiredPrefixEvents, 1);
    assert.equal(child.lineage?.appliedPrefixEvents, 1);
    assert.equal(child.aggregate.today?.hours['02'].total.inputTotal, 50);
    const oldIndex = structuredClone(cold.index);
    for (const file of Object.values(oldIndex.files)) {
      delete file.aggregate.today;
    }
    oldIndex.coverage.today.complete = false;
    oldIndex.coverage.today.indexedFiles = 0;
    oldIndex.coverage.today.indexedBytes = 0;

    const rebuilt = await updateCodexIndex(oldIndex, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
    });
    const rebuiltChild = Object.values(rebuilt.index.files).find(
      (file) => file.aggregate.session.role === 'subagent',
    )!;

    assert.equal(rebuiltChild.aggregate.today?.hours['01'], undefined);
    assert.equal(rebuiltChild.aggregate.today?.hours['02'].total.inputTotal, 50);
    assert.equal(rebuiltChild.aggregate.today?.hours['02'].total.outputTotal, 10);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancelled today backfill checkpoints and resumes from its safe cursor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-today-resume-'));
  try {
    const now = Date.parse('2026-07-20T12:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    const lines = Array.from({ length: 6_000 }, (_, index) =>
      tokenLine(
        index + 1,
        Math.floor(index / 10) + 1,
        `2026-07-20T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
      )
    );
    await writeFile(
      path.join(sessions, 'large-today.jsonl'),
      `${lines.join('\n')}\n`,
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
    });
    const key = manifest.files[0].fileKey;
    const oldIndex = structuredClone(cold.index);
    delete oldIndex.files[key].aggregate.today;
    oldIndex.coverage.today.complete = false;
    oldIndex.coverage.today.indexedFiles = 0;
    oldIndex.coverage.today.indexedBytes = 0;
    let cancelled = false;
    let saved: typeof oldIndex | undefined;

    await assert.rejects(
      updateCodexIndex(oldIndex, manifest, {
        salt: SALT,
        timeZone: 'UTC',
        now: () => now,
        io: chunkingIo(64 * 1024),
        budget: { maxFilePasses: 1, maxBytes: CODEX_REFRESH_MIN_BYTES },
        scheduling: {
          progressEveryMs: Number.POSITIVE_INFINITY,
          progressEveryBytes: Number.POSITIVE_INFINITY,
          checkpointEveryMs: Number.POSITIVE_INFINITY,
          checkpointEveryBytes: 1,
          checkpointEveryFilePasses: 64,
          now: () => 0,
        },
        shouldCancel: () => cancelled,
        onCheckpoint: async (index) => {
          saved = structuredClone(index);
          cancelled = true;
        },
      }),
      CodexIndexCancelledError,
    );

    assert.ok(saved?.files[key].todayMigration);
    const safeOffset = saved!.files[key].todayMigration!.offset;
    assert.ok(safeOffset > 0);
    assert.ok(safeOffset < saved!.files[key].offset);
    const io = trackingIo();
    const resumed = await updateCodexIndex(saved!, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
      io,
      budget: {
        maxFilePasses: 1,
        maxBytes: 16 * 1024 * 1024,
      },
    });

    assert.deepEqual(io.readOffsets, [safeOffset]);
    assert.equal(resumed.index.files[key].todayMigration, undefined);
    assert.equal(resumed.index.coverage.today.complete, true);
    assert.deepEqual(
      resumed.index.files[key].aggregate.today?.hours,
      cold.index.files[key].aggregate.today?.hours,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('civil-day rollover replaces rather than accumulates the persisted hourly sidecar', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-today-rollover-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'rollover.jsonl'),
      [
        tokenLine(100, 20, '2026-07-20T16:05:00.000Z'),
        tokenLine(150, 30, '2026-07-21T16:10:00.000Z'),
        '',
      ].join('\n'),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const first = await updateCodexIndex(
      createEmptyCodexIndex('Asia/Hong_Kong'),
      manifest,
      {
        salt: SALT,
        timeZone: 'Asia/Hong_Kong',
        now: () => Date.parse('2026-07-21T04:00:00.000Z'),
      },
    );
    const key = manifest.files[0].fileKey;
    const io = trackingIo();
    const next = await updateCodexIndex(first.index, manifest, {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      now: () => Date.parse('2026-07-22T04:00:00.000Z'),
      io,
    });

    assert.equal(next.index.files[key].aggregate.today?.day, '2026-07-22');
    assert.equal(next.index.files[key].aggregate.today?.hours['00'].total.inputTotal, 50);
    assert.equal(next.index.files[key].aggregate.today?.hours['00'].total.outputTotal, 10);
    assert.equal(next.index.coverage.today.complete, true);
    assert.deepEqual(io.fileKeysRead, [key]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('timezone changes rebuild the current civil day and then stay warm without body reads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-today-zone-'));
  try {
    const now = Date.parse('2026-07-20T20:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'timezone.jsonl'),
      [
        tokenLine(100, 20, '2026-07-20T15:55:00.000Z'),
        tokenLine(150, 30, '2026-07-20T16:05:00.000Z'),
        '',
      ].join('\n'),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const utc = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => now,
    });
    const key = manifest.files[0].fileKey;

    assert.equal(utc.index.files[key].aggregate.today?.day, '2026-07-20');
    assert.equal(utc.index.files[key].aggregate.today?.hours['15'].total.inputTotal, 100);
    assert.equal(utc.index.files[key].aggregate.today?.hours['16'].total.inputTotal, 50);

    const zoneIo = trackingIo();
    const hongKong = await updateCodexIndex(utc.index, manifest, {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      now: () => now,
      io: zoneIo,
    });
    assert.equal(hongKong.index.files[key].aggregate.today?.day, '2026-07-21');
    assert.equal(hongKong.index.files[key].aggregate.today?.timeZone, 'Asia/Hong_Kong');
    assert.equal(hongKong.index.files[key].aggregate.today?.hours['00'].total.inputTotal, 50);
    assert.equal(hongKong.index.files[key].aggregate.today?.hours['15'], undefined);
    assert.equal(
      hongKong.index.files[key].aggregate.today?.days?.['2026-07-20']['23']
        .total.inputTotal,
      100,
    );
    assert.equal(
      hongKong.index.files[key].aggregate.today?.days?.['2026-07-21']['00']
        .total.inputTotal,
      50,
    );
    assert.equal(hongKong.index.coverage.today.complete, true);

    const warmIo = trackingIo();
    const warm = await updateCodexIndex(hongKong.index, manifest, {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      now: () => now,
      io: warmIo,
    });
    assert.equal(warm.indexChanged, false);
    assert.equal(warm.bodyReads, 0);
    assert.equal(warmIo.bodyReads.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a small warm append is durably checkpointed only once', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-warm-checkpoint-'));
  try {
    const refreshNow = Date.parse('2026-07-22T12:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    const logPath = path.join(sessions, 'append.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(logPath, completeSession('warm-append', 100, 20), 'utf8');
    const coldManifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), coldManifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => refreshNow,
    });
    await appendFile(
      logPath,
      `${tokenLine(150, 30, '2026-07-22T12:01:00.000Z')}\n`,
      'utf8',
    );
    const warmManifest = await scanCodexManifest(root, SALT);
    let checkpoints = 0;

    const warm = await updateCodexIndex(cold.index, warmManifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => refreshNow,
      scheduling: {
        progressEveryMs: Number.POSITIVE_INFINITY,
        progressEveryBytes: Number.POSITIVE_INFINITY,
        checkpointEveryMs: Number.POSITIVE_INFINITY,
        checkpointEveryBytes: Number.POSITIVE_INFINITY,
        checkpointEveryFilePasses: 64,
        now: () => 0,
      },
      onCheckpoint: async () => { checkpoints += 1; },
    });

    assert.equal(warm.bodyReads, 1);
    assert.equal(warm.failedFiles, 0);
    assert.equal(checkpoints, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('large cold rebuilds throttle progress and batch durable checkpoints without changing totals', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-batched-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    const lines = Array.from(
      { length: 14_000 },
      (_, index) => tokenLine(
        index + 1,
        1,
        `2026-07-20T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
      ),
    );
    await writeFile(
      path.join(sessions, 'large.jsonl'),
      `${sessionLine('large-batched')}\n${contextLine()}\n${lines.join('\n')}\n`,
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const reference = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      io: chunkingIo(64 * 1024),
      budget: { maxFilePasses: 16, maxBytes: 64 * 1024 * 1024 },
    });
    let progressCalls = 0;
    let checkpoints = 0;

    const batched = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      io: chunkingIo(64 * 1024),
      budget: { maxFilePasses: 16, maxBytes: 64 * 1024 * 1024 },
      scheduling: {
        progressEveryBytes: 512 * 1024,
        checkpointEveryBytes: 2 * 1024 * 1024,
        checkpointEveryFilePasses: 64,
        progressEveryMs: Number.POSITIVE_INFINITY,
        checkpointEveryMs: Number.POSITIVE_INFINITY,
        now: () => 0,
      },
      onProgress: () => { progressCalls += 1; },
      onCheckpoint: async () => { checkpoints += 1; },
    });

    assert.deepEqual(batched.index.aggregate, reference.index.aggregate);
    assert.deepEqual(batched.index.coverage, reference.index.coverage);
    assert.ok(progressCalls > 0);
    assert.ok(progressCalls < 40, `expected throttled progress, saw ${progressCalls}`);
    assert.ok(checkpoints > 0);
    assert.ok(checkpoints < 16, `expected batched checkpoints, saw ${checkpoints}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parallel file passes preserve the exact sequential index across every backfill stage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-parallel-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    for (let index = 0; index < 12; index += 1) {
      const id = `parallel-${index}`;
      const metadata = index > 0 && index % 3 === 0
        ? childSessionLine(id, `parallel-${index - 1}`)
        : sessionLine(id);
      await writeFile(
        path.join(sessions, `${String(index).padStart(2, '0')}.jsonl`),
        [
          metadata,
          contextLine(index % 2 === 0 ? 'gpt-5.6-sol' : 'gpt-5.6-terra'),
          tokenLine(100 + index, 10 + index, '2026-07-20T00:01:00.000Z'),
          tokenLine(150 + index, 15 + index, '2026-07-20T00:02:00.000Z'),
          '',
        ].join('\n'),
        'utf8',
      );
    }
    const manifest = await scanCodexManifest(root, SALT);
    const sequential = await updateCodexIndex(
      createEmptyCodexIndex('UTC'),
      manifest,
      {
        salt: SALT,
        budget: { maxFilePasses: 256, maxBytes: 64 * 1024 * 1024 },
      },
    );
    const batchSizes: number[] = [];
    const pool = new CodexFilePassPool(3);
    const runner: CodexFilePassBatchRunner = async (tasks, ...rest) => {
      batchSizes.push(tasks.length);
      await pool.run(tasks, ...rest);
    };
    let parallel;
    try {
      parallel = await updateCodexIndex(
        createEmptyCodexIndex('UTC'),
        manifest,
        {
          salt: SALT,
          budget: { maxFilePasses: 256, maxBytes: 64 * 1024 * 1024 },
          filePassBatch: runner,
        },
      );
    } finally {
      await pool.dispose();
    }

    assert.ok(batchSizes.some((size) => size > 1), JSON.stringify(batchSizes));
    assert.deepEqual(parallel.index, sequential.index);
    assert.deepEqual(parallel.migration, sequential.migration);
    assert.equal(parallel.failedFiles, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('file-pass pool disposal waits for workers removed by a failed batch to terminate', async () => {
  let finishTerminate!: (code: number) => void;
  const termination = new Promise<number>((resolve) => {
    finishTerminate = resolve;
  });
  let terminateCalls = 0;
  const worker = {
    postMessage: () => undefined,
    on: () => worker,
    terminate: () => {
      terminateCalls += 1;
      return termination;
    },
  } as CodexFilePassWorkerLike;
  const pool = new CodexFilePassPool(1, () => worker);
  const running = pool.run(
    [{ taskId: 'aggregate-only-test' } as any],
    async () => undefined,
  );
  (pool as any).failActive(new Error('synthetic batch failure'));
  await assert.rejects(running, /synthetic batch failure/);

  let disposalSettled = false;
  const disposal = pool.dispose().then(() => {
    disposalSettled = true;
  });
  await Promise.resolve();
  assert.equal(terminateCalls, 1);
  assert.equal(disposalSettled, false);

  finishTerminate(0);
  await disposal;
  assert.equal(disposalSettled, true);
});

test('file-pass pool disposal rejects when a worker cannot be terminated', async () => {
  const worker = {
    postMessage: () => undefined,
    on: () => worker,
    terminate: () => Promise.reject(new Error('file-pass terminate failed')),
  } as CodexFilePassWorkerLike;
  const pool = new CodexFilePassPool(1, () => worker);
  const running = pool.run(
    [{ taskId: 'aggregate-only-termination-failure' } as any],
    async () => undefined,
  );
  (pool as any).failActive(new Error('synthetic batch failure'));
  await assert.rejects(running, /synthetic batch failure/);
  await assert.rejects(pool.dispose(), /file-pass terminate failed/);
});

test('day or timezone changes invalidate the warm no-op metadata shortcut', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-noop-boundary-'));
  try {
    const firstDay = Date.parse('2026-07-22T12:00:00.000Z');
    const nextDay = Date.parse('2026-07-23T12:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'boundary.jsonl'),
      completeSession('boundary', 100, 20),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => firstDay,
    });

    const nextDayResult = await updateCodexIndex(cold.index, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => nextDay,
    });
    const changedZone = await updateCodexIndex(cold.index, manifest, {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      now: () => firstDay,
    });

    assert.equal(nextDayResult.indexChanged, true);
    assert.equal(nextDayResult.index.coverage.period.asOfDay, '2026-07-23');
    assert.equal(changedZone.indexChanged, true);
    assert.equal(
      changedZone.index.coverage.period.timeZone,
      'Asia/Hong_Kong',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('period backfill is recent-first and globally bounded by file passes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-order-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    for (const [name, input] of [['oldest', 10], ['middle', 20], ['newest', 30]] as const) {
      await writeFile(path.join(sessions, `${name}.jsonl`), completeSession(name, input, 1), 'utf8');
    }
    const manifest = await scanCodexManifest(root, SALT);
    const mtimes: Record<string, number> = { oldest: 1, middle: 2, newest: 3 };
    for (const entry of manifest.files) {
      const name = path.basename(entry.absolutePath, '.jsonl');
      entry.mtimeMs = mtimes[name];
      manifest.persistable[entry.fileKey].mtimeMs = mtimes[name];
    }
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
    });
    const legacy = structuredClone(cold.index);
    for (const contribution of Object.values(legacy.files)) {
      delete contribution.aggregate.period;
    }
    const io = trackingIo();
    let checkpoints = 0;

    const result = await updateCodexIndex(legacy, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      io,
      budget: { maxFilePasses: 1, maxBytes: 32 * 1024 * 1024 },
      onCheckpoint: async () => { checkpoints += 1; },
    });
    const newest = manifest.files.reduce((left, right) =>
      left.mtimeMs > right.mtimeMs ? left : right);

    assert.deepEqual(io.fileKeysRead, [newest.fileKey]);
    assert.equal(path.basename(newest.absolutePath), 'newest.jsonl');
    assert.equal(result.migration.filePasses, 1);
    assert.equal(result.migration.pending, true);
    assert.equal(result.index.aggregate.total.inputTotal, 60);
    assert.ok(
      checkpoints <= result.index.coverage.period.allTime.migratedFiles + 1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('period migration respects a byte budget and resumes from its numeric checkpoint', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-budget-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    const filePath = path.join(sessions, 'large.jsonl');
    const body = `${sessionLine('large')}\n${contextLine()}\n${Array.from(
      { length: 11_000 },
      (_, index) => tokenLine(index + 1, 1, `2026-07-20T00:${String(index % 60).padStart(2, '0')}:00.000Z`),
    ).join('\n')}\n`;
    await writeFile(filePath, body, 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
    });
    const key = manifest.files[0].fileKey;
    const legacy = structuredClone(cold.index);
    delete legacy.files[key].aggregate.period;
    const budget = { maxFilePasses: 16, maxBytes: CODEX_REFRESH_MIN_BYTES };
    let progressCalls = 0;

    const first = await updateCodexIndex(legacy, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      budget,
      onProgress: () => { progressCalls += 1; },
    });
    const firstOffset = first.index.files[key].periodMigration!.offset;
    const second = await updateCodexIndex(first.index, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      budget,
    });

    assert.ok(first.migration.bytesRead <= budget.maxBytes);
    assert.ok(progressCalls > 0);
    assert.ok(second.migration.bytesRead <= budget.maxBytes);
    assert.ok(second.index.files[key].periodMigration!.offset > firstOffset);
    assert.equal(second.index.aggregate.total.inputTotal, cold.index.aggregate.total.inputTotal);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a positive byte budget smaller than one allowed JSONL line is rejected', async () => {
  await assert.rejects(
    updateCodexIndex(createEmptyCodexIndex('UTC'), persistableManifest([]), {
      salt: SALT,
      timeZone: 'UTC',
      budget: { maxFilePasses: 1, maxBytes: CODEX_REFRESH_MIN_BYTES - 1 },
    }),
    (error: unknown) =>
      error instanceof CodexIndexBudgetError &&
      error.code === 'invalid-work-budget' &&
      error.message === 'Codex index byte budget is below the safe minimum',
  );
});

test('changed main contributions run before newer period backfill work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-main-priority-'));
  try {
    const sessions = path.join(root, 'sessions');
    const changedPath = path.join(sessions, 'changed.jsonl');
    const periodPath = path.join(sessions, 'period.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(changedPath, completeSession('changed', 10, 1), 'utf8');
    await writeFile(periodPath, completeSession('period', 20, 2), 'utf8');
    const initialManifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), initialManifest, {
      salt: SALT,
      timeZone: 'UTC',
    });
    const periodKey = initialManifest.files.find((entry) => entry.absolutePath === periodPath)!.fileKey;
    const changedKey = initialManifest.files.find((entry) => entry.absolutePath === changedPath)!.fileKey;
    delete cold.index.files[periodKey].aggregate.period;
    cold.index.files[periodKey].mtimeMs = 99;
    cold.index.files[changedKey].mtimeMs = 1;
    await appendFile(changedPath, `${tokenLine(30, 3, '2026-07-20T00:02:00.000Z')}\n`, 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const changed = manifest.files.find((entry) => entry.absolutePath === changedPath)!;
    const period = manifest.files.find((entry) => entry.absolutePath === periodPath)!;
    changed.mtimeMs = 1;
    period.mtimeMs = 99;
    manifest.persistable[changed.fileKey].mtimeMs = 1;
    manifest.persistable[period.fileKey].mtimeMs = 99;
    const io = trackingIo();

    await updateCodexIndex(cold.index, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      io,
      budget: { maxFilePasses: 1, maxBytes: 32 * 1024 * 1024 },
    });

    assert.deepEqual(io.fileKeysRead, [changed.fileKey]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('period coverage can complete recent windows before all-time', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-coverage-'));
  try {
    const refreshNow = Date.parse('2026-07-22T12:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(path.join(sessions, 'old.jsonl'), completeSession('old', 100, 10), 'utf8');
    await writeFile(path.join(sessions, 'recent.jsonl'), completeSession('recent', 20, 2), 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
    });
    const legacy = structuredClone(cold.index);
    const recent = manifest.files.find((entry) => entry.absolutePath.endsWith('recent.jsonl'))!;
    const old = manifest.files.find((entry) => entry.absolutePath.endsWith('old.jsonl'))!;
    legacy.files[recent.fileKey].aggregate.session.endedAt = refreshNow;
    legacy.files[old.fileKey].aggregate.session.endedAt = Date.parse('2000-01-01T00:00:00.000Z');
    delete legacy.files[recent.fileKey].aggregate.period;
    delete legacy.files[old.fileKey].aggregate.period;
    recent.mtimeMs = 2;
    old.mtimeMs = 1;
    manifest.persistable[recent.fileKey].mtimeMs = 2;
    manifest.persistable[old.fileKey].mtimeMs = 1;

    const migrated = await updateCodexIndex(legacy, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => refreshNow,
      budget: { maxFilePasses: 1, maxBytes: 32 * 1024 * 1024 },
    });
    const coverage = migrated.index.coverage.period;

    assert.equal(coverage.last7Days.complete, true);
    assert.equal(coverage.last30Days.complete, true);
    assert.equal(coverage.allTime.complete, false);
    assert.equal(migrated.index.aggregate.total.inputTotal, 120);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unknown endedAt remains in every period coverage denominator', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-unknown-'));
  try {
    const refreshNow = Date.parse('2026-07-22T12:00:00.000Z');
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(path.join(sessions, 'recent.jsonl'), completeSession('recent', 20, 2), 'utf8');
    await writeFile(path.join(sessions, 'unknown.jsonl'), completeSession('unknown', 40, 4), 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
    });
    const legacy = structuredClone(cold.index);
    const recent = manifest.files.find((entry) => entry.absolutePath.endsWith('recent.jsonl'))!;
    const unknown = manifest.files.find((entry) => entry.absolutePath.endsWith('unknown.jsonl'))!;
    legacy.files[recent.fileKey].aggregate.session.endedAt = refreshNow;
    delete legacy.files[unknown.fileKey].aggregate.session.endedAt;
    delete legacy.files[recent.fileKey].aggregate.period;
    delete legacy.files[unknown.fileKey].aggregate.period;
    recent.mtimeMs = 2;
    unknown.mtimeMs = 1;
    manifest.persistable[recent.fileKey].mtimeMs = 2;
    manifest.persistable[unknown.fileKey].mtimeMs = 1;

    const result = await updateCodexIndex(legacy, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => refreshNow,
      budget: { maxFilePasses: 1, maxBytes: 32 * 1024 * 1024 },
    });

    assert.equal(result.index.coverage.period.last7Days.totalFiles, 2);
    assert.equal(result.index.coverage.period.last30Days.totalFiles, 2);
    assert.equal(result.index.coverage.period.allTime.totalFiles, 2);
    assert.equal(result.index.coverage.period.last7Days.complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stale old endedAt cannot exclude an incomplete main contribution from recent coverage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-stale-ended-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(path.join(sessions, 'old.jsonl'), completeSession('old', 40, 4), 'utf8');
    const initialManifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), initialManifest, {
      salt: SALT,
      timeZone: 'UTC',
    });
    const key = initialManifest.files[0].fileKey;
    cold.index.files[key].aggregate.session.endedAt = Date.parse('2000-01-01T00:00:00.000Z');
    const incompleteEntry = {
      ...initialManifest.files[0],
      size: initialManifest.files[0].size + 100,
    };

    const result = await updateCodexIndex(
      cold.index,
      persistableManifest([incompleteEntry]),
      {
        salt: SALT,
        timeZone: 'UTC',
        budget: { maxFilePasses: 0, maxBytes: 0 },
      },
    );

    assert.equal(result.index.coverage.period.last7Days.totalFiles, 1);
    assert.equal(result.index.coverage.period.last30Days.totalFiles, 1);
    assert.equal(result.index.coverage.period.last7Days.complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancellation checkpoints a resumable period cursor without clearing all-time', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-cancel-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    const filePath = path.join(sessions, 'cancel.jsonl');
    const checkpointPath = path.join(root, 'cache', 'checkpoint.json');
    const line = `${tokenLine(1, 1, '2026-07-20T00:01:00.000Z')}\n`;
    await writeFile(filePath, `${sessionLine('cancel')}\n${line.repeat(3000)}`, 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
    });
    const key = manifest.files[0].fileKey;
    const legacy = structuredClone(cold.index);
    delete legacy.files[key].aggregate.period;
    let progressCalls = 0;
    const checkpoints: typeof legacy[] = [];

    await assert.rejects(
      updateCodexIndex(legacy, manifest, {
        salt: SALT,
        timeZone: 'UTC',
        onProgress: () => { progressCalls += 1; },
        shouldCancel: () => progressCalls > 0,
        onCheckpoint: async (index) => {
          checkpoints.push(structuredClone(index));
          await saveCodexIndexAtomic(checkpointPath, index);
        },
      }),
      CodexIndexCancelledError,
    );

    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0].indexGeneration, legacy.indexGeneration);
    assert.ok(checkpoints[0].files[key].periodMigration!.offset > 0);
    assert.equal(checkpoints[0].aggregate.total.inputTotal, cold.index.aggregate.total.inputTotal);
    const saved = await loadCodexIndex(checkpointPath, 'UTC');
    assert.equal(saved.indexGeneration, legacy.indexGeneration);
    assert.equal(saved.files[key].periodMigration?.offset, checkpoints[0].files[key].periodMigration?.offset);
    assert.equal('carry' in (saved.files[key].periodMigration ?? {}), false);
    const resumed = await updateCodexIndex(saved, manifest, {
      salt: SALT,
      timeZone: 'UTC',
    });
    assert.equal(resumed.index.indexGeneration, saved.indexGeneration);
    assert.equal(resumed.index.files[key].aggregate.period?.indexedThrough, legacy.files[key].offset);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a final-chunk cancellation promotes its caught-up saved draft without another read', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-final-cancel-'));
  try {
    const sessions = path.join(root, 'sessions');
    const checkpointPath = path.join(root, 'cache', 'checkpoint.json');
    await mkdir(sessions, { recursive: true });
    await writeFile(path.join(sessions, 'final.jsonl'), completeSession('final', 80, 8), 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, {
      salt: SALT,
      timeZone: 'UTC',
    });
    const key = manifest.files[0].fileKey;
    delete cold.index.files[key].aggregate.period;
    let progressed = false;

    await assert.rejects(
      updateCodexIndex(cold.index, manifest, {
        salt: SALT,
        timeZone: 'UTC',
        onProgress: () => { progressed = true; },
        shouldCancel: () => progressed,
        onCheckpoint: (index) => saveCodexIndexAtomic(checkpointPath, index),
      }),
      CodexIndexCancelledError,
    );
    const saved = await loadCodexIndex(checkpointPath, 'UTC');
    assert.equal(saved.files[key].periodMigration?.offset, saved.files[key].offset);
    const noReadIo: CodexIndexIo = {
      async *read() { throw new Error('caught-up resume must not read'); },
    };

    const resumed = await updateCodexIndex(saved, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      io: noReadIo,
      budget: { maxFilePasses: 0, maxBytes: 0 },
    });

    assert.equal(resumed.bodyReads, 0);
    assert.equal(resumed.index.files[key].periodMigration, undefined);
    assert.equal(resumed.index.files[key].aggregate.period?.indexedThrough, saved.files[key].offset);
    assert.equal(resumed.index.coverage.period.allTime.complete, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function persistableManifest(files: CodexRuntimeManifestEntry[]): CodexManifest {
  return {
    files,
    persistable: Object.fromEntries(
      files.map((file) => [
        file.fileKey,
        {
          fileKey: file.fileKey,
          sourceArea: file.sourceArea,
          size: file.size,
          mtimeMs: file.mtimeMs,
          dev: file.dev,
          ino: file.ino,
        },
      ]),
    ),
  };
}

function dedupContribution(
  fileKey: string,
  sourceArea: CodexRuntimeManifestEntry['sourceArea'],
): CodexFileContribution {
  return {
    fileKey,
    sourceArea,
    size: 100,
    mtimeMs: 1,
    offset: 100,
    discardingOversizedLine: false,
    parserState: {
      schemaVersion: 4,
      fileKey,
      sessionKey: 'shared-anonymous-session',
      role: 'root',
      qualityFlags: [],
    },
    aggregate: {
      total: { inputTotal: 100, outputTotal: 20 },
      byDay: {},
      byModel: {},
      byEffort: {},
      session: {
        sessionKey: 'shared-anonymous-session',
        role: 'root',
        startedAt: 10,
        endedAt: 20,
      },
      structural: {
        patchCalls: 0,
        toolCalls: 0,
        postPatchToolCalls: 0,
        compactCount: 0,
        taskCompleteCount: 1,
      },
    },
    qualityFlags: [],
    identityChecked: true,
  };
}

test('cold scan, appended tail, and persisted reload agree', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-'));
  try {
    const sessions = path.join(root, 'sessions');
    const indexPath = path.join(root, 'cache', 'codex-index.json');
    const activePath = path.join(sessions, 'rollout-active.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(activePath, completeSession('raw-session', 100, 20), 'utf8');
    const io = trackingIo();

    const manifest1 = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(
      createEmptyCodexIndex(),
      manifest1,
      { salt: SALT, timeZone: 'UTC', io },
    );
    const key = manifest1.files[0].fileKey;
    const coldOffset = cold.index.files[key].offset;
    await appendFile(
      activePath,
      `${tokenLine(200, 50, '2026-07-20T00:02:00.000Z')}\n`,
      'utf8',
    );

    const manifest2 = await scanCodexManifest(root, SALT);
    const warm = await updateCodexIndex(cold.index, manifest2, {
      salt: SALT,
      timeZone: 'UTC',
      io,
    });
    await saveCodexIndexAtomic(indexPath, warm.index);
    const reloaded = await loadCodexIndex(indexPath);

    assert.deepEqual(reloaded.aggregate, warm.index.aggregate);
    assert.equal(warm.index.aggregate.total.inputTotal, 200);
    assert.equal(warm.index.aggregate.total.outputTotal, 50);
    assert.equal(
      warm.index.files[key].aggregate.session.projectName,
      'ExampleProject',
    );
    assert.equal(
      warm.index.files[key].aggregate.session.projectDirectoryName,
      'example-project',
    );
    assert.equal(warm.index.files[key].aggregate.session.agentNickname, 'Locke');
    assert.deepEqual(io.readOffsets, [0, coldOffset]);
    assert.equal(io.bodyReads.get(key), 2);
    const persisted = await readFile(indexPath, 'utf8');
    assert.doesNotMatch(
      persisted,
      /raw-session|private\/example-project|github\.com|rollout-active|\.jsonl/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('exact active and archive copies contribute usage only once', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-dedup-'));
  try {
    const sessions = path.join(root, 'sessions');
    const archive = path.join(root, 'archived_sessions');
    await mkdir(sessions, { recursive: true });
    await mkdir(archive, { recursive: true });
    const body = completeSession('shared-raw-session', 100, 20);
    await writeFile(path.join(sessions, 'active.jsonl'), body, 'utf8');
    await writeFile(path.join(archive, 'archive.jsonl'), body, 'utf8');

    const manifest = await scanCodexManifest(root, SALT);
    const result = await updateCodexIndex(
      createEmptyCodexIndex(),
      manifest,
      { salt: SALT, timeZone: 'UTC' },
    );

    assert.equal(result.index.aggregate.total.inputTotal, 100);
    assert.equal(result.index.aggregate.total.outputTotal, 20);
    assert.deepEqual(result.index.coverage.identity, {
      exactDuplicateFiles: 1,
      ambiguousSessionGroups: 0,
      complete: true,
    });
    assert.equal(result.index.coverage.period.allTime.totalFiles, 1);
    assert.equal(result.index.coverage.period.allTime.complete, true);
    assert.equal(codexHourProofSnapshot(result.index).complete, true);
    assert.equal(codexHourProofSnapshot(result.index).totalFiles, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ambiguous active and archive copies remain in period coverage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-ambiguous-'));
  try {
    const sessions = path.join(root, 'sessions');
    const archive = path.join(root, 'archived_sessions');
    await mkdir(sessions, { recursive: true });
    await mkdir(archive, { recursive: true });
    await writeFile(path.join(sessions, 'active.jsonl'), completeSession('shared', 100, 20), 'utf8');
    await writeFile(path.join(archive, 'archive.jsonl'), completeSession('shared', 100, 21), 'utf8');

    const result = await updateCodexIndex(
      createEmptyCodexIndex('UTC'),
      await scanCodexManifest(root, SALT),
      { salt: SALT, timeZone: 'UTC' },
    );

    assert.equal(result.index.coverage.period.allTime.totalFiles, 2);
    assert.equal(result.index.coverage.identity.ambiguousSessionGroups, 1);
    assert.equal(result.index.coverage.identity.complete, false);
    assert.equal(codexHourProofSnapshot(result.index).complete, false);
    assert.deepEqual(codexHourProofSnapshot(result.index).hours, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('safe DTO normalization uses outer file keys for exact dedupe', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-key-normalize-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const index = createEmptyCodexIndex();
    const active = dedupContribution('active-outer', 'sessions');
    const archive = dedupContribution('archive-embedded', 'archive');
    Object.assign(archive, {
      rawSessionId: 'raw-session-must-not-survive',
      absolutePath: '/private/path-must-not-survive/archive.jsonl',
    });
    index.files = {
      'active-outer': active,
      'archive-outer': archive,
    };
    index.aggregate.total = { inputTotal: 200, outputTotal: 40 };
    await writeFile(indexPath, JSON.stringify(index), 'utf8');

    const loaded = await loadCodexIndex(indexPath);
    assert.equal(loaded.files['archive-outer'].fileKey, 'archive-outer');
    assert.equal(loaded.files['archive-outer'].parserState.fileKey, 'archive-outer');
    assert.doesNotMatch(
      JSON.stringify(loaded),
      /raw-session-must-not-survive|private\/path-must-not-survive/,
    );

    const entries: CodexRuntimeManifestEntry[] = [
      {
        fileKey: 'active-outer',
        sourceArea: 'sessions',
        size: 100,
        mtimeMs: 1,
        absolutePath: path.join(root, 'sessions', 'active.jsonl'),
        nonPersisted: true,
      },
      {
        fileKey: 'archive-outer',
        sourceArea: 'archive',
        size: 100,
        mtimeMs: 1,
        absolutePath: path.join(root, 'archived_sessions', 'archive.jsonl'),
        nonPersisted: true,
      },
    ];
    const updated = await updateCodexIndex(
      loaded,
      persistableManifest(entries),
      { salt: SALT, timeZone: 'UTC' },
    );

    assert.equal(updated.bodyReads, 1);
    assert.equal(updated.migration.filePasses, 1);
    assert.equal(updated.index.aggregate.total.inputTotal, 100);
    assert.deepEqual(updated.index.coverage.identity, {
      exactDuplicateFiles: 1,
      ambiguousSessionGroups: 0,
      complete: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cold scan and append build target-timezone slices in the same body read', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-append-'));
  try {
    const sessions = path.join(root, 'sessions');
    const activePath = path.join(sessions, 'rollout-period.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      activePath,
      [
        sessionLine('period-append'),
        contextLine(),
        tokenLine(100, 20, '2026-07-20T15:55:00.000Z'),
        '',
      ].join('\n'),
      'utf8',
    );
    const io = trackingIo();
    const firstManifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(
      createEmptyCodexIndex('Asia/Hong_Kong'),
      firstManifest,
      { salt: SALT, timeZone: 'Asia/Hong_Kong', io },
    );
    const key = firstManifest.files[0].fileKey;
    const preAppendOffset = cold.index.files[key].offset;

    assert.equal(cold.bodyReads, 1);
    assert.equal(io.bodyReads.get(key), 1);
    assert.equal(
      cold.index.files[key].aggregate.period?.days['2026-07-20'].total.inputTotal,
      100,
    );
    assert.equal(
      cold.index.files[key].aggregate.period?.indexedThrough,
      preAppendOffset,
    );

    await appendFile(
      activePath,
      [
        tokenLine(150, 30, '2026-07-20T16:05:00.000Z'),
        structuralLine('2026-07-20T16:06:00.000Z', 'response_item', {
          type: 'function_call',
          name: 'apply_patch',
        }),
        '',
      ].join('\n'),
      'utf8',
    );
    const warm = await updateCodexIndex(
      cold.index,
      await scanCodexManifest(root, SALT),
      { salt: SALT, timeZone: 'Asia/Hong_Kong', io },
    );
    const period = warm.index.files[key].aggregate.period!;

    assert.equal(warm.bodyReads, 1);
    assert.equal(io.bodyReads.get(key), 2);
    assert.deepEqual(io.readOffsets, [0, preAppendOffset]);
    assert.equal(period.timeZone, 'Asia/Hong_Kong');
    assert.equal(period.indexedThrough, warm.index.files[key].offset);
    assert.equal(period.days['2026-07-20'].total.inputTotal, 100);
    assert.equal(period.days['2026-07-21'].total.inputTotal, 50);
    assert.equal(
      period.days['2026-07-21'].byModel['gpt-5.6-sol'].inputTotal,
      50,
    );
    assert.equal(period.days['2026-07-21'].byEffort.high.inputTotal, 50);
    assert.equal(period.days['2026-07-21'].structural.patchCalls, 1);
    assert.equal(
      period.days['2026-07-21'].firstObservedAt,
      Date.parse('2026-07-20T16:05:00.000Z'),
    );
    assert.equal(
      period.days['2026-07-21'].lastObservedAt,
      Date.parse('2026-07-20T16:06:00.000Z'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('timezone-changing append uses a remaining pass for period migration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-mismatch-'));
  try {
    const sessions = path.join(root, 'sessions');
    const activePath = path.join(sessions, 'rollout-period-mismatch.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      activePath,
      `${tokenLine(100, 20, '2026-07-20T15:55:00.000Z')}\n`,
      'utf8',
    );
    const firstManifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(
      createEmptyCodexIndex('UTC'),
      firstManifest,
      { salt: SALT, timeZone: 'UTC' },
    );
    const key = firstManifest.files[0].fileKey;
    await appendFile(
      activePath,
      `${tokenLine(150, 30, '2026-07-20T16:05:00.000Z')}\n`,
      'utf8',
    );

    const changedZone = await updateCodexIndex(
      cold.index,
      await scanCodexManifest(root, SALT),
      {
        salt: SALT,
        timeZone: 'Asia/Hong_Kong',
        budget: { maxFilePasses: 2, maxBytes: CODEX_REFRESH_MIN_BYTES },
      },
    );

    assert.equal(changedZone.index.files[key].aggregate.total.inputTotal, 150);
    assert.equal(changedZone.bodyReads, 2);
    assert.equal(changedZone.migration.filePasses, 2);
    assert.equal(changedZone.index.files[key].aggregate.period?.timeZone, 'Asia/Hong_Kong');
    assert.equal(
      changedZone.index.files[key].aggregate.period?.indexedThrough,
      changedZone.index.files[key].offset,
    );
    assert.equal(changedZone.index.aggregate.total.inputTotal, 150);
    assert.equal(changedZone.index.coverage.period.timeZone, 'Asia/Hong_Kong');
    assert.equal(changedZone.index.coverage.period.allTime.complete, true);

    const staleCursor = structuredClone(cold.index);
    staleCursor.files[key].aggregate.period!.indexedThrough -= 1;
    const cursorMismatch = await updateCodexIndex(
      staleCursor,
      await scanCodexManifest(root, SALT),
      { salt: SALT, timeZone: 'UTC' },
    );

    assert.equal(cursorMismatch.index.files[key].aggregate.total.inputTotal, 150);
    assert.equal(
      cursorMismatch.index.files[key].aggregate.period?.indexedThrough,
      cursorMismatch.index.files[key].offset,
    );
    assert.equal(
      cursorMismatch.index.files[key].aggregate.period?.days['2026-07-20'].total.inputTotal,
      150,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid timestamps add a quality flag without creating a period day', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-period-invalid-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'rollout-invalid-time.jsonl'),
      [tokenLine(10, 2, 'not-a-timestamp'), ''].join('\n'),
      'utf8',
    );

    const result = await updateCodexIndex(
      createEmptyCodexIndex('UTC'),
      await scanCodexManifest(root, SALT),
      { salt: SALT, timeZone: 'UTC' },
    );
    const contribution = Object.values(result.index.files)[0];

    assert.deepEqual(contribution.aggregate.period?.days, {});
    assert.ok(contribution.qualityFlags.includes('invalid-event-timestamp'));
    assert.equal('unknown' in (contribution.aggregate.period?.days ?? {}), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('child token counters start at their own zero and are not parent deltas', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-child-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'a-parent.jsonl'),
      completeSession('parent', 100, 20),
      'utf8',
    );
    await writeFile(
      path.join(sessions, 'b-child.jsonl'),
      [
        childSessionLine('child', 'parent'),
        contextLine(),
        tokenLine(50, 10, '2026-07-20T00:01:00.000Z'),
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await updateCodexIndex(
      createEmptyCodexIndex(),
      await scanCodexManifest(root, SALT),
      { salt: SALT },
    );
    const child = Object.values(result.index.files).find(
      (file) => file.aggregate.session.role === 'subagent',
    );

    assert.equal(result.index.aggregate.total.inputTotal, 150);
    assert.equal(result.index.aggregate.total.outputTotal, 30);
    assert.equal(child?.aggregate.total.inputTotal, 50);
    assert.equal(child?.qualityFlags.includes('counter-regression'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('structural summaries count patch and tool calls without reading bodies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-structural-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'rollout-structural.jsonl'),
      [
        structuralLine('2026-07-20T00:00:00.000Z', 'event_msg', {
          type: 'context_compacted',
        }),
        structuralLine('2026-07-20T00:01:00.000Z', 'response_item', {
          type: 'function_call',
          name: 'apply_patch',
        }),
        structuralLine('2026-07-20T00:02:00.000Z', 'response_item', {
          type: 'function_call',
          name: 'exec_command',
        }),
        structuralLine('2026-07-20T00:03:00.000Z', 'response_item', {
          type: 'function_call',
          name: 'write_stdin',
        }),
        structuralLine('2026-07-20T00:04:00.000Z', 'event_msg', {
          type: 'task_complete',
        }),
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await updateCodexIndex(
      createEmptyCodexIndex(),
      await scanCodexManifest(root, SALT),
      { salt: SALT },
    );

    assert.deepEqual(Object.values(result.index.files)[0].aggregate.structural, {
      patchCalls: 1,
      toolCalls: 2,
      postPatchToolCalls: 2,
      compactCount: 1,
      taskCompleteCount: 1,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the persisted v1 loader migrates legacy structural proxy keys', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-legacy-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const carry = 'private unfinished x';
    assert.equal(Buffer.byteLength(carry, 'utf8'), 20);
    await writeFile(
      indexPath,
      JSON.stringify({
        schemaVersion: 1,
        files: {
          a: {
            fileKey: 'a',
            size: 120,
            mtimeMs: 1,
            offset: 120,
            carry,
            rawSessionId: 'raw-session-id-never-persist',
            absolutePath: '/private/raw/path-never-persist.jsonl',
            repositoryUrl: 'https://example.invalid/private-repository',
            parserState: {
              schemaVersion: 1,
              fileKey: 'a',
              sessionKey: 'pseudonymous-session-key',
              role: 'root',
              highWater: {
                inputTokens: 123,
                cachedInputTokens: 23,
                outputTokens: 45,
                reasoningOutputTokens: 5,
                totalTokens: 168,
              },
              qualityFlags: ['legacy-quality'],
            },
            aggregate: {
              total: {
                inputTotal: 123,
                cachedInput: 23,
                outputTotal: 45,
                reasoningOutput: 5,
                sourceTotal: 168,
              },
              byDay: {
                '2026-07-20': { inputTotal: 123, outputTotal: 45 },
              },
              byModel: {
                'gpt-5.6-sol': { inputTotal: 123, outputTotal: 45 },
              },
              byEffort: {
                high: { inputTotal: 123, outputTotal: 45 },
              },
              session: {
                sessionKey: 'pseudonymous-session-key',
                role: 'root',
              },
              structural: {
                filesChanged: 1,
                patchRounds: 1,
                commands: 2,
                postChangeCommands: 2,
                compactCount: 1,
                taskCompleteCount: 1,
              },
            },
            limits: {},
            qualityFlags: ['legacy-quality'],
          },
        },
        aggregate: {
          total: {
            inputTotal: 123,
            cachedInput: 23,
            outputTotal: 45,
            reasoningOutput: 5,
            sourceTotal: 168,
          },
          byDay: {
            '2026-07-20': { inputTotal: 123, outputTotal: 45 },
          },
          byModel: {
            'gpt-5.6-sol': { inputTotal: 123, outputTotal: 45 },
          },
          byEffort: {
            high: { inputTotal: 123, outputTotal: 45 },
          },
        },
        coverage: {
          indexedFiles: 0,
          totalFiles: 1,
          indexedBytes: 100,
          totalBytes: 120,
          complete: false,
        },
      }),
      'utf8',
    );

    const loaded = await loadCodexIndex(indexPath, 'Asia/Hong_Kong');

    assert.equal(loaded.schemaVersion, 3);
    assert.equal(loaded.files.a.offset, 100);
    assert.equal(loaded.files.a.discardingOversizedLine, false);
    assert.equal(loaded.aggregate.total.inputTotal, 0);
    assert.ok(loaded.files.a.qualityFlags.includes('stale-reset-required'));
    assert.equal(loaded.coverage.indexedFiles, 0);
    assert.equal(loaded.coverage.indexedBytes, 0);
    assert.equal(loaded.files.a.aggregate.period, undefined);
    assert.deepEqual(loaded.files.a.aggregate.structural, {
      patchCalls: 1,
      toolCalls: 2,
      postPatchToolCalls: 2,
      compactCount: 1,
      taskCompleteCount: 1,
    });
    await saveCodexIndexAtomic(indexPath, loaded);
    const persisted = await readFile(indexPath, 'utf8');
    assert.doesNotMatch(persisted, /private unfinished/);
    assert.doesNotMatch(persisted, /raw-session-id-never-persist/);
    assert.doesNotMatch(persisted, /private\/raw\/path-never-persist/);
    assert.doesNotMatch(persisted, /example\.invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('schema v2 load and save reconstruct only allowlisted anonymous DTO fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-v2-dto-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const sessionKey = pseudonymousIdentityKey(SALT, 'v2-session');
    const parentSessionKey = pseudonymousIdentityKey(SALT, 'v2-parent');
    const projectKey = pseudonymousIdentityKey(SALT, 'v2-project');
    await writeFile(
      indexPath,
      JSON.stringify({
        schemaVersion: 2,
        rawIndexValue: 'v2-secret-index',
        files: {
          a: {
            fileKey: 'anonymous-file-key',
            sourceArea: 'sessions',
            size: 120,
            mtimeMs: 7,
            dev: 8,
            ino: 9,
            offset: 100,
            discardingOversizedLine: false,
            carry: 'v2-secret-carry',
            absolutePath: '/v2-secret-path/session.jsonl',
            repositoryUrl: 'https://v2-secret-url.invalid/repository',
            rawSessionId: 'v2-secret-contribution-session',
            parserState: {
              schemaVersion: 1,
              fileKey: 'anonymous-file-key',
              sessionKey,
              parentSessionKey,
              projectKey,
              projectName: 'SafeProject',
              projectDirectoryName: 'safe-directory',
              agentNickname: 'SafeAgent',
              model: 'gpt-5.6-sol',
              effort: 'high',
              role: 'subagent',
              highWater: {
                inputTokens: 123,
                cachedInputTokens: 23,
                outputTokens: 45,
                reasoningOutputTokens: 5,
                totalTokens: 168,
                responseBody: 'v2-secret-high-water',
              },
              qualityFlags: ['legacy-quality'],
              currentTurnId: 'v2-secret-turn-id',
              toolArguments: 'v2-secret-parser-tool-arguments',
            },
            aggregate: {
              total: {
                inputTotal: 123,
                cachedInput: 23,
                outputTotal: 45,
                reasoningOutput: 5,
                sourceTotal: 168,
                promptBody: 'v2-secret-file-total',
              },
              byDay: {
                '2026-07-20': {
                  inputTotal: 123,
                  outputTotal: 45,
                  commandBody: 'v2-secret-day-bucket',
                },
              },
              byModel: {
                'gpt-5.6-sol': { inputTotal: 123, outputTotal: 45 },
              },
              byEffort: {
                high: { inputTotal: 123, outputTotal: 45 },
              },
              session: {
                sessionKey,
                parentSessionKey,
                projectKey,
                projectName: 'SafeProject',
                projectDirectoryName: 'safe-directory',
                agentNickname: 'SafeAgent',
                role: 'subagent',
                startedAt: 10,
                endedAt: 20,
                sessionTitle: 'v2-secret-session-title',
                rawSessionId: 'v2-secret-session-id',
                cwd: '/v2-secret-session-path',
              },
              structural: {
                patchCalls: 1,
                toolCalls: 2,
                postPatchToolCalls: 2,
                compactCount: 3,
                taskCompleteCount: 4,
                responseBody: 'v2-secret-structural',
              },
              period: {
                timeZone: 'Asia/Hong_Kong',
                indexedThrough: 100,
                days: {
                  '2026-07-20': {
                    total: {
                      inputTotal: 123,
                      cachedInput: 23,
                      outputTotal: 45,
                      reasoningOutput: 5,
                      sourceTotal: 168,
                      promptBody: 'v2-secret-period-total',
                    },
                    byModel: {
                      'gpt-5.6-sol': { inputTotal: 123, outputTotal: 45 },
                    },
                    byEffort: {
                      high: { inputTotal: 123, outputTotal: 45 },
                    },
                    structural: {
                      patchCalls: 1,
                      toolCalls: 2,
                      postPatchToolCalls: 2,
                      compactCount: 3,
                      taskCompleteCount: 4,
                      commandBody: 'v2-secret-period-structural',
                    },
                    firstObservedAt: 10,
                    lastObservedAt: 20,
                    rawResponse: 'v2-secret-period-day',
                  },
                },
                rawPath: '/v2-secret-period-path',
              },
              rawResponse: 'v2-secret-file-aggregate',
            },
            limit: {
              provider: 'codex',
              limitId: 'safe-limit-id',
              limitName: 'Safe Limit',
              observedAt: 30,
              source: 'local-log',
              confidence: 'last-observed',
              windows: [{
                label: 'primary',
                usedPercent: 25,
                windowMinutes: 300,
                resetsAt: 40,
                commandBody: 'v2-secret-limit-window',
              }],
              credits: {
                hasCredits: true,
                unlimited: false,
                balance: '42',
                toolArguments: 'v2-secret-limit-credits',
              },
              rawUrl: 'https://v2-secret-limit.invalid',
            },
            limits: {
              primary: {
                provider: 'codex',
                observedAt: 31,
                source: 'local-log',
                confidence: 'last-observed',
                windows: [{ usedPercent: 26 }],
                promptBody: 'v2-secret-named-limit',
              },
            },
            qualityFlags: ['legacy-quality'],
            qualityDetails: { promptBody: 'v2-secret-quality-details' },
            identityChecked: true,
          },
        },
        aggregate: {
          total: {
            inputTotal: 123,
            cachedInput: 23,
            outputTotal: 45,
            reasoningOutput: 5,
            sourceTotal: 168,
            rawResponse: 'v2-secret-provider-total',
          },
          byDay: {
            '2026-07-20': { inputTotal: 123, outputTotal: 45 },
          },
          byModel: {
            'gpt-5.6-sol': { inputTotal: 123, outputTotal: 45 },
          },
          byEffort: {
            high: { inputTotal: 123, outputTotal: 45 },
          },
          rawPrompt: 'v2-secret-provider-aggregate',
        },
        coverage: {
          indexedFiles: 1,
          totalFiles: 1,
          indexedBytes: 100,
          totalBytes: 120,
          complete: false,
          identity: {
            exactDuplicateFiles: 2,
            ambiguousSessionGroups: 3,
            complete: false,
            rawSessionId: 'v2-secret-identity-session',
            absolutePath: '/v2-secret-identity-path',
          },
          absolutePath: '/v2-secret-coverage-path',
        },
      }),
      'utf8',
    );

    const loaded = await loadCodexIndex(indexPath, 'Asia/Hong_Kong');
    const loadedJson = JSON.stringify(loaded);
    assert.doesNotMatch(loadedJson, /v2-secret/);
    assert.equal(loaded.schemaVersion, 3);
    assert.equal(loaded.files.a.offset, 100);
    assert.equal(loaded.files.a.aggregate.total.inputTotal, 123);
    assert.equal(loaded.files.a.parserState.highWater?.inputTokens, 123);
    assert.equal(loaded.files.a.parserState.sessionKey, sessionKey);
    assert.equal(loaded.files.a.aggregate.session.startedAt, 10);
    assert.equal(loaded.files.a.aggregate.session.endedAt, 20);
    assert.equal(loaded.files.a.aggregate.structural.patchCalls, 1);
    assert.equal(loaded.files.a.aggregate.period?.timeZone, 'Asia/Hong_Kong');
    assert.equal(loaded.files.a.aggregate.period?.indexedThrough, 100);
    assert.equal(
      loaded.files.a.aggregate.period?.days['2026-07-20'].total.inputTotal,
      123,
    );
    assert.equal(
      loaded.files.a.aggregate.period?.days['2026-07-20'].structural.patchCalls,
      1,
    );
    assert.equal(
      loaded.files.a.aggregate.period?.days['2026-07-20'].firstObservedAt,
      10,
    );
    assert.equal(
      loaded.files.a.aggregate.period?.days['2026-07-20'].lastObservedAt,
      20,
    );
    assert.equal(loaded.files.a.limit?.observedAt, 30);
    assert.equal(loaded.files.a.limit?.windows[0].usedPercent, 25);
    assert.equal(loaded.files.a.limit?.credits?.balance, '42');
    assert.equal(loaded.files.a.limits?.primary.observedAt, 31);
    assert.deepEqual(loaded.files.a.qualityFlags, [
      'legacy-quality',
      'stale-reset-required',
    ]);
    assert.equal(loaded.aggregate.total.inputTotal, 0);
    assert.equal(loaded.coverage.indexedBytes, 0);
    assert.equal(loaded.files.a.sourceArea, 'sessions');
    assert.deepEqual(loaded.coverage.identity, {
      exactDuplicateFiles: 0,
      ambiguousSessionGroups: 0,
      complete: false,
    });

    const caller = structuredClone(loaded) as typeof loaded & {
      carry?: string;
      rawPath?: string;
    };
    caller.carry = 'v2-secret-caller-carry';
    caller.rawPath = '/v2-secret-caller-path';
    Object.assign(caller.files.a.parserState, {
      toolArguments: 'v2-secret-caller-parser',
    });
    Object.assign(caller.files.a.aggregate.session, {
      cwd: '/v2-secret-caller-session-path',
    });
    Object.assign(
      caller.files.a.aggregate.period!.days['2026-07-20'],
      { promptBody: 'v2-secret-caller-period-day' },
    );
    Object.assign(caller.files.a.limit!.windows[0], {
      commandBody: 'v2-secret-caller-limit-window',
    });
    await saveCodexIndexAtomic(indexPath, caller);

    const persisted = await readFile(indexPath, 'utf8');
    assert.doesNotMatch(persisted, /v2-secret/);
    assert.equal(caller.carry, 'v2-secret-caller-carry');
    assert.equal(caller.rawPath, '/v2-secret-caller-path');
    assert.match(JSON.stringify(caller), /v2-secret-caller-parser/);
    const saved = JSON.parse(persisted) as typeof loaded;
    assert.equal(saved.files.a.aggregate.total.inputTotal, 123);
    assert.equal(saved.files.a.parserState.sessionKey, sessionKey);
    assert.equal(saved.files.a.limit?.windows[0].usedPercent, 25);
    assert.equal(saved.files.a.aggregate.period?.timeZone, 'Asia/Hong_Kong');
    assert.equal(
      saved.files.a.aggregate.period?.days['2026-07-20'].lastObservedAt,
      20,
    );
    assert.equal(saved.aggregate.total.inputTotal, 0);
    assert.equal(saved.files.a.sourceArea, 'sessions');
    assert.deepEqual(saved.coverage.identity, {
      exactDuplicateFiles: 0,
      ambiguousSessionGroups: 0,
      complete: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy period coverage without an as-of day cannot remain complete', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-as-of-'));
  const indexPath = path.join(root, 'index.json');
  try {
    const completeRange = {
      migratedFiles: 1,
      totalFiles: 1,
      migratedBytes: 100,
      totalBytes: 100,
      complete: true,
    };
    await writeFile(indexPath, JSON.stringify({
      schemaVersion: 2,
      files: {},
      aggregate: { total: {}, byDay: {}, byModel: {}, byEffort: {} },
      coverage: {
        indexedFiles: 1,
        totalFiles: 1,
        indexedBytes: 100,
        totalBytes: 100,
        complete: true,
        identity: {
          exactDuplicateFiles: 0,
          ambiguousSessionGroups: 0,
          complete: true,
        },
        period: {
          timeZone: 'Asia/Hong_Kong',
          last7Days: completeRange,
          last30Days: completeRange,
          allTime: completeRange,
        },
      },
    }), 'utf8');

    const loaded = await loadCodexIndex(indexPath, 'Asia/Hong_Kong');
    const period = loaded.coverage.period;
    assert.match(period.asOfDay, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(period.last7Days.complete, false);
    assert.equal(period.last30Days.complete, false);
    assert.equal(period.allTime.complete, false);

    await saveCodexIndexAtomic(indexPath, loaded);
    const persisted = JSON.parse(await readFile(indexPath, 'utf8')) as {
      coverage: {
        period: {
          asOfDay?: string;
          last7Days: { complete: boolean };
          last30Days: { complete: boolean };
          allTime: { complete: boolean };
        };
      };
    };
    assert.equal(persisted.coverage.period.asOfDay, period.asOfDay);
    assert.equal(persisted.coverage.period.last7Days.complete, false);
    assert.equal(persisted.coverage.period.last30Days.complete, false);
    assert.equal(persisted.coverage.period.allTime.complete, false);

    const reloaded = await loadCodexIndex(indexPath, 'Asia/Hong_Kong');
    assert.equal(reloaded.coverage.period.last7Days.complete, false);
    assert.equal(reloaded.coverage.period.last30Days.complete, false);
    assert.equal(reloaded.coverage.period.allTime.complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('schema v2 legacy contributions do not invent a missing sourceArea', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-source-area-'));
  try {
    const indexPath = path.join(root, 'codex-index.json');
    const legacy = createEmptyCodexIndex();
    const body = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
    body.files = {
      legacy: {
        fileKey: 'legacy-key',
        size: 0,
        mtimeMs: 0,
        offset: 0,
        discardingOversizedLine: false,
        parserState: {
          schemaVersion: 1,
          fileKey: 'legacy-key',
          sessionKey: 'legacy-session-key',
          role: 'root',
          qualityFlags: [],
        },
        aggregate: {
          total: { inputTotal: 0, outputTotal: 0 },
          byDay: {},
          byModel: {},
          byEffort: {},
          session: { sessionKey: 'legacy-session-key', role: 'root' },
          structural: {},
        },
        qualityFlags: [],
      },
    };
    await writeFile(indexPath, JSON.stringify(body), 'utf8');

    const loaded = await loadCodexIndex(indexPath);
    await saveCodexIndexAtomic(indexPath, loaded);
    const saved = JSON.parse(await readFile(indexPath, 'utf8')) as {
      files: Record<string, { sourceArea?: string }>;
    };

    assert.equal(loaded.files.legacy.sourceArea, undefined);
    assert.equal(saved.files.legacy.sourceArea, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unchanged multi-gigabyte all-time metadata gets only one bounded period pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-large-'));
  try {
    const sessions = path.join(root, 'sessions');
    const activePath = path.join(sessions, 'rollout-large.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(activePath, completeSession('large', 100, 20), 'utf8');
    const coldManifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(
      createEmptyCodexIndex(),
      coldManifest,
      { salt: SALT },
    );
    const key = coldManifest.files[0].fileKey;
    const simulatedSize = 2_200_000_000;
    const file = {
      ...coldManifest.files[0],
      size: simulatedSize,
      mtimeMs: 99,
    };
    const previous = structuredClone(cold.index);
    previous.files[key].size = simulatedSize;
    previous.files[key].offset = simulatedSize;
    previous.files[key].mtimeMs = 99;
    const io = trackingIo();

    const result = await updateCodexIndex(
      previous,
      persistableManifest([file]),
      { salt: SALT, io },
    );

    assert.equal(result.index.coverage.totalBytes, simulatedSize);
    assert.equal(result.index.coverage.complete, true);
    assert.equal(io.bodyReads.size, 1);
    assert.equal(result.migration.filePasses, 1);
    assert.ok(result.migration.bytesRead <= 32 * 1024 * 1024);
    assert.equal(result.migration.pending, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an old unchanged index receives one bounded identity metadata pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-identity-'));
  try {
    const sessions = path.join(root, 'sessions');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      path.join(sessions, 'rollout-identity.jsonl'),
      completeSession('identity', 100, 20),
      'utf8',
    );
    const manifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(
      createEmptyCodexIndex(),
      manifest,
      { salt: SALT },
    );
    const key = manifest.files[0].fileKey;
    const oldIndex = structuredClone(cold.index);
    delete oldIndex.files[key].aggregate.session.projectName;
    delete oldIndex.files[key].aggregate.session.projectDirectoryName;
    delete oldIndex.files[key].aggregate.session.agentNickname;
    delete oldIndex.files[key].identityChecked;
    const io = trackingIo();

    const enriched = await updateCodexIndex(oldIndex, manifest, {
      salt: SALT,
      io,
    });

    assert.equal(
      enriched.index.files[key].aggregate.session.projectName,
      'ExampleProject',
    );
    assert.equal(enriched.index.files[key].identityChecked, true);
    assert.deepEqual(io.readOffsets, [0]);
    assert.equal(enriched.index.aggregate.total.inputTotal, 100);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an incomplete tail is re-read from its verified offset after newline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-carry-'));
  try {
    const sessions = path.join(root, 'sessions');
    const activePath = path.join(sessions, 'rollout-carry.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(
      activePath,
      tokenLine(80, 10, '2026-07-20T00:01:00.000Z'),
      'utf8',
    );
    const firstManifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(
      createEmptyCodexIndex(),
      firstManifest,
      { salt: SALT },
    );
    const key = firstManifest.files[0].fileKey;

    assert.equal(cold.index.aggregate.total.inputTotal, 0);
    assert.equal(cold.index.files[key].offset, 0);
    assert.equal(cold.index.files[key].discardingOversizedLine, false);
    assert.equal(cold.index.files[key].qualityFlags.includes('invalid-json'), false);

    await appendFile(activePath, '\n', 'utf8');
    const warm = await updateCodexIndex(
      cold.index,
      await scanCodexManifest(root, SALT),
      { salt: SALT },
    );

    assert.equal(warm.index.aggregate.total.inputTotal, 80);
    assert.equal(warm.index.files[key].offset, Buffer.byteLength(
      `${tokenLine(80, 10, '2026-07-20T00:01:00.000Z')}\n`,
      'utf8',
    ));
    assert.equal(warm.index.files[key].discardingOversizedLine, false);
    assert.equal(warm.index.files[key].qualityFlags.includes('invalid-json'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('truncate rebuilds only the affected contribution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-truncate-'));
  try {
    const sessions = path.join(root, 'sessions');
    const firstPath = path.join(sessions, 'rollout-first.jsonl');
    const secondPath = path.join(sessions, 'rollout-second.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(firstPath, completeSession('first', 100, 20), 'utf8');
    await writeFile(secondPath, completeSession('second', 300, 60), 'utf8');
    const manifest1 = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(
      createEmptyCodexIndex('Asia/Hong_Kong'),
      manifest1,
      { salt: SALT, timeZone: 'Asia/Hong_Kong' },
    );
    await writeFile(
      firstPath,
      `${tokenLine(10, 2, '2026-07-20T00:03:00.000Z')}\n`,
      'utf8',
    );
    const manifest2 = await scanCodexManifest(root, SALT);
    const firstKey = manifest2.files.find((file) => file.absolutePath === firstPath)!.fileKey;
    const secondKey = manifest2.files.find((file) => file.absolutePath === secondPath)!.fileKey;
    const io = trackingIo();

    const rebuilt = await updateCodexIndex(cold.index, manifest2, {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      io,
    });

    assert.equal(io.bodyReads.get(firstKey), 1);
    assert.equal(io.bodyReads.has(secondKey), false);
    assert.equal(rebuilt.index.aggregate.total.inputTotal, 310);
    assert.equal(
      rebuilt.index.files[firstKey].aggregate.period?.days['2026-07-20'].total
        .inputTotal,
      10,
    );
    assert.deepEqual(
      rebuilt.index.files[secondKey].aggregate.period,
      cold.index.files[secondKey].aggregate.period,
    );
    assert.ok(rebuilt.index.files[firstKey].qualityFlags.includes('truncated-jsonl'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('replacement rebuilds only the affected period contribution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-replace-period-'));
  try {
    const sessions = path.join(root, 'sessions');
    const firstPath = path.join(sessions, 'rollout-replaced.jsonl');
    const secondPath = path.join(sessions, 'rollout-unchanged.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(firstPath, completeSession('replace-old', 100, 20), 'utf8');
    await writeFile(secondPath, completeSession('unchanged', 300, 60), 'utf8');
    const firstManifest = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(
      createEmptyCodexIndex('Asia/Hong_Kong'),
      firstManifest,
      { salt: SALT, timeZone: 'Asia/Hong_Kong' },
    );
    await writeFile(
      firstPath,
      `${tokenLine(25, 5, '2026-07-20T16:05:00.000Z')}\n`,
      'utf8',
    );
    const scanned = await scanCodexManifest(root, SALT);
    const replacedEntry = scanned.files.find(
      (file) => file.absolutePath === firstPath,
    )!;
    replacedEntry.ino = (replacedEntry.ino ?? 1) + 10_000;
    const manifest = persistableManifest(scanned.files);
    const firstKey = replacedEntry.fileKey;
    const secondKey = scanned.files.find(
      (file) => file.absolutePath === secondPath,
    )!.fileKey;
    const io = trackingIo();

    const rebuilt = await updateCodexIndex(cold.index, manifest, {
      salt: SALT,
      timeZone: 'Asia/Hong_Kong',
      io,
    });

    assert.equal(io.bodyReads.get(firstKey), 1);
    assert.equal(io.bodyReads.has(secondKey), false);
    assert.equal(
      rebuilt.index.files[firstKey].aggregate.period?.days['2026-07-21'].total
        .inputTotal,
      25,
    );
    assert.deepEqual(
      rebuilt.index.files[secondKey].aggregate.period,
      cold.index.files[secondKey].aggregate.period,
    );
    assert.ok(rebuilt.index.files[firstKey].qualityFlags.includes('replaced-jsonl'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('moving a session to the archive reuses its contribution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-move-'));
  try {
    const sessions = path.join(root, 'sessions');
    const archive = path.join(root, 'archived_sessions');
    const livePath = path.join(sessions, 'rollout-move.jsonl');
    const archivedPath = path.join(archive, 'rollout-move.jsonl');
    await mkdir(sessions, { recursive: true });
    await mkdir(archive, { recursive: true });
    await writeFile(livePath, completeSession('move', 120, 30), 'utf8');
    const manifest1 = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(
      createEmptyCodexIndex(),
      manifest1,
      { salt: SALT },
    );
    const oldKey = manifest1.files[0].fileKey;
    await rename(livePath, archivedPath);
    const manifest2 = await scanCodexManifest(root, SALT);
    const newKey = manifest2.files[0].fileKey;
    const io = trackingIo();

    const moved = await updateCodexIndex(cold.index, manifest2, {
      salt: SALT,
      io,
    });

    assert.notEqual(oldKey, newKey);
    assert.equal(oldKey in moved.index.files, false);
    assert.equal(newKey in moved.index.files, true);
    assert.deepEqual(moved.index.aggregate, cold.index.aggregate);
    assert.equal(io.bodyReads.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed tail read preserves the last verified contribution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-index-failure-'));
  try {
    const sessions = path.join(root, 'sessions');
    const activePath = path.join(sessions, 'rollout-failure.jsonl');
    await mkdir(sessions, { recursive: true });
    await writeFile(activePath, completeSession('failure', 100, 20), 'utf8');
    const manifest1 = await scanCodexManifest(root, SALT);
    const cold = await updateCodexIndex(
      createEmptyCodexIndex(),
      manifest1,
      { salt: SALT },
    );
    await appendFile(
      activePath,
      `${tokenLine(200, 40, '2026-07-20T00:02:00.000Z')}\n`,
      'utf8',
    );
    const manifest2 = await scanCodexManifest(root, SALT);
    const failingIo: CodexIndexIo = {
      async *read(entry, start, endExclusive) {
        const body = await readFile(entry.absolutePath);
        yield body.subarray(start, endExclusive);
        throw new Error('synthetic read failure');
      },
    };

    const failed = await updateCodexIndex(cold.index, manifest2, {
      salt: SALT,
      io: failingIo,
    });
    const key = manifest2.files[0].fileKey;

    assert.equal(failed.failedFiles, 1);
    assert.equal(failed.index.aggregate.total.inputTotal, 100);
    assert.ok(failed.index.files[key].qualityFlags.includes('stale-file'));
    assert.equal(failed.index.coverage.complete, false);

    const retried = await updateCodexIndex(failed.index, manifest2, {
      salt: SALT,
    });
    assert.equal(retried.index.aggregate.total.inputTotal, 200);
    assert.equal(retried.index.files[key].qualityFlags.includes('stale-file'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
