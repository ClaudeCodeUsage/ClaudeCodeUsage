import { before, after, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Module = require('node:module');
import { claudeUsageDashboardSnapshot, createClaudeUsageIndex, updateClaudeUsageIndex,
  type ClaudeUsageIndex } from '../claudeIncrementalIndex';
import { ACHIEVEMENT_RECORD_FILE, loadAchievementRecords, type AchievementRecord } from '../achievementRecordStore';
import { getAchievementMoneyPricebook } from '../achievementMoney';
import { I18n } from '../i18n';

const now = new Date('2026-10-12T12:00:00.000Z');
let root: string, index: ClaudeUsageIndex;
let previousZone: string;
function line(id: string, input: number, timestamp: string): string {
  // Numeric source evidence goes through the production parser and incremental
  // reducers. There is no hand-built complete money DTO or dashboard-cost proof.
  return JSON.stringify({ type: 'assistant', timestamp, requestId: 'request-' + id,
    message: { id: 'message-' + id, model: 'claude-opus-5-5', content: [], usage: {
      input_tokens: input, output_tokens: 0, cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    } } }) + '\n';
}
before(async () => {
  previousZone = I18n.getTimezone(); I18n.setTimezone('UTC');
  root = await mkdtemp(path.join(os.tmpdir(), 'ccu-money-handoff-'));
  const project = path.join(root, 'projects', '-isolated-fixture');
  await mkdir(project, { recursive: true });
  // The giant session is older than all 1000 tiny sessions. The Sessions cap
  // must exclude it, while the uncapped numeric map still proves the peak.
  for (let start = 0; start < 1001; start += 100) {
    await Promise.all(Array.from({ length: Math.min(100, 1001 - start) }, (_, offset) => {
      const n = start + offset, giant = n === 1000;
      return writeFile(path.join(project, `session-${n}.jsonl`), line(String(n), giant ? 250_000_000 : 1,
        giant ? '2026-09-28T12:00:00.000Z' : '2026-10-06T12:00:00.000Z'), 'utf8');
    }));
  }
  const cold = await updateClaudeUsageIndex(createClaudeUsageIndex(), root, { analyzeContent: false });
  assert.equal(cold.diagnostics.filesFailed, 0);
  assert.equal(cold.diagnostics.bodyReads, 1001);
  index = cold.index;
});
after(async () => {
  I18n.setTimezone(previousZone);
  if (root) await rm(root, { recursive: true, force: true });
});

test('money handoff: actual dashboard transports an uncapped 1001-session peak in a bounded identity-free DTO', () => {
  const snapshot = claudeUsageDashboardSnapshot(index, { now, achievementMoneyBackend: 'anthropic' });
  assert.equal(snapshot.sessions.length, 1000);
  assert.ok(!snapshot.sessions.some(row => row.sessionId === 'session-1000'));
  assert.equal(snapshot.achievementSessionEvidence.outputSessions, 0);
  const money = snapshot.achievementMoney;
  assert.ok(money);
  assert.equal(money.maxSessionTask, 1_000_000_000);
  assert.equal(money.completedMondayWeekPeak, 1_000_000_000);
  assert.equal(money.cumulative?.microUsd, 1_000_004_000);
  assert.equal(money.cumulative?.totalTokens, 250_001_000);
  assert.equal(money.cumulative?.pricingCoverage, 1);
  assert.equal(money.coverage.maxSessionTask.status, 'complete');
  assert.equal(money.pricebookVersion, getAchievementMoneyPricebook('anthropic').version);
  assert.ok(Object.isFrozen(money));
  const serialized = JSON.stringify(money);
  assert.ok(Buffer.byteLength(serialized) < 2048);
  assert.ok(!serialized.includes(root));
  assert.doesNotMatch(serialized, /session-1000|request-|message-|isolated-fixture/);
  assert.doesNotMatch(serialized, /"(?:sessionId|sessionKey|path|records|models|prices|aliases|timestamp)"/);
});

test('money handoff: warm actual refresh reads zero JSONL bodies and retains the identical money projection without a session rescan', async () => {
  const first = claudeUsageDashboardSnapshot(index, { now, achievementMoneyBackend: 'anthropic' }).achievementMoney;
  assert.ok(first);
  const sessions = index.aggregates.bySession;
  const originalIterator = sessions[Symbol.iterator];
  let iterations = 0;
  sessions[Symbol.iterator] = function() { iterations++; return originalIterator.call(this); };
  try {
    const repeated = claudeUsageDashboardSnapshot(index, {
      now: new Date('2026-10-12T13:00:00Z'), achievementMoneyBackend: 'anthropic',
    });
    assert.equal(repeated.achievementMoney, first, 'same committed index and civil day reuse the frozen DTO');
    assert.equal(iterations, 0);
    const warm = await updateClaudeUsageIndex(index, root, { analyzeContent: false });
    assert.equal(warm.diagnostics.bodyReads, 0);
    assert.equal(warm.diagnostics.bytesRead, 0);
    assert.equal(warm.diagnostics.aggregateMutations, 0);
    iterations = 0; // Count projection traversal separately from the loader's map cloning.
    const refreshedSessions = warm.index.aggregates.bySession;
    const refreshedIterator = refreshedSessions[Symbol.iterator];
    refreshedSessions[Symbol.iterator] = function() { iterations++; return refreshedIterator.call(this); };
    try {
      const refreshed = claudeUsageDashboardSnapshot(warm.index, {
        now: new Date('2026-10-12T13:00:00Z'), achievementMoneyBackend: 'anthropic',
      });
      assert.equal(refreshed.achievementMoney === first, true,
        'unchanged loader→dashboard money identity; uncapped session iterations=' + iterations);
      assert.equal(iterations, 0, 'warm money handoff must not walk the uncapped session map');
    } finally { refreshedSessions[Symbol.iterator] = refreshedIterator; }
  } finally { sessions[Symbol.iterator] = originalIterator; }
});

test('money handoff: actual dashboard freezes provider/backend books and retires cache on backend or asOfDay change', () => {
  const anthropic = claudeUsageDashboardSnapshot(index, { now, achievementMoneyBackend: 'anthropic' }).achievementMoney!;
  const regional = claudeUsageDashboardSnapshot(index, { now, achievementMoneyBackend: 'aws-bedrock-in-region' }).achievementMoney!;
  assert.notEqual(regional, anthropic);
  assert.equal(regional.maxSessionTask, 1_100_000_000);
  assert.equal(regional.pricebookVersion, getAchievementMoneyPricebook('aws-bedrock-in-region').version);
  assert.equal(regional.backend, 'aws-bedrock-in-region');
  assert.equal(anthropic.maxSessionTask, 1_000_000_000, 'repricing cannot mutate a previously accepted reference DTO');
  assert.equal(anthropic.pricebookVersion, getAchievementMoneyPricebook('anthropic').version);
  const nextDay = claudeUsageDashboardSnapshot(index, {
    now: new Date('2026-10-13T12:00:00Z'), achievementMoneyBackend: 'aws-bedrock-in-region',
  }).achievementMoney!;
  assert.notEqual(nextDay, regional);
  assert.equal(nextDay.maxSessionTask, regional.maxSessionTask);
});

test('money handoff: OFF omits money and does not iterate the uncapped money-session map', () => {
  const sessions = index.aggregates.bySession, originalIterator = sessions[Symbol.iterator];
  let iterations = 0;
  sessions[Symbol.iterator] = function() { iterations++; return originalIterator.call(this); };
  try {
    assert.equal(claudeUsageDashboardSnapshot(index, { now }).achievementMoney, undefined);
    assert.equal(iterations, 0);
  } finally { sessions[Symbol.iterator] = originalIterator; }
});

async function hostOwner(run: (host: any, file: string, messages: any[]) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-money-accepted-'));
  const originalLoad = (Module as any)._load;
  const state = new Map<string, unknown>();
  (Module as any)._load = function(request: string, parent: unknown, main: boolean) {
    return request === 'vscode' ? { workspace: { workspaceFolders: [] },
      Uri: { file: (fsPath: string) => ({ fsPath }) } } : originalLoad.call(this, request, parent, main);
  };
  let host: any;
  try {
    const { UsageWebviewProvider } = require('../webview');
    host = new UsageWebviewProvider({ globalStorageUri: { fsPath: directory }, globalState: {
      get: (key: string) => state.get(key), update: async (key: string, value: unknown) => {
        if (value === undefined) state.delete(key); else state.set(key, value);
      },
    } });
    await host.achievementWrite;
    host.settings = { get: (key: string) => ['enableAchievements', 'showAchievementNotices', 'enableShareCard'].includes(key) };
    host.providerAvailability = { claude: true, codex: false, codexData: false };
    const messages: any[] = [];
    host.panel = { visible: false, webview: { postMessage: async (message: unknown) => { messages.push(message); return true; } } };
    host.updateWebview = () => assert.fail('accepted hidden snapshot must not repaint the dashboard');
    await run(host, path.join(directory, ACHIEVEMENT_RECORD_FILE), messages);
  } finally {
    if (host) await Promise.all([host.achievementWrite, host.achievementCalendarWrite, host.achievementHourWrite,
      host.achievementActivityWrite, host.achievementNoticeWrite]);
    (Module as any)._load = originalLoad;
    await rm(directory, { recursive: true, force: true });
  }
}

test('money handoff: actual non-rendering accepted Claude snapshot carries money and persists quiet frozen history while hidden', async () => {
  await hostOwner(async (host, file, messages) => {
    const dashboard = claudeUsageDashboardSnapshot(index, { now, achievementMoneyBackend: 'anthropic' });
    const observation = await host.beginClaudeAchievementObservation(() => true);
    assert.ok(observation);
    const accepted = { allTime: dashboard.allTime, days: dashboard.dailyForAllTime,
      sessions: dashboard.sessions, sessionEvidence: dashboard.achievementSessionEvidence,
      records: [], timeZone: 'UTC', money: dashboard.achievementMoney };
    host.acceptClaudeAchievementSnapshot(accepted, observation);
    await host.achievementWrite;
    assert.equal(host.acceptedClaudeAchievement, accepted);
    assert.equal(host.achievementMoneyFacts.claude, dashboard.achievementMoney);
    assert.equal(host.allTimeData, null, 'the hidden dashboard does not need a display update to admit money proof');
    const saved = await loadAchievementRecords(file);
    assert.ok(saved);
    for (const id of ['claude-api-total-silver', 'claude-api-week-silver', 'claude-api-session-gold']) {
      const row: AchievementRecord | undefined = saved.records.find(candidate => candidate.id === id);
      assert.ok(row, id); assert.equal(row.referencePricebook, dashboard.achievementMoney!.pricebookVersion);
      assert.equal(row.origin, 'history'); assert.equal(row.unread, false);
      assert.equal(row.recordedDay, null); assert.equal(row.timeZone, null);
    }
    assert.ok(!messages.some(row => row.command === 'achievementUnlockNotice'));
    host.invalidateAchievementEvidence('claude');
    assert.equal(host.acceptedClaudeAchievement, undefined);
    assert.ok(host.achievementResults().filter((row: any) => /^claude-api-/.test(row.id))
      .every((row: any) => row.unlocked === false));
  });
});

test('money handoff: retired producer guard cannot admit a real otherwise-qualifying money snapshot', async () => {
  await hostOwner(async (host, file) => {
    let current = true;
    const observation = await host.beginClaudeAchievementObservation(() => current);
    const dashboard = claudeUsageDashboardSnapshot(index, { now, achievementMoneyBackend: 'anthropic' });
    current = false;
    host.acceptClaudeAchievementSnapshot({ allTime: dashboard.allTime, days: dashboard.dailyForAllTime,
      sessions: dashboard.sessions, sessionEvidence: dashboard.achievementSessionEvidence,
      records: [], timeZone: 'UTC', money: dashboard.achievementMoney }, observation);
    await host.achievementWrite;
    assert.equal(host.acceptedClaudeAchievement, undefined);
    assert.equal((await loadAchievementRecords(file))?.records.some(row => /^claude-api-/.test(row.id)), false);
  });
});

test('money handoff: accepted priced append replaces money proof, preserves old DTO, and the next real warm refresh reuses the new proof', async () => {
  const options = { now, achievementMoneyBackend: 'anthropic' as const };
  const oldSnapshot = claudeUsageDashboardSnapshot(index, options);
  const oldMoney = oldSnapshot.achievementMoney;
  assert.ok(oldMoney);
  const oldBytes = JSON.stringify(oldMoney);
  const giant = path.join(root, 'projects', '-isolated-fixture', 'session-1000.jsonl');
  const record = JSON.parse(line('priced-tail', 25_000_000, '2026-09-29T12:00:00.000Z'));
  record.message.usage.cache_creation = { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 };
  const tail = JSON.stringify(record) + '\n';
  await appendFile(giant, tail, 'utf8');
  const updated = await updateClaudeUsageIndex(index, root, { analyzeContent: false });
  assert.equal(updated.diagnostics.filesFailed, 0);
  assert.equal(updated.diagnostics.changed.append, 1);
  assert.equal(updated.diagnostics.bodyReads, 1);
  assert.equal(updated.diagnostics.bytesRead, Buffer.byteLength(tail));
  assert.ok(updated.diagnostics.aggregateMutations > 0, 'the parser must actually commit the new record');
  const dashboard = claudeUsageDashboardSnapshot(updated.index, options);
  const freshMoney = dashboard.achievementMoney;
  assert.ok(freshMoney);
  assert.equal(freshMoney === oldMoney, false, 'a canonical usage mutation cannot inherit the old money DTO');
  assert.equal(freshMoney.cumulative?.status, 'complete');
  assert.equal(freshMoney.cumulative?.microUsd, 1_100_004_000);
  assert.equal(freshMoney.cumulative?.totalTokens, 275_001_000);
  assert.equal(freshMoney.maxSessionTask, 1_100_000_000);
  assert.equal(freshMoney.completedMondayWeekPeak, 1_100_000_000);
  assert.equal(freshMoney.pricebookVersion, oldMoney.pricebookVersion);
  assert.equal(dashboard.sessions.length, 1000);
  assert.ok(!dashboard.sessions.some(row => row.sessionId === 'session-1000'),
    'the increased peak is still outside the displayed Sessions cap');
  assert.equal(JSON.stringify(oldMoney), oldBytes, 'the already accepted DTO remains immutable');
  assert.equal(index.aggregates.allTime.totalInputTokens, 250_001_000,
    'the committed old index is not retroactively mutated');

  const warm = await updateClaudeUsageIndex(updated.index, root, { analyzeContent: false });
  assert.equal(warm.diagnostics.filesFailed, 0);
  assert.equal(warm.diagnostics.bodyReads, 0);
  assert.equal(warm.diagnostics.bytesRead, 0);
  assert.equal(warm.diagnostics.aggregateMutations, 0);
  const sessions = warm.index.aggregates.bySession, originalIterator = sessions[Symbol.iterator];
  let iterations = 0;
  sessions[Symbol.iterator] = function() { iterations++; return originalIterator.call(this); };
  try {
    const repeated = claudeUsageDashboardSnapshot(warm.index, options);
    assert.equal(repeated.achievementMoney === freshMoney, true,
      'the first unchanged refresh after growth reuses the freshly accepted money DTO');
    assert.equal(iterations, 0, 'the post-append warm projection must not iterate the 1001-session map');
    assert.equal(JSON.stringify(oldMoney), oldBytes);
  } finally { sessions[Symbol.iterator] = originalIterator; }
});

test('money handoff: a TTL-proof rewrite with equal primary counters invalidates cached reference eligibility', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-money-ttl-rewrite-'));
  try {
    const project = path.join(directory, 'projects', '-ttl-fixture');
    await mkdir(project, { recursive: true });
    const file = path.join(project, 'ttl-session.jsonl');
    const record = JSON.parse(line('ttl-rewrite', 25_000_000, '2026-09-28T12:00:00.000Z'));
    record.message.usage.cache_creation_input_tokens = 100;
    await writeFile(file, JSON.stringify(record) + '\n', 'utf8');
    const baseline = await updateClaudeUsageIndex(createClaudeUsageIndex(), directory, { analyzeContent: false });
    assert.equal(baseline.diagnostics.filesFailed, 0);
    const options = { now, achievementMoneyBackend: 'anthropic' as const };
    const oldMoney = claudeUsageDashboardSnapshot(baseline.index, options).achievementMoney;
    assert.ok(oldMoney);
    assert.equal(oldMoney.cumulative?.status, 'unpriced');
    assert.equal(oldMoney.cumulative?.microUsd, null);
    const oldBytes = JSON.stringify(oldMoney);
    record.message.usage.cache_creation = { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 0 };
    await writeFile(file, JSON.stringify(record) + '\n', 'utf8');
    const rewritten = await updateClaudeUsageIndex(baseline.index, directory, { analyzeContent: false });
    assert.equal(rewritten.diagnostics.filesFailed, 0);
    assert.equal(rewritten.diagnostics.changed.rebuild, 1);
    assert.equal(rewritten.diagnostics.bodyReads, 1);
    assert.ok(rewritten.diagnostics.aggregateMutations > 0);
    for (const field of ['totalInputTokens', 'totalOutputTokens', 'totalCacheReadTokens', 'totalCacheCreationTokens'] as const)
      assert.equal(rewritten.index.aggregates.allTime[field], baseline.index.aggregates.allTime[field], field);
    const freshMoney = claudeUsageDashboardSnapshot(rewritten.index, options).achievementMoney;
    assert.ok(freshMoney);
    assert.equal(freshMoney === oldMoney, false, 'equal primary counts cannot conceal a changed TTL admission subset');
    assert.equal(freshMoney.cumulative?.totalTokens, oldMoney.cumulative?.totalTokens);
    assert.equal(freshMoney.cumulative?.status, 'complete');
    assert.equal(freshMoney.cumulative?.pricingCoverage, 1);
    assert.equal(freshMoney.cumulative?.microUsd, 100_000_500);
    assert.equal(freshMoney.maxSessionTask, 100_000_500);
    assert.equal(freshMoney.completedMondayWeekPeak, 100_000_500);
    assert.equal(JSON.stringify(oldMoney), oldBytes);
    const warm = await updateClaudeUsageIndex(rewritten.index, directory, { analyzeContent: false });
    assert.equal(warm.diagnostics.bodyReads, 0);
    assert.equal(warm.diagnostics.aggregateMutations, 0);
    assert.equal(claudeUsageDashboardSnapshot(warm.index, options).achievementMoney === freshMoney, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
