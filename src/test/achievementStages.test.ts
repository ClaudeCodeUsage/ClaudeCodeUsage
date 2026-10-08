import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';

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
  assert.equal(ACHIEVEMENT_DEFINITIONS.length, 124);
  assert.deepEqual(stages.achievementStages('effort-breadth'), [], 'no tiny counter filler');
  assert.deepEqual(stages.achievementStages('settings-explorer'), [], 'do not encourage settings farming');
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
