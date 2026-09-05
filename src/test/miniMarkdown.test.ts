// Tests for the dependency-free Markdown renderer used by the conversation viewer.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { renderMarkdown } from '../miniMarkdown';

test('escapes HTML before formatting (no injection)', () => {
  const html = renderMarkdown('<script>alert(1)</script> **bold**');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>bold</strong>'));
});

test('headings, bold, italic, inline code, strikethrough', () => {
  assert.ok(renderMarkdown('# Title').includes('<h1>Title</h1>'));
  assert.ok(renderMarkdown('**b**').includes('<strong>b</strong>'));
  assert.ok(renderMarkdown('_i_').includes('<em>i</em>'));
  assert.ok(renderMarkdown('`x`').includes('<code>x</code>'));
  assert.ok(renderMarkdown('~~s~~').includes('<del>s</del>'));
});

test('fenced code block is escaped and not inline-formatted', () => {
  const html = renderMarkdown('```\nconst a = **notbold**;\n<b>\n```');
  assert.ok(html.includes('<pre><code>'));
  assert.ok(html.includes('**notbold**')); // literal, not bolded
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(!html.includes('<strong>'));
});

test('unordered and ordered lists', () => {
  const ul = renderMarkdown('- one\n- two');
  assert.ok(ul.includes('<ul><li>one</li><li>two</li></ul>'));
  const ol = renderMarkdown('1. a\n2. b');
  assert.ok(ol.includes('<ol><li>a</li><li>b</li></ol>'));
});

test('safe links only; javascript: is neutralised', () => {
  assert.ok(renderMarkdown('[x](https://example.com)').includes('<a href="https://example.com">x</a>'));
  const bad = renderMarkdown('[x](javascript:alert(1))');
  assert.ok(!bad.includes('href="javascript'));
  assert.ok(bad.includes('x'));
});

test('blockquote and horizontal rule', () => {
  assert.ok(renderMarkdown('> quoted').includes('<blockquote>quoted</blockquote>'));
  assert.ok(renderMarkdown('---').includes('<hr>'));
});

test('paragraph keeps soft line breaks', () => {
  assert.ok(renderMarkdown('line a\nline b').includes('line a<br>line b'));
});

test('empty / null input is safe', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null as unknown as string), '');
});

test('GFM table renders with header, rows and alignment', () => {
  const md = ['| Model | TTL |', '| :--- | ---: |', '| opus | 60m |', '| deepseek | 240m |'].join('\n');
  const html = renderMarkdown(md);
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<thead><tr><th style="text-align:left">Model</th><th style="text-align:right">TTL</th></tr></thead>'));
  assert.ok(html.includes('<td style="text-align:left">opus</td>'));
  assert.ok(html.includes('<td style="text-align:right">240m</td>'));
});

test('a lone pipe line is not treated as a table', () => {
  const html = renderMarkdown('a | b is just text');
  assert.ok(!html.includes('<table>'));
  assert.ok(html.includes('<p>'));
});
