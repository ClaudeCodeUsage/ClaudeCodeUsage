// Synthetic-only index scaling diagnostic. Never forwards warnings to VS Code
// or reads the user's provider history. Deterministic copy-budget regressions
// live in claudeIncrementalIndex.test.ts; timings here are evidence, not CI gates.
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createClaudeUsageIndex, updateClaudeUsageIndex } = require('../../out/claudeIncrementalIndex.js');
const timestamp = new Date().toISOString();
const originalWarn = console.warn;
let warnings = 0;
console.warn = () => { warnings += 1; };
const measurements = [];
const row = (id, model) => JSON.stringify({ type: 'assistant', timestamp,
  requestId: `request-${id}`, message: { id: `message-${id}`, model,
    usage: { input_tokens: 10, output_tokens: 1 } } });
try {
  for (const count of [2_000, 4_000, 8_000]) {
    global.gc?.();
    const root = await mkdtemp(join(tmpdir(), 'ccu-model-churn-synthetic-'));
    try {
      const project = join(root, 'projects', '-fixture');
      await mkdir(project, { recursive: true });
      const file = join(project, 'session.jsonl');
      await writeFile(file, Array.from({ length: count }, (_, id) => row(id, `future-model-${id}`)).join('\n') + '\n');
      const started = performance.now();
      const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: false });
      const coldMs = Math.round(performance.now() - started);
      assert.equal(cold.records.length, count);
      assert.equal(cold.index.aggregates.allTime.totalInputTokens, count * 10);
      const unchanged = await updateClaudeUsageIndex(cold.index, root, { analyzeContent: false });
      assert.equal(unchanged.diagnostics.bytesRead, 0);
      await appendFile(file, row('tail-known', 'claude-opus-5-5') + '\n' + row('tail-malformed', 42) + '\n');
      const warmStarted = performance.now();
      const warm = await updateClaudeUsageIndex(unchanged.index, root, { analyzeContent: false });
      assert.equal(warm.records.length, count + 2);
      assert.equal(warm.index.aggregates.allTime.totalInputTokens, count * 10 + 20);
      assert.equal(cold.index.aggregates.allTime.totalInputTokens, count * 10);
      measurements.push({ records: count, coldMs, warmMs: Math.round(performance.now() - warmStarted),
        warmBytesRead: warm.diagnostics.bytesRead, rssBytes: process.memoryUsage().rss });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
} finally { console.warn = originalWarn; }
assert.ok(warnings <= 129);
process.stdout.write(JSON.stringify({ node: process.version, warnings, measurements }, null, 2) + '\n');
