import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ACHIEVEMENT_DEFINITIONS } from '../achievements';
import { achievementRuleVersion } from '../achievementRuleVersions';
import { isAchievementMoneyId } from '../achievementMoneyCatalog';
import { getAchievementMoneyPricebook } from '../achievementMoney';
import { parseAchievementRecordStore, type AchievementRecord } from '../achievementRecordStore';

const overview = require('../achievementOverview') as any;

function currentRecords(): AchievementRecord[] {
  const records: AchievementRecord[] = ACHIEVEMENT_DEFINITIONS.map((rule, index) => ({
    id: rule.id, seq: index + 1, origin: 'usage', recordedDay: '2026-10-08', timeZone: 'Asia/Shanghai',
    ruleVersion: achievementRuleVersion(rule.id), unread: true,
    ...(isAchievementMoneyId(rule.id) ? { referencePricebook:
      getAchievementMoneyPricebook(rule.group === 'codex' ? 'openai' : 'anthropic').version } : {}),
  }));
  // The projection receives valid current proof, including recalibrated rules
  // and the frozen provider-specific reference identity for money awards.
  return parseAchievementRecordStore({ schemaVersion: 2, catalogVersion: 2, generation: 1,
    sequence: records.length, lastNoticeAt: 0, pins: [], records, legacyRecords: [],
    showcaseMode: 'automatic', pinRevision: 0, legacyBoundary: null,
    auxiliary: { activity: { schemaVersion: 2, settingKeys: [], features: [] },
      hours: { schemaVersion: 3, maxStreak: 0 }, calendarPeak: null } }).records;
}

test('recent records collapse display themes but retain exact milestone identity and unread levels', () => {
  const records = ['active-day-streak', 'streak-machine', 'dual-provider-days-bronze', 'dual-provider-day']
    .map((id, index) => ({ id, seq: index + 1, origin: 'usage', unread: true, ruleVersion: 1,
      recordedDay: '2026-10-09', timeZone: 'UTC' }));
  const result = overview.projectAchievementRecords(records, records.map(row => row.id));
  assert.deepEqual(result.recent.map((row: any) => row.id), ['dual-provider-day', 'streak-machine']);
  assert.equal(result.history.length, 4);
  assert.deepEqual(result.unreadIds, records.map(row => row.id));
});

test('old milestone pin keys select their canonical display theme without duplicate showcase slots', () => {
  const rows = ['active-day-streak', 'dual-provider-days'].map(key => ({ key, group: 'combined',
    earnedLevel: 0, earned: true, next: true, progress: 0, target: 7, proof: 'ready' }));
  assert.deepEqual(overview.selectAchievementOverview(rows, 'claude',
    ['streak-machine', 'active-day-streak', 'dual-provider-day']).badges, ['active-day-streak', 'dual-provider-days']);
});

test('unread batches keep six exact levels, omit hidden and quiet awards, and read beyond history cap', () => {
  const records = currentRecords();
  const visible = records.map((item: any) => item.id);
  const before = JSON.stringify(records);
  const batch = overview.selectUnreadAchievementBatch(records, visible);
  assert.equal(batch.total, records.length);
  assert.equal(batch.records.length, 6);
  const latest = records.slice().sort((a, b) => b.seq - a.seq).slice(0, 6);
  assert.deepEqual(batch.records, latest);
  assert.equal(batch.sequence, latest[0].seq);
  const older = overview.selectUnreadAchievementBatch(records.map((item: any) => ({ ...item, unread: item.seq <= 2 })), visible);
  assert.deepEqual(older.records.map((item: any) => item.id), [records[1].id, records[0].id]);
  const exact = overview.selectUnreadAchievementBatch([
    { ...records[0], id: 'astra-regular', seq: 1 },
    { ...records[0], id: 'astra-regular-silver', seq: 2 },
    { ...records[0], id: 'sol-regular', seq: 3 },
    { ...records[0], id: 'hundred-million-club', seq: 4, origin: 'history' },
    { ...records[0], id: 'local-share-export', seq: 5, unread: false },
    { ...records[0], id: 'private-canary', seq: 6 },
  ], ['astra-regular', 'astra-regular-silver', 'hundred-million-club', 'local-share-export', 'private-canary']);
  assert.equal(exact.total, 2);
  assert.deepEqual(exact.records.map((item: any) => item.id), ['astra-regular-silver', 'astra-regular']);
  assert.equal(JSON.stringify(records), before);
  batch.records[0].unread = false;
  assert.equal(records.find(record => record.seq === latest[0].seq)!.unread, true,
    'display owns copies, not the canonical unread bits');
});

test('a represented unread batch never widens to later awards during unrelated refresh', () => {
  const record = (id: string, seq: number) => ({ id, seq, origin: 'activity', unread: true, ruleVersion: 1,
    recordedDay: '2026-10-08', timeZone: 'Asia/Shanghai' });
  const first = [record('settings-explorer-bronze', 1), record('settings-explorer-silver', 2)];
  const visible = [...first.map(item => item.id), 'local-share-export'];
  const initial = overview.selectUnreadAchievementBatch(first, visible);
  const peer = [...first, record('local-share-export', 3)];
  const retained = overview.selectUnreadAchievementBatch(peer, visible, initial);
  assert.deepEqual(retained.records, initial.records);
  assert.equal(retained.sequence, 2);
  assert.equal(retained.total, 3, 'total may change, but confirmation still represents only two exact levels');
  const hidden = overview.selectUnreadAchievementBatch(peer, ['local-share-export'], initial);
  assert.deepEqual(hidden.records.map((item: any) => item.id), ['local-share-export'], 'changed visibility retires the old batch');
  const read = overview.selectUnreadAchievementBatch(peer.map(item => ({ ...item, unread: item.seq > 2 })), visible, initial);
  assert.deepEqual(read.records.map((item: any) => item.id), ['local-share-export']);
  const replaced = overview.selectUnreadAchievementBatch(peer.map(item => ({ ...item, seq: item.seq + 10 })), visible, initial);
  assert.equal(replaced.sequence, 13, 'same IDs from a different recorded sequence are not the issued batch');
});
const row = (key: string, extra: Record<string, unknown> = {}) => ({
  key, group: 'codex', earnedLevel: 1, earned: true, next: true,
  progress: 600e6, target: 5e9, proof: 'ready', ...extra,
});

test('Claude model use and sustained days do not consume the same automatic representative slot', () => {
  const rows=[row('sonnet-main',{group:'claude',earnedLevel:4}),
    row('sonnet-days',{group:'claude',earnedLevel:5}),
    row('cumulative-volume',{group:'combined',earnedLevel:3})];
  assert.deepEqual(overview.selectAchievementOverview(rows,'claude',[],'automatic').badges,
    ['sonnet-days','sonnet-main','cumulative-volume']);
});

test('Claude-only four-family progress remains a pinned badge but not an eligible silver NEXT goal', () => {
  const rainbow = row('model-rainbow', { group: 'combined', earnedLevel: 1,
    progress: 4, target: 5, nextEligible: false });
  const before = JSON.stringify(rainbow);
  const selected = overview.selectAchievementOverview([rainbow], 'claude', ['model-rainbow'], 'manual');
  assert.deepEqual(selected.badges, ['model-rainbow']);
  assert.deepEqual(selected.next, []);
  assert.equal(JSON.stringify(rainbow), before, 'recommendation eligibility never edits award or gallery evidence');
});

test('rainbow NEXT eligibility uses explicit provider capacity and leaves unknown context unknown', () => {
  const eligible = overview.modelRainbowNextEligibility;
  for (const [providers, expected] of [
    [{ claude: true, codex: false }, [true, false, false]],
    [{ claude: false, codex: true }, [true, false, false]],
    [{ claude: true, codex: true }, [true, true, true]],
    [{ claude: false, codex: false }, [false, false, false]],
  ] as const) {
    assert.deepEqual([2, 5, 7].map(target => eligible(target, providers)), expected);
  }
  for (const providers of [{}, { claude: true }, { codex: false }]) {
    assert.equal(eligible(5, providers), undefined, 'absent context is not a disabled provider');
  }
  for (const target of [0, 3, 4, 6, NaN, Infinity]) {
    assert.equal(eligible(target, { claude: true, codex: false }), undefined, 'only actual rainbow targets');
  }
  const rainbow = row('model-rainbow', { group: 'combined', progress: 4, target: 5 });
  for (const nextEligible of [undefined, true]) {
    assert.deepEqual(overview.selectAchievementOverview([{ ...rainbow, nextEligible }], 'claude').next,
      ['model-rainbow'], 'unknown and explicitly eligible candidates retain existing recommendation behavior');
  }
  for (const proof of ['pending', 'stale']) {
    assert.deepEqual(overview.selectAchievementOverview([{ ...rainbow, nextEligible: true, proof }], 'claude').next, [],
      'structural eligibility never manufactures evidence readiness');
  }
});

test('a newly ineligible NEXT goal retires without replacement or changing retained pins', () => {
  const rainbow = row('model-rainbow', { group: 'combined', progress: 4, target: 5, nextEligible: true });
  const selected = overview.selectAchievementOverview([rainbow], 'claude', ['model-rainbow'], 'manual');
  const changed = [{ ...rainbow, nextEligible: false }, row('claude-output', { group: 'claude', progress: 1e6, target: 2e6 })];
  assert.deepEqual(overview.retainAchievementOverview(selected, changed), { badges: ['model-rainbow'], next: [] });
  assert.deepEqual(overview.selectAchievementOverview(changed, 'claude', ['model-rainbow'], 'manual').next,
    ['claude-output'], 'a new selection may choose another eligible goal');
  assert.deepEqual(overview.retainAchievementOverview(selected, [{ ...rainbow, nextEligible: undefined }]), selected,
    'unknown context alone does not retire a selected goal');
});

test('explicit earned pins take showcase priority without changing goals or share choices', () => {
  const rows = [row('astra-regular'), row('sol-regular'), row('local-share-export', { group: 'plugin' }),
    row('cumulative-volume', { group: 'combined', earnedLevel: 5 }),
    row('weekly-volume', { group: 'combined', earnedLevel: 3 }), row('luna-regular', { earned: false })];
  const base = overview.selectAchievementOverview(rows, 'codex');
  const chosen = overview.selectAchievementOverview(rows, 'codex', ['local-share-export', 'astra-regular', 'sol-regular']);
  assert.deepEqual(chosen.badges, ['local-share-export', 'astra-regular', 'sol-regular']);
  assert.deepEqual(chosen.next, base.next);
  assert.deepEqual(overview.selectAchievementOverview(rows, 'codex', ['luna-regular', 'private-canary', 'astra-regular']).badges,
    ['astra-regular', 'cumulative-volume', 'weekly-volume']);
});

test('record projection separates real recent actions from quiet history and keeps exact unread levels', () => {
  const record = (id: string, seq: number, origin = 'activity', unread = true) => ({
    id, seq, origin, unread, ruleVersion: 1, recordedDay: origin === 'history' ? null : '2026-10-08',
    timeZone: origin === 'history' ? null : 'Asia/Shanghai',
  });
  const records = [record('astra-regular', 1, 'usage'), record('astra-regular-silver', 2, 'usage'),
    record('local-share-export', 3), record('night-output-peak', 4),
    record('local-advice-feedback', 5), record('hundred-million-club', 6, 'history', false),
    record('private-canary', 7), record('luna-regular', 8, 'usage')];
  const visible = records.filter(item => item.id !== 'luna-regular').map(item => item.id);
  const projection = overview.projectAchievementRecords(records, visible);
  assert.deepEqual(projection.recent.map((item: any) => item.id), ['local-advice-feedback', 'night-output-peak', 'local-share-export']);
  assert.deepEqual(projection.unreadIds, ['astra-regular', 'astra-regular-silver', 'local-share-export', 'night-output-peak', 'local-advice-feedback']);
  assert.equal(projection.history.length, 6);
  assert.equal(projection.history[0].recordedDay, null, 'history has no invented achievement date');
  assert.deepEqual(overview.projectAchievementRecords(records, []).recent, []);
});

test('recent records collapse series by last recorded level and bound history without deleting awards', () => {
  const records = currentRecords();
  const before = JSON.stringify(records);
  const projected = overview.projectAchievementRecords(records, records.map((record: any) => record.id));
  assert.equal(projected.recent.length, 3);
  assert.equal(projected.history.length, 30);
  assert.deepEqual(projected.history, records.slice().sort((a, b) => b.seq - a.seq).slice(0, 30));
  assert.deepEqual(projected.unreadIds, records.map(record => record.id));
  assert.equal(JSON.stringify(records), before);
  const paired = overview.projectAchievementRecords(records.filter((record: any) => /^astra-regular(?:-|$)/.test(record.id)),
    records.map((record: any) => record.id));
  assert.equal(paired.recent.length, 1);
  assert.equal(paired.recent[0].id, 'astra-regular-gold');
});

test('next goals use display-stage progress, distinct topics and only known positive evidence', () => {
  const rows = [row('astra-regular'), row('sol-regular', { progress: 2e9, target: 10e9 }),
    row('weekly-volume', { group: 'combined', progress: 950e6, target: 2e9 }),
    row('weekly-average', { group: 'combined', progress: 900e6, target: 2e9 }),
    row('settings-explorer', { group: 'plugin', progress: 9, target: 10 }),
    row('safe-feature-explorer', { group: 'plugin', progress: 9, target: 10 }),
    row('luna-regular', { progress: 0 }), row('codex-output', { proof: 'pending' }),
    row('codex-cache-read', { proof: 'stale' }), row('agent-team', { next: false }),
    row('__unknown__'), row('active-days', { progress: NaN })];
  const chosen = overview.selectAchievementOverview(rows, 'codex');
  assert.deepEqual(chosen.next, ['weekly-volume', 'settings-explorer', 'astra-regular']);
  assert.equal(chosen.next.length, 3);
  assert.deepEqual(overview.selectAchievementOverview([...rows].reverse(), 'codex'), chosen,
    'ties are canonical, independent of incoming snapshot order');
  assert.deepEqual(overview.selectAchievementOverview([row('luna-regular', { progress: 0 })], 'codex').next, []);
});

test('representatives prioritize earned rank, then current provider, without inventing recent dates', () => {
  const rows = [row('astra-regular', { earnedLevel: 2 }),
    row('sol-regular', { earnedLevel: 3 }),
    row('sonnet-main', { group: 'claude', earnedLevel: 3 }),
    row('cumulative-volume', { group: 'combined', earnedLevel: 5, next: false }),
    row('weekly-volume', { group: 'combined', earnedLevel: 2, proof: 'stale' }),
    row('local-share-export', { group: 'plugin', earned: false, earnedLevel: 0 })];
  assert.deepEqual(overview.selectAchievementOverview(rows, 'claude').badges,
    ['cumulative-volume', 'sonnet-main', 'weekly-volume']);
  assert.deepEqual(overview.selectAchievementOverview(rows, 'codex').badges,
    ['cumulative-volume', 'sol-regular', 'weekly-volume']);
  assert.deepEqual(overview.selectAchievementOverview([], 'codex'), { badges: [], next: [] });
});

test('in-view selection stays fixed through progress changes and drops invalid goals without replacing them', () => {
  const initial = [row('astra-regular'), row('codex-output', { progress: 1, target: 10 })];
  const chosen = overview.selectAchievementOverview(initial, 'codex');
  const changed = [...initial, row('weekly-volume', { group: 'combined', progress: 1e9 - 1, target: 2e9 })];
  changed[0] = row('astra-regular', { proof: 'stale' });
  const retained = overview.retainAchievementOverview(chosen, changed);
  assert.deepEqual(retained.next, ['codex-output']);
  assert.ok(retained.badges.includes('astra-regular'), 'earned history survives proof expiry');
  assert.ok(!retained.next.includes('weekly-volume'), 'no live reorder/replacement');
  assert.ok(overview.selectAchievementOverview(changed, 'codex').next.includes('weekly-volume'),
    'a deliberate new selection can include the new goal');
});
