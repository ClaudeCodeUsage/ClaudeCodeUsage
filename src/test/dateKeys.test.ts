import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { dayKeyInZone, monthKeyInZone } from '../dateKeys';

test('a post-midnight local record buckets into the local day, not the UTC day', () => {
  // 20:00 UTC on 30 Jun is 04:00 on 1 Jul in Hong Kong (UTC+8).
  const d = new Date('2026-06-30T20:00:00Z');
  assert.equal(dayKeyInZone(d, 'Asia/Hong_Kong'), '2026-07-01');
  assert.equal(dayKeyInZone(d, 'UTC'), '2026-06-30');
});

test('month key follows the same zone (the This-Month boundary bug)', () => {
  // 01:00 UTC on 1 Jul is 21:00 on 30 Jun in New York (UTC-4, EDT).
  const d = new Date('2026-07-01T01:00:00Z');
  assert.equal(monthKeyInZone(d, 'America/New_York'), '2026-06');
  assert.equal(monthKeyInZone(d, 'Asia/Hong_Kong'), '2026-07');
});

test('day and month keys agree within one zone', () => {
  const d = new Date('2026-07-01T01:00:00Z');
  assert.equal(dayKeyInZone(d, 'America/New_York').slice(0, 7), monthKeyInZone(d, 'America/New_York'));
});

test('empty zone uses the system zone and still yields a well-formed key', () => {
  const key = dayKeyInZone(new Date('2026-07-01T12:00:00Z'), '');
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
});

test('an invalid user-typed zone falls back instead of throwing', () => {
  const key = dayKeyInZone(new Date('2026-07-01T12:00:00Z'), 'Not/AZone');
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
});

test('an invalid date yields an empty key', () => {
  assert.equal(dayKeyInZone(new Date('nonsense'), 'UTC'), '');
  assert.equal(monthKeyInZone(new Date('nonsense'), 'UTC'), '');
});
