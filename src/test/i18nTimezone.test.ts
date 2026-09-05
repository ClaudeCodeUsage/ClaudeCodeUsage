import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import { CODEX_COPY_EN } from '../codexView';

test('a valid IANA zone is accepted', () => {
  I18n.setTimezone('Asia/Hong_Kong');
  assert.equal(I18n.getTimezone(), 'Asia/Hong_Kong');
});

test('an invalid zone falls back to system (empty), never crashes (#51)', () => {
  I18n.setTimezone('EST-5 Detroit'); // what the bug reporter typed
  assert.equal(I18n.getTimezone(), '');
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en', I18n.dateFormatOptions()));
});

test('empty stays empty (system zone)', () => {
  I18n.setTimezone('');
  assert.equal(I18n.getTimezone(), '');
});

test('isValidTimeZone distinguishes real zones from junk', () => {
  assert.equal(I18n.isValidTimeZone('America/New_York'), true);
  assert.equal(I18n.isValidTimeZone('UTC'), true);
  assert.equal(I18n.isValidTimeZone('EST-5 Detroit'), false);
});

test('every locale implements complete non-English Codex product copy', () => {
  const languages = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'] as const;
  const userFacingKeys = [
    'title', 'refresh', 'overview', 'explore', 'recommendations', 'noMonthlyData',
    'coverage', 'usageLimits', 'fiveHourWindow', 'weeklyWindow', 'used',
    'remaining', 'localLogNotLive', 'observedSessionDuration', 'indexedLogEntries',
    'indexedStorage', 'indexedAllTime', 'updatedAt', 'claudeTokenAccounting',
    'codexTokenAccounting', 'apiEquivalentCost', 'apiEquivalentCostHelp',
  ] as const;
  const previous = I18n.getCurrentLanguage();
  try {
    for (const language of languages) {
      I18n.setLanguage(language);
      const copy = I18n.t.providers.codex;
      assert.deepEqual(Object.keys(copy).sort(), Object.keys(CODEX_COPY_EN).sort(), language);
      if (language !== 'en') {
        for (const key of userFacingKeys) {
          assert.notEqual(copy[key], CODEX_COPY_EN[key], `${language}.${key} fell back to English`);
        }
      }
    }
  } finally {
    I18n.setLanguage(previous);
  }
});

test('Chinese Codex product copy preserves the overview, exploration, optimization, limits, local-log, and proxy meanings', () => {
  const previous = I18n.getCurrentLanguage();
  try {
    for (const language of ['zh-TW', 'zh-CN'] as const) {
      I18n.setLanguage(language);
      const copy = I18n.t.providers.codex;
      const product = Object.values(copy).filter((value): value is string => typeof value === 'string').join(' ');
      for (const meaning of language === 'zh-CN'
        ? ['概览', '探索', '优化建议', '5 小时', '每周', '已用', '剩余', '本地日志', '非实时', '代理']
        : ['總覽', '探索', '最佳化建議', '5 小時', '每週', '已用', '剩餘', '本機', '非即時', '代理']) {
        assert.match(product, new RegExp(meaning), `${language} missing ${meaning}`);
      }
    }
  } finally {
    I18n.setLanguage(previous);
  }
});
