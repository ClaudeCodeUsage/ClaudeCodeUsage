import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { analysisWindowCutoffMs, ClaudeDataLoader } from '../dataLoader';

test('the shared analysis cutoff preserves exact milliseconds for every supported window', () => {
  for (const timestamp of [
    '2026-09-10T12:00:30.001Z',
    '2026-09-10T18:14:59.999Z',
    '2026-11-01T06:00:00.001Z',
  ]) {
    const now = Date.parse(timestamp);
    for (const windowDays of [1, 30, 365]) {
      assert.equal(analysisWindowCutoffMs(now, windowDays), now - windowDays * 86_400_000);
    }
  }
});

test('a full load captures one exact cutoff for content and calibration despite clock drift', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-exact-cutoff-clock-'));
  const originalNow = Date.now;
  const now = Date.parse('2026-09-10T12:00:00.001Z');
  let clockReads = 0;
  try {
    const project = path.join(root, 'projects', '-fixture-cutoff');
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, 'boundary.jsonl'), `${JSON.stringify({
      type: 'assistant',
      uuid: 'cutoff-clock-boundary',
      timestamp: '2026-09-09T12:00:30.001Z',
      requestId: 'cutoff-clock-request',
      message: {
        id: 'cutoff-clock-message',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'synthetic boundary response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 4000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    })}\n`, 'utf8');
    // A second capture would move calibration past the admitted event.
    Date.now = () => now + clockReads++ * 60_000;
    const loaded = await ClaudeDataLoader.loadUsageRecords(root, {
      analyzeContent: true,
      windowDays: 1,
    });
    // Manifest scanning also reads the clock for diagnostic metadata. That
    // later time must not replace the captured analysis/calibration cutoff.
    assert.ok(clockReads > 1);
    assert.equal(
      loaded.contentAnalysis?.categories.find((slice) => slice.key === 'assistantText')?.count,
      1,
    );
    assert.deepEqual(loaded.contentAnalysis?.calibration, {
      realOutputTokens: 4000,
      realInputSideTokens: 10,
    });
  } finally {
    Date.now = originalNow;
    await rm(root, { recursive: true, force: true });
  }
});
