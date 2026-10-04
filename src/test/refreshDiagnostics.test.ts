import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  formatCodexIndexDiagnostic,
  formatRefreshDiagnostic,
} from '../refreshDiagnostics';

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
});
