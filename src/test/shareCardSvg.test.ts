// Tests for the share-card SVG renderer — well-formed output, present fields
// drawn, absent fields omitted (privacy), and no raw identifiers leak.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ShareCardData } from '../shareCard';
import { renderShareCardSvg } from '../shareCardSvg';

const base: ShareCardData = { range: 'month', watermark: true };

test('renders a well-formed svg with the default size', () => {
  const svg = renderShareCardSvg(base);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /width="1200" height="680"/);
  assert.match(svg, /My Claude Code usage/);
});

test('watermark carries the repo (no QR)', () => {
  const svg = renderShareCardSvg(base);
  assert.match(svg, /github\.com\/ClaudeCodeUsage\/ClaudeCodeUsage/);
  assert.doesNotMatch(svg, /<path stroke="#1b1b1b"/); // no QR path
});

test('composition legend shows both percent and absolute amount', () => {
  const svg = renderShareCardSvg({
    ...base,
    composition: { input: 1_000_000, output: 3_000_000, cacheCreate: 2_000_000, cacheRead: 4_000_000 },
  });
  assert.match(svg, /Cache read 40% · 4M/);
  assert.match(svg, /Input 10% · 1M/);
});

test('labels the rhythm first/last dates', () => {
  const svg = renderShareCardSvg({
    ...base,
    rhythm: [1, 2, 3],
    rhythmStart: '2026-06-01',
    rhythmEnd: '2026-06-30',
  });
  assert.match(svg, />Jun 1</);
  assert.match(svg, />Jun 30</);
});

test('uses a custom range label when provided (specific month)', () => {
  const svg = renderShareCardSvg({ ...base, range: 'month:2026-06', rangeLabel: 'June 2026' });
  assert.match(svg, /June 2026/);
});

test('size presets set the canvas dimensions', () => {
  assert.match(renderShareCardSvg(base, { size: 'portrait' }), /width="1080" height="1350"/);
  assert.match(renderShareCardSvg(base, { size: 'story' }), /width="1080" height="1920"/);
  assert.match(renderShareCardSvg(base, { size: 'square' }), /width="1080" height="1080"/);
});

test('embeds an avatar in the corner when provided', () => {
  const svg = renderShareCardSvg({ ...base, badge: { id: 'x', label: 'X' } }, { avatarDataUri: 'data:image/png;base64,AAA' });
  assert.match(svg, /<image[^>]+href="data:image\/png;base64,AAA"/);
  assert.match(svg, /clip-path="url\(#av\)"/);
  // avatar replaces the badge in the corner
  assert.doesNotMatch(svg, />X<\/text>/);
});

test('shows the full model name, not just the family', () => {
  const svg = renderShareCardSvg({ ...base, totalTokens: 1, topModelName: 'Opus 4.8', topModelFamily: 'Opus' });
  assert.match(svg, />Opus 4\.8</);
});

test('renders the token composition bar + legend when present', () => {
  const svg = renderShareCardSvg({
    ...base,
    composition: { input: 10, output: 30, cacheCreate: 20, cacheRead: 40 },
  });
  assert.match(svg, /Token composition/);
  assert.match(svg, /Cache read 40%/);
  assert.match(svg, /Input 10%/);
});

test('labels the rhythm peak', () => {
  const svg = renderShareCardSvg({ ...base, rhythm: [1, 2, 5_300_000] });
  assert.match(svg, /peak 5\.3M/);
});

test('draws the total-tokens hero in compact form', () => {
  const svg = renderShareCardSvg({ ...base, totalTokens: 5_300_000_000 });
  assert.match(svg, /5\.3B/);
  assert.match(svg, />tokens</);
});

test('falls back to cost as the hero when tokens are hidden', () => {
  const svg = renderShareCardSvg({ ...base, estimatedCost: 12.5 });
  assert.match(svg, /\$12\.50/);
  assert.match(svg, />spent</);
});

test('omits sections that are absent (privacy: only draws what is present)', () => {
  const svg = renderShareCardSvg(base); // nothing but range + watermark
  assert.doesNotMatch(svg, /sessions/);
  assert.doesNotMatch(svg, /from cache/);
  assert.doesNotMatch(svg, /top model/);
});

test('renders supporting tiles and the badge when present', () => {
  const svg = renderShareCardSvg({
    ...base,
    totalTokens: 1_000_000,
    estimatedCost: 42,
    sessions: 9,
    cacheSharePct: 71,
    topModelFamily: 'Opus',
    badge: { id: 'cache-saver', label: 'Cache Saver' },
  });
  assert.match(svg, />sessions</);
  assert.match(svg, />71%</);
  assert.match(svg, />Opus</);
  assert.match(svg, /Cache Saver/);
  assert.match(svg, /Made with Claude Code Usage/);
});

test('renders a rhythm bar per day', () => {
  const svg = renderShareCardSvg({ ...base, rhythm: [1, 5, 0, 9, 3] });
  // 5 rhythm rects (fill orangeSoft) — count the fill occurrences on rects.
  const bars = svg.match(/fill="#e07d4f"\/>/g) ?? [];
  assert.equal(bars.length, 5);
});

test('escapes angle brackets in project names', () => {
  const svg = renderShareCardSvg({ ...base, projectName: 'a<b>c' });
  assert.match(svg, /a&lt;b&gt;c/);
  assert.doesNotMatch(svg, /a<b>c/);
});

test('drops the watermark when disabled', () => {
  const svg = renderShareCardSvg({ range: 'today', watermark: false });
  assert.doesNotMatch(svg, /Made with Claude Code Usage/);
});
