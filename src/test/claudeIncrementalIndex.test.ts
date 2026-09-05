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
  claudeUsageDashboardSnapshot,
  createClaudeUsageIndex,
  updateClaudeUsageIndex,
} from '../claudeIncrementalIndex';
import { ClaudeDataLoader } from '../dataLoader';
import { ClaudeUsageRecord } from '../types';

const roots: string[] = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function usageLine(
  id: string,
  input: number,
  output: number,
  options: {
    timestamp?: string;
    requestId?: string | null;
    messageId?: string;
    cwd?: string;
    branch?: string;
  } = {},
): string {
  const value: Record<string, unknown> = {
    type: 'assistant',
    timestamp: options.timestamp ?? '2026-08-21T08:01:00.000Z',
    cwd: options.cwd ?? '/fixture/project-a',
    gitBranch: options.branch ?? 'main',
    message: {
      id: options.messageId ?? `message-${id}`,
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: `answer-${id}` }],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
      },
    },
  };
  if (options.requestId !== null) {
    value.requestId = options.requestId ?? `request-${id}`;
  }
  return JSON.stringify(value);
}

function promptLine(text: string, timestamp = '2026-08-21T08:00:00.000Z'): string {
  return JSON.stringify({
    type: 'user',
    uuid: `prompt-${text}`,
    timestamp,
    cwd: '/fixture/project-a',
    gitBranch: 'main',
    message: { role: 'user', content: text },
  });
}

async function fixture(): Promise<{ root: string; first: string; second: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-production-index-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-project');
  await mkdir(project, { recursive: true });
  const first = path.join(project, 'session-first.jsonl');
  const second = path.join(project, 'session-second.jsonl');
  await writeFile(first, [
    JSON.stringify({ type: 'custom-title', customTitle: 'First title' }),
    promptLine('first prompt'),
    usageLine('first', 10, 4),
    '',
  ].join('\n'), 'utf8');
  await writeFile(second, `${usageLine('second', 20, 8, {
    cwd: '/fixture/project-b',
    branch: 'feature',
  })}\n`, 'utf8');
  return { root, first, second };
}

function normalized(records: readonly ClaudeUsageRecord[]): unknown[] {
  return records
    .map((record) => JSON.parse(JSON.stringify(record)) as ClaudeUsageRecord)
    .sort((left, right) => {
      const leftKey = `${left.timestamp}\0${left._sessionId ?? ''}\0${left._isUserPrompt ? 1 : 0}\0${left.message.id ?? ''}\0${left.requestId ?? ''}`;
      const rightKey = `${right.timestamp}\0${right._sessionId ?? ''}\0${right._isUserPrompt ? 1 : 0}\0${right.message.id ?? ''}\0${right.requestId ?? ''}`;
      return leftKey.localeCompare(rightKey);
    });
}

function stableValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === 'number' ? Math.round(item * 1e12) / 1e12 : item,
  ));
}

async function assertMatchesFull(root: string, records: ClaudeUsageRecord[]): Promise<void> {
  const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: false });
  assert.equal(full.diagnostics.filesFailed, 0);
  assert.deepEqual(normalized(records), normalized(full.records));
  const actual = ClaudeDataLoader.calculateUsageData(records);
  const expected = ClaudeDataLoader.calculateUsageData(full.records);
  assert.equal(actual.totalInputTokens, expected.totalInputTokens);
  assert.equal(actual.totalOutputTokens, expected.totalOutputTokens);
  assert.equal(actual.totalCacheCreationTokens, expected.totalCacheCreationTokens);
  assert.equal(actual.totalCacheReadTokens, expected.totalCacheReadTokens);
  assert.equal(actual.messageCount, expected.messageCount);
  assert.ok(Math.abs(actual.totalCost - expected.totalCost) < 1e-12);
  assert.deepEqual(Object.keys(actual.modelBreakdown), Object.keys(expected.modelBreakdown));
}

test('cold production index preserves the established full-loader record semantics', async () => {
  const { root } = await fixture();
  const result = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });

  assert.equal(result.diagnostics.filesFailed, 0);
  assert.equal(result.diagnostics.bodyReads, 2);
  await assertMatchesFull(root, result.records);
});

test('content analysis is materialized from per-file contributions without a second body scan', async () => {
  const { root, first } = await fixture();
  await appendFile(first, [
    JSON.stringify({
      type: 'assistant',
      uuid: 'tool-use-line',
      timestamp: '2026-08-21T08:02:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a' } }],
      },
    }),
    JSON.stringify({
      type: 'user',
      uuid: 'tool-result-line',
      timestamp: '2026-08-21T08:03:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'fixture result' }],
      },
    }),
    '',
  ].join('\n'), 'utf8');

  const incremental = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: true,
    windowDays: 30,
  });
  const full = await ClaudeDataLoader.loadUsageRecords(root, {
    analyzeContent: true,
    windowDays: 30,
  });

  assert.equal(incremental.diagnostics.bodyReads, 2);
  assert.deepEqual(incremental.contentAnalysis, full.contentAnalysis);

  const tail = `${promptLine('content tail', '2026-08-21T10:00:00.000Z')}\n`;
  await appendFile(first, tail, 'utf8');
  const warm = await updateClaudeUsageIndex(incremental.index, root, {
    analyzeContent: true,
    windowDays: 30,
  });
  const warmFull = await ClaudeDataLoader.loadUsageRecords(root, {
    analyzeContent: true,
    windowDays: 30,
  });
  assert.equal(warm.diagnostics.bodyReads, 1);
  assert.deepEqual(warm.contentAnalysis, warmFull.contentAnalysis);
});

test('cross-file content UUID clones keep the legacy first-owner deduplication', async () => {
  const { root, first, second } = await fixture();
  const cloned = JSON.stringify({
    type: 'assistant',
    uuid: 'cross-file-content-clone',
    timestamp: '2026-08-21T08:04:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'count this once' }] },
  });
  await appendFile(first, `${cloned}\n`, 'utf8');
  await appendFile(second, `${cloned}\n`, 'utf8');

  const incremental = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: true,
  });
  const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

  assert.deepEqual(incremental.contentAnalysis, full.contentAnalysis);

  await unlink(first);
  const fallback = await updateClaudeUsageIndex(incremental.index, root, {
    analyzeContent: true,
  });
  const fallbackFull = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });
  assert.equal(fallback.diagnostics.bodyReads, 1);
  assert.deepEqual(fallback.contentAnalysis, fallbackFull.contentAnalysis);
});

test('materialized dashboard rows match every legacy full-record aggregation', async () => {
  const { root } = await fixture();
  const loaded = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  const snapshot = claudeUsageDashboardSnapshot(loaded.index, {
    workspacePath: '/fixture/project-a',
    projectGroupingMode: 'git',
  });
  const records = loaded.records;

  assert.deepEqual(stableValue(snapshot.today), stableValue(ClaudeDataLoader.getTodayData(records)));
  assert.deepEqual(stableValue(snapshot.month), stableValue(ClaudeDataLoader.getThisMonthData(records)));
  assert.deepEqual(stableValue(snapshot.allTime), stableValue(ClaudeDataLoader.getAllTimeData(records)));
  assert.deepEqual(stableValue(snapshot.dailyForMonth), stableValue(ClaudeDataLoader.getDailyDataForMonth(records)));
  assert.deepEqual(stableValue(snapshot.monthlyForAllTime), stableValue(ClaudeDataLoader.getDailyDataForAllTime(records)));
  assert.deepEqual(stableValue(snapshot.hourlyForToday), stableValue(ClaudeDataLoader.getHourlyDataForToday(records)));
  assert.deepEqual(stableValue(snapshot.sessions), stableValue(ClaudeDataLoader.getSessionBreakdown(records)));
  assert.deepEqual(
    stableValue(snapshot.projects),
    stableValue(ClaudeDataLoader.getProjectBreakdown(records, undefined, 'git')),
  );
  assert.deepEqual(stableValue(snapshot.branches), stableValue(ClaudeDataLoader.getBranchBreakdown(records)));
  assert.deepEqual(stableValue(snapshot.workflows), stableValue(ClaudeDataLoader.getWorkflowBreakdown(records)));
  assert.deepEqual(stableValue(snapshot.costliestMessages), stableValue(ClaudeDataLoader.getCostliestMessages(records)));
  assert.deepEqual(
    stableValue(snapshot.workspaceToday),
    stableValue(ClaudeDataLoader.getTodayData(ClaudeDataLoader.filterByWorkspace(records, '/fixture/project-a'))),
  );
  assert.deepEqual(
    stableValue(snapshot.session),
    stableValue(ClaudeDataLoader.getCurrentSessionData(records, '/fixture/project-a')),
  );
  assert.deepEqual(
    stableValue(snapshot.context),
    stableValue(ClaudeDataLoader.getCurrentContextInfo(records, '/fixture/project-a')),
  );
});

test('append reads only the verified tail and preserves exact totals', async () => {
  const { root, first } = await fixture();
  const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  const tail = `${promptLine('appended prompt', '2026-08-21T09:00:00.000Z')}\n${usageLine('append', 7, 5, {
    timestamp: '2026-08-21T09:01:00.000Z',
  })}\n`;
  await appendFile(first, tail, 'utf8');

  const warm = await updateClaudeUsageIndex(cold.index, root, { analyzeContent: false });

  assert.equal(warm.diagnostics.bodyReads, 1);
  assert.equal(warm.diagnostics.bytesRead, Buffer.byteLength(tail));
  assert.equal(warm.diagnostics.linesParsed, 2);
  assert.ok(warm.diagnostics.aggregateMutations <= 8);
  assert.deepEqual(warm.diagnostics.changed, {
    append: 1,
    rebuild: 0,
    move: 0,
    delete: 0,
  });
  await assertMatchesFull(root, warm.records);
});

test('a successful append publishes a new snapshot without mutating the prior one', async () => {
  const { root, first } = await fixture();
  const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  const priorRecords = normalized(cold.records);
  const priorVisibleRecords = normalized([...cold.index.visibleRecords.values()]);
  await appendFile(first, `${JSON.stringify({
    type: 'custom-title',
    customTitle: 'Updated title',
  })}\n`, 'utf8');

  const warm = await updateClaudeUsageIndex(cold.index, root, { analyzeContent: false });

  assert.deepEqual(normalized(cold.records), priorRecords);
  assert.deepEqual(normalized([...cold.index.visibleRecords.values()]), priorVisibleRecords);
  assert.ok(warm.records.some((record) => record._sessionTitle === 'Updated title'));
});

test('incomplete tails stay invisible until their newline is durable', async () => {
  const { root, first } = await fixture();
  const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  const partial = usageLine('partial', 9, 6);
  await appendFile(first, partial, 'utf8');

  const pending = await updateClaudeUsageIndex(cold.index, root, { analyzeContent: false });
  assert.equal(pending.diagnostics.linesParsed, 0);
  assert.deepEqual(normalized(pending.records), normalized(cold.records));

  await appendFile(first, '\n', 'utf8');
  const completed = await updateClaudeUsageIndex(pending.index, root, {
    analyzeContent: false,
  });
  assert.equal(completed.diagnostics.linesParsed, 1);
  await assertMatchesFull(root, completed.records);
});

test('request-id cardinality changes re-resolve only the affected message identity', async () => {
  const { root, first } = await fixture();
  await appendFile(first, [
    usageLine('missing', 30, 3, { messageId: 'shared-message', requestId: null }),
    usageLine('known', 20, 2, { messageId: 'shared-message', requestId: 'request-one' }),
    '',
  ].join('\n'), 'utf8');
  let current = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  await assertMatchesFull(root, current.records);

  const secondRequest = `${usageLine('second-request', 11, 1, {
    messageId: 'shared-message',
    requestId: 'request-two',
  })}\n`;
  await appendFile(first, secondRequest, 'utf8');
  current = await updateClaudeUsageIndex(current.index, root, { analyzeContent: false });

  assert.equal(current.diagnostics.bodyReads, 1);
  assert.ok(current.diagnostics.aggregateMutations <= 6);
  await assertMatchesFull(root, current.records);
});

test('truncate, atomic replacement, move, and delete update only affected files', async () => {
  const { root, first, second } = await fixture();
  let current = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });

  await writeFile(first, `${usageLine('truncated', 3, 1)}\n`, 'utf8');
  current = await updateClaudeUsageIndex(current.index, root, { analyzeContent: false });
  assert.equal(current.diagnostics.bodyReads, 1);
  assert.deepEqual(current.diagnostics.changed, { append: 0, rebuild: 1, move: 0, delete: 0 });
  await assertMatchesFull(root, current.records);

  const replacement = `${first}.replacement`;
  await writeFile(replacement, `${usageLine('replacement', 13, 2)}\n`, 'utf8');
  await rename(replacement, first);
  current = await updateClaudeUsageIndex(current.index, root, { analyzeContent: false });
  assert.equal(current.diagnostics.bodyReads, 1);
  assert.deepEqual(current.diagnostics.changed, { append: 0, rebuild: 1, move: 0, delete: 0 });
  await assertMatchesFull(root, current.records);

  const movedDir = path.join(root, 'projects', '-fixture-moved');
  await mkdir(movedDir, { recursive: true });
  const moved = path.join(movedDir, path.basename(first));
  await rename(first, moved);
  current = await updateClaudeUsageIndex(current.index, root, { analyzeContent: false });
  assert.equal(current.diagnostics.bodyReads, 0);
  assert.deepEqual(current.diagnostics.changed, { append: 0, rebuild: 0, move: 1, delete: 0 });
  await assertMatchesFull(root, current.records);

  await unlink(second);
  current = await updateClaudeUsageIndex(current.index, root, { analyzeContent: false });
  assert.equal(current.diagnostics.bodyReads, 0);
  assert.deepEqual(current.diagnostics.changed, { append: 0, rebuild: 0, move: 0, delete: 1 });
  await assertMatchesFull(root, current.records);
});

test('a failed body read keeps the previous index and visible snapshot atomic', async () => {
  const { root, first } = await fixture();
  const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  await appendFile(first, `${usageLine('unreadable', 50, 5)}\n`, 'utf8');

  const failed = await updateClaudeUsageIndex(cold.index, root, {
    analyzeContent: false,
    beforeBodyReads: async () => unlink(first),
  });

  assert.equal(failed.index, cold.index);
  assert.deepEqual(normalized(failed.records), normalized(cold.records));
  assert.equal(failed.diagnostics.filesFailed, 1);
});

test('one append in a 100-file corpus bounds I/O, parsing, and aggregate work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-production-scale-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-scale');
  await mkdir(project, { recursive: true });
  const files: string[] = [];
  for (let index = 0; index < 100; index += 1) {
    const file = path.join(project, `session-${index}.jsonl`);
    files.push(file);
    await writeFile(file, `${usageLine(`cold-${index}`, index + 1, 1)}\n`, 'utf8');
  }
  const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  const tail = `${usageLine('only-change', 5, 2)}\n`;
  await appendFile(files[42], tail, 'utf8');

  const warm = await updateClaudeUsageIndex(cold.index, root, { analyzeContent: false });

  assert.equal(warm.diagnostics.bodyReads, 1);
  assert.equal(warm.diagnostics.bytesRead, Buffer.byteLength(tail));
  assert.equal(warm.diagnostics.linesParsed, 1);
  assert.ok(warm.diagnostics.aggregateMutations <= 4);
  await assertMatchesFull(root, warm.records);
});
