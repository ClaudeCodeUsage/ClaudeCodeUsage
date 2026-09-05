'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const {
  createClaudePrototypeIndex,
  prototypeSnapshot,
  rebuildClaudePrototypeIndex,
  updateClaudePrototypeIndex,
} = require('./out/claudeIncrementalPrototype.js');

function ms(start) {
  return performance.now() - start;
}

async function jsonlFiles(directory) {
  const output = [];
  const walk = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) output.push(absolute);
    }
  };
  await walk(path.join(directory, 'projects'));
  return output.sort();
}

function line(id, input, output) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-21T08:00:00.000Z',
    requestId: `request-${id}`,
    cwd: '/benchmark/project-0',
    gitBranch: 'benchmark-tail',
    workflowId: 'wf-benchmark',
    message: {
      id: `message-${id}`,
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: `safe-${id}` }],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
      },
    },
  }) + '\n';
}

async function assertExact(root, index) {
  const rebuilt = await rebuildClaudePrototypeIndex(root);
  assert.deepEqual(
    prototypeSnapshot(index, Date.parse('2026-08-21T12:00:00.000Z')),
    prototypeSnapshot(rebuilt.index, Date.parse('2026-08-21T12:00:00.000Z')),
  );
}

async function main() {
  const root = path.resolve(process.argv[2]);
  const files = await jsonlFiles(root);
  if (files.length === 0) throw new Error('prototype benchmark has no JSONL files');

  let start = performance.now();
  let current = await updateClaudePrototypeIndex(createClaudePrototypeIndex(), root);
  const cold = { wallMs: ms(start), diagnostics: current.diagnostics };
  await assertExact(root, current.index);

  start = performance.now();
  current = await updateClaudePrototypeIndex(current.index, root);
  const unchanged = { wallMs: ms(start), diagnostics: current.diagnostics };

  const appended = line('prototype-append', 17, 5);
  await fs.appendFile(files[0], appended, 'utf8');
  start = performance.now();
  current = await updateClaudePrototypeIndex(current.index, root);
  const append = { wallMs: ms(start), diagnostics: current.diagnostics, expectedBytes: Buffer.byteLength(appended) };
  await assertExact(root, current.index);

  const truncated = line('prototype-truncate', 9, 2);
  await fs.writeFile(files[0], truncated, 'utf8');
  start = performance.now();
  current = await updateClaudePrototypeIndex(current.index, root);
  const truncate = { wallMs: ms(start), diagnostics: current.diagnostics, expectedBytes: Buffer.byteLength(truncated) };
  await assertExact(root, current.index);

  process.stdout.write(JSON.stringify({ cold, unchanged, append, truncate }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
