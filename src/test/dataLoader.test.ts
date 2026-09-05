import { after, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { scanUsageManifest } from '../claudeUsageFiles';
import { ClaudeDataLoader } from '../dataLoader';
import { ClaudeUsageRecord } from '../types';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

function record(model: string): ClaudeUsageRecord {
  return {
    timestamp: new Date().toISOString(),
    message: {
      model,
      usage: { input_tokens: 1_000, output_tokens: 10 },
    },
  };
}

test('getCurrentContextInfo reports a 1M window for Sonnet 5', () => {
  const info = ClaudeDataLoader.getCurrentContextInfo([record('claude-sonnet-5')]);
  assert.ok(info, 'expected context info, got null');
  assert.equal(info!.windowTokens, 1_000_000);
  assert.equal(info!.estimated, false);
});

test('getCurrentContextInfo reports a 1M window for Opus 5, with or without the [1m] marker', () => {
  for (const model of ['claude-opus-5', 'claude-opus-5[1m]']) {
    const info = ClaudeDataLoader.getCurrentContextInfo([record(model)]);
    assert.ok(info, `expected context info for ${model}, got null`);
    assert.equal(info!.windowTokens, 1_000_000, model);
    assert.equal(info!.estimated, false, model);
  }
});

test('getCurrentContextInfo keeps the 200K window for pre-4.6 Opus and Sonnet', () => {
  for (const model of ['claude-opus-4-20250514', 'claude-sonnet-4-5-20250929', 'claude-3-5-sonnet-20241022']) {
    const info = ClaudeDataLoader.getCurrentContextInfo([record(model)]);
    assert.ok(info, `expected context info for ${model}, got null`);
    assert.equal(info!.windowTokens, 200_000, model);
  }
});

test('an injected manifest is authoritative and returns anonymous load counters', async () => {
  const manifestRoot = await mkdtemp(path.join(os.tmpdir(), 'ccu-loader-manifest-'));
  const emptyArgumentRoot = await mkdtemp(path.join(os.tmpdir(), 'ccu-loader-empty-'));
  tempRoots.push(manifestRoot, emptyArgumentRoot);
  const project = path.join(manifestRoot, 'projects', '-tmp-project');
  await mkdir(project, { recursive: true });
  const line = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-17T00:00:00.000Z',
    requestId: 'request-1',
    message: {
      id: 'message-1',
      model: 'claude-sonnet-4-5',
      usage: { input_tokens: 10, output_tokens: 2 },
    },
  }) + '\n';
  await writeFile(path.join(project, 'session.jsonl'), line);
  const manifest = await scanUsageManifest([manifestRoot]);

  const loaded = await ClaudeDataLoader.loadUsageRecords(emptyArgumentRoot, {
    analyzeContent: false,
    manifest,
  });

  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.diagnostics.filesDiscovered, 1);
  assert.ok(loaded.diagnostics.bytesRead >= Buffer.byteLength(line, 'utf8'));
  assert.equal(loaded.diagnostics.linesParsed, 1);
  assert.equal(loaded.diagnostics.filesFailed, 0);
});

test('a file that disappears after manifest scan marks the load incomplete', async () => {
  const manifestRoot = await mkdtemp(path.join(os.tmpdir(), 'ccu-loader-race-'));
  tempRoots.push(manifestRoot);
  const project = path.join(manifestRoot, 'projects', '-tmp-project');
  await mkdir(project, { recursive: true });
  const file = path.join(project, 'vanishing.jsonl');
  await writeFile(file, '{"timestamp":"2026-07-17T00:00:00.000Z"}\n');
  const manifest = await scanUsageManifest([manifestRoot]);
  await rm(file);
  const loaded = await ClaudeDataLoader.loadUsageRecords(manifestRoot, {
    analyzeContent: false,
    manifest,
  });
  assert.equal(loaded.diagnostics.filesFailed, 1);
});

interface UsageFixture {
  messageId?: string;
  requestId?: string;
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
  contentType?: 'thinking' | 'text';
  timestamp?: string;
}

function usageFixtureLine(fixture: UsageFixture): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: fixture.timestamp ?? '2026-08-21T00:00:00.000Z',
    ...(fixture.requestId ? { requestId: fixture.requestId } : {}),
    message: {
      ...(fixture.messageId ? { id: fixture.messageId } : {}),
      model: 'claude-haiku-4-5-20251001',
      content: fixture.contentType ? [{ type: fixture.contentType }] : [],
      usage: {
        input_tokens: fixture.input,
        output_tokens: fixture.output,
        cache_creation_input_tokens: fixture.cacheCreation ?? 0,
        cache_read_input_tokens: fixture.cacheRead ?? 0,
      },
    },
  });
}

async function loadDedupFixture(files: Record<string, UsageFixture[]>): Promise<ClaudeUsageRecord[]> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-loader-dedup-'));
  tempRoots.push(root);
  const project = path.join(root, 'projects', '-dedup-fixture');
  await mkdir(project, { recursive: true });
  await Promise.all(Object.entries(files).map(([name, fixtures]) =>
    writeFile(
      path.join(project, `${name}.jsonl`),
      `${fixtures.map(usageFixtureLine).join('\n')}\n`,
      'utf8',
    ),
  ));
  return (await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: false })).records;
}

function recordTokenTotal(value: ClaudeUsageRecord): number {
  const usage = value.message.usage;
  return usage.input_tokens + usage.output_tokens
    + (usage.cache_creation_input_tokens ?? 0)
    + (usage.cache_read_input_tokens ?? 0);
}

test('thinking and text transcript rows with one response identity count once', async () => {
  const identity = { messageId: 'message-thinking-text', requestId: 'request-thinking-text' };
  const records = await loadDedupFixture({
    session: [
      { ...identity, input: 3_709, output: 80, contentType: 'thinking' },
      { ...identity, input: 3_709, output: 80, contentType: 'text' },
    ],
  });

  assert.equal(records.length, 1);
  assert.equal(recordTokenTotal(records[0]), 3_789);
});

test('monotonic snapshots with one response identity retain only the maximum vector', async () => {
  const identity = { messageId: 'message-stream', requestId: 'request-stream' };
  const records = await loadDedupFixture({
    session: [
      { ...identity, input: 100, output: 10, cacheCreation: 5, cacheRead: 20 },
      { ...identity, input: 120, output: 30, cacheCreation: 5, cacheRead: 40 },
    ],
  });

  assert.equal(records.length, 1);
  assert.deepEqual(records[0].message.usage, {
    input_tokens: 120,
    output_tokens: 30,
    cache_creation_input_tokens: 5,
    cache_read_input_tokens: 40,
  });
});

test('a cross-file transcript clone with the same response identity counts once', async () => {
  const duplicate = {
    messageId: 'message-clone',
    requestId: 'request-clone',
    input: 500,
    output: 25,
  };
  const records = await loadDedupFixture({ original: [duplicate], clone: [duplicate] });

  assert.equal(records.length, 1);
  assert.equal(recordTokenTotal(records[0]), 525);
});

test('the same message ID with distinct request IDs remains separately counted', async () => {
  const records = await loadDedupFixture({
    session: [
      { messageId: 'message-reused', requestId: 'request-a', input: 100, output: 10 },
      { messageId: 'message-reused', requestId: 'request-b', input: 200, output: 20 },
    ],
  });

  assert.equal(records.length, 2);
  assert.equal(records.reduce((sum, value) => sum + recordTokenTotal(value), 0), 330);
});

test('request ID presence may degrade within one message without double-counting', async () => {
  for (const [name, fixtures] of Object.entries({
    missingFirst: [
      { messageId: 'message-missing-first', input: 300, output: 30 },
      { messageId: 'message-missing-first', requestId: 'request-known', input: 300, output: 30 },
    ],
    knownFirst: [
      { messageId: 'message-known-first', requestId: 'request-known', input: 400, output: 40 },
      { messageId: 'message-known-first', input: 400, output: 40 },
    ],
  })) {
    const records = await loadDedupFixture({ [name]: fixtures });
    assert.equal(records.length, 1, name);
  }
});
