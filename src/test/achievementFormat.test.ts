import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatAchievementCompact, formatAchievementInteger } from '../achievementFormat';

test('achievement labels stay integer and do not round unfinished progress up', () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'de-DE', 'ja-JP', 'ko-KR', 'pt-BR', 'id-ID']) {
    assert.equal(formatAchievementCompact(999_999_999, locale), '999M');
    assert.equal(formatAchievementCompact(1_000_000_000, locale), '1B');
    assert.equal(formatAchievementCompact(2_999_999, locale), '2M');
    assert.equal(formatAchievementCompact(9.9, locale), '9');
    assert.equal(formatAchievementCompact(1e12, locale), '1T');
    assert.equal(formatAchievementCompact(-1, locale), '0');
    assert.equal(formatAchievementCompact(Number.NaN, locale), '0');
    assert.equal(formatAchievementCompact(Number.POSITIVE_INFINITY, locale), '0');
    assert.equal(formatAchievementInteger(999_999_999, locale).replace(/\D/g, ''), '999999999');
  }
});
