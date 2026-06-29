// Tests for the token heatmap pure logic (V2.2 Phase 6.4) — month aggregation,
// zero-usage days, intensity buckets, metric switching.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { buildMonthHeatmap, daysInMonth, intensityBucket } from '../heatmap';

test('daysInMonth handles 28–31 day months', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29); // leap
  assert.equal(daysInMonth(2026, 6), 30);
  assert.equal(daysInMonth(2026, 7), 31);
});

test('intensityBucket: 0 for no usage, 1..4 by quartile of max', () => {
  assert.equal(intensityBucket(0, 100), 0);
  assert.equal(intensityBucket(-5, 100), 0);
  assert.equal(intensityBucket(10, 0), 0); // max 0 → 0
  assert.equal(intensityBucket(1, 100), 1); // tiny but non-zero
  assert.equal(intensityBucket(25, 100), 1);
  assert.equal(intensityBucket(26, 100), 2);
  assert.equal(intensityBucket(75, 100), 3);
  assert.equal(intensityBucket(100, 100), 4); // the max day
});

test('buildMonthHeatmap fills every day, zero for missing', () => {
  const daily = {
    '2026-06-01': { tokens: 1000, cost: 0.5, sessions: 2 },
    '2026-06-15': { tokens: 4000, cost: 2.0, sessions: 5 },
  };
  const hm = buildMonthHeatmap(daily, 2026, 6, 'tokens');
  assert.equal(hm.cells.length, 30);
  assert.equal(hm.max, 4000);
  const d1 = hm.cells.find((c) => c.day === 1)!;
  const d2 = hm.cells.find((c) => c.day === 2)!;
  const d15 = hm.cells.find((c) => c.day === 15)!;
  assert.equal(d1.value, 1000);
  assert.equal(d1.bucket, intensityBucket(1000, 4000));
  assert.equal(d2.value, 0); // missing day → zero
  assert.equal(d2.bucket, 0);
  assert.equal(d15.bucket, 4); // the max day
  assert.equal(d15.dateISO, '2026-06-15');
});

test('metric switching changes the driving value', () => {
  const daily = {
    '2026-06-01': { tokens: 1000, cost: 9.0, sessions: 1 },
    '2026-06-02': { tokens: 9000, cost: 1.0, sessions: 1 },
  };
  const byTokens = buildMonthHeatmap(daily, 2026, 6, 'tokens');
  const byCost = buildMonthHeatmap(daily, 2026, 6, 'cost');
  const bySessions = buildMonthHeatmap(daily, 2026, 6, 'sessions');
  assert.equal(byTokens.cells.find((c) => c.day === 2)!.bucket, 4); // day 2 biggest by tokens
  assert.equal(byCost.cells.find((c) => c.day === 1)!.bucket, 4); // day 1 biggest by cost
  assert.equal(bySessions.max, 1); // equal sessions
  assert.equal(bySessions.cells.find((c) => c.day === 1)!.bucket, 4);
});
