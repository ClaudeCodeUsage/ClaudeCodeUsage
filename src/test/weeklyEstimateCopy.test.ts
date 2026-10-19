import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import type { SupportedLanguage } from '../types';

const locales: SupportedLanguage[] = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
const reasons = [
  'estimateAccountUnknown', 'estimatePartialPricing', 'estimateBoundarySplit',
  'estimatePartialHistory', 'estimateObservationChanged',
] as const;

for (const locale of locales) {
  test(`weekly estimate copy has five factual reasons and consistent amount headings: ${locale}`, () => {
    const previous = I18n.getCurrentLanguage();
    try {
      I18n.setLanguage(locale);
      const copy = I18n.t.weeklyValue;
      for (const key of reasons) {
        const value: unknown = Reflect.get(copy, key);
        assert.equal(typeof value, 'string', `${locale}.${key}`);
        assert.ok((value as string).trim(), `${locale}.${key} must not be empty`);
      }
      assert.equal(copy.fullValue, copy.estimateFull, 'both tables label the total as a rough estimate');
      assert.equal(copy.unusedValue, copy.estimateUnused, 'both tables anchor unused estimates to observation');
    } finally {
      I18n.setLanguage(previous);
    }
  });
}

test('Chinese copy distinguishes factual caveats from an unavailable conversion sample', () => {
  const previous = I18n.getCurrentLanguage();
  try {
    I18n.setLanguage('zh-CN');
    const copy = I18n.t.weeklyValue;
    assert.equal(copy.estimateFull, '粗略总估价');
    assert.equal(copy.estimateUnused, '截至观测未用估价');
    assert.equal(copy.roughEstimate, '粗略换算');
    assert.equal(copy.estimateBlocked, '暂无可用换算样本');
    assert.match(copy.description, /已定价.*额度比例.*粗略换算/);
    assert.match(copy.description, /不按 Token.*补价/);
    assert.match(copy.boundaryApproximation, /时间重叠.*均匀.*并非精确/);
    assert.match(copy.estimateNote, /计数变化.*分段/);
    assert.match(copy.estimateNote, /配对.*校准区间增量/);
    assert.match(copy.estimateNote, /历史重建不是当时显示值/);
    assert.match(copy.historyFromLogs, /只计.*一次.*截至各自观测.*不能相加/);
    assert.match(copy.multiAccount, /未核实.*混用.*偏差/);
    assert.doesNotMatch(copy.boundaryApproximation, /停止新增|缺少精确/);
  } finally {
    I18n.setLanguage(previous);
  }
});

test('English copy describes rough samples, partial pricing and time splitting without claiming account capacity', () => {
  const previous = I18n.getCurrentLanguage();
  try {
    I18n.setLanguage('en');
    const copy = I18n.t.weeklyValue;
    assert.equal(copy.estimateFull, 'Rough total estimate');
    assert.equal(copy.estimateUnused, 'Unused estimate as observed');
    assert.equal(copy.roughEstimate, 'Rough conversion');
    assert.equal(copy.estimateBlocked, 'No usable conversion sample');
    assert.match(copy.description, /priced.*quota percentages/i);
    assert.match(copy.description, /not extrapolated from token coverage/);
    assert.match(copy.boundaryApproximation, /time overlap.*uniform.*not an exact/i);
    assert.match(copy.estimateNote, /segment.*counter change/);
    assert.match(copy.estimateNote, /paired.*calibration-interval delta/i);
    assert.match(copy.estimateNote, /reconstructions are not values displayed at the time/);
    assert.doesNotMatch(copy.boundaryApproximation, /new estimates are blocked/);
  } finally {
    I18n.setLanguage(previous);
  }
});
