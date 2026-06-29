// Tests for compact token formatting + the tokenDecimalPlaces setting (V2.2).
// I18n is a pure module (no vscode import), so it runs under node:test directly.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { I18n } from '../i18n';

I18n.setLanguage('en'); // deterministic locale for the <1000 branch

test('formatTokensCompact honours tokenDecimalPlaces (default 1)', () => {
  I18n.setTokenDecimalPlaces(1);
  assert.equal(I18n.formatTokensCompact(1_200_000), '1.2M');
  assert.equal(I18n.formatTokensCompact(345_600), '345.6k');
  assert.equal(I18n.formatTokensCompact(1_234_567_890), '1.2B');
});

test('tokenDecimalPlaces = 0 rounds to whole units', () => {
  I18n.setTokenDecimalPlaces(0);
  assert.equal(I18n.formatTokensCompact(1_200_000), '1M');
  assert.equal(I18n.formatTokensCompact(1_900_000), '2M'); // rounds up
  assert.equal(I18n.formatTokensCompact(345_600), '346k');
});

test('tokenDecimalPlaces = 2 keeps two decimals', () => {
  I18n.setTokenDecimalPlaces(2);
  assert.equal(I18n.formatTokensCompact(1_234_000), '1.23M');
  assert.equal(I18n.formatTokensCompact(12_340), '12.34k');
});

test('compact token formatting does NOT touch full integer counts (<1000)', () => {
  I18n.setTokenDecimalPlaces(2);
  assert.equal(I18n.formatTokensCompact(500), '500');
  assert.equal(I18n.formatTokensCompact(0), '0');
});

test('formatNumber compact path uses tokenDecimalPlaces and trims trailing zeros', () => {
  I18n.setCompactNumbers(true);
  I18n.setTokenDecimalPlaces(1);
  assert.equal(I18n.formatNumber(1_200_000), '1.2M');
  assert.equal(I18n.formatNumber(1_000_000), '1M'); // parseFloat trims 1.0 -> 1
  I18n.setTokenDecimalPlaces(0);
  assert.equal(I18n.formatNumber(1_200_000), '1M');
  I18n.setCompactNumbers(false);
});

test('formatNumber without compact leaves full integers intact', () => {
  I18n.setCompactNumbers(false);
  assert.equal(I18n.formatNumber(1_234_567), (1_234_567).toLocaleString('en'));
});

test('setTokenDecimalPlaces clamps to 0..2 (out-of-range ignored)', () => {
  I18n.setTokenDecimalPlaces(1);
  I18n.setTokenDecimalPlaces(5); // ignored
  assert.equal(I18n.formatTokensCompact(1_200_000), '1.2M');
  I18n.setTokenDecimalPlaces(-1); // ignored
  assert.equal(I18n.formatTokensCompact(1_200_000), '1.2M');
});
