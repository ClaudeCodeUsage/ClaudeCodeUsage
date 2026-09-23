// Opt-in, synthetic-only Codex index diagnostic. No real Codex home is read.
// Run npm run compile first; for example:
// node --expose-gc tests/perf/measure-large-codex-index.mjs --gib 1.4 --files 645 --line-kib 16
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const directory = dirname(fileURLToPath(import.meta.url));
const { createEmptyCodexIndex, updateCodexIndex,
  CODEX_REFRESH_BACKFILL_MAX_BYTES,
  CODEX_REFRESH_BACKFILL_MAX_FILE_PASSES } = require(resolve(directory, '../../out/providers/codex/codexIndex.js'));
const { scanCodexManifest } = require(resolve(directory, '../../out/providers/codex/codexManifest.js'));
const { defaultCodexJsonlReader } = require(resolve(directory, '../../out/providers/codex/codexJsonlScanner.js'));

function option(name, fallback) {
  const position = process.argv.indexOf(name);
  if (position < 0) return fallback;
  const value = Number(process.argv[position + 1]);
  if (!Number.isFinite(value)) throw new Error(`${name} requires a finite number`);
  return value;
}

const gib = option('--gib', 1.4);
const fileCount = option('--files', 645);
const lineKiB = option('--line-kib', 16);
if (gib <= 0 || gib > 3 || !Number.isInteger(fileCount) || fileCount < 8 || fileCount > 1000) {
  throw new Error('Expected 0 < --gib <= 3 and 8 <= --files <= 1000');
}
if (lineKiB < 1 || lineKiB > 256) {
  throw new Error('Expected 1 <= --line-kib <= 256');
}
const targetBytes = Math.ceil(gib * 1024 ** 3);
const timestamp = '2026-07-20T00:01:00.000Z';
const now = Date.parse('2026-07-21T04:00:00.000Z');
const salt = 'synthetic-test-salt';
const timeZone = 'UTC';
const filler = `${JSON.stringify({ timestamp, type: 'event_msg', payload: {
  type: 'user_message', message: 'synthetic-only-'.repeat(
    Math.floor(lineKiB * 1024 / Buffer.byteLength('synthetic-only-')),
  ),
} })}\n`;
const fillerBytes = Buffer.byteLength(filler);
function seed(index, input = 100, output = 20) {
  return [
    { timestamp, type: 'session_meta', payload: {
      id: `synthetic-session-${index}`, cwd: '/fixture/codex-history',
    } },
    { timestamp, type: 'turn_context', payload: { model: 'gpt-5.6-sol', effort: 'high' } },
    { timestamp, type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: {
        input_tokens: input, cached_input_tokens: Math.floor(input / 2),
        output_tokens: output, reasoning_output_tokens: Math.floor(output / 2),
        total_tokens: input + output,
      },
    } } },
  ].map((row) => JSON.stringify(row)).join('\n') + '\n';
}
function tail(input = 150, output = 30) {
  return `${JSON.stringify({ timestamp, type: 'event_msg', payload: {
    type: 'token_count', info: { total_token_usage: {
      input_tokens: input, cached_input_tokens: Math.floor(input / 2),
      output_tokens: output, reasoning_output_tokens: Math.floor(output / 2),
      total_tokens: input + output,
    } },
  } })}\n`;
}

const root = await mkdtemp(join(tmpdir(), 'ccu-v240-codex-synthetic-'));
const sessions = join(root, 'sessions');
const files = [];
let peakRssBytes = process.memoryUsage().rss;
const sampler = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
}, 50);
const phases = [];
function instrumentedIo() {
  const reads = [];
  return {
    reads,
    async *read(entry, start, end) {
      let bytes = 0;
      for await (const chunk of defaultCodexJsonlReader.read(entry, start, end)) {
        bytes += chunk.length;
        yield chunk;
      }
      reads.push({ fileKey: entry.fileKey, start, bytes });
    },
  };
}
async function measured(label, work) {
  const io = instrumentedIo();
  const start = performance.now();
  const result = await work(io);
  const rssBytes = process.memoryUsage().rss;
  peakRssBytes = Math.max(peakRssBytes, rssBytes);
  const phase = {
    label, elapsedMs: Math.round(performance.now() - start),
    rssBytes,
    bodyReads: result.bodyReads,
    readCalls: io.reads.length,
    bytesRead: io.reads.reduce((sum, read) => sum + read.bytes, 0),
    migration: result.migration,
  };
  phases.push(phase);
  return { result, phase, io };
}
const budget = {
  maxFilePasses: CODEX_REFRESH_BACKFILL_MAX_FILE_PASSES,
  maxBytes: CODEX_REFRESH_BACKFILL_MAX_BYTES,
};
async function update(index, io) {
  const manifest = await scanCodexManifest(root, salt);
  return updateCodexIndex(index, manifest, {
    salt, timeZone, now: () => now, budget, io,
  });
}

try {
  await mkdir(sessions, { recursive: true });
  const seedBytes = Buffer.byteLength(seed(0));
  const fillerCount = Math.ceil(Math.max(0, targetBytes - fileCount * seedBytes) / fillerBytes);
  let writtenBytes = 0;
  for (let index = 0; index < fileCount; index += 1) {
    const file = join(sessions, `rollout-${String(index).padStart(4, '0')}.jsonl`);
    files.push(file);
    const copies = Math.floor(fillerCount / fileCount) +
      (index < fillerCount % fileCount ? 1 : 0);
    const body = seed(index) + filler.repeat(copies);
    writtenBytes += Buffer.byteLength(body);
    await writeFile(file, body, 'utf8');
    if ((index + 1) % 100 === 0) process.stdout.write(`generated ${index + 1}/${fileCount} files\n`);
  }
  assert.ok(writtenBytes >= targetBytes);
  process.stdout.write(`fixture bytes=${writtenBytes} files=${fileCount} fillerLines=${fillerCount} fillerLineBytes=${fillerBytes}\n`);

  const cold = await measured('cold', (io) => update(createEmptyCodexIndex(timeZone), io));
  assert.equal(cold.result.failedFiles, 0);
  assert.equal(cold.result.index.coverage.complete, true);
  assert.equal(cold.result.index.coverage.period.allTime.complete, true);
  assert.equal(cold.result.index.coverage.hourly?.complete, true);
  assert.equal(cold.result.index.aggregate.total.inputTotal, 100 * fileCount);

  const unchanged = await measured('unchanged', (io) => update(cold.result.index, io));
  assert.strictEqual(unchanged.result.index, cold.result.index);
  assert.equal(unchanged.phase.readCalls, 0);
  assert.equal(unchanged.phase.bytesRead, 0);

  const tailIndexes = fileCount >= 645 ? [7, 91, 183, 275, 367, 459, 644] : [0, 1, 2, 3, 4, 5, 6];
  for (const index of tailIndexes) await appendFile(files[index], tail(), 'utf8');
  const added = join(sessions, 'rollout-new.jsonl');
  await writeFile(added, seed(fileCount), 'utf8');
  const warm = await measured('seven-tails-plus-new', (io) => update(unchanged.result.index, io));
  assert.equal(warm.result.failedFiles, 0);
  assert.equal(warm.result.index.coverage.complete, true);
  assert.equal(warm.result.index.aggregate.total.inputTotal, 100 * (fileCount + 1) + 50 * 7);
  const changedKeys = new Set((await scanCodexManifest(root, salt)).files
    .filter((entry) => tailIndexes.some((index) => files[index] === entry.absolutePath) ||
      entry.absolutePath === added)
    .map((entry) => entry.fileKey));
  assert.equal(changedKeys.size, 8);
  assert.ok(warm.io.reads.every((read) => changedKeys.has(read.fileKey)),
    'append/new-file refresh must not read untouched JSONL bodies');
  assert.ok(warm.phase.bytesRead < 8 * 1024 * 1024);

  await writeFile(files[0], seed(0, 40, 10), 'utf8');
  const truncated = await measured('truncate-one-file', (io) => update(warm.result.index, io));
  assert.equal(truncated.result.failedFiles, 0);
  assert.equal(truncated.result.index.aggregate.total.inputTotal,
    warm.result.index.aggregate.total.inputTotal -
      (100 + (tailIndexes.includes(0) ? 50 : 0) - 40));
  const truncatedKey = (await scanCodexManifest(root, salt)).files
    .find((entry) => entry.absolutePath === files[0]).fileKey;
  assert.ok(truncated.io.reads.every((read) => read.fileKey === truncatedKey),
    'one-file truncation must not rescan untouched JSONL bodies');

  await unlink(files[1]);
  const deleted = await measured('delete-one-file', (io) => update(truncated.result.index, io));
  assert.equal(deleted.result.failedFiles, 0);
  assert.equal(deleted.result.index.aggregate.total.inputTotal,
    truncated.result.index.aggregate.total.inputTotal -
      (100 + (tailIndexes.includes(1) ? 50 : 0)));
  assert.equal(deleted.phase.bytesRead, 0,
    'one-file deletion must not rescan unaffected JSONL bodies');

  if (typeof global.gc === 'function') {
    global.gc();
    assert.ok(process.memoryUsage().heapUsed <
      Math.max(200 * 1024 ** 2, writtenBytes / 2),
    'retained heap must remain below the synthetic corpus memory ceiling');
  }
  process.stdout.write(`${JSON.stringify({
    fixtureBytes: writtenBytes, files: fileCount, fillerLines: fillerCount,
    fillerLineBytes: fillerBytes, peakRssBytes,
    postGcHeapBytes: process.memoryUsage().heapUsed, phases,
  })}\n`);
} finally {
  clearInterval(sampler);
  await rm(root, { recursive: true, force: true });
}
