// Tests for the share-card SVG renderer (Code Pulse · Aurora Console) — themes,
// well-formed output, present fields drawn, absent fields omitted (privacy).

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ShareCardData } from '../shareCard';
import { renderShareCardSvg, resolveShareCardTheme, SHARE_CARD_THEMES, BADGE_COPY } from '../shareCardSvg';

const base: ShareCardData = { range: 'month', watermark: true };

type Rgb = [number, number, number];

function hexRgb(hex: string): Rgb {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as Rgb;
}

function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return foreground.map((value, index) =>
    Math.round(value * alpha + background[index] * (1 - alpha)),
  ) as Rgb;
}

function compositeCssColor(color: string, background: Rgb): Rgb {
  const rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(color.replace(/\s+/g, ''));
  if (rgba) {
    return composite(
      [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])],
      background,
      Number(rgba[4]),
    );
  }
  return hexRgb(color);
}

function relativeLuminance(rgb: Rgb): number {
  const channels = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function possibleTextSurfaces(theme: (typeof SHARE_CARD_THEMES)[keyof typeof SHARE_CARD_THEMES]): Rgb[] {
  const bases = [hexRgb(theme.bgTop), hexRgb(theme.bgBottom)];
  const decorated = bases.flatMap((background) => [
    background,
    composite(hexRgb(theme.blobWarm), background, 0.55),
    composite(hexRgb(theme.blobCool), background, 0.5),
  ]);
  return decorated.flatMap((background) => [
    background,
    compositeCssColor(theme.panelFill, background),
    compositeCssColor(theme.badgeFill, background),
  ]);
}

test('renders a well-formed 1200x680 svg with the brand', () => {
  const svg = renderShareCardSvg(base);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /width="1200" height="680"/);
  assert.match(svg, /role="img" aria-label="Claude Code Usage/);
  assert.match(svg, />Claude Code Usage</);
  assert.match(svg, />AI coding usage snapshot</);
});

test('share-card attribute values cannot break out through quotes', () => {
  const svg = renderShareCardSvg(base, {
    avatarDataUri: `data:image/svg+xml,\" onload=\"alert(1)' data-canary='unsafe`,
  });
  assert.doesNotMatch(svg, /href="data:image\/svg\+xml," onload=/i);
  assert.match(svg, /href="data:image\/svg\+xml,&quot; onload=&quot;alert\(1\)&#39; data-canary=&#39;unsafe"/);
});

test('draws the total-tokens hero compactly with its label + one decimal', () => {
  const svg = renderShareCardSvg({ ...base, totalTokens: 5_000_000_000 });
  assert.match(svg, />5\.0B</); // hero keeps one decimal even when round
  assert.match(svg, />total tokens</);
});

test('Chinese cards use 万 / 亿 units', () => {
  const zh = renderShareCardSvg({ ...base, totalTokens: 512_400_000 }, { lang: 'zh-CN' });
  assert.match(zh, />5\.1亿</); // hero in 亿, one decimal
  const tw = renderShareCardSvg({ ...base, totalTokens: 34_000 }, { lang: 'zh-TW' });
  assert.match(tw, />3\.4萬</); // Traditional uses 萬
});

test('full-numbers shows the exact token count', () => {
  const svg = renderShareCardSvg({ ...base, totalTokens: 1_841_143_919 }, { fullNumbers: true });
  assert.match(svg, />1,841,143,919</);
});

test('falls back to cost as the hero when tokens are hidden', () => {
  const svg = renderShareCardSvg({ ...base, estimatedCost: 12.5 });
  assert.match(svg, /\$12\.50/);
});

test('share cards accept the same display-only currency formatter as the dashboard', () => {
  const svg = renderShareCardSvg(
    { ...base, totalTokens: 1_000, estimatedCost: 10 },
    { formatCurrency: (usd) => `≈EUR ${(usd * 0.92).toFixed(2)}` },
  );
  assert.match(svg, /≈EUR 9\.20/);
  assert.doesNotMatch(svg, /\$10\.00/);
});

test('omits sections that are absent (privacy: only draws what is present)', () => {
  const svg = renderShareCardSvg(base);
  assert.doesNotMatch(svg, />sessions</);
  assert.doesNotMatch(svg, />cache hit</);
  assert.doesNotMatch(svg, />top model</);
});

test('renders the four default tiles + full model name', () => {
  const svg = renderShareCardSvg({
    ...base,
    totalTokens: 1_000_000,
    estimatedCost: 42,
    cacheSharePct: 71,
    topModelName: 'Opus 4.8',
    sessions: 9,
  });
  assert.match(svg, />est\. cost</);
  assert.match(svg, />71%</);
  assert.match(svg, />Opus 4\.8</);
  assert.match(svg, />sessions</);
});

test('token mix legend shows percent + amount', () => {
  const svg = renderShareCardSvg({
    ...base,
    composition: { input: 1_000_000, output: 3_000_000, cacheCreate: 2_000_000, cacheRead: 4_000_000 },
  });
  assert.match(svg, /Token mix/);
  assert.match(svg, /Cache read 40% · 4M/);
  assert.match(svg, /Input 10% · 1M/);
});

test('daily pulse labels the peak and first/last dates', () => {
  const svg = renderShareCardSvg({ ...base, rhythm: [1, 2, 5_300_000], rhythmStart: '2026-06-01', rhythmEnd: '2026-06-30' });
  assert.match(svg, /peak 5\.3M/);
  assert.match(svg, />Jun 1</);
  assert.match(svg, />Jun 30</);
});

test('badge uses the on-brand copy in the UI language (no mixing)', () => {
  const en = renderShareCardSvg({ ...base, badge: { id: 'cache-saver', label: 'Cache Saver' } });
  assert.match(en, />Cache Alchemist</); // en title
  assert.match(en, /barely a token wasted/); // en line, NOT the zh one
  assert.doesNotMatch(en, /缓存命中高/);

  const zh = renderShareCardSvg({ ...base, badge: { id: 'cache-saver', label: 'x' } }, { lang: 'zh-CN' });
  assert.match(zh, /缓存日子人/); // zh title
  assert.match(zh, /缓存命中高/); // zh line
});

test('avatar + name + badge coexist in the corner', () => {
  const svg = renderShareCardSvg(
    { ...base, badge: { id: 'token-sprinter', label: 'x' } },
    { avatarDataUri: 'data:image/png;base64,AAA', username: 'octocat' }
  );
  assert.match(svg, /<image[^>]+href="data:image\/png;base64,AAA"/);
  assert.match(svg, />octocat</);
  assert.match(svg, />Token Sprinter</);
});

test('watermark carries the repo, no QR', () => {
  const svg = renderShareCardSvg(base);
  assert.match(svg, /github\.com\/ClaudeCodeUsage/);
  assert.doesNotMatch(svg, /<path stroke="#1b1b1b"/);
});

test('escapes angle brackets in project names', () => {
  const svg = renderShareCardSvg({ ...base, projectName: 'a<b>c' });
  assert.match(svg, /a&lt;b&gt;c/);
});

// --- Themes ---

test('theme resolution: default is claudeClassic; auto follows VS Code', () => {
  assert.equal(resolveShareCardTheme(undefined), 'claudeClassic');
  assert.equal(resolveShareCardTheme('claudeCream'), 'claudeCream');
  assert.equal(resolveShareCardTheme('claudeClassic'), 'claudeClassic');
  assert.equal(resolveShareCardTheme('auroraDark'), 'auroraDark');
  assert.equal(resolveShareCardTheme('auto', true), 'auroraDark');
  assert.equal(resolveShareCardTheme('auto', false), 'claudeClassic');
});

test('default theme paints the Claude Classic background', () => {
  const svg = renderShareCardSvg(base);
  assert.match(svg, new RegExp(SHARE_CARD_THEMES.claudeClassic.bgTop));
});

test('aurora dark theme paints the navy background', () => {
  const svg = renderShareCardSvg(base, { theme: 'auroraDark' });
  assert.match(svg, new RegExp(SHARE_CARD_THEMES.auroraDark.bgTop)); // #111827
  assert.doesNotMatch(svg, new RegExp(SHARE_CARD_THEMES.claudeClassic.bgBottom)); // #FDEEE6 not in dark
});

test('hidden project / cost stay hidden in both themes', () => {
  for (const theme of ['claudeCream', 'auroraDark'] as const) {
    const svg = renderShareCardSvg({ range: 'month', watermark: true, totalTokens: 1 }, { theme });
    assert.doesNotMatch(svg, /est\. cost/); // no cost tile without estimatedCost
    assert.doesNotMatch(svg, /Secret-Project/); // a project name would only appear if set
  }
});

test('BADGE_COPY covers every badge id in all eight UI locales', () => {
  for (const id of ['context-marathoner', 'cache-saver', 'token-sprinter', 'workflow-pilot', 'steady-builder']) {
    for (const lang of ['en', 'de-DE', 'zh-TW', 'zh-CN', 'ja', 'ko', 'pt-BR', 'id'] as const) {
      assert.ok(BADGE_COPY[id]?.[lang]?.title && BADGE_COPY[id]?.[lang]?.line, `${id} ${lang}`);
    }
  }
});

test('card text follows the UI language', () => {
  const data = { ...base, totalTokens: 1_000_000, estimatedCost: 5, cacheSharePct: 90 };
  const en = renderShareCardSvg(data, { lang: 'en' });
  assert.match(en, />total tokens</);
  assert.match(en, />cache hit</);
  const zh = renderShareCardSvg(data, { lang: 'zh-CN' });
  assert.match(zh, />总 token</);
  assert.match(zh, />缓存命中</);
  assert.doesNotMatch(zh, />total tokens</);
  const expectedLabels = {
    'de-DE': 'Gesamttoken',
    ja: '総トークン',
    ko: '총 토큰',
    'pt-BR': 'total de tokens',
    id: 'total token',
  };
  for (const [lang, label] of Object.entries(expectedLabels)) {
    assert.match(renderShareCardSvg(data, { lang }), new RegExp(`>${label}<`));
  }
  // Unknown UI languages still fall back to English.
  const de = renderShareCardSvg(data, { lang: 'de-DE' });
  assert.doesNotMatch(de, />total tokens</);
  const unknown = renderShareCardSvg(data, { lang: 'unknown' });
  assert.match(unknown, />total tokens</);
});

test('share-card ranges and date labels follow every UI locale', () => {
  const data: ShareCardData = {
    ...base,
    range: 'week',
    rhythm: [1, 2],
    rhythmStart: '2026-06-01',
    rhythmEnd: '2026-06-02',
  };
  const expected = {
    en: ['the last 7 days', 'Jun 1'],
    'de-DE': ['letzten 7 Tage', '1. Juni'],
    'zh-TW': ['最近 7 天', '6月1日'],
    'zh-CN': ['最近 7 天', '6月1日'],
    ja: ['過去 7 日間', '6月1日'],
    ko: ['최근 7일', '6월 1일'],
    'pt-BR': ['últimos 7 dias', '1 de jun.'],
    id: ['7 hari terakhir', '1 Jun'],
  };
  for (const [lang, markers] of Object.entries(expected)) {
    const svg = renderShareCardSvg(data, { lang });
    for (const marker of markers) assert.match(svg, new RegExp(marker));
  }
});

test('every normal-size SVG label has at least 4.5:1 contrast on every possible card surface', () => {
  const data: ShareCardData = {
    ...base,
    totalTokens: 5_000_000_000,
    estimatedCost: 42,
    cacheSharePct: 71,
    topModelName: 'Opus 4.8',
    sessions: 9,
    messages: 20,
    composition: {
      input: 1_000_000,
      output: 3_000_000,
      cacheCreate: 2_000_000,
      cacheRead: 4_000_000,
    },
    rhythm: [1, 2, 5_300_000],
    rhythmStart: '2026-06-01',
    rhythmEnd: '2026-06-30',
    badge: { id: 'cache-saver', label: 'Cache Saver' },
  };

  for (const themeName of ['claudeClassic', 'claudeCream', 'auroraDark'] as const) {
    const svg = renderShareCardSvg(data, {
      theme: themeName,
      avatarDataUri: 'data:image/png;base64,AAA',
      username: 'octocat',
    });
    const labels = [...svg.matchAll(/<text\b([^>]*)>/g)].flatMap((match) => {
      const fontSize = /font-size="([\d.]+)"/.exec(match[1])?.[1];
      const fill = /fill="([^"]+)"/.exec(match[1])?.[1];
      return fontSize && fill && Number(fontSize) <= 22
        ? [{ fontSize: Number(fontSize), fill }]
        : [];
    });
    assert.ok(labels.length > 0, `${themeName} should render normal-size labels`);

    for (const label of labels) {
      assert.match(label.fill, /^#[0-9a-f]{6}$/i, `${themeName} normal text must use an auditable solid fill`);
      for (const background of possibleTextSurfaces(SHARE_CARD_THEMES[themeName])) {
        assert.ok(
          contrastRatio(hexRgb(label.fill), background) >= 4.5,
          `${themeName} ${label.fill} at ${label.fontSize}px must retain 4.5:1 contrast`,
        );
      }
    }
  }
});
