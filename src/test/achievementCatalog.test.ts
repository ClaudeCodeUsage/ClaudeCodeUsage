import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { ACHIEVEMENT_IMAGE_FILES, achievementImageDataUrl } from '../achievementIcons';
import { createHash } from 'node:crypto';
import { achievementGalleryKey } from '../achievementGallery';

const { achievementCatalog, renderCatalogGroup, renderCatalogMarkdown } = require(resolve(
  __dirname, '../../tests/ui/support/achievement-catalog.cjs',
));

test('mobile review catalog covers every live rule exactly once without placeholder awards', () => {
  const catalog = achievementCatalog('zh-CN');
  const ids = catalog.flatMap((card: any) => card.levels.map((level: any) => level.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.sort(), ACHIEVEMENT_DEFINITIONS.map((entry) => entry.id).sort());
  assert.equal(catalog.filter((card: any) => card.levels.length > 1).length,
    Object.keys(ACHIEVEMENT_SERIES).length);
  assert.ok(catalog.every((card: any) => card.title && card.metric && card.note));
  for (const card of catalog) assert.equal(card.displayKey, achievementGalleryKey(card.key));
  assert.equal(new Set(catalog.map((card: any) => card.displayKey)).size, 44);
});

test('different achievement series have distinct artwork; every tier within a series shares its emblem', () => {
  const catalog = achievementCatalog('en');
  const hashes = new Set<string>();
  for (const card of catalog) {
    assert.equal(new Set(card.levels.map((level: any) => level.artwork)).size, 1, card.key);
    const hash = createHash('sha256').update(card.levels[0].image).digest('hex');
    assert.equal(hashes.has(hash), false, `duplicated artwork: ${card.key}`);
    hashes.add(hash);
  }
  assert.equal(hashes.size, 46);
});

test('review targets and all tier icons come directly from the production catalog', () => {
  for (const locale of ['zh-CN', 'en']) {
    for (const card of achievementCatalog(locale)) {
      for (const level of card.levels) {
        const definition = ACHIEVEMENT_DEFINITIONS.find((entry) => entry.id === level.id)!;
        assert.equal(level.target, definition.target);
        assert.equal(level.artwork, ACHIEVEMENT_IMAGE_FILES[level.id as keyof typeof ACHIEVEMENT_IMAGE_FILES]);
        assert.equal(level.image, achievementImageDataUrl(definition.id));
      }
    }
  }
});

test('mobile review sheets explicitly show catalog conditions, not personal unlock progress', () => {
  const catalog = achievementCatalog('zh-CN');
  for (const group of ['claude', 'codex', 'combined', 'plugin']) {
    const html = renderCatalogGroup(catalog, group, 'zh-CN');
    assert.match(html, /图鉴审阅，非个人解锁记录/);
    assert.doesNotMatch(html, /<script|https?:|fetch\(|setInterval\(|已获得|<progress/);
    assert.match(html, /data:image\/png;base64,/);
    assert.match(html, /普通/);
  }
});

test('mobile review Markdown identifies the achievement candidate rather than the performance release', () => {
  for (const locale of ['zh-CN', 'en']) {
    const markdown = renderCatalogMarkdown(achievementCatalog(locale), locale);
    assert.match(markdown, /^# v2\.4\.2 /);
    assert.doesNotMatch(markdown, /v2\.4\.1/);
  }
});
