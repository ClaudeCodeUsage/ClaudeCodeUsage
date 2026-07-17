import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  LIVE_REFRESH_SECONDS,
  mergeRefreshTrigger,
  pollIntervalMs,
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
