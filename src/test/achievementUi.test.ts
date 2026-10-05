import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import Module = require('node:module');

import { ACHIEVEMENT_DEFINITIONS } from '../achievements';
import { ACHIEVEMENT_COPY, I18n } from '../i18n';
import { resolveTimeZone } from '../dateKeys';

function withProvider(
  state: Map<string, unknown>,
  run: (provider: any) => Promise<void>,
  update?: (key: string, value: unknown, persist: () => void) => Promise<void>,
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
  provider.achievementNoticeBaselineReady = true;
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

test('first verified historical awards stay quiet even while the gallery is visible', async () => {
  const state = achievementPersistenceState();
  await withProvider(state, async (provider) => {
    const notices = await prepareAchievementNoticeProvider(provider);
    provider.achievementNoticeBaselineReady = false;
    provider.achievementCalendarTimeZone = resolveTimeZone(I18n.getTimezone());
    setSingleVolumeAchievementFact(provider);
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    assert.equal(hasDurableAchievement(state, 'hundred-million-club'), true);
    assert.equal(notices.length, 0, 'backfill does not celebrate old milestones');
    assert.equal(provider.achievementNoticeBaselineReady, true);
    provider.allTimeData = { ...provider.allTimeData, totalInputTokens: 1_000_000_000 };
    evaluateAndDispatchAchievementNotice(provider);
    await settleAchievementWrites(provider);
    assert.equal(hasDurableAchievement(state, 'billion-token-club'), true);
    assert.equal(notices.length, 1, 'later new progress can use the quiet in-panel toast');
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
    assert.equal(notices.length, 1);
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
      assert.equal(html.match(/class="achievement-count"[^>]*>([^<]+)/)?.[1],
        `2 / ${ACHIEVEMENT_DEFINITIONS.length} Earned`);
      await provider.achievementWrite;
      assert.ok((state.get('ccu.achievements.grants.v5') as string[]).includes('sonnet-main'));
      assert.equal(state.get('ccu.achievements.calibrationAudit.v1'), true);
    });
    await withProvider(state, async (provider) => {
      provider.settings = { get: () => true };
      provider.providerAvailability = { claude: true, codex: false, codexData: false };
      const html = provider.renderAchievementData();
      assert.match(html, /achievement-card earned" data-achievement-series="sonnet-main"[^>]*data-achievement-id="sonnet-main"/);
      assert.equal(html.match(/class="achievement-count"[^>]*>([^<]+)/)?.[1],
        `2 / ${ACHIEVEMENT_DEFINITIONS.length} Earned`);
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
    provider.codexAchievementSignals = {
      modelCount: 4, efforts: [], familyRootCounts: { astra: 5, sol: 5, luna: 5 },
      maxVerifiedAgentsPerRoot: 10, maxRealModelsPerRoot: 4,
      effortRootCounts: { low: 3, medium: 3, high: 3, xhigh: 3, max: 3, ultra: 3 },
    };
    provider.codexView = {
      currentManifestVerified: true,
      coverage: { complete: true, identity: { complete: false } },
      allTime: { total: { processed: 100 } },
      periodCoverage: { allTime: { complete: true } },
      allTimeDaily: [],
      outputHourProof: { complete: false, hours: [], provenFiles: 0, totalFiles: 1 },
      hourlyCoverage: { complete: false, timeZone: 'UTC' },
      last30DaysHourlyByDay: {},
    };
    const results = () => new Map(provider.achievementResults().map((row: any) => [row.id, row]));
    assert.equal((results().get('agent-team-gold') as any)?.unlocked, false);
    provider.codexView.coverage.identity.complete = true;
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
    assert.deepEqual([...provider.achievementGrants].sort(), ['agent-standup', 'hundred-million-club', 'sonnet-main']);
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
      'astra-regular-gold', 'effort-spectrum', 'hundred-million-club', 'sonnet-main',
    ]);
    assert.deepEqual(state.get('ccu.achievements.grants.v5'), [...provider.achievementGrants].sort());
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
    assert.match(card, /max="1000000000000"/);
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

test('three milestone tiers share one icon-led card and keep the next target visible', async () => {
  await withProvider(new Map(), async (provider) => {
    provider.settings = { get: () => true };
    provider.providerAvailability = { claude: true, codex: true, codexData: true };
    provider.achievementGrants = new Set(['fable-volume-bronze']);
    const html = provider.renderAchievementData();
    assert.equal((html.match(/data-achievement-series="fable-volume"/g) ?? []).length, 1);
    assert.match(html, /data-achievement-series="fable-volume"[^>]*data-achievement-tier="bronze"/);
    assert.match(html, /data-achievement-id="fable-volume-bronze"/);
    assert.match(html, /aria-label="[^"]*1[^\"]*3/);
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
