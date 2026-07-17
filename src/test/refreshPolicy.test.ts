import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  commitRefreshSnapshot,
  LIVE_REFRESH_SECONDS,
  mergeRefreshTrigger,
  pollIntervalMs,
  QuietDebounce,
  RefreshSingleFlight,
  shouldCommitUsageLoad,
  shouldReloadUsage,
} from '../refreshPolicy';

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
