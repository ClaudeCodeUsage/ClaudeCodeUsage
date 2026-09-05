import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { formatUsageDate, shortUsageDate } from '../usageDateLabels';

test('the first day of a month remains a daily label outside monthly views', () => {
  assert.equal(shortUsageDate('2026-07-01'), '7/1');
  assert.equal(
    formatUsageDate('2026-07-01', 'en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }),
    '7/1/2026'
  );
});

test('monthly views explicitly render month labels', () => {
  assert.equal(shortUsageDate('2026-07-01', true), '2026/07');
  assert.equal(formatUsageDate('2026-07-01', 'en-US', {}, true), 'July 2026');
});

test('date keys are rendered verbatim instead of shifting in behind-UTC zones', () => {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    timeZone: 'America/New_York',
  };
  assert.equal(formatUsageDate('2026-06-01', 'en-US', options, true), 'June 2026');
});
