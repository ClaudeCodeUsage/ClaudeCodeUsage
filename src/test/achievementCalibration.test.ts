import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, evaluateAchievements } from '../achievements';
const rules = require('../achievements') as any;

test('calibrated volume ladders leave sustained high-use milestones beyond entry tiers', () => {
  const expected: Record<string, number[]> = {
    'sol-regular': [1e9, 1e10, 1e11], 'astra-regular': [5e8, 5e9, 5e10], 'luna-regular': [1e8, 1e9, 1e10],
    'sonnet-main': [1e8, 1e9, 1e10], 'opus-cannon': [1e8, 1e9, 1e10], 'haiku-worker': [1e7, 1e8, 1e9],
    'fable-volume': [5e7, 5e8, 5e9], 'cache-wizard': [1e8, 1e9, 1e10],
    'claude-cache-creation': [1e7, 1e8, 1e9], 'claude-output': [2e6, 2e7, 2e8],
    'codex-output': [5e6, 5e7, 5e8], 'codex-cache-read': [1e9, 1e10, 1e11],
    'weekly-volume': [5e8, 2e9, 1e10], 'weekly-average': [5e8, 2e9, 5e9], 'model-rainbow': [2, 5, 7],
  };
  for (const [series, targets] of Object.entries(expected)) {
    assert.deepEqual(ACHIEVEMENT_SERIES[series].map(id => ACHIEVEMENT_DEFINITIONS.find(rule => rule.id === id)!.target), targets, series);
  }
});

test('candidate calibration remaps only volume proof, never carries a changed calendar condition', () => {
  assert.equal(typeof rules.migrateCalibratedAchievementGrants, 'function');
  const migrated = rules.migrateCalibratedAchievementGrants([
    'sol-regular-gold', 'astra-regular-gold', 'sonnet-main-gold', 'haiku-worker-gold',
    'codex-output-bronze', 'claude-cache-creation-silver', 'active-weeks-gold',
    'fable-days-gold', 'three-family-day', 'local-share-export', 'hundred-billion-token-club', 'unknown',
  ]);
  assert.deepEqual(migrated, [
    'astra-regular', 'astra-regular-silver', 'claude-cache-creation-bronze',
    'claude-cache-creation-gold', 'claude-cache-creation-silver',
    'haiku-worker', 'haiku-worker-silver', 'hundred-billion-token-club',
    'local-share-export', 'sol-regular', 'sol-regular-silver', 'sonnet-main', 'sonnet-main-silver',
  ].sort());
  assert.deepEqual(rules.migrateCalibratedAchievementGrants(null), []);
});

test('Fable completes the seven-family rainbow without proxy-name or output-day fallback', () => {
  const facts: any = {
    claudeTokens: 0, codexTokens: 0, activeDays: 0, claudeFamilies: [],
    claudeFamilyTokens: { sonnet: 500_000, opus: 500_000, haiku: 500_000 },
    fable: { processedTokens: 500_000, activeDays: 200 },
    calendar: { familyDays: { fable: 6 } },
    codex: { familyProcessedTokens: { astra: 500_000, sol: 500_000, luna: 500_000 }, modelCount: 0, efforts: [] },
  };
  const read = () => new Map(evaluateAchievements(facts).map(row => [row.id, row]));
  assert.equal(read().get('model-rainbow-gold')!.unlocked, true);
  assert.equal(read().get('fable-days-bronze')!.unlocked, false, 'unqualified old output days cannot substitute calendar proof');
  facts.calendar.familyDays.fable = 7;
  assert.equal(read().get('fable-days-bronze')!.unlocked, true);
  facts.fable.processedTokens = 499_999;
  assert.equal(read().get('model-rainbow-gold')!.unlocked, false);
});
