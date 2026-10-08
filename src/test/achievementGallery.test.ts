import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { ACHIEVEMENT_GALLERY, achievementGalleryKey } from '../achievementGallery';

test('gallery gives all 124 formal rules exactly one detail position in 44 display themes', () => {
  const before = JSON.stringify([ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES]);
  const ids = ACHIEVEMENT_GALLERY.flatMap(entry => [...entry.levelIds, ...entry.milestoneIds]);
  assert.equal(ACHIEVEMENT_GALLERY.length, 44);
  assert.equal(new Set(ids).size, 124);
  assert.deepEqual(ids.sort(), ACHIEVEMENT_DEFINITIONS.map(rule => rule.id).sort());
  for (const entry of ACHIEVEMENT_GALLERY) {
    for (const id of [entry.key, ...entry.levelIds, ...entry.milestoneIds]) {
      assert.equal(achievementGalleryKey(id), entry.key);
    }
  }
  assert.equal(JSON.stringify([ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES]), before);
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
