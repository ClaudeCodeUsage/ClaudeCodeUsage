import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  classifyCodexSessionDuplicates,
} from '../providers/codex/codexDedup';
import { CodexFileContribution } from '../providers/codex/codexIndex';
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
