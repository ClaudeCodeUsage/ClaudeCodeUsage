import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { renderAchievementShareSvg, selectShareAchievements } from '../achievementShare';
import { ACHIEVEMENT_IMAGE_FILES, achievementImagePath, renderAchievementIcon } from '../achievementIcons';
import { ACHIEVEMENT_DEFINITIONS } from '../achievements';
import { readFileSync } from 'node:fs';
import type { AchievementResult } from '../achievements';
import { ACHIEVEMENT_COPY } from '../i18n';

const earned: AchievementResult[] = [
  { id: 'astra-regular', group: 'codex', progress: 25, target: 25, unlocked: true },
  { id: 'sol-regular', group: 'codex', progress: 3, target: 25, unlocked: false },
  { id: 'active-day-streak', group: 'combined', progress: 7, target: 7, unlocked: true },
];

for (const [locale, copy] of Object.entries(ACHIEVEMENT_COPY)) {
  test(`${locale}: model experience sharing preserves exact selected rules and their non-sequential names`, () => {
    const selected = ['same-root-models-silver', 'model-relay-roots-bronze', 'fable-relay'] as const;
    const results = ACHIEVEMENT_DEFINITIONS.filter(entry => selected.some(id => id === entry.id))
      .map(entry => ({ ...entry, progress: entry.target, unlocked: true }));
    assert.deepEqual(new Set(selectShareAchievements(results, [...selected])), new Set(selected));
    const svg = renderAchievementShareSvg({ selected, titles: copy.titles,
      heading: copy.shareTitle, subtitle: copy.intro, groups: copy.groups,
      levels: copy.levels, milestone: copy.milestone, footer: copy.heading });
    for (const id of selected) {
      assert.ok(svg.includes(copy.titles[id]), id);
      assert.ok(svg.includes(`data-achievement-icon="${id}"`), id);
    }
    // Internal persisted IDs remain compatible; only public names drop relay.
    assert.doesNotMatch(selected.map(id => copy.titles[id]).join(' '),
      /relay|接力|Staffel|Modellwechsel|revezamento|estafet|bergantian/i);
    assert.doesNotMatch(svg, /<script|animate|https:/i);
  });
}

test('share selection accepts only earned allowlisted ids, in canonical order', () => {
  assert.deepEqual(selectShareAchievements(earned, ['active-day-streak', 'sol-regular', 'unknown', 'astra-regular', 'astra-regular']), [
    'astra-regular', 'active-day-streak',
  ]);
  assert.deepEqual(selectShareAchievements(earned, undefined), []);
  assert.deepEqual(selectShareAchievements([
    ...earned, { id: 'night-output-peak', group: 'combined', progress: 1, target: 1, unlocked: true },
  ], undefined), []);
});

test('sharing collapses explicitly selected levels of one series to its highest selected earned tier', () => {
  const results = ACHIEVEMENT_DEFINITIONS.filter((entry) => entry.id.endsWith('token-club') || entry.id === 'hundred-million-club')
    .map((entry) => ({ ...entry, progress: entry.target, unlocked: entry.id !== 'trillion-token-club' }));
  assert.deepEqual(selectShareAchievements(results, [
    'hundred-million-club', 'billion-token-club', 'ten-billion-token-club', 'trillion-token-club',
  ]), ['ten-billion-token-club']);
  assert.deepEqual(selectShareAchievements(results, ['hundred-million-club']), ['hundred-million-club'],
    'do not substitute a higher level the user did not select');
});

test('achievement share SVG is deterministic, self-contained, and escapes local labels', () => {
  const selected = selectShareAchievements(earned, ['astra-regular']);
  const copy = ACHIEVEMENT_COPY.en;
  const args = { selected, titles: { 'astra-regular': '<private & name>' }, heading: 'My & achievements', subtitle: 'Local only',
    groups: copy.groups, levels: copy.levels, milestone: copy.milestone, footer: copy.heading };
  const svg = renderAchievementShareSvg(args);
  assert.equal(svg, renderAchievementShareSvg(args));
  assert.match(svg, /My &amp; achievements/);
  assert.match(svg, /&lt;private &amp; name&gt;/);
  assert.doesNotMatch(svg, /<private & name>|<script|https:/);
  assert.match(svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /data-achievement-icon="astra-regular"/);
  assert.doesNotMatch(svg, /<text[^>]*>✦<\/text>/);
});

test('achievement share localizes group and footer labels rather than internal group codes', () => {
  for (const copy of Object.values(ACHIEVEMENT_COPY)) {
    const svg = renderAchievementShareSvg({
      selected: ['weekly-volume-gold', 'local-share-export'], titles: copy.titles,
      heading: copy.shareTitle, subtitle: copy.intro, groups: copy.groups,
      levels: copy.levels, milestone: copy.milestone, footer: copy.heading,
    });
    assert.ok(svg.includes(copy.groups.combined));
    assert.ok(svg.includes(copy.groups.plugin));
    assert.ok(svg.includes(copy.heading));
    assert.doesNotMatch(svg, />combined<|>plugin<|local achievement milestones/);
  }
});

test('achievement share expresses all five levels by label and color without changing artwork', () => {
  const selected = ['hundred-million-club', 'billion-token-club', 'ten-billion-token-club',
    'hundred-billion-token-club', 'trillion-token-club', 'local-share-export'] as const;
  const svg = renderAchievementShareSvg({
    selected, titles: ACHIEVEMENT_COPY['zh-CN'].titles, heading: '成就分享卡', subtitle: '本地成就',
    groups: ACHIEVEMENT_COPY['zh-CN'].groups, levels: ['普通', '银色', '金色', '铂金', '传奇'],
    milestone: '里程碑', footer: '本地成就',
  });
  for (const label of ['普通', '银色', '金色', '铂金', '传奇', '里程碑']) assert.ok(svg.includes(label));
  for (const color of ['#e7b899', '#d6dce5', '#efce76', '#8dcaf0', '#cfadff']) assert.ok(svg.includes(color));
  for (const id of selected) assert.ok(svg.includes(`data-achievement-icon="${id}"`));
  assert.doesNotMatch(svg, /<script|animate|https:/);
});

test('every live badge has bundled original-style PNG artwork', () => {
  assert.deepEqual(Object.keys(ACHIEVEMENT_IMAGE_FILES).sort(), ACHIEVEMENT_DEFINITIONS.map((entry) => entry.id).sort());
  assert.equal(ACHIEVEMENT_IMAGE_FILES['night-output-peak'], 'combined-three-am-partner.png');
  for (const entry of ACHIEVEMENT_DEFINITIONS) {
    const bytes = readFileSync(achievementImagePath(entry.id));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});

test('achievement emblems embed local PNG bytes in standalone share SVG', () => {
  const astra = renderAchievementIcon('astra-regular', 'currentColor');
  const sol = renderAchievementIcon('sol-regular', 'currentColor');
  const luna = renderAchievementIcon('luna-regular', 'currentColor');
  assert.match(astra, /<svg[^>]+data-achievement-icon="astra-regular"/);
  assert.match(astra, /<image href="data:image\/png;base64,/);
  assert.notEqual(astra, sol);
  assert.notEqual(sol, luna);
  assert.doesNotMatch(astra, /<text|<script|https:/);
});
