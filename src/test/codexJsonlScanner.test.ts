import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  CODEX_JSONL_CHUNK_BYTES,
  CODEX_MAX_JSONL_LINE_BYTES,
  CodexJsonlReader,
  scanCodexJsonlLines,
} from '../providers/codex/codexJsonlScanner';
import { CodexRuntimeManifestEntry } from '../providers/codex/codexManifest';

function entryFor(body: Buffer): CodexRuntimeManifestEntry {
  return {
    fileKey: 'safe-file-key',
    sourceArea: 'sessions',
    absolutePath: '/private/never-persist-this-path.jsonl',
    nonPersisted: true,
    size: body.length,
    mtimeMs: 1,
  };
}

function memoryReader(body: Buffer, chunkEnds: readonly number[] = []): CodexJsonlReader {
  return {
    async *read(_entry, start, endExclusive) {
      let position = start;
      for (const requestedEnd of [...chunkEnds, endExclusive]) {
        const next = Math.min(Math.max(requestedEnd, position), endExclusive);
        if (next > position) {
          yield body.subarray(position, next);
          position = next;
        }
      }
    },
  };
}

test('the production reader uses a multi-megabyte cold-scan chunk', () => {
  assert.equal(CODEX_JSONL_CHUNK_BYTES, 1024 * 1024);
});

test('decodes a complete UTF-8 JSON line only after split Buffer chunks join', async () => {
  const completeJsonLine = JSON.stringify({ title: '真实标题' });
  const body = Buffer.from(`${completeJsonLine}\n`, 'utf8');
  const multibyteStart = body.indexOf(Buffer.from('真', 'utf8'));
  const seen: string[] = [];

  await scanCodexJsonlLines(
    entryFor(body),
    memoryReader(body, [multibyteStart + 1, multibyteStart + 2]),
    { offset: 0, discardingOversizedLine: false },
    body.length,
    (line) => seen.push(line),
  );

  assert.deepEqual(seen, [completeJsonLine]);
});

test('does not return or report an incomplete sensitive line fragment', async () => {
  const body = Buffer.from('{"prompt":"private prompt body"}', 'utf8');
  const progress: unknown[] = [];

  const result = await scanCodexJsonlLines(
    entryFor(body),
    memoryReader(body, [8, 16]),
    { offset: 0, discardingOversizedLine: false },
    body.length,
    () => assert.fail('incomplete lines must not be emitted'),
    async (value) => {
      progress.push(value);
    },
  );

  assert.equal(result.cursor.offset, 0);
  assert.doesNotMatch(JSON.stringify(result), /private prompt body/);
  assert.doesNotMatch(JSON.stringify(progress), /private prompt body/);
});

test('discards an oversized line across scans and resumes after its newline', async () => {
  const oversized = Buffer.alloc(CODEX_MAX_JSONL_LINE_BYTES + 1, 0x78);
  const completeJsonLine = '{"ok":true}';
  const body = Buffer.concat([
    oversized,
    Buffer.from(`\n${completeJsonLine}\n`, 'utf8'),
  ]);
  const entry = entryFor(body);
  const first = await scanCodexJsonlLines(
    entry,
    memoryReader(body),
    { offset: 0, discardingOversizedLine: false },
    oversized.length,
    () => assert.fail('an oversized incomplete line must not be emitted'),
  );
  const seen: string[] = [];

  const result = await scanCodexJsonlLines(
    entry,
    memoryReader(body),
    first.cursor,
    body.length,
    (line) => seen.push(line),
  );

  assert.equal(first.cursor.offset, oversized.length);
  assert.equal(first.cursor.discardingOversizedLine, true);
  assert.deepEqual(seen, [completeJsonLine]);
  assert.equal(result.oversizedLines, 1);
  assert.equal(result.cursor.discardingOversizedLine, false);
  assert.equal(result.cursor.offset, body.length);
});
