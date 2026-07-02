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
  assert.match(svg, /width="1200" height="630"/);
  assert.match(svg, /My Claude Code usage/);
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
