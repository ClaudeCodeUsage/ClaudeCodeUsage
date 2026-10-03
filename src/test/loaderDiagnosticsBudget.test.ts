import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ClaudeDataLoader } from '../dataLoader';
import { scanUsageManifest } from '../claudeUsageFiles';

test('50k malformed transcript lines produce anonymous summary diagnostics, not console RPC floods', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-malformed-diagnostics-'));
  const project = path.join(root, 'projects', '-synthetic-private-fixture');
  const warn = console.warn;
  const error = console.error;
  let consoleCalls = 0;
  const messages: string[] = [];
  console.warn = console.error = () => { consoleCalls += 1; };
  try {
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, 'session.jsonl'), 'private-fixture invalid JSON\n'.repeat(50_000));
    const result = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: false, log: line => messages.push(line) });
    assert.equal(result.records.length, 0);
    assert.equal(result.diagnostics.linesParsed, 50_000);
    assert.equal(consoleCalls, 0);
    assert.ok(messages.length <= 2);
    assert.ok(messages.some(line => line.includes('parse-errors=50000')));
    assert.equal(messages.some(line => line.includes('private-fixture') || line.includes(root)), false);
  } finally {
    console.warn = warn;
    console.error = error;
    await rm(root, { recursive: true, force: true });
  }
});

test('many missing files remain detectable without per-file console errors or paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-missing-diagnostics-'));
  const project = path.join(root, 'projects', '-synthetic-private-fixture');
  const warn = console.warn;
  const error = console.error;
  let consoleCalls = 0;
  const messages: string[] = [];
  console.warn = console.error = () => { consoleCalls += 1; };
  try {
    await mkdir(project, { recursive: true });
    await Promise.all(Array.from({ length: 128 }, (_, index) => writeFile(path.join(project, `session-${index}.jsonl`), '{}\n')));
    const manifest = await scanUsageManifest([root]);
    await rm(project, { recursive: true, force: true });
    const result = await ClaudeDataLoader.loadUsageRecords(root, { manifest, analyzeContent: false, log: line => messages.push(line) });
    assert.equal(result.diagnostics.filesFailed, 128);
    assert.equal(consoleCalls, 0);
    assert.ok(messages.some(line => line.includes('files-failed=128')));
    assert.equal(messages.some(line => line.includes('private-fixture') || line.includes(root)), false);
  } finally {
    console.warn = warn;
    console.error = error;
    await rm(root, { recursive: true, force: true });
  }
});

test('diagnostic model-name churn is bounded and arbitrary labels are not echoed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-model-diagnostics-'));
  const project = path.join(root, 'projects', '-synthetic-private-fixture');
  const messages: string[] = [];
  try {
    await mkdir(project, { recursive: true });
    const labels = ['__proto__', 'constructor', '/private/private-fixture/model', 'private-fixture\nvalue', 'private-fixture-' + 'x'.repeat(10_000),
      ...Array.from({ length: 2_000 }, (_, index) => `future-model-${index}`)];
    await writeFile(path.join(project, 'session.jsonl'), labels.map((model, index) => JSON.stringify({
      type: 'assistant', timestamp: new Date().toISOString(), uuid: `uuid-${index}`, requestId: `request-${index}`,
      message: { id: `message-${index}`, role: 'assistant', model, usage: { input_tokens: 100, output_tokens: 10 } },
    })).join('\n'));
    const result = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: false, log: line => messages.push(line) });
    assert.equal(result.records.length, labels.length, 'diagnostic limits must not drop usage');
    assert.equal(messages.length, 2);
    assert.ok(messages.every(line => line.length < 3_000));
    assert.equal(messages.some(line => line.includes('private-fixture') || line.includes(root)), false);
    assert.ok(messages.some(line => line.includes('other-models=')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
