// Opt-in local diagnostic for a large synthetic Claude transcript history.
// It never reads the user's Claude profile. The fixture is removed on exit.
// Run npm run compile first. For the retained-heap gate, use:
// node --expose-gc tests/perf/measure-large-claude-index.mjs --gib 2.4 --files 645 --analyze-content [--assistant-payload]
// Content analysis is off by default to isolate usage-index I/O. Use the
// opt-in flag to measure the more expensive default-on production path.
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const { createClaudeUsageIndex, updateClaudeUsageIndex } = require(resolve(scriptDirectory, '../../out/claudeIncrementalIndex.js'));

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at < 0) return fallback;
  const parsed = Number(process.argv[at + 1]);
  if (!Number.isFinite(parsed)) throw new Error(`${name} needs a finite number`);
  return parsed;
}

const targetGiB = option('--gib', 2.4);
const fileCount = option('--files', 645);
const analyzeContent = process.argv.includes('--analyze-content');
const assistantPayload = process.argv.includes('--assistant-payload');
if (analyzeContent && typeof global.gc !== 'function') {
  throw new Error('Content-analysis memory gate requires node --expose-gc');
}
if (targetGiB <= 0 || targetGiB > 3 || !Number.isInteger(fileCount) || fileCount < 8 || fileCount > 1000) {
  throw new Error('Expected 0 < --gib <= 3 and 8 <= --files <= 1000');
}

const timestamp = new Date().toISOString();
const payload = 'synthetic-only-'.repeat(17_000); // ~255 KiB; safely below the 1 MiB line cap.
const fillerLine = `${JSON.stringify(assistantPayload ? {
  type: 'assistant', timestamp, cwd: '/fixture/large-history',
  message: {
    role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: payload }],
    usage: { input_tokens: 10, output_tokens: 1 },
  },
} : {
  type: 'user', timestamp, cwd: '/fixture/large-history',
  message: { role: 'user', content: payload },
})}\n`;
const fillerBytes = Buffer.byteLength(fillerLine);
const seedLine = (index) => `${JSON.stringify({
  type: 'assistant', timestamp, cwd: '/fixture/large-history',
  requestId: `synthetic-request-${index}`,
  message: {
    id: `synthetic-message-${index}`, model: 'claude-sonnet-4-5',
    content: [{ type: 'text', text: 'synthetic response' }],
    usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 },
  },
})}\n`;
const seedBytes = Buffer.byteLength(seedLine(0));
const targetBytes = Math.ceil(targetGiB * 1024 ** 3);
const fillerCount = Math.ceil(Math.max(0, targetBytes - fileCount * seedBytes) / fillerBytes);
const root = await mkdtemp(join(tmpdir(), 'ccu-v240-large-synthetic-'));
const project = join(root, 'projects', '-fixture-large-history');
const files = [];
let peakRss = process.memoryUsage().rss;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 50);

async function measured(label, work) {
  const start = performance.now();
  const result = await work();
  const memory = process.memoryUsage();
  return {
    label,
    elapsedMs: Math.round(performance.now() - start),
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    result,
  };
}

try {
  await mkdir(project, { recursive: true });
  let writtenBytes = 0;
  const generated = await measured('generate', async () => {
    for (let index = 0; index < fileCount; index += 1) {
      const file = join(project, `session-${String(index).padStart(4, '0')}.jsonl`);
      files.push(file);
      const copies = Math.floor(fillerCount / fileCount) + (index < fillerCount % fileCount ? 1 : 0);
      const body = seedLine(index) + fillerLine.repeat(copies);
      writtenBytes += Buffer.byteLength(body);
      await writeFile(file, body, 'utf8');
      if ((index + 1) % 100 === 0) process.stdout.write(`generated ${index + 1}/${fileCount} files\n`);
    }
  });
  assert.ok(writtenBytes >= targetBytes, 'fixture must meet the declared byte target');
  process.stdout.write(`fixture bytes=${writtenBytes} files=${fileCount} contentAnalysis=${analyzeContent} assistantPayload=${assistantPayload}\n`);

  const cold = await measured('cold', () => updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent,
  }));
  assert.equal(cold.result.diagnostics.bodyReads, fileCount);
  assert.ok(cold.result.records.length >= fileCount);
  const coldRecords = cold.result.records.length;
  const unchanged = await measured('unchanged', () => updateClaudeUsageIndex(cold.result.index, root, {
    analyzeContent,
  }));
  assert.equal(unchanged.result.diagnostics.bodyReads, 0);
  assert.equal(unchanged.result.diagnostics.bytesRead, 0);

  let appendedBytes = 0;
  const tailFiles = fileCount >= 645 ? [7, 91, 183, 275, 367, 459, 644] : [0, 1, 2, 3, 4, 5, 6];
  for (const index of tailFiles) {
    const line = seedLine(fileCount + index);
    appendedBytes += Buffer.byteLength(line);
    await appendFile(files[index], line, 'utf8');
  }
  const newLine = seedLine(fileCount * 2);
  await writeFile(join(project, 'session-new.jsonl'), newLine, 'utf8');
  const warm = await measured('seven-tails-plus-new', () => updateClaudeUsageIndex(unchanged.result.index, root, {
    analyzeContent,
  }));
  assert.equal(warm.result.diagnostics.bodyReads, 8);
  // The first-timestamp probe may read some/all of the new file before its
  // one normal body scan; keep the bound without pinning that probe's size.
  assert.ok(warm.result.diagnostics.bytesRead >= appendedBytes + Buffer.byteLength(newLine));
  assert.ok(warm.result.diagnostics.bytesRead <= appendedBytes + 2 * Buffer.byteLength(newLine));
  assert.equal(warm.result.records.length, coldRecords + 8);

  const replacementLine = seedLine(fileCount * 3);
  await writeFile(files[0], replacementLine, 'utf8');
  const truncated = await measured('truncate-one-file', () => updateClaudeUsageIndex(warm.result.index, root, {
    analyzeContent,
  }));
  // Content analysis currently falls back to a full ordered rebuild on an
  // unsafe source mutation so cross-file UUID ownership stays correct. Do not
  // lock that expensive implementation in as a desired future contract.
  assert.ok(truncated.result.diagnostics.bodyReads >= 1 &&
    truncated.result.diagnostics.bodyReads <= fileCount + 1);
  if (!analyzeContent) {
    assert.equal(truncated.result.diagnostics.bodyReads, 1);
    assert.deepEqual(truncated.result.diagnostics.changed,
      { append: 0, rebuild: 1, move: 0, delete: 0 });
    assert.ok(truncated.result.diagnostics.bytesRead <= 4 * Buffer.byteLength(replacementLine),
      'usage-only truncation must not reread untouched large files');
  }
  assert.ok(truncated.result.records.length <= warm.result.records.length);

  await unlink(files[1]);
  const deleted = await measured('delete-one-file', () => updateClaudeUsageIndex(truncated.result.index, root, {
    analyzeContent,
  }));
  assert.ok(deleted.result.diagnostics.bodyReads <= fileCount);
  if (!analyzeContent) {
    assert.equal(deleted.result.diagnostics.bodyReads, 0);
    assert.equal(deleted.result.diagnostics.bytesRead, 0);
    assert.deepEqual(deleted.result.diagnostics.changed,
      { append: 0, rebuild: 0, move: 0, delete: 1 });
  }
  assert.ok(deleted.result.records.length < truncated.result.records.length);

  const afterGc = typeof global.gc === 'function'
    ? await measured('post-forced-gc', async () => { global.gc(); })
    : null;
  if (analyzeContent && afterGc) {
    assert.ok(afterGc.heapUsedBytes < Math.max(200 * 1024 ** 2, writtenBytes / 2),
      'retained heap must remain below the synthetic transcript memory ceiling');
  }

  process.stdout.write(`${JSON.stringify({
    fixtureBytes: writtenBytes,
    files: fileCount,
    coldRecords,
    contentAnalysis: analyzeContent,
    assistantPayload,
    peakRssBytes: peakRss,
    phases: [
      { label: generated.label, elapsedMs: generated.elapsedMs,
        rssBytes: generated.rssBytes, heapUsedBytes: generated.heapUsedBytes },
      ...[cold, unchanged, warm, truncated, deleted].map(({ label, elapsedMs, rssBytes, heapUsedBytes, result }) => ({
        label, elapsedMs, rssBytes, heapUsedBytes,
        bodyReads: result.diagnostics.bodyReads,
        bytesRead: result.diagnostics.bytesRead,
        linesParsed: result.diagnostics.linesParsed,
        changed: result.diagnostics.changed,
      })),
      ...(afterGc ? [{ label: afterGc.label, elapsedMs: afterGc.elapsedMs,
        rssBytes: afterGc.rssBytes, heapUsedBytes: afterGc.heapUsedBytes }] : []),
    ],
  })}\n`);
} finally {
  clearInterval(sampler);
  await rm(root, { recursive: true, force: true });
}
