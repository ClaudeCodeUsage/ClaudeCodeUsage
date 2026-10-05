import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
function diagnostic(script: string, args: string[] = []): any {
  const output = execFileSync(process.execPath, ['--expose-gc', script, ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  const start = output.indexOf('{');
  return JSON.parse(output.slice(start));
}

test('renderer performance diagnostic measures installed asset URIs, not the visual-fixture base64 fallback', () => {
  const result = diagnostic('tests/perf/measure-dashboard-reuse.cjs');
  assert.equal(result.assetMode, 'extension-resource-uri');
  assert.ok(result.cold.bytes < 2 * 1024 * 1024,
    'a 46-card gallery must not duplicate bundled PNG bytes in the host HTML');
});

test('large Claude diagnostic supports bounded small lines and reports actual usage-record density', () => {
  const result = diagnostic('tests/perf/measure-large-claude-index.mjs', [
    '--gib', '0.002', '--files', '8', '--line-kib', '16', '--assistant-payload',
  ]);
  assert.ok(result.fillerLineBytes <= 17 * 1024);
  assert.ok(result.coldRecords >= 120, 'fixture must exercise many actual usage records, not just payload bytes');
  assert.equal(result.phases.find((phase: any) => phase.label === 'unchanged').bytesRead, 0);
  assert.ok(result.peakRssBytes >= Math.max(...result.phases.map((phase: any) => phase.rssBytes)),
    'reported peak must include every explicit phase-end memory observation');
});
