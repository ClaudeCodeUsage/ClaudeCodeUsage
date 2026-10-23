import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  classifyCodexSessionDuplicates,
} from '../providers/codex/codexDedup';
import { CodexFileContribution, createEmptyCodexIndex, updateCodexIndex } from '../providers/codex/codexIndex';
import { CodexSourceArea } from '../providers/codex/codexManifest';

function contribution(
  fileKey: string,
  sourceArea?: CodexSourceArea,
): CodexFileContribution {
  return {
    fileKey,
    ...(sourceArea ? { sourceArea } : {}),
    size: 100,
    mtimeMs: 1,
    offset: 100,
    discardingOversizedLine: false,
    parserState: {
      schemaVersion: 1,
      fileKey,
      sessionKey: 'shared-session-key',
      parentSessionKey: 'parent-key',
      projectKey: 'project-key',
      role: 'subagent',
      qualityFlags: [],
    },
    aggregate: {
      total: {
        inputTotal: 100,
        cachedInput: 40,
        cacheWriteInput: 3,
        outputTotal: 20,
        reasoningOutput: 5,
        sourceTotal: 120,
      },
      byDay: {},
      byModel: {
        'gpt-5.6-sol': { inputTotal: 60, outputTotal: 10 },
        'gpt-5.6-terra': { inputTotal: 40, outputTotal: 10 },
      },
      byEffort: {
        high: { inputTotal: 60, outputTotal: 10 },
        medium: { inputTotal: 40, outputTotal: 10 },
      },
      session: {
        sessionKey: 'shared-session-key',
        parentSessionKey: 'parent-key',
        projectKey: 'project-key',
        role: 'subagent',
        startedAt: 10,
        endedAt: 20,
      },
      structural: {
        patchCalls: 1,
        toolCalls: 2,
        postPatchToolCalls: 1,
        compactCount: 3,
        taskCompleteCount: 1,
      },
    },
    qualityFlags: [],
  };
}

function classify(...files: CodexFileContribution[]) {
  return classifyCodexSessionDuplicates(
    Object.fromEntries(files.map((file) => [file.fileKey, file])),
  );
}

test('an exact verified active/archive pair keeps the active contribution', () => {
  const active = contribution('active-key', 'sessions');
  const archive = contribution('archive-key', 'archive');
  archive.aggregate.byModel = {
    'gpt-5.6-terra': { inputTotal: 40, outputTotal: 10 },
    'gpt-5.6-sol': { inputTotal: 60, outputTotal: 10 },
  };
  archive.aggregate.byEffort = {
    medium: { inputTotal: 40, outputTotal: 10 },
    high: { inputTotal: 60, outputTotal: 10 },
  };

  const exact = classify(active, archive);

  assert.deepEqual([...exact.canonicalFileKeys], ['active-key']);
  assert.deepEqual([...exact.exactDuplicateFileKeys], ['archive-key']);
  assert.deepEqual([...(exact as any).ambiguousFileKeys], []);
  assert.equal(exact.ambiguousSessionGroups, 0);
});

test('a token-total mismatch retains both copies as one ambiguous group', () => {
  const active = contribution('active-key', 'sessions');
  const archive = contribution('archive-key', 'archive');
  archive.aggregate.total.outputTotal += 1;

  const ambiguous = classify(active, archive);

  assert.equal(ambiguous.ambiguousSessionGroups, 1);
  assert.deepEqual([...ambiguous.canonicalFileKeys], ['active-key', 'archive-key']);
  assert.equal(ambiguous.exactDuplicateFileKeys.size, 0);
  assert.deepEqual([...ambiguous.ambiguousFileKeys], ['active-key', 'archive-key']);
});

test('equal totals with different authoritative day distributions are not exact duplicates', () => {
  const active = contribution('active-key', 'sessions');
  const archive = contribution('archive-key', 'archive');
  active.aggregate.byDay = {
    '2026-08-30': { ...active.aggregate.total },
  };
  archive.aggregate.byDay = {
    '2026-08-31': { ...archive.aggregate.total },
  };

  const result = classify(active, archive);

  assert.equal(result.ambiguousSessionGroups, 1);
  assert.deepEqual([...result.canonicalFileKeys], ['active-key', 'archive-key']);
  assert.equal(result.exactDuplicateFileKeys.size, 0);
});

test('a one-sided rebuilding period projection does not destabilize exact dedup', () => {
  const active = contribution('active-key', 'sessions');
  const archive = contribution('archive-key', 'archive');
  active.aggregate.period = {
    timeZone: 'Asia/Shanghai',
    indexedThrough: 50,
    days: {},
  };

  const result = classify(active, archive);

  assert.deepEqual([...result.canonicalFileKeys], ['active-key']);
  assert.deepEqual([...result.exactDuplicateFileKeys], ['archive-key']);
  assert.equal(result.ambiguousSessionGroups, 0);
});

test('a missing optional token field does not equal an explicit zero', () => {
  const active = contribution('active-key', 'sessions');
  const archive = contribution('archive-key', 'archive');
  active.aggregate.total.cacheWriteInput = 0;
  delete archive.aggregate.total.cacheWriteInput;

  const result = classify(active, archive);

  assert.equal(result.ambiguousSessionGroups, 1);
  assert.equal(result.canonicalFileKeys.size, 2);
  assert.equal(result.exactDuplicateFileKeys.size, 0);
});

test('identity, time, bucket, and structural mismatches are ambiguous', async (t) => {
  const cases: Array<[
    string,
    (file: CodexFileContribution) => void,
  ]> = [
    ['parent session', (file) => { file.aggregate.session.parentSessionKey = 'other-parent'; }],
    ['project', (file) => { file.aggregate.session.projectKey = 'other-project'; }],
    ['role', (file) => { file.aggregate.session.role = 'approval-reviewer'; }],
    ['startedAt', (file) => { file.aggregate.session.startedAt = 11; }],
    ['endedAt', (file) => { file.aggregate.session.endedAt = 21; }],
    ['model bucket', (file) => { file.aggregate.byModel['gpt-5.6-sol'].outputTotal = 11; }],
    ['effort bucket', (file) => { file.aggregate.byEffort.high.outputTotal = 11; }],
    ['patchCalls', (file) => { file.aggregate.structural.patchCalls += 1; }],
    ['toolCalls', (file) => { file.aggregate.structural.toolCalls += 1; }],
    ['postPatchToolCalls', (file) => { file.aggregate.structural.postPatchToolCalls += 1; }],
    ['compactCount', (file) => { file.aggregate.structural.compactCount += 1; }],
    ['taskCompleteCount', (file) => { file.aggregate.structural.taskCompleteCount += 1; }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const active = contribution('active-key', 'sessions');
      const archive = contribution('archive-key', 'archive');
      mutate(archive);

      const result = classify(active, archive);

      assert.equal(result.ambiguousSessionGroups, 1);
      assert.equal(result.canonicalFileKeys.size, 2);
      assert.equal(result.exactDuplicateFileKeys.size, 0);
    });
  }
});

test('same-area copies are retained as an ambiguous duplicate group', () => {
  const result = classify(
    contribution('sessions-a', 'sessions'),
    contribution('sessions-b', 'sessions'),
  );

  assert.deepEqual([...result.canonicalFileKeys], ['sessions-a', 'sessions-b']);
  assert.equal(result.exactDuplicateFileKeys.size, 0);
  assert.equal(result.ambiguousSessionGroups, 1);
});

test('unverified cross-area copies are retained as ambiguous', async (t) => {
  const cases: Array<[
    string,
    (file: CodexFileContribution) => void,
  ]> = [
    ['offset has not reached size', (file) => { file.offset = 99; }],
    ['oversized line is still being discarded', (file) => {
      file.discardingOversizedLine = true;
    }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const active = contribution('active-key', 'sessions');
      const archive = contribution('archive-key', 'archive');
      mutate(archive);

      const result = classify(active, archive);

      assert.equal(result.ambiguousSessionGroups, 1);
      assert.equal(result.canonicalFileKeys.size, 2);
      assert.equal(result.exactDuplicateFileKeys.size, 0);
    });
  }
});

test('a duplicate group with missing legacy sourceArea is ambiguous', () => {
  const result = classify(
    contribution('legacy-key'),
    contribution('archive-key', 'archive'),
  );

  assert.deepEqual([...result.canonicalFileKeys], ['legacy-key', 'archive-key']);
  assert.equal(result.exactDuplicateFileKeys.size, 0);
  assert.equal(result.ambiguousSessionGroups, 1);
});

test('a single session contribution is not ambiguous', () => {
  const result = classify(contribution('only-key'));

  assert.deepEqual([...result.canonicalFileKeys], ['only-key']);
  assert.equal(result.exactDuplicateFileKeys.size, 0);
  assert.equal(result.ambiguousSessionGroups, 0);
});

function continuation(fileKey: string, start: number, fingerprints: string[]): CodexFileContribution {
  const file = contribution(fileKey, 'sessions');
  file.parserState.identityLocked = true;
  file.aggregate.session.startedAt = start;
  file.aggregate.session.endedAt = start + 5;
  file.lineage = {
    fingerprintBlocks: [Buffer.from(fingerprints.join(''), 'hex').toString('base64')],
    pendingFingerprints: [],
    tokenEvents: fingerprints.length,
    appliedPrefixEvents: 0,
    desiredPrefixEvents: 0,
  };
  return file;
}

const fp = (value: number): string => value.toString(16).padStart(32, '0');

function assertContinuationClassification(files: CodexFileContribution[], ambiguous: boolean): void {
  const before = structuredClone(files);
  const result = classify(...files);
  assert.deepEqual([...result.canonicalFileKeys], files.map(file => file.fileKey));
  assert.equal(result.exactDuplicateFileKeys.size, 0);
  assert.equal(result.ambiguousSessionGroups, ambiguous ? 1 : 0);
  assert.deepEqual([...result.ambiguousFileKeys], ambiguous ? files.map(file => file.fileKey) : []);
  assert.deepEqual(files, before, 'classification must not mutate totals or retained evidence');
}

test('verified disjoint continuations keep every canonical file and allow calibration in any input order', () => {
  const first = continuation('first', 10, [fp(1), fp(2)]);
  const second = continuation('second', 30, [fp(3)]);
  const third = continuation('third', 50, [fp(4)]);
  second.sourceArea = 'archive';
  // Both packed and pending fingerprints are authoritative, including within-file repeats.
  third.lineage!.pendingFingerprints = [fp(4), fp(5)];
  third.lineage!.tokenEvents += 2;
  assertContinuationClassification([third, first, second], false);
  assertContinuationClassification([second, third, first], false);
});

test('continuation evidence fails closed for overlap, unknown identity/time, prefixes and incomplete verification', async t => {
  const cases: Array<[string, (file: CodexFileContribution) => void]> = [
    ['overlapping range', file => { file.aggregate.session.startedAt = 14; }],
    ['touching boundary', file => { file.aggregate.session.startedAt = 15; }],
    ['reversed range', file => { file.aggregate.session.endedAt = 29; }],
    ['unknown start', file => { delete file.aggregate.session.startedAt; }],
    ['unknown end', file => { delete file.aggregate.session.endedAt; }],
    ['nonfinite start', file => { file.aggregate.session.startedAt = NaN; }],
    ['nonfinite end', file => { file.aggregate.session.endedAt = Infinity; }],
    ['parent mismatch', file => { file.aggregate.session.parentSessionKey = 'other'; }],
    ['project mismatch', file => { file.aggregate.session.projectKey = 'other'; }],
    ['role mismatch', file => { file.aggregate.session.role = 'root'; }],
    ['consistent but different parent', file => { file.aggregate.session.parentSessionKey = file.parserState.parentSessionKey = 'other'; }],
    ['consistent but different project', file => { file.aggregate.session.projectKey = file.parserState.projectKey = 'other'; }],
    ['consistent but different role', file => { file.aggregate.session.role = file.parserState.role = 'root'; }],
    ['parser session mismatch', file => { file.parserState.sessionKey = 'other'; }],
    ['parser parent mismatch', file => { delete file.parserState.parentSessionKey; }],
    ['parser project mismatch', file => { delete file.parserState.projectKey; }],
    ['parser role mismatch', file => { file.parserState.role = 'root'; }],
    ['tree mismatch', file => { file.parserState.treeKey = 'other'; }],
    ['identity not locked', file => { delete file.parserState.identityLocked; }],
    ['unfinished scan', file => { file.offset--; }],
    ['invalid cursor', file => { file.size = file.offset = Infinity; }],
    ['oversized line', file => { file.discardingOversizedLine = true; }],
    ['unverified compression', file => { file.compression = 'zstd'; }],
    ['compression failure', file => { file.compressionFailure = { version: 1, code: 'decode-failed' }; }],
    ['file parsing gap', file => { file.qualityFlags = ['invalid-event-timestamp']; }],
    ['parser parsing gap', file => { file.parserState.qualityFlags = ['invalid-event-timestamp']; }],
    ['applied prefix', file => { file.lineage!.appliedPrefixEvents = 1; }],
    ['pending prefix reconciliation', file => { file.lineage!.desiredPrefixEvents = 1; }],
    ['unknown prefix', file => { delete (file.lineage as Partial<NonNullable<CodexFileContribution['lineage']>>).appliedPrefixEvents; }],
    ['missing trace', file => { delete file.lineage; }],
    ['empty trace', file => { file.lineage!.fingerprintBlocks = []; file.lineage!.tokenEvents = 0; }],
    ['missing fingerprint', file => { file.lineage!.tokenEvents++; }],
    ['extra fingerprint', file => { file.lineage!.pendingFingerprints = [fp(6)]; }],
    ['malformed base64', file => { file.lineage!.fingerprintBlocks = ['!!!!']; }],
    ['partial fingerprint', file => { file.lineage!.fingerprintBlocks = [Buffer.alloc(15).toString('base64')]; }],
    ['malformed pending', file => { file.lineage!.pendingFingerprints = ['not-a-fingerprint']; file.lineage!.tokenEvents++; }],
    ['noninteger event count', file => { file.lineage!.tokenEvents = 1.5; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const first = continuation('first', 10, [fp(1)]);
      const second = continuation('second', 30, [fp(2)]);
      mutate(second);
      assertContinuationClassification([first, second], true);
    });
  }
});

test('shared request fingerprints block time-shifted copies in packed and pending traces', async t => {
  for (const location of ['packed', 'pending'] as const) {
    await t.test(location, () => {
      const first = continuation('first', 10, [fp(1), fp(2)]);
      const second = continuation('second', 30, [fp(3)]);
      const third = continuation('third', 50, [fp(4)]);
      if (location === 'packed') third.lineage!.fingerprintBlocks.push(Buffer.from(fp(2), 'hex').toString('base64'));
      else third.lineage!.pendingFingerprints.push(fp(2));
      third.lineage!.tokenEvents++;
      assertContinuationClassification([first, second, third], true);
    });
  }
});

test('exact active/archive dedup retains priority even without continuation evidence', () => {
  const active = continuation('active', 10, [fp(1)]);
  const archive = structuredClone(active);
  archive.fileKey = 'archive';
  archive.sourceArea = 'archive';
  delete archive.lineage;
  const result = classify(active, archive);
  assert.deepEqual([...result.canonicalFileKeys], ['active']);
  assert.deepEqual([...result.exactDuplicateFileKeys], ['archive']);
  assert.equal(result.ambiguousFileKeys.size, 0);
});

function largeContinuation(key: string, start: number, firstFingerprint: number, count: number): CodexFileContribution {
  const file = continuation(key, start, [fp(firstFingerprint)]);
  file.lineage!.fingerprintBlocks = [];
  for (let i = 0; i < count; i += 1024) {
    const fingerprints = Array.from({ length: Math.min(1024, count - i) }, (_, j) => fp(firstFingerprint + i + j));
    file.lineage!.fingerprintBlocks.push(Buffer.from(fingerprints.join(''), 'hex').toString('base64'));
  }
  file.lineage!.tokenEvents = count;
  return file;
}

test('continuation proof has bounded group and call-wide fingerprint budgets', () => {
  const first = largeContinuation('first', 10, 0, 32768);
  const second = largeContinuation('second', 30, 32768, 32768);
  assertContinuationClassification([first, second], false);
  second.lineage!.pendingFingerprints.push(fp(65536));
  second.lineage!.tokenEvents++;
  assertContinuationClassification([first, second], true);

  const files: CodexFileContribution[] = [];
  for (let i = 0; i < 5; i++) {
    for (const file of [largeContinuation(`a${i}`, 10, 0, 32768), largeContinuation(`b${i}`, 30, 32768, 32768)]) {
      file.aggregate.session.sessionKey = file.parserState.sessionKey = `session${i}`;
      files.push(file);
    }
  }
  const result = classify(...files);
  assert.equal(result.canonicalFileKeys.size, 10);
  assert.equal(result.ambiguousSessionGroups, 1);
  assert.deepEqual([...result.ambiguousFileKeys], ['a4', 'b4']);
});

test('oversized or inconsistent traces fail closed before decoding unbounded data', () => {
  const first = continuation('first', 10, [fp(1)]);
  const second = continuation('second', 30, [fp(2)]);
  second.lineage!.fingerprintBlocks = ['A'.repeat(100_000)];
  assertContinuationClassification([first, second], true);
  second.lineage!.fingerprintBlocks = Array(100_000).fill('');
  assertContinuationClassification([first, second], true);
  second.lineage!.fingerprintBlocks = [];
  second.lineage!.pendingFingerprints = Array(100_000).fill(fp(2));
  assertContinuationClassification([first, second], true);
});

test('verified compressed and pending-only continuations can share a session', () => {
  const first = continuation('first', 10, [fp(1)]);
  first.compression = 'zstd';
  first.compressionVerified = true;
  const second = continuation('second', 30, [fp(2)]);
  second.lineage!.fingerprintBlocks = [];
  second.lineage!.pendingFingerprints = [fp(2)];
  assertContinuationClassification([first, second], false);
});

test('continuation groups have a file-count bound', () => {
  const files = Array.from({ length: 64 }, (_, i) => continuation(`file${i}`, i * 10, [fp(i)]));
  assertContinuationClassification(files, false);
  files.push(continuation('overflow', 640, [fp(64)]));
  assertContinuationClassification(files, true);
});

test('failed fingerprint proofs consume the call budget while exact dedup remains available', () => {
  const files: CodexFileContribution[] = [];
  for (let i = 0; i < 4; i++) {
    // Shared last fingerprint fails only after checking nearly the entire group.
    const first = largeContinuation(`a${i}`, 10, 0, 32768);
    const second = largeContinuation(`b${i}`, 30, 32767, 32768);
    second.lineage!.fingerprintBlocks.reverse();
    for (const file of [first, second]) {
      file.aggregate.session.sessionKey = file.parserState.sessionKey = `failed${i}`;
      files.push(file);
    }
  }
  files.push(continuation('next-a', 10, [fp(1)]), continuation('next-b', 30, [fp(2)]));
  const active = contribution('active', 'sessions');
  const archive = contribution('archive', 'archive');
  for (const file of [active, archive]) file.aggregate.session.sessionKey = 'exact';
  const result = classify(...files, active, archive);
  assert.equal(result.ambiguousSessionGroups, 5);
  assert.deepEqual([...result.ambiguousFileKeys], files.map(file => file.fileKey));
  assert.deepEqual([...result.exactDuplicateFileKeys], ['archive']);
  assert.deepEqual([...result.canonicalFileKeys], [...files.map(file => file.fileKey), 'active']);
});

test('production parsing of synthetic same-session continuations lifts ambiguity without changing usage', async () => {
  const start = Date.parse('2026-10-20T06:00Z');
  const bodies = [1000, 3000].map((input, index) => Buffer.from([
    { type: 'session_meta', payload: { id: 'synthetic-shared-session' } },
    { type: 'turn_context', payload: { model: 'gpt-5' } },
    { type: 'event_msg', timestamp: new Date(start + index * 60_000).toISOString(),
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, output_tokens: 0 } } } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n'));
  const entries = bodies.map((body, index) => ({ fileKey: String(index + 1).repeat(64),
    sourceArea: 'sessions' as const, size: body.length, mtimeMs: start, dev: 1, ino: index + 10,
    absolutePath: `/synthetic/not-read/${index}`, nonPersisted: true as const }));
  const result = await updateCodexIndex(createEmptyCodexIndex('UTC'), {
    files: entries,
    persistable: Object.fromEntries(entries.map(({ absolutePath: _path, nonPersisted: _runtime, ...entry }) =>
      [entry.fileKey, entry])),
  }, { salt: 'synthetic-dedup-test', timeZone: 'UTC', now: () => start + 120_000,
    allowHistoricalBackfill: false, allowAchievementHourProof: false,
    io: { async *read(entry, offset, end) {
      yield bodies[entries.findIndex(candidate => candidate.fileKey === entry.fileKey)].subarray(offset, end);
    } } });
  assert.equal(result.failedFiles, 0);
  assertContinuationClassification(Object.values(result.index.files), false);
  assert.equal(result.index.aggregate.total.inputTotal, 4000);
  assert.equal(result.index.aggregate.total.outputTotal, 0);
});

test('historical parsing gaps do not make known counted requests duplicates or erase uncertainty', async t => {
  const flags = ['unknown-event', 'oversized-jsonl-line', 'invalid-json', 'invalid-event-payload',
    'missing-token-info', 'invalid-token-count', 'invalid-turn-context', 'counter-regression', 'component-delta-clamped'];
  for (const flag of flags) await t.test(flag, () => {
    const first = continuation('first', 10, [fp(1)]);
    const second = continuation('second', 30, [fp(2)]);
    first.qualityFlags = [flag];
    second.parserState.qualityFlags = [flag];
    assertContinuationClassification([first, second], false);
    // Historical gaps cannot excuse overlap among requests that WERE counted.
    second.lineage!.fingerprintBlocks = [Buffer.from(fp(1), 'hex').toString('base64')];
    assertContinuationClassification([first, second], true);
  });
});

test('completed reparse diagnostics do not prevent uniqueness proof but current uncertainty still does', async t => {
  for (const flag of ['replaced-jsonl', 'truncated-jsonl']) await t.test(flag, () => {
    const first = continuation('first', 10, [fp(1)]);
    const second = continuation('second', 30, [fp(2)]);
    first.qualityFlags = [flag, 'oversized-jsonl-line'];
    second.qualityFlags = [flag];
    assertContinuationClassification([first, second], false);
    for (const blocker of ['stale-file', 'stale-reset-required', 'missing-parent', 'missing-pseudonymizer',
      'invalid-session-meta', 'invalid-event-timestamp', 'future-unknown-flag']) {
      second.qualityFlags = [flag, blocker];
      assertContinuationClassification([first, second], true);
      second.qualityFlags = [flag];
      second.parserState.qualityFlags = [blocker];
      assertContinuationClassification([first, second], true);
      second.parserState.qualityFlags = [];
    }
    // Reset diagnostics are file-scoped; they are not recognized parser gaps.
    second.parserState.qualityFlags = [flag];
    assertContinuationClassification([first, second], true);
  });
});

test('allowlisted historical flags cannot bypass identity, EOF, chronology or prefix safeguards', async t => {
  const mutations: Array<[string, (file: CodexFileContribution) => void]> = [
    ['identity', file => { file.parserState.identityLocked = false; }],
    ['different parent', file => { file.parserState.parentSessionKey = file.aggregate.session.parentSessionKey = 'other'; }],
    ['unknown time', file => { delete file.aggregate.session.startedAt; }],
    ['overlap', file => { file.aggregate.session.startedAt = 15; }],
    ['EOF', file => { file.offset--; }],
    ['compression', file => { file.compression = 'zstd'; }],
    ['prefix', file => { file.lineage!.appliedPrefixEvents = 1; }],
    ['pending prefix', file => { file.lineage!.desiredPrefixEvents = 1; }],
    ['missing fingerprints', file => { file.lineage!.tokenEvents++; }],
    ['excessive flags', file => { file.qualityFlags = Array(33).fill('unknown-event'); }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, () => {
    const first = continuation('first', 10, [fp(1)]);
    const second = continuation('second', 30, [fp(2)]);
    for (const file of [first, second]) {
      file.qualityFlags = ['replaced-jsonl', 'oversized-jsonl-line'];
      file.parserState.qualityFlags = ['unknown-event', 'counter-regression'];
    }
    mutate(second);
    assertContinuationClassification([first, second], true);
  });
});
