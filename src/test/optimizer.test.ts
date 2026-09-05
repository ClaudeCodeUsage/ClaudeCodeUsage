// Tests for the Usage Optimizer's pure helpers (Phase 9c / 11). These live in
// advisor.ts precisely so they can be exercised without the vscode API — the
// VS Code glue (consent, config, webview round-trip) is not covered here.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { buildOptimizerSystemPrompt, parseOptimizerOutput } from '../advisor';

const NONE = { resolve: false, distil: false, aesthetic: false };

test('parseOptimizerOutput splits a well-formed reply on the markers', () => {
  const raw =
    'preamble\n===PROMPT===\nDo the thing precisely.\n===SETTINGS===\n- Effort: high\n- Model: opus';
  const out = parseOptimizerOutput(raw);
  assert.equal(out.prompt, 'Do the thing precisely.');
  assert.equal(out.settings, '- Effort: high\n- Model: opus');
});

test('parseOptimizerOutput falls back to whole text when markers are missing', () => {
  const raw = 'Just some advice with no markers at all.';
  const out = parseOptimizerOutput(raw);
  assert.equal(out.prompt, raw);
  assert.equal(out.settings, '');
});

test('parseOptimizerOutput falls back when the markers are out of order', () => {
  // SETTINGS before PROMPT is malformed — surface everything as the prompt
  // rather than slicing a negative range.
  const raw = '===SETTINGS===\n- Effort: low\n===PROMPT===\nrewritten';
  const out = parseOptimizerOutput(raw);
  assert.equal(out.prompt, raw.trim());
  assert.equal(out.settings, '');
});

test('parseOptimizerOutput tolerates empty / whitespace input', () => {
  assert.deepEqual(parseOptimizerOutput(''), { prompt: '', settings: '' });
  assert.deepEqual(parseOptimizerOutput('   \n  '), { prompt: '', settings: '' });
});

test('buildOptimizerSystemPrompt always names the language and the output shape', () => {
  const sys = buildOptimizerSystemPrompt('简体中文 (Simplified Chinese)', NONE);
  assert.ok(sys.includes('简体中文 (Simplified Chinese)'), 'language must be named');
  assert.ok(sys.includes('===PROMPT==='), 'must specify the PROMPT marker');
  assert.ok(sys.includes('===SETTINGS==='), 'must specify the SETTINGS marker');
});

test('buildOptimizerSystemPrompt includes only the lenses that are enabled', () => {
  const off = buildOptimizerSystemPrompt('English', NONE);
  assert.ok(!off.includes('ambiguous reference'), 'resolve lens should be absent when off');
  assert.ok(!off.includes('condense it'), 'distil lens should be absent when off');
  assert.ok(!off.includes('aesthetic'), 'aesthetic lens should be absent when off');

  const resolveOnly = buildOptimizerSystemPrompt('English', { ...NONE, resolve: true });
  assert.ok(resolveOnly.includes('ambiguous reference'), 'resolve lens text expected');
  assert.ok(!resolveOnly.includes('condense it'), 'distil lens should still be absent');

  const all = buildOptimizerSystemPrompt('English', { resolve: true, distil: true, aesthetic: true });
  assert.ok(all.includes('ambiguous reference'));
  assert.ok(all.includes('condense it'));
  assert.ok(all.includes('aesthetic'));
});
