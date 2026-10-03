import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createClaudeUsageIndex, updateClaudeUsageIndex } from '../claudeIncrementalIndex';
import { ClaudeDataLoader } from '../dataLoader';

function line(id: string, timestamp: string, model = 'claude-opus-5-5'): string {
  return `${JSON.stringify({
    type: 'assistant', uuid: id, requestId: `request-${id}`, timestamp,
    gitBranch: 'fixture-branch', cwd: '/fixture/performance',
    message: {
      id: `message-${id}`, role: 'assistant', model,
      content: [{ type: 'text', text: 'synthetic output' }],
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 80 },
    },
  })}\n`;
}

test('Opus 5.5 cold indexing and repeated live tail refreshes emit no pricing warnings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-opus55-refresh-'));
  const project = path.join(root, 'projects', '-fixture-performance');
  const originalWarn = console.warn;
  let warnings = 0;
  console.warn = () => { warnings += 1; };
  try {
    await mkdir(project, { recursive: true });
    const source = path.join(project, 'session.jsonl');
    const timestamp = new Date().toISOString();
    await writeFile(source, Array.from({ length: 1_000 }, (_, index) => line(`cold-${index}`, timestamp)).join(''));
    let result = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: true });
    for (let index = 0; index < 12; index += 1) {
      const unchanged = await updateClaudeUsageIndex(result.index, root, { analyzeContent: true });
      assert.equal(unchanged.diagnostics.bodyReads, 0);
      assert.equal(unchanged.diagnostics.bytesRead, 0);
      await appendFile(source, line(`tail-${index}`, timestamp));
      result = await updateClaudeUsageIndex(unchanged.index, root, { analyzeContent: true });
      assert.equal(result.diagnostics.bodyReads, 1);
      assert.equal(result.diagnostics.changed.append, 1);
      assert.equal(result.records.length, 1_001 + index);
    }
    assert.equal(warnings, 0);
    assert.ok(ClaudeDataLoader.calculateUsageData(result.records).totalCost > 0);
  } finally {
    console.warn = originalWarn;
    await rm(root, { recursive: true, force: true });
  }
});

test('already-expired analysis payloads stay reference-stable across busy-session refreshes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-expired-refresh-'));
  const project = path.join(root, 'projects', '-fixture-expired-performance');
  const previousNow = Date.now;
  let now = Date.parse('2026-09-30T12:00:00Z');
  Date.now = () => now;
  try {
    await mkdir(project, { recursive: true });
    const expired = path.join(project, 'expired.jsonl');
    const active = path.join(project, 'active.jsonl');
    await writeFile(expired, line('expired', '2026-08-01T10:00:00Z'));
    await writeFile(active, line('active', '2026-09-30T11:00:00Z'));
    let result = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { windowDays: 30 });
    const initial = [...result.index.files.values()].find(file => file.path === expired)?.analysis;
    assert.ok(initial);
    for (let index = 0; index < 4; index += 1) {
      now += 60_000;
      await appendFile(active, line(`tail-${index}`, new Date(now).toISOString()));
      result = await updateClaudeUsageIndex(result.index, root, { windowDays: 30 });
      const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true, windowDays: 30 });
      assert.deepEqual(result.contentAnalysis, full.contentAnalysis);
      assert.equal(result.diagnostics.bodyReads, 1);
      const current = [...result.index.files.values()].find(file => file.path === expired)?.analysis;
      assert.equal(current?.cat, initial.cat, 'empty analysis must not be rebuilt on every refresh');
      assert.equal(current?.seenUuids, initial.seenUuids);
    }
  } finally {
    Date.now = previousNow;
    await rm(root, { recursive: true, force: true });
  }
});
