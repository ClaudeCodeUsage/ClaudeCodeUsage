import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import Module = require('node:module');
import { AchievementRecordRepository, loadAchievementRecords } from '../achievementRecordStore';
import { codexModelSignals } from '../achievements';
import { codexAchievementTokenEvidence } from '../achievementCalendar';
import { I18n } from '../i18n';

async function owner(run: (host: any, file: string, enable: (value: boolean) => void,
  showNotices: (value: boolean) => void) => Promise<void>): Promise<void> {
  const load = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, main: boolean) {
    return request === 'vscode' ? { workspace: { workspaceFolders: [] }, Uri: { file: (fsPath: string) => ({ fsPath }) } }
      : load.call(this, request, parent, main);
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-usage-handoff-'));
  const zone = I18n.getTimezone();
  try {
    I18n.setTimezone('UTC');
    const { UsageWebviewProvider } = require('../webview');
    const file = path.join(directory, 'achievements-v1.json');
    const host = new UsageWebviewProvider({ globalState: { get: () => undefined, update: async () => undefined } }) as any;
    await host.achievementWrite;
    host.achievementRecordRepository = new AchievementRecordRepository(file);
    host.achievementRecordState = await host.achievementRecordRepository.initialize([]);
    let enabled = true;
    let notices = true;
    host.settings = { get: (key: string) => key === 'enableAchievements' ? enabled
      : key === 'showAchievementNotices' ? notices : false };
    host.providerAvailability = { claude: false, codex: true, codexData: true };
    host.updateWebview = () => assert.fail('non-rendering handoff must not paint a paused dashboard');
    await run(host, file, value => { enabled = value; }, value => { notices = value; });
    await host.achievementWrite;
    await host.achievementHourWrite;
    await host.achievementCalendarWrite;
  } finally { I18n.setTimezone(zone); (Module as any)._load = load; await rm(directory, { recursive: true, force: true }); }
}
function snapshot(processed: number): { view: any; signals: any } {
  const total = { inputTotal: processed - 100_000_000, cachedInput: 0, outputTotal: 100_000_000 };
  const files: any[] = [{ session: { sessionKey: 'safe', role: 'root' }, total,
    byModel: { 'gpt-6.1-astra': total }, byEffort: { max: total }, byDay: {}, structural: {} },
    ...[1, 2].map(inputTotal => ({ session: { sessionKey: 'conflict', role: 'root' },
      total: { inputTotal, cachedInput: 0, outputTotal: 0 },
      byModel: { 'gpt-6.1-astra': { inputTotal, cachedInput: 0, outputTotal: 0 } },
      byEffort: {}, byDay: {}, structural: {} }))];
  const signals = codexModelSignals(files);
  signals.tokenEvidence = codexAchievementTokenEvidence(files, true);
  const view = { currentManifestVerified: true, coverage: { complete: true, identity: { complete: false } },
    allTime: { total: { processed: processed + 3 } }, allTimeDaily: [],
    periodCoverage: { timeZone: 'UTC', allTime: { complete: false }, last30Days: { complete: false } },
    hourlyCoverage: { complete: false, timeZone: 'UTC' }, last30DaysHourlyByDay: {},
    outputHourProof: { complete: false, hours: [], backfillableFiles: 1 } };
  return { view, signals };
}
async function accept(host: any, processed: number, delta = false): Promise<void> {
  const observation = await host.beginCodexAchievementObservation(() => true);
  const next = snapshot(processed);
  host.acceptCodexAchievementSnapshot(next.view, next.signals, observation,
    delta && observation?.window ? { ...observation.window, provider: 'codex',
      processed: 6_000_000_000, output: 0, cacheRead: 0, families: { astra: 6_000_000_000, sol: 0, luna: 0 } } : undefined);
  await host.achievementWrite;
}

test('paused/hidden Codex handoff saves real silver growth as dated unread usage beside ambiguity', async () => {
  await owner(async (host, file) => {
    const oldDisplay = snapshot(10_000_000).view;
    host.codexView = oldDisplay;
    await accept(host, 600_000_000);
    const baseline = await loadAchievementRecords(file);
    assert.equal(baseline?.records.find(row => row.id === 'astra-regular')?.origin, 'history');
    await accept(host, 6_600_000_000, true);
    const saved = await loadAchievementRecords(file);
    const silver = saved?.records.find(row => row.id === 'astra-regular-silver');
    assert.equal(silver?.origin, 'usage');
    assert.equal(silver?.unread, true);
    assert.match(silver?.recordedDay ?? '', /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(silver?.timeZone, 'UTC');
    assert.equal(host.codexView, oldDisplay, 'display stays paused');
    assert.equal(saved?.records.some(row => row.id === 'weekly-volume-bronze'), false);
    await accept(host, 6_600_000_000, true);
    assert.equal((await loadAchievementRecords(file))?.sequence, saved?.sequence, 'same total cannot replay a crossing');
  });
});

test('late peer history cannot steal silver provenance; existing history is never promoted without proof', async () => {
  await owner(async (host, file) => {
    await accept(host, 600_000_000);
    const observation = await host.beginCodexAchievementObservation(() => true);
    const peer = new AchievementRecordRepository(file);
    await peer.append(host.achievementRecordState.generation,
      [{ id: 'astra-regular-silver', origin: 'history', recordedDay: null, timeZone: null }]);
    const next = snapshot(6_600_000_000);
    host.acceptCodexAchievementSnapshot(next.view, next.signals, observation, { ...observation.window,
      provider: 'codex', processed: 6_000_000_000, output: 0, cacheRead: 0,
      families: { astra: 6_000_000_000, sol: 0, luna: 0 } });
    await host.achievementWrite;
    assert.equal((await loadAchievementRecords(file))?.records.find(row => row.id === 'astra-regular-silver')?.origin, 'usage');
  });
  await owner(async (host, file) => {
    await accept(host, 600_000_000);
    await accept(host, 6_600_000_000);
    assert.equal((await loadAchievementRecords(file))?.records.find(row => row.id === 'astra-regular-silver')?.origin, 'history');
  });
});

test('OFF, revocation and retired source observations cannot authorize usage or write optimistically', async () => {
  for (const retire of ['off', 'failure', 'source'] as const) await owner(async (host, file, enable) => {
    await accept(host, 600_000_000);
    let current = true;
    const observation = await host.beginCodexAchievementObservation(() => current);
    if (retire === 'off') enable(false);
    else if (retire === 'failure') host.invalidateAchievementEvidence('codex');
    else current = false;
    const next = snapshot(6_600_000_000);
    host.acceptCodexAchievementSnapshot(next.view, next.signals, observation,
      { ...observation.window, provider: 'codex', processed: 6_000_000_000, output: 0, cacheRead: 0,
        families: { astra: 6_000_000_000, sol: 0, luna: 0 } });
    await host.achievementWrite;
    assert.equal((await loadAchievementRecords(file))?.records.some(row => row.id === 'astra-regular-silver'), false, retire);
  });
});

test('verified live Codex crossing can issue a foreground notice without repaint or optimistic read', async () => {
  await owner(async (host, file) => {
    const notices: any[] = [];
    host.panel = { visible: true, webview: { postMessage: async (message: any) => {
      if (message.command === 'achievementUnlockNotice') notices.push(message); return true;
    } } };
    host.webviewClientReady = true;
    host.setAchievementWindowFocused(true);
    await accept(host, 600_000_000);
    await host.achievementNoticeWrite;
    assert.equal(notices.length, 0, 'cold history never notifies');
    await accept(host, 6_600_000_000, true);
    await host.achievementNoticeWrite;
    assert.equal(notices.length, 1);
    assert.ok(host.achievementNoticeInFlight.ids.includes('astra-regular-silver'));
    assert.equal((await loadAchievementRecords(file))?.records.find(row => row.id === 'astra-regular-silver')?.unread, true);
  });
});

test('usage save failure retains bounded proof for a later ordinary refresh, not optimistic unread', async () => {
  await owner(async (host, file) => {
    await accept(host, 600_000_000);
    const repository = host.achievementRecordRepository;
    const save = repository.recordUsage.bind(repository);
    repository.recordUsage = async () => { throw new Error('synthetic write failure'); };
    await accept(host, 6_600_000_000, true);
    const before = await loadAchievementRecords(file);
    assert.equal(before?.records.some(row => row.origin === 'usage' && row.unread), false);
    assert.ok(host.usageAchievementReceipts.has('astra-regular-silver'));
    repository.recordUsage = save;
    await accept(host, 6_600_000_000);
    assert.equal((await loadAchievementRecords(file))?.records.find(row => row.id === 'astra-regular-silver')?.origin, 'usage');
    assert.equal(host.usageAchievementReceipts.size, 0);
  });
});

test('OFF→ON, timezone retirement, forged windows, incomplete/recovered sources and clear stay quiet', async () => {
  for (const mode of ['off-on', 'timezone', 'forged', 'incomplete', 'recover', 'clear'] as const) {
    await owner(async (host, file, enable) => {
      await accept(host, 600_000_000);
      const observation = await host.beginCodexAchievementObservation(() => true);
      const next = snapshot(6_600_000_000);
      let delta = { ...observation.window, provider: 'codex', processed: 6_000_000_000, output: 0, cacheRead: 0,
        families: { astra: 6_000_000_000, sol: 0, luna: 0 } };
      if (mode === 'off-on') { enable(false); host.retireAchievementUsageObservations(); enable(true); }
      if (mode === 'timezone') I18n.setTimezone('Asia/Shanghai');
      if (mode === 'forged') delta.through++;
      if (mode === 'incomplete') next.view.coverage.complete = false;
      if (mode === 'recover') host.invalidateAchievementEvidence('codex');
      if (mode === 'clear') await host.clearAchievementGrants();
      host.acceptCodexAchievementSnapshot(next.view, next.signals, observation, delta);
      await host.achievementWrite;
      assert.equal((await loadAchievementRecords(file))?.records.some(row => row.origin === 'usage'), false, mode);
    });
  }
});

test('disabled/source-absent Codex cannot remain authoritative through accepted non-rendering references', async () => {
  await owner(async host => {
    await accept(host, 6_600_000_000);
    host.updateProviderData(null, {}, { claude: false, codex: false, codexData: false });
    assert.equal(host.codexAchievementVolume().processed, 0);
    assert.equal(host.acceptedCodexAchievement, undefined);
  });
});

test('unrelated Claude failure cannot erase an independently proven Codex crossing', async () => {
  await owner(async (host, file) => {
    await accept(host, 600_000_000);
    const observation = await host.beginCodexAchievementObservation(() => true);
    host.invalidateAchievementEvidence('claude');
    const next = snapshot(6_600_000_000);
    host.acceptCodexAchievementSnapshot(next.view, next.signals, observation, { ...observation.window,
      provider: 'codex', processed: 6_000_000_000, output: 0, cacheRead: 0,
      families: { astra: 6_000_000_000, sol: 0, luna: 0 } });
    await host.achievementWrite;
    assert.equal((await loadAchievementRecords(file))?.records.find(row => row.id === 'astra-regular-silver')?.origin, 'usage');
  });
});

test('retired failed-save proof releases its source guard instead of blocking a later receipt', async () => {
  await owner(async (host, file) => {
    await accept(host, 600_000_000);
    const repository = host.achievementRecordRepository;
    const save = repository.recordUsage.bind(repository);
    repository.recordUsage = async () => { throw new Error('synthetic write failure'); };
    let current = true;
    const observation = await host.beginCodexAchievementObservation(() => current);
    const next = snapshot(6_600_000_000);
    host.acceptCodexAchievementSnapshot(next.view, next.signals, observation, { ...observation.window,
      provider: 'codex', processed: 6_000_000_000, output: 0, cacheRead: 0,
      families: { astra: 6_000_000_000, sol: 0, luna: 0 } });
    await host.achievementWrite;
    assert.ok(host.usageAchievementReceipts.size > 0);
    current = false;
    repository.recordUsage = save;
    host.queueUsageAchievementReceipts();
    await host.achievementWrite;
    assert.equal(host.usageAchievementReceipts.size, 0);
    assert.equal(host.queuedUsageAchievementIds.size, 0);
    assert.equal((await loadAchievementRecords(file))?.records.some(row => row.origin === 'usage'), false);
  });
});

test('timezone change after accepted proof cancels a queued award before saving', async () => {
  await owner(async (host, file) => {
    await accept(host, 600_000_000);
    const observation = await host.beginCodexAchievementObservation(() => true);
    const next = snapshot(6_600_000_000);
    host.acceptCodexAchievementSnapshot(next.view, next.signals, observation, { ...observation.window,
      provider: 'codex', processed: 6_000_000_000, output: 0, cacheRead: 0,
      families: { astra: 6_000_000_000, sol: 0, luna: 0 } });
    I18n.setTimezone('Asia/Shanghai');
    await host.achievementWrite;
    assert.equal((await loadAchievementRecords(file))?.records.some(row => row.origin === 'usage'), false);
    assert.equal(host.usageAchievementReceipts.size, 0);
  });
});

test('canonical history predating an observation stays historical despite a peer-stale local cache', async () => {
  await owner(async (host, file) => {
    await accept(host, 600_000_000);
    const peer = new AchievementRecordRepository(file);
    await peer.append(host.achievementRecordState.generation,
      [{ id: 'astra-regular-silver', origin: 'history', recordedDay: null, timeZone: null }]);
    await accept(host, 6_600_000_000, true);
    const silver = (await loadAchievementRecords(file))?.records.find(row => row.id === 'astra-regular-silver');
    assert.equal(silver?.origin, 'history');
    assert.equal(silver?.unread, false);
    assert.equal(silver?.recordedDay, null);
  });
});

test('notice opt-out preserves real usage awards and unread state without replay on opt-in', async () => {
  await owner(async (host, file, _enable, showNotices) => {
    const notices: any[] = [];
    host.panel = { visible: true, webview: { postMessage: async (message: any) => {
      notices.push(message); return true;
    } } };
    host.webviewClientReady = true; host.setAchievementWindowFocused(true);
    showNotices(false);
    await accept(host, 600_000_000);
    await accept(host, 6_600_000_000, true);
    await host.achievementNoticeWrite;
    assert.equal(notices.some(row => row.command === 'achievementUnlockNotice'), false);
    const saved = await loadAchievementRecords(file);
    assert.equal(saved?.records.find(row => row.id === 'astra-regular-silver')?.unread, true);
    assert.equal(saved?.lastNoticeAt, 0);
    showNotices(true);
    await accept(host, 6_600_000_000);
    await host.achievementNoticeWrite;
    assert.equal(notices.some(row => row.command === 'achievementUnlockNotice'), false);
  });
});

test('turning notices off dismisses an issued notice and refuses its old ACK after re-enable', async () => {
  await owner(async (host, file, _enable, showNotices) => {
    const notices: any[] = [];
    host.panel = { visible: true, webview: { postMessage: async (message: any) => { notices.push(message); return true; } } };
    host.webviewClientReady = true; host.setAchievementWindowFocused(true);
    await accept(host, 600_000_000); await accept(host, 6_600_000_000, true);
    await host.achievementNoticeWrite;
    const token = host.achievementNoticeInFlight.id;
    showNotices(false); host.retireAchievementNotices(); showNotices(true);
    await host.acknowledgeAchievementNotice(token);
    assert.equal(notices[notices.length - 1].command, 'achievementNoticeDismiss');
    assert.equal(host.achievementNoticeInFlight, undefined);
    assert.equal((await loadAchievementRecords(file))?.records.find(row => row.id === 'astra-regular-silver')?.unread, true);
  });
});

test('notice opt-out during queued reservation does not spend cooldown or alter the saved award', async () => {
  await owner(async (host, file, _enable, showNotices) => {
    host.panel = { visible: true, webview: { postMessage: async () => true } };
    host.webviewClientReady = true; host.setAchievementWindowFocused(true);
    await accept(host, 600_000_000);
    const repository = host.achievementRecordRepository;
    const reserve = repository.reserveNotice.bind(repository);
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { entered = resolve; });
    repository.reserveNotice = async (...args: any[]) => { entered(); await waiting; return reserve(...args); };
    await accept(host, 6_600_000_000, true);
    await reached;
    showNotices(false); host.retireAchievementNotices(); showNotices(true);
    release(); await host.achievementNoticeWrite;
    const saved = await loadAchievementRecords(file);
    assert.equal(saved?.lastNoticeAt, 0);
    assert.equal(saved?.records.find(row => row.id === 'astra-regular-silver')?.unread, true);
  });
});
