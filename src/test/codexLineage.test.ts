import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CodexIndexV3,
  createEmptyCodexIndex,
  loadCodexIndex,
  saveCodexIndexAtomic,
  updateCodexIndex,
} from '../providers/codex/codexIndex';
import { pseudonymousIdentityKey } from '../providers/codex/codexIdentity';
import { scanCodexManifest } from '../providers/codex/codexManifest';
import {
  createCodexParserState,
  parseCodexLine,
} from '../providers/codex/codexParser';
import { ProviderTokenCounts } from '../providers/providerTypes';

const SALT = 'lineage-fixture-salt';
const NOW = Date.parse('2026-07-20T12:00:00.000Z');

function sessionMeta(
  id: string,
  treeId = id,
  parentId?: string,
): string {
  return JSON.stringify({
    timestamp: '2026-07-20T00:00:00.000Z',
    type: 'session_meta',
    payload: {
      id,
      session_id: treeId,
      ...(parentId
        ? {
            forked_from_id: parentId,
            source: {
              subagent: {
                thread_spawn: { parent_thread_id: parentId },
              },
            },
          }
        : {}),
    },
  });
}

function taskStarted(label: string, second = 0): string {
  return JSON.stringify({
    timestamp: `2026-07-20T00:00:${String(second).padStart(2, '0')}.000Z`,
    type: 'event_msg',
    payload: { type: 'task_started', turn_id: label },
  });
}

function tokenCount(input: number, output = 0, second = 1): string {
  return JSON.stringify({
    timestamp: `2026-07-20T00:00:${String(second).padStart(2, '0')}.000Z`,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: 0,
          output_tokens: output,
          reasoning_output_tokens: 0,
          total_tokens: input + output,
        },
      },
    },
  });
}

function exactTokenCount(
  total: ProviderTokenCounts,
  last: ProviderTokenCounts,
  second = 1,
): string {
  const snapshot = (tokens: ProviderTokenCounts) => ({
    input_tokens: tokens.inputTotal,
    cached_input_tokens: tokens.cachedInput ?? 0,
    output_tokens: tokens.outputTotal,
    reasoning_output_tokens: tokens.reasoningOutput ?? 0,
    total_tokens: tokens.inputTotal + tokens.outputTotal,
  });
  return JSON.stringify({
    timestamp: `2026-07-20T00:00:${String(second).padStart(2, '0')}.000Z`,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: snapshot(total),
        // Active context is intentionally unrelated to attributed usage.
        last_token_usage: { ...snapshot(last), total_tokens: 64_000 },
      },
    },
  });
}

function rollout(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

async function scanFixture(
  files: Record<string, string>,
): Promise<{ root: string; index: CodexIndexV3 }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lineage-'));
  const sessions = path.join(root, 'sessions');
  await mkdir(sessions, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(sessions, `${name}.jsonl`), body, 'utf8');
  }
  const result = await updateCodexIndex(
    createEmptyCodexIndex('UTC'),
    await scanCodexManifest(root, SALT),
    { salt: SALT, timeZone: 'UTC', now: () => NOW },
  );
  return { root, index: result.index };
}

function bySession(index: CodexIndexV3, rawId: string) {
  const sessionKey = pseudonymousIdentityKey(SALT, rawId);
  return Object.values(index.files).find(
    (file) => file.aggregate.session.sessionKey === sessionKey,
  );
}

function fieldsByFile(index: CodexIndexV3, field: 'aggregate' | 'lineage') {
  // Discovery and persisted maps need not share insertion order. Preserve the
  // file identity when comparing every aggregate or lineage field.
  return Object.fromEntries(
    Object.entries(index.files).map(([key, file]) => [key, file[field]]),
  );
}

test('resume appended to one physical rollout keeps the terminal cumulative value', async () => {
  const { root, index } = await scanFixture({
    resume: rollout(
      sessionMeta('resume'),
      taskStarted('first'),
      tokenCount(100, 10, 1),
      taskStarted('resumed', 2),
      tokenCount(150, 20, 3),
    ),
  });
  try {
    assert.equal(index.aggregate.total.inputTotal, 150);
    assert.equal(index.aggregate.total.outputTotal, 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a child fork subtracts only its copied parent prefix', async () => {
  const { root, index } = await scanFixture({
    parent: rollout(
      sessionMeta('parent', 'tree'),
      taskStarted('parent-turn'),
      tokenCount(100, 10, 1),
    ),
    child: rollout(
      sessionMeta('child', 'tree', 'parent'),
      sessionMeta('parent', 'tree'),
      taskStarted('parent-turn'),
      tokenCount(100, 10, 1),
      taskStarted('child-turn', 2),
      tokenCount(130, 15, 3),
    ),
  });
  try {
    assert.equal(index.aggregate.total.inputTotal, 130);
    assert.equal(index.aggregate.total.outputTotal, 15);
    assert.equal(bySession(index, 'child')?.aggregate.total.inputTotal, 30);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('exact-last fork attribution skips copied replay records and retains post-fork resets', async () => {
  const parentFirst = exactTokenCount(
    { inputTotal: 1_000, cachedInput: 700, outputTotal: 100, reasoningOutput: 40 },
    { inputTotal: 100, cachedInput: 60, outputTotal: 10, reasoningOutput: 4 },
  );
  const parentSecond = exactTokenCount(
    { inputTotal: 1_030, cachedInput: 715, outputTotal: 105, reasoningOutput: 42 },
    { inputTotal: 30, cachedInput: 15, outputTotal: 5, reasoningOutput: 2 },
    2,
  );
  // Three copied token records, but only two emitted usage events. Prefix
  // removal must count records, including the suppressed replay.
  const prefix = [parentFirst, parentFirst, parentSecond];
  const { root, index } = await scanFixture({
    parent: rollout(sessionMeta('parent', 'tree'), ...prefix),
    child: rollout(
      sessionMeta('child', 'tree', 'parent'),
      sessionMeta('parent', 'tree'),
      ...prefix,
      taskStarted('child-turn', 3),
      exactTokenCount(
        { inputTotal: 40, cachedInput: 15, outputTotal: 8, reasoningOutput: 3 },
        { inputTotal: 40, cachedInput: 15, outputTotal: 8, reasoningOutput: 3 },
        4,
      ),
      exactTokenCount(
        { inputTotal: 60, cachedInput: 22, outputTotal: 13, reasoningOutput: 5 },
        { inputTotal: 20, cachedInput: 7, outputTotal: 5, reasoningOutput: 2 },
        5,
      ),
    ),
  });
  try {
    assert.deepEqual(bySession(index, 'parent')?.aggregate.total, {
      inputTotal: 130, cachedInput: 75, cacheWriteInput: 0,
      outputTotal: 15, reasoningOutput: 6, sourceTotal: 145,
    });
    const child = bySession(index, 'child');
    assert.equal(child?.lineage?.desiredPrefixEvents, 3);
    assert.equal(child?.lineage?.appliedPrefixEvents, 3);
    assert.ok(child?.qualityFlags.includes('counter-regression'));
    assert.deepEqual(child?.aggregate.total, {
      inputTotal: 60, cachedInput: 22, cacheWriteInput: 0,
      outputTotal: 13, reasoningOutput: 5, sourceTotal: 73,
    });
    assert.deepEqual(index.aggregate.total, {
      inputTotal: 190, cachedInput: 97, cacheWriteInput: 0,
      outputTotal: 28, reasoningOutput: 11, sourceTotal: 218,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('exact-last sibling suffixes stay independent across nested fork prefixes', async () => {
  const parentUsage = exactTokenCount(
    { inputTotal: 1_000, cachedInput: 700, outputTotal: 100, reasoningOutput: 40 },
    { inputTotal: 100, cachedInput: 60, outputTotal: 10, reasoningOutput: 4 },
  );
  // The two siblings deliberately share identical numeric snapshots. The
  // request input (30) also differs from the cumulative increase (130).
  const siblingUsage = exactTokenCount(
    { inputTotal: 1_130, cachedInput: 760, outputTotal: 120, reasoningOutput: 45 },
    { inputTotal: 30, cachedInput: 12, outputTotal: 4, reasoningOutput: 2 },
    3,
  );
  const child = (id: string): string => rollout(
    sessionMeta(id, 'tree', 'parent'),
    sessionMeta('parent', 'tree'),
    parentUsage,
    taskStarted(`${id}-turn`, 2),
    siblingUsage,
  );
  const { root, index } = await scanFixture({
    parent: rollout(sessionMeta('parent', 'tree'), parentUsage),
    childA: child('child-a'),
    childB: child('child-b'),
    grandchild: rollout(
      sessionMeta('grandchild', 'tree', 'child-a'),
      sessionMeta('child-a', 'tree', 'parent'),
      sessionMeta('parent', 'tree'),
      parentUsage,
      taskStarted('child-a-turn', 2),
      siblingUsage,
      taskStarted('grandchild-turn', 4),
      exactTokenCount(
        { inputTotal: 1_250, cachedInput: 800, outputTotal: 130, reasoningOutput: 50 },
        { inputTotal: 20, cachedInput: 8, outputTotal: 3, reasoningOutput: 1 },
        5,
      ),
    ),
  });
  try {
    for (const id of ['child-a', 'child-b']) {
      const sibling = bySession(index, id);
      assert.equal(sibling?.lineage?.appliedPrefixEvents, 1);
      assert.deepEqual(sibling?.aggregate.total, {
        inputTotal: 30, cachedInput: 12, cacheWriteInput: 0,
        outputTotal: 4, reasoningOutput: 2, sourceTotal: 34,
      });
    }
    const grandchild = bySession(index, 'grandchild');
    assert.equal(grandchild?.lineage?.appliedPrefixEvents, 2);
    assert.deepEqual(grandchild?.aggregate.total, {
      inputTotal: 20, cachedInput: 8, cacheWriteInput: 0,
      outputTotal: 3, reasoningOutput: 1, sourceTotal: 23,
    });
    assert.deepEqual(index.aggregate.total, {
      inputTotal: 180, cachedInput: 92, cacheWriteInput: 0,
      outputTotal: 21, reasoningOutput: 9, sourceTotal: 201,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('exact-last fork totals survive reload, replayed appends, and warm refresh', async () => {
  const parentUsage = exactTokenCount(
    { inputTotal: 1_000, cachedInput: 700, outputTotal: 100, reasoningOutput: 40 },
    { inputTotal: 100, cachedInput: 60, outputTotal: 10, reasoningOutput: 4 },
  );
  const childUsage = exactTokenCount(
    { inputTotal: 1_130, cachedInput: 760, outputTotal: 120, reasoningOutput: 45 },
    { inputTotal: 30, cachedInput: 12, outputTotal: 4, reasoningOutput: 2 },
    3,
  );
  const { root, index } = await scanFixture({
    parent: rollout(sessionMeta('parent', 'tree'), parentUsage),
    child: rollout(
      sessionMeta('child', 'tree', 'parent'),
      sessionMeta('parent', 'tree'),
      parentUsage,
      taskStarted('child-turn', 2),
      childUsage,
    ),
  });
  try {
    assert.equal(index.aggregate.total.inputTotal, 130);
    const indexPath = path.join(root, 'codex-index.json');
    await saveCodexIndexAtomic(indexPath, index);
    const reloaded = await loadCodexIndex(indexPath, 'UTC');
    assert.deepEqual(reloaded.aggregate, index.aggregate);
    assert.equal(bySession(reloaded, 'child')?.lineage?.appliedPrefixEvents, 1);

    await appendFile(path.join(root, 'sessions', 'child.jsonl'), rollout(
      childUsage,
      exactTokenCount(
        { inputTotal: 20, cachedInput: 8, outputTotal: 3, reasoningOutput: 1 },
        { inputTotal: 20, cachedInput: 8, outputTotal: 3, reasoningOutput: 1 },
        4,
      ),
    ), 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const options = { salt: SALT, timeZone: 'UTC', now: () => NOW };
    const incremental = await updateCodexIndex(reloaded, manifest, options);
    const warm = await updateCodexIndex(incremental.index, manifest, options);
    const full = await updateCodexIndex(createEmptyCodexIndex('UTC'), manifest, options);

    assert.deepEqual(bySession(incremental.index, 'child')?.aggregate.total, {
      inputTotal: 50, cachedInput: 20, cacheWriteInput: 0,
      outputTotal: 7, reasoningOutput: 3, sourceTotal: 57,
    });
    assert.deepEqual(incremental.index.aggregate.total, {
      inputTotal: 150, cachedInput: 80, cacheWriteInput: 0,
      outputTotal: 17, reasoningOutput: 7, sourceTotal: 167,
    });
    assert.equal(warm.indexChanged, false);
    assert.strictEqual(warm.index, incremental.index);
    assert.deepEqual(incremental.index.aggregate, full.index.aggregate);
    assert.deepEqual(
      fieldsByFile(incremental.index, 'aggregate'),
      fieldsByFile(full.index, 'aggregate'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parallel sibling suffixes remain independent contributions', async () => {
  const { root, index } = await scanFixture({
    parent: rollout(
      sessionMeta('parent', 'tree'),
      taskStarted('parent-turn'),
      tokenCount(100),
    ),
    childA: rollout(
      sessionMeta('child-a', 'tree', 'parent'),
      sessionMeta('parent', 'tree'),
      taskStarted('parent-turn'),
      tokenCount(100),
      taskStarted('child-a-turn', 2),
      tokenCount(130, 0, 3),
    ),
    childB: rollout(
      sessionMeta('child-b', 'tree', 'parent'),
      sessionMeta('parent', 'tree'),
      taskStarted('parent-turn'),
      tokenCount(100),
      taskStarted('child-b-turn', 2),
      tokenCount(140, 0, 3),
    ),
  });
  try {
    assert.equal(index.aggregate.total.inputTotal, 170);
    assert.equal(bySession(index, 'child-a')?.aggregate.total.inputTotal, 30);
    assert.equal(bySession(index, 'child-b')?.aggregate.total.inputTotal, 40);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('siblings with identical token vectors do not merge across lineage identities', async () => {
  const child = (id: string): string => rollout(
    sessionMeta(id, 'tree', 'parent'),
    sessionMeta('parent', 'tree'),
    taskStarted('parent-turn'),
    tokenCount(100),
    taskStarted(`${id}-turn`, 2),
    tokenCount(130, 0, 3),
  );
  const { root, index } = await scanFixture({
    parent: rollout(
      sessionMeta('parent', 'tree'),
      taskStarted('parent-turn'),
      tokenCount(100),
    ),
    childA: child('child-a'),
    childB: child('child-b'),
  });
  try {
    assert.equal(index.aggregate.total.inputTotal, 160);
    assert.notEqual(
      bySession(index, 'child-a')?.aggregate.session.sessionKey,
      bySession(index, 'child-b')?.aggregate.session.sessionKey,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a rewritten parent uses one sibling as the shared-prefix owner', async () => {
  const child = (id: string, terminal: number): string => rollout(
    sessionMeta(id, 'tree', 'parent'),
    sessionMeta('parent', 'tree'),
    taskStarted('copied-parent'),
    tokenCount(100),
    taskStarted(`${id}-turn`, 2),
    tokenCount(terminal, 0, 3),
  );
  const { root, index } = await scanFixture({
    parent: rollout(
      sessionMeta('parent', 'tree'),
      taskStarted('rewritten-parent'),
      tokenCount(999),
    ),
    childA: child('child-a', 130),
    childB: child('child-b', 140),
  });
  try {
    assert.equal(index.aggregate.total.inputTotal, 1_169);
    const childTotals = [
      bySession(index, 'child-a')?.aggregate.total.inputTotal,
      bySession(index, 'child-b')?.aggregate.total.inputTotal,
    ];
    assert.equal(
      childTotals.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      170,
    );
    assert.ok(
      childTotals.includes(130) && childTotals.includes(40) ||
      childTotals.includes(140) && childTotals.includes(30),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a child can align copied history to the middle of its parent rollout', async () => {
  const { root, index } = await scanFixture({
    parent: rollout(
      sessionMeta('parent', 'tree'),
      tokenCount(50, 0, 1),
      tokenCount(100, 0, 2),
      tokenCount(150, 0, 3),
    ),
    child: rollout(
      sessionMeta('child', 'tree', 'parent'),
      sessionMeta('parent', 'tree'),
      tokenCount(100, 0, 2),
      tokenCount(150, 0, 3),
      tokenCount(180, 0, 4),
    ),
  });
  try {
    assert.equal(index.aggregate.total.inputTotal, 180);
    assert.equal(bySession(index, 'child')?.aggregate.total.inputTotal, 30);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('nested forks count each ancestor prefix once', async () => {
  const { root, index } = await scanFixture({
    root: rollout(
      sessionMeta('root', 'tree'),
      taskStarted('root-turn'),
      tokenCount(100),
    ),
    parent: rollout(
      sessionMeta('parent', 'tree', 'root'),
      sessionMeta('root', 'tree'),
      taskStarted('root-turn'),
      tokenCount(100),
      taskStarted('parent-turn', 2),
      tokenCount(130, 0, 3),
    ),
    child: rollout(
      sessionMeta('child', 'tree', 'parent'),
      sessionMeta('parent', 'tree', 'root'),
      sessionMeta('root', 'tree'),
      taskStarted('root-turn'),
      tokenCount(100),
      taskStarted('parent-turn', 2),
      tokenCount(130, 0, 3),
      taskStarted('child-turn', 4),
      tokenCount(150, 0, 5),
    ),
  });
  try {
    assert.equal(index.aggregate.total.inputTotal, 150);
    assert.equal(bySession(index, 'parent')?.aggregate.total.inputTotal, 30);
    assert.equal(bySession(index, 'child')?.aggregate.total.inputTotal, 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('multiple fork epochs in one tree subtract their own fork-point prefix', async () => {
  const { root, index } = await scanFixture({
    root: rollout(
      sessionMeta('root', 'tree'),
      taskStarted('root-one'),
      tokenCount(50),
      taskStarted('root-two', 2),
      tokenCount(100, 0, 3),
    ),
    early: rollout(
      sessionMeta('early', 'tree', 'root'),
      sessionMeta('root', 'tree'),
      taskStarted('root-one'),
      tokenCount(50),
      taskStarted('early-turn', 2),
      tokenCount(60, 0, 3),
    ),
    late: rollout(
      sessionMeta('late', 'tree', 'root'),
      sessionMeta('root', 'tree'),
      taskStarted('root-one'),
      tokenCount(50),
      taskStarted('root-two', 2),
      tokenCount(100, 0, 3),
      taskStarted('late-turn', 4),
      tokenCount(120, 0, 5),
    ),
  });
  try {
    assert.equal(index.aggregate.total.inputTotal, 130);
    assert.equal(bySession(index, 'early')?.aggregate.total.inputTotal, 10);
    assert.equal(bySession(index, 'late')?.aggregate.total.inputTotal, 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('active and archive copies count an ordered rollout overlap once', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lineage-overlap-'));
  const sessions = path.join(root, 'sessions');
  const archive = path.join(root, 'archived_sessions');
  await mkdir(sessions, { recursive: true });
  await mkdir(archive, { recursive: true });
  try {
    await writeFile(path.join(sessions, 'active.jsonl'), rollout(
      sessionMeta('rollout', 'tree'),
      tokenCount(100, 0, 1),
      tokenCount(150, 0, 2),
    ), 'utf8');
    await writeFile(path.join(archive, 'archived.jsonl'), rollout(
      sessionMeta('rollout', 'tree'),
      tokenCount(100, 0, 1),
    ), 'utf8');

    const result = await updateCodexIndex(
      createEmptyCodexIndex('UTC'),
      await scanCodexManifest(root, SALT),
      { salt: SALT, timeZone: 'UTC', now: () => NOW },
    );

    assert.equal(result.index.aggregate.total.inputTotal, 150);
    assert.deepEqual(
      Object.values(result.index.files)
        .map((file) => file.aggregate.total.inputTotal)
        .sort((left, right) => left - right),
      [50, 100],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a missing parent keeps a conservative total and exposes a quality flag', async () => {
  const { root, index } = await scanFixture({
    orphan: rollout(
      sessionMeta('orphan', 'tree', 'missing-parent'),
      sessionMeta('missing-parent', 'tree'),
      taskStarted('copied-parent'),
      tokenCount(100),
      taskStarted('orphan-turn', 2),
      tokenCount(120, 0, 3),
    ),
  });
  try {
    const orphan = bySession(index, 'orphan');
    assert.equal(index.aggregate.total.inputTotal, 120);
    assert.equal(orphan?.aggregate.total.inputTotal, 120);
    assert.ok(orphan?.qualityFlags.includes('missing-parent'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the first reliable physical and tree identities remain locked', () => {
  const pseudo = (raw: string): string => pseudonymousIdentityKey(SALT, raw);
  let state = createCodexParserState(pseudo('physical-file'));
  state = parseCodexLine(
    sessionMeta('leaf', 'tree', 'parent'),
    state,
    pseudo,
  ).state;
  state = parseCodexLine(sessionMeta('parent', 'tree'), state, pseudo).state;

  assert.equal(state.sessionKey, pseudo('leaf'));
  assert.equal((state as unknown as { treeKey?: string }).treeKey, pseudo('tree'));
  assert.equal(state.parentSessionKey, pseudo('parent'));
});

test('single-file multi-lineage regressions use high-water containment', () => {
  const pseudo = (raw: string): string => pseudonymousIdentityKey(SALT, raw);
  let state = createCodexParserState(pseudo('physical-file'));
  let total = 0;
  for (const line of [
    sessionMeta('leaf', 'tree', 'parent'),
    tokenCount(100),
    sessionMeta('parent', 'tree'),
    tokenCount(90, 0, 2),
    tokenCount(110, 0, 3),
  ]) {
    const parsed = parseCodexLine(line, state, pseudo);
    state = parsed.state;
    total += parsed.events.reduce(
      (sum, event) => sum + event.tokens.inputTotal,
      0,
    );
  }

  assert.equal(total, 110);
  assert.equal(state.sessionKey, pseudo('leaf'));
  assert.ok(state.qualityFlags.includes('counter-regression'));
});

test('incremental, warm, persisted-shape, and full lineage scans agree exactly', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lineage-refresh-'));
  const sessions = path.join(root, 'sessions');
  const indexPath = path.join(root, 'codex-index.json');
  const parentPath = path.join(sessions, 'parent.jsonl');
  const childPath = path.join(sessions, 'child.jsonl');
  await mkdir(sessions, { recursive: true });
  try {
    await writeFile(parentPath, rollout(
      sessionMeta('parent', 'tree'),
      taskStarted('parent-turn'),
      tokenCount(100),
    ), 'utf8');
    await writeFile(childPath, rollout(
      sessionMeta('child', 'tree', 'parent'),
      sessionMeta('parent', 'tree'),
      taskStarted('parent-turn'),
      tokenCount(100),
      taskStarted('child-turn', 2),
      tokenCount(120, 0, 3),
    ), 'utf8');

    const initialManifest = await scanCodexManifest(root, SALT);
    const initial = await updateCodexIndex(
      createEmptyCodexIndex('UTC'),
      initialManifest,
      { salt: SALT, timeZone: 'UTC', now: () => NOW },
    );
    await saveCodexIndexAtomic(indexPath, initial.index);
    const reloaded = await loadCodexIndex(indexPath, 'UTC');
    assert.deepEqual(
      fieldsByFile(reloaded, 'lineage'),
      fieldsByFile(initial.index, 'lineage'),
    );
    await appendFile(childPath, `${tokenCount(130, 0, 4)}\n`, 'utf8');
    const finalManifest = await scanCodexManifest(root, SALT);
    const incremental = await updateCodexIndex(reloaded, finalManifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => NOW,
    });
    const warm = await updateCodexIndex(incremental.index, finalManifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => NOW,
    });
    const full = await updateCodexIndex(
      createEmptyCodexIndex('UTC'),
      finalManifest,
      { salt: SALT, timeZone: 'UTC', now: () => NOW },
    );

    assert.equal(incremental.index.aggregate.total.inputTotal, 130);
    assert.equal(warm.indexChanged, false);
    assert.strictEqual(warm.index, incremental.index);
    assert.deepEqual(incremental.index.aggregate, full.index.aggregate);
    assert.deepEqual(
      fieldsByFile(incremental.index, 'aggregate'),
      fieldsByFile(full.index, 'aggregate'),
    );
    // Exercise the opposite map order explicitly on every platform, instead
    // of relying on filesystem timestamp precision to expose the difference.
    assert.deepEqual(
      fieldsByFile(incremental.index, 'aggregate'),
      fieldsByFile({
        ...full.index,
        files: Object.fromEntries(Object.entries(full.index.files).reverse()),
      }, 'aggregate'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('schema v2 reload rebuilds lineage without retaining or doubling old totals', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-codex-lineage-v2-'));
  const sessions = path.join(root, 'sessions');
  const indexPath = path.join(root, 'codex-index.json');
  await mkdir(sessions, { recursive: true });
  try {
    await writeFile(path.join(sessions, 'parent.jsonl'), rollout(
      sessionMeta('parent', 'tree'),
      tokenCount(100),
    ), 'utf8');
    await writeFile(path.join(sessions, 'child.jsonl'), rollout(
      sessionMeta('child', 'tree', 'parent'),
      sessionMeta('parent', 'tree'),
      tokenCount(100),
      tokenCount(130, 0, 2),
    ), 'utf8');
    const manifest = await scanCodexManifest(root, SALT);
    const current = await updateCodexIndex(
      createEmptyCodexIndex('UTC'),
      manifest,
      { salt: SALT, timeZone: 'UTC', now: () => NOW },
    );
    const legacy = JSON.parse(JSON.stringify(current.index)) as {
      schemaVersion: number;
      files: Record<string, { lineage?: unknown }>;
    };
    legacy.schemaVersion = 2;
    for (const contribution of Object.values(legacy.files)) {
      delete contribution.lineage;
    }
    await writeFile(indexPath, JSON.stringify(legacy), 'utf8');

    const loaded = await loadCodexIndex(indexPath, 'UTC');
    assert.equal(loaded.schemaVersion, 3);
    assert.ok(Object.values(loaded.files).every((file) =>
      file.qualityFlags.includes('stale-reset-required'),
    ));
    assert.equal(loaded.aggregate.total.inputTotal, 0);
    assert.equal(loaded.coverage.indexedFiles, 0);
    assert.equal(loaded.coverage.indexedBytes, 0);
    assert.equal(loaded.coverage.period.allTime.migratedFiles, 0);
    assert.equal(loaded.coverage.period.allTime.migratedBytes, 0);
    const pending = await updateCodexIndex(loaded, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => NOW,
      budget: { maxFilePasses: 0, maxBytes: 32 * 1024 * 1024 },
    });
    assert.equal(pending.index.aggregate.total.inputTotal, 0);
    assert.equal(pending.index.coverage.indexedFiles, 0);
    assert.equal(pending.index.coverage.indexedBytes, 0);
    const rebuilt = await updateCodexIndex(pending.index, manifest, {
      salt: SALT,
      timeZone: 'UTC',
      now: () => NOW,
    });

    assert.equal(rebuilt.index.aggregate.total.inputTotal, 130);
    assert.ok(Object.values(rebuilt.index.files).every((file) =>
      !file.qualityFlags.includes('stale-reset-required') &&
      file.lineage?.appliedPrefixEvents === file.lineage?.desiredPrefixEvents,
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
