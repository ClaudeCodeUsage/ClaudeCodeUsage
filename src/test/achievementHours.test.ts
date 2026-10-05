import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  collectClaudeOutputHours,
  collectCodexOutputHours,
  longestOutputHourStreak,
  nightOutputPeak,
  parseHourEvidence,
  updateHourEvidence,
} from '../achievementHours';

test('output streak uses absolute UTC hours across midnight and DST, never local labels', () => {
  const start = Date.parse('2026-10-24T22:00:00Z') / 3_600_000;
  const hours = Array.from({ length: 48 }, (_, index) => start + index);
  assert.equal(longestOutputHourStreak([...hours, start, Number.NaN]), 48);
  assert.equal(longestOutputHourStreak([start, start + 1, start + 3]), 2);
  assert.equal(longestOutputHourStreak([]), 0);
});

test('Claude hours require a real positive output and a finite timestamp', () => {
  const hours = collectClaudeOutputHours([
    { timestamp: '2026-09-01T00:12:00Z', message: { usage: { input_tokens: 9, output_tokens: 1 } } },
    { timestamp: '2026-09-01T00:59:00Z', message: { usage: { input_tokens: 9, output_tokens: 2 } } },
    { timestamp: '2026-09-01T01:00:00Z', message: { usage: { input_tokens: 9, output_tokens: 0 } } },
    { timestamp: 'invalid', message: { usage: { input_tokens: 9, output_tokens: 100 } } },
  ]);
  assert.deepEqual(hours, [Date.parse('2026-09-01T00:00:00Z') / 3_600_000]);
});

test('future-dated output cannot pre-award an hour streak or recent night portrait', () => {
  const now = Date.parse('2026-09-15T12:30:00Z');
  assert.deepEqual(collectClaudeOutputHours([
    { timestamp: '2026-09-15T12:15:00Z', message: { usage: { input_tokens: 0, output_tokens: 1 } } },
    { timestamp: '2026-09-16T22:00:00Z', message: { usage: { input_tokens: 0, output_tokens: 1 } } },
  ], now), [Date.parse('2026-09-15T12:00:00Z') / 3_600_000]);
  assert.deepEqual(collectCodexOutputHours({
    '2026-09-16': [{ hour: '22', output: 1 }],
  }, 'UTC', true, now), []);
  assert.deepEqual(collectCodexOutputHours({
    '2026-09-15': [{ hour: '12', output: 1 }],
  }, 'UTC', true, now), [], 'a civil-hour bucket cannot prove output before the hour has closed');
  assert.deepEqual(collectCodexOutputHours({
    '2026-09-15': [{ hour: '12', output: 1 }],
  }, 'UTC', true, Date.parse('2026-09-15T13:00:00Z')),
  [Date.parse('2026-09-15T12:00:00Z') / 3_600_000]);
});

test('Codex hour mapping fails closed on incomplete coverage and ambiguous local DST hour', () => {
  const rows = { '2026-10-25': [{ hour: '02', output: 10 }], '2026-10-26': [{ hour: '02', output: 10 }] };
  assert.deepEqual(collectCodexOutputHours(rows, 'Europe/Berlin', false), []);
  const mapped = collectCodexOutputHours(rows, 'Europe/Berlin', true,
    Date.parse('2026-10-27T00:00:00Z'));
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0], Date.parse('2026-10-26T01:00:00Z') / 3_600_000);
});

test('night portrait counts output-positive hours across enough days, not one token-heavy night', () => {
  const base = Date.parse('2026-09-01T00:00:00Z') / 3_600_000;
  const hours: number[] = [];
  for (let day = 0; day < 14; day++) {
    hours.push(base + day * 24 + 22, base + day * 24 + 23,
      base + (day + 1) * 24, base + day * 24 + 9);
  }
  assert.equal(nightOutputPeak(hours, 'UTC'), true);
  assert.equal(nightOutputPeak(hours.slice(0, 20), 'UTC'), false);
});

test('bounded versioned evidence preserves a proven past streak but rejects unknown schemas', () => {
  const empty = parseHourEvidence({ schemaVersion: 99, maxStreak: 48 });
  assert.equal(empty.maxStreak, 0);
  const next = updateHourEvidence(empty, 24);
  assert.equal(next.maxStreak, 24);
  assert.equal(updateHourEvidence(next, 12), next);
  assert.deepEqual(parseHourEvidence({ schemaVersion: 1, maxStreak: 48 }),
    { schemaVersion: 3, maxStreak: 0 });
  assert.deepEqual(parseHourEvidence({ schemaVersion: 2, maxStreak: 999999, path: '/secret' }),
    { schemaVersion: 3, maxStreak: 0 });
  assert.deepEqual(parseHourEvidence({ schemaVersion: 2, maxStreak: 48 }),
    { schemaVersion: 3, maxStreak: 0 }, 'old rolling evidence must be re-proven');
  assert.deepEqual(parseHourEvidence({ schemaVersion: 3, maxStreak: 48 }),
    { schemaVersion: 3, maxStreak: 48 });
});
