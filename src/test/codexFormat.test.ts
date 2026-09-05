import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  createCodexLocalizedFormatters,
  formatLocalizedBytes,
  formatLocalizedDuration,
  formatLocalizedRelativeTime,
} from '../codexFormat';

test('localized duration formats boundaries without leaking internal window names', () => {
  assert.match(formatLocalizedDuration(0, 'en'), /0/);
  assert.match(formatLocalizedDuration(5 * 60 * 60 * 1_000, 'en'), /5/);
  assert.doesNotMatch(formatLocalizedDuration(5 * 60 * 60 * 1_000, 'en'), /300m|primary/i);
  assert.notEqual(
    formatLocalizedDuration(90 * 60 * 1_000, 'en'),
    formatLocalizedDuration(90 * 60 * 1_000, 'zh-CN'),
  );
});

test('localized relative time and bytes clamp invalid values and describe past and future', () => {
  const now = Date.parse('2026-07-20T12:00:00.000Z');
  assert.match(formatLocalizedRelativeTime(now + 60_000, now, 'en'), /minute|in/i);
  assert.match(formatLocalizedRelativeTime(now - 60_000, now, 'en'), /minute|ago/i);
  assert.match(formatLocalizedBytes(-1, 'en'), /0/);
  assert.match(formatLocalizedBytes(1_024, 'en'), /KB|kB/i);
  assert.equal(
    formatLocalizedDuration(Number.NaN, 'zh-CN'),
    new Intl.NumberFormat('zh-CN', {
      style: 'unit', unit: 'minute', unitDisplay: 'long', maximumFractionDigits: 0,
    }).format(0),
  );
  assert.equal(
    formatLocalizedBytes(Number.NaN, 'pt-BR'),
    new Intl.NumberFormat('pt-BR', {
      style: 'unit', unit: 'byte', unitDisplay: 'narrow', maximumFractionDigits: 0,
    }).format(0),
  );
  assert.equal(
    formatLocalizedBytes(1_024 ** 5, 'ja'),
    new Intl.NumberFormat('ja', {
      style: 'unit', unit: 'terabyte', unitDisplay: 'narrow', maximumFractionDigits: 1,
    }).format(1_024),
  );
});

test('production Codex formatters honor an explicit locale timezone and clock', () => {
  const formatters = createCodexLocalizedFormatters('de-DE', 'Asia/Hong_Kong');
  const timestamp = Date.parse('2026-07-20T23:30:00.000Z');
  const now = Date.parse('2026-07-20T12:00:00.000Z');

  assert.match(formatters.formatDateTime(timestamp), /21\.07\.2026.*07:30/);
  assert.match(formatters.formatDuration(90 * 60_000), /1 Stunde.*30 Minuten/);
  assert.match(formatters.formatRelativeTime(timestamp, now), /12 Stunden/);
  assert.equal(
    formatters.formatBytes(1_300),
    new Intl.NumberFormat('de-DE', {
      style: 'unit', unit: 'kilobyte', unitDisplay: 'narrow', maximumFractionDigits: 1,
    }).format(1_300 / 1_024),
  );
});

test('all supported locales use Intl units for Codex duration relative time and bytes', () => {
  const locales = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
  const now = Date.parse('2026-07-20T12:00:00.000Z');

  for (const locale of locales) {
    assert.equal(
      formatLocalizedDuration(90 * 60_000, locale),
      [
        new Intl.NumberFormat(locale, { style: 'unit', unit: 'hour', unitDisplay: 'long', maximumFractionDigits: 0 }).format(1),
        new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'long', maximumFractionDigits: 0 }).format(30),
      ].join(' '),
      `${locale} duration`,
    );
    assert.equal(
      formatLocalizedBytes(1_024, locale),
      new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilobyte', unitDisplay: 'narrow', maximumFractionDigits: 1 }).format(1),
      `${locale} bytes`,
    );
    assert.ok(formatLocalizedRelativeTime(now - 60_000, now, locale), `${locale} relative time`);
  }
});
