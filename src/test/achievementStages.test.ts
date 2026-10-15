import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { API_ACHIEVEMENT_DEFINITIONS, API_ACHIEVEMENT_SERIES, isAchievementMoneyId } from '../achievementMoneyCatalog';

const stages = require('../achievementStages') as any;

test('approved Token ladders gain display-only integer stages without changing formal awards', () => {
  for (const [series, expected] of Object.entries({
    'astra-regular': [50e6, 100e6, 200e6, 1e9, 2e9, 10e9, 20e9],
    'sol-regular': [100e6, 200e6, 500e6, 2e9, 5e9, 20e9, 50e9],
    'luna-regular': [10e6, 20e6, 50e6, 200e6, 500e6, 2e9, 5e9],
    'cumulative-volume': [10e6, 20e6, 50e6, 200e6, 500e6, 2e9, 5e9, 20e9, 50e9, 200e9, 500e9],
    'weekly-volume': [50e6, 100e6, 200e6, 1e9, 5e9], 'weekly-average': [50e6, 100e6, 200e6, 1e9],
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

test('Claude first-tier stages show positive evidenced progress without creating an award', () => {
  const before = JSON.stringify({ definitions: ACHIEVEMENT_DEFINITIONS, series: ACHIEVEMENT_SERIES });
  for (const [series, expected] of Object.entries({
    'sonnet-main': [10e6, 20e6, 50e6], 'opus-cannon': [10e6, 20e6, 50e6],
    'haiku-worker': [1e6, 2e6, 5e6], 'fable-volume': [5e6, 10e6, 20e6],
    'claude-output': [200e3, 500e3, 1e6], 'cache-wizard': [10e6, 20e6, 50e6],
    'claude-cache-creation': [1e6, 2e6, 5e6],
  })) {
    const first = ACHIEVEMENT_DEFINITIONS.find(rule => rule.id === ACHIEVEMENT_SERIES[series][0])!.target;
    assert.deepEqual(stages.achievementStages(series).filter((value: number) => value < first), expected, series);
    assert.equal(stages.nextAchievementStage(series, 0, first, true), undefined, 'no goal without any progress');
    assert.equal(stages.nextAchievementStage(series, 1, first, true), expected[0], series);
    for (const [index, value] of expected.entries()) {
      assert.equal(stages.nextAchievementStage(series, value - 1, first, true), value);
      assert.equal(stages.nextAchievementStage(series, value, first, true), expected[index + 1]);
      assert.equal(stages.nextAchievementStage(series, value - 1, first, false), undefined, 'pending or stale');
    }
    assert.equal(stages.nextAchievementStage(series, first, first, true), undefined);
    assert.equal(stages.nextAchievementStage(series, 1, first - 1, true), undefined, 'not a formal target');
  }
  for (const series of ['claude-output-sessions', 'fable-sessions', 'sonnet-days', 'active-weeks', '__unknown__']) {
    assert.deepEqual(stages.achievementStages(series), [], 'no unapproved counter stages');
    assert.equal(stages.nextAchievementStage(series, 1, 10, true), undefined);
  }
  assert.equal(JSON.stringify({ definitions: ACHIEVEMENT_DEFINITIONS, series: ACHIEVEMENT_SERIES }), before);
});

test('six monetary series expose only integer 2×/5× stages strictly between formal awards', () => {
  const before = JSON.stringify({ definitions: ACHIEVEMENT_DEFINITIONS, series: ACHIEVEMENT_SERIES });
  assert.equal(API_ACHIEVEMENT_DEFINITIONS.length, 24);
  assert.equal(Object.keys(API_ACHIEVEMENT_SERIES).length, 6);
  const expectedByScope = {
    cumulative: [200, 500, 2_000, 5_000, 20_000, 50_000],
    completedMondayWeekPeak: [200, 1_000, 2_000, 5_000, 20_000],
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

test('display stages stay positive, unique and below the last formal tier even at maximum progress', () => {
  for (const [series, ids] of Object.entries(ACHIEVEMENT_SERIES)) {
    const values: number[] = stages.achievementStages(series);
    if (!values.length) continue;
    const formal = ids.map(id => ACHIEVEMENT_DEFINITIONS.find(rule => rule.id === id)!.target);
    const maximum = formal[formal.length - 1];
    assert.ok(values.every(value => Number.isSafeInteger(value) && value > 0 && value < maximum), series);
    assert.deepEqual(values, [...new Set(values)].sort((a, b) => a - b), series);
    assert.ok(values.every(value => !formal.includes(value)), 'a stage is never a formal tier');
    for (const progress of [maximum, maximum + 1, Number.MAX_SAFE_INTEGER]) {
      assert.equal(stages.nextAchievementStage(series, progress, maximum, true), undefined, series);
    }
    assert.equal(stages.nextAchievementStage(series, Number.MAX_SAFE_INTEGER, maximum + 1, true), undefined);
  }
});
