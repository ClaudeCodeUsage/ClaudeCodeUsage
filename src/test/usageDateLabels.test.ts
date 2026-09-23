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
  assert.equal(formatUsageDate('2026-07', 'en-US', {}, true), 'July 2026');
});

test('date keys are rendered verbatim instead of shifting in behind-UTC zones', () => {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    timeZone: 'America/New_York',
  };
  assert.equal(formatUsageDate('2026-06-01', 'en-US', options, true), 'June 2026');
});

test('memoised labels match toLocaleDateString for every UI locale and option shape', () => {
  const locales = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
  const dailyOptions: Intl.DateTimeFormatOptions[] = [
    {},
    { timeZone: 'America/New_York' },
    { timeZone: 'Asia/Shanghai' },
    { year: 'numeric', month: 'numeric', day: 'numeric' },
    { month: 'short', day: 'numeric', weekday: 'short' },
    { dateStyle: 'medium' },
    { hour: '2-digit' },
  ];
  const keys = ['2026-01-01', '2026-02-28', '2026-07-01', '2026-12-31'];
  for (const locale of locales) {
    for (const options of dailyOptions) {
      for (const key of keys) {
        const [year, month, day] = key.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day, 12));
        // Twice, so the second call is served by the cached formatter.
        for (let i = 0; i < 2; i++) {
          assert.equal(
            formatUsageDate(key, locale, options),
            date.toLocaleDateString(locale, { ...options, timeZone: 'UTC' }),
            `${locale} ${JSON.stringify(options)} ${key}`
          );
          assert.equal(
            formatUsageDate(key, locale, options, true),
            new Date(Date.UTC(year, month - 1, 1, 12))
              .toLocaleDateString(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }),
            `${locale} monthly ${key}`
          );
        }
      }
    }
  }
});
