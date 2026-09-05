import { after, test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  appendFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createClaudePrototypeIndex,
  prototypeSnapshot,
  rebuildClaudePrototypeIndex,
  updateClaudePrototypeIndex,
} from '../claudeIncrementalPrototype';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

function usageLine(
  id: string,
  input: number,
  output: number,
  options: {
    timestamp?: string;
    project?: string;
    branch?: string;
    workflow?: string;
    content?: string;
  } = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: options.timestamp ?? '2026-08-21T08:00:00.000Z',
    requestId: `request-${id}`,
    cwd: options.project ?? '/fixture/project-a',
    gitBranch: options.branch ?? 'main',
    workflowId: options.workflow,
    message: {
      id: `message-${id}`,
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: options.content ?? `answer-${id}` }],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
      },
    },
  });
}

async function fixture(): Promise<{
  root: string;
  first: string;
  second: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-incremental-'));
  tempRoots.push(root);
  const project = path.join(root, 'projects', '-fixture-project');
  await mkdir(project, { recursive: true });
  const first = path.join(project, 'session-first.jsonl');
  const second = path.join(project, 'session-second.jsonl');
  await writeFile(first, `${usageLine('first', 10, 4)}\n`, 'utf8');
  await writeFile(
    second,
    `${usageLine('second', 20, 8, { project: '/fixture/project-b', branch: 'feature' })}\n`,
    'utf8',
  );
  return { root, first, second };
}

async function assertMatchesFullRebuild(
  root: string,
  incremental: Awaited<ReturnType<typeof updateClaudePrototypeIndex>>['index'],
): Promise<void> {
  const full = await rebuildClaudePrototypeIndex(root);
  assert.deepEqual(
    prototypeSnapshot(incremental, Date.parse('2026-08-21T12:00:00.000Z')),
    prototypeSnapshot(full.index, Date.parse('2026-08-21T12:00:00.000Z')),
  );
}

test('append reads only the completed tail and incrementally updates every global grouping', async () => {
  const { root, first } = await fixture();
  const cold = await updateClaudePrototypeIndex(createClaudePrototypeIndex(), root);
  const appended = `${usageLine('append', 7, 5, {
    project: '/fixture/project-a',
    branch: 'topic',
    workflow: 'wf-fixture',
    content: 'incremental-content',
  })}\n`;
  await appendFile(first, appended, 'utf8');

  const warm = await updateClaudePrototypeIndex(cold.index, root);

  assert.equal(warm.diagnostics.bodyReads, 1);
  assert.equal(warm.diagnostics.bytesRead, Buffer.byteLength(appended));
  assert.equal(warm.diagnostics.linesParsed, 1);
  assert.ok(warm.diagnostics.aggregateMutations <= 2);
  assert.deepEqual(warm.diagnostics.changed, { append: 1, rebuild: 0, move: 0, delete: 0 });
  await assertMatchesFullRebuild(root, warm.index);
});

test('incomplete tail is ignored until newline and then read from the last verified offset', async () => {
  const { root, first } = await fixture();
  const cold = await updateClaudePrototypeIndex(createClaudePrototypeIndex(), root);
  const partial = usageLine('partial', 9, 6);
  await appendFile(first, partial, 'utf8');

  const pending = await updateClaudePrototypeIndex(cold.index, root);
  assert.equal(pending.diagnostics.linesParsed, 0);
  assert.equal(
    prototypeSnapshot(pending.index, Date.parse('2026-08-21T12:00:00.000Z')).allTime.input,
    30,
  );

  await appendFile(first, '\n', 'utf8');
  const completed = await updateClaudePrototypeIndex(pending.index, root);
  assert.equal(completed.diagnostics.linesParsed, 1);
  await assertMatchesFullRebuild(root, completed.index);
});

test('truncate, replacement, move, and delete touch only affected contributions', async () => {
  const { root, first, second } = await fixture();
  await appendFile(first, `${usageLine('pre-truncate-padding', 30, 10, {
    content: 'padding'.repeat(100),
  })}\n`, 'utf8');
  let current = await updateClaudePrototypeIndex(createClaudePrototypeIndex(), root);

  await writeFile(first, `${usageLine('truncated', 3, 1)}\n`, 'utf8');
  current = await updateClaudePrototypeIndex(current.index, root);
  assert.deepEqual(current.diagnostics.changed, { append: 0, rebuild: 1, move: 0, delete: 0 });
  assert.equal(current.diagnostics.bodyReads, 1);
  await assertMatchesFullRebuild(root, current.index);

  const replacement = `${first}.replacement`;
  await writeFile(replacement, `${usageLine('replacement', 13, 2)}\n`, 'utf8');
  await rename(replacement, first);
  current = await updateClaudePrototypeIndex(current.index, root);
  assert.deepEqual(current.diagnostics.changed, { append: 0, rebuild: 1, move: 0, delete: 0 });
  assert.equal(current.diagnostics.bodyReads, 1);
  await assertMatchesFullRebuild(root, current.index);

  const movedDir = path.join(root, 'projects', '-fixture-moved');
  await mkdir(movedDir, { recursive: true });
  const moved = path.join(movedDir, path.basename(first));
  await rename(first, moved);
  current = await updateClaudePrototypeIndex(current.index, root);
  assert.deepEqual(current.diagnostics.changed, { append: 0, rebuild: 0, move: 1, delete: 0 });
  assert.equal(current.diagnostics.bodyReads, 0);
  await assertMatchesFullRebuild(root, current.index);

  await unlink(second);
  current = await updateClaudePrototypeIndex(current.index, root);
  assert.deepEqual(current.diagnostics.changed, { append: 0, rebuild: 0, move: 0, delete: 1 });
  assert.equal(current.diagnostics.bodyReads, 0);
  await assertMatchesFullRebuild(root, current.index);
});

test('bytes appended after manifest capture are deferred to the next atomic update', async () => {
  const { root, first } = await fixture();
  const cold = await updateClaudePrototypeIndex(createClaudePrototypeIndex(), root);
  const firstAppend = `${usageLine('captured', 4, 2)}\n`;
  const concurrentAppend = `${usageLine('concurrent', 6, 3)}\n`;
  await appendFile(first, firstAppend, 'utf8');

  const bounded = await updateClaudePrototypeIndex(cold.index, root, {
    afterManifest: async () => appendFile(first, concurrentAppend, 'utf8'),
  });
  assert.equal(bounded.diagnostics.bytesRead, Buffer.byteLength(firstAppend));
  assert.equal(bounded.diagnostics.linesParsed, 1);

  const caughtUp = await updateClaudePrototypeIndex(bounded.index, root);
  assert.equal(caughtUp.diagnostics.bytesRead, Buffer.byteLength(concurrentAppend));
  assert.equal(caughtUp.diagnostics.linesParsed, 1);
  await assertMatchesFullRebuild(root, caughtUp.index);
});

test('one changed file in a reused corpus keeps I/O, parsing, and aggregate mutations bounded', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-incremental-scale-'));
  tempRoots.push(root);
  const project = path.join(root, 'projects', '-fixture-scale');
  await mkdir(project, { recursive: true });
  const files: string[] = [];
  for (let index = 0; index < 100; index += 1) {
    const file = path.join(project, `session-${index}.jsonl`);
    files.push(file);
    await writeFile(file, `${usageLine(`cold-${index}`, index + 1, 1)}\n`, 'utf8');
  }
  const cold = await updateClaudePrototypeIndex(createClaudePrototypeIndex(), root);
  const tail = `${usageLine('only-change', 5, 2)}\n`;
  await appendFile(files[42], tail, 'utf8');

  const warm = await updateClaudePrototypeIndex(cold.index, root);

  assert.equal(warm.diagnostics.bodyReads, 1);
  assert.equal(warm.diagnostics.bytesRead, Buffer.byteLength(tail));
  assert.equal(warm.diagnostics.linesParsed, 1);
  assert.ok(warm.diagnostics.aggregateMutations <= 2);
  await assertMatchesFullRebuild(root, warm.index);
});

test('global duplicate ownership changes incrementally and falls back when the winner disappears', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-incremental-dedup-'));
  tempRoots.push(root);
  const project = path.join(root, 'projects', '-fixture-dedup');
  await mkdir(project, { recursive: true });
  const lower = path.join(project, 'session-lower.jsonl');
  const higher = path.join(project, 'session-higher.jsonl');
  await writeFile(lower, `${usageLine('duplicate', 10, 2)}\n`, 'utf8');
  await writeFile(higher, `${usageLine('duplicate', 20, 4)}\n`, 'utf8');

  let current = await updateClaudePrototypeIndex(createClaudePrototypeIndex(), root);
  assert.equal(
    prototypeSnapshot(current.index, Date.parse('2026-08-21T12:00:00.000Z')).allTime.input,
    20,
  );

  const stronger = `${usageLine('duplicate', 30, 6)}\n`;
  await appendFile(lower, stronger, 'utf8');
  current = await updateClaudePrototypeIndex(current.index, root);
  assert.equal(current.diagnostics.bytesRead, Buffer.byteLength(stronger));
  assert.equal(current.diagnostics.aggregateMutations, 1);
  assert.equal(
    prototypeSnapshot(current.index, Date.parse('2026-08-21T12:00:00.000Z')).allTime.input,
    30,
  );
  await assertMatchesFullRebuild(root, current.index);

  await unlink(lower);
  current = await updateClaudePrototypeIndex(current.index, root);
  assert.equal(current.diagnostics.aggregateMutations, 1);
  assert.equal(
    prototypeSnapshot(current.index, Date.parse('2026-08-21T12:00:00.000Z')).allTime.input,
    20,
  );
  await assertMatchesFullRebuild(root, current.index);
});
