import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  achievementCurrentValue,
  compactAchievementLevelNotes,
} from '../achievementDetailPresentation';

test('detail notes share a complete identical condition once without mutating input', () => {
  const note = 'Each family: ≥10M processed AND ≥20K output; verified usage only.';
  const notes = Object.freeze([note, note, note]);
  assert.deepEqual(compactAchievementLevelNotes(notes), {
    shared: note, perLevel: [undefined, undefined, undefined],
  });
  assert.deepEqual(notes, [note, note, note]);
});

test('detail notes preserve unique joint conditions, including shared clauses', () => {
  const notes = [
    'Each tier: ≥100M processed AND ≥100K output across ≥5 tasks.',
    'Each tier: ≥500M processed AND ≥500K output across ≥10 tasks.',
    'Each tier: ≥2B processed AND ≥2M output across ≥30 tasks.',
  ];
  assert.deepEqual(compactAchievementLevelNotes(notes), { perLevel: notes });
});

test('detail notes preserve partial duplicates and multiple duplicate groups', () => {
  for (const notes of [['A', 'A', 'B'], ['A', 'A', 'B', 'B']]) {
    assert.deepEqual(compactAchievementLevelNotes(notes), { perLevel: notes });
  }
});

test('detail notes do not infer a shared condition for levels with missing notes', () => {
  for (const notes of [[undefined, 'A', 'A'], ['A', undefined, 'A'], ['A', 'A', undefined]]) {
    assert.deepEqual(compactAchievementLevelNotes(notes), { perLevel: notes });
  }
});

test('detail notes leave empty, blank, missing and single-level notes in place', () => {
  for (const notes of [[], [undefined, undefined], ['', ''], [' \t', ' \t'], ['A']]) {
    const result = compactAchievementLevelNotes(notes);
    assert.deepEqual(result, { perLevel: notes });
    assert.notEqual(result.perLevel, notes);
  }
});

test('detail notes compare exact strings without whitespace or Unicode normalization', () => {
  for (const notes of [['A', ' A'], ['A', 'A '], ['é', 'e\u0301']]) {
    assert.deepEqual(compactAchievementLevelNotes(notes), { perLevel: notes });
  }
  assert.deepEqual(compactAchievementLevelNotes([' A ', ' A ']), {
    shared: ' A ', perLevel: [undefined, undefined],
  });
});

test('detail notes retain reference-price version information verbatim', () => {
  const v1 = 'API-equivalent estimate; reference prices v2026-09-01.';
  const v2 = 'API-equivalent estimate; reference prices v2026-10-01.';
  assert.deepEqual(compactAchievementLevelNotes([v1, v1, v1]), {
    shared: v1, perLevel: [undefined, undefined, undefined],
  });
  assert.deepEqual(compactAchievementLevelNotes([v1, v1, v2]), { perLevel: [v1, v1, v2] });
});

test('detail current value preserves zero and progress below, at and above target', () => {
  for (const progress of [0, 3, 10, 27, Number.MAX_SAFE_INTEGER]) {
    assert.equal(achievementCurrentValue({ progress, target: 10 }, true), progress);
  }
  assert.equal(achievementCurrentValue({ progress: 0, target: 0 }, true), 0);
});

test('detail current value preserves integer microUSD without conversion or target clipping', () => {
  assert.equal(achievementCurrentValue({ progress: 123_456_789, target: 100_000_000 }, true), 123_456_789);
});

test('detail current value rejects malformed progress instead of rounding or substituting target', () => {
  const invalid: unknown[] = [
    undefined, null, '12', '', true, false, {}, [],
    -1, -0.5, 0.5, 12.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
  ];
  for (const progress of invalid) {
    assert.equal(achievementCurrentValue({ progress: progress as number, target: 10 }, true), undefined);
  }
});

test('detail current value tolerates a missing result from a malformed runtime payload', () => {
  for (const result of [undefined, null, {}, { target: 10 }]) {
    assert.equal(achievementCurrentValue(result as { progress: number; target: number }, true), undefined);
  }
});

test('detail current value hides stale values including zero and over-target progress', () => {
  for (const progress of [0, 3, 10, 27]) {
    assert.equal(achievementCurrentValue({ progress, target: 10 }, false), undefined);
  }
});

test('detail current value requires explicitly ready data', () => {
  for (const ready of [undefined, null, 1, 'true']) {
    assert.equal(achievementCurrentValue({ progress: 27, target: 10 }, ready as unknown as boolean), undefined);
  }
});

test('detail current value does not infer progress from a previously awarded maximum level', () => {
  const result = Object.freeze({ progress: 3, target: 10, unlocked: true, level: 'gold' });
  assert.equal(achievementCurrentValue(result, true), 3);
  assert.equal(achievementCurrentValue(result, false), undefined);
  assert.equal(result.progress, 3);
});
