import { test, TestContext } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ClaudeDataLoader, tagClaudeSessionEvidence } from '../dataLoader';
import { claudeUsageDashboardSnapshot, createClaudeUsageIndex, updateClaudeUsageIndex } from '../claudeIncrementalIndex';

// Entirely synthetic homes: never discover the user's provider directories.
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-flat-sidechain-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'projects', '-fixture');
  await mkdir(project, { recursive: true });
  return { root, project };
}

function line(id: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: 'assistant', timestamp: '2026-10-01T12:00:00Z',
    requestId: `request-${id}`, message: { id, model: 'claude-fable-5', usage: {
      input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40,
    } }, ...extra }) + '\n';
}

async function load(root: string, previous = createClaudeUsageIndex()) {
  return updateClaudeUsageIndex(previous, root, { analyzeContent: false });
}

test('flat sidechains cannot multiply output/Fable session evidence, while exact usage survives', async (t) => {
  const { root, project } = await fixture(t);
  await writeFile(path.join(project, 'parent.jsonl'), line('main'));
  for (let i = 0; i < 3; i++) {
    await writeFile(path.join(project, `agent-${i}.jsonl`),
      line(`child-${i}`, { isSidechain: true, sessionId: 'parent' }));
  }
  const cold = await load(root);
  assert.equal(cold.diagnostics.bodyReads, 4, 'eligibility adds no source reads');
  const snapshot = claudeUsageDashboardSnapshot(cold.index);
  assert.deepEqual(snapshot.achievementSessionEvidence, {
    outputSessions: 1, fableOutputSessions: 1, fableMixedFamilySession: false,
  });
  assert.equal(snapshot.sessions.length, 4, 'existing Sessions presentation remains intact');
  const expected = ClaudeDataLoader.calculateUsageData(Array.from({ length: 4 }, (_, i) => JSON.parse(line(`expected-${i}`))));
  assert.deepEqual(snapshot.allTime, expected, 'all token buckets, model pricing and totals are unchanged');
  const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: false });
  assert.deepEqual(cold.records, full.records, 'legacy and incremental parsers agree');
  assert.deepEqual(snapshot.dailyForAllTime, ClaudeDataLoader.getDailyDataForAllTime(full.records));
  assert.deepEqual(snapshot.dailyForAllTime.map((day) => day.data), [expected]);
  const warm = await load(root, cold.index);
  assert.equal(warm.diagnostics.bodyReads, 0);
  assert.deepEqual(claudeUsageDashboardSnapshot(warm.index).achievementSessionEvidence, snapshot.achievementSessionEvidence);
});

test('unknown flat owners never become achievement sessions through malformed or absent metadata', async (t) => {
  const { root, project } = await fixture(t);
  const metadata = [{}, { isSidechain: true }, { isSidechain: true, sessionId: '../parent' },
    { isSidechain: true, sessionId: 42 }, { isSidechain: false, sessionId: 'parent' },
    { isSidechain: true, sessionId: 'agent-self' }];
  for (const [i, extra] of metadata.entries()) {
    await writeFile(path.join(project, `agent-${i}.jsonl`), line(`unknown-${i}`, extra));
  }
  await appendFile(path.join(project, 'agent-0.jsonl'), line('sonnet', {
    message: { id: 'sonnet', model: 'claude-sonnet-4-5', usage: { input_tokens: 1, output_tokens: 1 } },
  }));
  const cold = await load(root);
  const snapshot = claudeUsageDashboardSnapshot(cold.index);
  assert.equal(snapshot.achievementSessionEvidence.outputSessions, 0);
  assert.equal(snapshot.achievementSessionEvidence.fableOutputSessions, 0);
  assert.equal(snapshot.achievementSessionEvidence.fableMixedFamilySession, false);
  assert.equal(snapshot.allTime.totalOutputTokens, metadata.length * 20 + 1);
});

test('ordinary legacy names and nested subagents keep established session evidence', async (t) => {
  const { root, project } = await fixture(t);
  for (const name of ['legacy-session', 'agent', 'session-with-agent-name']) {
    await writeFile(path.join(project, `${name}.jsonl`), line(name, {
      sessionId: 'ignored-metadata', _unownedAgentSession: true,
    }));
  }
  const nested = path.join(project, 'parent', 'subagents');
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, 'agent-child.jsonl'), line('nested', { isSidechain: true, sessionId: 'ignored' }));
  const result = await load(root);
  assert.equal(claudeUsageDashboardSnapshot(result.index).achievementSessionEvidence.outputSessions, 4);
  assert.ok(result.records.some((r) => r._sessionId === 'parent'));
});

test('flat append and flat/nested moves update evidence without changing exact usage', async (t) => {
  const { root, project } = await fixture(t);
  const flat = path.join(project, 'agent-child.jsonl');
  await writeFile(flat, line('first', { isSidechain: true, sessionId: 'parent' }));
  const cold = await load(root);
  const tail = line('second', { isSidechain: true, sessionId: 'parent' });
  await appendFile(flat, tail);
  const appended = await load(root, cold.index);
  assert.equal(appended.diagnostics.bytesRead, Buffer.byteLength(tail));
  assert.equal(claudeUsageDashboardSnapshot(appended.index).achievementSessionEvidence.outputSessions, 0);
  const nestedDir = path.join(project, 'parent', 'subagents');
  await mkdir(nestedDir, { recursive: true });
  const nested = path.join(nestedDir, 'agent-child.jsonl');
  await rename(flat, nested);
  const moved = await load(root, appended.index);
  assert.equal(claudeUsageDashboardSnapshot(moved.index).achievementSessionEvidence.outputSessions, 1);
  assert.deepEqual(moved.index.aggregates.allTime, appended.index.aggregates.allTime);
  await rename(nested, flat);
  const restored = await load(root, moved.index);
  assert.equal(claudeUsageDashboardSnapshot(restored.index).achievementSessionEvidence.outputSessions, 0);
  assert.deepEqual(restored.index.aggregates.allTime, appended.index.aggregates.allTime);
});

test('path provenance is cross-platform and does not reject nested parents named agent-*', () => {
  for (const separator of ['/', '\\']) {
    const record = JSON.parse(line('path'));
    const file = (parts: string[]) => parts.join(separator);
    tagClaudeSessionEvidence(record, file(['', 'fixture', 'projects', 'project', 'agent-child.jsonl']));
    assert.equal(record._unownedAgentSession, true);
    tagClaudeSessionEvidence(record, file(['', 'fixture', 'projects', 'project', 'agent-parent', 'subagents', 'agent-child.jsonl']));
    assert.equal(record._unownedAgentSession, undefined);
    tagClaudeSessionEvidence(record, file(['projects', 'project', 'agent-child.jsonl']));
    assert.equal(record._unownedAgentSession, true);
  }
});
