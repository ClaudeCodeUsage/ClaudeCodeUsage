import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { codexModelSignals } from '../achievements';
import { codexAchievementTokenEvidence } from '../achievementCalendar';
import { verifiedCodexAchievementFiles } from '../codexAchievementProof';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';
import { ACHIEVEMENT_RECORD_FILE, loadAchievementRecords } from '../achievementRecordStore';
import { mkdtemp, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { I18n } from '../i18n';

function file(key: string, input = 600_000_000, output = 6_000_000): CodexFileAggregate {
  const tokens = { inputTotal: input, cachedInput: input, outputTotal: output, reasoningOutput: output };
  return { session: { sessionKey: key, role: 'root' }, total: tokens,
    byModel: { 'gpt-6.1-astra': tokens }, byEffort: { max: tokens }, byDay: {}, structural: {} as any };
}

function corpus(): CodexFileAggregate[] {
  const child = file('ambiguous-child');
  child.session = { sessionKey: 'ambiguous-child', parentSessionKey: 'conflict', role: 'subagent' };
  return [file('safe'), file('conflict', 1), file('conflict', 2), child];
}

test('a conflicting branch cannot erase independently verified output/cache milestone proof', () => {
  const proof = codexAchievementTokenEvidence(corpus(), true);
  assert.equal(proof.complete, true);
  assert.equal(proof.output, 6_000_000);
  assert.equal(proof.cachedInput, 600_000_000);
  assert.equal((proof as any).lowerBound, true);
  assert.equal(codexAchievementTokenEvidence(corpus(), false).complete, false,
    'incomplete index may still discover conflicts; do not grant early');
});

test('a malformed model vector or unsafe subset counter is excluded from both family and total proof', () => {
  for (const mutate of [
    (row: CodexFileAggregate) => { row.total.cachedInput = row.total.inputTotal + 1; },
    (row: CodexFileAggregate) => { row.byModel['gpt-6.1-astra'].cachedInput = row.total.inputTotal + 1; },
    (row: CodexFileAggregate) => { row.total.reasoningOutput = row.total.outputTotal + 1; },
  ]) {
    const bad = file('bad');
    mutate(bad);
    assert.equal(codexModelSignals([bad]).familyProcessedTokens?.astra, 0);
    assert.equal(codexAchievementTokenEvidence([bad], true).complete, false);
  }
});

test('unknown roles, root-with-parent, missing parents and cycles block only their lineages', () => {
  const safe = file('safe');
  for (const rows of [
    [file('unknown')].map(row => ({ ...row, session: { sessionKey: 'unknown', role: 'unknown' } })),
    [file('bad-root')].map(row => ({ ...row, session: { sessionKey: 'bad-root', role: 'root', parentSessionKey: 'safe' } })),
    [file('orphan')].map(row => ({ ...row, session: { sessionKey: 'orphan', role: 'subagent', parentSessionKey: 'absent' } })),
    [file('cycle-a'), file('cycle-b')].map((row, index) => ({ ...row,
      session: { sessionKey: 'cycle-' + (index ? 'b' : 'a'), role: 'subagent', parentSessionKey: 'cycle-' + (index ? 'a' : 'b') } })),
  ]) {
    const invalid = rows as CodexFileAggregate[];
    const child = file('bad-child');
    child.session = { sessionKey: 'bad-child', role: 'subagent', parentSessionKey: invalid[0].session.sessionKey };
    for (const input of [[safe, ...invalid, child], [child, ...invalid, safe]]) {
      assert.deepEqual(verifiedCodexAchievementFiles(input).map(row => row.session.sessionKey), ['safe']);
      assert.equal(codexModelSignals(input).familyProcessedTokens?.astra, 606_000_000);
      assert.equal(codexAchievementTokenEvidence(input, true).output, 6_000_000);
    }
  }
});

test('verified subset selection is non-recursive for large inherited trees and never mutates inputs', () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => {
    const row = file('session-' + index, 1, 1);
    if (index) row.session = { sessionKey: 'session-' + index, role: 'subagent', parentSessionKey: 'session-' + (index - 1) };
    return row;
  }).reverse();
  const before = JSON.stringify(rows);
  assert.equal(verifiedCodexAchievementFiles(rows).length, 10_000);
  assert.equal(JSON.stringify(rows), before);
  rows.push(file('session-0', 2, 2));
  assert.equal(verifiedCodexAchievementFiles(rows).length, 0, 'a conflicting root withholds the entire descendant tree');
});

test('model signals reuse ancestry proof instead of walking every deep parent chain again', () => {
  const size = 10_000;
  let parentReads = 0;
  const rows = Array.from({ length: size }, (_, index) => {
    const row = file('session-' + index, 1, 1);
    row.session.role = index ? 'subagent' : 'root';
    Object.defineProperty(row.session, 'parentSessionKey', { enumerable: true, get: () => {
      assert.ok(++parentReads < size * 40, 'ancestry traversal must stay linear in the file count');
      return index ? 'session-' + (index - 1) : undefined;
    } });
    return row;
  }).reverse();
  const signals = codexModelSignals(rows);
  assert.equal(signals.verifiedRootCount, 1);
  assert.equal(signals.verifiedChildCount, size - 1);
  assert.equal(signals.familyProcessedTokens?.astra, size * 2);
});

test('production gallery grants safe Codex milestones despite unrelated identity ambiguity, not calendar claims', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-subset-canonical-'));
  const zone = I18n.getTimezone();
  const load = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, main: boolean) {
    return request === 'vscode' ? { workspace: { workspaceFolders: [] } } : load.call(this, request, parent, main);
  };
  try {
    I18n.setTimezone('UTC');
    const { UsageWebviewProvider } = require('../webview');
    const state = new Map<string, unknown>();
    const provider = new UsageWebviewProvider({ globalStorageUri: { fsPath: directory }, globalState: {
      get: (key: string) => state.get(key), update: async (key: string, value: unknown) => state.set(key, value),
    } }) as any;
    await provider.achievementWrite;
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    assert.equal(provider.ensureAchievementRecords(), false);
    await provider.achievementWrite;
    assert.equal(provider.achievementRecordState.schemaVersion, 2);
    const notices: any[] = [];
    provider.panel = { visible: true, active: true, webview: { postMessage: async (message: any) => {
      if (message.command === 'achievementUnlockNotice') notices.push(message);
      return true;
    } } };
    provider.webviewClientReady = true;
    provider.setAchievementWindowFocused(true);
    // Each extra root contributes output in the same max bucket; the large
    // safe root alone cannot prove the new five-task effort requirement.
    const initial = [...corpus(), ...Array.from({ length: 4 }, (_, index) => file(`effort-${index}`, 20_000_000, 20_000))];
    provider.codexAchievementSignals = codexModelSignals(initial);
    provider.codexAchievementSignals.tokenEvidence = codexAchievementTokenEvidence(initial, true);
    provider.codexView = {
      currentManifestVerified: true, coverage: { complete: true, identity: { complete: false } },
      allTime: { total: { processed: 2_000_000_000 } }, allTimeDaily: [],
      periodCoverage: { timeZone: 'UTC', allTime: { complete: true } },
      hourlyCoverage: { complete: false, timeZone: 'UTC' }, last30DaysHourlyByDay: {},
      outputHourProof: { complete: false, hours: [] },
    };
    const baseline = await provider.beginCodexAchievementObservation(() => true);
    provider.acceptCodexAchievementSnapshot(provider.codexView, provider.codexAchievementSignals, baseline);
    await provider.achievementWrite;
    const read = () => new Map<string, any>(provider.achievementResults().map((row: any) => [row.id, row]));
    assert.equal(read().get('astra-regular').unlocked, true);
    assert.equal(read().get('astra-regular-silver').unlocked, false);
    assert.equal(read().get('codex-output-bronze').unlocked, true);
    assert.equal(read().get('effort-explorer').progress, 1);
    for (const id of ['astra-days-bronze', 'weekly-volume-bronze', 'weekly-average-bronze']) {
      assert.equal(read().get(id).unlocked, false, id);
    }
    await provider.achievementWrite;
    const canonicalFile = path.join(directory, ACHIEVEMENT_RECORD_FILE);
    const saved = (await loadAchievementRecords(canonicalFile))!;
    assert.equal(saved.schemaVersion, 2);
    assert.ok(saved.records.some(row => row.id === 'astra-regular'));
    assert.ok(!(state.get('ccu.achievements.grants.v5') as string[]).includes('astra-regular'),
      'canonical grants are not promoted back into legacy Memento storage');
    assert.equal(notices.length, 0, 'first observed subset history is quiet');
    const observation = await provider.beginCodexAchievementObservation(() => true);
    assert.ok(observation.window, 'live producer observation follows the accepted history baseline');
    const increased = initial.slice();
    increased[0] = file('safe', 6_000_000_000);
    provider.codexAchievementSignals = codexModelSignals(increased);
    provider.codexAchievementSignals.tokenEvidence = codexAchievementTokenEvidence(increased, true);
    provider.codexView = { ...provider.codexView, allTime: { total: { processed: 8_000_000_000 } } };
    provider.acceptCodexAchievementSnapshot(provider.codexView, provider.codexAchievementSignals, observation,
      { ...observation.window, provider: 'codex', processed: 5_400_000_000, output: 0, cacheRead: 5_400_000_000,
        families: { astra: 5_400_000_000, sol: 0, luna: 0 } });
    assert.equal(read().get('astra-regular-silver').unlocked, true);
    await provider.achievementWrite;
    await provider.achievementNoticeWrite;
    assert.equal(notices.length, 1, 'independent model growth is not silenced by unrelated date/identity ambiguity');
    const silver = (await loadAchievementRecords(canonicalFile))!.records.find(row => row.id === 'astra-regular-silver')!;
    assert.equal(silver.origin, 'usage');
    assert.equal(silver.unread, true);
    assert.match(silver.recordedDay!, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(silver.timeZone, 'UTC');
    assert.equal(read().get('weekly-volume-bronze').unlocked, false);
    provider.invalidateAchievementEvidence('codex');
    assert.equal(read().get('astra-regular').progress, 0, 'failed refresh revokes new authority');
    assert.equal(provider.achievementGrants.has('astra-regular'), true, 'durable awards survive');
    provider.revokedAchievementEvidence.clear();
    provider.codexView.coverage.complete = false;
    assert.equal(read().get('astra-regular').progress, 0);
    provider.codexView.coverage.complete = true;
    provider.codexView.currentManifestVerified = false;
    assert.equal(read().get('astra-regular').progress, 0);
  } finally {
    I18n.setTimezone(zone);
    (Module as any)._load = load;
    await rm(directory, { recursive: true, force: true });
  }
});
