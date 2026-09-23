import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  claudeDailyPointsFromUsage,
  codexDailyPointsFromUsage,
  combinedHeatmapFilename,
  combinedHeatmapMarkdown,
  mergeCombinedDailyUsage,
  sanitizeCombinedHeatmapTitle,
  selectCombinedHeatmapWindow,
} from '../combinedHeatmap';
import {
  ACADEMIC_VIOLET_SCALE,
  customCombinedHeatmapScale,
  normalizeCombinedHeatmapAccent,
  normalizeCombinedHeatmapIntensityMode,
  normalizeCombinedHeatmapPalette,
  renderCombinedHeatmapSvg,
} from '../combinedHeatmapSvg';

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

test('provider mappings preserve the processed-token formulas without double counting', () => {
  const claude = claudeDailyPointsFromUsage({
    '2026-07-20': { tokens: 100, cost: 2, sessions: 1 },
  });
  const codex = codexDailyPointsFromUsage([{
    day: '2026-07-20',
    total: {
      input: 200,
      output: 50,
      cachedInput: 190,
      reasoning: 40,
      processed: 99_999,
    },
  }]);
  assert.deepEqual(claude, [{ dateISO: '2026-07-20', processed: 100 }]);
  assert.deepEqual(codex, [{ dateISO: '2026-07-20', processed: 250 }]);
});

test('merge de-duplicates identical provider days and zero-fills the missing provider', () => {
  const daily = mergeCombinedDailyUsage(
    [
      { dateISO: '2026-07-19', processed: 30 },
      { dateISO: '2026-07-19', processed: 30 },
    ],
    [
      { dateISO: '2026-07-19', processed: 5 },
      { dateISO: '2026-07-20', processed: 7 },
    ],
  );
  assert.deepEqual(daily, {
    '2026-07-19': {
      dateISO: '2026-07-19',
      claudeProcessed: 30,
      codexProcessed: 5,
      combinedProcessed: 35,
    },
    '2026-07-20': {
      dateISO: '2026-07-20',
      claudeProcessed: 0,
      codexProcessed: 7,
      combinedProcessed: 7,
    },
  });
});

test('conflicting duplicate provider days fail closed instead of inflating output', () => {
  assert.throws(
    () => mergeCombinedDailyUsage([
      { dateISO: '2026-07-19', processed: 10 },
      { dateISO: '2026-07-19', processed: 20 },
    ], []),
    /Conflicting duplicate daily aggregate/,
  );
});

test('single-provider and empty inputs remain valid instead of producing a blank compare contract', () => {
  assert.deepEqual(
    mergeCombinedDailyUsage([{ dateISO: '2026-07-20', processed: 9 }], []),
    {
      '2026-07-20': {
        dateISO: '2026-07-20',
        claudeProcessed: 9,
        codexProcessed: 0,
        combinedProcessed: 9,
      },
    },
  );
  assert.deepEqual(
    mergeCombinedDailyUsage([], [{ dateISO: '2026-07-20', processed: 11 }]),
    {
      '2026-07-20': {
        dateISO: '2026-07-20',
        claudeProcessed: 0,
        codexProcessed: 11,
        combinedProcessed: 11,
      },
    },
  );
  assert.deepEqual(mergeCombinedDailyUsage([], []), {});
});

test('range boundaries use inclusive configured-timezone date keys', () => {
  const daily = mergeCombinedDailyUsage([
    { dateISO: '2026-06-20', processed: 1 },
    { dateISO: '2026-06-21', processed: 2 },
    { dateISO: '2026-07-20', processed: 3 },
    { dateISO: '2026-07-21', processed: 4 },
  ], []);
  const window = selectCombinedHeatmapWindow(daily, '30d', '2026-07-20');
  assert.equal(window.startDateISO, '2026-06-21');
  assert.deepEqual(Object.keys(window.daily), ['2026-06-21', '2026-07-20']);
  assert.equal(window.totals.combinedProcessed, 5);
});

test('SVG is deterministic and tooltips disclose both provider totals and the combined total', () => {
  assert.deepEqual(ACADEMIC_VIOLET_SCALE, [
    '#ebedf0', '#eee8f8', '#d8c9f1', '#bca5e6', '#8668c7', '#4f2f87',
  ]);
  const daily = mergeCombinedDailyUsage(
    [{ dateISO: '2026-07-20', processed: 1_200_000 }],
    [{ dateISO: '2026-07-20', processed: 300_000 }],
  );
  const options = { range: '30d' as const, endDateISO: '2026-07-20', title: 'Local AI activity' };
  const first = renderCombinedHeatmapSvg(daily, options);
  const second = renderCombinedHeatmapSvg(daily, options);
  assert.equal(first, second);
  assert.match(first, /2026-07-20 · Claude: 1\.2M · Codex: 300K · Combined: 1\.5M processed tokens/);
  assert.match(first, /not productivity, billing, or provider equivalence/);
  assert.match(first, /role="img"/);
  assert.ok(contrastRatio('#2f2142', '#fcfaff') >= 4.5);
  assert.ok(contrastRatio('#685a77', '#fcfaff') >= 4.5);
  assert.match(first, new RegExp(ACADEMIC_VIOLET_SCALE[ACADEMIC_VIOLET_SCALE.length - 1], 'i'));
  assert.doesNotMatch(first, /#1d4ed8/i);
  const orderedRamp = ACADEMIC_VIOLET_SCALE
    .map((color) => `fill="${color}"`)
    .join('[\\s\\S]*');
  assert.match(first, new RegExp(orderedRamp, 'i'));
});

test('combined heatmap supports curated and sanitized custom colour ramps', () => {
  const daily = mergeCombinedDailyUsage(
    [{ dateISO: '2026-07-20', processed: 100 }],
    [{ dateISO: '2026-07-20', processed: 50 }],
  );
  const custom = customCombinedHeatmapScale('#0f766e');
  assert.equal(custom.length, 6);
  assert.equal(custom[custom.length - 1], '#0f766e');

  const svg = renderCombinedHeatmapSvg(daily, {
    range: '30d',
    endDateISO: '2026-07-20',
    palette: 'custom',
    customAccent: '#0F766E',
  });
  assert.match(svg, /#0f766e/i);

  const invalid = renderCombinedHeatmapSvg(daily, {
    range: '30d',
    endDateISO: '2026-07-20',
    palette: 'custom',
    customAccent: 'url(javascript:alert(1))',
  });
  assert.doesNotMatch(invalid, /javascript|url\(/i);
  assert.match(invalid, new RegExp(ACADEMIC_VIOLET_SCALE[ACADEMIC_VIOLET_SCALE.length - 1], 'i'));

  assert.equal(normalizeCombinedHeatmapPalette('unexpected'), 'academicViolet');
  assert.equal(normalizeCombinedHeatmapAccent('#fff'), '#4f2f87');
  assert.equal(normalizeCombinedHeatmapAccent(' #0F766E '), '#0f766e');
  const nearWhite = customCombinedHeatmapScale('#ffffff');
  assert.notEqual(nearWhite[nearWhite.length - 1], '#ffffff');
  for (let index = 1; index < nearWhite.length; index++) {
    assert.ok(
      relativeLuminance(nearWhite[index]) < relativeLuminance(nearWhite[index - 1]),
      `${nearWhite[index]} should be darker than ${nearWhite[index - 1]}`,
    );
  }
});

test('combined heatmap exposes deterministic quantile, logarithmic, and linear intensity modes', () => {
  assert.equal(normalizeCombinedHeatmapIntensityMode('quantile'), 'quantile');
  assert.equal(normalizeCombinedHeatmapIntensityMode('logarithmic'), 'logarithmic');
  assert.equal(normalizeCombinedHeatmapIntensityMode('linear'), 'linear');
  assert.equal(normalizeCombinedHeatmapIntensityMode('unexpected'), 'quantile');

  const daily = mergeCombinedDailyUsage([
    { dateISO: '2026-07-17', processed: 1 },
    { dateISO: '2026-07-18', processed: 9 },
    { dateISO: '2026-07-19', processed: 99 },
    { dateISO: '2026-07-20', processed: 999 },
  ], []);
  const base = { range: '30d' as const, endDateISO: '2026-07-20' };
  const logarithmic = renderCombinedHeatmapSvg(daily, { ...base, intensityMode: 'logarithmic' });
  const linear = renderCombinedHeatmapSvg(daily, { ...base, intensityMode: 'linear' });
  const quantile = renderCombinedHeatmapSvg(daily, { ...base, intensityMode: 'quantile' });

  assert.notEqual(logarithmic, linear);
  assert.notEqual(quantile, linear);
  assert.equal(
    logarithmic,
    renderCombinedHeatmapSvg(daily, { ...base, intensityMode: 'logarithmic' }),
  );
});

test('30d and 90d SVG windows render every date from non-Sunday starts in the correct weekday row', () => {
  const endDateISO = '2026-07-22'; // Wednesday; 30d starts Tuesday, 90d starts Friday.
  const thirty = renderCombinedHeatmapSvg({}, { range: '30d', endDateISO });
  const ninety = renderCombinedHeatmapSvg({}, { range: '90d', endDateISO });

  assert.equal((thirty.match(/processed tokens<\/title>/g) ?? []).length, 30);
  assert.match(thirty, /<rect x="38" y="91"[^>]*><title>2026-06-23 · Claude: 0 · Codex: 0 · Combined: 0 processed tokens<\/title>/);
  assert.equal((ninety.match(/processed tokens<\/title>/g) ?? []).length, 90);
  assert.match(ninety, /<rect x="38" y="136"[^>]*><title>2026-04-24 · Claude: 0 · Codex: 0 · Combined: 0 processed tokens<\/title>/);
});

test('combined rendering zero-fills a date absent from both providers', () => {
  const daily = mergeCombinedDailyUsage([], [
    { dateISO: '2026-06-24', processed: 5 },
  ]);
  const svg = renderCombinedHeatmapSvg(daily, {
    range: '30d',
    endDateISO: '2026-07-22',
  });

  assert.match(svg, /2026-06-23 · Claude: 0 · Codex: 0 · Combined: 0 processed tokens/);
  assert.match(svg, /2026-06-24 · Claude: 0 · Codex: 5 · Combined: 5 processed tokens/);
});

test('share artifact cannot serialize privacy canaries from extra source fields', () => {
  const source = {
    '2026-07-20': {
      dateISO: '2026-07-20',
      claudeProcessed: 10,
      codexProcessed: 20,
      combinedProcessed: 30,
      accountFingerprint: 'PRIVACY_CANARY_ACCOUNT',
      projectName: 'PRIVACY_CANARY_PROJECT',
      threadTitle: 'PRIVACY_CANARY_THREAD',
      localPath: '/PRIVACY_CANARY_PATH',
      logContent: 'PRIVACY_CANARY_LOG',
    },
  } as unknown as Record<string, import('../combinedHeatmap').CombinedDayUsage>;
  const svg = renderCombinedHeatmapSvg(source, {
    range: '30d',
    endDateISO: '2026-07-20',
    title: 'Safe aggregate',
  });
  assert.doesNotMatch(svg, /PRIVACY_CANARY/);
});

test('title, filename, and Markdown are bounded and deterministic', () => {
  assert.equal(sanitizeCombinedHeatmapTitle('  Team\nactivity  ', 'Fallback'), 'Team activity');
  assert.equal(sanitizeCombinedHeatmapTitle('', 'Fallback'), 'Fallback');
  const filename = combinedHeatmapFilename('90d', '2026-07-20');
  assert.equal(filename, 'claude-codex-activity-90d-2026-07-20.svg');
  assert.equal(
    combinedHeatmapMarkdown(filename, 'Claude + Codex [activity]'),
    '![Claude + Codex activity](claude-codex-activity-90d-2026-07-20.svg)',
  );
});

test('combined exported SVG copy is localized in all eight UI locales', () => {
  const expected = {
    en: ['Less', 'More', 'Made with Claude Code Usage'],
    'de-DE': ['Weniger', 'Mehr', 'Erstellt mit Claude Code Usage'],
    'zh-TW': ['較少', '較多', '由 Claude Code Usage 製作'],
    'zh-CN': ['较少', '较多', '由 Claude Code Usage 制作'],
    ja: ['少ない', '多い', 'Claude Code Usage で作成'],
    ko: ['적게', '많이', 'Claude Code Usage로 제작'],
    'pt-BR': ['Menos', 'Mais', 'Criado com Claude Code Usage'],
    id: ['Lebih sedikit', 'Lebih banyak', 'Dibuat dengan Claude Code Usage'],
  };
  for (const [locale, markers] of Object.entries(expected)) {
    const svg = renderCombinedHeatmapSvg({}, {
      range: '30d',
      endDateISO: '2026-07-22',
      locale,
    });
    for (const marker of markers) assert.match(svg, new RegExp(marker));
  }
});
