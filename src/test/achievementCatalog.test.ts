import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } from '../achievements';
import { ACHIEVEMENT_IMAGE_FILES, achievementImageDataUrl } from '../achievementIcons';
import { createHash } from 'node:crypto';
import { ACHIEVEMENT_GALLERY, achievementGalleryKey } from '../achievementGallery';
import { API_ACHIEVEMENT_DEFINITIONS, API_ACHIEVEMENT_SERIES, isAchievementMoneyId } from '../achievementMoneyCatalog';
import { achievementConditionFor } from '../achievementConditions';
import { formatAchievementCompact, formatAchievementInteger } from '../achievementFormat';
import { achievementCopyFor } from '../i18n';

const artworkGroupCount = Object.keys(ACHIEVEMENT_SERIES).length +
  ACHIEVEMENT_DEFINITIONS.filter(rule => !Object.values(ACHIEVEMENT_SERIES).some(ids => ids.includes(rule.id))).length;

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
  assert.equal(new Set(catalog.map((card: any) => card.displayKey)).size, ACHIEVEMENT_GALLERY.length);
  assert.equal(catalog.length, artworkGroupCount);
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
  assert.equal(hashes.size, artworkGroupCount);
});

test('review targets and all tier icons come directly from the production catalog', () => {
  const definitionsBefore = JSON.stringify(ACHIEVEMENT_DEFINITIONS);
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
  assert.equal(JSON.stringify(ACHIEVEMENT_DEFINITIONS), definitionsBefore);
});

test('review catalog includes twenty-four monetary conditions in six provider-specific themes', () => {
  assert.equal(API_ACHIEVEMENT_DEFINITIONS.length, 24);
  assert.equal(Object.keys(API_ACHIEVEMENT_SERIES).length, 6);
  for (const locale of ['zh-CN', 'en']) {
    const catalog = achievementCatalog(locale);
    const monetary = catalog.filter((card: any) => card.levels.some((level: any) => isAchievementMoneyId(level.id)));
    assert.equal(monetary.length, 6);
    assert.deepEqual(monetary.flatMap((card: any) => card.levels.map((level: any) => level.id)),
      API_ACHIEVEMENT_DEFINITIONS.map(rule => rule.id));
    for (const provider of ['claude', 'codex']) {
      const cards = monetary.filter((card: any) => card.group === provider);
      assert.deepEqual(cards.map((card: any) => card.levels.length), [4, 5, 3]);
      assert.equal(cards.reduce((sum: number, card: any) => sum + card.levels.length, 0), 12);
    }
    for (const card of monetary) {
      assert.match(card.metric, /USD/);
      assert.match(card.note, locale === 'en' ? /Frozen reference pricebook/ : /冻结参考价目表/);
      assert.match(card.note, locale === 'en' ? /not a bill or a task-quality score/ : /不是账单或任务质量评分/);
      assert.match(card.note, locale === 'en' ? /unknown-price usage is excluded/ : /未知价格用量不计入金额/);
      assert.match(card.note, /≥/);
      assert.match(card.note, /microUSD/);
    }
    const fourTier = catalog.filter((card: any) => card.levels.length === 4);
    assert.deepEqual(fourTier.map((card: any) => card.key), ['claude-api-total', 'codex-api-total']);
    for (const card of fourTier) {
      assert.deepEqual(card.levels.map((level: any) => level.tier), ['ordinary', 'silver', 'gold', 'platinum']);
      assert.deepEqual(card.levels.map((level: any) => level.label), achievementCopyFor(locale).levels.slice(0, 4));
    }
    const markdown = renderCatalogMarkdown(catalog, locale);
    assert.match(markdown, locale === 'en' ? /2 four-tier series/ : /2 个四级系列/);
    assert.match(markdown, new RegExp(`${ACHIEVEMENT_DEFINITIONS.length} ${locale === 'en' ? 'award conditions' : '个解锁条件'}`));
    assert.match(markdown, new RegExp(`${ACHIEVEMENT_GALLERY.length} ${locale === 'en' ? 'default theme cards' : '张主题卡'}`));
  }
});

test('API badges select six versioned coin or pouch emblems without changing award identities', () => {
  const images = new Set<string>();
  for (const rule of API_ACHIEVEMENT_DEFINITIONS) {
    const expected = rule.id.replace(/-(bronze|silver|gold|platinum|legendary)$/, '-v242-v2.png');
    assert.equal(ACHIEVEMENT_IMAGE_FILES[rule.id], expected);
    const bytes = Buffer.from(achievementImageDataUrl(rule.id).split(',')[1], 'base64');
    assert.equal(bytes.readUInt32BE(16), 256);
    assert.equal(bytes.readUInt32BE(20), 256);
    images.add(expected);
  }
  assert.equal(images.size, 6);
  assert.equal(API_ACHIEVEMENT_DEFINITIONS.length, 24);
});

test('monetary review displays floored USD while retaining exact production microUSD targets', () => {
  for (const locale of ['zh-CN', 'en']) {
    const catalog = achievementCatalog(locale).filter((card: any) => isAchievementMoneyId(card.levels[0].id));
    for (const card of catalog) {
      const html = renderCatalogGroup([card], card.group, locale);
      const markdown = renderCatalogMarkdown([card], locale);
      for (const level of card.levels) {
        const displayed = '$' + formatAchievementInteger(Math.floor(level.target / 1_000_000), locale);
        assert.ok(html.includes(`<strong>${displayed}</strong>`));
        assert.ok(markdown.includes(displayed));
        assert.ok(!html.includes(`<strong>${formatAchievementCompact(level.target)}</strong>`));
      }
    }
    const sample = { ...catalog[0], levels: [{ ...catalog[0].levels[0], target: 100_999_999 }] };
    assert.match(renderCatalogGroup([sample], sample.group, locale), /<strong>\$100<\/strong>/);
    assert.equal(sample.levels[0].target, 100_999_999);
  }
});

test('joint qualifications use production per-level copy alongside formal repetition or breadth targets', () => {
  for (const locale of ['zh-CN', 'en']) {
    const catalog = achievementCatalog(locale);
    const qualifiedIds = ACHIEVEMENT_DEFINITIONS.filter(rule => achievementConditionFor(locale, rule.id)).map(rule => rule.id);
    const reviewedIds: string[] = [];
    for (const card of catalog) {
      for (const level of card.levels) {
        const condition = achievementConditionFor(locale, level.id);
        assert.equal(level.condition, condition);
        if (!condition) continue;
        reviewedIds.push(level.id);
        assert.ok(card.note.includes(`${level.label}: ≥${formatAchievementCompact(level.target)} ${card.metric}; ${condition}`), level.id);
        assert.ok(renderCatalogMarkdown([card], locale).includes(condition), level.id);
      }
    }
    assert.deepEqual(reviewedIds, qualifiedIds);
  }
});

test('mobile review sheets explicitly show catalog conditions, not personal unlock progress', () => {
  const catalog = achievementCatalog('zh-CN');
  for (const group of ['claude', 'codex', 'combined', 'plugin']) {
    const html = renderCatalogGroup(catalog, group, 'zh-CN');
    assert.match(html, /图鉴审阅，非个人解锁记录/);
    assert.doesNotMatch(html, /<script|https?:|fetch\(|setInterval\(|已获得|<progress/);
    assert.match(html, /data:image\/png;base64,/);
    assert.match(html, /铜/);
  }
});

test('mobile review Markdown identifies the achievement candidate rather than the performance release', () => {
  for (const locale of ['zh-CN', 'en']) {
    const markdown = renderCatalogMarkdown(achievementCatalog(locale), locale);
    assert.match(markdown, /^# v2\.4\.2 /);
    assert.doesNotMatch(markdown, /v2\.4\.1/);
    assert.doesNotMatch(markdown, /已获得|personally earned/);
    assert.match(markdown, locale === 'en' ? /not personal award history/ : /不是个人获奖记录/);
  }
});
