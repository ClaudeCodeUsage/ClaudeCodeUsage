import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { I18n } from '../i18n';
import type { SupportedLanguage } from '../types';

const locales: SupportedLanguage[] = ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'];
const reasons = [
  'estimateAccountUnknown', 'estimatePartialPricing', 'estimateBoundarySplit',
  'estimatePartialHistory', 'estimateObservationChanged',
] as const;
const chartFields = ['chartUsedValue', 'chartUnusedValue', 'chartEstimateNote'] as const;
const estimateMarkers: Record<SupportedLanguage, RegExp> = {
  en: /estimate/i, 'de-DE': /schätz/i, 'zh-TW': /估值/, 'zh-CN': /估值/,
  ja: /推定/, ko: /추정/, 'pt-BR': /estimad/i, id: /estimasi/i,
};

for (const locale of locales) {
  test(`weekly estimate copy has factual reasons, chart copy and explicit estimate headings: ${locale}`, () => {
    const previous = I18n.getCurrentLanguage();
    try {
      I18n.setLanguage(locale);
      const copy = I18n.t.weeklyValue;
      for (const key of [...reasons, ...chartFields]) {
        const value: unknown = Reflect.get(copy, key);
        assert.equal(typeof value, 'string', `${locale}.${key}`);
        assert.ok((value as string).trim(), `${locale}.${key} must not be empty`);
      }
      assert.equal(copy.fullValue, copy.estimateFull, 'both tables label total estimates consistently');
      assert.equal(copy.unusedValue, copy.estimateUnused, 'both tables label unused estimates consistently');
      for (const key of ['fullValue', 'estimateFull', 'unusedValue', 'estimateUnused', 'estimateUsed'] as const) {
        assert.match(copy[key], estimateMarkers[locale], `${locale}.${key} identifies an estimate`);
        assert.doesNotMatch(copy[key], /≈/, 'estimate meaning belongs in words in the heading');
      }
      assert.equal(Reflect.get(copy, 'chartUsedValue'), copy.usedValue);
      assert.equal(Reflect.get(copy, 'chartUnusedValue'), copy.estimateUnused);
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
    assert.equal(copy.estimateFull, '周期总额（估值）');
    assert.equal(copy.estimateUnused, '未用估值');
    assert.equal(copy.estimateUsed, '样本估值');
    assert.equal(copy.roughEstimate, '粗略换算');
    assert.equal(copy.estimateBlocked, '暂无可用换算样本');
    assert.match(copy.description, /已定价.*额度比例.*粗略换算/);
    assert.match(copy.description, /不按 Token.*补价/);
    assert.match(copy.boundaryApproximation, /时间重叠.*均匀.*并非精确/);
    assert.match(copy.estimateNote, /计数变化.*分段/);
    assert.match(copy.estimateNote, /配对.*校准区间增量/);
    assert.match(copy.estimateNote, /历史重建.*不是当时显示值/);
    assert.match(copy.historyFromLogs, /原始本机统计不变/);
    assert.match(copy.historyFromLogs, /已用.*未用.*估值/);
    assert.match(copy.historyFromLogs, /不能汇总为账单/);
    assert.match(copy.historyFromLogs, /各自观测/);
    const chartNote = Reflect.get(copy, 'chartEstimateNote') as string;
    assert.match(chartNote, /最新估值/);
    assert.match(chartNote, /蓝色已用.*绿色未用.*同一时点/);
    assert.match(chartNote, /无观测.*仅.*本机已用/);
    assert.match(chartNote, /重叠窗口.*不能相加/);
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
    assert.equal(copy.estimateFull, 'Cycle total (estimate)');
    assert.equal(copy.estimateUnused, 'Unused estimate');
    assert.equal(copy.estimateUsed, 'Sample estimate');
    assert.equal(copy.roughEstimate, 'Rough conversion');
    assert.equal(copy.estimateBlocked, 'No usable conversion sample');
    assert.match(copy.description, /priced.*quota percentages/i);
    assert.match(copy.description, /not extrapolated from token coverage/);
    assert.match(copy.boundaryApproximation, /time overlap.*uniform.*not an exact/i);
    assert.match(copy.estimateNote, /segment.*counter change/);
    assert.match(copy.estimateNote, /paired.*calibration-interval delta/i);
    assert.match(copy.estimateNote, /reconstructions are not values displayed at the time/);
    assert.match(copy.historyFromLogs, /original local statistics.*unchanged/i);
    assert.match(copy.historyFromLogs, /not.*bill/);
    const chartNote = Reflect.get(copy, 'chartEstimateNote') as string;
    assert.match(chartNote, /latest estimate/);
    assert.match(chartNote, /blue.*used.*green.*unused.*same observation/i);
    assert.match(chartNote, /no observation.*only local used/i);
    assert.match(chartNote, /overlapping windows.*not.*added/i);
    assert.doesNotMatch(copy.boundaryApproximation, /new estimates are blocked/);
  } finally {
    I18n.setLanguage(previous);
  }
});
