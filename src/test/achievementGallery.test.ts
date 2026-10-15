import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { ACHIEVEMENT_GALLERY, achievementGalleryKey } from '../achievementGallery';
import * as gallery from '../achievementGallery';
import { API_ACHIEVEMENT_DEFINITIONS, API_ACHIEVEMENT_SERIES } from '../achievementMoneyCatalog';

test('current statistics destinations are provider-bound and never substitute shared or calendar evidence', () => {
  const destination = (gallery as any).achievementStatisticsDestination;
  assert.equal(typeof destination, 'function');
  for (const [provider, key, family] of [
    ['claude', 'sonnet-main', 'sonnet'], ['claude', 'opus-cannon', 'opus'],
    ['claude', 'haiku-worker', 'haiku'], ['claude', 'fable-volume', 'fable'],
    ['codex', 'astra-regular', 'astra'], ['codex', 'sol-regular', 'sol'], ['codex', 'luna-regular', 'luna'],
  ]) {
    assert.deepEqual(destination(key, provider), { section: 'models', family });
    assert.equal(destination(key, provider === 'claude' ? 'codex' : 'claude'), undefined);
  }
  for (const key of ['cache-wizard', 'claude-output', 'claude-cache-creation'])
    assert.deepEqual(destination(key, 'claude'), { section: 'tokens' });
  for (const key of ['codex-output', 'codex-cache-read'])
    assert.deepEqual(destination(key, 'codex'), { section: 'tokens' });
  for (const provider of ['claude', 'codex', 'compare', '', '__proto__'])
    for (const key of ['weekly-volume', 'cumulative-volume', 'weekly-average', 'active-day-streak',
      'dual-provider-day', 'output-hours', 'safe-feature-explorer', 'effort-breadth', 'unknown', '__proto__', 'constructor'])
      assert.equal(destination(key, provider), undefined);
});

test('gallery gives every current rule exactly one detail position in its display theme', () => {
  const before = JSON.stringify([ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES]);
  const ids = ACHIEVEMENT_GALLERY.flatMap(entry => [...entry.levelIds, ...entry.milestoneIds]);
  const seriesFor = new Map(Object.entries(ACHIEVEMENT_SERIES).flatMap(([key, levels]) => levels.map(id => [id, key] as const)));
  const milestoneOwners = new Map([['streak-machine', 'active-day-streak'], ['dual-provider-day', 'dual-provider-days']]);
  const expectedKeys = new Set(ACHIEVEMENT_DEFINITIONS.map(rule => milestoneOwners.get(rule.id) ?? seriesFor.get(rule.id) ?? rule.id));
  assert.deepEqual(ACHIEVEMENT_GALLERY.map(entry => entry.key).sort(), [...expectedKeys].sort());
  assert.equal(ids.length, ACHIEVEMENT_DEFINITIONS.length);
  assert.equal(new Set(ids).size, ACHIEVEMENT_DEFINITIONS.length);
  assert.deepEqual(ids.sort(), ACHIEVEMENT_DEFINITIONS.map(rule => rule.id).sort());
  for (const entry of ACHIEVEMENT_GALLERY) {
    for (const id of [entry.key, ...entry.levelIds, ...entry.milestoneIds]) {
      assert.equal(achievementGalleryKey(id), entry.key);
    }
  }
  assert.equal(JSON.stringify([ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES]), before);
});

test('money rules own twenty-four detail positions in six themes with four total and five weekly tiers', () => {
  const moneyThemes = ACHIEVEMENT_GALLERY.filter(entry => Object.hasOwnProperty.call(API_ACHIEVEMENT_SERIES, entry.key));
  assert.equal(moneyThemes.length, 6);
  assert.deepEqual(moneyThemes.map(entry => entry.key).sort(), [
    'claude-api-session', 'claude-api-total', 'claude-api-week',
    'codex-api-task', 'codex-api-total', 'codex-api-week',
  ]);
  const ids = moneyThemes.flatMap(entry => [...entry.levelIds, ...entry.milestoneIds]);
  assert.equal(ids.length, 24);
  assert.equal(new Set(ids).size, 24);
  assert.deepEqual(ids.sort(), API_ACHIEVEMENT_DEFINITIONS.map(rule => rule.id).sort());
  for (const entry of moneyThemes) {
    const tiers = entry.key.endsWith('-week') ? ['bronze', 'silver', 'gold', 'platinum', 'legendary'] :
      entry.key.endsWith('-total') ? ['bronze', 'silver', 'gold', 'platinum'] : ['bronze', 'silver', 'gold'];
    assert.deepEqual(entry.levelIds, tiers.map(tier => `${entry.key}-${tier}`));
    assert.deepEqual(entry.milestoneIds, []);
  }
});

test('legacy milestone display aliases do not invent a tier or accept unknown keys', () => {
  assert.equal(achievementGalleryKey('streak-machine'), 'active-day-streak');
  assert.equal(achievementGalleryKey('dual-provider-day'), 'dual-provider-days');
  for (const key of ['active-day-streak', 'dual-provider-days']) {
    const entry = ACHIEVEMENT_GALLERY.find(entry => entry.key === key)!;
    assert.equal(entry.levelIds.length, 3);
    assert.equal(entry.milestoneIds.length, 1);
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.levelIds) && Object.isFrozen(entry.milestoneIds));
  }
  for (const key of ['', 'unknown', '__proto__', 'constructor', 'toString']) {
    assert.equal(achievementGalleryKey(key), undefined);
  }
});
