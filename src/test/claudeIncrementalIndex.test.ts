import { after, test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  appendFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
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
import { UsageManifest } from '../claudeUsageFiles';
import { ClaudeDataLoader } from '../dataLoader';
import { I18n } from '../i18n';
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

function analysisTextLine(
  uuid: string,
  text: string,
  timestamp?: string,
  role: 'assistant' | 'user' = 'assistant',
): string {
  return JSON.stringify({
    type: role,
    uuid,
    ...(timestamp ? { timestamp } : {}),
    message: {
      role,
      content: role === 'assistant' ? [{ type: 'text', text }] : text,
    },
  });
}

function analysisBlocksLine(
  uuid: string,
  role: 'assistant' | 'user',
  content: Record<string, unknown>[],
  timestamp: string,
): string {
  return JSON.stringify({
    type: role,
    uuid,
    timestamp,
    message: { role, content },
  });
}

function skillInvocationLines(
  prefix: string,
  count: number,
  timestamp: string,
): string[] {
  const uses = Array.from({ length: count }, (_value, index) => ({
    type: 'tool_use',
    id: `${prefix}-tool-${index}`,
    name: 'Skill',
    input: { skill: `${prefix}-skill-${index}` },
  }));
  const results = uses.map((use) => ({
    type: 'tool_result',
    tool_use_id: use.id,
    content: `skill preamble payload ${use.id}`,
  }));
  return [
    JSON.stringify({
      type: 'assistant',
      uuid: `${prefix}-uses`,
      timestamp,
      message: { role: 'assistant', content: uses },
    }),
    JSON.stringify({
      type: 'user',
      uuid: `${prefix}-results`,
      timestamp,
      message: { role: 'user', content: results },
    }),
  ];
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

async function manifestInOrder(files: readonly string[]): Promise<UsageManifest> {
  const entries = new Map();
  for (const [discoveryIndex, file] of files.entries()) {
    const fileStat = await stat(file);
    entries.set(file, {
      path: file,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      discoveryIndex,
      dev: fileStat.dev > 0 && fileStat.ino > 0 ? fileStat.dev : undefined,
      ino: fileStat.dev > 0 && fileStat.ino > 0 ? fileStat.ino : undefined,
    });
  }
  return { entries, scannedAtMs: Date.now(), scanDurationMs: 0 };
}

function deepFreeze(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return;
  seen.add(value as object);
  if (value instanceof Map) {
    for (const [key, item] of value) {
      deepFreeze(key, seen);
      deepFreeze(item, seen);
    }
  } else if (value instanceof Set) {
    for (const item of value) deepFreeze(item, seen);
  } else {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
    }
  }
  Object.freeze(value);
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
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  try {
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
  } finally {
    Date.now = previousNow;
  }
});

test('cross-file tool results retain global tool and Skill preamble attribution', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-cross-file-tools-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-cross-file-tools');
  await mkdir(project, { recursive: true });
  const usesFile = path.join(project, 'uses.jsonl');
  const resultsFile = path.join(project, 'results.jsonl');
  try {
    await writeFile(usesFile, `${analysisBlocksLine(
      'cross-file-tool-uses',
      'assistant',
      [
        { type: 'tool_use', id: 'cross-file-read', name: 'Read', input: { file_path: '/tmp/a' } },
        { type: 'tool_use', id: 'cross-file-skill', name: 'Skill', input: { skill: 'audit-skill' } },
      ],
      '2026-09-10T09:00:00.000Z',
    )}\n`, 'utf8');
    await writeFile(resultsFile, `${analysisBlocksLine(
      'cross-file-tool-results',
      'user',
      [
        { type: 'tool_result', tool_use_id: 'cross-file-read', content: 'read payload across files' },
        { type: 'tool_result', tool_use_id: 'cross-file-skill', content: 'skill preamble across files' },
        { type: 'tool_result', tool_use_id: 'late-cross-file-read', content: 'result before its file-order use exists' },
        { type: 'tool_result', tool_use_id: 'late-cross-file-skill', content: 'preamble before its file-order Skill exists' },
      ],
      '2026-09-10T10:00:00.000Z',
    )}\n`, 'utf8');

    const incremental = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.deepEqual(incremental.contentAnalysis, full.contentAnalysis);
    assert.equal(
      incremental.contentAnalysis?.toolResultBreakdown.find((slice) => slice.key === 'Read')?.count,
      1,
    );
    assert.ok((incremental.contentAnalysis?.skillUses[0]?.estTokens ?? 0) > 0);
    assert.equal(
      incremental.contentAnalysis?.frameworkOverhead?.components
        .find((component) => component.kind === 'skill-preamble')?.count,
      1,
    );

    await appendFile(usesFile, `${analysisBlocksLine(
      'late-cross-file-uses',
      'assistant',
      [
        { type: 'tool_use', id: 'late-cross-file-read', name: 'Grep', input: { pattern: 'x' } },
        { type: 'tool_use', id: 'late-cross-file-skill', name: 'Skill', input: { skill: 'late-audit-skill' } },
      ],
      '2026-09-10T09:01:00.000Z',
    )}\n`, 'utf8');
    const warm = await updateClaudeUsageIndex(incremental.index, root);
    const warmFull = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });
    assert.equal(warm.diagnostics.bodyReads, 1);
    assert.deepEqual(warm.contentAnalysis, warmFull.contentAnalysis);
    assert.equal(
      warm.contentAnalysis?.toolResultBreakdown.find((slice) => slice.key === 'Grep')?.count,
      1,
    );
    assert.ok((warm.contentAnalysis?.skillUses[1]?.estTokens ?? 0) > 0);
  } finally {
    Date.now = previousNow;
  }
});

test('append calibration updates one canonical response instead of summing its snapshots', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-calibration-dedup-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-calibration-dedup');
  await mkdir(project, { recursive: true });
  const file = path.join(project, 'session.jsonl');
  try {
    await writeFile(file, `${usageLine('calibration-first', 10, 4, {
      timestamp: '2026-09-10T09:00:00.000Z',
      messageId: 'calibration-message',
      requestId: 'calibration-request',
    })}\n`, 'utf8');
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);

    await appendFile(file, `${usageLine('calibration-final', 20, 8, {
      timestamp: '2026-09-10T09:01:00.000Z',
      messageId: 'calibration-message',
      requestId: 'calibration-request',
    })}\n`, 'utf8');
    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.equal(warm.diagnostics.bodyReads, 1);
    assert.deepEqual(warm.contentAnalysis?.calibration, {
      realOutputTokens: 8,
      realInputSideTokens: 22,
    });
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('calibration follows missing request IDs, a cross-file winner, and cutoff expiry', async () => {
  const previousNow = Date.now;
  let now = Date.parse('2026-09-10T12:00:00.000Z');
  Date.now = () => now;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-calibration-global-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-calibration-global');
  await mkdir(project, { recursive: true });
  const earlier = path.join(project, 'earlier.jsonl');
  const later = path.join(project, 'later.jsonl');
  try {
    await writeFile(earlier, `${usageLine('missing-request', 10, 2, {
      timestamp: '2026-09-09T12:00:30.000Z',
      messageId: 'calibration-global-message',
      requestId: null,
    })}\n`, 'utf8');
    await writeFile(later, `${usageLine('known-request', 20, 4, {
      timestamp: '2026-09-09T12:00:40.000Z',
      messageId: 'calibration-global-message',
      requestId: 'calibration-global-request',
    })}\n`, 'utf8');
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { windowDays: 1 });
    assert.deepEqual(cold.contentAnalysis?.calibration, {
      realOutputTokens: 4,
      realInputSideTokens: 22,
    });

    await appendFile(earlier, `${usageLine('cross-file-winner', 30, 6, {
      timestamp: '2026-09-09T12:00:50.000Z',
      messageId: 'calibration-global-message',
      requestId: 'calibration-global-request',
    })}\n`, 'utf8');
    const warm = await updateClaudeUsageIndex(cold.index, root, { windowDays: 1 });
    const warmFull = await ClaudeDataLoader.loadUsageRecords(root, {
      analyzeContent: true,
      windowDays: 1,
    });
    assert.equal(warm.diagnostics.bodyReads, 1);
    assert.deepEqual(warm.contentAnalysis?.calibration, {
      realOutputTokens: 6,
      realInputSideTokens: 32,
    });
    assert.deepEqual(warm.contentAnalysis, warmFull.contentAnalysis);

    now = Date.parse('2026-09-10T12:01:00.000Z');
    const expired = await updateClaudeUsageIndex(warm.index, root, { windowDays: 1 });
    const expiredFull = await ClaudeDataLoader.loadUsageRecords(root, {
      analyzeContent: true,
      windowDays: 1,
    });
    assert.equal(expired.contentAnalysis?.calibration, undefined);
    assert.deepEqual(expired.contentAnalysis, expiredFull.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('a newly started session file does not rebuild the established corpus', async (t) => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-new-file-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-new-file');
  await mkdir(project, { recursive: true });
  const files: string[] = [];
  try {
    for (let index = 0; index < 64; index += 1) {
      const file = path.join(project, `session-${String(index).padStart(3, '0')}.jsonl`);
      files.push(file);
      await writeFile(file, `${analysisTextLine(
        `new-file-seed-${index}`,
        `seed ${index}`,
        new Date(Date.parse('2026-09-09T00:00:00.000Z') + index * 1_000).toISOString(),
      )}
`, 'utf8');
    }
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);
    assert.equal(cold.diagnostics.bodyReads, 64);

    // Every new session starts its own transcript while other sessions append.
    await appendFile(files[7], `${analysisTextLine(
      'new-file-tail-a', 'tail a', '2026-09-09T00:10:00.000Z',
    )}
`, 'utf8');
    await appendFile(files[40], `${analysisTextLine(
      'new-file-tail-b', 'tail b', '2026-09-09T00:11:00.000Z',
    )}
`, 'utf8');
    await writeFile(path.join(project, 'session-new.jsonl'), `${analysisTextLine(
      'new-file-fresh', 'fresh session', '2026-09-09T00:12:00.000Z',
    )}
`, 'utf8');

    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    // File identity is (dev, inode), and NTFS reuses file record numbers: a file
    // created here can land on the identity of one the fixture already indexed,
    // which reads as a move and legitimately forces the full rebuild. That is a
    // property of the filesystem, not of this path, so skip rather than assert
    // a number the run cannot deliver. The correctness check below still holds.
    if (warm.diagnostics.changed.move > 0) {
      t.skip('the filesystem reused a file identity, so this refresh is a move, not an addition');
      return;
    }

    assert.equal(warm.diagnostics.bodyReads, 3);
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('the window drifting past an old event keeps the refresh incremental', async (t) => {
  const previousNow = Date.now;
  let now = Date.parse('2026-09-10T12:00:00.000Z');
  Date.now = () => now;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-window-drift-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-window-drift');
  await mkdir(project, { recursive: true });
  const files: string[] = [];
  try {
    // One file holds an event that is about to fall out of the window, the rest
    // are an established corpus that nothing touches.
    for (let index = 0; index < 32; index += 1) {
      const file = path.join(project, `session-${String(index).padStart(3, '0')}.jsonl`);
      files.push(file);
      await writeFile(file, `${analysisTextLine(
        `drift-seed-${index}`,
        `seed ${index}`,
        new Date(Date.parse('2026-09-10T00:00:00.000Z') + index * 1_000).toISOString(),
      )}
`, 'utf8');
    }
    // Only this file holds an event old enough to leave the window when the
    // clock moves below; every other file stays entirely inside it.
    await appendFile(files[3], `${analysisTextLine(
      'drift-expiring', 'about to expire', '2026-09-09T13:00:00.000Z',
    )}
`, 'utf8');

    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { windowDays: 1 });
    assert.equal(cold.diagnostics.bodyReads, 32);

    // The clock moves past the oldest event of files[3]: it now needs a body
    // read to recompute its aggregate ('cutoff'), while another session simply
    // appends. Before this path existed, that pair forced every body to be
    // re-read — the ordinary case on a long history, where the window is always
    // drifting past something.
    now = Date.parse('2026-09-10T14:00:00.000Z');
    await appendFile(files[20], `${analysisTextLine(
      'drift-tail', 'tail', '2026-09-10T13:55:00.000Z',
    )}
`, 'utf8');

    const warm = await updateClaudeUsageIndex(cold.index, root, { windowDays: 1 });
    const full = await ClaudeDataLoader.loadUsageRecords(root, {
      analyzeContent: true,
      windowDays: 1,
    });

    if (warm.diagnostics.changed.move > 0) {
      t.skip('the filesystem reused a file identity, so this refresh is a move, not an addition');
      return;
    }

    assert.ok(
      warm.diagnostics.bodyReads < 32,
      `window drift re-read the whole corpus: ${warm.diagnostics.bodyReads} bodies`,
    );
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('a file that is appended to while losing an event to the window stays incremental', async (t) => {
  const previousNow = Date.now;
  let now = Date.parse('2026-09-10T12:00:00.000Z');
  Date.now = () => now;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-window-append-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-window-append');
  await mkdir(project, { recursive: true });
  const files: string[] = [];
  try {
    for (let index = 0; index < 8; index += 1) {
      const file = path.join(project, `session-${String(index).padStart(3, '0')}.jsonl`);
      files.push(file);
      await writeFile(file, `${analysisTextLine(
        `window-append-seed-${index}`,
        `seed ${index}`,
        new Date(Date.parse('2026-09-10T00:00:00.000Z') + index * 1_000).toISOString(),
      )}
`, 'utf8');
    }
    // This file alone holds an event old enough to leave the window below.
    await appendFile(files[2], `${analysisTextLine(
      'window-append-expiring', 'about to expire', '2026-09-09T13:00:00.000Z',
    )}
`, 'utf8');

    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { windowDays: 1 });
    assert.equal(cold.diagnostics.bodyReads, 8);

    // The same file is appended to in the refresh where its oldest event leaves
    // the window. Its stored aggregate still counts the expired event, so the
    // tail cannot simply be added to it and the file is re-read in full — but
    // the body only grew, and re-reading one file is no reason to re-read 32.
    now = Date.parse('2026-09-10T14:00:00.000Z');
    await appendFile(files[2], `${analysisTextLine(
      'window-append-tail', 'tail', '2026-09-10T13:55:00.000Z',
    )}
`, 'utf8');

    const warm = await updateClaudeUsageIndex(cold.index, root, { windowDays: 1 });
    const full = await ClaudeDataLoader.loadUsageRecords(root, {
      analyzeContent: true,
      windowDays: 1,
    });

    assert.ok(
      warm.diagnostics.bodyReads < 8,
      `an appended file losing an event re-read the whole corpus: ${warm.diagnostics.bodyReads} bodies, ` +
      `changed=${JSON.stringify(warm.diagnostics.changed)}`,
    );
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('mixed window rebuild and append give a new UUID to the earliest file', async () => {
  const previousNow = Date.now;
  let now = Date.parse('2026-09-10T12:00:00.000Z');
  Date.now = () => now;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-mixed-window-owner-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-mixed-window-owner');
  await mkdir(project, { recursive: true });
  try {
    const earlier = path.join(project, 'earlier.jsonl');
    const later = path.join(project, 'later.jsonl');
    await writeFile(earlier, `${analysisTextLine(
      'mixed-earlier-seed', 'early seed', '2026-09-10T00:00:00.000Z',
    )}\n`, 'utf8');
    await writeFile(later, [
      analysisTextLine('mixed-later-seed', 'later seed', '2026-09-10T00:01:00.000Z'),
      analysisTextLine('mixed-expiring', 'expires', '2026-09-09T13:00:00.000Z'),
    ].join('\n') + '\n', 'utf8');
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { windowDays: 1 });

    now = Date.parse('2026-09-10T14:00:00.000Z');
    await appendFile(earlier, `${analysisTextLine(
      'mixed-shared-uuid', 'earlier owner', '2026-09-10T13:55:00.000Z',
    )}\n`, 'utf8');
    await appendFile(later, `${analysisTextLine(
      'mixed-shared-uuid', 'later should not own', '2026-09-10T13:56:00.000Z',
    )}\n`, 'utf8');
    const warm = await updateClaudeUsageIndex(cold.index, root, { windowDays: 1 });
    const full = await ClaudeDataLoader.loadUsageRecords(root, {
      analyzeContent: true,
      windowDays: 1,
    });
    assert.equal(warm.diagnostics.bodyReads, 2);
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('a new file carrying an already-owned UUID falls back to the full rebuild', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-new-file-owned-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-new-file-owned');
  await mkdir(project, { recursive: true });
  try {
    const established = path.join(project, 'session-established.jsonl');
    await writeFile(established, `${analysisTextLine(
      'shared-owned-uuid', 'established content', '2026-09-09T10:00:00.000Z',
    )}
`, 'utf8');
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);

    // Earlier by timestamp, so the full loader hands ownership to the new file.
    await writeFile(path.join(project, 'session-earlier.jsonl'), `${analysisTextLine(
      'shared-owned-uuid', 'a different body for the same uuid', '2026-09-09T09:00:00.000Z',
    )}
`, 'utf8');

    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('concurrent appends to several files stay incremental instead of forcing a full rebuild', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-multi-append-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-multi-append');
  await mkdir(project, { recursive: true });
  const files: string[] = [];
  try {
    for (let index = 0; index < 64; index += 1) {
      const file = path.join(project, `session-${String(index).padStart(3, '0')}.jsonl`);
      files.push(file);
      await writeFile(file, `${usageLine(`multi-append-${index}`, index + 1, 1, {
        timestamp: new Date(Date.parse('2026-09-09T00:00:00.000Z') + index * 1_000).toISOString(),
      })}
`, 'utf8');
    }
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);
    assert.equal(cold.diagnostics.bodyReads, 64);

    // Three sessions writing at once is the ordinary case for a machine running
    // several agents, not an edge case.
    const appended = [files[10], files[30], files[63]];
    let offset = 0;
    let appendedBytes = 0;
    for (const file of appended) {
      offset += 1;
      const tail = `${usageLine(`multi-append-tail-${offset}`, 9, 3, {
        timestamp: new Date(Date.parse('2026-09-09T00:10:00.000Z') + offset * 1_000).toISOString(),
      })}
`;
      appendedBytes += Buffer.byteLength(tail);
      await appendFile(file, tail, 'utf8');
    }

    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.equal(warm.diagnostics.bodyReads, appended.length);
    assert.equal(warm.diagnostics.bytesRead, appendedBytes);
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('default content analysis does not revisit historical file contributions after a small append', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-scale-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-scale');
  await mkdir(project, { recursive: true });
  const files: string[] = [];
  try {
    for (let index = 0; index < 256; index += 1) {
      const file = path.join(project, `session-${String(index).padStart(3, '0')}.jsonl`);
      files.push(file);
      await writeFile(file, `${usageLine(`content-scale-${index}`, index + 1, 1, {
        timestamp: new Date(Date.parse('2026-09-09T00:00:00.000Z') + index * 1_000).toISOString(),
      })}\n`, 'utf8');
    }
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);
    assert.equal(cold.diagnostics.bodyReads, 256);

    let historicalContributionReads = 0;
    let historicalOrderReads = 0;
    for (const file of cold.index.files.values()) {
      if (file.path === files[files.length - 1] || !file.analysis) continue;
      const categories = file.analysis.cat;
      const firstTimestampMs = file.firstTimestampMs;
      Object.defineProperty(file.analysis, 'cat', {
        configurable: true,
        get: () => {
          historicalContributionReads += 1;
          return categories;
        },
      });
      Object.defineProperty(file, 'firstTimestampMs', {
        configurable: true,
        get: () => {
          historicalOrderReads += 1;
          return firstTimestampMs;
        },
      });
    }

    const tail = `${usageLine('content-scale-tail', 9, 3, {
      timestamp: '2026-09-09T00:10:00.000Z',
    })}\n`;
    await appendFile(files[files.length - 1], tail, 'utf8');
    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.equal(warm.diagnostics.bodyReads, 1);
    assert.equal(warm.diagnostics.bytesRead, Buffer.byteLength(tail));
    assert.equal(historicalContributionReads, 0);
    assert.equal(historicalOrderReads, 0);
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('content analysis expires a completed boundary file after configured-zone midnight without source reads', async () => {
  const previousNow = Date.now;
  const previousTimeZone = I18n.getTimezone();
  let now = Date.parse('2026-09-10T15:59:30.000Z');
  Date.now = () => now;
  I18n.setTimezone('Asia/Hong_Kong');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-expiry-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-expiry');
  await mkdir(project, { recursive: true });
  try {
    await writeFile(
      path.join(project, 'boundary.jsonl'),
      `${usageLine('content-boundary', 40, 4, { timestamp: '2026-08-11T16:00:00.000Z' })}\n`,
      'utf8',
    );
    await writeFile(
      path.join(project, 'active.jsonl'),
      `${usageLine('content-active', 20, 2, { timestamp: '2026-09-10T15:00:00.000Z' })}\n`,
      'utf8',
    );
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
      analyzeContent: true,
      windowDays: 30,
    });
    assert.equal(
      cold.contentAnalysis?.categories.find((slice) => slice.key === 'assistantText')?.count,
      2,
    );

    now = Date.parse('2026-09-10T16:00:30.000Z');
    const warm = await updateClaudeUsageIndex(cold.index, root, {
      analyzeContent: true,
      windowDays: 30,
    });
    const full = await ClaudeDataLoader.loadUsageRecords(root, {
      analyzeContent: true,
      windowDays: 30,
    });

    assert.equal(warm.diagnostics.bodyReads, 0);
    assert.deepEqual(warm.diagnostics.changed, {
      append: 0,
      rebuild: 0,
      move: 0,
      delete: 0,
    });
    assert.ok(warm.index.analysisCutoffMs > cold.index.analysisCutoffMs);
    assert.equal(
      warm.contentAnalysis?.categories.find((slice) => slice.key === 'assistantText')?.count,
      1,
    );
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
    I18n.setTimezone(previousTimeZone);
  }
});

test('completed malformed content lines do not poison unchanged cutoff rebases', async () => {
  const previousNow = Date.now;
  const previousTimeZone = I18n.getTimezone();
  let now = Date.parse('2026-09-10T15:59:30.000Z');
  Date.now = () => now;
  I18n.setTimezone('Asia/Hong_Kong');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-malformed-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-malformed');
  await mkdir(project, { recursive: true });
  try {
    const file = path.join(project, 'malformed.jsonl');
    await writeFile(file, [
      usageLine('content-malformed-active', 20, 2, {
        timestamp: '2026-09-10T15:00:00.000Z',
      }),
      '{malformed-json',
      '',
    ].join('\n'), 'utf8');
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);

    now = Date.parse('2026-09-10T16:00:30.000Z');
    const warm = await updateClaudeUsageIndex(cold.index, root);

    assert.equal(warm.diagnostics.bodyReads, 0);
    assert.equal(warm.diagnostics.changed.rebuild, 0);
    assert.deepEqual(warm.contentAnalysis, cold.contentAnalysis);

    const unchanged = await updateClaudeUsageIndex(warm.index, root);
    assert.equal(unchanged.diagnostics.bodyReads, 0);
    assert.deepEqual(unchanged.contentAnalysis, cold.contentAnalysis);
  } finally {
    Date.now = previousNow;
    I18n.setTimezone(previousTimeZone);
  }
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

test('content analysis ages out records later on the same configured-zone day', async () => {
  const previousNow = Date.now;
  const previousTimeZone = I18n.getTimezone();
  let now = Date.parse('2026-09-10T12:00:00.000Z');
  Date.now = () => now;
  I18n.setTimezone('UTC');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-same-day-expiry-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-same-day-expiry');
  await mkdir(project, { recursive: true });
  try {
    await writeFile(
      path.join(project, 'boundary.jsonl'),
      `${usageLine('same-day-boundary', 40, 4, { timestamp: '2026-08-11T12:00:30.000Z' })}\n`,
      'utf8',
    );
    await writeFile(
      path.join(project, 'active.jsonl'),
      `${usageLine('same-day-active', 20, 2, { timestamp: '2026-09-10T11:00:00.000Z' })}\n`,
      'utf8',
    );
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
      analyzeContent: true,
      windowDays: 30,
    });
    assert.equal(
      cold.contentAnalysis?.categories.find((slice) => slice.key === 'assistantText')?.count,
      2,
    );

    now = Date.parse('2026-09-10T12:01:00.000Z');
    const warm = await updateClaudeUsageIndex(cold.index, root, {
      analyzeContent: true,
      windowDays: 30,
    });
    const full = await ClaudeDataLoader.loadUsageRecords(root, {
      analyzeContent: true,
      windowDays: 30,
    });

    assert.equal(warm.diagnostics.bodyReads, 0);
    assert.equal(
      warm.contentAnalysis?.categories.find((slice) => slice.key === 'assistantText')?.count,
      1,
    );
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
    I18n.setTimezone(previousTimeZone);
  }
});

test('a newly discovered earlier file takes global content UUID ownership', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-new-owner-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-new-owner');
  await mkdir(project, { recursive: true });
  try {
    await writeFile(
      path.join(project, 'later.jsonl'),
      `${analysisTextLine('shared-new-owner', 'later owner', '2026-09-10T10:00:00.000Z')}\n`,
      'utf8',
    );
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);

    await writeFile(
      path.join(project, 'earlier.jsonl'),
      `${analysisTextLine('shared-new-owner', 'earlier owner has different content', '2026-09-10T09:00:00.000Z')}\n`,
      'utf8',
    );
    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('rebuilding an earlier file can preempt a later content UUID owner', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-rebuild-owner-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-rebuild-owner');
  await mkdir(project, { recursive: true });
  const earlier = path.join(project, 'earlier.jsonl');
  try {
    await writeFile(
      earlier,
      `${analysisTextLine('early-original', 'original early content', '2026-09-10T09:00:00.000Z')}\n`,
      'utf8',
    );
    await writeFile(
      path.join(project, 'later.jsonl'),
      `${analysisTextLine('shared-rebuild-owner', 'later owner', '2026-09-10T10:00:00.000Z')}\n`,
      'utf8',
    );
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);

    await writeFile(
      earlier,
      `${analysisTextLine('shared-rebuild-owner', 'rebuilt earlier owner has different content', '2026-09-10T09:00:00.000Z')}\n`,
      'utf8',
    );
    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('concurrent appends resolve new content UUID owners in full-scan file order', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-concurrent-owner-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-concurrent-owner');
  await mkdir(project, { recursive: true });
  const discoveredFirstButLater = path.join(project, 'a-later.jsonl');
  const discoveredLaterButEarlier = path.join(project, 'z-earlier.jsonl');
  try {
    await writeFile(
      discoveredFirstButLater,
      `${analysisTextLine('late-seed', 'late seed', '2026-09-10T10:00:00.000Z')}\n`,
      'utf8',
    );
    await writeFile(
      discoveredLaterButEarlier,
      `${analysisTextLine('early-seed', 'early seed', '2026-09-10T09:00:00.000Z')}\n`,
      'utf8',
    );
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);

    await Promise.all([
      appendFile(
        discoveredFirstButLater,
        `${analysisTextLine('shared-concurrent-owner', 'discovery-order owner', '2026-09-10T10:01:00.000Z')}\n`,
        'utf8',
      ),
      appendFile(
        discoveredLaterButEarlier,
        `${analysisTextLine('shared-concurrent-owner', 'full-scan-order owner has different content', '2026-09-10T09:01:00.000Z')}\n`,
        'utf8',
      ),
    ]);
    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('an earlier-file append falls back when its UUID preempts a later owner', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-append-owner-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-append-owner');
  await mkdir(project, { recursive: true });
  const earlier = path.join(project, 'earlier.jsonl');
  try {
    await writeFile(
      earlier,
      `${analysisTextLine('append-owner-seed', 'early seed', '2026-09-10T09:00:00.000Z')}\n`,
      'utf8',
    );
    await writeFile(
      path.join(project, 'later.jsonl'),
      `${analysisTextLine('shared-append-owner', 'later owner', '2026-09-10T10:00:00.000Z')}\n`,
      'utf8',
    );
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);

    await appendFile(
      earlier,
      `${analysisTextLine('shared-append-owner', 'appended earlier owner has different content', '2026-09-10T09:01:00.000Z')}\n`,
      'utf8',
    );
    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.equal(warm.diagnostics.bodyReads, 3);
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('an append that gives a zero-timestamp file its first timestamp reorders prompt samples', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-first-timestamp-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-first-timestamp');
  await mkdir(project, { recursive: true });
  const undated = path.join(project, 'a-undated.jsonl');
  try {
    await writeFile(
      undated,
      `${analysisTextLine('undated-prompt', 'undated original prompt', undefined, 'user')}\n`,
      'utf8',
    );
    await writeFile(
      path.join(project, 'b-dated.jsonl'),
      `${analysisTextLine('dated-prompt', 'dated prompt', '2026-09-10T09:00:00.000Z', 'user')}\n`,
      'utf8',
    );
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);

    await appendFile(
      undated,
      `${analysisTextLine('newly-dated-prompt', 'newly dated prompt', '2026-09-10T10:00:00.000Z', 'user')}\n`,
      'utf8',
    );
    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
    assert.deepEqual(
      warm.contentAnalysis?.recentPrompts.map((prompt) => prompt.text),
      ['dated prompt', 'undated original prompt', 'newly dated prompt'],
    );
  } finally {
    Date.now = previousNow;
  }
});

test('a timestamp beyond a 1 MiB timestamp-less prefix retains legacy discovery order', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-large-prefix-order-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-large-prefix-order');
  await mkdir(project, { recursive: true });
  try {
    const largePrefix = `${JSON.stringify({ payload: 'x'.repeat(1024 * 1024 + 32) })}\n`;
    await writeFile(path.join(project, 'discovered-first.jsonl'), [
      largePrefix.trimEnd(),
      analysisTextLine(
        'large-prefix-prompt',
        'prompt from timestamp-limited file',
        '2026-09-10T11:00:00.000Z',
        'user',
      ),
      '',
    ].join('\n'), 'utf8');
    await writeFile(path.join(project, 'discovered-second.jsonl'), `${analysisTextLine(
      'ordinary-prompt',
      'prompt from ordinary file',
      '2026-09-10T10:00:00.000Z',
      'user',
    )}\n`, 'utf8');

    const incremental = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.deepEqual(incremental.contentAnalysis, full.contentAnalysis);
    assert.deepEqual(
      incremental.contentAnalysis?.recentPrompts.map((prompt) => prompt.text),
      ['prompt from timestamp-limited file', 'prompt from ordinary file'],
    );
  } finally {
    Date.now = previousNow;
  }
});

test('changed discoveryIndex ties rebuild canonical content ownership and order', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-discovery-tie-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-discovery-tie');
  await mkdir(project, { recursive: true });
  const first = path.join(project, 'first.jsonl');
  const second = path.join(project, 'second.jsonl');
  try {
    await writeFile(first, `${analysisTextLine(
      'discovery-tie-owner',
      'first discovery owner',
      '2026-09-10T09:00:00.000Z',
    )}\n`, 'utf8');
    await writeFile(second, `${analysisTextLine(
      'discovery-tie-owner',
      'second discovery owner with different content',
      '2026-09-10T09:00:00.000Z',
    )}\n`, 'utf8');
    const coldManifest = await manifestInOrder([first, second]);
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
      manifest: coldManifest,
    });

    const swappedManifest = await manifestInOrder([second, first]);
    const warm = await updateClaudeUsageIndex(cold.index, root, {
      manifest: swappedManifest,
    });
    const full = await ClaudeDataLoader.loadUsageRecords(root, {
      analyzeContent: true,
      manifest: swappedManifest,
    });

    assert.equal(warm.diagnostics.bodyReads, 2);
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('per-file skill retention preserves the full loader global skill cap semantics', async () => {
  const previousNow = Date.now;
  let now = Date.parse('2026-09-10T12:00:00.000Z');
  Date.now = () => now;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-skill-cap-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-skill-cap');
  await mkdir(project, { recursive: true });
  try {
    await writeFile(
      path.join(project, 'first.jsonl'),
      `${skillInvocationLines('first', 5_000, '2026-08-11T12:00:30.000Z').join('\n')}\n`,
      'utf8',
    );
    await writeFile(
      path.join(project, 'second.jsonl'),
      `${skillInvocationLines('second', 1, '2026-09-10T10:00:00.000Z').join('\n')}\n`,
      'utf8',
    );

    const incremental = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.equal(incremental.contentAnalysis?.skillUses.length, 5_000);
    assert.equal(
      incremental.contentAnalysis?.frameworkOverhead?.components
        .find((component) => component.kind === 'skill-preamble')?.count,
      5_000,
    );
    assert.deepEqual(incremental.contentAnalysis, full.contentAnalysis);

    now = Date.parse('2026-09-10T12:01:00.000Z');
    const aged = await updateClaudeUsageIndex(incremental.index, root);
    const agedFull = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.equal(aged.diagnostics.bodyReads, 0);
    assert.deepEqual(aged.contentAnalysis?.skillUses.map((use) => use.name), ['second-skill-0']);
    assert.equal(
      aged.contentAnalysis?.frameworkOverhead?.components
        .find((component) => component.kind === 'skill-preamble')?.count,
      1,
    );
    assert.deepEqual(aged.contentAnalysis, agedFull.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
});

test('an earlier-file append displaces the exact global 5000th Skill and preamble', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-skill-displacement-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-skill-displacement');
  await mkdir(project, { recursive: true });
  const earlier = path.join(project, 'earlier.jsonl');
  try {
    await writeFile(
      earlier,
      `${skillInvocationLines('earlier-seed', 1, '2026-09-10T09:00:00.000Z').join('\n')}\n`,
      'utf8',
    );
    await writeFile(
      path.join(project, 'later.jsonl'),
      `${skillInvocationLines('later', 5_000, '2026-09-10T10:00:00.000Z').join('\n')}\n`,
      'utf8',
    );
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);
    assert.equal(cold.contentAnalysis?.skillUses[4_999]?.name, 'later-skill-4998');

    await appendFile(
      earlier,
      `${skillInvocationLines('earlier-tail', 1, '2026-09-10T09:01:00.000Z').join('\n')}\n`,
      'utf8',
    );
    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.equal(warm.diagnostics.bodyReads, 1);
    assert.equal(warm.contentAnalysis?.skillUses.length, 5_000);
    assert.equal(warm.contentAnalysis?.skillUses[4_999]?.name, 'later-skill-4997');
    assert.equal(
      warm.contentAnalysis?.frameworkOverhead?.components
        .find((component) => component.kind === 'skill-preamble')?.count,
      5_000,
    );
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
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

test('the dashboard middle scope is a rolling 30-day window across month boundaries', async () => {
  const previousTimeZone = I18n.getTimezone();
  I18n.setTimezone('UTC');
  try {
    const { root, first } = await fixture();
    await appendFile(first, [
      usageLine('rolling-boundary', 30, 12, {
        timestamp: '2026-08-04T09:00:00.000Z',
      }),
      usageLine('rolling-outside', 40, 16, {
        timestamp: '2026-08-03T09:00:00.000Z',
      }),
      '',
    ].join('\n'), 'utf8');
    const loaded = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
      analyzeContent: false,
    });
    const snapshot = claudeUsageDashboardSnapshot(loaded.index, {
      now: new Date('2026-09-02T12:00:00.000Z'),
    });

    assert.equal(snapshot.month.messageCount, 0);
    assert.equal(snapshot.last30Days.messageCount, 1);
    assert.equal(snapshot.last30Days.totalInputTokens, 60);
    assert.equal(snapshot.last30Days.totalOutputTokens, 24);
    assert.deepEqual(
      snapshot.dailyForLast30Days.map((row) => row.date),
      ['2026-08-21', '2026-08-04'],
    );
  } finally {
    I18n.setTimezone(previousTimeZone);
  }
});

test('Today and rolling 30 days share the configured local-day map across DST', async () => {
  const previousTimeZone = I18n.getTimezone();
  I18n.setTimezone('America/Los_Angeles');
  try {
    const { root, first, second } = await fixture();
    await writeFile(first, [
      usageLine('dst-today', 10, 1, { timestamp: '2026-11-02T08:30:00.000Z' }),
      usageLine('dst-transition-day', 20, 2, { timestamp: '2026-11-01T07:30:00.000Z' }),
      usageLine('rolling-first-day', 30, 3, { timestamp: '2026-10-04T07:30:00.000Z' }),
      usageLine('rolling-outside', 40, 4, { timestamp: '2026-10-04T06:30:00.000Z' }),
      '',
    ].join('\n'), 'utf8');
    await unlink(second);

    const loaded = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
      analyzeContent: false,
    });
    const bodyReads = loaded.diagnostics.bodyReads;
    const snapshot = claudeUsageDashboardSnapshot(loaded.index, {
      now: new Date('2026-11-02T12:00:00.000Z'),
    });

    assert.deepEqual(
      snapshot.dailyForLast30Days.map((row) => row.date),
      ['2026-11-02', '2026-11-01', '2026-10-04'],
    );
    assert.equal(snapshot.today.totalInputTokens, 10);
    assert.equal(snapshot.last30Days.totalInputTokens, 60);
    assert.equal(snapshot.allTime.totalInputTokens, 100);
    assert.deepEqual(
      stableValue(snapshot.dailyForLast30Days.find((row) => row.date === '2026-11-02')?.data),
      stableValue(snapshot.today),
    );
    for (const field of [
      'messageCount',
      'totalInputTokens',
      'totalOutputTokens',
      'totalCacheCreationTokens',
      'totalCacheReadTokens',
      'totalCost',
    ] as const) {
      assert.ok(snapshot.today[field] <= snapshot.last30Days[field], `${field}: Today <= 30 days`);
      assert.ok(snapshot.last30Days[field] <= snapshot.allTime[field], `${field}: 30 days <= all time`);
    }
    assert.equal(loaded.diagnostics.bodyReads, bodyReads, 'snapshot materialization performs no extra reads');
  } finally {
    I18n.setTimezone(previousTimeZone);
  }
});

test('Claude project-day aggregates stay incremental and feed the 90-day matrix without body rereads', async () => {
  const previousTimeZone = I18n.getTimezone();
  I18n.setTimezone('UTC');
  try {
    const { root, first } = await fixture();
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
      analyzeContent: false,
    });
    const initial = claudeUsageDashboardSnapshot(cold.index, {
      now: new Date('2026-08-21T12:00:00.000Z'),
    });
    assert.deepEqual(
      initial.projectUsageMatrix.points.map((point) => ({
        name: point.projectName,
        day: point.day,
        tokens: point.tokens,
      })),
      [
        { name: 'project-a', day: '2026-08-21', tokens: 19 },
        { name: 'project-b', day: '2026-08-21', tokens: 33 },
      ],
    );

    const unchanged = await updateClaudeUsageIndex(cold.index, root, {
      analyzeContent: false,
    });
    const warmSnapshot = claudeUsageDashboardSnapshot(unchanged.index, {
      now: new Date('2026-08-21T12:00:00.000Z'),
    });
    assert.equal(unchanged.diagnostics.bodyReads, 0);
    assert.deepEqual(warmSnapshot.projectUsageMatrix, initial.projectUsageMatrix);

    await appendFile(first, `${usageLine('matrix-append', 7, 1, {
      timestamp: '2026-08-22T09:00:00.000Z',
    })}\n`, 'utf8');
    const appended = await updateClaudeUsageIndex(unchanged.index, root, {
      analyzeContent: false,
    });
    const appendedSnapshot = claudeUsageDashboardSnapshot(appended.index, {
      now: new Date('2026-08-22T12:00:00.000Z'),
    });
    assert.equal(appended.diagnostics.bodyReads, 1);
    assert.deepEqual(
      appendedSnapshot.projectUsageMatrix.points
        .filter((point) => point.projectName === 'project-a')
        .map((point) => ({ day: point.day, tokens: point.tokens })),
      [
        { day: '2026-08-21', tokens: 19 },
        { day: '2026-08-22', tokens: 13 },
      ],
    );
  } finally {
    I18n.setTimezone(previousTimeZone);
  }
});

test('advice window is opt-in and comes only from materialized day and session aggregates', async () => {
  const { root, first } = await fixture();
  await writeFile(
    path.join(path.dirname(first), 'session-old.jsonl'),
    `${usageLine('old-advice', 999, 99, { timestamp: '2026-06-01T08:00:00.000Z' })}\n`,
    'utf8',
  );
  const loaded = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  const ordinary = claudeUsageDashboardSnapshot(loaded.index, {
    now: new Date('2026-08-22T12:00:00.000Z'),
  });
  assert.equal(ordinary.adviceWindow, undefined);

  const candidate = claudeUsageDashboardSnapshot(loaded.index, {
    now: new Date('2026-08-22T12:00:00.000Z'),
    adviceWindowDays: 30,
  });
  assert.equal(candidate.adviceWindow?.aggregate.messageCount, 1);
  assert.equal(candidate.adviceWindow?.aggregate.totalInputTokens, 30);
  assert.equal(candidate.adviceWindow?.totalSessions, 2);
  assert.equal(candidate.adviceWindow?.longSessionCount, 0);
  assert.equal(candidate.adviceWindow?.largeContextSessionCount, 0);
  assert.equal(loaded.diagnostics.bodyReads, 3, 'snapshot materialization performs no extra reads');
});

test('configured timezone rebuckets Claude Today and hours from the in-memory index without body reads', async () => {
  const previousTimeZone = I18n.getTimezone();
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-timezone-index-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-timezone');
  await mkdir(project, { recursive: true });
  const file = path.join(project, 'timezone.jsonl');
  await writeFile(file, `${usageLine('timezone', 10, 2, {
    timestamp: '2026-07-20T23:30:00.000Z',
  })}\n`, 'utf8');

  try {
    I18n.setTimezone('UTC');
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
      analyzeContent: false,
    });
    const utc = claudeUsageDashboardSnapshot(cold.index, {
      now: new Date('2026-07-21T00:15:00.000Z'),
    });
    assert.equal(utc.today.totalInputTokens, 0);
    assert.deepEqual(utc.hourlyForToday, []);

    I18n.setTimezone('Asia/Hong_Kong');
    const shifted = await updateClaudeUsageIndex(cold.index, root, {
      analyzeContent: false,
    });
    const hongKong = claudeUsageDashboardSnapshot(shifted.index, {
      now: new Date('2026-07-21T00:15:00.000Z'),
    });

    assert.equal(shifted.diagnostics.bodyReads, 0);
    assert.equal(hongKong.today.totalInputTokens, 10);
    assert.deepEqual(
      hongKong.projectUsageMatrix.points.map((point) => point.day),
      ['2026-07-21'],
    );
    assert.deepEqual(hongKong.hourlyForToday.map(({ hour }) => hour), ['07:00']);
    assert.deepEqual(
      hongKong.hourlyForLast30DaysByDay['2026-07-21'].map(({ hour }) => hour),
      ['07:00'],
    );
    assert.deepEqual(
      ClaudeDataLoader.getHourlyDataForDate(shifted.records, '2026-07-21')
        .map(({ hour }) => hour),
      ['07:00'],
    );
  } finally {
    I18n.setTimezone(previousTimeZone);
  }
});

test('re-enabling analysis after a disabled DST-zone change cannot publish stale day buckets', async () => {
  const previousNow = Date.now;
  const previousTimeZone = I18n.getTimezone();
  Date.now = () => Date.parse('2026-11-02T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-disabled-timezone-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-disabled-timezone');
  await mkdir(project, { recursive: true });
  const file = path.join(project, 'timezone.jsonl');
  try {
    await writeFile(file, [
      JSON.stringify({
        type: 'assistant',
        uuid: 'dst-thinking',
        timestamp: '2026-11-01T06:30:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'thinking before the DST fallback' }],
        },
      }),
      ...skillInvocationLines('dst-skill', 1, '2026-11-01T06:31:00.000Z'),
      '',
    ].join('\n'), 'utf8');

    I18n.setTimezone('UTC');
    const enabled = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
      analyzeContent: true,
    });
    assert.deepEqual(Object.keys(enabled.contentAnalysis?.thinkingByDay ?? {}), ['2026-11-01']);

    I18n.setTimezone('America/Los_Angeles');
    const disabled = await updateClaudeUsageIndex(enabled.index, root, {
      analyzeContent: false,
    });
    assert.equal(disabled.diagnostics.bodyReads, 0);
    assert.equal(disabled.contentAnalysis, null);

    const pendingLine = analysisTextLine(
      'dst-pending-output',
      'output completed after analysis is re-enabled',
      '2026-11-02T07:00:00.000Z',
    );
    const splitAt = pendingLine.length - 3;
    await appendFile(file, pendingLine.slice(0, splitAt), 'utf8');
    const disabledWithPendingTail = await updateClaudeUsageIndex(disabled.index, root, {
      analyzeContent: false,
    });
    assert.equal(disabledWithPendingTail.contentAnalysis, null);

    const reenabled = await updateClaudeUsageIndex(disabledWithPendingTail.index, root, {
      analyzeContent: true,
    });

    assert.equal(reenabled.diagnostics.bodyReads, 1);
    assert.deepEqual(Object.keys(reenabled.contentAnalysis?.thinkingByDay ?? {}), ['2026-10-31']);
    assert.deepEqual(reenabled.contentAnalysis?.skillUses.map((use) => use.day), ['2026-10-31']);
    assert.equal(
      reenabled.contentAnalysis?.totalEstimatedTokens,
      enabled.contentAnalysis?.totalEstimatedTokens,
      'the incomplete append must stay behind the safe cursor during re-enable',
    );

    await appendFile(file, `${pendingLine.slice(splitAt)}\n`, 'utf8');
    const completed = await updateClaudeUsageIndex(reenabled.index, root, {
      analyzeContent: true,
    });
    const fullAfterCompletion = await ClaudeDataLoader.loadUsageRecords(root, {
      analyzeContent: true,
    });
    assert.deepEqual(completed.contentAnalysis, fullAfterCompletion.contentAnalysis);
  } finally {
    Date.now = previousNow;
    I18n.setTimezone(previousTimeZone);
  }
});

test('nested Claude subagent logs feed Today and rolling 30 days exactly once', async () => {
  const previousTimeZone = I18n.getTimezone();
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-subagent-index-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-subagent');
  const subagents = path.join(project, 'session-root', 'subagents');
  await mkdir(subagents, { recursive: true });
  await writeFile(
    path.join(project, 'session-root.jsonl'),
    `${usageLine('root', 10, 2, { timestamp: '2026-08-21T08:00:00.000Z' })}\n`,
    'utf8',
  );
  const subagentFile = path.join(subagents, 'agent-review.jsonl');
  await writeFile(
    subagentFile,
    `${usageLine('subagent', 20, 4, { timestamp: '2026-08-21T09:00:00.000Z' })}\n`,
    'utf8',
  );

  try {
    I18n.setTimezone('UTC');
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
      analyzeContent: false,
    });
    const first = claudeUsageDashboardSnapshot(cold.index, {
      now: new Date('2026-08-21T12:00:00.000Z'),
    });

    assert.equal(cold.diagnostics.bodyReads, 2);
    assert.equal(cold.records.filter((record) => record._agentId === 'agent-review').length, 1);
    assert.equal(first.today.totalInputTokens, 30);
    assert.equal(first.last30Days.totalInputTokens, 30);
    assert.equal(first.allTime.totalInputTokens, 30);
    assert.equal(first.sessions.reduce((sum, session) => sum + session.data.totalInputTokens, 0), 30);

    const unchanged = await updateClaudeUsageIndex(cold.index, root, {
      analyzeContent: false,
    });
    const unchangedSnapshot = claudeUsageDashboardSnapshot(unchanged.index, {
      now: new Date('2026-08-21T12:00:00.000Z'),
    });
    assert.equal(unchanged.diagnostics.bodyReads, 0);
    assert.equal(unchangedSnapshot.today.totalInputTokens, 30);

    await appendFile(
      subagentFile,
      `${usageLine('subagent-tail', 7, 1, { timestamp: '2026-08-21T10:00:00.000Z' })}\n`,
      'utf8',
    );
    const appended = await updateClaudeUsageIndex(unchanged.index, root, {
      analyzeContent: false,
    });
    const appendedSnapshot = claudeUsageDashboardSnapshot(appended.index, {
      now: new Date('2026-08-21T12:00:00.000Z'),
    });
    assert.equal(appended.diagnostics.bodyReads, 1);
    assert.equal(appendedSnapshot.today.totalInputTokens, 37);
    assert.equal(appendedSnapshot.last30Days.totalInputTokens, 37);
    assert.equal(appendedSnapshot.allTime.totalInputTokens, 37);
  } finally {
    I18n.setTimezone(previousTimeZone);
  }
});

test('hourly materialization is limited to the recent 30-day window while day and month stay all-time', async () => {
  const previousTimeZone = I18n.getTimezone();
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-hour-window-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-hour-window');
  await mkdir(project, { recursive: true });
  const now = Date.now();
  const oldTimestamp = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString();
  const recentTimestamp = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
  await writeFile(path.join(project, 'window.jsonl'), [
    usageLine('old', 10, 1, { timestamp: oldTimestamp }),
    usageLine('recent', 20, 2, { timestamp: recentTimestamp }),
    '',
  ].join('\n'), 'utf8');
  try {
    I18n.setTimezone('UTC');
    const loaded = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
      analyzeContent: false,
    });
    assert.equal(loaded.index.aggregates.byDay.size, 2);
    assert.equal(loaded.index.aggregates.byMonth.size >= 1, true);
    assert.equal([...loaded.index.aggregates.byLocalHour.keys()].some((key) => key.startsWith(oldTimestamp.slice(0, 10))), false);
    assert.equal([...loaded.index.aggregates.byLocalHour.keys()].some((key) => key.startsWith(recentTimestamp.slice(0, 10))), true);
  } finally {
    I18n.setTimezone(previousTimeZone);
  }
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

test('an early append performs UUID ownership lookups by touched UUID, not later-file count', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-content-uuid-lookup-scale-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-content-uuid-lookup-scale');
  await mkdir(project, { recursive: true });
  const files: string[] = [];
  try {
    for (let index = 0; index < 128; index += 1) {
      const file = path.join(project, `session-${String(index).padStart(3, '0')}.jsonl`);
      files.push(file);
      await writeFile(file, `${analysisTextLine(
        `uuid-lookup-${index}`,
        `content ${index}`,
        new Date(Date.parse('2026-09-10T08:00:00.000Z') + index * 1_000).toISOString(),
      )}\n`, 'utf8');
    }
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);
    let laterFileUuidSetReads = 0;
    for (const file of cold.index.files.values()) {
      if (file.path === files[0]) continue;
      const uuids = file.analysisAllUuids;
      Object.defineProperty(file, 'analysisAllUuids', {
        configurable: true,
        get: () => {
          laterFileUuidSetReads += 1;
          return uuids;
        },
      });
    }

    const tail = `${analysisTextLine(
      'uuid-lookup-new-tail',
      'new early-file content',
      '2026-09-10T08:05:00.000Z',
    )}\n`;
    await appendFile(files[0], tail, 'utf8');
    const warm = await updateClaudeUsageIndex(cold.index, root);
    const full = await ClaudeDataLoader.loadUsageRecords(root, { analyzeContent: true });

    assert.equal(warm.diagnostics.bodyReads, 1);
    assert.equal(warm.diagnostics.bytesRead, Buffer.byteLength(tail));
    assert.equal(laterFileUuidSetReads, 0);
    assert.deepEqual(warm.contentAnalysis, full.contentAnalysis);
  } finally {
    Date.now = previousNow;
  }
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

test('content-analysis publication is deeply immutable across a successful append', async () => {
  const previousNow = Date.now;
  Date.now = () => Date.parse('2026-09-10T12:00:00.000Z');
  const { root, first } = await fixture();
  try {
    await appendFile(first, `${skillInvocationLines(
      'immutable',
      1,
      '2026-09-10T09:00:00.000Z',
    ).join('\n')}\n`, 'utf8');
    const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root);
    const priorAnalysis = stableValue(cold.contentAnalysis);
    const priorFileAnalysis = [...cold.index.files.values()].map((file) => ({
      path: file.path,
      analysis: stableValue(file.analysis && {
        cat: file.analysis.cat,
        tools: file.analysis.tools,
        prompts: file.analysis.prompts,
        thinkingBySession: file.analysis.thinkingBySession,
        thinkingByDay: file.analysis.thinkingByDay,
        skillUses: file.analysis.skillUses,
        skillPreambleCounts: file.analysis.skillPreambleCounts,
        frameworkOverhead: file.analysis.frameworkOverhead,
      }),
      uuids: [...file.analysisAllUuids],
    }));
    deepFreeze(cold.contentAnalysis);
    for (const file of cold.index.files.values()) {
      deepFreeze(file.analysis);
      deepFreeze(file.analysisAllUuids);
    }

    await appendFile(first, `${analysisTextLine(
      'immutable-tail',
      'immutable tail content',
      '2026-09-10T09:01:00.000Z',
    )}\n`, 'utf8');
    const warm = await updateClaudeUsageIndex(cold.index, root);

    assert.notEqual(warm.contentAnalysis, cold.contentAnalysis);
    assert.deepEqual(stableValue(cold.contentAnalysis), priorAnalysis);
    assert.deepEqual(
      [...cold.index.files.values()].map((file) => ({
        path: file.path,
        analysis: stableValue(file.analysis && {
          cat: file.analysis.cat,
          tools: file.analysis.tools,
          prompts: file.analysis.prompts,
          thinkingBySession: file.analysis.thinkingBySession,
          thinkingByDay: file.analysis.thinkingByDay,
          skillUses: file.analysis.skillUses,
          skillPreambleCounts: file.analysis.skillPreambleCounts,
          frameworkOverhead: file.analysis.frameworkOverhead,
        }),
        uuids: [...file.analysisAllUuids],
      })),
      priorFileAnalysis,
    );
  } finally {
    Date.now = previousNow;
  }
});

test('incomplete JSON tails stay invisible until the JSON and newline are durable', async () => {
  const { root, first } = await fixture();
  const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  const complete = usageLine('partial', 9, 6);
  const splitAt = complete.length - 12;
  await appendFile(first, complete.slice(0, splitAt), 'utf8');

  const pending = await updateClaudeUsageIndex(cold.index, root, { analyzeContent: false });
  assert.equal(pending.diagnostics.linesParsed, 0);
  assert.deepEqual(normalized(pending.records), normalized(cold.records));

  await appendFile(first, `${complete.slice(splitAt)}\n`, 'utf8');
  const completed = await updateClaudeUsageIndex(pending.index, root, {
    analyzeContent: false,
  });
  assert.equal(completed.diagnostics.linesParsed, 1);
  await assertMatchesFull(root, completed.records);
});

test('valid JSON at EOF without a newline matches the legacy full scan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-valid-eof-'));
  roots.push(root);
  const project = path.join(root, 'projects', '-fixture-valid-eof');
  await mkdir(project, { recursive: true });
  const file = path.join(project, 'session.jsonl');
  await writeFile(file, usageLine('valid-eof', 17, 5), 'utf8');

  const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  assert.equal(cold.diagnostics.linesParsed, 1);
  await assertMatchesFull(root, cold.records);

  const unchanged = await updateClaudeUsageIndex(cold.index, root, {
    analyzeContent: false,
  });
  assert.equal(unchanged.diagnostics.bodyReads, 0);
  await assertMatchesFull(root, unchanged.records);

  await appendFile(file, `\n${usageLine('second-valid-eof', 19, 7)}`, 'utf8');
  const appended = await updateClaudeUsageIndex(unchanged.index, root, {
    analyzeContent: false,
  });
  assert.equal(appended.diagnostics.bodyReads, 1);
  assert.equal(appended.diagnostics.linesParsed, 1);
  await assertMatchesFull(root, appended.records);
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

test('a later read failure rolls back an already parsed plan without deep mutation', async () => {
  const { root, first, second } = await fixture();
  const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, {
    analyzeContent: false,
  });
  const priorRecords = normalized(cold.records);
  const priorAllTime = stableValue(cold.index.aggregates.allTime);
  const priorFiles = [...cold.index.files.values()].map((file) => ({
    path: file.path,
    size: file.fingerprint.size,
    usage: normalized([...file.usage.values()].map((entry) => entry.record)),
  }));
  for (const bucket of cold.index.aggregates.byDay.values()) deepFreeze(bucket);
  for (const file of cold.index.files.values()) {
    deepFreeze(file.usage);
    deepFreeze(file.prompts);
  }

  await appendFile(first, `${usageLine('rollback-first', 50, 5)}\n`, 'utf8');
  await appendFile(second, `${usageLine('rollback-second', 60, 6)}\n`, 'utf8');
  const failed = await updateClaudeUsageIndex(cold.index, root, {
    analyzeContent: false,
    beforeBodyReads: async () => unlink(second),
  });

  assert.equal(failed.index, cold.index);
  assert.equal(failed.diagnostics.bodyReads, 2, 'the first plan parsed before the second failed');
  assert.deepEqual(normalized(failed.records), priorRecords);
  assert.deepEqual(stableValue(cold.index.aggregates.allTime), priorAllTime);
  assert.deepEqual(
    [...cold.index.files.values()].map((file) => ({
      path: file.path,
      size: file.fingerprint.size,
      usage: normalized([...file.usage.values()].map((entry) => entry.record)),
    })),
    priorFiles,
  );
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
