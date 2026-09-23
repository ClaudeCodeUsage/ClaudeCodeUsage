import * as fs from 'fs';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

test('presentation toggles refresh dashboard UI without rebuilding providers', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'extension.ts'),
    'utf8',
  );

  assert.match(
    source,
    /DASHBOARD_ONLY_SETTINGS\s*=\s*new Set\(\[[\s\S]*?'showWeeklyEquivalentValue'[\s\S]*?'showProjectUsageMatrix'[\s\S]*?\]\)/,
  );
  assert.match(
    source,
    /DASHBOARD_ONLY_SETTINGS\.has\(key\)[\s\S]*?this\.syncProviderUi\(\);[\s\S]*?return;/,
  );
});

test('currency display settings reformat materialized data without rebuilding providers', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'extension.ts'),
    'utf8',
  );

  assert.match(
    source,
    /COST_DISPLAY_SETTINGS\s*=\s*new Set\(\[[\s\S]*?'decimalPlaces'[\s\S]*?'displayCurrency'[\s\S]*?\]\)/,
  );
  assert.doesNotMatch(
    source.match(/COST_DISPLAY_SETTINGS\s*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '',
    /usdConversionRate/,
  );
  const branch = source.match(
    /if \(key && ClaudeCodeUsageExtension\.COST_DISPLAY_SETTINGS\.has\(key\)\) \{([\s\S]*?)\n    \}/,
  )?.[1] ?? '';
  assert.match(branch, /this\.applyFormattingConfiguration\(config\)/);
  assert.match(branch, /this\.webviewProvider\.invalidateShareCardPreview\(\)/);
  assert.match(branch, /this\.syncProviderUi\(\)/);
  assert.match(branch, /return;/);
  assert.doesNotMatch(branch, /restart|createCodexProvider|startWatcher|scan/i);
});

test('pricing changes also invalidate sharing projections before a dashboard refresh', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'extension.ts'),
    'utf8',
  );
  assert.match(
    source,
    /private async refreshPricing\(\)[\s\S]*?this\.invalidateClaudeUsagePricingCache\(\);\s*this\.webviewProvider\.invalidateShareCardPreview\(\);/,
  );
  assert.match(
    source,
    /if \(pricingBackendChanged\) \{\s*this\.invalidateClaudeUsagePricingCache\(\);\s*this\.webviewProvider\.invalidateShareCardPreview\(\);/,
  );
});
