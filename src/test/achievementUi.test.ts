import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import Module = require('node:module');
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ACHIEVEMENT_DEFINITIONS, codexModelSignals } from '../achievements';
import { ACHIEVEMENT_RECORD_FILE } from '../achievementRecordStore';
import type { CodexFileAggregate } from '../providers/codex/codexIndex';
import { ACHIEVEMENT_COPY, I18n } from '../i18n';
import { resolveTimeZone } from '../dateKeys';

function withProvider(
  state: Map<string, unknown>,
  run: (provider: any) => Promise<void>,
  update?: (key: string, value: unknown, persist: () => void) => Promise<void>,
  storagePath?: string,
): Promise<void> {
  const originalLoad = (Module as any)._load;
  (Module as any)._load = function(request: string, parent: unknown, isMain: boolean) {
    if (request === 'vscode') return {
      workspace: { workspaceFolders: [] },
      Uri: { file: (filePath: string) => ({ fsPath: filePath }) },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { UsageWebviewProvider } = require('../webview') as typeof import('../webview');
    const provider = new UsageWebviewProvider({
      ...(storagePath ? { globalStorageUri: { fsPath: storagePath } } : {}),
      globalState: {
        get: (key: string) => state.get(key),
        update: async (key: string, value: unknown) => {
          const persist = () => {
            if (value === undefined) state.delete(key); else state.set(key, value);
          };
          if (update) await update(key, value, persist); else persist();
        },
      },
    } as any) as any;
    return run(provider);
  } finally {
    (Module as any)._load = originalLoad;
  }
}

async function withAchievementStorage(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-award-provider-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

const showcaseThemes = ['local-share-export', 'local-advice-feedback', 'settings-explorer',
  'safe-feature-explorer', 'cumulative-volume', 'claude-output', 'sonnet-main'];
const showcaseAwards = ['local-share-export', 'local-advice-feedback', 'settings-explorer-bronze',
  'safe-feature-explorer', 'hundred-million-club', 'claude-output-bronze', 'sonnet-main'];

async function preparePinnedShowcase(provider: any, count = 3): Promise<void> {
  await prepareAchievementNoticeProvider(provider);
  provider.achievementResults(); await settleAchievementWrites(provider);
  const added = await provider.achievementRecordRepository.append(provider.achievementRecordState.generation,
    showcaseAwards.map(id => ({ id, origin: 'history', recordedDay: null, timeZone: null })));
  provider.achievementRecordState = added.store;
  provider.achievementGrants = new Set(added.store.records.map((row: any) => row.id));
  for (const key of showcaseThemes.slice(0, count)) {
    await provider.handleAchievementPinMessage({ key, selected: true, generation: added.store.generation,
      documentId: provider.dashboardDocumentId });
  }
  assert.deepEqual(provider.achievementRecordState.pins, showcaseThemes.slice(0, count));
}

function showcaseRequest(provider: any, action: 'reorder' | 'automatic' | 'manual'): Record<string, unknown> {
  return { documentId: provider.dashboardDocumentId, generation: provider.achievementRecordState.generation,
    revision: provider.achievementRecordState.pinRevision,
    ...(action === 'reorder' ? { action, keys: [...provider.achievementRecordState.pins].reverse() }
      : { action: 'mode', mode: action }) };
}

test('host showcase reorder and automatic/manual transitions persist revision-bound preferences only', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await preparePinnedShowcase(provider, 6);
      const repository = provider.achievementRecordRepository;
      const initial = structuredClone(provider.achievementRecordState);
      for (const action of ['reorder', 'automatic', 'manual'] as const) {
        const before = structuredClone(provider.achievementRecordState);
        await provider.handleAchievementShowcaseMessage(showcaseRequest(provider, action));
        const saved = JSON.parse(await readFile(repository.file, 'utf8'));
        assert.deepEqual(provider.achievementRecordState, saved);
        assert.equal(saved.pinRevision, before.pinRevision + 1);
        assert.equal(saved.showcaseMode, action === 'reorder' ? 'manual' : action);
        assert.deepEqual(saved.pins, action === 'reorder' ? [...before.pins].reverse() : before.pins);
        assert.deepEqual(saved.records, initial.records);
        assert.deepEqual(saved.auxiliary, initial.auxiliary);
        assert.equal(saved.sequence, initial.sequence);
        assert.equal(provider.achievementShareSelection, undefined);
      }
    }, undefined, directory);
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults(); await settleAchievementWrites(provider);
      assert.deepEqual(provider.achievementRecordState.pins, showcaseThemes.slice(0, 6).reverse());
      assert.equal(provider.achievementRecordState.showcaseMode, 'manual');
    }, undefined, directory);
  });
});

test('host showcase rejects stale document/generation/revision and rechecks queued document and OFF', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await preparePinnedShowcase(provider);
      const repository = provider.achievementRecordRepository;
      const bytes = await readFile(repository.file, 'utf8');
      for (const action of ['reorder', 'automatic', 'manual'] as const) {
        for (const stale of ['missing-document', 'document', 'generation', 'revision'] as const) {
          const request = showcaseRequest(provider, action);
          if (stale === 'missing-document') delete request.documentId;
          if (stale === 'document') request.documentId = 'retired-document';
          if (stale === 'generation') request.generation = provider.achievementRecordState.generation + 1;
          if (stale === 'revision') request.revision = provider.achievementRecordState.pinRevision - 1;
          await provider.handleAchievementShowcaseMessage(request);
          assert.equal(await readFile(repository.file, 'utf8'), bytes, `${action}/${stale}`);
        }
        for (const retirement of ['document', 'off', 'clear'] as const) {
          const gate = deferredAchievementSave();
          provider.achievementWrite = gate.promise;
          const request = showcaseRequest(provider, action);
          const originalDocument = provider.dashboardDocumentId;
          const pending = provider.handleAchievementShowcaseMessage(request);
          if (retirement === 'document') provider.dashboardDocumentId = 'replacement-document';
          if (retirement === 'off') provider.settings = { get: (key: string) => key !== 'enableAchievements' };
          if (retirement === 'clear') provider.achievementPersistenceEpoch++;
          gate.resolve(); await pending;
          assert.equal(await readFile(repository.file, 'utf8'), bytes, `${action}/queued-${retirement}`);
          provider.dashboardDocumentId = originalDocument;
          provider.settings = { get: () => true };
        }
      }
      assert.equal(provider.achievementShareSelection, undefined);
    }, undefined, directory);
  });
});

test('host replies to a valid-document stale showcase generation so client busy can retire', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await preparePinnedShowcase(provider);
      const bytes = await readFile(provider.achievementRecordRepository.file, 'utf8');
      const replies: any[] = [];
      provider.panel.webview.postMessage = async (reply: unknown) => { replies.push(reply); return true; };
      const request = showcaseRequest(provider, 'reorder');
      request.generation = provider.achievementRecordState.generation + 1;
      await provider.handleAchievementShowcaseMessage(request);
      assert.equal(await readFile(provider.achievementRecordRepository.file, 'utf8'), bytes);
      assert.deepEqual(replies, [{command:'achievementShowcaseResult',ok:false,reason:'failed',
        documentId:provider.dashboardDocumentId}]);
    }, undefined, directory);
  });
});

test('host stale peer six-pin reorder/mode and failed saves preserve the fresh list and failed state', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await preparePinnedShowcase(provider, 5);
      const repository = provider.achievementRecordRepository;
      const staleReorder = showcaseRequest(provider, 'reorder');
      const staleMode = showcaseRequest(provider, 'automatic');
      const { AchievementRecordRepository } = require('../achievementRecordStore');
      const peer = new AchievementRecordRepository(repository.file);
      const peerState = await peer.setPinned(provider.achievementRecordState.generation, showcaseThemes[5], true);
      const bytes = await readFile(repository.file, 'utf8');
      const replies: any[] = [];
      provider.panel.webview.postMessage = async (reply: unknown) => { replies.push(reply); return true; };
      const staleMemory = JSON.stringify(provider.achievementRecordState);
      await provider.handleAchievementPinMessage({ key: showcaseThemes[6], selected: true,
        generation: provider.achievementRecordState.generation, documentId: provider.dashboardDocumentId });
      assert.equal(await readFile(repository.file, 'utf8'), bytes, 'a stale five-pin host cannot overwrite the peer six-pin list');
      assert.equal(JSON.stringify(provider.achievementRecordState), staleMemory, 'failed single-pin save preserves confirmed memory');
      assert.equal(replies[replies.length - 1].ok, false);
      assert.equal(replies[replies.length - 1].reason, 'limit');
      for (const request of [staleReorder, staleMode]) {
        await provider.handleAchievementShowcaseMessage(request);
        assert.equal(await readFile(repository.file, 'utf8'), bytes);
        assert.deepEqual(provider.achievementRecordState.pins, peerState.pins);
        assert.equal(provider.achievementRecordState.pinRevision, peerState.pinRevision);
        assert.equal(replies[replies.length - 1].ok, false);
        assert.equal(replies[replies.length - 1].reason, 'failed');
      }
      const memory = JSON.stringify(provider.achievementRecordState);
      repository.setShowcaseMode = repository.reorderPinned = async () => { throw new Error('/private/failed-path'); };
      for (const action of ['reorder', 'automatic', 'manual'] as const) {
        await provider.handleAchievementShowcaseMessage(showcaseRequest(provider, action));
        assert.equal(await readFile(repository.file, 'utf8'), bytes);
        assert.equal(JSON.stringify(provider.achievementRecordState), memory);
        assert.equal(replies[replies.length - 1].ok, false);
      }
      assert.equal(JSON.stringify(replies).includes('/private/failed-path'), false);
      assert.equal(provider.achievementShareSelection, undefined);
    }, undefined, directory);
  });
});

test('host pin rechecks queued document and peer generation without successful replies or optimistic state', async () => {
  for (const retirement of ['document', 'generation'] as const) await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await preparePinnedShowcase(provider);
      const repository = provider.achievementRecordRepository;
      const memory = JSON.stringify(provider.achievementRecordState);
      const replies: any[] = [];
      provider.panel.webview.postMessage = async (reply: unknown) => { replies.push(reply); return true; };
      const gate = deferredAchievementSave();
      provider.achievementWrite = gate.promise;
      const pending = provider.handleAchievementPinMessage({ key: showcaseThemes[3], selected: true,
        generation: provider.achievementRecordState.generation, documentId: provider.dashboardDocumentId });
      if (retirement === 'document') provider.dashboardDocumentId = 'replacement-document';
      else {
        const { AchievementRecordRepository } = require('../achievementRecordStore');
        await new AchievementRecordRepository(repository.file).clear();
      }
      const expectedBytes = await readFile(repository.file, 'utf8');
      gate.resolve(); await pending;
      assert.equal(await readFile(repository.file, 'utf8'), expectedBytes);
      assert.equal(JSON.stringify(provider.achievementRecordState), memory);
      assert.ok(!replies.some(reply => reply.command === 'achievementPinResult' && reply.ok === true));
      if (retirement === 'generation') {
        assert.equal(replies.length, 1);
        assert.equal(replies[0].ok, false, 'same-document failed reply releases the client busy state');
      }
      assert.equal(provider.achievementShareSelection, undefined);
    }, undefined, directory);
  });
});

test('host pin cannot acquire a recalibrated award from archived v1 proof or forged display grants', async () => {
  await withAchievementStorage(async directory => {
    const { AchievementRecordRepository } = require('../achievementRecordStore');
    const oldWriter = new AchievementRecordRepository(path.join(directory, 'achievements-v1.json'));
    await oldWriter.initialize(['agent-team-gold']);
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.providerAvailability.codex = true;
      provider.achievementResults(); await settleAchievementWrites(provider);
      const repository = provider.achievementRecordRepository;
      assert.ok(provider.achievementRecordState.legacyRecords.some((row: any) => row.id === 'agent-team-gold'));
      assert.ok(!provider.achievementRecordState.records.some((row: any) => row.id === 'agent-team-gold'));
      const bytes = await readFile(repository.file, 'utf8');
      let writes = 0;
      repository.setPinned = async () => { writes++; throw new Error('must not acquire'); };
      provider.achievementGrants.add('agent-team-gold');
      await provider.handleAchievementPinMessage({ key: 'agent-team', selected: true,
        generation: provider.achievementRecordState.generation, documentId: provider.dashboardDocumentId });
      assert.equal(writes, 0);
      assert.equal(await readFile(repository.file, 'utf8'), bytes);
      assert.deepEqual(provider.achievementRecordState.pins, []);
    }, undefined, directory);
  });
});

test('statistics links require an existing same-provider view and matching model family', async () => {
  await withProvider(new Map(), async provider => {
    provider.currentProvider = 'claude';
    provider.providerAvailability = { claude: true, codex: true, codexData: false };
    provider.allTimeData = { totalInputTokens: 100, totalOutputTokens: 10,
      totalCacheReadTokens: 20, totalCacheCreationTokens: 0,
      modelBreakdown: { 'claude-sonnet-4-5': { inputTokens: 100, outputTokens: 10,
        cacheReadTokens: 20, cacheCreationTokens: 0 } } };
    const html = provider.renderAchievementData();
    assert.ok(html.includes('id="achievement-statistics-sonnet-main"'));
    assert.ok(html.includes('data-achievement-statistics="sonnet-main" data-statistics-section="models"'));
    assert.ok(html.includes('id="achievement-statistics-claude-output"'));
    for (const key of ['opus-cannon', 'fable-volume', 'sol-regular', 'weekly-volume', 'cumulative-volume', 'safe-feature-explorer'])
      assert.ok(!html.includes('id="achievement-statistics-' + key + '"'), key);
    provider.allTimeData = null;
    assert.doesNotMatch(provider.renderAchievementData(), /data-achievement-statistics=/);
    provider.achievementGrants = new Set(['sonnet-main-gold']);
    assert.doesNotMatch(provider.renderAchievementData(), /data-achievement-statistics=/,
      'a saved historical award cannot recreate a missing statistics view');
  });
});

test('Codex statistics use current materialized rows, not grants or another provider snapshot', async () => {
  await withProvider(new Map(), async provider => {
    provider.currentProvider = 'codex';
    provider.providerAvailability = { claude: true, codex: true, codexData: true };
    provider.codexView = { allTime: { total: { processed: 10 },
      models: [{ key: 'gpt-6.1-sol' }] } };
    assert.equal(provider.achievementStatisticsSection('sol-regular'), 'models');
    assert.equal(provider.achievementStatisticsSection('codex-output'), 'tokens');
    for (const key of ['astra-regular', 'luna-regular', 'sonnet-main', 'weekly-volume', 'cumulative-volume'])
      assert.equal(provider.achievementStatisticsSection(key), undefined);
    provider.revokedAchievementEvidence.add('codex');
    assert.equal(provider.achievementStatisticsSection('sol-regular'), undefined);
    provider.revokedAchievementEvidence.clear();
    provider.codexView = null;
    assert.equal(provider.achievementStatisticsSection('codex-output'), undefined);
    provider.currentProvider = 'compare';
    assert.equal(provider.achievementStatisticsSection('sol-regular'), undefined);
  });
});

test('plugin journey shows only saved deliberate steps, not pending export or optional advice', async () => {
  const language = I18n.getLocale();
  try { for (const locale of Object.keys(ACHIEVEMENT_COPY)) {
    I18n.setLanguage(locale as any);
    await withProvider(new Map(), async provider => {
      provider.achievementActivity = { schemaVersion: 2, settingKeys: [],
        features: ['achievementGalleryViewed', 'achievementSharePreview', 'localAdviceFeedback'] };
      provider.pendingAchievementActivity = { ...provider.achievementActivity,
        features: [...provider.achievementActivity.features, 'localShareExport'] };
      const html = provider.renderAchievementData();
      const journey = html.match(/<ol class="achievement-feature-journey"[\s\S]*?<\/ol>/)?.[0] ?? '';
      assert.equal((journey.match(/data-achievement-step=/g) ?? []).length, 3);
      assert.match(journey, /data-achievement-step="achievementGalleryViewed" data-complete="true"/);
      assert.match(journey, /data-achievement-step="achievementSharePreview" data-complete="true"/);
      assert.match(journey, /data-achievement-step="localShareExport" data-complete="false"/);
      assert.doesNotMatch(journey, /localAdviceFeedback|onclick|<button|<a /);
      for (const label of (ACHIEVEMENT_COPY as any)[locale].journeySteps) assert.ok(journey.includes(label));
      assert.ok(journey.includes((ACHIEVEMENT_COPY as any)[locale].stepRecorded));
      assert.ok(journey.includes((ACHIEVEMENT_COPY as any)[locale].stepUnrecorded));
      assert.equal(provider.achievementActivity.features.includes('localShareExport'), false);
      assert.equal(provider.achievementShareSelection, undefined);
    });
  } } finally { I18n.setLanguage(language as any); }
});

test('historical plugin awards cannot invent individual journey proof and all saved steps preserve exact rules', async () => {
  await withProvider(new Map(), async provider => {
    provider.achievementGrants = new Set(['safe-feature-explorer', 'local-share-export']);
    const historical = provider.renderAchievementData();
    const journey = historical.match(/<ol class="achievement-feature-journey"[\s\S]*?<\/ol>/)?.[0] ?? '';
    assert.equal((journey.match(/data-complete="false"/g) ?? []).length, 3);
    assert.match(historical, /data-achievement-key="safe-feature-explorer" data-achievement-earned="true"/);
    provider.achievementActivity = { schemaVersion: 2, settingKeys: ['language'],
      features: ['achievementGalleryViewed', 'achievementSharePreview', 'localShareExport'] };
    const complete = provider.renderAchievementData();
    const saved = complete.match(/<ol class="achievement-feature-journey"[\s\S]*?<\/ol>/)?.[0] ?? '';
    assert.equal((saved.match(/data-complete="true"/g) ?? []).length, 3);
    assert.equal((complete.match(/data-achievement-level=/g) ?? []).length,
      (historical.match(/data-achievement-level=/g) ?? []).length,
      'visibility leaves the same formal rules; no extra journey awards');
  });
});

async function unreadProvider(provider: any): Promise<string> {
  await prepareAchievementNoticeProvider(provider);
  provider.currentTab = 'achievements';
  provider.achievementResults(); await settleAchievementWrites(provider);
  const added = await provider.achievementRecordRepository.append(provider.achievementRecordState.generation,
    ['settings-explorer-bronze', 'settings-explorer-silver', 'settings-explorer-gold', 'safe-feature-explorer',
      'local-share-export', 'local-advice-feedback', 'hundred-million-club', 'astra-regular'].map(id =>
      ({ id, origin: 'activity', recordedDay: '2026-10-08', timeZone: 'Asia/Shanghai' })));
  provider.achievementRecordState = added.store;
  provider.achievementGrants = new Set(added.store.records.map((row: any) => row.id));
  return provider.renderAchievementData();
}

test('unread summary is folded, bounded, keeps exact series levels and does not read on render', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      const html = await unreadProvider(provider);
      assert.match(html, /<details[^>]*data-persist="achievement:unread"/);
      assert.doesNotMatch(html, /<details[^>]*data-persist="achievement:unread"[^>]* open/);
      const section = html.match(/<details[^>]*data-persist="achievement:unread"[\s\S]*?<\/details>/)![0];
      assert.equal((section.match(/data-achievement-record=/g) ?? []).length, 6);
      assert.match(section, /data-achievement-record="settings-explorer-silver"/);
      assert.match(section, /data-achievement-record="settings-explorer-gold"/);
      assert.doesNotMatch(section, /data-achievement-record="astra-regular"/);
      const packet = provider.achievementUnreadPacket;
      assert.match(packet.id, /^[0-9a-f]{48}$/);
      assert.equal(packet.batch.total, 7);
      const bytes = await readFile(provider.achievementRecordRepository.file, 'utf8');
      provider.renderAchievementData();
      assert.equal(provider.achievementUnreadPacket.id, packet.id);
      assert.equal(await readFile(provider.achievementRecordRepository.file, 'utf8'), bytes);
      assert.equal(provider.achievementShareSelection, undefined);
    }, undefined, directory);
  });
});

test('explicit summary confirmation merges fresh peers and marks only six represented exact IDs', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await unreadProvider(provider);
      const packet = provider.achievementUnreadPacket;
      const peer = await provider.achievementRecordRepository.append(packet.generation,
        [{ id: 'billion-token-club', origin: 'usage', recordedDay: '2026-10-08', timeZone: 'Asia/Shanghai' }]);
      await provider.acknowledgeAchievementSummary({ summaryId: packet.id, documentId: provider.dashboardDocumentId,
        ids: peer.store.records.map((row: any) => row.id) });
      const saved = JSON.parse(await readFile(provider.achievementRecordRepository.file, 'utf8'));
      assert.equal(saved.records.filter((row: any) => !row.unread).length, 6);
      for (const id of ['settings-explorer-bronze', 'astra-regular', 'billion-token-club'])
        assert.equal(saved.records.find((row: any) => row.id === id).unread, true);
      assert.equal(provider.achievementUnreadPacket, undefined);
      assert.equal(saved.sequence, peer.store.sequence);
      assert.deepEqual(saved.pins, []);
    }, undefined, directory);
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.currentTab = 'achievements';
      provider.achievementResults(); await settleAchievementWrites(provider);
      const html = provider.renderAchievementData();
      assert.match(html, /data-persist="achievement:unread"/);
      assert.equal(provider.achievementUnreadPacket.batch.total, 2, 'hidden Codex stays unread, not in this provider-visible group');
    }, undefined, directory);
  });
});

test('summary save rejects inactive, hidden, blurred, OFF and old document requests', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await unreadProvider(provider);
      const packet = provider.achievementUnreadPacket, file = provider.achievementRecordRepository.file;
      const before = await readFile(file, 'utf8');
      const request = { summaryId: packet.id, documentId: provider.dashboardDocumentId };
      for (const condition of ['tab', 'hidden', 'blur', 'ready', 'off', 'document', 'token']) {
        provider.currentTab = condition === 'tab' ? 'month' : 'achievements';
        provider.panel.visible = condition !== 'hidden';
        provider.achievementWindowFocused = condition !== 'blur';
        provider.webviewClientReady = condition !== 'ready';
        provider.settings = { get: (key: string) => condition !== 'off' || key !== 'enableAchievements' };
        await provider.acknowledgeAchievementSummary({ ...request,
          ...(condition === 'document' ? { documentId: 'retired' } : {}),
          ...(condition === 'token' ? { summaryId: 'forged' } : {}) });
        assert.equal(await readFile(file, 'utf8'), before, condition);
      }
      provider.currentTab = 'achievements'; provider.settings = { get: () => true };
      provider.webviewClientReady = true; provider.panel.visible = true; provider.achievementWindowFocused = true;
      const original = provider.achievementRecordRepository.acknowledgeRecords;
      const messages: any[] = [];
      provider.panel.webview.postMessage = async (message: unknown) => { messages.push(message); return true; };
      provider.achievementRecordRepository.acknowledgeRecords = async () => { throw new Error('/private/raw/path'); };
      await provider.acknowledgeAchievementSummary(request);
      assert.equal(await readFile(file, 'utf8'), before);
      assert.deepEqual(messages, [{ command: 'achievementSummaryResult', summaryId: packet.id,
        documentId: provider.dashboardDocumentId, ok: false }]);
      provider.achievementRecordRepository.acknowledgeRecords = original;
    }, undefined, directory);
  });
});

test('summary source and provider eligibility are rechecked after queued receipt delivery', async () => {
  for (const change of ['source', 'provider']) await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await unreadProvider(provider);
      provider.providerAvailability.codex = true;
      // Start a new visit; a source becoming visible must not widen an already represented group.
      provider.achievementUnreadPacket = undefined;
      provider.renderAchievementData();
      const packet = provider.achievementUnreadPacket;
      assert.ok(packet.batch.records.some((row: any) => row.id === 'astra-regular'));
      const before = await readFile(provider.achievementRecordRepository.file, 'utf8');
      let release!: () => void;
      provider.achievementWrite = new Promise<void>(resolve => { release = resolve; });
      const pending = provider.acknowledgeAchievementSummary({ summaryId: packet.id, documentId: packet.documentId });
      if (change === 'source') provider.providerAvailability.codex = false;
      else provider.currentProvider = 'codex';
      release(); await pending;
      assert.equal(await readFile(provider.achievementRecordRepository.file, 'utf8'), before, change);
    }, undefined, directory);
  });
});

test('replaced and patch-fallback documents retire the old summary tuple without losing unread records', async () => {
  for (const replacement of ['normal', 'fallback']) await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await unreadProvider(provider);
      const packet = provider.achievementUnreadPacket, before = await readFile(provider.achievementRecordRepository.file, 'utf8');
      const html = "<script>var __ccuDocumentId = '" + packet.documentId + "';</script>";
      if (replacement === 'normal') {
        const renewed = provider.renewDashboardDocument(html);
        assert.ok(renewed.includes(provider.dashboardDocumentId));
      } else {
        const pending = { revision: 7, documentHtml: html };
        provider.pendingDashboardLivePatch = pending;
        provider.replaceDocumentAfterPatchFailure(pending);
        assert.equal(provider.webviewClientReady, false);
        assert.ok(provider.panel.webview.html.includes(provider.dashboardDocumentId));
        provider.webviewClientReady = true;
      }
      assert.notEqual(provider.dashboardDocumentId, packet.documentId);
      assert.notEqual(provider.achievementUnreadPacket, packet, 'an already queued receipt cannot adopt the renewed document');
      await provider.acknowledgeAchievementSummary({ summaryId: packet.id, documentId: packet.documentId });
      assert.equal(await readFile(provider.achievementRecordRepository.file, 'utf8'), before);
      const renewed = provider.achievementUnreadPacket;
      await provider.acknowledgeAchievementSummary({ summaryId: renewed.id, documentId: renewed.documentId });
      const saved = JSON.parse(await readFile(provider.achievementRecordRepository.file, 'utf8'));
      assert.equal(saved.records.filter((row: any) => !row.unread).length, 6);
    }, undefined, directory);
  });
});

test('a durable summary receipt survives render failure and a repeated request does not read another group', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await unreadProvider(provider);
      const packet = provider.achievementUnreadPacket, messages: any[] = [];
      provider.panel.webview.postMessage = async (message: unknown) => { messages.push(message); return true; };
      provider.updateWebview = () => { throw new Error('synthetic render failure'); };
      const request = { summaryId: packet.id, documentId: packet.documentId };
      await provider.acknowledgeAchievementSummary(request);
      const bytes = await readFile(provider.achievementRecordRepository.file, 'utf8');
      assert.equal(JSON.parse(bytes).records.filter((row: any) => !row.unread).length, 6);
      assert.deepEqual(messages, [], 'render failure must not claim the durable save failed');
      provider.renderAchievementData();
      assert.equal(provider.achievementUnreadPacket.batch.total, 1);
      assert.notEqual(provider.achievementUnreadPacket.id, packet.id);
      await provider.acknowledgeAchievementSummary(request);
      assert.equal(await readFile(provider.achievementRecordRepository.file, 'utf8'), bytes);
    }, undefined, directory);
  });
});

test('summary queue rechecks focus before lease commit and a cleared epoch cannot revive records', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await unreadProvider(provider);
      const packet = provider.achievementUnreadPacket, before = await readFile(provider.achievementRecordRepository.file, 'utf8');
      let release!: () => void;
      provider.achievementWrite = new Promise<void>(resolve => { release = resolve; });
      const pending = provider.acknowledgeAchievementSummary({ summaryId: packet.id, documentId: provider.dashboardDocumentId });
      provider.setAchievementWindowFocused(false); release(); await pending;
      assert.equal(await readFile(provider.achievementRecordRepository.file, 'utf8'), before);
      provider.setAchievementWindowFocused(true);
      provider.renderAchievementData();
      const next = provider.achievementUnreadPacket;
      assert.notEqual(next.id, packet.id);
      await provider.clearAchievementGrants();
      await provider.acknowledgeAchievementSummary({ summaryId: next.id, documentId: provider.dashboardDocumentId });
      assert.equal(JSON.parse(await readFile(provider.achievementRecordRepository.file, 'utf8')).records.length, 0);
    }, undefined, directory);
  });
});

test('manual pin saves only an earned showcase preference and survives a new provider instance', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults(); await settleAchievementWrites(provider);
      const repository = provider.achievementRecordRepository;
      const added = await repository.append(provider.achievementRecordState.generation,
        [{ id: 'local-share-export', origin: 'activity', recordedDay: '2026-10-08', timeZone: 'Asia/Shanghai' }]);
      provider.achievementRecordState = added.store;
      provider.achievementGrants = new Set(added.store.records.map((row: any) => row.id));
      await provider.handleAchievementPinMessage({ key: 'local-share-export', selected: true, generation: added.store.generation,
        documentId: provider.dashboardDocumentId });
      const saved = JSON.parse(await readFile(repository.file, 'utf8'));
      assert.deepEqual(saved.pins, ['local-share-export']);
      assert.deepEqual(saved.records, added.store.records);
      assert.equal(saved.sequence, added.store.sequence);
      assert.equal(provider.achievementShareSelection, undefined);
    }, undefined, directory);
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults(); await settleAchievementWrites(provider);
      const html = provider.renderAchievementData();
      assert.match(html, /id="achievement-pin-local-share-export"[^>]*aria-pressed="true"/);
      const badges = html.match(/data-achievement-overview="badges"[\s\S]*?<\/section>/)?.[0] ?? '';
      assert.match(badges, /data-achievement-open="local-share-export"/);
      await provider.handleAchievementPinMessage({ key: 'local-share-export', selected: false, generation: provider.achievementRecordState.generation,
        documentId: provider.dashboardDocumentId });
      assert.deepEqual(JSON.parse(await readFile(provider.achievementRecordRepository.file, 'utf8')).pins, []);
    }, undefined, directory);
  });
});

test('disabled provider pins remain removable without awards, reads or losing peer preferences', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults(); await settleAchievementWrites(provider);
      const repository = provider.achievementRecordRepository;
      const added = await repository.append(provider.achievementRecordState.generation,
        ['astra-regular', 'sol-regular', 'luna-regular', 'local-share-export'].map(id =>
          ({ id, origin: 'history', recordedDay: null, timeZone: null })));
      let saved = added.store;
      for (const key of ['astra-regular', 'sol-regular', 'luna-regular']) saved = await repository.setPinned(saved.generation, key, true);
      provider.achievementRecordState = saved;
      provider.achievementGrants = new Set(saved.records.map((row: any) => row.id));
      await provider.handleAchievementPinMessage({ key: 'astra-regular', selected: false, generation: saved.generation,
        documentId: provider.dashboardDocumentId });
      const released = JSON.parse(await readFile(repository.file, 'utf8'));
      assert.deepEqual(released.pins, ['sol-regular', 'luna-regular']);
      assert.deepEqual(released.records, saved.records);
      await provider.handleAchievementPinMessage({ key: 'local-share-export', selected: true, generation: saved.generation,
        documentId: provider.dashboardDocumentId });
      const replaced = JSON.parse(await readFile(repository.file, 'utf8'));
      assert.deepEqual(replaced.pins, ['sol-regular', 'luna-regular', 'local-share-export']);
      assert.deepEqual(replaced.records, saved.records);
      assert.deepEqual(replaced.auxiliary, saved.auxiliary);
      assert.equal(provider.providerAvailability.codex, false);
      assert.equal(provider.achievementShareSelection, undefined);
    }, undefined, directory);
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults(); await settleAchievementWrites(provider);
      assert.deepEqual(provider.achievementRecordState.pins, ['sol-regular', 'luna-regular', 'local-share-export']);
    }, undefined, directory);
  });
});

test('hidden pin management is folded, bounded and localized without re-enabling a source', async () => {
  const language = I18n.getCurrentLanguage();
  try { await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults(); await settleAchievementWrites(provider);
      const repository = provider.achievementRecordRepository;
      const added = await repository.append(provider.achievementRecordState.generation,
        [{ id: 'astra-regular', origin: 'history', recordedDay: null, timeZone: null }]);
      provider.achievementRecordState = await repository.setPinned(added.store.generation, 'astra-regular', true);
      provider.achievementGrants = new Set(['astra-regular']);
      const bytes = await readFile(repository.file, 'utf8');
      for (const locale of Object.keys(ACHIEVEMENT_COPY)) {
        I18n.setLanguage(locale as any);
        const html = provider.renderAchievementData();
        assert.match(html, /<details[^>]*data-persist="achievement:hidden-pins"/);
        assert.match(html, /id="achievement-unpin-astra-regular"[^>]*aria-pressed="true"/);
        assert.doesNotMatch(html, /id="achievement-pin-astra-regular"/);
        assert.ok(html.includes((ACHIEVEMENT_COPY as any)[locale].hiddenPins));
        assert.equal((html.match(/id="achievement-unpin-/g) ?? []).length, 1);
      }
      assert.equal(await readFile(repository.file, 'utf8'), bytes);
      assert.equal(provider.providerAvailability.codex, false);
    }, undefined, directory);
  }); } finally { I18n.setLanguage(language); }
});

test('pin messages reject missing document/generation, nonboolean intent, unearned or hidden badges and OFF without writes', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults(); await settleAchievementWrites(provider);
      const repository = provider.achievementRecordRepository;
      const added = await repository.append(provider.achievementRecordState.generation, ['local-share-export', 'astra-regular'].map(id =>
        ({ id, origin: 'history', recordedDay: null, timeZone: null })));
      provider.achievementRecordState = added.store;
      const bytes = await readFile(repository.file, 'utf8');
      const originalSetPinned = repository.setPinned.bind(repository);
      let writes = 0;
      repository.setPinned = async (...args: unknown[]) => { writes++; return originalSetPinned(...args); };
      const replies: any[] = [];
      provider.panel.webview.postMessage = async (reply: unknown) => { replies.push(reply); return true; };
      await provider.handleAchievementPinMessage({ key: 'local-share-export', selected: true, generation: added.store.generation });
      assert.equal(writes, 0, 'missing document cannot reach storage');
      assert.equal(replies.length, 0, 'strict missing document has no response');
      for (const message of [
        { key: 'local-share-export', selected: true },
        { key: 'local-share-export', selected: 'true', generation: added.store.generation },
        { key: 'local-share-export', selected: true, generation: added.store.generation + 1 },
        { key: 'settings-explorer', selected: true, generation: added.store.generation },
        { key: 'astra-regular', selected: true, generation: added.store.generation },
      ]) await provider.handleAchievementPinMessage({ ...message, documentId: provider.dashboardDocumentId });
      provider.settings = { get: (key: string) => key !== 'enableAchievements' };
      await provider.handleAchievementPinMessage({ key: 'local-share-export', selected: true, generation: added.store.generation,
        documentId: provider.dashboardDocumentId });
      assert.equal(await readFile(repository.file, 'utf8'), bytes);
      assert.equal(writes, 0);
      assert.ok(!replies.some(reply => reply.command === 'achievementPinResult' && reply.ok === true));
    }, undefined, directory);
  });
});

test('seventh pin and failed save never optimistically alter six pins, awards or share selection', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults(); await settleAchievementWrites(provider);
      const repository = provider.achievementRecordRepository;
      const added = await repository.append(provider.achievementRecordState.generation,
        showcaseAwards.map(id =>
          ({ id, origin: 'history', recordedDay: null, timeZone: null })));
      provider.achievementRecordState = added.store;
      const messages: any[] = [];
      provider.panel.webview.postMessage = async (message: any) => { messages.push(message); return true; };
      for (const key of showcaseThemes.slice(0, 6))
        await provider.handleAchievementPinMessage({ key, selected: true, generation: added.store.generation,
          documentId: provider.dashboardDocumentId });
      assert.deepEqual(provider.achievementRecordState.pins, showcaseThemes.slice(0, 6));
      const bytes = await readFile(repository.file, 'utf8');
      await provider.handleAchievementPinMessage({ key: showcaseThemes[6], selected: true, generation: added.store.generation,
        documentId: provider.dashboardDocumentId });
      assert.equal(await readFile(repository.file, 'utf8'), bytes);
      assert.equal(messages[messages.length - 1].reason, 'limit');
      const memory = JSON.stringify(provider.achievementRecordState);
      repository.setPinned = async () => { throw new Error('private path must not leave host'); };
      await provider.handleAchievementPinMessage({ key: 'local-share-export', selected: false, generation: added.store.generation,
        documentId: provider.dashboardDocumentId });
      assert.equal(JSON.stringify(provider.achievementRecordState), memory);
      assert.equal(messages[messages.length - 1].reason, 'failed');
      assert.equal(JSON.stringify(messages).includes('private path'), false);
      assert.equal(provider.achievementShareSelection, undefined);
    }, undefined, directory);
  });
});

test('a failed pin render never misreports a successful durable preference save', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults(); await settleAchievementWrites(provider);
      const repository = provider.achievementRecordRepository;
      const added = await repository.append(provider.achievementRecordState.generation,
        [{ id: 'local-share-export', origin: 'history', recordedDay: null, timeZone: null }]);
      provider.achievementRecordState = added.store;
      const messages: any[] = [];
      provider.panel.webview.postMessage = async (message: any) => { messages.push(message); return true; };
      provider.updateWebview = () => { throw new Error('render failed, not save'); };
      await provider.handleAchievementPinMessage({ key: 'local-share-export', selected: true, generation: added.store.generation,
        documentId: provider.dashboardDocumentId });
      assert.deepEqual(JSON.parse(await readFile(repository.file, 'utf8')).pins, ['local-share-export']);
      assert.deepEqual(provider.achievementRecordState.pins, ['local-share-export']);
      assert.deepEqual(messages, [{ command: 'achievementPinResult', key: 'local-share-export', ok: true,
        reason: undefined, documentId: provider.dashboardDocumentId }]);
    }, undefined, directory);
  });
});

test('disabling a provider retires queued pin acquisition but not explicit cancellation', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.providerAvailability.codex = true;
      provider.achievementResults(); await settleAchievementWrites(provider);
      const repository = provider.achievementRecordRepository;
      const added = await repository.append(provider.achievementRecordState.generation,
        [{ id: 'astra-regular', origin: 'history', recordedDay: null, timeZone: null }]);
      provider.achievementRecordState = added.store;
      const pending = deferredAchievementSave();
      provider.achievementWrite = pending.promise;
      const replies: any[] = [];
      provider.panel.webview.postMessage = async (reply: unknown) => { replies.push(reply); return true; };
      const pin = provider.handleAchievementPinMessage({ key: 'astra-regular', selected: true, generation: added.store.generation,
        documentId: provider.dashboardDocumentId });
      provider.providerAvailability.codex = false;
      pending.resolve(); await pin;
      assert.deepEqual(JSON.parse(await readFile(repository.file, 'utf8')).pins, []);
      assert.ok(!replies.some(reply => reply.command === 'achievementPinResult' && reply.ok === true));
    }, undefined, directory);
  });
});

test('OFF or clear retires a queued pin before it can save into old state', async () => {
  for (const action of ['off', 'clear']) await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults(); await settleAchievementWrites(provider);
      const repository = provider.achievementRecordRepository;
      const added = await repository.append(provider.achievementRecordState.generation,
        [{ id: 'local-share-export', origin: 'history', recordedDay: null, timeZone: null }]);
      provider.achievementRecordState = added.store;
      const pending = deferredAchievementSave();
      provider.achievementWrite = pending.promise;
      const replies: any[] = [];
      provider.panel.webview.postMessage = async (reply: unknown) => { replies.push(reply); return true; };
      const pin = provider.handleAchievementPinMessage({ key: 'local-share-export', selected: true, generation: added.store.generation,
        documentId: provider.dashboardDocumentId });
      let clear;
      if (action === 'off') provider.settings = { get: (key: string) => key !== 'enableAchievements' };
      else clear = provider.clearAchievementGrants();
      pending.resolve(); await pin; await clear;
      const saved = JSON.parse(await readFile(repository.file, 'utf8'));
      assert.deepEqual(saved.pins, []);
      assert.deepEqual(saved.records, action === 'clear' ? [] : added.store.records);
      assert.ok(!replies.some(reply => reply.command === 'achievementPinResult' && reply.ok === true));
    }, undefined, directory);
  });
});

test('saved records render recent awards and an unknown-date history without reading them or selecting shares', async () => {
  const language = I18n.getCurrentLanguage();
  try {
    await withAchievementStorage(async directory => {
      await withProvider(achievementPersistenceState(), async provider => {
        await prepareAchievementNoticeProvider(provider);
        provider.achievementResults();
        await settleAchievementWrites(provider);
        const repository = provider.achievementRecordRepository;
        const saved = await repository.append(provider.achievementRecordState.generation, [
          { id: 'local-share-export', origin: 'activity', recordedDay: '2026-10-08', timeZone: 'Asia/Shanghai' },
          { id: 'hundred-million-club', origin: 'history', recordedDay: null, timeZone: null },
          { id: 'astra-regular', origin: 'usage', recordedDay: '2026-10-08', timeZone: 'Asia/Shanghai' },
        ]);
        provider.achievementRecordState = saved.store;
        provider.achievementGrants = new Set(saved.store.records.map((row: any) => row.id));
        const bytes = await readFile(repository.file, 'utf8');
        for (const locale of Object.keys(ACHIEVEMENT_COPY)) {
          I18n.setLanguage(locale as any);
          const html = provider.renderAchievementData();
          const recent = html.match(/<section[^>]*data-achievement-overview="recent"[\s\S]*?<\/section>/)?.[0] ?? '';
          assert.match(recent, /data-achievement-record="local-share-export"/);
          assert.doesNotMatch(recent, /hundred-million-club|astra-regular/);
          assert.match(html, /data-persist="achievement:records"/);
          const copy = (ACHIEVEMENT_COPY as any)[locale];
          for (const key of ['recentAwards', 'recordHistory', 'recordedDay', 'historicalAward']) {
            assert.equal(typeof copy[key], 'string');
            assert.ok(html.includes(copy[key]), `${locale}: ${key}`);
          }
          assert.ok(html.includes('2026-10-08'));
          assert.doesNotMatch(html, /undefined|noticeId|recordedAt/);
        }
        assert.equal(await readFile(repository.file, 'utf8'), bytes, 'rendering is not a display ACK');
        assert.equal(provider.achievementShareSelection, undefined);
      }, undefined, directory);
    });
  } finally { I18n.setLanguage(language); }
});

test('production storage writes a quiet canonical award and never writes a legacy grant mirror', async () => {
  await withAchievementStorage(async directory => {
    const state = achievementPersistenceState();
    await withProvider(state, async provider => {
      const notices = await prepareAchievementNoticeProvider(provider);
      provider.achievementNoticeBaseline.reset();
      setSingleVolumeAchievementFact(provider);
      provider.achievementResults();
      await settleAchievementWrites(provider);
      await settleAchievementWrites(provider);
      const saved = JSON.parse(await readFile(path.join(directory, ACHIEVEMENT_RECORD_FILE), 'utf8'));
      const row = saved.records.find((item: any) => item.id === 'hundred-million-club');
      assert.equal(row.origin, 'history');
      assert.equal(row.recordedDay, null);
      assert.equal(row.unread, false);
      assert.equal(provider.achievementGrants.has(row.id), true);
      assert.equal(notices.length, 0);
      assert.deepEqual(state.get('ccu.achievements.grants.v5'), []);
    }, async (key, _value, persist) => {
      assert.notEqual(key, 'ccu.achievements.grants.v5', 'canonical branch must not lose peers by rewriting a stale mirror');
      persist();
    }, directory);
  });
});

test('production OFF does not initialize the new record file', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await settleAchievementWrites(provider);
      provider.settings = { get: (key: string) => key !== 'enableAchievements' };
      provider.achievementResults();
      await settleAchievementWrites(provider);
      assert.deepEqual(await readdir(directory), []);
    }, undefined, directory);
  });
});

test('failed legacy activity migration does not initialize canonical proof from optimistic memory', async () => {
  await withAchievementStorage(async directory => {
    const state = achievementPersistenceState();
    state.set('ccu.achievements.activity.v1', { schemaVersion: 1, settingKeys: [], features: ['localShareExport'] });
    await withProvider(state, async provider => {
      provider.achievementResults();
      await settleAchievementWrites(provider);
      assert.equal(provider.achievementRecordLoadFailed, true);
      assert.deepEqual(await readdir(directory), []);
    }, async (key, _value, persist) => {
      if (key === 'ccu.achievements.activity.v2') throw new Error('fixture migration failed');
      persist();
    }, directory);
  });
});

test('a real saved plugin action retains its unread record even when notice delivery fails', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      await prepareAchievementNoticeProvider(provider);
      let attempts = 0;
      provider.panel.webview.postMessage = async () => { attempts++; throw new Error('fixture delivery failed'); };
      provider.recordAchievementFeature('localShareExport');
      await settleAchievementWrites(provider);
      await settleAchievementWrites(provider);
      const saved = JSON.parse(await readFile(path.join(directory, ACHIEVEMENT_RECORD_FILE), 'utf8'));
      const row = saved.records.find((item: any) => item.id === 'local-share-export');
      assert.equal(row.origin, 'activity');
      assert.match(row.recordedDay, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(row.unread, true);
      assert.equal(attempts, 1);
      assert.equal(provider.achievementGrants.has(row.id), true);
      assert.equal(provider.observedPluginAchievementIds.has(row.id), false);
    }, undefined, directory);
  });
});

test('peer clear fences deliberate action writes before an old host can repopulate the activity ledger', async () => {
  await withAchievementStorage(async directory => {
    const repository = new (require('../achievementRecordStore').AchievementRecordRepository)(path.join(directory, 'achievements-v1.json'));
    const state = achievementPersistenceState();
    await withProvider(state, async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults();
      await settleAchievementWrites(provider);
      await repository.clear();
      provider.recordAchievementFeature('localShareExport');
      await settleAchievementWrites(provider);
      assert.equal(state.has('ccu.achievements.activity.v2'), false);
      assert.equal(provider.clearingAchievements, true);
      assert.deepEqual(JSON.parse(await readFile(repository.file, 'utf8')).records, []);
    }, undefined, directory);
  });
});

test('canonical tombstone beats a stale legacy seed and a previously adopted host cannot restore awards', async () => {
  await withAchievementStorage(async directory => {
    const { AchievementRecordRepository } = require('../achievementRecordStore');
    const repository = new AchievementRecordRepository(path.join(directory, ACHIEVEMENT_RECORD_FILE));
    const seed = achievementPersistenceState();
    seed.set('ccu.achievements.grants.v5', ['hundred-million-club']);
    await repository.clear();
    await withProvider(seed, async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.achievementResults();
      await settleAchievementWrites(provider);
      assert.equal(provider.achievementGrants.size, 0, 'old globalState seed must not override canonical clear');
      const firstGeneration = provider.achievementRecordState.generation;
      await repository.clear();
      setSingleVolumeAchievementFact(provider);
      provider.achievementResults();
      await settleAchievementWrites(provider);
      assert.equal(provider.clearingAchievements, true, 'old host remains write-suspended until reload');
      const saved = JSON.parse(await readFile(repository.file, 'utf8'));
      assert.equal(saved.generation, firstGeneration + 1);
      assert.deepEqual(saved.records, []);
    }, undefined, directory);
  });
});

test('adopting a clear fence discards stale auxiliary proof, and the first new action does not import it again', async () => {
  await withAchievementStorage(async directory => {
    const repository = new (require('../achievementRecordStore').AchievementRecordRepository)(path.join(directory, ACHIEVEMENT_RECORD_FILE));
    await repository.clear();
    const state = achievementPersistenceState();
    state.set('ccu.achievements.activity.v2', { schemaVersion: 2, settingKeys: ['compactNumbers', 'decimalPlaces', 'showCost'], features: ['localShareExport'] });
    state.set('ccu.achievements.hours.v3', { schemaVersion: 3, maxStreak: 48 });
    await withProvider(state, async provider => {
      await prepareAchievementNoticeProvider(provider);
      provider.recordAchievementFeature('localAdviceFeedback');
      await settleAchievementWrites(provider);
      await settleAchievementWrites(provider);
      assert.deepEqual(provider.achievementActivity.features, ['localAdviceFeedback']);
      assert.deepEqual(provider.achievementActivity.settingKeys, []);
      assert.equal(provider.achievementHourEvidence.maxStreak, 0);
      const saved = JSON.parse(await readFile(repository.file, 'utf8'));
      assert.deepEqual(saved.records.map((row: any) => row.id), ['local-advice-feedback']);
      assert.equal(saved.records[0].origin, 'activity');
      assert.deepEqual(saved.auxiliary.activity.features, ['localAdviceFeedback']);
      assert.equal(saved.auxiliary.hours.maxStreak, 0);
      assert.deepEqual(state.get('ccu.achievements.activity.v2'), { schemaVersion: 2,
        settingKeys: ['compactNumbers', 'decimalPlaces', 'showCost'], features: ['localShareExport'] },
        'canonical writes do not mirror an entire cached Memento object');
    }, undefined, directory);
  });
});

function achievementPersistenceState(): Map<string, unknown> {
  // Keep constructor migration writes out of the save-under-test.
  return new Map<string, unknown>([
    ['ccu.achievements.grants.v5', []],
    ['ccu.achievements.structuralAudit.v1', true],
    ['ccu.achievements.tokenAudit.v1', true],
    ['ccu.achievements.bucketAudit.v1', true],
    ['ccu.achievements.manifestAudit.v1', true],
    ['ccu.achievements.calendarAudit.v1', true],
    ['ccu.achievements.calibrationAudit.v1', true],
  ]);
}

function deferredAchievementSave(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flushAchievementTasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function settleAchievementWrites(provider: any): Promise<void> {
  const settle = () => Promise.all([
    provider.achievementWrite,
    provider.achievementActivityWrite,
    provider.achievementHourWrite,
    provider.achievementNoticeWrite,
  ].map((write) => Promise.resolve(write).catch(() => undefined)));
  // Observe intentionally rejected saves immediately, before their microtask runs.
  await settle();
  await flushAchievementTasks();
  await settle();
  await flushAchievementTasks();
}

async function prepareAchievementNoticeProvider(provider: any, ready = true): Promise<unknown[]> {
  // Finish unrelated constructor initialization before attaching the fake panel.
  await settleAchievementWrites(provider);
  const notices: unknown[] = [];
  provider.settings = { get: () => true };
  provider.achievementWindowFocused = true;
  provider.providerAvailability = { claude: true, codex: false, codexData: false };
  provider.panel = {
    visible: true,
    webview: {
      postMessage: async (message: { command: string }) => {
        if (message.command === 'achievementUnlockNotice') notices.push(message);
        return true;
      },
    },
  };
  provider.webviewClientReady = ready;
  // Notification tests start after the first verified historical baseline.
  const { ACHIEVEMENT_EVIDENCE_DOMAINS } = require('../achievementEvidence');
  provider.achievementNoticeBaseline.accept(Object.fromEntries(
    ACHIEVEMENT_EVIDENCE_DOMAINS.map((domain: string) => [domain, 'ready'])));
  // These tests cover durable awards/notices, not rendering or P3/P4.
  provider.updateWebview = () => undefined;
  return notices;
}

function setSingleVolumeAchievementFact(provider: any): void {
  provider.allTimeData = {
    totalInputTokens: 100_000_000, totalOutputTokens: 0,
    totalCacheCreationTokens: 0, totalCacheReadTokens: 0, modelBreakdown: {},
  };
}

function hasDurableAchievement(state: Map<string, unknown>, id: string): boolean {
  const grants = state.get('ccu.achievements.grants.v5');
  return Array.isArray(grants) && grants.includes(id);
}

function evaluateAndDispatchAchievementNotice(provider: any): void {
  provider.achievementResults();
  provider.dispatchAchievementNotice();
}

test('background Code retains saved action records without presenting notices', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      const notices = await prepareAchievementNoticeProvider(provider);
      provider.achievementWindowFocused = false;
      provider.recordAchievementFeature('localShareExport');
      await settleAchievementWrites(provider);
      await settleAchievementWrites(provider);
      const saved = JSON.parse(await readFile(path.join(directory, ACHIEVEMENT_RECORD_FILE), 'utf8'));
      assert.equal(notices.length, 0);
      assert.equal(saved.lastNoticeAt, 0);
      assert.equal(saved.records.find((row: any) => row.id === 'local-share-export').unread, true);
    }, undefined, directory);
  });
});

test('only an issued foreground notice ACK reads its batch, not later or unrelated records', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      const notices = await prepareAchievementNoticeProvider(provider);
      provider.recordAchievementFeature('localShareExport');
      await settleAchievementWrites(provider);
      await settleAchievementWrites(provider);
      assert.equal(notices.length, 1);
      const notice = notices[0] as any;
      assert.match(notice.noticeId, /^[a-f0-9]{48}$/);
      const repository = provider.achievementRecordRepository;
      await repository.append(provider.achievementRecordState.generation, [{
        id: 'local-advice-feedback', origin: 'activity', recordedDay: '2026-10-08', timeZone: 'UTC',
      }]);
      await provider.acknowledgeAchievementNotice('private-canary');
      let saved = await require('../achievementRecordStore').loadAchievementRecords(repository.file);
      assert.ok(saved.records.every((row: any) => row.unread));
      await provider.acknowledgeAchievementNotice(notice.noticeId);
      saved = await require('../achievementRecordStore').loadAchievementRecords(repository.file);
      assert.deepEqual(saved.records.map((row: any) => row.unread), [false, true]);
      await provider.acknowledgeAchievementNotice(notice.noticeId);
      provider.recordAchievementFeature('localAdviceFeedback');
      await settleAchievementWrites(provider);
      assert.equal(notices.length, 1, 'unread records are not replayed as live notices');
      assert.ok(saved.lastNoticeAt > 0);
    }, undefined, directory);
  });
});

test('blur retires notice ACK authority without reading the delivered record', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      const notices = await prepareAchievementNoticeProvider(provider);
      provider.recordAchievementFeature('localShareExport');
      await settleAchievementWrites(provider);
      await settleAchievementWrites(provider);
      provider.setAchievementWindowFocused(false);
      await provider.acknowledgeAchievementNotice((notices[0] as any).noticeId);
      const saved = await require('../achievementRecordStore').loadAchievementRecords(provider.achievementRecordRepository.file);
      assert.equal(saved.records[0].unread, true);
      provider.setAchievementWindowFocused(true);
      await settleAchievementWrites(provider);
      assert.equal(notices.length, 1);
    }, undefined, directory);
  });
});

test('a committed action waits through its gallery replacement before notice delivery', async () => {
  await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      const notices = await prepareAchievementNoticeProvider(provider);
      provider.achievementResults();
      await settleAchievementWrites(provider);
      provider.updateWebview = () => { provider.webviewClientReady = false; };
      provider.recordAchievementFeature('localShareExport');
      await settleAchievementWrites(provider);
      await settleAchievementWrites(provider);
      assert.equal(notices.length, 0);
      assert.equal(provider.pendingAchievementNotice.size, 1);
      provider.webviewClientReady = true;
      provider.dispatchAchievementNotice();
      await settleAchievementWrites(provider);
      assert.equal(notices.length, 1);
    }, undefined, directory);
  });
});

test('false or slow notice delivery cannot lose unread awards or block clear', async () => {
  for (const mode of ['false', 'slow']) await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      const notices = await prepareAchievementNoticeProvider(provider);
      const delivery = deferredAchievementSave();
      provider.panel.webview.postMessage = (message: any) => {
        notices.push(message);
        return mode === 'false' ? Promise.resolve(false) : delivery.promise.then(() => true);
      };
      try {
        provider.recordAchievementFeature('localShareExport');
        await settleAchievementWrites(provider);
        await settleAchievementWrites(provider);
        assert.equal(notices.length, 1);
        const saved = await require('../achievementRecordStore').loadAchievementRecords(provider.achievementRecordRepository.file);
        assert.equal(saved.records[0].unread, true);
        assert.ok(saved.lastNoticeAt > 0);
        if (mode === 'false') assert.equal(provider.achievementNoticeInFlight, undefined);
        await provider.clearAchievementGrants({ holdUntilReload: true });
        await provider.acknowledgeAchievementNotice((notices[0] as any).noticeId);
        assert.deepEqual((await require('../achievementRecordStore').loadAchievementRecords(provider.achievementRecordRepository.file)).records, []);
      } finally { delivery.resolve(); }
    }, undefined, directory);
  });
});

test('OFF and peer clear reject a formerly issued notice confirmation', async () => {
  for (const mode of ['off', 'peer-clear']) await withAchievementStorage(async directory => {
    await withProvider(achievementPersistenceState(), async provider => {
      const notices = await prepareAchievementNoticeProvider(provider);
      provider.recordAchievementFeature('localShareExport');
      await settleAchievementWrites(provider);
      await settleAchievementWrites(provider);
      const repository = provider.achievementRecordRepository;
      if (mode === 'off') provider.settings = { get: (key: string) => key !== 'enableAchievements' };
      else await repository.clear();
      const before = await readFile(repository.file, 'utf8');
      await provider.acknowledgeAchievementNotice((notices[0] as any).noticeId);
      assert.equal(await readFile(repository.file, 'utf8'), before);
    }, undefined, directory);
  });
});

test('first verified historical awards stay quiet even while the gallery is visible', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    provider.achievementNoticeBaseline.reset();
    provider.achievementCalendarTimeZone = resolveTimeZone(I18n.getTimezone());
    setSingleVolumeAchievementFact(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), true);
    assert.equal(notices.length, 0, 'backfill does not celebrate old milestones');
    assert.equal(provider.achievementNoticeBaseline.isReady('combined-usage'), true);
    provider.allTimeData = { ...provider.allTimeData, totalInputTokens: 1_000_000_000 };
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    assert.equal(hasDurableAchievement(state, 'billion-token-club'), true);
    assert.equal(notices.length, 1, 'later new progress can use the quiet in-panel toast');
  });
});

test('restored plugin actions grant quietly rather than masquerading as new actions', async () => {
  const state = achievementPersistenceState();
  state.set('ccu.achievements.activity.v2', {
    schemaVersion: 2, settingKeys: ['compactNumbers', 'decimalPlaces', 'language'],
    features: ['achievementGalleryViewed', 'achievementSharePreview', 'localShareExport', 'localAdviceFeedback'],
  });
  await withProvider(state, async provider => {
    const notices = await prepareAchievementNoticeProvider(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    for (const id of ['settings-explorer-bronze', 'safe-feature-explorer', 'local-share-export', 'local-advice-feedback']) {
      assert.equal(hasDurableAchievement(state, id), true);
    }
    assert.equal(notices.length, 0, 'reading a saved ledger is not a deliberate action');
    provider.recordAchievementFeature('localShareExport');
    await settleAchievementWrites(provider);
    assert.equal(notices.length, 0, 'repeating an imported feature must not fabricate its first unlock');
  });
});

test('only plugin levels crossed by a successfully saved action may celebrate', async () => {
  const state = achievementPersistenceState();
  state.set('ccu.achievements.activity.v2', {
    schemaVersion: 2,
    settingKeys: ['compactNumbers', 'decimalPlaces', 'displayCurrency', 'language', 'timezone',
      'showCost', 'showContext', 'showInsights', 'statusBarMetric'], features: [],
  });
  await withProvider(state, async provider => {
    const notices = await prepareAchievementNoticeProvider(provider);
    provider.silentAchievementRechecks.add('settings-explorer-silver');
    provider.recordAchievementSettingChange('tokenDecimalPlaces', true);
    await settleAchievementWrites(provider);
    assert.equal(hasDurableAchievement(state, 'settings-explorer-bronze'), true);
    assert.equal(hasDurableAchievement(state, 'settings-explorer-silver'), true);
    assert.equal(notices.length, 1, 'a new action must retire only its own migration silence');
    assert.match((notices[0] as { iconFile: string }).iconFile, /settings/);
    assert.equal(provider.observedPluginAchievementIds.size, 0, 'saved provenance is consumed, not a lifetime action history');
  });
});

test('successful plugin actions save awards even without a visible or ready dashboard', async () => {
  for (const mode of ['hidden', 'closed', 'not-ready']) {
    const state = achievementPersistenceState();
    await withProvider(state, async provider => {
      const notices = await prepareAchievementNoticeProvider(provider);
      if (mode === 'hidden') provider.panel.visible = false;
      if (mode === 'closed') provider.panel = undefined;
      if (mode === 'not-ready') provider.webviewClientReady = false;
      let renders = 0;
      provider.updateWebview = () => { renders++; };
      provider.recordAchievementFeature('localShareExport');
      await settleAchievementWrites(provider);
      assert.equal(hasDurableAchievement(state, 'local-share-export'), true, mode);
      assert.equal(notices.length, 0, 'background actions must not interrupt the user');
      assert.equal(renders, 0, 'saving an action must not refresh a hidden dashboard');
    });
  }
});

test('provider proof revocation cannot cancel an independently saved local action award', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async provider => {
    const notices = await prepareAchievementNoticeProvider(provider, false);
    const held = deferredAchievementSave();
    provider.achievementWrite = held.promise;
    try {
      provider.recordAchievementFeature('localShareExport');
      await provider.achievementActivityWrite;
      assert.equal(provider.pendingAchievementGrants.has('local-share-export'), true);
      provider.invalidateAchievementEvidence('claude');
      provider.invalidateAchievementEvidence('codex');
    } finally {
      held.resolve();
      await settleAchievementWrites(provider);
    }
    assert.equal(hasDurableAchievement(state, 'local-share-export'), true,
      'log-source evidence and deliberate plugin actions have separate lifetimes');
    assert.equal(notices.length, 0);
    assert.equal(provider.pendingAchievementGrants.size, 0);
  });
});

test('failed grant storage retains saved-action provenance for a quiet bounded retry', async () => {
  const state = achievementPersistenceState();
  let attempts = 0;
  await withProvider(state, async provider => {
    const notices = await prepareAchievementNoticeProvider(provider);
    provider.recordAchievementFeature('localAdviceFeedback');
    await settleAchievementWrites(provider);
    assert.equal(hasDurableAchievement(state, 'local-advice-feedback'), false);
    assert.equal(notices.length, 0);
    assert.equal(provider.observedPluginAchievementIds.size, 1);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    assert.equal(hasDurableAchievement(state, 'local-advice-feedback'), true);
    assert.equal(notices.length, 1);
    assert.equal(provider.observedPluginAchievementIds.size, 0);
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.grants.v5' && Array.isArray(value) && ++attempts === 1) {
      throw new Error('synthetic action grant write failure');
    }
    persist();
  });
});

test('mixed queued awards retire usage proof without discarding saved action proof', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async provider => {
    await prepareAchievementNoticeProvider(provider, false);
    setSingleVolumeAchievementFact(provider);
    const held = deferredAchievementSave();
    provider.achievementWrite = held.promise;
    try {
      provider.recordAchievementFeature('localShareExport');
      await provider.achievementActivityWrite;
      assert.equal(provider.pendingAchievementGrants.has('hundred-million-club'), true);
      assert.equal(provider.pendingAchievementGrants.has('local-share-export'), true);
      provider.invalidateAchievementEvidence('claude');
    } finally {
      held.resolve();
      await settleAchievementWrites(provider);
    }
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), false);
    assert.equal(hasDurableAchievement(state, 'local-share-export'), true);
    assert.equal(provider.pendingAchievementGrants.size, 0);
  });
});

test('disable during activity persistence skips new-action provenance evaluation', async () => {
  const state = achievementPersistenceState();
  const save = deferredAchievementSave();
  await withProvider(state, async provider => {
    const notices = await prepareAchievementNoticeProvider(provider);
    let enabled = true;
    provider.settings = { get: (key: string) => key === 'enableAchievements' ? enabled : true };
    let reads = 0;
    Object.defineProperty(provider.achievementActivity, 'features', {
      enumerable: true, get: () => { reads++; return []; },
    });
    provider.recordAchievementFeature('localShareExport');
    await flushAchievementTasks();
    const beforeDisable = reads;
    enabled = false;
    save.resolve();
    await settleAchievementWrites(provider);
    assert.equal(reads, beforeDisable, 'OFF must not run the delta rule evaluator after a held save');
    assert.deepEqual(provider.achievementActivity.features, ['localShareExport']);
    assert.equal(hasDurableAchievement(state, 'local-share-export'), false);
    assert.equal(notices.length, 0);
  }, async (key, _value, persist) => {
    if (key === 'ccu.achievements.activity.v2') await save.promise;
    persist();
  });
});

test('refresh failure cancels queued usage awards but preserves displayed statistics and saved awards', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async (provider) => {
    await prepareAchievementNoticeProvider(provider);
    setSingleVolumeAchievementFact(provider);
    const displayed = provider.allTimeData;
    provider.achievementResults();
    provider.invalidateAchievementEvidence('claude');
    await settleAchievementWrites(provider);
    assert.equal(provider.allTimeData, displayed);
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), false);
    assert.equal(provider.pendingAchievementGrants.size, 0);
    assert.equal(provider.achievementResults().find((row: any) => row.id === 'hundred-million-club').unlocked, false);

    provider.updateData(null, null, null, displayed);
    provider.achievementResults();
    await settleAchievementWrites(provider);
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), true);
    provider.invalidateAchievementEvidence('claude');
    await settleAchievementWrites(provider);
    assert.equal(provider.achievementGrants.has('hundred-million-club'), true);
  });
});

test('achievement persistence skips queued grants after disable while preserving the in-flight grant', async () => {
  const state = achievementPersistenceState();
  const save = deferredAchievementSave();
  let grantSaves = 0;
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    let enabled = true;
    provider.settings = { get: (key: string) => key === 'enableAchievements' ? enabled : true };
    setSingleVolumeAchievementFact(provider);
    try {
      evaluateAndDispatchAchievementNotice(provider);
      await flushAchievementTasks();
      assert.equal(grantSaves, 1, 'the first grant save must already be in flight');
      provider.recordAchievementFeature('localShareExport');
      await provider.achievementActivityWrite;
      assert.equal(provider.pendingAchievementGrants.has('local-share-export'), true,
        'the saved action must enqueue a second grant behind the held save');
      enabled = false;
    } finally {
      save.resolve();
      await settleAchievementWrites(provider);
    }
    assert.equal(grantSaves, 1, 'the queued grant must not start storage while disabled');
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), true);
    assert.equal(provider.achievementGrants.has('hundred-million-club'), true);
    assert.equal(hasDurableAchievement(state, 'local-share-export'), false);
    assert.equal(provider.pendingAchievementGrants.size, 0);
    assert.equal(provider.pendingAchievementNotice.size, 0);
    assert.equal(notices.length, 0);

    enabled = true;
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    assert.equal(grantSaves, 2, 'reenabling must allow the skipped grant to be evaluated again');
    assert.equal(hasDurableAchievement(state, 'local-share-export'), true);
    assert.equal(notices.length, 0, 'reenabling reconciles the saved action quietly, not as a new action');
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.grants.v5' && Array.isArray(value)) {
      grantSaves += 1;
      if (grantSaves === 1) await save.promise;
    }
    persist();
  });
});

test('achievement persistence skips queued activity after disable while preserving the in-flight action', async () => {
  const state = achievementPersistenceState();
  const save = deferredAchievementSave();
  let activitySaves = 0;
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    let enabled = true;
    provider.settings = { get: (key: string) => key === 'enableAchievements' ? enabled : true };
    try {
      provider.recordAchievementFeature('achievementGalleryViewed');
      await flushAchievementTasks();
      assert.equal(activitySaves, 1, 'the first action save must already be in flight');
      provider.recordAchievementFeature('localShareExport');
      enabled = false;
    } finally {
      save.resolve();
      await settleAchievementWrites(provider);
    }
    assert.equal(activitySaves, 1, 'the queued action must not start storage while disabled');
    assert.deepEqual((state.get('ccu.achievements.activity.v2') as { features: string[] }).features,
      ['achievementGalleryViewed']);
    assert.deepEqual(provider.achievementActivity.features, ['achievementGalleryViewed']);
    assert.equal(provider.pendingAchievementActivity, undefined);
    assert.equal(hasDurableAchievement(state, 'local-share-export'), false);
    assert.equal(notices.length, 0);

    enabled = true;
    provider.recordAchievementFeature('localShareExport');
    await settleAchievementWrites(provider);
    assert.equal(activitySaves, 2, 'a new deliberate action must remain recordable after reenabling');
    assert.equal(hasDurableAchievement(state, 'local-share-export'), true);
    assert.equal(notices.length, 1);
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.activity.v2' && value !== undefined) {
      activitySaves += 1;
      if (activitySaves === 1) await save.promise;
    }
    persist();
  });
});

test('achievement persistence skips queued hours after disable and retries unchanged proof on reenable', async () => {
  const state = achievementPersistenceState();
  const save = deferredAchievementSave();
  let hourSaves = 0;
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    let enabled = true;
    provider.settings = { get: (key: string) => key === 'enableAchievements' ? enabled : true };
    const firstHour = Math.floor(Date.now() / 3_600_000) - 48;
    const records = Array.from({ length: 2 }, (_, index) => ({
      timestamp: new Date((firstHour + index) * 3_600_000).toISOString(),
      message: { usage: { output_tokens: 1 } },
    }));
    try {
      provider.allRecords = records.slice(0, 1);
      provider.achievementResults();
      await flushAchievementTasks();
      assert.equal(hourSaves, 1, 'the first hour save must already be in flight');
      provider.allRecords = records;
      provider.achievementResults();
      enabled = false;
    } finally {
      save.resolve();
      await settleAchievementWrites(provider);
    }
    assert.equal(hourSaves, 1, 'the queued hour proof must not start storage while disabled');
    assert.deepEqual(state.get('ccu.achievements.hours.v3'), { schemaVersion: 3, maxStreak: 1 });
    assert.equal(provider.achievementHourEvidence.maxStreak, 1);
    assert.equal(notices.length, 0);

    enabled = true;
    provider.achievementResults();
    await settleAchievementWrites(provider);
    assert.equal(hourSaves, 2, 'unchanged source proof must remain persistable after reenabling');
    assert.deepEqual(state.get('ccu.achievements.hours.v3'), { schemaVersion: 3, maxStreak: 2 });
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.hours.v3' && value !== undefined) {
      hourSaves += 1;
      if (hourSaves === 1) await save.promise;
    }
    persist();
  });
});

test('achievement persistence never lowers confirmed hours when queued observations shrink', async () => {
  const state = achievementPersistenceState();
  const save = deferredAchievementSave();
  const maxima: number[] = [];
  await withProvider(state, async (provider) => {
    await prepareAchievementNoticeProvider(provider);
    const firstHour = Math.floor(Date.now() / 3_600_000) - 48;
    const records = Array.from({ length: 2 }, (_, index) => ({
      timestamp: new Date((firstHour + index) * 3_600_000).toISOString(),
      message: { usage: { output_tokens: 1 } },
    }));
    try {
      provider.allRecords = records;
      provider.achievementResults();
      await flushAchievementTasks();
      assert.deepEqual(maxima, [2], 'the larger proof must already be in flight');
      provider.allRecords = records.slice(0, 1);
      provider.achievementResults();
    } finally {
      save.resolve();
      await settleAchievementWrites(provider);
    }
    assert.deepEqual(state.get('ccu.achievements.hours.v3'), { schemaVersion: 3, maxStreak: 2 });
    assert.equal(provider.achievementHourEvidence.maxStreak, 2);
    assert.deepEqual(maxima, [2], 'the queued smaller proof must not overwrite the saved maximum');
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.hours.v3' && value !== undefined) {
      maxima.push((value as { maxStreak: number }).maxStreak);
      if (maxima.length === 1) await save.promise;
    }
    persist();
  });
});

test('achievement persistence keeps unlock notices silent while a grant save is pending', async () => {
  const state = achievementPersistenceState();
  const save = deferredAchievementSave();
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    setSingleVolumeAchievementFact(provider);
    try {
      evaluateAndDispatchAchievementNotice(provider);
      await flushAchievementTasks();
      assert.equal(hasDurableAchievement(state, 'hundred-million-club'), false);
      assert.equal(notices.length, 0, 'a pending grant save must not announce an unlock');
    } finally {
      save.resolve();
      await settleAchievementWrites(provider);
    }
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.grants.v5' && Array.isArray(value)) await save.promise;
    persist();
  });
});

test('achievement persistence rejects a grant save without sending an unlock notice', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    setSingleVolumeAchievementFact(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), false);
    assert.equal(notices.length, 0, 'a rejected grant save must stay silent');
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.grants.v5' && Array.isArray(value)) {
      throw new Error('synthetic grant save failure');
    }
    persist();
  });
});

test('achievement persistence retries unchanged facts after a rejected grant save', async () => {
  const state = achievementPersistenceState();
  let attempts = 0;
  await withProvider(state, async (provider) => {
    await prepareAchievementNoticeProvider(provider, false);
    setSingleVolumeAchievementFact(provider);
    provider.achievementResults();
    await settleAchievementWrites(provider);
    assert.equal(attempts, 1);
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), false);
    provider.achievementResults();
    await settleAchievementWrites(provider);
    assert.equal(attempts, 2, 'the same fact must remain eligible for a save retry');
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), true);
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.grants.v5' && Array.isArray(value)) {
      attempts += 1;
      if (attempts === 1) throw new Error('synthetic first grant save failure');
    }
    persist();
  });
});

test('achievement persistence announces one successful grant and never repeats it after reload', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    setSingleVolumeAchievementFact(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), true);
    assert.equal(notices.length, 1);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    assert.equal(notices.length, 1, 'unchanged facts must not announce the saved grant again');
  });
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    setSingleVolumeAchievementFact(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    assert.equal(notices.length, 0, 'reload must recognize the already saved grant');
  });
});

test('achievement persistence tolerates rejected notice delivery without unhandled rejection or retry', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async (provider) => {
    await prepareAchievementNoticeProvider(provider);
    let noticeAttempts = 0;
    provider.panel.webview.postMessage = (message: { command: string }) => {
      if (message.command === 'achievementUnlockNotice') {
        noticeAttempts += 1;
        // Do not catch this in the fixture: Node's test runner must detect an
        // unhandled rejection if the production best-effort boundary is absent.
        return Promise.reject(new Error('synthetic notice delivery rejection'));
      }
      return Promise.resolve(true);
    };
    setSingleVolumeAchievementFact(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    await flushAchievementTasks();
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), true,
      'failed UI delivery must not undo the successfully saved grant');
    assert.equal(noticeAttempts, 1);
    provider.webviewClientReady = false;
    provider.webviewClientReady = true;
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    await flushAchievementTasks();
    assert.equal(noticeAttempts, 1, 'lost notices must not be replayed on readiness or refresh');
    assert.equal(provider.pendingAchievementNotice.size, 0);
  });
});

test('achievement notice cooldown starts before slow delivery and suppresses a second saved batch', async () => {
  const state = achievementPersistenceState();
  const delivery = deferredAchievementSave();
  await withProvider(state, async (provider) => {
    await prepareAchievementNoticeProvider(provider);
    const notices: unknown[] = [];
    provider.panel.webview.postMessage = (message: { command: string }) => {
      if (message.command === 'achievementUnlockNotice') {
        notices.push(message);
        return delivery.promise.then(() => true);
      }
      return Promise.resolve(true);
    };
    try {
      setSingleVolumeAchievementFact(provider);
      evaluateAndDispatchAchievementNotice(provider);
      await settleAchievementWrites(provider);
      assert.equal(notices.length, 1);
      assert.equal(hasDurableAchievement(state, 'hundred-million-club'), true);

      provider.recordAchievementFeature('localShareExport');
      await settleAchievementWrites(provider);
      assert.equal(hasDurableAchievement(state, 'local-share-export'), true,
        'UI delivery must never block or discard a separate saved award');
      assert.equal(notices.length, 1, 'a slow first delivery must reserve the disturbance cooldown');
      provider.dispatchAchievementNotice();
      await flushAchievementTasks();
      assert.equal(notices.length, 1);
    } finally {
      delivery.resolve();
      await flushAchievementTasks();
    }
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    assert.equal(notices.length, 1, 'suppressed awards must not replay after delivery settles');
  });
});

test('achievement notice identifies bundled artwork without sending a large PNG data URL', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    setSingleVolumeAchievementFact(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    assert.equal(notices.length, 1);
    const notice = notices[0] as { iconFile?: string; icon?: string };
    assert.match(notice.iconFile ?? '', /^[a-z0-9-]+\.png$/);
    assert.equal(notice.icon, undefined, 'notice messages should reuse bundled gallery artwork');
  });
});

test('achievement notice synchronous delivery errors stay quiet and cannot bypass cooldown', async () => {
  await withProvider(achievementPersistenceState(), async (provider) => {
    await prepareAchievementNoticeProvider(provider);
    let attempts = 0;
    provider.panel.webview.postMessage = () => {
      attempts += 1;
      throw new Error('synthetic synchronous notice delivery failure');
    };
    provider.pendingAchievementNotice.add('hundred-million-club');
    assert.doesNotThrow(() => provider.dispatchAchievementNotice());
    await flushAchievementTasks();
    assert.equal(attempts, 1);
    provider.pendingAchievementNotice.add('local-share-export');
    provider.dispatchAchievementNotice();
    await flushAchievementTasks();
    assert.equal(attempts, 1, 'failed delivery must not cause another immediate message attempt');
    assert.equal(provider.pendingAchievementNotice.size, 0, 'suppressed notices must not replay later');
    provider.lastAchievementNoticeAt = Date.now() - 300_001;
    provider.pendingAchievementNotice.add('local-advice-feedback');
    assert.doesNotThrow(() => provider.dispatchAchievementNotice());
    await flushAchievementTasks();
    assert.equal(attempts, 2, 'a new notice is allowed after the existing cooldown, without a timer');
  });
});

test('achievement persistence blocks derived grants until the activity save succeeds', async () => {
  const state = achievementPersistenceState();
  const save = deferredAchievementSave();
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    let grantedBeforeActivitySave = false;
    let noticesBeforeActivitySave = 0;
    try {
      provider.recordAchievementFeature('localShareExport');
      // A render/evaluation during the pending action save must also stay closed.
      evaluateAndDispatchAchievementNotice(provider);
      await flushAchievementTasks();
      assert.equal(state.has('ccu.achievements.activity.v2'), false);
      grantedBeforeActivitySave = hasDurableAchievement(state, 'local-share-export');
      noticesBeforeActivitySave = notices.length;
    } finally {
      save.resolve();
      await settleAchievementWrites(provider);
    }
    assert.equal(grantedBeforeActivitySave, false, 'an unsaved action cannot produce a durable grant');
    assert.equal(noticesBeforeActivitySave, 0);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    assert.equal(hasDurableAchievement(state, 'local-share-export'), true);
    assert.equal(notices.length, 1);
  }, async (key, _value, persist) => {
    if (key === 'ccu.achievements.activity.v2') await save.promise;
    persist();
  });
});

test('achievement persistence rejects unsaved activity without a derived grant or notice', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    provider.recordAchievementFeature('localShareExport');
    await settleAchievementWrites(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    assert.equal(state.has('ccu.achievements.activity.v2'), false);
    assert.equal(hasDurableAchievement(state, 'local-share-export'), false,
      'a failed activity save must not leave its derived grant behind');
    assert.equal(notices.length, 0);
  }, async (key, _value, persist) => {
    if (key === 'ccu.achievements.activity.v2') throw new Error('synthetic activity save failure');
    persist();
  });
});

test('achievement persistence retries the same activity after a rejected ledger save', async () => {
  const state = achievementPersistenceState();
  let attempts = 0;
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    provider.recordAchievementFeature('localShareExport');
    await settleAchievementWrites(provider);
    assert.equal(attempts, 1);
    assert.equal(state.has('ccu.achievements.activity.v2'), false);
    assert.equal(hasDurableAchievement(state, 'local-share-export'), false);
    assert.equal(notices.length, 0);
    provider.recordAchievementFeature('localShareExport');
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    assert.equal(attempts, 2);
    assert.deepEqual((state.get('ccu.achievements.activity.v2') as { features: string[] }).features,
      ['localShareExport']);
    assert.equal(hasDurableAchievement(state, 'local-share-export'), true);
    assert.equal(notices.length, 1);
    provider.recordAchievementFeature('localShareExport');
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    assert.equal(attempts, 2, 'a successful retry must not make repeated actions write again');
    assert.equal(notices.length, 1);
  }, async (key, _value, persist) => {
    if (key === 'ccu.achievements.activity.v2') {
      attempts += 1;
      if (attempts === 1) throw new Error('synthetic first activity save failure');
    }
    persist();
  });
});

test('achievement persistence preserves and deduplicates queued settings after an earlier activity save fails', async () => {
  const state = achievementPersistenceState();
  const save = deferredAchievementSave();
  const snapshots: string[][] = [];
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    try {
      provider.recordAchievementSettingChange('compactNumbers', true);
      await flushAchievementTasks();
      assert.equal(snapshots.length, 1, 'the first ledger save must already be held');
      provider.recordAchievementSettingChange('compactNumbers', true);
      provider.recordAchievementSettingChange('decimalPlaces', true);
      provider.recordAchievementSettingChange('decimalPlaces', true);
      provider.recordAchievementSettingChange('displayCurrency', true);
      provider.recordAchievementSettingChange('language', false);
      evaluateAndDispatchAchievementNotice(provider);
      await flushAchievementTasks();
      assert.equal(snapshots.length, 1, 'later ledger saves must wait behind the first');
      assert.equal(state.has('ccu.achievements.activity.v2'), false);
      assert.equal(hasDurableAchievement(state, 'settings-explorer-bronze'), false);
      assert.equal(notices.length, 0);
    } finally {
      save.resolve();
      await settleAchievementWrites(provider);
    }
    const expected = ['compactNumbers', 'decimalPlaces', 'displayCurrency'];
    const ledger = state.get('ccu.achievements.activity.v2') as { settingKeys: string[] };
    assert.deepEqual(ledger.settingKeys, expected);
    assert.deepEqual(provider.achievementActivity.settingKeys, expected);
    assert.ok(snapshots.length <= expected.length,
      'duplicate and unchanged settings must not enqueue additional writes');
    for (const keys of snapshots) assert.equal(new Set(keys).size, keys.length);
    provider.dispatchAchievementNotice();
    assert.equal(hasDurableAchievement(state, 'settings-explorer-bronze'), true);
    assert.equal(notices.length, 1);
    const writesAfterSuccess = snapshots.length;
    provider.recordAchievementSettingChange('compactNumbers', true);
    provider.recordAchievementSettingChange('displayCurrency', false);
    await settleAchievementWrites(provider);
    assert.equal(snapshots.length, writesAfterSuccess);
    assert.equal(notices.length, 1);
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.activity.v2' && value !== undefined) {
      snapshots.push([...(value as { settingKeys: string[] }).settingKeys]);
      if (snapshots.length === 1) {
        await save.promise;
        throw new Error('synthetic held activity save failure');
      }
    }
    persist();
  });
});

test('achievement clearing discards pending unlock notices before client readiness', async () => {
  const state = achievementPersistenceState();
  state.set('ccu.achievements.grants.v5', ['hundred-million-club']);
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider, false);
    // Isolate the pending-notice lifecycle from grant-save/enqueue policy.
    provider.pendingAchievementNotice.add('hundred-million-club');
    await provider.clearAchievementGrants();
    provider.webviewClientReady = true;
    provider.dispatchAchievementNotice();
    await flushAchievementTasks();
    assert.equal(state.has('ccu.achievements.grants.v5'), false);
    assert.equal(notices.length, 0, 'client readiness must not resurrect a cleared notice');
  });
});

test('clear-all keeps achievements closed until reload despite stale display aggregates', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    setSingleVolumeAchievementFact(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), true);
    notices.length = 0;

    await provider.clearAchievementGrants({ holdUntilReload: true });
    // The source logs remain untouched; a webview render may still see the old
    // in-memory aggregate before VS Code reloads the Extension Host.
    evaluateAndDispatchAchievementNotice(provider);
    provider.recordAchievementFeature('localShareExport');
    await settleAchievementWrites(provider);
    assert.equal(state.has('ccu.achievements.grants.v5'), false);
    assert.equal(state.has('ccu.achievements.activity.v2'), false);
    assert.equal(notices.length, 0);
  });
});

test('achievement clearing invalidates a grant save already pending when clear starts', async () => {
  const state = achievementPersistenceState();
  const save = deferredAchievementSave();
  let grantSaveStarted = false;
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider, false);
    setSingleVolumeAchievementFact(provider);
    provider.achievementResults();
    await flushAchievementTasks();
    assert.equal(grantSaveStarted, true, 'the grant write must be in flight before clear');
    const clearing = provider.clearAchievementGrants();
    try {
      // Readiness may race the clear operation on either side of the held write.
      provider.allTimeData = null;
      provider.webviewClientReady = true;
      provider.dispatchAchievementNotice();
      await flushAchievementTasks();
    } finally {
      save.resolve();
      await clearing;
      await settleAchievementWrites(provider);
    }
    provider.dispatchAchievementNotice();
    await flushAchievementTasks();
    assert.equal(state.has('ccu.achievements.grants.v5'), false,
      'the old write must not repopulate grants after clear completes');
    assert.equal(notices.length, 0, 'clear must invalidate notices from the entire in-flight write');
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.grants.v5' && Array.isArray(value)) {
      grantSaveStarted = true;
      await save.promise;
    }
    persist();
  });
});

test('achievement clearing invalidates held and queued activity saves without creating grants', async () => {
  const state = achievementPersistenceState();
  const save = deferredAchievementSave();
  let activitySaves = 0;
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    provider.recordAchievementFeature('localShareExport');
    await flushAchievementTasks();
    assert.equal(activitySaves, 1, 'an activity save must already be in flight');
    provider.recordAchievementSettingChange('compactNumbers', true);
    const clearing = provider.clearAchievementGrants();
    try {
      provider.recordAchievementFeature('localAdviceFeedback');
      provider.recordAchievementSettingChange('language', true);
      evaluateAndDispatchAchievementNotice(provider);
      await flushAchievementTasks();
    } finally {
      save.resolve();
      await clearing;
      await settleAchievementWrites(provider);
    }
    provider.dispatchAchievementNotice();
    assert.equal(activitySaves, 1, 'the pre-clear queued activity must never reach storage');
    assert.equal(state.has('ccu.achievements.activity.v2'), false);
    assert.equal(state.has('ccu.achievements.grants.v5'), false);
    assert.deepEqual(provider.achievementActivity.features, []);
    assert.deepEqual(provider.achievementActivity.settingKeys, []);
    assert.equal(provider.pendingAchievementActivity, undefined);
    assert.equal(provider.achievementGrants.size, 0);
    assert.equal(notices.length, 0);
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.activity.v2' && value !== undefined) {
      activitySaves += 1;
      await save.promise;
    }
    persist();
  });
});

test('achievement clearing keeps activity closed while sibling deletions remain pending after failure', async () => {
  const state = achievementPersistenceState();
  const deletion = deferredAchievementSave();
  let grantDeletionStarted = false;
  let activitySaves = 0;
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    const clearing = provider.clearAchievementGrants();
    // Observe the rejection immediately without requiring fail-fast vs. all-settled ordering.
    const outcome = clearing.then(() => false, () => true);
    let activityCreatedDuringDeletion = false;
    try {
      await flushAchievementTasks();
      assert.equal(grantDeletionStarted, true);
      provider.recordAchievementFeature('localShareExport');
      await flushAchievementTasks();
      activityCreatedDuringDeletion = state.has('ccu.achievements.activity.v2');
    } finally {
      deletion.resolve();
      await outcome;
      await settleAchievementWrites(provider);
    }
    assert.equal(await outcome, true, 'the synthetic deletion failure must be reported');
    assert.equal(activitySaves, 0, 'clear must not reopen activity while sibling deletions are in flight');
    assert.equal(activityCreatedDuringDeletion, false);
    assert.equal(notices.length, 0);
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.grants.v5' && value === undefined) {
      grantDeletionStarted = true;
      await deletion.promise;
    }
    if (key === 'ccu.achievements.activity.v2') {
      if (value === undefined) throw new Error('synthetic activity deletion failure');
      activitySaves += 1;
    }
    persist();
  });
});

test('achievement clearing stays fail closed after partial deletion failure until a successful retry', async () => {
  const state = achievementPersistenceState();
  state.set('ccu.achievements.grants.v5', ['local-share-export']);
  state.set('ccu.achievements.activity.v2', {
    schemaVersion: 2, settingKeys: ['language'], features: ['localShareExport'],
  });
  state.set('ccu.achievements.hours.v3', { schemaVersion: 3, maxStreak: 0 });
  let deletionRejected = false;
  const savedKeys: string[] = [];
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    assert.equal(provider.achievementGrants.has('local-share-export'), true);
    await assert.rejects(provider.clearAchievementGrants(), /synthetic partial deletion failure/);
    // Both stores really were deleted; retaining old memory must not permit
    // subsequent activity to restore those entries after clear has returned.
    assert.equal(state.has('ccu.achievements.grants.v5'), false);
    assert.equal(state.has('ccu.achievements.activity.v2'), false);
    provider.recordAchievementFeature('localAdviceFeedback');
    provider.recordAchievementSettingChange('compactNumbers', true);
    setSingleVolumeAchievementFact(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    assert.deepEqual(savedKeys, [], 'failed clear must remain fenced after all deletions settle');
    assert.equal(state.has('ccu.achievements.activity.v2'), false, 'the old ledger must not be restored');
    assert.equal(state.has('ccu.achievements.grants.v5'), false, 'no awards may be saved after failed clear');
    assert.equal(notices.length, 0);

    provider.allTimeData = null;
    await provider.clearAchievementGrants();
    await settleAchievementWrites(provider);
    assert.equal(state.has('ccu.achievements.grants.v5'), false);
    assert.equal(state.has('ccu.achievements.activity.v2'), false);
    assert.equal(state.has('ccu.achievements.hours.v3'), false);
    assert.equal(provider.achievementGrants.size, 0);
    assert.deepEqual(provider.achievementActivity.features, []);
    assert.deepEqual(provider.achievementActivity.settingKeys, []);

    provider.recordAchievementFeature('localAdviceFeedback');
    await settleAchievementWrites(provider);
    provider.dispatchAchievementNotice();
    const ledger = state.get('ccu.achievements.activity.v2') as {
      features: string[]; settingKeys: string[];
    };
    assert.deepEqual(ledger.features, ['localAdviceFeedback']);
    assert.deepEqual(ledger.settingKeys, [], 'actions attempted while fenced must not replay after retry');
    assert.equal(hasDurableAchievement(state, 'local-advice-feedback'), true);
    assert.equal(hasDurableAchievement(state, 'local-share-export'), false);
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), false);
    assert.equal(notices.length, 1, 'successful clear retry must allow newly recorded activity again');
  }, async (key, value, persist) => {
    if (key === 'ccu.achievements.hours.v3' && value === undefined && !deletionRejected) {
      deletionRejected = true;
      throw new Error('synthetic partial deletion failure');
    }
    if (value !== undefined &&
        (key === 'ccu.achievements.grants.v5' || key === 'ccu.achievements.activity.v2')) {
      savedKeys.push(key);
    }
    persist();
  });
});

test('all achievement titles exist in each of the eight UI locales', () => {
  assert.equal(Object.keys(ACHIEVEMENT_COPY).length, 8);
  for (const copy of Object.values(ACHIEVEMENT_COPY)) {
    assert.ok(copy.lowerBoundNote.trim().includes('≥'));
    assert.deepEqual(Object.keys(copy.titles).sort(), ACHIEVEMENT_DEFINITIONS.map((entry) => entry.id).sort());
    assert.ok(Object.values(copy.titles).every((title) => title.trim().length > 0));
    assert.equal(copy.levels.length, 5);
    assert.ok(copy.levels.every((level) => level.trim().length > 0));
    assert.ok(copy.milestone.trim());
  }
});

test('host achievement share forwards the selected locale and earned level labels', async () => {
  const language = I18n.getCurrentLanguage();
  try {
    for (const locale of Object.keys(ACHIEVEMENT_COPY) as Array<keyof typeof ACHIEVEMENT_COPY>) {
      I18n.setLanguage(locale);
      const copy = ACHIEVEMENT_COPY[locale];
      await withProvider(achievementPersistenceState(), async (provider) => {
        provider.earnedAchievements = () => [{ id: 'weekly-volume-gold', group: 'combined',
          progress: 10_000_000_000, target: 10_000_000_000, unlocked: true }];
        const svg = provider.achievementShareSvg(['weekly-volume-gold']);
        assert.ok(svg.includes(copy.groups.combined));
        assert.ok(svg.includes(copy.levels[2]));
        assert.ok(svg.includes(copy.heading));
        assert.doesNotMatch(svg, /local achievement milestones|>combined</);
      });
    }
  } finally {
    I18n.setLanguage(language);
  }
});

test('output and cache cards use their specific Token units in every locale', async () => {
  const language = I18n.getCurrentLanguage();
  try {
    for (const locale of Object.keys(ACHIEVEMENT_COPY) as Array<keyof typeof ACHIEVEMENT_COPY>) {
      I18n.setLanguage(locale);
      const copy = ACHIEVEMENT_COPY[locale];
      await withProvider(achievementPersistenceState(), async (provider) => {
        provider.settings = { get: () => true };
        provider.providerAvailability = { claude: true, codex: false, codexData: false };
        provider.allTimeData = { totalInputTokens: 0, totalOutputTokens: 0,
          totalCacheCreationTokens: 0, totalCacheReadTokens: 0, modelBreakdown: {} };
        const html = provider.renderAchievementData();
        for (const [series, unit] of [
          ['claude-output', copy.units.outputTokens],
          ['cache-wizard', copy.units.cacheReadTokens],
          ['claude-cache-creation', copy.units.cacheCreationTokens],
        ]) {
          assert.equal(typeof unit, 'string', `${locale}: missing unit for ${series}`);
          const label = html.match(new RegExp(`data-achievement-series="${series}"[\\s\\S]*?<label[^>]*>([^<]+)`))?.[1];
          assert.ok(label?.endsWith(' ' + unit), `${locale}: ${series} unit is not processed volume`);
        }
      });
    }
  } finally {
    I18n.setLanguage(language);
  }
});

test('earned achievements survive a dashboard reload without source logs', async () => {
  const state = new Map<string, unknown>();
  const language = I18n.getCurrentLanguage();
  try {
    I18n.setLanguage('en');
    await withProvider(state, async (provider) => {
      provider.settings = { get: () => true };
      provider.providerAvailability = { claude: true, codex: false, codexData: false };
      provider.allTimeData = {
        totalInputTokens: 100_000_000, totalOutputTokens: 1,
        totalCacheCreationTokens: 0, totalCacheReadTokens: 0,
        modelBreakdown: { 'claude-sonnet-4-5': {
          inputTokens: 100_000_000, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0,
        } },
      };
      const html = provider.renderAchievementData();
      assert.match(html, /data-achievement-series="sonnet-main"[^>]*data-achievement-id="sonnet-main"/);
      assert.equal(html.includes('data-achievement-series="fable-sessions"'), true);
      assert.match(html, /data-achievement-icon="sonnet-main"/);
      assert.match((html.match(/class="achievement-count"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '').replace(/<[^>]+>/g,''),
        /^2 \/ \d+ series · 2 \/ \d+ levels$/);
      await provider.achievementWrite;
      assert.ok((state.get('ccu.achievements.grants.v5') as string[]).includes('sonnet-main'));
      assert.equal(state.get('ccu.achievements.calibrationAudit.v1'), true);
    });
    await withProvider(state, async (provider) => {
      provider.settings = { get: () => true };
      provider.providerAvailability = { claude: true, codex: false, codexData: false };
      const html = provider.renderAchievementData();
      assert.match(html, /achievement-card earned" data-achievement-series="sonnet-main"[^>]*data-achievement-id="sonnet-main"/);
      assert.match((html.match(/class="achievement-count"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '').replace(/<[^>]+>/g,''),
        /^2 \/ \d+ series · 2 \/ \d+ levels$/);
    });
  } finally {
    I18n.setLanguage(language);
  }
});

test('Codex gallery keeps verified-task and agent-series cards visible', async () => {
  await withProvider(new Map(), async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    const html = provider.renderAchievementData();
    assert.equal(html.includes('data-achievement-series="root-portfolio"'), true);
    assert.equal(html.includes('data-achievement-series="agent-conductor"'), true);
  });
});

test('new Codex structure tiers wait for complete, identity-safe indexing', async () => {
  await withProvider(new Map(), async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    const file = (key: string, parent?: string): CodexFileAggregate => {
      const tokens = { inputTotal: 0, outputTotal: 20_000 };
      return { total: { ...tokens }, byModel: { 'gpt-6.1-sol': { ...tokens } }, byEffort: {}, byDay: {},
        session: { sessionKey: key, role: parent ? 'subagent' : 'root', ...(parent ? { parentSessionKey: parent } : {}) },
        structural: { patchCalls: 0, toolCalls: 0, postPatchToolCalls: 0, compactCount: 0, taskCompleteCount: 0 } };
    };
    const tasks = Array.from({ length: 50 }, (_, task) => [file(`task-${task}`),
      ...Array.from({ length: 8 }, (_, member) => file(`member-${task}-${member}`, `task-${task}`))]).flat();
    provider.codexAchievementSignals = codexModelSignals(tasks);
    // This case requires global identity/completeness proof; a separately
    // verified subset has its own independent award eligibility tests.
    provider.codexAchievementSignals.verifiedSubset = false;
    assert.deepEqual(provider.codexAchievementSignals.collaboration.teamTaskCounts, [50, 50, 50]);
    provider.codexView = {
      currentManifestVerified: true,
      coverage: { complete: true, identity: { complete: false } },
      allTime: { total: { processed: 9_000_000, output: 9_000_000 } },
      periodCoverage: { allTime: { complete: true } },
      allTimeDaily: [],
      outputHourProof: { complete: false, hours: [], provenFiles: 0, totalFiles: 1 },
      hourlyCoverage: { complete: false, timeZone: 'UTC' },
      last30DaysHourlyByDay: {},
    };
    const results = () => new Map(provider.achievementResults().map((row: any) => [row.id, row]));
    assert.equal((results().get('agent-team-gold') as any)?.unlocked, false);
    provider.codexView.coverage.identity.complete = true;
    provider.codexView.coverage.complete = false;
    assert.equal((results().get('agent-team-gold') as any)?.unlocked, false);
    provider.codexView.coverage.complete = true;
    assert.equal((results().get('agent-team-gold') as any)?.unlocked, true);
  });
});

test('turning achievements off stops evaluation and new grants', async () => {
  const state = new Map<string, unknown>();
  await withProvider(state, async (provider) => {
    provider.settings = { get: (key: string) => key === 'enableAchievements' ? false : true };
    provider.allTimeData = {
      totalInputTokens: 100_000_000_000, totalOutputTokens: 0,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0, modelBreakdown: {},
    };
    assert.deepEqual(provider.achievementResults(), []);
    assert.equal(state.has('ccu.achievements.grants.v5'), false);
  });
});

test('a proxy name containing Sonnet does not grant a Claude family badge', async () => {
  await withProvider(new Map(), async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: true, codex: false, codexData: false };
    provider.allTimeData = {
      totalInputTokens: 100_000_000, totalOutputTokens: 1,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0,
      modelBreakdown: { 'custom-sonnet-proxy': {
        inputTokens: 100_000_000, outputTokens: 1,
        cacheCreationTokens: 0, cacheReadTokens: 0,
      } },
    };
    const byId = new Map(provider.achievementResults().map((result: any) => [result.id, result]));
    assert.equal((byId.get('sonnet-main') as any)?.unlocked, false);
  });
});

test('resetting sharing preferences forgets badge picks but keeps earned grants', async () => {
  const state = achievementPersistenceState();
  state.set('ccu.achievements.grants.v5', ['sonnet-main']);
  await withProvider(state, async (provider) => {
    provider.achievementShareSelection = ['sonnet-main'];
    provider.clearSharingRuntimeState();
    await settleAchievementWrites(provider);
    assert.equal(provider.achievementShareSelection, undefined);
    assert.deepEqual([...provider.achievementGrants], ['sonnet-main']);
    assert.deepEqual(state.get('ccu.achievements.grants.v5'), ['sonnet-main']);
  });
});

test('clear achievements removes the bounded action ledger as well as awards', async () => {
  const state = new Map<string, unknown>([
    ['ccu.achievements.grants.v5', ['sonnet-main']],
    ['ccu.achievements.activity.v2', { schemaVersion: 2, settingKeys: ['language'], features: ['localShareExport'] }],
    ['ccu.achievements.hours.v2', { schemaVersion: 2, maxStreak: 24 }],
    ['ccu.achievements.hours.v3', { schemaVersion: 3, maxStreak: 24 }],
  ]);
  await withProvider(state, async (provider) => {
    await provider.clearAchievementGrants();
    assert.equal(state.has('ccu.achievements.activity.v2'), false);
    assert.equal(state.has('ccu.achievements.grants.v5'), false);
    assert.equal(state.has('ccu.achievements.hours.v2'), false);
    assert.equal(state.has('ccu.achievements.hours.v3'), false);
    assert.deepEqual(provider.achievementActivity.settingKeys, []);
  });
});

test('easy v1 grants do not silently unlock the rebalanced v2 gallery', async () => {
  const state = new Map<string, unknown>([['ccu.achievements.grants.v1', ['astra-regular']]]);
  await withProvider(state, async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    const html = provider.renderAchievementData();
    assert.match(html, /achievement-card locked" data-achievement-series="astra-regular"[^>]*data-achievement-id="astra-regular"/);
    assert.equal(state.has('ccu.achievements.grants.v5'), false);
  });
});

test('pre-audit v2 grants and hour streaks cannot preserve an unverified award', async () => {
  const state = new Map<string, unknown>([
    ['ccu.achievements.grants.v2', ['output-hours-gold', 'ten-billion-token-club']],
    ['ccu.achievements.hours.v1', { schemaVersion: 1, maxStreak: 48 }],
  ]);
  await withProvider(state, async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: true, codex: false, codexData: false };
    const byId = new Map(provider.achievementResults().map((result: any) => [result.id, result]));
    assert.equal((byId.get('output-hours-gold') as any).unlocked, false);
    assert.equal(provider.achievementGrants.has('output-hours-gold'), false);
    assert.equal(provider.achievementGrants.has('ten-billion-token-club'), false);
    assert.equal(provider.achievementHourEvidence.maxStreak, 0);
  });
});

test('v3 candidate awards recheck ambiguous days and restored previews on upgrade', async () => {
  const state = new Map<string, unknown>([
    // Isolate this older migration from the independently tested calibration audit.
    ['ccu.achievements.calibrationAudit.v1', true],
    ['ccu.achievements.grants.v3', ['sonnet-main', 'active-day-streak', 'safe-feature-explorer']],
    ['ccu.achievements.activity.v1', {
      schemaVersion: 1,
      settingKeys: ['language'],
      features: ['achievementGalleryViewed', 'achievementSharePreview', 'localShareExport'],
    }],
  ]);
  await withProvider(state, async (provider) => {
    await Promise.all([provider.achievementWrite, provider.achievementActivityWrite]);
    assert.deepEqual(state.get('ccu.achievements.grants.v5'), ['sonnet-main']);
    assert.equal(state.has('ccu.achievements.grants.v3'), false);
    assert.deepEqual((state.get('ccu.achievements.activity.v2') as any)?.features,
      ['achievementGalleryViewed', 'localShareExport']);
    assert.equal(state.has('ccu.achievements.activity.v1'), false);
  });
});

test('v4 candidate migration rechecks hour and Codex-structure badges without losing unrelated awards', async () => {
  const state = new Map<string, unknown>([
    ['ccu.achievements.calibrationAudit.v1', true],
    ['ccu.achievements.grants.v4', [
      'sonnet-main', 'agent-conductor', 'astra-regular', 'output-hours-bronze',
      'active-days-bronze', 'fable-relay',
    ]],
    ['ccu.achievements.hours.v2', { schemaVersion: 2, maxStreak: 48 }],
  ]);
  await withProvider(state, async (provider) => {
    await Promise.all([provider.achievementWrite, provider.achievementHourWrite]);
    assert.deepEqual(state.get('ccu.achievements.grants.v5'), ['fable-relay', 'sonnet-main']);
    assert.equal(state.has('ccu.achievements.grants.v4'), false);
    assert.equal(state.has('ccu.achievements.hours.v2'), false);
    assert.equal(provider.achievementHourEvidence.maxStreak, 0);
  });
});

test('Token-rule migration rechecks former root-count grants, preserving unrelated earned milestones', async () => {
  const state = new Map<string, unknown>([
    ['ccu.achievements.grants.v5', ['sonnet-main', 'astra-regular-gold', 'effort-spectrum',
      'model-rainbow', 'hundred-million-club', 'ten-million-club', 'agent-standup']],
    ['ccu.achievements.structuralAudit.v1', true],
    ['ccu.achievements.bucketAudit.v1', true],
    ['ccu.achievements.calibrationAudit.v1', true],
  ]);
  await withProvider(state, async (provider) => {
    assert.deepEqual([...provider.achievementGrants].sort(), ['hundred-million-club', 'sonnet-main']);
    assert.ok(provider.achievementLegacyRuleGrants.includes('agent-standup'), 'changed old proof is retained for the archive');
    await settleAchievementWrites(provider);
    assert.deepEqual(state.get('ccu.achievements.grants.v5'), ['agent-standup', 'hundred-million-club', 'sonnet-main']);
    assert.equal(state.get('ccu.achievements.tokenAudit.v1'), true);
  });
});

test('calendar-proof migration rechecks only date-sensitive grants and remains retryable on failed save', async () => {
  for (const fail of [false, true]) {
    const state = achievementPersistenceState();
    state.delete('ccu.achievements.calendarAudit.v1');
    state.set('ccu.achievements.grants.v5', ['sonnet-main', 'local-share-export',
      'fable-days-gold', 'weekly-volume-gold', 'active-day-streak', 'streak-machine']);
    const writes: string[] = [];
    await withProvider(state, async (provider) => {
      await settleAchievementWrites(provider);
      assert.deepEqual([...provider.achievementGrants].sort(), ['local-share-export', 'sonnet-main']);
      assert.equal(state.get('ccu.achievements.calendarAudit.v1'), fail ? undefined : true);
      if (!fail) {
        assert.deepEqual(writes, ['ccu.achievements.grants.v5', 'ccu.achievements.calendarAudit.v1']);
        await provider.clearAchievementGrants();
        assert.equal(state.has('ccu.achievements.calendarAudit.v1'), false);
      }
    }, async (key, _value, persist) => {
      writes.push(key);
      if (fail && key === 'ccu.achievements.grants.v5') throw new Error('synthetic calendar-save failure');
      persist();
    });
  }
});

test('bucket-proof migration rechecks only structural Codex grants and saves before its marker', async () => {
  const state = achievementPersistenceState();
  state.delete('ccu.achievements.bucketAudit.v1');
  state.set('ccu.achievements.grants.v5', [
    'sonnet-main', 'hundred-million-club', 'astra-regular-gold', 'effort-spectrum',
    'agent-standup', 'root-portfolio-gold', 'same-root-models-gold',
  ]);
  const writes: string[] = [];
  await withProvider(state, async (provider) => {
    await settleAchievementWrites(provider);
    assert.deepEqual([...provider.achievementGrants].sort(), [
      'astra-regular-gold', 'hundred-million-club', 'sonnet-main',
    ]);
    assert.ok(provider.achievementLegacyRuleGrants.includes('effort-spectrum'), 'changed effort proof cannot authorize the current rule');
    assert.deepEqual(state.get('ccu.achievements.grants.v5'), [
      'astra-regular-gold', 'effort-spectrum', 'hundred-million-club', 'sonnet-main',
    ]);
    assert.equal(state.get('ccu.achievements.bucketAudit.v1'), true);
    assert.deepEqual(writes, ['ccu.achievements.grants.v5', 'ccu.achievements.bucketAudit.v1']);
    await provider.clearAchievementGrants();
    assert.equal(state.has('ccu.achievements.bucketAudit.v1'), false);
    assert.equal(state.has('ccu.achievements.structuralAudit.v1'), false);
    assert.equal(state.has('ccu.achievements.tokenAudit.v1'), false);
  }, async (key, _value, persist) => { writes.push(key); persist(); });
});

test('manifest-proof migration discards cached hour maxima and portraits without losing unrelated awards', async () => {
  const state = achievementPersistenceState();
  state.delete('ccu.achievements.manifestAudit.v1');
  state.set('ccu.achievements.grants.v5', ['sonnet-main', 'hundred-million-club',
    'output-hours-bronze', 'output-hours-silver', 'output-hours-gold', 'night-output-peak']);
  state.set('ccu.achievements.hours.v3', { schemaVersion: 3, maxStreak: 48 });
  const writes: string[] = [];
  await withProvider(state, async (provider) => {
    await settleAchievementWrites(provider);
    assert.deepEqual([...provider.achievementGrants].sort(), ['hundred-million-club', 'sonnet-main']);
    assert.equal(provider.achievementHourEvidence.maxStreak, 0);
    assert.deepEqual(state.get('ccu.achievements.hours.v3'), { schemaVersion: 3, maxStreak: 0 });
    assert.equal(state.get('ccu.achievements.manifestAudit.v1'), true);
    assert.deepEqual(writes, ['ccu.achievements.grants.v5', 'ccu.achievements.hours.v3',
      'ccu.achievements.manifestAudit.v1']);
    await provider.clearAchievementGrants();
    assert.equal(state.has('ccu.achievements.manifestAudit.v1'), false);
  }, async (key, _value, persist) => { writes.push(key); persist(); });
});

for (const failedKey of ['ccu.achievements.grants.v5', 'ccu.achievements.hours.v3',
  'ccu.achievements.manifestAudit.v1']) {
  test(`manifest-proof migration observes idle storage failure at ${failedKey} without marking success`, () => {
    // A fresh strict-mode process catches idle unhandled rejections without
    // node:test turning our intentional fault into unrelated suite failures.
    const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', `
      const assert = require('node:assert/strict');
      const Module = require('node:module');
      ${withProvider.toString()}
      ${achievementPersistenceState.toString()}
      const state = achievementPersistenceState();
      state.delete('ccu.achievements.manifestAudit.v1');
      state.set('ccu.achievements.grants.v5', ['sonnet-main', 'output-hours-gold']);
      state.set('ccu.achievements.hours.v3', { schemaVersion: 3, maxStreak: 48 });
      const failedKey = process.argv[1];
      const writes = [];
      const fault = new Error('synthetic manifest migration save failure');
      withProvider(state, async (provider) => {
        // Give startup two idle turns with no caller observing/clearing writes.
        await new Promise(setImmediate);
        await new Promise(setImmediate);
        const settled = await Promise.allSettled([
          provider.achievementWrite, provider.achievementHourWrite,
        ]);
        assert.ok(settled.every((result) => result.status === 'rejected' && result.reason === fault),
          'terminal observers must leave the original migration failure observable');
        assert.equal(state.has('ccu.achievements.manifestAudit.v1'), false);
        const order = ['ccu.achievements.grants.v5', 'ccu.achievements.hours.v3',
          'ccu.achievements.manifestAudit.v1'];
        assert.deepEqual(writes, order.slice(0, order.indexOf(failedKey) + 1));
        assert.deepEqual(state.get('ccu.achievements.grants.v5'),
          failedKey === order[0] ? ['sonnet-main', 'output-hours-gold'] : ['sonnet-main']);
        assert.equal(state.get('ccu.achievements.hours.v3').maxStreak,
          failedKey === order[2] ? 0 : 48);
        // The absent marker must allow a clean startup to retry the migration.
        await withProvider(state, async (reloaded) => {
          await Promise.all([reloaded.achievementWrite, reloaded.achievementHourWrite]);
          assert.equal(state.get('ccu.achievements.manifestAudit.v1'), true);
          assert.deepEqual(state.get('ccu.achievements.grants.v5'), ['sonnet-main']);
          assert.deepEqual(state.get('ccu.achievements.hours.v3'), { schemaVersion: 3, maxStreak: 0 });
        });
      }, async (key, value, persist) => {
        if (key.startsWith('ccu.achievements.')) {
          writes.push(key);
          if (key === failedKey) throw fault;
        }
        persist();
      }).catch((error) => { console.error(error); process.exitCode = 1; });
    `, failedKey], { cwd: __dirname, encoding: 'utf8', timeout: 10_000 });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.equal(child.signal, null);
    assert.equal(child.stderr, '');
  });
}

test('cumulative card keeps the earned title and five levels, while progress points at the next tier', async () => {
  await withProvider(achievementPersistenceState(), async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: true, codex: false, codexData: false };
    provider.allTimeData = {
      totalInputTokens: 37_000_000_000, totalOutputTokens: 0,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0, modelBreakdown: {},
    };
    const html = provider.renderAchievementData();
    const card = html.match(/<article[^>]*data-achievement-series="cumulative-volume"[\s\S]*?<\/article>/)?.[0] ?? '';
    assert.equal((html.match(/data-achievement-series="cumulative-volume"/g) ?? []).length, 1);
    assert.match(card, /data-achievement-id="ten-billion-token-club"/);
    assert.match(card, /data-achievement-tier="gold"/);
    assert.match(card, /3\/5/);
    assert.match(card, /max="100000000000"/);
    assert.match(card, />V<\/span>/);
    assert.doesNotMatch(html, /data-achievement-id="ten-million-club"/);
  });
});

test('a retained high-level grant displays its actual tier without inventing missing lower grants', async () => {
  const state = achievementPersistenceState();
  state.set('ccu.achievements.grants.v5', ['hundred-billion-token-club']);
  await withProvider(state, async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: true, codex: false, codexData: false };
    const card = provider.renderAchievementData()
      .match(/<article[^>]*data-achievement-series="cumulative-volume"[\s\S]*?<\/article>/)?.[0]
      ?.replace(/src="[^"]*"/g, 'src="[omitted]"') ?? '';
    assert.match(card, /data-achievement-id="hundred-billion-token-club"/);
    assert.match(card, /data-achievement-tier="platinum"/);
    assert.match(card, /data-achievement-proof="pending"/);
    assert.doesNotMatch(card, /<progress/);
    assert.match(card, /Shared conditions: processed tokens/);
    assert.match(card, /data-achievement-level="trillion-token-club"[\s\S]*?<span class="achievement-level-value">1T<\/span>/);
    assert.match(card, /achievement-tier-marker complete">IV<\/span>/);
    assert.match(card, /achievement-tier-marker next">V<\/span>/);
    assert.doesNotMatch(card, /achievement-tier-marker complete">I<\/span>/);
    assert.deepEqual([...provider.achievementGrants], ['hundred-billion-token-club']);
  });
});

test('one-time identity audit rechecks earlier Codex grants without erasing Claude awards', async () => {
  const state = new Map<string, unknown>([
    ['ccu.achievements.calibrationAudit.v1', true],
    ['ccu.achievements.grants.v5', ['sonnet-main', 'agent-standup', 'model-rainbow']],
  ]);
  await withProvider(state, async (provider) => {
    assert.deepEqual([...provider.achievementGrants], ['sonnet-main']);
    await provider.achievementWrite;
    assert.deepEqual(state.get('ccu.achievements.grants.v5'), ['sonnet-main']);
    assert.equal(state.get('ccu.achievements.structuralAudit.v1'), true);
  });
  await withProvider(state, async (provider) => {
    assert.deepEqual([...provider.achievementGrants], ['sonnet-main']);
  });
});

test('manual calibration keeps pending evaluation read-only; successful history commit preserves old dates and unread', async () => {
  await withAchievementStorage(async directory=>{
    await withProvider(achievementPersistenceState(),async provider=>{
      await provider.achievementWrite;
      provider.achievementResults();await provider.achievementWrite;
      const repository=provider.achievementRecordRepository;
      const initial=await repository.append(provider.achievementRecordState.generation,[{
        id:'hundred-million-club',origin:'usage',recordedDay:'2026-05-01',timeZone:'UTC'}]);
      provider.achievementRecordState=initial.store;
      provider.achievementGrants=new Set(initial.store.records.map((r:any)=>r.id));
      const original=structuredClone(initial.store.records);
      provider.settings={get:(key:string)=>key==='enableAchievements'};
      provider.providerAvailability={claude:true,codex:false,codexData:false};
      provider.achievementCalendarTimeZone='UTC';
      const day=(n:number)=>({totalInputTokens:n,totalOutputTokens:0,totalCacheCreationTokens:0,totalCacheReadTokens:0,modelBreakdown:{}});
      provider.allTimeData=day(1_100_000_000);
      provider.dailyDataForEveryDay=[{date:'2026-06-01',data:day(100_000_000)},{date:'2026-06-03',data:day(1_000_000_000)}];
      const zone=I18n.getTimezone();I18n.setTimezone('UTC');
      try{
        provider.setAchievementCalibrationState(true);
        provider.achievementResults();await provider.achievementWrite;
        assert.deepEqual(provider.achievementRecordState.records,original,'pending refresh cannot commit new awards');
        assert.equal(await provider.recalibrateAchievementsFromCurrentData(()=>true),true);
        const saved=JSON.parse(await readFile(repository.file,'utf8'));
        assert.deepEqual(saved.records.find((r:any)=>r.id==='hundred-million-club'),original[0]);
        const added=saved.records.find((r:any)=>r.id==='billion-token-club');
        assert.ok(added);assert.equal(added.origin,'history');assert.equal(added.unread,false);
        assert.equal(added.recordedDay,null);assert.equal(added.timeZone,null);
        assert.equal(provider.achievementHistoryAnnotations['billion-token-club'].day,'2026-06-03');
        assert.equal(provider.achievementCalibrationCompleted,true);
      }finally{provider.setAchievementCalibrationState(false);I18n.setTimezone(zone);}
    },undefined,directory);
  });
});
test('manual calibration rejects cancelled and failed commits without changing grants or a ready notice baseline', async () => {
 await withAchievementStorage(async directory=>{
  await withProvider(achievementPersistenceState(),async provider=>{
   await provider.achievementWrite;provider.achievementResults();await provider.achievementWrite;
   const before=structuredClone(provider.achievementRecordState);
   const baseline=provider.achievementNoticeBaseline;
   const {ACHIEVEMENT_EVIDENCE_DOMAINS}=require('../achievementEvidence');
   baseline.accept(Object.fromEntries(ACHIEVEMENT_EVIDENCE_DOMAINS.map((d:string)=>[d,d==='claude-usage'?'ready':'pending'])));
   provider.settings={get:(key:string)=>key==='enableAchievements'};
   provider.providerAvailability={claude:true,codex:false,codexData:false};
   provider.allTimeData={totalInputTokens:1e9,totalOutputTokens:0,totalCacheCreationTokens:0,totalCacheReadTokens:0,modelBreakdown:{}};
   provider.setAchievementCalibrationState(true);
   assert.equal(baseline.isReady('claude-usage'),true);
   await assert.rejects(provider.recalibrateAchievementsFromCurrentData(()=>false),/retired/);
   assert.deepEqual(provider.achievementRecordState,before);
   const append=provider.achievementRecordRepository.append;
   provider.achievementRecordRepository.append=async()=>{throw Error('synthetic-save-failure');};
   try{
    await assert.rejects(provider.recalibrateAchievementsFromCurrentData(()=>true),/retired/);
    assert.deepEqual(provider.achievementRecordState,before);
    assert.deepEqual([...provider.achievementGrants],before.records.map((r:any)=>r.id));
    assert.equal(baseline.isReady('claude-usage'),true);
    assert.equal(provider.achievementCalibrationCompleted,false);
   }finally{provider.achievementRecordRepository.append=append;provider.setAchievementCalibrationState(false,true);}
  },undefined,directory);
 });
});

for(const ending of ['cancelled','failed']as const)test('calibration '+ending+' preserves a producer-proven native first-recorded receipt',async()=>{
 await withAchievementStorage(async directory=>{
  await withProvider(achievementPersistenceState(),async provider=>{
   await provider.achievementWrite;provider.achievementResults();await provider.achievementWrite;
   provider.settings={get:(key:string)=>key==='enableAchievements'};
   provider.providerAvailability={claude:true,codex:false,codexData:false};
   const zone=I18n.getTimezone();I18n.setTimezone('UTC');
   const snapshot=(input:number)=>({allTime:{totalInputTokens:input,totalOutputTokens:0,totalCacheCreationTokens:0,totalCacheReadTokens:0,
     modelBreakdown:{'claude-sonnet-4-5':{inputTokens:input,outputTokens:0,cacheCreationTokens:0,cacheReadTokens:0,cost:0,count:1}}},
    days:[],sessions:[],sessionEvidence:{outputSessions:0,fableOutputSessions:0,fableMixedFamilySession:false},records:[],timeZone:'UTC'});
   provider.acceptedClaudeAchievement=snapshot(99_000_000);
   provider.claudeAchievementObservedThrough=Date.now()-60_000;
   let taskCurrent=true;
   try{
    provider.setAchievementCalibrationState(true);
    const handle=await provider.beginClaudeAchievementObservation(()=>taskCurrent,()=>true);
    assert.ok(handle?.window,'calibration must retain real producer observation windows');
    provider.acceptClaudeAchievementSnapshot(snapshot(100_000_000),handle,{provider:'claude',...handle.window,
     processed:1_000_000,output:0,cacheRead:0,cacheCreation:0,
     families:{sonnet:1_000_000,opus:0,haiku:0,fable:0}});
    await provider.achievementWrite;
    assert.ok(!provider.achievementGrants.has('sonnet-main'),'receipt is staged while calibration is pending');
    taskCurrent=false;
    provider.setAchievementCalibrationState(false,ending==='failed');
    await provider.achievementWrite;
    const saved=JSON.parse(await readFile(provider.achievementRecordRepository.file,'utf8'));
    const record=saved.records.find((r:any)=>r.id==='sonnet-main');
    assert.ok(record);assert.equal(record.origin,'usage');
    assert.ok(record.recordedDay);assert.equal(record.timeZone,'UTC');assert.equal(record.unread,true);
   }finally{I18n.setTimezone(zone);}
  },undefined,directory);
 });
});
test('a flushed native receipt does not count as a cancelled history calibration commit',async()=>{
 await withAchievementStorage(async directory=>{
  await withProvider(achievementPersistenceState(),async provider=>{
   await provider.achievementWrite;provider.achievementResults();await provider.achievementWrite;
   provider.settings={get:(key:string)=>key==='enableAchievements'};
   provider.providerAvailability={claude:true,codex:false,codexData:false};
   const zone=I18n.getTimezone();I18n.setTimezone('UTC');
   const snapshot=(input:number)=>({allTime:{totalInputTokens:input,totalOutputTokens:0,totalCacheCreationTokens:0,totalCacheReadTokens:0,
     modelBreakdown:{'claude-sonnet-4-5':{inputTokens:input,outputTokens:0,cacheCreationTokens:0,cacheReadTokens:0,cost:0,count:1}}},
    days:[],sessions:[],sessionEvidence:{outputSessions:0,fableOutputSessions:0,fableMixedFamilySession:false},records:[],timeZone:'UTC'});
   provider.acceptedClaudeAchievement=snapshot(99_000_000);
   provider.claudeAchievementObservedThrough=Date.now()-60_000;
   let current=true;
   const evaluate=provider.achievementResults.bind(provider);
   try{
    provider.setAchievementCalibrationState(true);
    const handle=await provider.beginClaudeAchievementObservation(()=>current,()=>true);
    assert.ok(handle?.window);
    provider.acceptClaudeAchievementSnapshot(snapshot(100_000_000),handle,{provider:'claude',...handle.window,
     processed:1_000_000,output:0,cacheRead:0,cacheCreation:0,families:{sonnet:1_000_000,opus:0,haiku:0,fable:0}});
    await provider.achievementWrite;
    provider.acceptedClaudeAchievement=snapshot(1_000_000_000);
    provider.achievementResults=()=>{const results=evaluate();current=false;return results;};
    await assert.rejects(provider.recalibrateAchievementsFromCurrentData(()=>current),/retired/);
    const saved=JSON.parse(await readFile(provider.achievementRecordRepository.file,'utf8'));
    const native=saved.records.find((r:any)=>r.id==='sonnet-main');
    assert.ok(native);assert.equal(native.origin,'usage');assert.ok(native.recordedDay);assert.equal(native.unread,true);
    assert.ok(!saved.records.some((r:any)=>r.id==='billion-token-club'));
    assert.equal(provider.achievementCalibrationPartial,false);
    assert.equal(provider.achievementCalibrationCompleted,false);
   }finally{provider.achievementResults=evaluate;provider.setAchievementCalibrationState(false);I18n.setTimezone(zone);}
  },undefined,directory);
 });
});
test('partial history save is reported as partial, not failed or wholly complete',async()=>{
 await withAchievementStorage(async directory=>{
  await withProvider(achievementPersistenceState(),async provider=>{
   await provider.achievementWrite;provider.achievementResults();await provider.achievementWrite;
   provider.settings={get:(key:string)=>key==='enableAchievements'};
   provider.providerAvailability={claude:true,codex:false,codexData:false};
   provider.allTimeData={totalInputTokens:100_000_000,totalOutputTokens:0,totalCacheCreationTokens:0,totalCacheReadTokens:0,
    modelBreakdown:{'claude-sonnet-4-5':{inputTokens:100_000_000,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0}}};
   const repository=provider.achievementRecordRepository;
   const {claudeAchievementMoneyScopes}=require('../achievementMoneyScopes');
   provider.claudeAchievementMoney=claudeAchievementMoneyScopes({backend:'anthropic',asOfDay:'2026-10-14',
    allTimeModels:{'claude-sonnet-4-5':{inputTokens:100_000_000,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,
     referenceUsage:{inputTokens:100_000_000,outputTokens:0,cacheReadTokens:0,cacheCreation5mTokens:0,cacheCreation1hTokens:0}}}});
   const evaluate=provider.achievementResults.bind(provider);
   provider.achievementResults=()=>{
    const results=evaluate();
    if(provider.achievementCalibrationCommitting){
     provider.achievementMoneyFacts.claude={...provider.achievementMoneyFacts.claude,pricebookVersion:'superseded-before-write'};
    }
    return results;
   };
   provider.setAchievementCalibrationState(true);
   try{
    assert.equal(await provider.recalibrateAchievementsFromCurrentData(()=>true),'partial');
    const saved=JSON.parse(await readFile(repository.file,'utf8'));
    assert.ok(saved.records.length>0);
    assert.ok(saved.records.every((r:any)=>!r.id.startsWith('claude-api-')));
    assert.equal(provider.achievementCalibrationPartial,true);
    assert.equal(provider.achievementCalibrationCompleted,false);
   }finally{provider.achievementResults=evaluate;provider.setAchievementCalibrationState(false);}
  },undefined,directory);
 });
});
test('a committed history write followed by proof retirement is reported as saved partial work',async()=>{
 await withAchievementStorage(async directory=>{
  await withProvider(achievementPersistenceState(),async provider=>{
   await provider.achievementWrite;provider.achievementResults();await provider.achievementWrite;
   provider.settings={get:(key:string)=>key==='enableAchievements'};
   provider.providerAvailability={claude:true,codex:false,codexData:false};
   provider.allTimeData={totalInputTokens:1e9,totalOutputTokens:0,totalCacheCreationTokens:0,totalCacheReadTokens:0,modelBreakdown:{}};
   const repository=provider.achievementRecordRepository,append=repository.append.bind(repository);
   repository.append=async(...args:any[])=>{const saved=await append(...args);provider.invalidateAchievementEvidence('codex');return saved;};
   provider.setAchievementCalibrationState(true);
   try{
    assert.equal(await provider.recalibrateAchievementsFromCurrentData(()=>true),'partial');
    assert.ok(JSON.parse(await readFile(repository.file,'utf8')).records.length>0);
    assert.equal(provider.achievementCalibrationCompleted,false);
   }finally{repository.append=append;provider.setAchievementCalibrationState(false);}
  },undefined,directory);
 });
});
test('source revocation drops session date caches without retaining the old records corpus',async()=>{
 await withProvider(achievementPersistenceState(),async provider=>{
  await provider.achievementWrite;
  const records:any[]=[];provider.calibratedSessionHistory=new WeakMap([[records,{zone:'UTC',days:[]}]]);
  provider.invalidateAchievementEvidence('claude');
  assert.equal(provider.calibratedSessionHistory,undefined);
  provider.calibratedSessionHistory=new WeakMap([[records,{zone:'UTC',days:[]}]]);
  provider.clearClaudeSource();assert.equal(provider.calibratedSessionHistory,undefined);
 });
});

test('installed webview uses local extension asset URIs instead of inlining every PNG', async () => {
  await withProvider(new Map(), async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: true, codex: true, codexData: true };
    provider.context.extensionPath = process.cwd();
    provider.panel = { webview: {
      asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => 'vscode-resource://badge/' + uri.fsPath.split('/').pop() }),
      cspSource: 'vscode-resource://badge',
    } };
    const html = provider.renderAchievementData();
    provider.panel = undefined;
    assert.match(html, /src="vscode-resource:\/\/badge\/claude-sonnet-main.png"/);
    assert.doesNotMatch(html, /data:image\/png;base64/);
  });
});

test('five Fable tiers share one icon-led card and keep the next target visible', async () => {
  await withProvider(new Map(), async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: true, codex: true, codexData: true };
    provider.achievementGrants = new Set(['fable-volume-bronze']);
    const html = provider.renderAchievementData();
    assert.equal((html.match(/data-achievement-series="fable-volume"/g) ?? []).length, 1);
    assert.match(html, /data-achievement-series="fable-volume"[^>]*data-achievement-tier="bronze"/);
    assert.match(html, /data-achievement-id="fable-volume-bronze"/);
    assert.match(html, /aria-label="[^"]*1[^\"]*5/);
  });
});

test('unlock feedback stays inside the webview and the generated client script parses', async () => {
  await withProvider(new Map(), async (provider) => {
    const script = provider.getScript();
    assert.doesNotThrow(() => new Function(script));
    assert.match(script, /achievementUnlockNotice/);
    assert.match(script, /setTimeout\(function\(\) \{ root\.remove\(\); \}, 6000\)/);
  });
});

test('night portrait waits for complete Codex hourly coverage when Codex is present', async () => {
  const previousZone = I18n.getTimezone();
  try {
    I18n.setTimezone('UTC');
    await withProvider(new Map(), async (provider) => {
      provider.settings = { get: () => true };
      provider.providerAvailability = { claude: true, codex: true, codexData: true };
      provider.allRecords = Array.from({ length: 14 }, (_, day) => ({
        timestamp: new Date(Date.UTC(2026, 8, 10 + day, 23)).toISOString(),
        message: { usage: { output_tokens: 1 } },
      }));
      provider.codexView = {
        currentManifestVerified: true,
        hourlyCoverage: { complete: false, timeZone: 'UTC' },
        periodCoverage: { last30Days: { complete: false } },
        last30DaysHourlyByDay: {},
      };
      assert.equal(provider.achievementHourSignals().nightPeak, false);
    });
  } finally {
    I18n.setTimezone(previousZone);
  }
});

test('historical Codex UTC output proof unlocks old hour streaks without rolling-hour reads', async () => {
  const first = Math.floor((Date.now() - 60 * 86_400_000) / 3_600_000);
  const hours = Array.from({ length: 12 }, (_, index) => first + index);
  await withProvider(new Map(), async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    provider.codexView = {
      currentManifestVerified: true,
      outputHourProof: { complete: true, hours, provenFiles: 1, totalFiles: 1 },
      hourlyCoverage: { complete: false, timeZone: 'UTC' },
      periodCoverage: { last30Days: { complete: false } },
      last30DaysHourlyByDay: {},
    };
    assert.equal(provider.achievementHourSignals().streak, 12);
  });
  await withProvider(new Map(), async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    provider.codexView = {
      currentManifestVerified: true,
      outputHourProof: { complete: false, hours, provenFiles: 0, totalFiles: 1 },
      hourlyCoverage: { complete: false, timeZone: 'UTC' },
      periodCoverage: { last30Days: { complete: false } },
      last30DaysHourlyByDay: {},
    };
    assert.equal(provider.achievementHourSignals().streak, 0);
  });
});

test('unverified cached snapshots cannot grant rolling-hour streaks or retain their maxima', async () => {
  const previousZone = I18n.getTimezone();
  I18n.setTimezone('UTC');
  try {
    for (const length of [12, 24, 48]) {
      const first = Math.floor((Date.now() - 5 * 86_400_000) / 3_600_000);
      const rows: Record<string, unknown[]> = {};
      for (let i = 0; i < length; i++) {
        const iso = new Date((first + i) * 3_600_000).toISOString();
        (rows[iso.slice(0, 10)] ??= []).push({ hour: iso.slice(11, 13), total: { output: 1 } });
      }
      const state = achievementPersistenceState();
      await withProvider(state, async (provider) => {
        provider.settings = { get: () => true };
        provider.providerAvailability = { claude: false, codex: true, codexData: true };
        provider.codexView = {
          currentManifestVerified: false,
          outputHourProof: { complete: false, hours: [] },
          hourlyCoverage: { complete: true, timeZone: 'UTC' },
          periodCoverage: { last30Days: { complete: true } },
          coverage: { complete: true, identity: { complete: true } },
          last30DaysHourlyByDay: rows,
        };
        assert.equal(provider.achievementHourSignals().streak, 0, `cached ${length} hours`);
        await settleAchievementWrites(provider);
        assert.equal(provider.achievementHourEvidence.maxStreak, 0);
        assert.equal(state.has('ccu.achievements.hours.v3'), false);
      });
    }
  } finally { I18n.setTimezone(previousZone); }
});

test('unverified cached Codex totals cannot award volume, family, day or weekly achievements', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    provider.codexView = {
      currentManifestVerified: false,
      allTime: { total: { processed: 10_000_000_000 } },
      allTimeDaily: Array.from({ length: 30 }, (_, day) => ({
        day: new Date(Date.UTC(2026, 7, 1 + day)).toISOString().slice(0, 10),
        total: { processed: 500_000_000 },
      })),
      coverage: { complete: true, identity: { complete: true } },
      periodCoverage: { allTime: { complete: true }, last30Days: { complete: true } },
      hourlyCoverage: { complete: false, timeZone: 'UTC' }, last30DaysHourlyByDay: {},
    };
    provider.codexAchievementSignals = {
      modelCount: 1, efforts: [], familyRootCounts: { astra: 0, sol: 0, luna: 0 },
      familyProcessedTokens: { astra: 10_000_000_000, sol: 0, luna: 0 },
      processedLowerBound: 10_000_000_000,
    };
    assert.equal(provider.achievementResults().some((row: { unlocked: boolean }) => row.unlocked), false);
    await settleAchievementWrites(provider);
    assert.deepEqual(state.get('ccu.achievements.grants.v5'), []);
  });
});

test('rolling Codex hour eligibility is recalculated when the UTC hour closes', async () => {
  const originalNow = Date.now;
  const previousZone = I18n.getTimezone();
  I18n.setTimezone('UTC');
  try {
    await withProvider(new Map(), async (provider) => {
      provider.settings = { get: () => true };
      provider.providerAvailability = { claude: false, codex: true, codexData: true };
      provider.codexView = {
        currentManifestVerified: true,
        outputHourProof: { complete: false, hours: [], provenFiles: 0, totalFiles: 1 },
        hourlyCoverage: { complete: true, timeZone: 'UTC' },
        periodCoverage: { last30Days: { complete: true } },
        coverage: { identity: { complete: true } },
        last30DaysHourlyByDay: {
          '2026-09-15': [{ hour: '12', total: { output: 1 } }],
        },
      };
      Date.now = () => Date.parse('2026-09-15T12:30:00Z');
      assert.equal(provider.achievementHourSignals().streak, 0);
      Date.now = () => Date.parse('2026-09-15T13:00:00Z');
      assert.equal(provider.achievementHourSignals().streak, 1);
    });
  } finally {
    Date.now = originalNow;
    I18n.setTimezone(previousZone);
  }
});

test('ambiguous Codex session copies cannot grant combined volume or weekly badges', async () => {
  await withProvider(new Map(), async (provider) => {
    // Default/system-zone settings still need an explicit canonical proof zone.
    const timeZone = resolveTimeZone(I18n.getTimezone());
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: false, codex: true, codexData: true };
    provider.codexView = {
      currentManifestVerified: true,
      allTime: { total: { processed: 1_200_000_000 } },
      allTimeDaily: Array.from({ length: 7 }, (_, index) => ({
        day: `2026-09-2${index + 1}`,
        total: { processed: 1_200_000_000 },
      })),
      coverage: { complete: true, identity: { complete: false, ambiguousSessionGroups: 1 } },
      periodCoverage: { timeZone, allTime: { complete: true } },
      hourlyCoverage: { complete: false, timeZone: 'UTC' },
      last30DaysHourlyByDay: {},
    };
    const results = () => new Map(provider.achievementResults().map((row: any) => [row.id, row]));
    assert.equal((results().get('weekly-volume-bronze') as any)?.unlocked, false);
    assert.equal((results().get('billion-token-club') as any)?.unlocked, false);
    assert.equal((results().get('active-day-streak') as any)?.unlocked, false);
    provider.codexAchievementSignals.processedLowerBound = 1_100_000_000;
    assert.equal((results().get('billion-token-club') as any)?.unlocked, true);
    assert.equal((results().get('weekly-volume-bronze') as any)?.unlocked, false);
    assert.equal((results().get('active-day-streak') as any)?.unlocked, false);
    assert.match(provider.renderAchievementData(), /≥[^<]*processed tokens/);
    provider.codexView.coverage.identity.complete = true;
    provider.codexAchievementSignals.dayEvidence = {
      complete: true, timeZone,
      days: provider.codexView.allTimeDaily.map((row: any) => ({
        day: row.day, processed: row.total.processed, output: 1, models: {},
      })),
    };
    assert.equal((results().get('weekly-volume-bronze') as any)?.unlocked, true);
    assert.equal((results().get('billion-token-club') as any)?.unlocked, true);
    assert.equal((results().get('active-day-streak') as any)?.unlocked, true);
  });
});

test('repeated achievement renders reuse Fable session evidence until aggregates change', async () => {
  await withProvider(new Map(), async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: true, codex: false, codexData: false };
    provider.allTimeData = {
      totalInputTokens: 1, totalOutputTokens: 1,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0,
      modelBreakdown: {},
    };
    let scans = 0;
    const session = {
      get data() {
        scans += 1;
        return { modelBreakdown: {} };
      },
    };
    provider.sessionBreakdown = Array.from({ length: 10_000 }, () => session);
    provider.achievementResults();
    assert.equal(scans, 10_000);
    provider.achievementResults();
    assert.equal(scans, 10_000, 'unchanged dashboard refresh must not rescan every session');
    provider.sessionBreakdown = [session];
    provider.achievementResults();
    assert.equal(scans, 10_001, 'new materialized session aggregate invalidates the cache');
  });
});
