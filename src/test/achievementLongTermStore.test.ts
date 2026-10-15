import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES, type AchievementId } from '../achievements';
import { LONG_TERM_ACHIEVEMENT_DEFINITIONS } from '../achievementLongTerm';
import { achievementRuleVersion, isLegacyAchievementId, RECALIBRATED_ACHIEVEMENT_IDS_V2 } from '../achievementRuleVersions';
import { isAchievementMoneyId } from '../achievementMoneyCatalog';
import { getAchievementMoneyPricebook } from '../achievementMoney';
import { ACHIEVEMENT_SETTING_KEYS, SAFE_EXPLORATION_FEATURES } from '../achievementActivity';
import { acquireCodexIndexLease } from '../providers/codex/codexIndexLease';
import type { AchievementRecordStore, AchievementRecordDraft } from '../achievementRecordStore';

type StoreApi = typeof import('../achievementRecordStore');
const storeModule = require.resolve('../achievementRecordStore');
const highIds: AchievementId[] = LONG_TERM_ACHIEVEMENT_DEFINITIONS.map(row => row.id);
const inventedSeries = 'store-test-only-new-series';
// Historical fixture vocabulary must not be derived from today's tier membership.
const oldSeriesKeys = [
  'cumulative-volume', 'sonnet-main', 'opus-cannon', 'haiku-worker', 'cache-wizard',
  'claude-output', 'claude-output-sessions', 'claude-cache-creation', 'fable-volume',
  'fable-days', 'fable-sessions', 'weekly-volume', 'output-hours', 'settings-explorer',
  'astra-regular', 'sol-regular', 'luna-regular', 'agent-team', 'same-root-models',
  'effort-breadth', 'agent-conductor', 'root-portfolio', 'agent-participation',
  'model-relay-roots', 'active-day-streak', 'active-days', 'model-rainbow',
  'codex-output', 'codex-cache-read', 'astra-days', 'sol-days', 'luna-days',
  'sonnet-days', 'opus-days', 'haiku-days', 'dual-provider-days', 'active-weeks', 'weekly-average',
];
const definitions = ACHIEVEMENT_DEFINITIONS as unknown as Array<{ id: AchievementId; group: string; target: number }>;
const stamp = { recordedDay: '9999-12-31', timeZone: 'America/Argentina/ComodRivadavia' };

function freshStore(): StoreApi {
  delete require.cache[storeModule];
  return require('../achievementRecordStore') as StoreApi;
}

/** Only this test process's catalog changes; production files and out/ stay intact. */
async function expanded(run: (api: StoreApi) => Promise<void>): Promise<void> {
  const previousModule = require.cache[storeModule];
  const previousDefinitions = definitions.slice();
  const previousSeries = new Map(oldSeriesKeys.map(key => [key, ACHIEVEMENT_SERIES[key]]));
  const previousInvented = ACHIEVEMENT_SERIES[inventedSeries];
  try {
    for (const key of oldSeriesKeys) ACHIEVEMENT_SERIES[key] = [...new Set([...ACHIEVEMENT_SERIES[key], ...highIds])];
    // All members are genuinely legacy, but the series key itself never existed in v1.
    ACHIEVEMENT_SERIES[inventedSeries] = ['sonnet-main', 'opus-cannon'];
    await run(freshStore());
  } finally {
    definitions.splice(0, definitions.length, ...previousDefinitions);
    for (const [key, ids] of previousSeries) ACHIEVEMENT_SERIES[key] = ids;
    if (previousInvented === undefined) delete ACHIEVEMENT_SERIES[inventedSeries];
    else ACHIEVEMENT_SERIES[inventedSeries] = previousInvented;
    delete require.cache[storeModule];
    if (previousModule) require.cache[storeModule] = previousModule;
  }
}

async function fixture(run: (legacy: string, current: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ccu-long-term-store-'));
  try { await run(path.join(directory, 'achievements-v1.json'), path.join(directory, 'achievements-v2.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function oldV1(ids: readonly AchievementId[] = [], pins: string[] = []): AchievementRecordStore {
  return { schemaVersion: 1, generation: 1, sequence: ids.length, lastNoticeAt: 0, pins,
    records: ids.map((id, index) => ({ id, origin: 'existing', recordedDay: null, timeZone: null,
      ruleVersion: 1, seq: index + 1, unread: false })),
    auxiliary: { activity: { schemaVersion: 2, settingKeys: [], features: [] },
      hours: { schemaVersion: 3, maxStreak: 0 }, calendarPeak: null } };
}
const history = (id: AchievementId): AchievementRecordDraft => ({ id, origin: 'history', recordedDay: null, timeZone: null });
const weeklyExpansionIds = new Set(['claude-api-week-platinum','claude-api-week-legendary','codex-api-week-platinum','codex-api-week-legendary']);
const frozenOldIds = () => definitions.filter(row => !weeklyExpansionIds.has(row.id) &&
  (isLegacyAchievementId(row.id) || isAchievementMoneyId(row.id))).map(row => row.id);
const reference = (id: AchievementId) => getAchievementMoneyPricebook(id.startsWith('codex-') ? 'openai' : 'aws-bedrock-in-region').version;

test('every frozen v1 series pin survives expanded tier membership and migrates unchanged', async () => {
  await expanded(async api => {
    const legacyIds = definitions.filter(row => isLegacyAchievementId(row.id)).map(row => row.id);
    assert.equal(legacyIds.length, 124);
    for (let index = 0; index < oldSeriesKeys.length; index += 3) await fixture(async (legacy, current) => {
      const pins = oldSeriesKeys.slice(index, index + 3);
      const original = JSON.stringify(oldV1(legacyIds, pins));
      await writeFile(legacy, original);
      assert.deepEqual(api.parseAchievementRecordStore(JSON.parse(original)).pins, pins);
      const saved = await new api.AchievementRecordRepository(current).initialize([]);
      assert.deepEqual(saved.pins, pins);
      assert.equal(saved.showcaseMode, 'manual');
      assert.equal(saved.records.length + saved.legacyRecords!.length, 124);
      assert.equal(await readFile(legacy, 'utf8'), original);
    });
  });
});

test('v1 does not infer a new series key even when all its members are old IDs', async () => {
  await expanded(async api => fixture(async (legacy, current) => {
    const host = new api.AchievementRecordRepository(legacy);
    const initial = await host.initialize(['sonnet-main']);
    const before = await readFile(legacy);
    assert.throws(() => api.parseAchievementRecordStore({ ...initial, pins: [inventedSeries] }), /invalid/);
    await assert.rejects(host.pin(initial.generation, [inventedSeries]), /invalid/);
    await assert.rejects(host.setPinned(initial.generation, inventedSeries, false), /invalid/);
    assert.deepEqual(await readFile(legacy), before);
    await assert.rejects(lstat(current), { code: 'ENOENT' });
  }));
});

test('new high IDs with ruleVersion 1 never become v1 records or legacy initialization proof', async () => {
  await expanded(async api => {
    assert.equal(highIds.length, 30);
    for (const id of highIds) await fixture(async (legacy, current) => {
      assert.equal(achievementRuleVersion(id), 1);
      assert.equal(isLegacyAchievementId(id), false);
      assert.throws(() => api.parseAchievementRecordStore(oldV1([id])), /invalid/);
      const old = new api.AchievementRecordRepository(legacy);
      await assert.rejects(old.initialize([id]), /invalid/);
      await assert.rejects(lstat(legacy), { code: 'ENOENT' });
      const initial = await old.initialize([]);
      const before = await readFile(legacy);
      await assert.rejects(old.append(initial.generation, [history(id)]), /invalid/);
      await assert.rejects(old.setPinned(initial.generation, id, true), /invalid/);
      assert.deepEqual(await readFile(legacy), before);
      // Even a new reader cannot treat these IDs in an old Memento draft as proof.
      const host = new api.AchievementRecordRepository(current);
      const migrated = await host.initialize([]);
      const receipt = await host.append(migrated.generation, [history(id)]);
      assert.equal(receipt.added[0].ruleVersion, 1);
      assert.equal(receipt.added[0].unread, false);
      assert.equal(receipt.added[0].recordedDay, null);
    });
    await fixture(async (_legacy, current) => {
      await assert.rejects(new api.AchievementRecordRepository(current).initialize(highIds), /invalid/);
      await assert.rejects(lstat(current), { code: 'ENOENT' });
    });
  });
});

test('an existing 144-rule v2 canonical envelope wins over stale legacy drafts without rewriting history', async () => {
  await expanded(async api => fixture(async (_legacy, current) => {
    const ids = frozenOldIds();
    assert.equal(ids.length, 144);
    const host = new api.AchievementRecordRepository(current);
    const initial = await host.initialize([]);
    const original: AchievementRecordStore = { ...initial, sequence: ids.length,
      pins: oldSeriesKeys.slice(0, 6), showcaseMode: 'manual', pinRevision: 6,
      records: ids.map((id, index) => ({ id, origin: index % 2 ? 'usage' : 'history',
        recordedDay: index % 2 ? stamp.recordedDay : null, timeZone: index % 2 ? stamp.timeZone : null,
        ruleVersion: achievementRuleVersion(id), seq: index + 1, unread: !!(index % 2),
        ...(isAchievementMoneyId(id) ? { referencePricebook: reference(id) } : {}) })) };
    const bytes = JSON.stringify(api.parseAchievementRecordStore(original));
    await writeFile(current, bytes);
    const saved = await new api.AchievementRecordRepository(current).initialize(highIds);
    assert.deepEqual(saved, original);
    assert.equal(await readFile(current, 'utf8'), bytes);
    const appended = await host.append(saved.generation, highIds.map(history));
    assert.deepEqual(appended.store.records.slice(0, 144), original.records);
    assert.equal(appended.store.records.length, 174);
    assert.equal(appended.store.sequence, 144 + highIds.length);
    assert.deepEqual(appended.store.pins, original.pins);
    assert.equal(appended.store.schemaVersion, 2);
    assert.equal(appended.store.catalogVersion, 2);
  }));
});

test('the full 178-rule catalog and largest feasible archived/auxiliary envelope fit the unchanged 64 KiB limit', async t => {
  await expanded(async api => fixture(async (legacy, current) => {
    assert.equal(definitions.length, 178);
    assert.equal(frozenOldIds().length, 144);
    assert.equal(highIds.length, 30);
    assert.equal(new Set(LONG_TERM_ACHIEVEMENT_DEFINITIONS.map(row => row.series)).size, 15);
    const maximum = Number.MAX_SAFE_INTEGER;
    await writeFile(legacy, JSON.stringify({ ...oldV1(), generation: maximum - 1, sequence: maximum }));
    const host = new api.AchievementRecordRepository(current);
    const initial = await host.initialize([]);
    const archived = RECALIBRATED_ACHIEVEMENT_IDS_V2;
    const firstSequence = maximum - archived.length - definitions.length;
    const dense: AchievementRecordStore = { ...initial, lastNoticeAt: maximum, pinRevision: maximum,
      pins: oldSeriesKeys.slice(0, 6), showcaseMode: 'manual',
      legacyRecords: archived.map((id, index) => ({ id, origin: 'usage', ...stamp,
        ruleVersion: 1, seq: firstSequence + index + 1, unread: false })),
      records: definitions.map(({ id }, index) => ({ id, origin: 'usage', ...stamp,
        ruleVersion: achievementRuleVersion(id), seq: firstSequence + archived.length + index + 1, unread: true,
        ...(isAchievementMoneyId(id) ? { referencePricebook: reference(id) } : {}) })),
      auxiliary: { activity: { schemaVersion: 2, settingKeys: [...ACHIEVEMENT_SETTING_KEYS].sort(),
        features: [...SAFE_EXPLORATION_FEATURES, 'localAdviceFeedback'].sort() as AchievementRecordStore['auxiliary']['activity']['features'] },
        hours: { schemaVersion: 3, maxStreak: 48 },
        calendarPeak: { schemaVersion: 1, ruleVersion: maximum, parserVersion: maximum, periodVersion: maximum,
          timeZone: stamp.timeZone, providers: 3, peakFourWeekAverage: maximum } } };
    // Only the 21 changed legacy IDs can actually be archived: 48 is a cap, not 48 inventable records.
    assert.equal(archived.length, 21);
    assert.equal(dense.records.length, 178);
    assert.equal(dense.records.length, ACHIEVEMENT_DEFINITIONS.length);
    assert.equal(dense.records.filter(row => highIds.includes(row.id)).length, 30);
    assert.equal(dense.auxiliary.activity.settingKeys.length, 29);
    assert.equal(dense.auxiliary.activity.features.length, 4);
    const serialized = JSON.stringify(api.parseAchievementRecordStore(dense));
    t.diagnostic(`178 current records + 21 archived records + maximal feasible auxiliary proof: ${Buffer.byteLength(serialized)} / 65,536 bytes`);
    assert.ok(Buffer.byteLength(serialized) <= api.ACHIEVEMENT_RECORD_BYTE_LIMIT);
    assert.equal(api.ACHIEVEMENT_RECORD_BYTE_LIMIT, 65_536);
    await writeFile(current, serialized);
    assert.deepEqual(await api.loadAchievementRecords(current), dense);
    const saved = await host.acknowledge(dense.generation, dense.sequence);
    assert.deepEqual(saved.auxiliary, dense.auxiliary);
    assert.deepEqual(saved.legacyRecords, dense.legacyRecords);
    assert.deepEqual(saved.pins, dense.pins);
    assert.ok(saved.records.every(row => !row.unread));
    assert.ok((await readFile(current)).byteLength <= 65_536);
  }));
});

test('a frozen old-catalog reader rejects new v2 IDs without fallback, quarantine or overwrite', async () => {
  await expanded(async api => fixture(async (legacy, current) => {
    const host = new api.AchievementRecordRepository(current);
    const initial = await host.initialize([]);
    await host.append(initial.generation, highIds.map(history));
    await writeFile(legacy, JSON.stringify(oldV1(['sonnet-main'])));
    const before = await Promise.all([readFile(current), readFile(legacy)]);
    // Capture the old reader's ID set without changing files or keeping the catalog mutated.
    const fullCatalog = definitions.slice();
    let oldApi: StoreApi;
    try {
      definitions.splice(0, definitions.length, ...definitions.filter(row => isLegacyAchievementId(row.id) || isAchievementMoneyId(row.id)));
      oldApi = freshStore();
    } finally { definitions.splice(0, definitions.length, ...fullCatalog); }
    const old = new oldApi!.AchievementRecordRepository(current);
    await assert.rejects(old.initialize(['sonnet-main']), /invalid/);
    await assert.rejects(old.append(initial.generation, [history('sonnet-main')]), /invalid/);
    let resetCalled = false;
    await assert.rejects(old.clear(async () => { resetCalled = true; }), /invalid/);
    assert.equal(resetCalled, false);
    assert.deepEqual(await Promise.all([readFile(current), readFile(legacy)]), before);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual((await readdir(path.dirname(current))).sort(), ['achievements-v1.json', 'achievements-v2.json']);
  }));
});

test('the shared v1 lease cancellation and clear generations fence additive high-tier writes', { timeout: 5_000 }, async () => {
  await expanded(async api => fixture(async (legacy, current) => {
    const host = new api.AchievementRecordRepository(current);
    const initial = await host.initialize([]);
    const before = await readFile(current);
    const lease = await acquireCodexIndexLease(legacy);
    let enabled = true, checks = 0;
    let notify!: () => void;
    const waiting = new Promise<void>(resolve => { notify = resolve; });
    try {
      const pending = host.recordUsage(initial.generation, initial.sequence, highIds, stamp,
        () => { if (++checks >= 3) notify(); return enabled; });
      const rejected = assert.rejects(pending, /cancelled/);
      await waiting;
      assert.deepEqual(await readFile(current), before, 'no canonical write while the shared lease is held');
      enabled = false;
      await rejected;
    } finally { enabled = false; await lease.release(); }
    const granted = await host.recordUsage(initial.generation, initial.sequence, highIds, stamp);
    assert.ok(granted.added.every(row => row.origin === 'usage' && row.unread && row.ruleVersion === 1));
    const cleared = await host.clear();
    const fences = await Promise.all([readFile(current), readFile(legacy)]);
    assert.deepEqual(cleared.records, []);
    assert.deepEqual(cleared.legacyRecords, []);
    assert.deepEqual(cleared.pins, []);
    assert.deepEqual(cleared.auxiliary, oldV1().auxiliary);
    await assert.rejects(host.recordUsage(initial.generation, initial.sequence, highIds, stamp), /generation/);
    await assert.rejects(host.append(initial.generation, highIds.map(history)), /generation/);
    const resumed = await new api.AchievementRecordRepository(current).initialize(['sonnet-main']);
    assert.deepEqual(resumed.records, []);
    assert.deepEqual(await Promise.all([readFile(current), readFile(legacy)]), fences);
    assert.deepEqual((await api.loadAchievementRecords(legacy))!.records, []);
  }));
});
