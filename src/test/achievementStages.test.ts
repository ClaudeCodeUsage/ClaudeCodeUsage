import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { API_ACHIEVEMENT_DEFINITIONS, API_ACHIEVEMENT_SERIES, isAchievementMoneyId } from '../achievementMoneyCatalog';

const stages = require('../achievementStages') as any;

test('approved Token ladders gain display-only integer stages without changing formal awards', () => {
  for (const [series, expected] of Object.entries({
    'astra-regular': [1e9, 2e9, 10e9, 20e9],
    'sol-regular': [2e9, 5e9, 20e9, 50e9],
    'luna-regular': [200e6, 500e6, 2e9, 5e9],
    'cumulative-volume': [200e6, 500e6, 2e9, 5e9, 20e9, 50e9, 200e9, 500e9],
    'weekly-volume': [1e9, 5e9], 'weekly-average': [1e9],
  })) {
    assert.deepEqual(stages.achievementStages(series), expected);
    const formal = new Set(ACHIEVEMENT_SERIES[series].map(id => ACHIEVEMENT_DEFINITIONS.find(rule => rule.id === id)!.target));
    assert.ok(expected.every(value => !formal.has(value)));
  }
  assert.equal(ACHIEVEMENT_DEFINITIONS.length,
    ACHIEVEMENT_DEFINITIONS.filter(rule => !isAchievementMoneyId(rule.id)).length + API_ACHIEVEMENT_DEFINITIONS.length);
  assert.deepEqual(stages.achievementStages('effort-breadth'), [], 'no tiny counter filler');
  assert.deepEqual(stages.achievementStages('settings-explorer'), [], 'do not encourage settings farming');
});

test('six monetary series expose only integer 2×/5× stages strictly between formal awards', () => {
  const before = JSON.stringify({ definitions: ACHIEVEMENT_DEFINITIONS, series: ACHIEVEMENT_SERIES });
  assert.equal(API_ACHIEVEMENT_DEFINITIONS.length, 20);
  assert.equal(Object.keys(API_ACHIEVEMENT_SERIES).length, 6);
  const expectedByScope = {
    cumulative: [200, 500, 2_000, 5_000, 20_000, 50_000],
    completedMondayWeekPeak: [200, 1_000, 2_000],
    maxSessionTask: [20, 50, 200, 500],
  };
  for (const [series, ids] of Object.entries(API_ACHIEVEMENT_SERIES)) {
    const formal = ids.map(id => API_ACHIEVEMENT_DEFINITIONS.find(rule => rule.id === id)!);
    const expected = expectedByScope[formal[0].scope].map(usd => usd * 1_000_000);
    assert.deepEqual(stages.achievementStages(series), expected, series);
    for (const value of expected) {
      assert.ok(Number.isSafeInteger(value));
      assert.ok(formal.some((rule, index) => index > 0 && value > formal[index - 1].target && value < rule.target), series);
      assert.ok(formal.every(rule => rule.target !== value), 'a stage is never a formal award');
    }
    assert.equal(stages.nextAchievementStage(series, 0, formal[0].target, true), undefined, 'no stages before first award');
    for (let index = 1; index < formal.length; index++) {
      const lower = formal[index - 1].target, upper = formal[index].target;
      const gap = expected.filter(value => value > lower && value < upper);
      assert.equal(stages.nextAchievementStage(series, lower, upper, true), gap[0], series);
      assert.equal(stages.nextAchievementStage(series, lower, upper, false), undefined, 'no stage without reliable evidence');
      assert.equal(stages.nextAchievementStage(series, upper, upper, true), undefined);
      for (const [stageIndex, value] of gap.entries()) {
        assert.equal(stages.nextAchievementStage(series, value - 1, upper, true), value);
        assert.equal(stages.nextAchievementStage(series, value, upper, true), gap[stageIndex + 1]);
      }
    }
    assert.equal(stages.nextAchievementStage(series, formal[0].target, formal[1].target - 1, true), undefined, 'formal target must match exactly');
  }
  assert.equal(JSON.stringify({ definitions: ACHIEVEMENT_DEFINITIONS, series: ACHIEVEMENT_SERIES }), before,
    'display stages never create IDs, awards or alter formal targets');
});

test('next stage crosses exact integer boundaries and never supplies proof or award authority', () => {
  const next = stages.nextAchievementStage;
  assert.equal(next('astra-regular', 600e6, 5e9, true), 1e9);
  assert.equal(next('astra-regular', 1e9 - 1, 5e9, true), 1e9);
  assert.equal(next('astra-regular', 1e9, 5e9, true), 2e9);
  assert.equal(next('astra-regular', 2e9, 5e9, true), undefined);
  assert.equal(next('astra-regular', 6e9, 50e9, true), 10e9);
  assert.equal(next('astra-regular', 20e9, 50e9, true), undefined);
  assert.equal(next('cumulative-volume', 150e9, 1e12, true), 200e9);
  assert.equal(next('cumulative-volume', 500e9, 1e12, true), undefined);
  assert.equal(next('luna-regular', 0, 100e6, true), undefined, 'no pre-bronze prizes');
  assert.equal(next('luna-regular', 150e6, 1e9, false), undefined, 'pending/stale evidence has no stage');
  for (const value of [-1, NaN, Infinity, 5.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(next('astra-regular', value, 5e9, true), undefined);
  }
  assert.equal(next('astra-regular', 600e6, 4e9, true), undefined, 'only actual formal targets');
  assert.equal(next('__unknown__', 600e6, 5e9, true), undefined);
});
