import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  ClaudeFailureDiagnosticBudget,
  claudeRefreshFailureReason,
  formatCodexIndexDiagnostic,
  formatRefreshDiagnostic,
} from '../refreshDiagnostics';

test('Claude failure reasons and de-duplication ignore arbitrary names, accessors and labels', () => {
  assert.equal(claudeRefreshFailureReason(new RangeError('private stack')), 'range-error');
  const io = Object.assign(new Error('private credential'), { code: 'EACCES' });
  assert.equal(claudeRefreshFailureReason(io), 'io-error');
  const accessor = new Error('private');
  Object.defineProperty(accessor, 'code', { get: () => { throw new Error('private'); } });
  assert.equal(claudeRefreshFailureReason(accessor), 'refresh-failed');
  const budget = new ClaudeFailureDiagnosticBudget();
  assert.equal(budget.accept('aggregate', 'range-error'), true);
  for (let i = 0; i < 1000; i++) assert.equal(budget.accept('aggregate', 'range-error'), false);
  assert.equal(budget.accept('/private/first', 'arbitrary first'), true);
  for (let i = 0; i < 1000; i++) assert.equal(budget.accept('/private/' + i, 'arbitrary' + i), false);
});

test('failed Claude diagnostics distinguish aggregation from unread or failed files', () => {
  const line = formatRefreshDiagnostic({
    trigger: 'watch', filesDiscovered: 4, filesChanged: 1, filesReused: 3,
    filesRemoved: 0, filesFailed: 0, bytesRead: 1234, linesParsed: 7, bodyReads: 1,
    aggregateMutations: null, watcherEvents: 2, coalescedTriggers: 0,
    quotaWatcherMissingFilenameEvents: 0, manifestMs: 2, readParseMs: 3,
    aggregateRenderMs: null, totalMs: 6, failureStage: 'aggregate', failureReason: 'range-error',
  } as any);
  assert.match(line, /failure\(stage=aggregate reason=range-error\)/);
  assert.match(line, /failed=0/);
  assert.match(line, /io\(bytes=1234 lines=7\)/);
  assert.match(line, /aggregate-mutations=unknown/);
  assert.match(line, /aggregate-render=unknown/);
});

test('unobserved Claude counts and unsafe failure metadata are never invented or interpolated', () => {
  const line = formatRefreshDiagnostic({
    trigger: 'poll', filesDiscovered: null, filesChanged: null, filesReused: null,
    filesRemoved: null, filesFailed: null, bytesRead: null, linesParsed: null,
    watcherEvents: 0, coalescedTriggers: 0, quotaWatcherMissingFilenameEvents: 0,
    manifestMs: null, readParseMs: null, aggregateRenderMs: null, totalMs: 4,
    failureStage: '/Users/private/session.jsonl', failureReason: 'raw secret credential',
  } as any);
  assert.match(line, /failure\(stage=unknown reason=unknown\)/);
  assert.match(line, /discovered=unknown.*failed=unknown/);
  assert.match(line, /io\(bytes=unknown lines=unknown\)/);
  assert.doesNotMatch(line, /Users|private|session|secret|credential|\.jsonl/);
});

test('refresh diagnostics contain only stage names and anonymous numeric counters', () => {
  const line = formatRefreshDiagnostic({
    trigger: 'watch',
    filesDiscovered: 389,
    filesChanged: 1,
    filesReused: 388,
    filesRemoved: 0,
    filesFailed: 0,
    bytesRead: 4096,
    linesParsed: 17,
    bodyReads: 1,
    aggregateMutations: 2,
    watcherEvents: 42,
    coalescedTriggers: 3,
    quotaWatcherMissingFilenameEvents: 2,
    manifestMs: 12.34,
    readParseMs: 45.67,
    aggregateRenderMs: 8.9,
    totalMs: 67.01,
  });
  assert.equal(
    line,
    'refresh: trigger=watch files(discovered=389 changed=1 reused=388 removed=0 failed=0) ' +
      'io(bytes=4096 lines=17) incremental(bodies=1 aggregate-mutations=2) ' +
      'events(watcher=42 coalesced=3 quota-unnamed=2) ' +
      'ms(manifest=12.3 read-parse=45.7 aggregate-render=8.9 total=67.0)'
  );
  assert.equal(/[/\\]|secret|session|prompt|credential|\.jsonl/i.test(line), false);
});

test('Codex diagnostics expose only anonymous coverage, timing, and safe flags', () => {
  const diagnostic = {
    trigger: 'watch',
    outcome: 'partial',
    watcherEvents: 9,
    coalescedTriggers: 8,
    backfillMode: 'historical',
    workerMode: 'background',
    indexedFiles: 4,
    totalFiles: 5,
    indexedBytes: 1300,
    totalBytes: 1500,
    periodMigratedBytes: 900,
    periodTotalBytes: 1500,
    migrationPending: true,
    indexRecovery: 'invalid-json',
    bodyReads: 1,
    failedFiles: 1,
    metadataMs: 12.34,
    parseMs: 45.67,
    qualityFlags: {
      'unknown-event': 2,
      '/Users/carl/private-session.jsonl': 1,
      'private-session-key': 3,
      'github-token-abc': 4,
      'private-repository-name': 5,
      'https://github.com/example/private-repo': 7,
    },
    indexPath: '/Users/carl/codex-index-v1.json',
    sessionKey: 'private-session-key',
    repositoryUrl: 'https://secret.example/private-repository',
    rawError: 'credential failed at /Users/carl/.codex/auth.json',
  } as const;
  const line = formatCodexIndexDiagnostic(diagnostic);

  assert.equal(
    line,
    'codex-index trigger=watch outcome=partial mode(backfill=historical worker=background) ' +
      'events(watcher=9 coalesced=8) files=4/5 bytes=1300/1500 periodBytes=900/1500 ' +
      'migrationPending=true recovery=invalid-json bodyReads=1 failed=1 metadataMs=12.3 parseMs=45.7 ' +
      'flags=unknown:20,unknown-event:2',
  );
  assert.equal(
    /Users|carl|private-session|private-repository|github-token|private-repo|secret\.example|\.jsonl|prompt|command|credential|auth\.json/i.test(line),
    false,
  );

  const unsafeRecovery = formatCodexIndexDiagnostic({
    ...diagnostic,
    indexRecovery: '/Users/carl/private-index.json',
  } as any);
  assert.match(unsafeRecovery, /recovery=none/);
  assert.doesNotMatch(unsafeRecovery, /Users|private-index|\.json/);
  assert.match(formatCodexIndexDiagnostic({ ...diagnostic, errorCode: 'busy' }), /errorCode=busy/);
  const unsafeError = formatCodexIndexDiagnostic({ ...diagnostic, errorCode: '/private/credential' } as any);
  assert.match(unsafeError, /errorCode=refresh-failed/);
  assert.doesNotMatch(unsafeError, /private\/credential/);

  const unsafeModes = formatCodexIndexDiagnostic({
    ...diagnostic,
    trigger: '/Users/carl/private-trigger.jsonl',
    backfillMode: 'prompt-secret',
    workerMode: 'credential-path',
  } as any);
  assert.match(
    unsafeModes,
    /codex-index trigger=unknown outcome=partial mode\(backfill=unknown worker=unknown\)/,
  );
  assert.doesNotMatch(
    unsafeModes,
    /Users|private-trigger|prompt-secret|credential-path|\.jsonl/,
  );

  for (const failureCode of ['cancelled', 'busy', 'worker-failed', 'disposed', 'refresh-failed']) {
    const failed = formatCodexIndexDiagnostic({ ...diagnostic, outcome: 'error', failureCode } as any);
    assert.ok(failed.includes(`failure=${failureCode} `));
  }
  const unsafeFailure = formatCodexIndexDiagnostic({
    ...diagnostic, outcome: 'error', failureCode: '/Users/carl/private-token',
  } as any);
  assert.match(unsafeFailure, /failure=unknown /);
  assert.doesNotMatch(unsafeFailure, /Users|private-token|carl/);
  const missingWorkerStats = formatCodexIndexDiagnostic({
    ...diagnostic, outcome: 'error', failureCode: 'cancelled',
    bodyReads: null, failedFiles: null, metadataMs: null, parseMs: null,
  } as any);
  assert.match(missingWorkerStats,
    /failure=cancelled bodyReads=unknown failed=unknown metadataMs=unknown parseMs=unknown/);
  const unknownCoverage = formatCodexIndexDiagnostic({
    ...diagnostic, outcome: 'error', coverageSource: 'unknown',
    indexedFiles: null, totalFiles: null, indexedBytes: null, totalBytes: null,
    periodMigratedBytes: null, periodTotalBytes: null,
    migrationPending: null, indexRecovery: null,
  } as any);
  assert.match(unknownCoverage, /coverage=unknown files=unknown\/unknown bytes=unknown\/unknown/);
  assert.match(unknownCoverage, /periodBytes=unknown\/unknown migrationPending=unknown recovery=unknown/);
  const cachedCoverage = formatCodexIndexDiagnostic({
    ...diagnostic, outcome: 'error', coverageSource: 'last-snapshot',
  } as any);
  assert.match(cachedCoverage, /coverage=last-snapshot files=4\/5/);
});
