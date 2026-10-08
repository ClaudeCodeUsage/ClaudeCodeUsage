import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Module = require('node:module');
import { AchievementRecordRepository, loadAchievementRecords } from '../achievementRecordStore';
import { I18n } from '../i18n';

async function owner(run: (host: any, file: string, enable: (value: boolean) => void) => Promise<void>): Promise<void> {
  const load = (Module as any)._load, zone = I18n.getTimezone();
  (Module as any)._load = function(request: string, parent: unknown, main: boolean) {
    return request === 'vscode' ? { workspace: { workspaceFolders: [] }, Uri: { file: (fsPath: string) => ({ fsPath }) } }
      : load.call(this, request, parent, main);
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-claude-handoff-'));
  let host: any;
  try {
    I18n.setTimezone('UTC');
    const { UsageWebviewProvider } = require('../webview');
    const file = path.join(directory, 'achievements-v1.json');
    host = new UsageWebviewProvider({ globalState: { get: () => undefined, update: async () => undefined } });
    await host.achievementWrite;
    host.achievementRecordRepository = new AchievementRecordRepository(file);
    host.achievementRecordState = await host.achievementRecordRepository.initialize([]);
    let enabled = true;
    host.settings = { get: (key: string) => key === 'enableAchievements' ? enabled : false };
    host.providerAvailability = { claude: false, codex: false, codexData: false };
    host.updateWebview = () => assert.fail('accepted Claude proof must not repaint a paused dashboard');
    await run(host, file, value => { enabled = value; });
  } finally {
    await host?.achievementWrite; await host?.achievementHourWrite; await host?.achievementCalendarWrite;
    I18n.setTimezone(zone); (Module as any)._load = load; await rm(directory, { recursive: true, force: true });
  }
}

const models = { sonnet: 'claude-sonnet-5', opus: 'claude-opus-5-5', haiku: 'claude-haiku-5', fable: 'claude-fable-5-1' };
function snapshot(processed: number, family: keyof typeof models = 'sonnet'): any {
  return { allTime: { totalInputTokens: processed - 1_000, totalOutputTokens: 1_000,
    totalCacheCreationTokens: 0, totalCacheReadTokens: 0, totalCost: 0, messageCount: 1,
    modelBreakdown: { [models[family]]: { inputTokens: processed - 1_000, outputTokens: 1_000,
      cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0, messageCount: 1 } } },
    days: [], sessions: [], sessionEvidence: { outputSessions: 1, fableOutputSessions: 0, fableMixedFamilySession: false },
    records: [], timeZone: 'UTC' };
}
function proof(window: any, processed: number, family: keyof typeof models = 'sonnet'): any {
  return { ...window, provider: 'claude', processed, output: 0, cacheRead: 0, cacheCreation: 0,
    families: { sonnet: 0, opus: 0, haiku: 0, fable: 0, [family]: processed } };
}
async function accept(host: any, processed: number, addition = 0, family: keyof typeof models = 'sonnet'): Promise<void> {
  const handle = await host.beginClaudeAchievementObservation(() => true);
  host.acceptClaudeAchievementSnapshot(snapshot(processed, family), handle,
    addition && handle?.window ? proof(handle.window, addition, family) : undefined);
  await host.achievementWrite;
}

for (const [family, id, target] of [
  ['sonnet', 'sonnet-main-silver', 1_000_000_000], ['opus', 'opus-cannon-silver', 1_000_000_000],
  ['haiku', 'haiku-worker-silver', 100_000_000], ['fable', 'fable-volume-silver', 500_000_000],
] as const) test(`accepted ${family} Token crossing remains dated and unread while Claude display is paused`, async () => {
  await owner(async (host, file) => {
    const old = snapshot(10_000).allTime; host.allTimeData = old;
    await accept(host, target / 2, 0, family);
    await accept(host, target * 1.5, target, family);
    const saved = await loadAchievementRecords(file), row = saved?.records.find(value => value.id === id);
    assert.equal(row?.origin, 'usage'); assert.equal(row?.unread, true);
    assert.match(row?.recordedDay ?? '', /^\d{4}-\d{2}-\d{2}$/); assert.equal(row?.timeZone, 'UTC');
    assert.equal(host.allTimeData, old);
    await accept(host, target * 1.5, target, family);
    assert.equal((await loadAchievementRecords(file))?.sequence, saved?.sequence, 'same result must not replay');
  });
});

test('Claude cold/imported growth stays historical, but late peer history cannot steal a proven live crossing', async () => {
  await owner(async (host, file) => {
    await accept(host, 500_000_000);
    const handle = await host.beginClaudeAchievementObservation(() => true);
    await new AchievementRecordRepository(file).append(host.achievementRecordState.generation,
      [{ id: 'sonnet-main-silver', origin: 'history', recordedDay: null, timeZone: null }]);
    host.acceptClaudeAchievementSnapshot(snapshot(1_500_000_000), handle, proof(handle.window, 1_000_000_000));
    await host.achievementWrite;
    assert.equal((await loadAchievementRecords(file))?.records.find(row => row.id === 'sonnet-main-silver')?.origin, 'usage');
  });
  await owner(async (host, file) => {
    await accept(host, 1_500_000_000);
    assert.equal((await loadAchievementRecords(file))?.records.find(row => row.id === 'sonnet-main-silver')?.origin, 'history');
    assert.equal((await loadAchievementRecords(file))?.records.some(row => row.unread), false);
  });
});

test('retired, forged, recovered and switched-zone Claude observations cannot authorize live awards', async () => {
  for (const mode of ['off-on', 'failure', 'source', 'timezone', 'forged', 'clear'] as const) await owner(async (host, file, enable) => {
    await accept(host, 500_000_000);
    let current = true;
    const handle = await host.beginClaudeAchievementObservation(() => current);
    const delta = proof(handle.window, 1_000_000_000);
    if (mode === 'off-on') { enable(false); host.retireAchievementUsageObservations(); enable(true); }
    if (mode === 'failure') host.invalidateAchievementEvidence('claude');
    if (mode === 'source') current = false;
    if (mode === 'timezone') I18n.setTimezone('Asia/Shanghai');
    if (mode === 'forged') delta.through++;
    if (mode === 'clear') await host.clearAchievementGrants();
    host.acceptClaudeAchievementSnapshot(snapshot(1_500_000_000), handle, delta);
    await host.achievementWrite;
    assert.equal((await loadAchievementRecords(file))?.records.some(row => row.origin === 'usage'), false, mode);
  });
});

test('Claude save failure retains bounded proof, while unrelated Codex failure cannot erase it', async () => {
  await owner(async (host, file) => {
    await accept(host, 500_000_000);
    const repository = host.achievementRecordRepository, save = repository.recordUsage.bind(repository);
    repository.recordUsage = async () => { throw new Error('synthetic write failure'); };
    await accept(host, 1_500_000_000, 1_000_000_000);
    assert.equal((await loadAchievementRecords(file))?.records.some(row => row.unread), false);
    assert.ok(host.usageAchievementReceipts.has('sonnet-main-silver'));
    host.invalidateAchievementEvidence('codex');
    repository.recordUsage = save;
    await accept(host, 1_500_000_000);
    assert.equal((await loadAchievementRecords(file))?.records.find(row => row.id === 'sonnet-main-silver')?.origin, 'usage');
    assert.equal(host.usageAchievementReceipts.size, 0);
  });
});

test('clearing Claude source drops accepted references and cannot leave paused totals authoritative', async () => {
  await owner(async host => {
    await accept(host, 1_500_000_000);
    host.clearClaudeSource();
    assert.equal(host.acceptedClaudeAchievement, undefined);
    assert.equal(host.achievementResults().find((row: any) => row.id === 'sonnet-main-silver').progress, 0);
  });
});

test('Claude volume awards use the display zone without requiring calendar evidence in that zone', async () => {
  await owner(async (host, file) => {
    I18n.setTimezone('Asia/Shanghai');
    await accept(host, 500_000_000);
    await accept(host, 1_500_000_000, 1_000_000_000);
    const row = (await loadAchievementRecords(file))?.records.find(value => value.id === 'sonnet-main-silver');
    assert.equal(row?.origin, 'usage'); assert.equal(row?.timeZone, 'Asia/Shanghai');
    assert.equal(row?.unread, true);
    assert.equal(host.acceptedClaudeAchievement.timeZone, 'UTC', 'volume does not relabel calendar evidence');
  });
});

test('Claude queued writes retire on source or timezone change without optimistic unread records', async () => {
  for (const mode of ['source', 'timezone'] as const) await owner(async (host, file) => {
    await accept(host, 500_000_000);
    const repository = host.achievementRecordRepository, save = repository.recordUsage.bind(repository);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    repository.recordUsage = async (...args: any[]) => { entered(); await gate; return save(...args); };
    const handle = await host.beginClaudeAchievementObservation(() => true);
    host.acceptClaudeAchievementSnapshot(snapshot(1_500_000_000), handle, proof(handle.window, 1_000_000_000));
    await started;
    if (mode === 'source') host.invalidateAchievementEvidence('claude');
    else I18n.setTimezone('Asia/Shanghai');
    release(); await host.achievementWrite;
    assert.equal((await loadAchievementRecords(file))?.records.some(row => row.unread), false, mode);
    assert.equal(host.usageAchievementReceipts.size, 0, 'retired queued proof releases source references');
  });
});

for (const [id, target] of [['claude-cache-creation-bronze', 10_000_000],
  ['claude-cache-creation-silver', 100_000_000], ['claude-cache-creation-gold', 1_000_000_000]] as const)
test(`${id} saves only proven native cache creation as dated unread usage`, async () => {
  await owner(async (host, file) => {
    const cacheSnapshot = (volume: number) => {
      const value = snapshot(volume + 1_000);
      value.allTime.totalInputTokens = 0; value.allTime.totalCacheCreationTokens = volume;
      value.allTime.modelBreakdown[models.sonnet].inputTokens = 0;
      value.allTime.modelBreakdown[models.sonnet].cacheCreationTokens = volume;
      return value;
    };
    let handle = await host.beginClaudeAchievementObservation(() => true);
    host.acceptClaudeAchievementSnapshot(cacheSnapshot(target / 2), handle); await host.achievementWrite;
    handle = await host.beginClaudeAchievementObservation(() => true);
    host.acceptClaudeAchievementSnapshot(cacheSnapshot(target * 1.5), handle,
      { ...proof(handle.window, target), cacheCreation: target }); await host.achievementWrite;
    const row = (await loadAchievementRecords(file))?.records.find(value => value.id === id);
    assert.equal(row?.origin, 'usage'); assert.equal(row?.unread, true); assert.equal(row?.timeZone, 'UTC');
  });
});
