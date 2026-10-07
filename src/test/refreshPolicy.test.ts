import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  ClaudeRefreshRecovery,
  commitRefreshSnapshot,
  codexRefreshProfileForTrigger,
  CODEX_LIVE_REFRESH_SECONDS,
  LIVE_REFRESH_SECONDS,
  mergeRefreshTrigger,
  pollIntervalMs,
  quotaFailureBackoffMs,
  QuietDebounce,
  RefreshSingleFlight,
  reportColdRefreshFailure,
  shouldCommitUsageLoad,
  shouldReloadUsage,
  watcherFailureBackoffMs,
  WindowActivityGate,
} from '../refreshPolicy';

test('Claude recovery bounds automatic retry and manual cooling without scheduling timers', () => {
  let now = 0;
  const gate = new ClaudeRefreshRecovery(() => now);
  assert.equal(gate.admit('revision-a', 'poll'), true);
  gate.fail('revision-a');
  for (const trigger of ['poll', 'watch', 'focus', 'workspace', 'settings', 'pricing', 'startup'] as const) {
    assert.equal(gate.admit('revision-a', trigger), false, trigger);
  }
  assert.equal(gate.admit('revision-a', 'manual'), false);
  now = 4_999;
  assert.equal(gate.admit('revision-a', 'manual'), false);
  now = 5_000;
  assert.equal(gate.admit('revision-a', 'manual'), true);
  gate.fail('revision-a');
  now = 64_999;
  assert.equal(gate.admit('revision-a', 'poll'), false);
  now = 65_000;
  assert.equal(gate.admit('revision-a', 'poll'), true);
  for (const delay of [120_000, 240_000, 480_000, 900_000, 900_000]) {
    gate.fail('revision-a');
    now += delay - 1;
    assert.equal(gate.admit('revision-a', 'poll'), false);
    now++;
    assert.equal(gate.admit('revision-a', 'poll'), true);
  }
  gate.succeed('revision-a');
  assert.equal(gate.admit('revision-a', 'poll'), true);
  gate.fail('revision-a');
  now += 30_000;
  assert.equal(gate.admit('revision-a', 'poll'), true, 'success resets the failure streak');
});

test('Claude recovery retires old revisions and does not retain a source history', () => {
  const gate = new ClaudeRefreshRecovery(() => 0);
  gate.admit('revision-a', 'poll');
  gate.fail('revision-a');
  assert.equal(gate.admit('revision-b', 'poll'), true);
  gate.fail('revision-b');
  gate.succeed('revision-a');
  gate.fail('revision-a');
  assert.equal(gate.admit('revision-b', 'manual'), false, 'retired work cannot clear the new failure');
  assert.equal(gate.admit('revision-c', 'poll'), true);
  gate.fail('revision-b');
  assert.equal(gate.admit('revision-c', 'poll'), true, 'retired failure cannot poison a clean revision');
});

test('window activity emits one suspend and one resume transition', () => {
  const gate = new WindowActivityGate(true);
  assert.equal(gate.update(true), 'none');
  assert.equal(gate.update(false), 'suspend');
  assert.equal(gate.update(false), 'none');
  assert.equal(gate.update(true), 'resume');
  assert.equal(gate.focused, true);
});

test('quota failure backoff grows exponentially and caps at one hour', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 6, 7, 20].map(quotaFailureBackoffMs),
    [0, 60_000, 120_000, 240_000, 1_920_000, 3_600_000, 3_600_000],
  );
});

test('watcher failure backoff starts promptly and caps without hot-looping', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 6, 7, 20].map(watcherFailureBackoffMs),
    [0, 1_000, 2_000, 4_000, 32_000, 60_000, 60_000],
  );
});

test('poll interval always honors refreshInterval and never applies an active override', () => {
  assert.equal(pollIntervalMs(30), 30_000);
  assert.equal(pollIntervalMs(60), 60_000);
  assert.equal(pollIntervalMs(300), 300_000);
  assert.equal(pollIntervalMs(900), 900_000);
  assert.equal(pollIntervalMs(3600), 3_600_000);
});

test('live refresh keeps the 2-second default choices and adds long quiet delays', () => {
  assert.deepEqual(LIVE_REFRESH_SECONDS, ['0', '1', '2', '5', '10', '20', '30', '60', '120', '300']);
});

test('Codex watcher defaults to quiet low-CPU delay choices', () => {
  assert.deepEqual(CODEX_LIVE_REFRESH_SECONDS, ['0', '10', '30', '60', '120', '300']);
});

test('only explicit foreground actions use the accelerated Codex index profile', () => {
  assert.equal(codexRefreshProfileForTrigger('manual'), 'foreground');
  for (const trigger of [
    'startup', 'poll', 'credentials', 'watch', 'focus', 'workspace', 'settings', 'pricing',
  ] as const) {
    assert.equal(codexRefreshProfileForTrigger(trigger), 'background', trigger);
  }
});

test('window activity emits one suspend and one resume transition', () => {
  const gate = new WindowActivityGate(true);
  assert.equal(gate.update(false), 'suspend');
  assert.equal(gate.update(false), 'none');
  assert.equal(gate.update(true), 'resume');
  assert.equal(gate.update(true), 'none');
});

test('quota failure backoff grows exponentially and caps at one hour', () => {
  assert.equal(quotaFailureBackoffMs(0), 0);
  assert.equal(quotaFailureBackoffMs(1), 60_000);
  assert.equal(quotaFailureBackoffMs(2), 120_000);
  assert.equal(quotaFailureBackoffMs(7), 3_600_000);
  assert.equal(quotaFailureBackoffMs(100), 3_600_000);
});

test('coalescing retains the strongest pending trigger', () => {
  assert.equal(mergeRefreshTrigger(null, 'poll'), 'poll');
  assert.equal(mergeRefreshTrigger('poll', 'watch'), 'watch');
  assert.equal(mergeRefreshTrigger('watch', 'focus'), 'focus');
  assert.equal(mergeRefreshTrigger('settings', 'manual'), 'manual');
  assert.equal(mergeRefreshTrigger('manual', 'poll'), 'manual');
});

test('quiet debounce collapses a write burst into one callback', () => {
  const scheduled: Array<() => void> = [];
  const delays: number[] = [];
  const cleared: number[] = [];
  const debounce = new QuietDebounce(
    (callback, ms) => {
      scheduled.push(callback);
      delays.push(ms);
      return scheduled.length as unknown as NodeJS.Timeout;
    },
    (handle) => { cleared.push(handle as unknown as number); }
  );
  let fired = 0;
  debounce.push(2_000, () => { fired += 1; });
  debounce.push(300_000, () => { fired += 1; });
  debounce.push(60_000, () => { fired += 1; });
  assert.deepEqual(delays, [2_000, 300_000, 60_000]);
  assert.deepEqual(cleared, [1, 2]);
  scheduled[2]();
  assert.equal(fired, 1);
});

test('single-flight collapses a burst to one strongest follow-up', () => {
  const gate = new RefreshSingleFlight();
  assert.deepEqual(gate.request(false, 'poll'), { forceReload: false, trigger: 'poll' });
  for (let i = 0; i < 50; i += 1) {
    assert.equal(gate.request(false, 'watch'), null);
  }
  assert.equal(gate.request(true, 'manual'), null);
  assert.deepEqual(gate.complete(), { forceReload: true, trigger: 'manual' });

  // The returned follow-up owns the gate; a trigger arriving before it runs is
  // queued for one later pass instead of starting in parallel.
  assert.equal(gate.request(false, 'focus'), null);
  assert.deepEqual(gate.complete(), { forceReload: false, trigger: 'focus' });
  assert.equal(gate.complete(), null);
  assert.deepEqual(gate.request(false, 'poll'), { forceReload: false, trigger: 'poll' });
});

test('a successfully loaded empty corpus reuses its non-null manifest', () => {
  assert.equal(shouldReloadUsage({
    forceReload: false,
    directoryChanged: false,
    hasLoadedManifest: true,
    changedFiles: 0,
    removedFiles: 0,
  }), false);
  assert.equal(shouldReloadUsage({
    forceReload: false,
    directoryChanged: false,
    hasLoadedManifest: false,
    changedFiles: 0,
    removedFiles: 0,
  }), true);
});

test('an incomplete file load cannot commit the new manifest', () => {
  assert.equal(shouldCommitUsageLoad(0), true);
  assert.equal(shouldCommitUsageLoad(1), false);
});

test('a scanner failure preserves the old snapshot and the next trigger retries', async () => {
  const oldManifest = { marker: 'old-manifest' };
  const oldRecords = [{ marker: 'old-records' }];
  let currentManifest = oldManifest;
  let currentRecords = oldRecords;
  let scans = 0;
  let failScan = true;

  const refresh = async (): Promise<void> => {
    scans += 1;
    if (failScan) {
      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    }
    commitRefreshSnapshot(
      { marker: 'new-manifest' },
      [{ marker: 'new-records' }],
      0,
      (manifest, records) => {
        currentManifest = manifest;
        currentRecords = records;
      }
    );
  };

  await assert.rejects(refresh, { code: 'EACCES' });
  assert.equal(currentManifest, oldManifest);
  assert.equal(currentRecords, oldRecords);
  failScan = false;
  await refresh();
  assert.equal(scans, 2);
  assert.equal(currentManifest.marker, 'new-manifest');
  assert.equal(currentRecords[0].marker, 'new-records');
});

test('cold refresh failure clears loading through status and optional webview error paths', () => {
  const calls: string[] = [];
  assert.equal(reportColdRefreshFailure({
    hasLoadedManifest: false,
    updateWebview: true,
    error: 'localized refresh failure',
    onStatusError: (error) => calls.push(`status:${error}`),
    onWebviewError: (error) => calls.push(`webview:${error}`),
  }), true);
  assert.deepEqual(calls, [
    'status:localized refresh failure',
    'webview:localized refresh failure',
  ]);

  calls.length = 0;
  assert.equal(reportColdRefreshFailure({
    hasLoadedManifest: true,
    updateWebview: true,
    error: 'do not replace warm snapshot',
    onStatusError: (error) => calls.push(error),
    onWebviewError: (error) => calls.push(error),
  }), false);
  assert.deepEqual(calls, []);
});
