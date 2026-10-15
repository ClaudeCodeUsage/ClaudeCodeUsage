import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { AchievementSharePreview, renderAchievementShareSvg, selectShareAchievements } from '../achievementShare';
import { ACHIEVEMENT_IMAGE_FILES, achievementImagePath, renderAchievementIcon } from '../achievementIcons';
import { ACHIEVEMENT_DEFINITIONS } from '../achievements';
import { readFileSync } from 'node:fs';
import type { AchievementResult } from '../achievements';
import { ACHIEVEMENT_COPY } from '../i18n';
import { API_ACHIEVEMENT_DEFINITIONS } from '../achievementMoneyCatalog';
import { achievementConditionFor } from '../achievementConditions';
import { achievementTitleWithoutRank } from '../achievementTitles';

function shareBadge(svg: string, id: string): { title: string; name: string; rank: string } {
  const cell = svg.split(`<g data-achievement-share-badge="${id}">`)[1]?.split('</g>')[0];
  assert.ok(cell, id);
  const text = [...cell.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]);
  return { title: /<title>([\s\S]*?)<\/title>/.exec(cell)![1],
    name: text[0].replace(/<[^>]+>/g, ''), rank: text[2].replace(/<\/tspan><tspan[^>]*>/g, ' ').replace(/<[^>]+>/g, '') };
}

const repositoryUrl = 'https://github.com/ClaudeCodeUsage/ClaudeCodeUsage';

function assertSelfContained(svg: string): void {
  const links = [...svg.matchAll(/<(a|image)\b[^>]*\bhref="([^"]*)"/g)];
  assert.equal(links.filter(match => match[1] === 'a').length, 1);
  for (const [, tag, href] of links) {
    if (tag === 'a') assert.equal(href, repositoryUrl);
    else assert.match(href, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  }
  assert.doesNotMatch(svg.split(repositoryUrl).join(''), /https:|<script|<foreignObject|\son\w+=|url\(/i);
}

// Text baselines and line spacing are part of the standalone SVG layout contract.
function textBlocks(svg: string) {
  return [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map(([, attributes, body]) => {
    const attribute = (name: string) => Number(new RegExp(`\\b${name}="([^"]+)"`).exec(attributes)?.[1]);
    const y = attribute('y');
    const spans = [...body.matchAll(/<tspan\b[^>]*dy="([^"]+)"[^>]*>([^<]*)<\/tspan>/g)];
    return { x: attribute('x'), y, size: attribute('font-size'),
      bottom: y + spans.reduce((sum, span) => sum + Number(span[1]), 0),
      lines: spans.length ? spans.map(span => span[2]) : [body] };
  });
}

for (const [locale, copy] of Object.entries(ACHIEVEMENT_COPY)) {
  for (const count of [1, 3, 9]) {
    test(`${locale}: ${count} badges keep long headings, footer and threshold labels in separate regions`, () => {
      const selected = API_ACHIEVEMENT_DEFINITIONS.slice(0, count).map(entry => entry.id);
      const longLevel = (label: string) => `${label} ${label} ${label} ${label}`;
      const levels = [longLevel(copy.levels[0]), longLevel(copy.levels[1]), longLevel(copy.levels[2]),
        longLevel(copy.levels[3]), longLevel(copy.levels[4])] as const;
      const args = { selected, titles: copy.titles, locale, levels, groups: copy.groups,
        milestone: copy.milestone, heading: Array(8).fill(copy.shareTitle).join(' '),
        subtitle: copy.intro, footer: Array(24).fill(copy.heading).join(' ') };
      const svg = renderAchievementShareSvg(args);
      const blocks = textBlocks(svg);
      const [heading, subtitle] = blocks;
      const [footer, link] = blocks.slice(-2);
      assert.ok(heading.lines.length > 1, 'long heading must wrap');
      assert.ok(footer.lines.length > 1, 'long footer must wrap');
      assert.equal(heading.lines.join('').replace(/\s/g, ''), args.heading.replace(/\s/g, ''));
      assert.equal(footer.lines.join('').replace(/\s/g, ''), `Claude Code Usage · ${args.footer}`.replace(/\s/g, ''));
      assert.ok(heading.bottom + 12 < subtitle.y - subtitle.size, 'heading/subtitle gap');
      const cells = [...svg.matchAll(/<g data-achievement-share-badge="([^"]+)">([\s\S]*?)<\/g>/g)];
      assert.equal(cells.length, count);
      let lastBottom = 0;
      for (const [index, [, id, cell]] of cells.entries()) {
        const rect = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/.exec(cell)!;
        const [, x, y, width, height] = rect.map(Number);
        assert.ok(subtitle.bottom + 12 < y, 'subtitle/cards gap');
        const [title, group, rank] = textBlocks(cell);
        assert.ok(title.bottom + 4 < group.y - group.size, 'title/group gap');
        assert.ok(group.bottom + 4 < rank.y - rank.size, 'group/rank gap');
        assert.ok(rank.bottom + 8 < y + height, 'rank stays in card');
        for (const block of [title, group, rank]) {
          assert.ok(block.x >= x + 80 && block.x < x + width, `${id}: labels clear the icon column`);
        }
        const entry = API_ACHIEVEMENT_DEFINITIONS.find(entry => entry.id === id)!;
        const threshold = `≥$${new Intl.NumberFormat(locale).format(entry.target / 1_000_000)} USD`;
        assert.ok(rank.lines.join('').replace(/\s/g, '').endsWith(threshold.replace(/\s/g, '')), 'full threshold retained');
        assert.ok(!rank.lines.join('').includes('…'), 'rank/threshold never elided');
        if (index >= 3) {
          const previous = /<rect x="\d+" y="(\d+)" width="\d+" height="(\d+)"/.exec(cells[index - 3][2])!;
          assert.ok(Number(previous[1]) + Number(previous[2]) + 12 <= y, 'row gap');
        }
        lastBottom = Math.max(lastBottom, y + height);
      }
      assert.ok(lastBottom + 16 < footer.y - footer.size, 'cards/footer gap');
      assert.ok(footer.bottom + 12 < link.y - link.size, 'footer/link gap');
      assert.deepEqual(link.lines, [repositoryUrl]);
      const height = Number(/viewBox="0 0 1000 (\d+)"/.exec(svg)![1]);
      assert.ok(link.bottom + 24 <= height, 'link fits canvas');
      assert.equal(svg, renderAchievementShareSvg(args));
      assertSelfContained(svg);
    });
  }
}

test('repository discovery link is fixed and label markup cannot introduce navigation or resources', () => {
  const hostile = '\"><a href="https://example.invalid"><image href="https://example.invalid/x" onload="alert(1)"/></a>';
  const copy = ACHIEVEMENT_COPY.en;
  const svg = renderAchievementShareSvg({ selected: ['astra-regular'], titles: { 'astra-regular': hostile },
    heading: hostile, subtitle: hostile, groups: copy.groups, levels: copy.levels,
    milestone: copy.milestone, footer: hostile });
  const links = [...svg.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 1);
  assert.equal(links[0][1], repositoryUrl);
  assert.ok(links[0][2].includes(`>${repositoryUrl}</text>`));
  assert.doesNotMatch(svg, /<(?:a|image)\b[^>]*https:\/\/example|\sonload="/);
});

const sonnetNames = {
  en: 'Sonnet mainstay', 'zh-CN': 'Sonnet 主力', 'zh-TW': 'Sonnet 主力',
  'de-DE': 'Sonnet als Hauptmodell', ja: 'Sonnet の主力運用', ko: 'Sonnet 주력',
  'pt-BR': 'Sonnet principal', id: 'Sonnet andalan',
};

for (const [locale, copy] of Object.entries(ACHIEVEMENT_COPY)) {
  test(`${locale}: title normalization removes only the exact delimited rank suffix`, () => {
    for (const rank of copy.levels) {
      for (const separator of [' · ', '·', '・', ' ・ ']) {
        assert.equal(achievementTitleWithoutRank(`Name${separator}${rank}`, rank), 'Name');
      }
      for (const title of [rank, `Name ${rank}`, `Name${rank}`, `Name · ${rank}wise`,
        `${rank} · Name`, `Name · ${rank} · Detail`, ` · ${rank}`]) {
        assert.equal(achievementTitleWithoutRank(title, rank), title);
      }
      assert.equal(achievementTitleWithoutRank(`Name · ${rank}`, undefined), `Name · ${rank}`);
    }
    assert.equal(achievementTitleWithoutRank(`Name · ${copy.levels[1]}`, copy.levels[0]),
      `Name · ${copy.levels[1]}`);
    assert.equal(achievementTitleWithoutRank(copy.titles['fable-relay'], undefined), copy.titles['fable-relay']);
  });

  test(`${locale}: normalized names and separate ranks remain XML-escaped and deterministic`, () => {
    const args = { selected: ['sonnet-main-silver'] as const,
      titles: { 'sonnet-main-silver': `<&"'> · ${copy.levels[1]}` }, locale,
      heading: '<&"\'>', subtitle: '<&"\'>', groups: copy.groups,
      levels: copy.levels, milestone: copy.milestone, footer: '<&"\'>' };
    const svg = renderAchievementShareSvg(args);
    const badge = shareBadge(svg, 'sonnet-main-silver');
    assert.equal(badge.title, `&lt;&amp;&quot;&apos;&gt; · ${copy.levels[1]}`);
    assert.equal(badge.name, '&lt;&amp;&quot;&apos;&gt;');
    assert.equal(badge.rank, copy.levels[1]);
    assert.equal(svg, renderAchievementShareSvg(args));
    assert.doesNotMatch(svg, /<&"'>|<script|animate/);
    assertSelfContained(svg);
  });

  test(`${locale}: share titles show each exact selected rank once and preserve milestone names`, () => {
    const selected = ['sonnet-main', 'sonnet-main-silver', 'sonnet-main-gold',
      'sonnet-main-platinum', 'sonnet-main-legendary', 'local-share-export', 'fable-relay'] as const;
    const svg = renderAchievementShareSvg({ selected, titles: copy.titles, locale,
      heading: copy.shareTitle, subtitle: copy.intro, groups: copy.groups,
      levels: copy.levels, milestone: copy.milestone, footer: copy.heading });
    for (const [index, id] of selected.entries()) {
      const badge = shareBadge(svg, id);
      const rank = index < 5 ? copy.levels[index] : copy.milestone;
      const name = index < 5 ? sonnetNames[locale as keyof typeof sonnetNames] : copy.titles[id];
      assert.equal(badge.title, `${name} · ${rank}`, id);
      // Wrapping may remove one inter-word space, but must retain the whole name.
      assert.equal(badge.name.replace(/\s/g, ''), name.replace(/\s/g, ''), id);
      assert.equal(badge.rank, rank, id);
      assert.equal(badge.title.split(rank).length - 1, 1, id);
      assert.ok(svg.includes(`data-achievement-icon="${id}"`), id);
    }
  });

  test(`${locale}: monetary share retains each public USD threshold and only one rank`, () => {
    for (const entry of API_ACHIEVEMENT_DEFINITIONS) {
      const svg = renderAchievementShareSvg({ selected: [entry.id], titles: copy.titles, locale,
        heading: copy.shareTitle, subtitle: copy.intro, groups: copy.groups,
        levels: copy.levels, milestone: copy.milestone, footer: copy.heading });
      const badge = shareBadge(svg, entry.id);
      const threshold = `≥$${new Intl.NumberFormat(locale).format(entry.target / 1_000_000)} USD`;
      assert.equal(badge.title, `${copy.titles[entry.id]} · ${threshold}`, entry.id);
      const rank = copy.titles[entry.id].split(' · ').slice(-1)[0];
      assert.equal(badge.rank, `${rank} · ${threshold}`, entry.id);
      assert.equal(badge.title.split(rank).length - 1, 1, entry.id);
      assert.equal(badge.name.includes(rank), false, entry.id);
      assert.doesNotMatch(svg, /microUSD|pricebookVersion|api-reference-|recordedDay|timeZone|pricingBackend/);
    }
  });

  test(`${locale}: selecting retained old IDs never upgrades them to newer earned ranks`, () => {
    const requested = ['sonnet-main-silver', 'claude-api-total-bronze', 'fable-relay'] as const;
    const available = [...requested, 'sonnet-main-legendary', 'claude-api-total-platinum'] as const;
    const results = ACHIEVEMENT_DEFINITIONS.filter(entry => available.some(id => id === entry.id))
      .map(entry => ({ ...entry, progress: entry.target, unlocked: true }));
    const selected = selectShareAchievements(results, requested);
    assert.deepEqual(new Set(selected), new Set(requested));
    const svg = renderAchievementShareSvg({ selected, titles: copy.titles, locale,
      heading: copy.shareTitle, subtitle: copy.intro, groups: copy.groups,
      levels: copy.levels, milestone: copy.milestone, footer: copy.heading });
    const preview = new AchievementSharePreview();
    const accepted = preview.accept(selected, svg, locale);
    renderAchievementShareSvg({ selected: ['sonnet-main-legendary'], titles: copy.titles, locale,
      heading: copy.shareTitle, subtitle: copy.intro, groups: copy.groups,
      levels: copy.levels, milestone: copy.milestone, footer: copy.heading });
    assert.equal(preview.capture(accepted.previewId, selected, locale), svg);
    assert.equal(preview.capture(accepted.previewId, ['sonnet-main-legendary'], locale), undefined);
    assert.equal(preview.capture(accepted.previewId, selected, locale === 'en' ? 'zh-CN' : 'en'), undefined);
    assert.deepEqual(preview.read(selected, locale), { previewId: accepted.previewId, svg });
    assert.doesNotMatch(svg, /data-achievement-share-badge="(?:sonnet-main-legendary|claude-api-total-platinum)"/);
  });
}

test('rank suffix matching treats punctuation literally and preserves meaningful rank words', () => {
  assert.equal(achievementTitleWithoutRank('Silverwork · Silver', 'Silver'), 'Silverwork');
  assert.equal(achievementTitleWithoutRank('Quicksilver', 'Silver'), 'Quicksilver');
  assert.equal(achievementTitleWithoutRank('Name · Silver (S+)?', 'Silver (S+)?'), 'Name');
  assert.equal(achievementTitleWithoutRank('Name · Silver SSS', 'Silver (S+)?'), 'Name · Silver SSS');
  assert.equal(achievementTitleWithoutRank('Name · Silver', 'silver'), 'Name · Silver');
  assert.equal(achievementTitleWithoutRank('Name · Silver', ''), 'Name · Silver');
});

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
      levels: copy.levels, milestone: copy.milestone, footer: copy.heading, locale });
    for (const id of selected) {
      const badge = shareBadge(svg, id);
      assert.ok(badge.title.startsWith(copy.titles[id].replace(/\s*[·・]\s*/g, ' · ')), id);
      const condition = achievementConditionFor(locale, id);
      if (condition) assert.ok(badge.title.endsWith(condition), id);
      assert.ok(svg.includes(`data-achievement-icon="${id}"`), id);
    }
    // Internal persisted IDs remain compatible; only public names drop relay.
    assert.doesNotMatch(selected.map(id => copy.titles[id]).join(' '),
      /relay|接力|Staffel|Modellwechsel|revezamento|estafet|bergantian/i);
    assert.doesNotMatch(svg, /<script|animate/i);
    assertSelfContained(svg);
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
  assert.doesNotMatch(svg, /<private & name>|<script/);
  assertSelfContained(svg);
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
    const visibleText = textBlocks(svg).map(block => block.lines.join('')).join('').replace(/\s/g, '');
    assert.ok(visibleText.includes(copy.groups.combined.replace(/\s/g, '')));
    assert.ok(visibleText.includes(copy.groups.plugin.replace(/\s/g, '')));
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
  assert.doesNotMatch(svg, /<script|animate/);
  assertSelfContained(svg);
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

test('safe feature exploration uses its text-free journey emblem, never the obsolete 10X artwork', () => {
  assert.equal(ACHIEVEMENT_IMAGE_FILES['safe-feature-explorer'], 'safe-feature-journey-v242.png');
  assert.notEqual(ACHIEVEMENT_IMAGE_FILES['safe-feature-explorer'], ACHIEVEMENT_IMAGE_FILES['local-share-export']);
  const bytes = readFileSync(achievementImagePath('safe-feature-explorer'));
  assert.equal(bytes.readUInt32BE(16), 256);
  assert.equal(bytes.readUInt32BE(20), 256);
  const svg = renderAchievementIcon('safe-feature-explorer', 'currentColor');
  assert.ok(svg.includes('data:image/png;base64,' + bytes.toString('base64')));
});
