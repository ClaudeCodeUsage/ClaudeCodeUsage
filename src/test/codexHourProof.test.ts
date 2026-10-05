import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  CODEX_UTC_HOUR_PROOF_VERSION,
  MAX_CODEX_HOURS_PER_FILE,
  addCodexOutputHour,
  addCodexOutputHourInPlace,
  canonicalCodexOutputHours,
  sanitizeCodexHourProof,
} from '../providers/codex/codexHourProof';

const firstHour = Date.parse('2026-10-25T00:00:00.000Z') / 3_600_000;

test('proof records only positive output in distinct absolute UTC hours', () => {
  let hours: number[] = [];
  for (const [timestamp, output] of [
    [Date.parse('2026-10-25T00:10:00.000Z'), 1],
    [Date.parse('2026-10-25T00:55:00.000Z'), 9],
    [Date.parse('2026-10-25T01:10:00.000Z'), 0],
    [Date.parse('2026-10-25T01:20:00.000Z'), 1],
  ]) {
    hours = addCodexOutputHour(hours, timestamp, output)!;
  }
  assert.deepEqual(hours, [firstHour, firstHour + 1]);
  assert.deepEqual(addCodexOutputHour(hours, Number.NaN, 1), hours);
  assert.deepEqual(addCodexOutputHour(hours, firstHour * 3_600_000, Number.NaN), hours);
});

test('owned hour proof can grow in place without copying every historical hour', () => {
  const hours = [firstHour];
  const owned = hours;
  assert.equal(addCodexOutputHourInPlace(hours, (firstHour + 2) * 3_600_000, 1), true);
  assert.equal(hours, owned);
  assert.equal(addCodexOutputHourInPlace(hours, (firstHour + 1) * 3_600_000, 1), true);
  assert.deepEqual(hours, [firstHour, firstHour + 1, firstHour + 2]);
  assert.equal(addCodexOutputHourInPlace(hours, (firstHour + 1) * 3_600_000, 1), true);
  assert.equal(hours.length, 3);
});

test('proof parser rejects unknown, unsorted, oversized and privacy-bearing input', () => {
  const valid = {
    version: CODEX_UTC_HOUR_PROOF_VERSION,
    indexedThrough: 800,
    prefixEvents: 0,
    hours: [firstHour, firstHour + 1],
    path: 'must-not-survive',
  };
  assert.deepEqual(sanitizeCodexHourProof(valid), {
    version: CODEX_UTC_HOUR_PROOF_VERSION,
    indexedThrough: 800,
    prefixEvents: 0,
    hours: [firstHour, firstHour + 1],
  });
  assert.equal(sanitizeCodexHourProof({ ...valid, version: 99 }), undefined);
  assert.equal(sanitizeCodexHourProof({ ...valid, hours: [firstHour + 1, firstHour] }), undefined);
  assert.equal(sanitizeCodexHourProof({ ...valid, hours: [firstHour, firstHour] }), undefined);
  assert.equal(sanitizeCodexHourProof({ ...valid, hours: [firstHour, -1] }), undefined);
  assert.equal(sanitizeCodexHourProof({ ...valid, indexedThrough: Number.MAX_SAFE_INTEGER + 1 }), undefined);
  assert.equal(sanitizeCodexHourProof({ ...valid, hours: Array(MAX_CODEX_HOURS_PER_FILE + 1).fill(firstHour) }), undefined);
});

test('canonical union fails closed until every current file and identity is proven', () => {
  const proof = (hours: number[]) => ({
    version: CODEX_UTC_HOUR_PROOF_VERSION,
    indexedThrough: 800,
    prefixEvents: 0,
    hours,
  });
  const files = {
    active: { offset: 800, size: 800, discardingOversizedLine: false, qualityFlags: [], identityChecked: true,
      lineage: { appliedPrefixEvents: 0, desiredPrefixEvents: 0 }, hourProof: proof([firstHour]) },
    archive: { offset: 800, size: 800, discardingOversizedLine: false, qualityFlags: [], identityChecked: true,
      lineage: { appliedPrefixEvents: 0, desiredPrefixEvents: 0 }, hourProof: proof([firstHour + 1]) },
  };
  assert.deepEqual(canonicalCodexOutputHours(files, new Set(['active', 'archive']), true), {
    complete: true, hours: [firstHour, firstHour + 1], provenFiles: 2, totalFiles: 2,
  });
  assert.deepEqual(canonicalCodexOutputHours(files, new Set(['active']), true).hours, [firstHour]);
  assert.deepEqual(canonicalCodexOutputHours(files, new Set(['active', 'archive']), false).hours, []);
  assert.deepEqual(canonicalCodexOutputHours({ ...files, archive: { ...files.archive, hourProof: undefined } },
    new Set(['active', 'archive']), true).hours, []);
  assert.deepEqual(canonicalCodexOutputHours({ ...files, active: { ...files.active, size: 801 } },
    new Set(['active', 'archive']), true).hours, []);
  assert.deepEqual(canonicalCodexOutputHours({ ...files, active: { ...files.active,
    lineage: { appliedPrefixEvents: 0, desiredPrefixEvents: 1 } } },
    new Set(['active', 'archive']), true).hours, []);
});
