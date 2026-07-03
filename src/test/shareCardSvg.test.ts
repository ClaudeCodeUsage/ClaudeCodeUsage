// Tests for the share-card SVG renderer (Code Pulse · Aurora Console) — themes,
// well-formed output, present fields drawn, absent fields omitted (privacy).

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ShareCardData } from '../shareCard';
import { renderShareCardSvg, resolveShareCardTheme, SHARE_CARD_THEMES, BADGE_COPY } from '../shareCardSvg';

const base: ShareCardData = { range: 'month', watermark: true };

test('renders a well-formed 1200x680 svg with the brand', () => {
  const svg = renderShareCardSvg(base);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /width="1200" height="680"/);
  assert.match(svg, />Claude Code Usage</);
  assert.match(svg, />AI coding usage snapshot</);
});

test('draws the total-tokens hero compactly with its label', () => {
  const svg = renderShareCardSvg({ ...base, totalTokens: 5_300_000_000 });
  assert.match(svg, />5\.3B</);
  assert.match(svg, />total tokens</);
});

test('full-numbers shows the exact token count', () => {
  const svg = renderShareCardSvg({ ...base, totalTokens: 1_841_143_919 }, { fullNumbers: true });
  assert.match(svg, />1,841,143,919</);
});

test('falls back to cost as the hero when tokens are hidden', () => {
  const svg = renderShareCardSvg({ ...base, estimatedCost: 12.5 });
  assert.match(svg, /\$12\.50/);
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

test('badge uses the on-brand copy (title + explanation line)', () => {
  const svg = renderShareCardSvg({ ...base, badge: { id: 'cache-saver', label: 'Cache Saver' } });
  assert.match(svg, />Cache Alchemist</);
  assert.match(svg, /缓存命中高/);
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

test('theme resolution: default is claudeCream; auto follows VS Code', () => {
  assert.equal(resolveShareCardTheme(undefined), 'claudeCream');
  assert.equal(resolveShareCardTheme('claudeCream'), 'claudeCream');
  assert.equal(resolveShareCardTheme('auroraDark'), 'auroraDark');
  assert.equal(resolveShareCardTheme('auto', true), 'auroraDark');
  assert.equal(resolveShareCardTheme('auto', false), 'claudeCream');
});

test('default theme paints the Claude Cream background', () => {
  const svg = renderShareCardSvg(base);
  assert.match(svg, new RegExp(SHARE_CARD_THEMES.claudeCream.bgTop));
});

test('aurora dark theme paints the navy background', () => {
  const svg = renderShareCardSvg(base, { theme: 'auroraDark' });
  assert.match(svg, new RegExp(SHARE_CARD_THEMES.auroraDark.bgTop));
  assert.doesNotMatch(svg, new RegExp(SHARE_CARD_THEMES.claudeCream.bgTop));
});

test('hidden project / cost stay hidden in both themes', () => {
  for (const theme of ['claudeCream', 'auroraDark'] as const) {
    const svg = renderShareCardSvg({ range: 'month', watermark: true, totalTokens: 1 }, { theme });
    assert.doesNotMatch(svg, /est\. cost/); // no cost tile without estimatedCost
    assert.doesNotMatch(svg, /Secret-Project/); // a project name would only appear if set
  }
});

test('BADGE_COPY covers every badge id', () => {
  for (const id of ['context-marathoner', 'cache-saver', 'token-sprinter', 'workflow-pilot', 'steady-builder']) {
    assert.ok(BADGE_COPY[id] && BADGE_COPY[id].en && BADGE_COPY[id].line, id);
  }
});
