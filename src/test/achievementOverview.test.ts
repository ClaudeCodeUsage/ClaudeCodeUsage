import { test } from 'node:test';
import * as assert from 'node:assert/strict';

const overview = require('../achievementOverview') as any;
const row = (key: string, extra: Record<string, unknown> = {}) => ({
  key, group: 'codex', earnedLevel: 1, earned: true, next: true,
  progress: 600e6, target: 5e9, proof: 'ready', ...extra,
});

test('next goals use display-stage progress, distinct topics and only known positive evidence', () => {
  const rows = [row('astra-regular'), row('sol-regular', { progress: 2e9, target: 10e9 }),
    row('weekly-volume', { group: 'combined', progress: 950e6, target: 2e9 }),
    row('weekly-average', { group: 'combined', progress: 900e6, target: 2e9 }),
    row('settings-explorer', { group: 'plugin', progress: 9, target: 10 }),
    row('safe-feature-explorer', { group: 'plugin', progress: 9, target: 10 }),
    row('luna-regular', { progress: 0 }), row('codex-output', { proof: 'pending' }),
    row('codex-cache-read', { proof: 'stale' }), row('agent-team', { next: false }),
    row('__unknown__'), row('active-days', { progress: NaN })];
  const chosen = overview.selectAchievementOverview(rows, 'codex');
  assert.deepEqual(chosen.next, ['weekly-volume', 'settings-explorer', 'astra-regular']);
  assert.equal(chosen.next.length, 3);
  assert.deepEqual(overview.selectAchievementOverview([...rows].reverse(), 'codex'), chosen,
    'ties are canonical, independent of incoming snapshot order');
  assert.deepEqual(overview.selectAchievementOverview([row('luna-regular', { progress: 0 })], 'codex').next, []);
});

test('representatives prioritize earned rank, then current provider, without inventing recent dates', () => {
  const rows = [row('astra-regular', { earnedLevel: 2 }),
    row('sol-regular', { earnedLevel: 3 }),
    row('sonnet-main', { group: 'claude', earnedLevel: 3 }),
    row('cumulative-volume', { group: 'combined', earnedLevel: 5, next: false }),
    row('weekly-volume', { group: 'combined', earnedLevel: 2, proof: 'stale' }),
    row('local-share-export', { group: 'plugin', earned: false, earnedLevel: 0 })];
  assert.deepEqual(overview.selectAchievementOverview(rows, 'claude').badges,
    ['cumulative-volume', 'sonnet-main', 'weekly-volume']);
  assert.deepEqual(overview.selectAchievementOverview(rows, 'codex').badges,
    ['cumulative-volume', 'sol-regular', 'weekly-volume']);
  assert.deepEqual(overview.selectAchievementOverview([], 'codex'), { badges: [], next: [] });
});

test('in-view selection stays fixed through progress changes and drops invalid goals without replacing them', () => {
  const initial = [row('astra-regular'), row('codex-output', { progress: 1, target: 10 })];
  const chosen = overview.selectAchievementOverview(initial, 'codex');
  const changed = [...initial, row('weekly-volume', { group: 'combined', progress: 1e9 - 1, target: 2e9 })];
  changed[0] = row('astra-regular', { proof: 'stale' });
  const retained = overview.retainAchievementOverview(chosen, changed);
  assert.deepEqual(retained.next, ['codex-output']);
  assert.ok(retained.badges.includes('astra-regular'), 'earned history survives proof expiry');
  assert.ok(!retained.next.includes('weekly-volume'), 'no live reorder/replacement');
  assert.ok(overview.selectAchievementOverview(changed, 'codex').next.includes('weekly-volume'),
    'a deliberate new selection can include the new goal');
});
