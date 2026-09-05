import * as fs from 'fs';
import * as path from 'path';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

test('weekly equivalent panel toggle refreshes dashboard UI without rebuilding providers', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'extension.ts'),
    'utf8',
  );

  assert.match(
    source,
    /DASHBOARD_ONLY_SETTINGS\s*=\s*new Set\(\[[\s\S]*?'showWeeklyEquivalentValue'[\s\S]*?\]\)/,
  );
  assert.match(
    source,
    /DASHBOARD_ONLY_SETTINGS\.has\(key\)[\s\S]*?this\.syncProviderUi\(\);[\s\S]*?return;/,
  );
});
