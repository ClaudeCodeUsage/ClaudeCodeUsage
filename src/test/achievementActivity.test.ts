import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  emptyAchievementActivity,
  migrateAchievementActivityV1,
  parseAchievementActivity,
  recordAchievementSettingChange,
  recordAchievementFeature,
} from '../achievementActivity';

test('setting exploration counts only distinct saved user changes from a safe allowlist', () => {
  const start = emptyAchievementActivity();
  const first = recordAchievementSettingChange(start, 'language', true);
  assert.deepEqual(first.settingKeys, ['language']);
  assert.equal(recordAchievementSettingChange(first, 'language', true), first);
  assert.equal(recordAchievementSettingChange(first, 'timezone', false), first);
  assert.equal(recordAchievementSettingChange(first, 'advice.apiKey', true), first);
  assert.equal(recordAchievementSettingChange(first, 'advice.promptPersonalizationConsent', true), first);
  assert.equal(recordAchievementSettingChange(first, 'showAchievementNotices', true), first,
    'quiet-notice opt-out must not count as exploration');
  assert.deepEqual(recordAchievementSettingChange(first, 'displayCurrency', true).settingKeys,
    ['displayCurrency', 'language']);
  assert.deepEqual(start.settingKeys, []);
});

test('feature evidence records a successful local export once without a target or payload', () => {
  const exported = recordAchievementFeature(emptyAchievementActivity(), 'localShareExport');
  assert.deepEqual(exported.features, ['localShareExport']);
  assert.equal(recordAchievementFeature(exported, 'localShareExport'), exported);
  assert.deepEqual(Object.keys(exported).sort(), ['features', 'schemaVersion', 'settingKeys']);
});

test('safe feature inventory counts deliberate gallery and share preview separately', () => {
  const gallery = recordAchievementFeature(emptyAchievementActivity(), 'achievementGalleryViewed');
  const preview = recordAchievementFeature(gallery, 'achievementSharePreview');
  assert.deepEqual(preview.features, ['achievementGalleryViewed', 'achievementSharePreview']);
});

test('activity hydration is versioned, bounded and strips unknown or secret-bearing fields', () => {
  assert.deepEqual(parseAchievementActivity({ schemaVersion: 99, settingKeys: ['language'] }),
    emptyAchievementActivity());
  assert.deepEqual(parseAchievementActivity({
    schemaVersion: 2,
    settingKeys: ['language', 'language', 'advice.apiKey', '../auth.json', 'timezone'],
    features: ['localShareExport', 'localShareExport', 'publishToGitHub'],
    key: 'must-not-survive', path: '/private/input',
  }), {
    schemaVersion: 2,
    settingKeys: ['language', 'timezone'],
    features: ['localShareExport'],
  });
});

test('legacy preview evidence is not carried into deliberate feature awards', () => {
  const migrated = migrateAchievementActivityV1({
    schemaVersion: 1,
    settingKeys: ['language', 'timezone'],
    features: ['achievementGalleryViewed', 'achievementSharePreview', 'localShareExport'],
  });
  assert.deepEqual(migrated, {
    schemaVersion: 2,
    settingKeys: ['language', 'timezone'],
    features: ['achievementGalleryViewed', 'localShareExport'],
  });
});
