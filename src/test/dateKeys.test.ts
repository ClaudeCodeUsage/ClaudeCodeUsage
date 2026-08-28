import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  dayKeyInZone,
  hourKeyInZone,
  monthKeyInZone,
  resolveTimeZone,
  rollingDayKeys,
  rollingDayKeysFromDayKey,
} from '../dateKeys';

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

test('rolling day keys use civil dates across DST', () => {
  const now = Date.parse('2026-03-08T16:00:00.000Z');
  assert.deepEqual(rollingDayKeys(now, 'America/New_York', 7), [
    '2026-03-02',
    '2026-03-03',
    '2026-03-04',
    '2026-03-05',
    '2026-03-06',
    '2026-03-07',
    '2026-03-08',
  ]);
});

test('rolling day keys can be anchored to a persisted civil end day', () => {
  assert.deepEqual(rollingDayKeysFromDayKey('2026-03-08', 7), [
    '2026-03-02',
    '2026-03-03',
    '2026-03-04',
    '2026-03-05',
    '2026-03-06',
    '2026-03-07',
    '2026-03-08',
  ]);
  assert.deepEqual(rollingDayKeysFromDayKey('2026-02-30', 7), []);
  assert.deepEqual(rollingDayKeysFromDayKey('not-a-day', 7), []);
});

test('a fractional-offset zone uses its local calendar day', () => {
  const beforeMidnight = new Date('2026-07-20T18:10:00.000Z');
  const afterMidnight = new Date('2026-07-20T18:20:00.000Z');
  assert.equal(dayKeyInZone(beforeMidnight, 'Asia/Kathmandu'), '2026-07-20');
  assert.equal(dayKeyInZone(afterMidnight, 'Asia/Kathmandu'), '2026-07-21');
});

test('hour keys use the same target zone and a stable 00-23 clock', () => {
  assert.equal(
    hourKeyInZone(new Date('2026-07-20T16:05:00.000Z'), 'Asia/Hong_Kong'),
    '00',
  );
  assert.equal(
    hourKeyInZone(new Date('2026-07-20T18:20:00.000Z'), 'Asia/Kathmandu'),
    '00',
  );
  assert.equal(
    hourKeyInZone(new Date('2026-07-20T23:59:00.000Z'), 'UTC'),
    '23',
  );
  assert.equal(hourKeyInZone(new Date('nonsense'), 'UTC'), '');
});

test('timezone resolution returns a usable canonical zone', () => {
  assert.equal(resolveTimeZone('Asia/Hong_Kong'), 'Asia/Hong_Kong');
  assert.notEqual(resolveTimeZone(''), '');
  assert.equal(resolveTimeZone('Not/AZone'), resolveTimeZone(''));
});
