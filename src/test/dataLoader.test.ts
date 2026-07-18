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
